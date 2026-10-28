# ⚡ Customgramm

> Modern, rock-solid Telegram Desktop Client built from scratch on **Tauri v2 + Rust + Official TDLib** with **React 19 + TypeScript + Vite** and an open, semantic theming engine.

---

## 🌟 Key Highlights

* **100% Official TDLib (`tdjson`)**:
  * Uncompromising protocol stability, security, and performance directly from Telegram's core C++ engine.
  * Encrypted offline SQLite database with automatic caching of chats, messages, files, and avatars.
  * Native MTProto 2.0 connection management, DC routing, and automatic re-authentication.

* **Core Telegram Functionality First**:
  * **Authentication**: Instant dynamic QR code login (scan with mobile Telegram) or Phone Number + SMS/Telegram code + 2FA Cloud Password.
  * **Chat Management**: Real-time chat list, official chat folders (All, Personal, Groups, Channels), and search.
  * **Rich Messaging**: Full support for Telegram TL entities (bold, italic, code, pre, spoilers, links, blockquotes), replies, edit/delete, photos, voice notes, stickers, and documents.
  * **Performance**: Designed for 60+ FPS virtualization, instantaneous startup, and minimal memory footprint.

* **Foundational Design Architecture**:
  * **Semantic Design Tokens (CSS Variables)**: Surfaces, typography, accents, and message bubbles are fully decoupled into CSS variables (`var(--bg-primary)`, `var(--bubble-in-bg)`, etc.).
  * **Data-Attribute Selectors**: Components use clean `data-role` and `data-outgoing` attributes, allowing any theme or custom stylesheet to target elements without refactoring JSX.
  * **Custom Frameless Titlebar**: Seamless window chrome matching the active theme.
  * **Multi-Platform & Portable**: Automatic OS data storage (`%APPDATA%`, `~/.config`) with built-in Portable Mode (`data/` directory).

---

## 🚀 Quick Start

### 1. Prerequisites
* [Node.js](https://nodejs.org/) (v18+)
* [Rust](https://rustup.rs/) (1.75+)

### 2. Download Official TDLib Binaries
Run the cross-platform fetch script (downloads prebuilt official `tdjson` binaries into `bin/`):
```bash
npm run fetch:tdlib
```

### 3. Install Dependencies
```bash
npm install
```

### 4. Run Development Mode
```bash
# Frontend dev server:
npm run dev

# Full Tauri Desktop application:
npm run desktop
```

### 5. Build Standalone Desktop Binary
```bash
npm run build
npx tauri build
```
