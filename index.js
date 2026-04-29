require('dotenv').config();
const { Client, GatewayIntentBits, Partials } = require('discord.js');
const { handleCommand, handleReaction, checkIdleDisconnect } = require('./music');

// --- 1. LOGGER HELPER (Biar terminal berwarna) ---
const log = {
    info: (msg) => console.log(`\x1b[36m[INFO]\x1b[0m ${msg}`),
    success: (msg) => console.log(`\x1b[32m[SUCCESS]\x1b[0m ${msg}`),
    warn: (msg) => console.log(`\x1b[33m[WARN]\x1b[0m ${msg}`),
    error: (msg) => console.error(`\x1b[31m[ERROR]\x1b[0m ${msg}`),
    cmd: (user, cmd, guild) => console.log(`\x1b[35m[CMD]\x1b[0m \x1b[33m${user}\x1b[0m used \x1b[32m${cmd}\x1b[0m in \x1b[34m${guild}\x1b[0m`)
};

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildVoiceStates,
        GatewayIntentBits.GuildMessageReactions,
    ],
    partials: [Partials.Message, Partials.Channel, Partials.Reaction],
});

const PREFIX = process.env.PREFIX || '.';

// --- 2. LOG SAAT BOT ONLINE ---
client.once('clientReady', () => {
    console.clear();
    log.success(`------------------------------------------`);
    log.success(`Bot Berhasil Login!`);
    log.success(`Username : ${client.user.tag}`);
    log.success(`ID       : ${client.user.id}`);
    log.success(`Prefix   : ${PREFIX}`);
    log.success(`Servers  : ${client.guilds.cache.size} Guilds`);
    log.success(`------------------------------------------`);
    
    client.user.setActivity(`${PREFIX}help | Music Bot`, { type: 2 });

    // Cek idle setiap 60 detik
    setInterval(() => {
        checkIdleDisconnect(client);
    }, 60_000);
});

// --- 3. LOG SAAT ADA PESAN / COMMAND ---
client.on('messageCreate', async (message) => {
    if (message.author.bot || !message.guild) return;

    // Log setiap chat masuk (opsional, kalau berisik bisa dihapus)
    // console.log(`[CHAT] ${message.author.tag}: ${message.content}`);

    if (!message.content.startsWith(PREFIX)) return;

    const args = message.content.slice(PREFIX.length).trim().split(/ +/);
    const command = args.shift().toLowerCase();

    // Log command yang dipanggil
    log.cmd(message.author.tag, command, message.guild.name);

    try {
        await handleCommand(client, message, command, args);
    } catch (err) {
        log.error(`Gagal eksekusi command: ${command}`);
        console.error(err);
        message.reply('❌ Terjadi kesalahan saat menjalankan perintah tersebut.');
    }
});

// --- 4. LOG REAKSI ---
client.on('messageReactionAdd', async (reaction, user) => {
    if (user.bot) return;
    log.info(`Reaction ${reaction.emoji.name} by ${user.tag}`);
    
    if (reaction.partial) {
        try { await reaction.fetch(); } catch (err) { 
            log.error('Gagal fetch reaction partial');
            return; 
        }
    }
    await handleReaction(client, reaction, user);
});

// --- 5. SYSTEM ERROR CATCHER (Biar bot gak langsung mati kalau error) ---
process.on('unhandledRejection', (reason, promise) => {
    log.error('--- UNHANDLED REJECTION ---');
    console.error(reason);
});

process.on('uncaughtException', (err, origin) => {
    log.error('--- UNCAUGHT EXCEPTION ---');
    console.error(err);
});

const { generateDependencyReport } = require('@discordjs/voice');
console.log(generateDependencyReport());

// Login
log.info('Sedang mencoba menghubungkan ke Discord...');
client.login(process.env.TOKEN).catch(err => {
    log.error('Gagal login! Periksa TOKEN di file .env kamu.');
    console.error(err);
});