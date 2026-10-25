# 🤖 AI Prompt Guide: Creating Custom Themes for OpenCustom Telegram

This guide provides instructions and complete specifications for AI models (ChatGPT, Claude, Gemini, DeepSeek, etc.) to generate fully functional themes for the **OpenCustom Telegram Desktop Client**.

---

## 🎨 Theme Architecture Overview

An OpenCustom Telegram theme is a folder or ZIP archive containing:
```
themes/<theme-id>/
├── theme.json            # Metadata (id, name, author, version, description)
├── style.css             # CSS variables & custom CSS overrides (animations, blur, fonts)
├── templates/            # HTML5 <template> overrides for UI components
│   ├── message.html      # Message bubble layout
│   ├── chat_item.html    # Chat item in sidebar
│   ├── header.html       # Active chat header
│   └── input.html        # Message composer
├── preview.html          # Standalone mockup page for testing in any browser
└── assets/               # (Optional) Icons, backgrounds, fonts, sounds
```

---

## 📄 1. `theme.json` Specification

```json
{
  "id": "my-custom-theme",
  "name": "My Custom Theme",
  "author": "Your Name / AI",
  "version": "1.0.0",
  "description": "A stylish theme generated for OpenCustom Telegram",
  "engine_version": "1.0",
  "tags": ["dark", "minimal", "neon"]
}
```

---

## 🎨 2. `style.css` Specification

Every theme must define standard CSS custom properties under `:root`, and may add any custom CSS rules (animations, glassmorphism, fonts, pseudo-elements):

```css
:root {
  /* Colors */
  --tg-bg-primary: #1a1b26;         /* Main chat & app background */
  --tg-bg-secondary: #16161e;       /* Sidebar background */
  --tg-bg-surface: #24283b;         /* Cards, modals, search inputs */
  --tg-bg-hover: #292e42;           /* Hovered chat items and buttons */
  --tg-bg-active: #3b4261;          /* Active chat selection */

  /* Text colors */
  --tg-text-primary: #c0caf5;       /* Main readable text */
  --tg-text-secondary: #7aa2f7;     /* Subtitles, timestamps, muted labels */
  --tg-text-muted: #565f89;         /* Placeholders and inactive icons */

  /* Accents & Highlights */
  --tg-accent: #7aa2f7;             /* Primary action buttons, badges, highlights */
  --tg-accent-hover: #89b4fa;       /* Hover state for accent buttons */
  --tg-accent-text: #15161e;        /* Text on accent buttons */

  /* Message Bubbles */
  --tg-bubble-out-bg: #2f354a;      /* Outgoing message background */
  --tg-bubble-out-text: #c0caf5;    /* Outgoing message text */
  --tg-bubble-in-bg: #24283b;       /* Incoming message background */
  --tg-bubble-in-text: #c0caf5;     /* Incoming message text */
  --tg-bubble-radius: 12px;         /* Corner rounding for messages */

  /* Borders & Shadows */
  --tg-border: #292e42;             /* Subtle dividing borders */
  --tg-border-active: #7aa2f7;      /* Focus / active borders */
  --tg-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);

  /* Fonts */
  --tg-font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
  --tg-font-size-base: 14px;
}

/* Custom CSS overrides: you can write any valid CSS3 rules below! */
.glass-panel {
  backdrop-filter: blur(12px);
  -webkit-backdrop-filter: blur(12px);
  background: rgba(26, 27, 38, 0.75);
}
```

---

## 🧩 3. `templates/` Specification (Deep Customization)

Templates use safe interpolation tokens `{{token_name}}` and declarative action triggers `data-action="..."`. 

> [!IMPORTANT]
> **Safety Rule**: Themes must NEVER contain `<script>` tags. Dynamic interactivity is hooked using `data-action` attributes.

### A. `templates/message.html`
Interpolated tokens:
- `{{id}}`: Message ID number
- `{{sender}}`: Sender display name
- `{{text}}`: Formatted message body
- `{{time}}`: Timestamp (e.g., "14:32")
- `{{direction}}`: `"incoming"` or `"outgoing"`
- `{{status_icon}}`: Status checkmark (✓ or ✓✓)
- `{{reply_preview}}`: Quoted reply snippet (or empty string if none)
- `{{media_html}}`: Rendered image or audio attachment (if present)

Allowed `data-action` triggers:
- `data-action="reply"`: Trigger reply to this message
- `data-action="edit"`: Edit this message (if outgoing)
- `data-action="delete"`: Delete this message
- `data-action="ai-summarize"`: Ask AI to summarize
- `data-action="ai-translate"`: Ask AI to translate

**Example `templates/message.html`**:
```html
<div class="msg-container msg-{{direction}}" data-msg-id="{{id}}">
  <div class="msg-bubble">
    {{reply_preview}}
    <div class="msg-header">
      <span class="msg-sender">{{sender}}</span>
    </div>
    {{media_html}}
    <div class="msg-content">{{text}}</div>
    <div class="msg-footer">
      <span class="msg-time">{{time}}</span>
      <span class="msg-status">{{status_icon}}</span>
      <div class="msg-actions">
        <button class="msg-btn" data-action="reply" title="Reply">↩</button>
        <button class="msg-btn" data-action="ai-translate" title="Translate">🌐</button>
      </div>
    </div>
  </div>
</div>
```

---

### B. `templates/chat_item.html`
Interpolated tokens:
- `{{id}}`: Chat ID number
- `{{title}}`: Chat name or user title
- `{{last_message}}`: Snippet of last message
- `{{time}}`: Last message timestamp
- `{{unread_count}}`: Number of unread messages (or 0)
- `{{unread_badge_html}}`: Rendered unread pill badge (or empty if 0)
- `{{avatar_letter}}`: First letter of chat title for avatar fallback
- `{{avatar_url}}`: Photo url (if cached)
- `{{active_class}}`: `"active"` if currently open, else empty

**Example `templates/chat_item.html`**:
```html
<div class="chat-row {{active_class}}" data-chat-id="{{id}}" data-action="select-chat">
  <div class="chat-avatar">
    <span>{{avatar_letter}}</span>
  </div>
  <div class="chat-info">
    <div class="chat-top-row">
      <span class="chat-title">{{title}}</span>
      <span class="chat-time">{{time}}</span>
    </div>
    <div class="chat-bottom-row">
      <span class="chat-snippet">{{last_message}}</span>
      {{unread_badge_html}}
    </div>
  </div>
</div>
```

---

### C. `templates/header.html`
Interpolated tokens:
- `{{title}}`: Active chat title
- `{{status}}`: Online status or subscriber count (e.g., "online", "1,240 members")
- `{{avatar_letter}}`: Avatar letter fallback

**Example `templates/header.html`**:
```html
<div class="chat-header-bar">
  <div class="chat-header-info">
    <div class="chat-header-avatar">{{avatar_letter}}</div>
    <div class="chat-header-text">
      <h2 class="chat-header-title">{{title}}</h2>
      <span class="chat-header-status">{{status}}</span>
    </div>
  </div>
  <div class="chat-header-actions">
    <button class="btn-header" data-action="ai-summarize-chat" title="Summarize conversation with AI">✨ Summarize</button>
    <button class="btn-header" data-action="toggle-ghost" title="Toggle Ghost Mode">👻 Ghost</button>
  </div>
</div>
```

---

### D. `templates/input.html`
Interpolated tokens:
- `{{placeholder}}`: "Write a message..."
- `{{reply_banner_html}}`: Active reply banner if replying to a message

**Example `templates/input.html`**:
```html
<div class="chat-input-bar">
  {{reply_banner_html}}
  <div class="input-row">
    <button class="btn-input-tool" data-action="attach-file" title="Attach file">📎</button>
    <textarea class="chat-textarea" placeholder="{{placeholder}}" rows="1"></textarea>
    <button class="btn-input-tool" data-action="ai-assist" title="AI Draft Assistant">✨</button>
    <button class="btn-send" data-action="send-message" title="Send (Enter)">➤</button>
  </div>
</div>
```

---

## 🧪 4. Standalone `preview.html`

The `preview.html` file is a standalone webpage that imports `style.css` and displays dummy chats and messages using the theme's templates. You can open it in any web browser to inspect the visual look of the theme immediately!

---

## 🤖 AI Generation Prompt Template (Copy-Paste to ChatGPT / Claude / Gemini)

```text
You are an expert UI/UX designer and web developer.
Create a complete custom theme package for "OpenCustom Telegram" based on the following theme concept:
[INSERT YOUR THEME IDEA HERE, e.g., "Synthwave 1984 with purple grid, neon pink glowing borders, and retro monospace font"]

Generate the following files strictly according to the OpenCustom Telegram theme specification:
1. theme.json (id, name, author, version, description)
2. style.css (Complete CSS with all required CSS variables and custom rules/animations)
3. templates/message.html (Custom bubble layout with tokens {{sender}}, {{text}}, {{time}}, {{direction}}, {{status_icon}})
4. templates/chat_item.html (Custom chat row layout)
5. templates/header.html (Custom chat header)
6. templates/input.html (Custom composer bar)
7. preview.html (Standalone browser preview testing all styles)

Do not use <script> tags. Use standard BEM-like CSS classes and CSS variables. Make sure the layout is responsive, readable, and visually stunning.
```
