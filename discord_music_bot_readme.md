# 🎵 Advanced Discord Music Bot

A powerful, feature-rich Discord music bot built with Node.js, designed for high performance, stability, and a smooth user experience. Supports multi-source playback, advanced queue management, audio filters, and interactive controls.

---

## ✨ Features

- 🎶 Play music from YouTube, Spotify, and URLs
- 📋 Advanced queue system (shuffle, remove, clear, skip-to)
- 🔁 Loop modes (song / queue / off)
- 🤖 Autoplay when queue ends
- 🎛️ Volume control, EQ presets, and audio filters
- 🎭 Mood-based music playback
- 🎲 Random song generator
- 🗳️ Vote-based skip system
- 📜 Playback history tracking
- 🎤 Lyrics search (Genius integration)
- ⚡ Reaction-based controls (skip, pause, resume, volume)
- 📴 Auto-disconnect when idle or empty VC
- 🛡️ Cooldown & error handling system
- 🎨 Clean, colorized logging

---

## 📦 Requirements

Make sure you have the following installed:

- Node.js (v18 or higher recommended)
- npm or yarn
- Discord Bot Token
- yt-dlp executable (placed in project root)

Optional:
- Spotify API credentials (for Spotify support)
- Genius API token (for lyrics feature)

---

## 🚀 Installation

### 1. Clone Repository

```bash
git clone https://github.com/your-username/your-repo-name.git
cd your-repo-name
```

### 2. Install Dependencies

```bash
npm install
```

### 3. Add yt-dlp

Download yt-dlp and place it in your project root directory:

- Windows: `yt-dlp.exe`
- Linux/Mac: `yt-dlp`

Make sure it is executable.

---

## ⚙️ Environment Setup (.env)

Create a `.env` file in the root directory and configure it like this:

```env
TOKEN=your_discord_bot_token
PREFIX=.
DEFAULT_VOLUME=50

# Spotify (optional)
SPOTIFY_CLIENT_ID=your_spotify_client_id
SPOTIFY_CLIENT_SECRET=your_spotify_client_secret
SPOTIFY_REFRESH_TOKEN=your_refresh_token

# Genius (optional for lyrics)
GENIUS_TOKEN=your_genius_token
```

---

## ▶️ Running the Bot

```bash
node index.js
```

If everything is set up correctly, you will see a success log in the terminal.

---

## 🧠 Commands

### 🎶 Music
- `.play <query/url>` — Play music
- `.p <query>` — Shortcut play
- `.playrandom` — Play random song

### ⏯️ Controls
- `.pause` — Pause music
- `.resume` — Resume music
- `.skip` — Skip current song (vote system)
- `.skipto <number>` — Skip to specific queue index
- `.stop` — Stop and clear queue

### 📋 Queue
- `.queue` — Show queue
- `.shuffle` — Shuffle queue
- `.remove <index>` — Remove song
- `.clear` — Clear queue

### 🔊 Audio
- `.volume <0-100>` — Set volume
- `.loop <off/song/queue>` — Loop mode
- `.eq <bass/normal/high>` — Equalizer preset
- `.filter <nightcore/vaporwave/bassboost/off>` — Audio filter

### 🎭 Extras
- `.mood <type>` — Play based on mood
- `.lyrics` — Get song lyrics
- `.history` — Show history
- `.np` — Now playing

### 🔌 Utility
- `.leave` / `.dc` — Disconnect bot

---

## ⚡ How It Works

- Uses yt-dlp for extracting and streaming audio
- Buffers audio before playback to reduce lag
- Manages per-server state using in-memory Map
- Uses Discord voice connection lifecycle handling
- Reaction system allows real-time control

---

## 📁 Project Structure

```
.
├── index.js        # Main bot entry point
├── music.js        # Core music system & commands
├── yt-dlp.exe      # Media downloader
├── .env            # Environment variables
├── package.json
```

---

## 🛠️ Troubleshooting

### Bot not playing music
- Ensure bot is in a voice channel
- Check yt-dlp is working properly

### Login failed
- Verify your TOKEN in `.env`

### No Spotify support
- Make sure Spotify credentials are set

---

## 💡 Tips

- Use a VPS for 24/7 uptime
- Keep yt-dlp updated regularly
- Monitor logs for debugging

---

## 📜 License

This project is open-source and free to use.

---

## ❤️ Credits

Built with Node.js and Discord API.

---

> Feel free to fork, modify, and improve this bot 🚀

