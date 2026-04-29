require('dotenv').config();
const {
  joinVoiceChannel,
  createAudioPlayer,
  createAudioResource,
  AudioPlayerStatus,
  VoiceConnectionStatus,
  entersState,
  getVoiceConnection,
} = require('@discordjs/voice');
const { EmbedBuilder } = require('discord.js');
const playdl = require('play-dl');
const { spawn } = require('child_process');
const { StreamType } = require('@discordjs/voice');
const path = require('path');

// Path ke yt-dlp.exe (taruh di folder project)
const YTDLP_PATH = path.join(__dirname, 'yt-dlp.exe');
const log = {
    info: (msg) => console.log(`\x1b[36m[INFO]\x1b[0m ${msg}`),
    success: (msg) => console.log(`\x1b[32m[SUCCESS]\x1b[0m ${msg}`),
    warn: (msg) => console.log(`\x1b[33m[WARN]\x1b[0m ${msg}`),
    error: (msg) => console.error(`\x1b[31m[ERROR]\x1b[0m ${msg}`)
};

// --- KONFIGURASI SPOTIFY (Tambahkan ini agar error expiry hilang) ---
// Setup Spotify token jika ada di .env
if (process.env.SPOTIFY_CLIENT_ID && process.env.SPOTIFY_CLIENT_SECRET) {
  playdl.setToken({
    spotify: {
      client_id: process.env.SPOTIFY_CLIENT_ID,
      client_secret: process.env.SPOTIFY_CLIENT_SECRET,
      refresh_token: process.env.SPOTIFY_REFRESH_TOKEN || '',
      market: 'ID'
    }
  }).catch(err => console.log("Spotify Auth Error: " + err.message));
}

// --- State ---
const guildStates = new Map();

function getState(guildId) {
  if (!guildStates.has(guildId)) {
    guildStates.set(guildId, {
      queue: [],
      player: null,
      connection: null,
      loop: 'off',
      // Gunakan process.env langsung, bukan config.
      volume: process.env.DEFAULT_VOLUME ? parseInt(process.env.DEFAULT_VOLUME) : 50, 
      history: [],
      npMessage: null,
      currentSong: null,
      lastActivity: Date.now(),
      skipVotes: new Set(),
      cooldowns: new Map(),
      eq: 'normal',
      filter: null,
    });
  }
  return guildStates.get(guildId);
}

function destroyState(guildId) {
  const state = guildStates.get(guildId);
  if (!state) return;
  if (state.player) state.player.stop(true);
  if (state.connection) {
    try { state.connection.destroy(); } catch {}
  }
  guildStates.delete(guildId);
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function embed(color = 0x5865f2) {
  return new EmbedBuilder().setColor(color);
}

function successEmbed(title, desc) {
  return embed(0x57f287).setTitle(title).setDescription(desc);
}

function errorEmbed(desc) {
  return embed(0xed4245).setTitle('⚠️ Error').setDescription(desc);
}

function infoEmbed(title, desc) {
  return embed(0x5865f2).setTitle(title).setDescription(desc);
}

function formatDuration(ms) {
  if (!ms) return '??:??';
  const s = Math.floor(ms / 1000);
  const m = Math.floor(s / 60);
  const h = Math.floor(m / 60);
  if (h > 0) return `${h}:${String(m % 60).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
  return `${m}:${String(s % 60).padStart(2, '0')}`;
}

function progressBar(current, total, length = 15) {
  if (!total) return '▬'.repeat(length);
  const pos = Math.floor((current / total) * length);
  return '▬'.repeat(pos) + '🔘' + '▬'.repeat(length - pos);
}

function addToHistory(state, song) {
  state.history.unshift(song);
  if (state.history.length > 20) state.history.pop();
}

function isCooldown(state, userId, cmd, ms = 2500) {
  const key = `${userId}:${cmd}`;
  const last = state.cooldowns.get(key) ?? 0;
  if (Date.now() - last < ms) return true;
  state.cooldowns.set(key, Date.now());
  return false;
}

function validateVC(message) {
  const vc = message.member?.voice?.channel;
  if (!vc) return { ok: false, reason: 'Kamu harus masuk ke Voice Channel dulu!' };
  const botVC = message.guild.members.me?.voice?.channel;
  if (botVC && botVC.id !== vc.id) return { ok: false, reason: 'Kamu harus di VC yang sama dengan bot!' };
  return { ok: true, vc };
}

// ─── FFmpeg Filter Builder ─────────────────────────────────────────────────────

function buildFFmpegArgs(eq, filter) {
  const filters = [];

  // EQ
  if (eq === 'bass') filters.push('bass=g=10');
  else if (eq === 'high') filters.push('treble=g=5');

  // Filter
  if (filter === 'nightcore') filters.push('asetrate=44100*1.25,aresample=44100');
  else if (filter === 'vaporwave') filters.push('asetrate=44100*0.8,aresample=44100');
  else if (filter === 'bassboost') filters.push('bass=g=20');

  return filters.length ? ['-af', filters.join(',')] : [];
}

// ─── Audio Streaming ──────────────────────────────────────────────────────────

const fs = require('fs');
const os = require('os');

// Buffer delay dalam detik sebelum mulai stream ke Discord
const BUFFER_DELAY_SEC = 20;

async function createResource(song, state) {
  log.info(`Buffering: ${song.url} (${BUFFER_DELAY_SEC}s pre-buffer...)`);

  // Download ke temp file dulu, tunggu BUFFER_DELAY_SEC detik, baru stream
  const tmpFile = path.join(os.tmpdir(), `dcbot_${Date.now()}.webm`);

  await new Promise((resolve, reject) => {
    const proc = spawn(YTDLP_PATH, [
      '-f', 'bestaudio',
      '-o', tmpFile,
      '--no-playlist',
      '--no-warnings',
      '--js-runtimes', 'node',
      '-q',
      song.url,
    ], { windowsHide: true });

    proc.stderr.on('data', d => {
      const msg = d.toString().trim();
      if (msg) log.warn(`yt-dlp: ${msg}`);
    });

    proc.on('error', reject);

    // Resolve setelah BUFFER_DELAY_SEC detik (tidak perlu tunggu selesai)
    // yt-dlp terus download di background, kita mulai baca setelah cukup ter-buffer
    setTimeout(resolve, BUFFER_DELAY_SEC * 1000);
  });

  // Cek file sudah ada dan punya data
  if (!fs.existsSync(tmpFile) || fs.statSync(tmpFile).size === 0) {
    throw new Error('Buffer file kosong, yt-dlp mungkin gagal download.');
  }

  log.success(`Buffer OK (${Math.round(fs.statSync(tmpFile).size / 1024)}KB), mulai stream ke Discord...`);

  const fileStream = fs.createReadStream(tmpFile);

  // Hapus temp file setelah stream selesai
  fileStream.on('close', () => {
    fs.unlink(tmpFile, () => {});
  });

  const resource = createAudioResource(fileStream, {
    inputType: StreamType.Arbitrary,
    inlineVolume: true,
  });

  resource.volume?.setVolumeLogarithmic(state.volume / 100);
  return resource;
}

// ─── Queue Player ─────────────────────────────────────────────────────────────

async function playSong(guildId, textChannel) {
  const state = getState(guildId);
  if (!state.queue.length) {
    // Try autoplay
    if (state.currentSong) {
      try {
        const autoSong = await searchYouTube(`${state.currentSong.title} related`);
        autoSong.requester = '🤖 Autoplay';
        state.queue.push(autoSong);
        textChannel?.send({ embeds: [infoEmbed('🤖 Autoplay', `Memutar lagu terkait: **${autoSong.title}**`)] });
      } catch {
        // Autoplay gagal, biarkan queue kosong
      }
    }

    if (!state.queue.length) {
      state.currentSong = null;
      state.lastActivity = Date.now();
      textChannel?.send({ embeds: [infoEmbed('🎵 Queue Kosong', 'Semua lagu sudah diputar!')] });
      return;
    }
  }

  const song = state.queue.shift();
  state.currentSong = song;
  state.lastActivity = Date.now();
  state.skipVotes.clear();

  if (state.loop === 'queue') state.queue.push(song);

  try {
    const resource = await createResource(song, state);
    state.player.play(resource);
    addToHistory(state, song);
    await sendNowPlaying(textChannel, state, song);
  } catch (err) {
    console.error('Stream error:', err.message);
    textChannel?.send({ embeds: [errorEmbed(`Gagal memutar **${song.title}**. Melanjutkan...`)] });
    await playSong(guildId, textChannel);
  }
}

async function sendNowPlaying(channel, state, song) {
  if (!channel) return;

  const e = embed(0x5865f2)
    .setTitle('🎵 Now Playing')
    .setDescription(`**[${song.title}](${song.url})**`)
    .addFields(
      { name: 'Durasi', value: formatDuration(song.duration), inline: true },
      { name: 'Diminta oleh', value: song.requester, inline: true },
      { name: 'Loop', value: state.loop, inline: true },
    )
    .setFooter({ text: 'Reaksi: ⏭️ skip | ⏸️ pause | ▶️ resume | 🔊 vol+ | 🔉 vol-' });

  if (song.thumbnail) e.setThumbnail(song.thumbnail);

  try {
    if (state.npMessage) await state.npMessage.delete().catch(() => {});
    const msg = await channel.send({ embeds: [e] });
    state.npMessage = msg;

    for (const emoji of ['⏭️', '⏸️', '▶️', '🔊', '🔉']) {
      await msg.react(emoji).catch(() => {});
    }
  } catch {}
}

function setupPlayer(guildId, textChannel) {
  const state = getState(guildId);
  if (state.player) return state.player;

  const player = createAudioPlayer();
  state.player = player;

  player.on(AudioPlayerStatus.Idle, async () => {
    if (state.loop === 'song' && state.currentSong) {
      state.queue.unshift(state.currentSong);
    }
    await playSong(guildId, textChannel);
  });

  player.on('error', (err) => {
    console.error('Player error:', err.message);
  });

  return player;
}

async function connectToVC(vc, guildId) {
  const state = getState(guildId);

  log.info(`Mencoba menyambung ke VC: ${vc.name}...`);

  const connection = joinVoiceChannel({
    channelId: vc.id,
    guildId: vc.guild.id,
    adapterCreator: vc.guild.voiceAdapterCreator,
    selfDeaf: true,
    group: vc.client.user.id,
  });

  // Melacak perpindahan status koneksi
  connection.on('stateChange', (oldState, newState) => {
    console.log(`\x1b[35m[VOICE STATE]\x1b[0m ${oldState.status} -> ${newState.status}`);
  });

  // Melacak error spesifik di koneksi
  connection.on('error', (error) => {
    log.error(`Discord Voice Connection Error: ${error.message}`);
  });

  try {
    // Kita tunggu sampai statusnya 'Ready' selama 30 detik
    await entersState(connection, VoiceConnectionStatus.Ready, 30_000);
    log.success(`Berhasil tersambung ke VC ${vc.name}!`);
  } catch (err) {
    log.error(`Koneksi Voice Timeout. Status Terakhir: ${connection.state.status}`);
    connection.destroy();
    throw new Error('Gagal connect ke Voice Channel.');
  }

  state.connection = connection;
  connection.subscribe(state.player ?? setupPlayer(guildId, null));
  return connection;
}

// ─── Search ───────────────────────────────────────────────────────────────────

// Ambil info video via yt-dlp (JSON dump) — tidak butuh library YouTube apapun
async function getVideoInfo(url) {
  return new Promise((resolve, reject) => {
    const proc = spawn(YTDLP_PATH, [
      '--dump-json',
      '--no-playlist',
      '--no-warnings',
      '--js-runtimes', 'node',
      '-q',
      url,
    ], { windowsHide: true });

    let output = '';
    proc.stdout.on('data', d => output += d.toString());
    proc.stderr.on('data', d => {
      const msg = d.toString().trim();
      if (msg) log.warn(`yt-dlp info: ${msg}`);
    });
    proc.on('close', (code) => {
      if (!output) return reject(new Error('yt-dlp tidak return data'));
      try {
        const info = JSON.parse(output);
        resolve({
          title: info.title,
          url: `https://www.youtube.com/watch?v=${info.id}`,
          duration: (info.duration ?? 0) * 1000,
          thumbnail: info.thumbnail,
        });
      } catch {
        reject(new Error('Gagal parse info video'));
      }
    });
    proc.on('error', reject);
  });
}

// Search YouTube via yt-dlp (tidak pakai play-dl untuk search jika perlu)
async function searchYouTube(query) {
  // URL langsung — Spotify, YouTube, SoundCloud
  if (query.startsWith('http')) {
    // Spotify: convert ke search query dulu
    if (query.includes('spotify.com')) {
      try {
        if (playdl.is_expired?.()) await playdl.refreshToken?.();
        const sp = await playdl.spotify(query);
        const searchQuery = sp.type === 'track'
          ? `${sp.name} ${sp.artists?.[0]?.name ?? ''}`
          : sp.name;
        return await searchYouTube(searchQuery);
      } catch {
        throw new Error('Gagal baca link Spotify. Pastikan SPOTIFY credentials diset.');
      }
    }
    // YouTube / SoundCloud URL langsung
    return await getVideoInfo(query);
  }

  // Teks search — pakai yt-dlp search
  return new Promise((resolve, reject) => {
    const proc = spawn(YTDLP_PATH, [
      '--dump-json',
      '--no-playlist',
      '--no-warnings',
      '--js-runtimes', 'node',
      '-q',
      `ytsearch1:${query}`,
    ], { windowsHide: true });

    let output = '';
    proc.stdout.on('data', d => output += d.toString());
    proc.stderr.on('data', d => {
      const msg = d.toString().trim();
      if (msg) log.warn(`yt-dlp search: ${msg}`);
    });
    proc.on('close', () => {
      if (!output) return reject(new Error(`Tidak ditemukan hasil untuk: ${query}`));
      try {
        const info = JSON.parse(output);
        const cleanUrl = `https://www.youtube.com/watch?v=${info.id}`;
        log.info(`Ditemukan: ${info.title} (${cleanUrl})`);
        resolve({
          title: info.title,
          url: cleanUrl,
          duration: (info.duration ?? 0) * 1000,
          thumbnail: info.thumbnail,
        });
      } catch {
        reject(new Error('Gagal parse hasil pencarian'));
      }
    });
    proc.on('error', reject);
  });
}

// ─── Mood Map ─────────────────────────────────────────────────────────────────

const MOODS = {
  sad: 'sad emotional songs',
  happy: 'happy upbeat songs',
  galau: 'galau lagu indonesia sedih',
  chill: 'chill lofi music',
  hype: 'hype energetic songs',
  romantic: 'romantic love songs',
  focus: 'focus study music instrumental',
  angry: 'intense heavy music',
  nostalgia: 'nostalgia throwback 90s songs',
};

// ─── Lyrics ───────────────────────────────────────────────────────────────────

async function fetchLyrics(title) {
  if (!config.GENIUS_TOKEN) throw new Error('GENIUS_TOKEN belum diset di .env');

  const query = encodeURIComponent(title);
  const res = await fetch(`https://api.genius.com/search?q=${query}`, {
    headers: { Authorization: `Bearer ${config.GENIUS_TOKEN}` },
  });
  const data = await res.json();
  const hit = data?.response?.hits?.[0]?.result;
  if (!hit) throw new Error('Lirik tidak ditemukan untuk: ' + title);

  return {
    title: hit.full_title,
    url: hit.url,
  };
}

// ─── Reaction Handler ─────────────────────────────────────────────────────────

const REACTION_DEBOUNCE = new Map();

async function handleReaction(client, reaction, user) {
  const guild = reaction.message.guild;
  if (!guild) return;

  const state = guildStates.get(guild.id);
  if (!state?.npMessage || reaction.message.id !== state.npMessage.id) return;

  // Must be in same VC
  const member = await guild.members.fetch(user.id).catch(() => null);
  const botVC = guild.members.me?.voice?.channel;
  if (!member?.voice?.channel || member.voice.channel.id !== botVC?.id) return;

  // Debounce per user
  const now = Date.now();
  const last = REACTION_DEBOUNCE.get(user.id) ?? 0;
  if (now - last < 1500) return;
  REACTION_DEBOUNCE.set(user.id, now);

  const emoji = reaction.emoji.name;

  switch (emoji) {
    case '⏭️': state.player?.stop(); break;
    case '⏸️': state.player?.pause(); break;
    case '▶️': state.player?.unpause(); break;
    case '🔊':
      state.volume = Math.min(100, state.volume + 10);
      state.player?.state?.resource?.volume?.setVolumeLogarithmic(state.volume / 100);
      break;
    case '🔉':
      state.volume = Math.max(0, state.volume - 10);
      state.player?.state?.resource?.volume?.setVolumeLogarithmic(state.volume / 100);
      break;
  }

  // Remove the reaction (cleanup)
  try { await reaction.users.remove(user.id); } catch {}
}

// ─── Auto Disconnect ──────────────────────────────────────────────────────────

function checkIdleDisconnect(client) {
  for (const [guildId, state] of guildStates.entries()) {
    const connection = getVoiceConnection(guildId);
    if (!connection) { guildStates.delete(guildId); continue; }

    // No one in VC
    const channel = client.channels.cache.get(connection.joinConfig.channelId);
    if (channel) {
      const humans = channel.members?.filter(m => !m.user.bot).size ?? 0;
      if (humans === 0) { destroyState(guildId); continue; }
    }

    // Idle for 7 minutes
    const idle = state.player?.state?.status !== AudioPlayerStatus.Playing;
    if (idle && Date.now() - state.lastActivity > 7 * 60 * 1000) {
      destroyState(guildId);
    }
  }
}

// ─── Command Handler ──────────────────────────────────────────────────────────

async function handleCommand(client, message, command, args) {
  const { guild, channel } = message;
  const state = getState(guild.id);

  // Cooldown check for music commands
  const cooldownCmds = ['play', 'skip', 'pause', 'resume', 'volume', 'eq', 'filter'];
  if (cooldownCmds.includes(command) && isCooldown(state, message.author.id, command)) {
    return message.reply({ embeds: [errorEmbed('Pelan-pelan, tunggu cooldown!')] });
  }

  switch (command) {

    // ── .play ──────────────────────────────────────────────────────────────────
    case 'play':
    case 'p': {
      const validation = validateVC(message);
      if (!validation.ok) return message.reply({ embeds: [errorEmbed(validation.reason)] });

      const query = args.join(' ');
      if (!query) return message.reply({ embeds: [errorEmbed('Tulis judul atau URL lagu!')] });

      const searching = await message.reply({ embeds: [infoEmbed('🔍 Mencari...', `**${query}**`)] });

      try {
        const song = await searchYouTube(query);
        song.requester = message.author.username;

        // Connect if not connected
        if (!state.connection || state.connection.state.status === VoiceConnectionStatus.Destroyed) {
          setupPlayer(guild.id, channel);
          await connectToVC(validation.vc, guild.id);
          state.connection.subscribe(state.player);
        }

        if (state.player.state.status === AudioPlayerStatus.Playing || state.queue.length > 0) {
          state.queue.push(song);
          await searching.edit({ embeds: [successEmbed('➕ Ditambahkan ke Queue', `**${song.title}**\n⏱️ ${formatDuration(song.duration)}`)] });
        } else {
          state.queue.push(song);
          await searching.delete().catch(() => {});
          await playSong(guild.id, channel);
        }
      } catch (err) {
        await searching.edit({ embeds: [errorEmbed(err.message)] });
      }
      break;
    }

    // ── .playrandom ────────────────────────────────────────────────────────────
    case 'playrandom':
    case 'pr': {
      const validation = validateVC(message);
      if (!validation.ok) return message.reply({ embeds: [errorEmbed(validation.reason)] });

      const keyword = args.join(' ') || 'popular music';
      const msg = await message.reply({ embeds: [infoEmbed('🎲 Mencari lagu random...', keyword)] });

      try {
        const song = await searchYouTube(keyword);
        song.requester = message.author.username;

        if (!state.connection || state.connection.state.status === VoiceConnectionStatus.Destroyed) {
          setupPlayer(guild.id, channel);
          await connectToVC(validation.vc, guild.id);
          state.connection.subscribe(state.player);
        }

        state.queue.push(song);
        if (state.player.state.status !== AudioPlayerStatus.Playing && state.queue.length === 1) {
          await msg.delete().catch(() => {});
          await playSong(guild.id, channel);
        } else {
          await msg.edit({ embeds: [successEmbed('🎲 Random Song', `**${song.title}** ditambahkan ke queue!`)] });
        }
      } catch (err) {
        await msg.edit({ embeds: [errorEmbed(err.message)] });
      }
      break;
    }

    // ── .pause ─────────────────────────────────────────────────────────────────
    case 'pause': {
      if (!state.player) return message.reply({ embeds: [errorEmbed('Tidak ada lagu yang diputar.')] });
      state.player.pause();
      message.reply({ embeds: [successEmbed('⏸️ Dijeda', 'Musik telah dijeda.')] });
      break;
    }

    // ── .resume ────────────────────────────────────────────────────────────────
    case 'resume': {
      if (!state.player) return message.reply({ embeds: [errorEmbed('Tidak ada lagu yang diputar.')] });
      state.player.unpause();
      message.reply({ embeds: [successEmbed('▶️ Dilanjutkan', 'Musik dilanjutkan.')] });
      break;
    }

    // ── .skip ──────────────────────────────────────────────────────────────────
    case 'skip':
    case 's': {
      if (!state.currentSong) return message.reply({ embeds: [errorEmbed('Tidak ada lagu yang diputar.')] });
      const validation = validateVC(message);
      if (!validation.ok) return message.reply({ embeds: [errorEmbed(validation.reason)] });

      const vc = message.member.voice.channel;
      const humans = vc.members.filter(m => !m.user.bot).size;

      if (humans <= 1) {
        state.player.stop();
        message.reply({ embeds: [successEmbed('⏭️ Diskip', `Melanjutkan ke lagu berikutnya.`)] });
      } else {
        state.skipVotes.add(message.author.id);
        const needed = Math.ceil(humans * 0.5);
        if (state.skipVotes.size >= needed) {
          state.player.stop();
          message.reply({ embeds: [successEmbed('⏭️ Vote Skip', `Vote mencapai ${needed}. Lagu diskip!`)] });
        } else {
          message.reply({ embeds: [infoEmbed('🗳️ Vote Skip', `${state.skipVotes.size}/${needed} vote. Butuh ${needed - state.skipVotes.size} lagi.`)] });
        }
      }
      break;
    }

    // ── .skipto ────────────────────────────────────────────────────────────────
    case 'skipto': {
      const index = parseInt(args[0]) - 1;
      if (isNaN(index) || index < 0 || index >= state.queue.length) {
        return message.reply({ embeds: [errorEmbed('Index tidak valid.')] });
      }
      state.queue.splice(0, index);
      state.player.stop();
      message.reply({ embeds: [successEmbed('⏭️ Skip To', `Melewati ke lagu #${index + 1}`)] });
      break;
    }

    // ── .stop ──────────────────────────────────────────────────────────────────
    case 'stop': {
      state.queue = [];
      state.loop = 'off';
      state.currentSong = null;
      state.player?.stop(true);
      message.reply({ embeds: [successEmbed('⏹️ Dihentikan', 'Queue dikosongkan dan musik dihentikan.')] });
      break;
    }

    // ── .queue ─────────────────────────────────────────────────────────────────
    case 'queue':
    case 'q': {
      if (!state.currentSong && !state.queue.length) {
        return message.reply({ embeds: [infoEmbed('📋 Queue', 'Queue kosong.')] });
      }

      const lines = [];
      if (state.currentSong) lines.push(`**▶️ Now Playing:** ${state.currentSong.title}`);
      state.queue.slice(0, 15).forEach((s, i) => {
        lines.push(`**${i + 1}.** ${s.title} — ${formatDuration(s.duration)} [${s.requester}]`);
      });
      if (state.queue.length > 15) lines.push(`...dan ${state.queue.length - 15} lagu lagi`);

      message.reply({ embeds: [infoEmbed(`📋 Queue (${state.queue.length} lagu)`, lines.join('\n'))] });
      break;
    }

    // ── .np ────────────────────────────────────────────────────────────────────
    case 'np': {
      if (!state.currentSong) return message.reply({ embeds: [errorEmbed('Tidak ada lagu yang diputar.')] });

      const s = state.currentSong;
      const resource = state.player?.state?.resource;
      const elapsed = resource?.playbackDuration ?? 0;
      const bar = progressBar(elapsed, s.duration);

      const e = embed(0x5865f2)
        .setTitle('🎵 Now Playing')
        .setDescription(`**[${s.title}](${s.url})**\n\n${bar}\n\`${formatDuration(elapsed)} / ${formatDuration(s.duration)}\``)
        .addFields(
          { name: 'Requester', value: s.requester, inline: true },
          { name: 'Volume', value: `${state.volume}%`, inline: true },
          { name: 'Loop', value: state.loop, inline: true },
          { name: 'Filter', value: state.filter ?? 'none', inline: true },
          { name: 'EQ', value: state.eq, inline: true },
        );
      if (s.thumbnail) e.setThumbnail(s.thumbnail);
      message.reply({ embeds: [e] });
      break;
    }

    // ── .volume ────────────────────────────────────────────────────────────────
    case 'volume':
    case 'vol': {
      const vol = parseInt(args[0]);
      if (isNaN(vol) || vol < 0 || vol > 100) {
        return message.reply({ embeds: [errorEmbed('Volume harus antara 0–100.')] });
      }
      state.volume = vol;
      const resource = state.player?.state?.resource;
      resource?.volume?.setVolumeLogarithmic(vol / 100);
      message.reply({ embeds: [successEmbed('🔊 Volume', `Volume diset ke **${vol}%**`)] });
      break;
    }

    // ── .loop ──────────────────────────────────────────────────────────────────
    case 'loop': {
      const mode = args[0]?.toLowerCase();
      if (!['off', 'song', 'queue'].includes(mode)) {
        return message.reply({ embeds: [errorEmbed('Mode loop: `off`, `song`, `queue`')] });
      }
      state.loop = mode;
      message.reply({ embeds: [successEmbed('🔁 Loop', `Loop diset ke **${mode}**`)] });
      break;
    }

    // ── .shuffle ───────────────────────────────────────────────────────────────
    case 'shuffle': {
      if (!state.queue.length) return message.reply({ embeds: [errorEmbed('Queue kosong.')] });
      for (let i = state.queue.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [state.queue[i], state.queue[j]] = [state.queue[j], state.queue[i]];
      }
      message.reply({ embeds: [successEmbed('🔀 Shuffle', 'Queue diacak!')] });
      break;
    }

    // ── .clear ─────────────────────────────────────────────────────────────────
    case 'clear': {
      const count = state.queue.length;
      state.queue = [];
      message.reply({ embeds: [successEmbed('🗑️ Cleared', `${count} lagu dihapus dari queue.`)] });
      break;
    }

    // ── .remove ────────────────────────────────────────────────────────────────
    case 'remove':
    case 'rm': {
      const idx = parseInt(args[0]) - 1;
      if (isNaN(idx) || idx < 0 || idx >= state.queue.length) {
        return message.reply({ embeds: [errorEmbed('Index tidak valid.')] });
      }
      const removed = state.queue.splice(idx, 1)[0];
      message.reply({ embeds: [successEmbed('🗑️ Dihapus', `**${removed.title}** dihapus dari queue.`)] });
      break;
    }

    // ── .leave ─────────────────────────────────────────────────────────────────
    case 'leave':
    case 'dc': {
      destroyState(guild.id);
      message.reply({ embeds: [successEmbed('👋 Bye!', 'Bot keluar dari Voice Channel.')] });
      break;
    }

    // ── .eq ────────────────────────────────────────────────────────────────────
    case 'eq': {
      const mode = args[0]?.toLowerCase();
      if (!['bass', 'normal', 'high'].includes(mode)) {
        return message.reply({ embeds: [errorEmbed('EQ preset: `bass`, `normal`, `high`')] });
      }
      state.eq = mode;
      message.reply({ embeds: [successEmbed('🎚️ EQ', `Equalizer diset ke **${mode}**. Berlaku di lagu berikutnya.`)] });
      break;
    }

    // ── .filter ────────────────────────────────────────────────────────────────
    case 'filter': {
      const f = args[0]?.toLowerCase();
      if (!['nightcore', 'vaporwave', 'bassboost', 'off'].includes(f)) {
        return message.reply({ embeds: [errorEmbed('Filter: `nightcore`, `vaporwave`, `bassboost`, `off`')] });
      }
      state.filter = f === 'off' ? null : f;
      message.reply({ embeds: [successEmbed('🎛️ Filter', `Filter **${f}** diaktifkan. Berlaku di lagu berikutnya.`)] });
      break;
    }

    // ── .mood ──────────────────────────────────────────────────────────────────
    case 'mood': {
      const validation = validateVC(message);
      if (!validation.ok) return message.reply({ embeds: [errorEmbed(validation.reason)] });

      const mood = args[0]?.toLowerCase();
      const keyword = MOODS[mood] ?? `${mood} music`;
      const msg = await message.reply({ embeds: [infoEmbed(`🎭 Mood: ${mood}`, `Mencari lagu untuk mood **${mood}**...`)] });

      try {
        const song = await searchYouTube(keyword);
        song.requester = message.author.username;

        if (!state.connection || state.connection.state.status === VoiceConnectionStatus.Destroyed) {
          setupPlayer(guild.id, channel);
          await connectToVC(validation.vc, guild.id);
          state.connection.subscribe(state.player);
        }

        state.queue.push(song);
        if (state.player.state.status !== AudioPlayerStatus.Playing && state.queue.length === 1) {
          await msg.delete().catch(() => {});
          await playSong(guild.id, channel);
        } else {
          await msg.edit({ embeds: [successEmbed(`🎭 Mood: ${mood}`, `**${song.title}** ditambahkan!`)] });
        }
      } catch (err) {
        await msg.edit({ embeds: [errorEmbed(err.message)] });
      }
      break;
    }

    // ── .lyrics ────────────────────────────────────────────────────────────────
    case 'lyrics': {
      if (!state.currentSong) return message.reply({ embeds: [errorEmbed('Tidak ada lagu yang diputar.')] });
      const msg = await message.reply({ embeds: [infoEmbed('🎤 Mencari lirik...', state.currentSong.title)] });
      try {
        const result = await fetchLyrics(state.currentSong.title);
        await msg.edit({
          embeds: [
            infoEmbed(`🎤 ${result.title}`, `Lirik tidak bisa ditampilkan langsung, tapi kamu bisa lihat di:\n[→ Genius](${result.url})`),
          ],
        });
      } catch (err) {
        await msg.edit({ embeds: [errorEmbed(err.message)] });
      }
      break;
    }

    // ── .history ───────────────────────────────────────────────────────────────
    case 'history':
    case 'hist': {
      if (!state.history.length) return message.reply({ embeds: [infoEmbed('📜 History', 'Belum ada lagu yang diputar.')] });
      const lines = state.history.map((s, i) => `**${i + 1}.** ${s.title} [${s.requester}]`);
      message.reply({ embeds: [infoEmbed('📜 Riwayat Lagu', lines.join('\n'))] });
      break;
    }

    // ── Default ────────────────────────────────────────────────────────────────
    default:
      break;
  }
}

module.exports = { handleCommand, handleReaction, checkIdleDisconnect };
