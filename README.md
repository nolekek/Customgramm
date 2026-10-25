# ⚡ OpenCustom Telegram Desktop

> Fully customizable, modern Telegram Desktop client built on **Tauri 2.0 + Rust (`tg-core` native TDLib)** with an open HTML/CSS/Template theming engine, AI-powered theme generation, Ghost Mode, and local AI assistance.

[![Platform: Windows | Linux | macOS](https://img.shields.io/badge/Platform-Windows%20%7C%20Linux%20%7C%20macOS-blue.svg)]()
[![Rust 2021](https://img.shields.io/badge/Rust-1.75%2B-orange.svg)]()
[![Tauri 2.0](https://img.shields.io/badge/Tauri-2.0-24C8D8.svg)]()
[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)

---

## 🌟 Key Highlights

- **🎨 Open HTML/CSS Theming Engine**:
  - Themes are genuine HTML & CSS! Any neural network (Claude, ChatGPT, Gemini) can design full themes without learning obscure proprietary configuration languages.
  - Deep customization via safe HTML5 `<template>` overrides (`message.html`, `chat_item.html`, `header.html`, `input.html`).
  - Standalone `preview.html` included in each theme: open it in any browser or feed it to an LLM as visual context.
  - **Live Hot-Reload & In-App Code Editor**: Tweak CSS or HTML templates on the fly and see them apply instantly with zero app restart.
  - **Drag-and-Drop ZIP Theme Import**: Drop any theme `.zip` archive straight into the client window to install and activate it immediately.
- **👻 Ghost Mode (Enhanced Privacy)**:
  - Read receipts suppression: read incoming messages without sending blue checkmarks (`viewMessages` suppression).
  - Typing indicator suppression: compose messages without broadcasting "typing..." status.
  - Quick toggle button right in the top bar.
- **✨ Built-in AI Assistant**:
  - Direct client-side connection using your own API keys (OpenAI-compatible endpoints, Groq, DeepSeek, Local Ollama, or Google Gemini).
  - 1-Click Chat Summarization: Summarize the last 25 messages in any active conversation or channel.
  - Inline Message Translation: Translate foreign messages into your native tongue.
  - Smart Reply Drafting: Generate contextual reply ideas directly in the message composer.
- **🔐 Telegram Authentication & Account Management**:
  - **Instant QR Code Login**: Log in by scanning the displayed QR code with your mobile Telegram app (Settings &rarr; Devices &rarr; Link Desktop Device).
  - **Interactive Account Tab**: Click the profile icon (`👤`) to inspect your active user profile (display name, username, phone number, Telegram ID, status, and safe session termination).
  - Full phone number + SMS/Telegram code and 2FA cloud password authorization supported.
- **🚀 Native TDLib Performance**:
  - Built on an autonomous, asynchronous Rust engine (`tg-core`) interfacing dynamically with official Telegram Database Library (`tdjson`).
  - Fast startup, tiny memory footprint compared to Electron, and full offline-first local SQLite caching.
  - Portable storage mode supported out of the box (`./.data`).
- **📱 Android & Cross-Platform Support**:
  - Android arm64 release APK packaging via Tauri 2.0 + Gradle.
  - Portable distribution packages for Windows x64, Linux x64, and Android arm64.

---

## 🎭 Included Starter Themes

1. **`tokyo-night`**:
   - The iconic Tokyo Night palette inspired by the original TelegramTui project.
   - Deep midnight navy, calm cyan, soft lavender, and electric blue accents.
2. **`modern-dark`**:
   - Clean, ergonomic modern Telegram Desktop aesthetic.
   - Smooth 16px rounded bubbles, high-contrast typography, and familiar Telegram purple highlights.
3. **`cyberpunk-glass`**:
   - Showcase of **Deep Template Customization**:
   - Sci-Fi HUD layouts with custom header tags and hexagonal avatars.
   - Translucent glassmorphism with backdrop blur (`backdrop-filter: blur(20px)`), neon cyan and magenta borders, and scanline animations.

---

## 🤖 Generating Themes with AI (ChatGPT / Claude / Gemini)

You can generate any custom theme by copying the prompt from [AI_THEME_PROMPT.md](AI_THEME_PROMPT.md) or clicking the **"📋 Copy AI Prompt Guide"** button inside the in-app Theme Manager (`🎨`).

### Theme Package Structure:
```
themes/<theme-id>/
├── theme.json            # Theme metadata
├── style.css             # CSS variables & custom CSS overrides
├── templates/            # HTML5 component templates
│   ├── message.html      # Message bubble layout
│   ├── chat_item.html    # Sidebar chat row
│   ├── header.html       # Active chat header
│   └── input.html        # Message composer
├── preview.html          # Standalone browser mockup
└── assets/               # (Optional) Custom icons, fonts, backgrounds
```

---

## 🛠️ Development & Building from Source

### Prerequisites
- [Rust toolchain](https://rustup.rs/) (1.75+)
- [Node.js](https://nodejs.org/) (v18+)
- Native TDLib shared library (`tdjson.dll` on Windows, `libtdjson.so` on Linux) placed in `./.data` or system library path.

### Quick Start:

1. **Install Frontend Dependencies**:
   ```bash
   npm install
   ```

2. **Run in Development Mode (Vite + Tauri Dev)**:
   ```bash
   npm run dev
   # Or launch with Tauri desktop window:
   npx @tauri-apps/cli dev
   ```

3. **Build Standalone Desktop Binary**:
   ```bash
   npm run build
   npx @tauri-apps/cli build
   ```
   The compiled executable will be placed in `src-tauri/target/release/`.

---

## 📄 License

MIT OR Apache-2.0 License.
