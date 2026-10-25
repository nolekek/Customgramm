import QRCode from 'qrcode';
import { api } from './api';
import { themeEngine } from './theme-engine';
import { icons } from './icons';
import type {
  Chat,
  Message,
  ThemeMeta,
  GhostSettings,
  User,
  AuthState,
  ChatFolder,
  MessageContent,
  ProxyConfig,
} from './types';

// ---------------------------------------------------------------------------
// 7-Color Gradient Avatar Palette (Telegram Native Aesthetics)
// ---------------------------------------------------------------------------
const AVATAR_GRADIENTS = [
  ['#ff885e', '#ff516a'], // Coral Red
  ['#ffcd6a', '#ffa85c'], // Amber Orange
  ['#82ecc8', '#28c792'], // Emerald Green
  ['#6dc9f7', '#3298dc'], // Sky Blue
  ['#a288f7', '#6c5ce7'], // Royal Violet
  ['#f382c3', '#e056fd'], // Magenta Pink
  ['#70a1ff', '#2f3542'], // Slate Navy
];

function getAvatarGradient(id: number | string | any): string {
  let num = 0;
  if (typeof id === 'number') {
    num = Math.abs(id);
  } else if (typeof id === 'object' && id !== null) {
    const raw = (id as any)[0] ?? (id as any)['0'] ?? 1;
    num = Math.abs(Number(raw) || 1);
  } else {
    const str = String(id || '');
    for (let i = 0; i < str.length; i++) {
      num += str.charCodeAt(i);
    }
  }
  const pair = AVATAR_GRADIENTS[num % AVATAR_GRADIENTS.length];
  return `linear-gradient(135deg, ${pair[0]}, ${pair[1]})`;
}

// ---------------------------------------------------------------------------
// Avatar Manager (Handles Caching & Asynchronous Base64 Photo Loading)
// ---------------------------------------------------------------------------
class AvatarManager {
  private base64Cache = new Map<string, string>();
  private pending = new Set<string>();

  public getAvatarData(entity: {
    id: number | any;
    title?: string;
    first_name?: string;
    photo_path?: string;
  }): { initials: string; gradient: string; innerHtml: string; photoPath: string } {
    const name = entity.title || entity.first_name || 'Telegram';
    const initials = name.trim().charAt(0).toUpperCase() || '?';
    const gradient = getAvatarGradient(entity.id);
    const photoPath = entity.photo_path || '';

    if (photoPath) {
      const cached = this.base64Cache.get(photoPath);
      if (cached) {
        return {
          initials,
          gradient,
          innerHtml: `<img class="avatar-img" src="${cached}" alt="${initials}">`,
          photoPath,
        };
      }
      this.fetchPhoto(photoPath);
    }

    return {
      initials,
      gradient,
      innerHtml: `<span>${initials}</span>`,
      photoPath,
    };
  }

  private async fetchPhoto(path: string) {
    if (this.pending.has(path)) return;
    this.pending.add(path);
    try {
      const b64 = await api.getFileBase64(path);
      this.base64Cache.set(path, b64);
      // Update any DOM elements waiting for this photo
      document.querySelectorAll(`[data-avatar-path="${path}"]`).forEach((el) => {
        el.innerHTML = `<img class="avatar-img" src="${b64}">`;
      });
    } catch {
      // Ignored: falls back to initials
    } finally {
      this.pending.delete(path);
    }
  }
}

// ---------------------------------------------------------------------------
// Text Formatting & Markdown Helper
// ---------------------------------------------------------------------------
export function extractMessageText(content: MessageContent): string {
  if (!content) return '';
  if (typeof content === 'string') return content;

  if ('Text' in content && content.Text) {
    return content.Text.text || '';
  }
  if ('Photo' in content && content.Photo) {
    return content.Photo.caption ? `📷 ${content.Photo.caption}` : '📷 Photo';
  }
  if ('Document' in content && content.Document) {
    return content.Document.file_name
      ? `📄 ${content.Document.file_name}`
      : content.Document.caption || '📄 Document';
  }
  if ('Voice' in content && content.Voice) {
    return content.Voice.caption ? `🎤 ${content.Voice.caption}` : '🎤 Voice message';
  }
  if ('Sticker' in content && content.Sticker) {
    return `${content.Sticker.emoji || '🎨'} Sticker`;
  }
  if ('Video' in content && content.Video) {
    return content.Video.caption ? `🎥 ${content.Video.caption}` : '🎥 Video';
  }
  if ((content as any).text) return (content as any).text;
  if ((content as any).caption) return (content as any).caption;
  return '💬 Message';
}

export function formatMessageText(text: string): string {
  if (!text) return '';
  let escaped = text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');

  // Code blocks ```code```
  escaped = escaped.replace(/```([\s\S]*?)```/g, '<pre class="msg-pre"><code>$1</code></pre>');
  // Inline code `code`
  escaped = escaped.replace(/`([^`]+)`/g, '<code class="msg-code">$1</code>');
  // Bold **text** or *text*
  escaped = escaped.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  escaped = escaped.replace(/(^|[^\*])\*([^\*]+)\*([^\*]|$)/g, '$1<strong>$2</strong>$3');
  // Italic __text__ or _text_
  escaped = escaped.replace(/__([^_]+)__/g, '<em>$1</em>');
  escaped = escaped.replace(/(^|[^_])_([^_]+)_([^_]|$)/g, '$1<em>$2</em>$3');
  // Strikethrough ~~text~~
  escaped = escaped.replace(/~~([^~]+)~~/g, '<del>$1</del>');
  // URLs: https://...
  escaped = escaped.replace(
    /(https?:\/\/[^\s<]+)/g,
    '<a href="$1" target="_blank" rel="noopener noreferrer" class="msg-link">$1</a>'
  );
  // Newlines to <br>
  escaped = escaped.replace(/\n/g, '<br>');

  return escaped;
}

// ---------------------------------------------------------------------------
// Main Application Controller
// ---------------------------------------------------------------------------
class OpenCustomApp {
  private chats: Chat[] = [];
  private chatFolders: ChatFolder[] = [];
  private activeChatId: number | null = null;
  private activeChatMessages: Message[] = [];
  private currentFilter: string = 'all';
  private searchQuery: string = '';
  private replyingToMsg: Message | null = null;
  private editingMsg: Message | null = null;
  private ghostSettings: GhostSettings = { hide_read_receipts: true, hide_typing: true };
  private availableThemes: ThemeMeta[] = [];
  private currentAuthState: AuthState = 'Closed';
  private currentUser: User | null = null;
  private currentQrLink: string = '';
  private currentConnectionState: string = 'Ready';
  private avatarManager = new AvatarManager();

  // Context menu state
  private contextMenuMsgId: number | null = null;

  public async init() {
    this.injectStaticIcons();
    this.bindDOMEvents();
    await this.initThemes();
    await this.initGhostMode();
    await this.initTelegramSync();
  }

  // -------------------------------------------------------------------------
  // 1. Static Icons Injection
  // -------------------------------------------------------------------------
  private injectStaticIcons() {
    const setIcon = (id: string, html: string) => {
      const el = document.getElementById(id);
      if (el) el.innerHTML = html;
    };

    setIcon('brand-logo-icon', icons.zap);
    setIcon('ghost-pill-icon', icons.ghost);
    setIcon('btn-ai-icon', icons.sparkles);
    setIcon('btn-settings-icon', icons.settings);
    setIcon('btn-account-icon', icons.user);
    setIcon('search-input-icon', icons.search);
    setIcon('empty-state-icon', icons.messageSquare);

    // Nav icons
    setIcon('nav-icon-account', icons.user);
    setIcon('nav-icon-themes', icons.palette);
    setIcon('nav-icon-ghost', icons.ghost);
    setIcon('nav-icon-storage', icons.hardDrive);
    setIcon('nav-icon-hotkeys', icons.keyboard);

    // Settings actions
    setIcon('btn-logout-icon', icons.logOut);
    setIcon('btn-clear-cache-icon', icons.trash2);
    setIcon('btn-prompt-icon', icons.copy);
    setIcon('ai-modal-header-icon', icons.sparkles);

    // Context menu icons
    setIcon('ctx-icon-reply', icons.cornerUpLeft);
    setIcon('ctx-icon-copy', icons.copy);
    setIcon('ctx-icon-edit', icons.edit3);
    setIcon('ctx-icon-delete', icons.trash2);
  }

  // -------------------------------------------------------------------------
  // 2. Theme Engine & Live Hot-Reload
  // -------------------------------------------------------------------------
  private async initThemes() {
    try {
      this.availableThemes = await api.listThemes();
      this.renderThemeGrid();

      const savedThemeId = localStorage.getItem('opencustom_theme') || 'modern-dark';
      await this.switchTheme(savedThemeId);

      themeEngine.onThemeChanged(() => {
        this.renderFolderTabs();
        this.renderChatList();
        if (this.activeChatId !== null) {
          this.renderActiveChat();
        }
      });
    } catch (err) {
      console.error('Failed to initialize themes:', err);
    }
  }

  private async switchTheme(themeId: string) {
    try {
      const bundle = await api.loadTheme(themeId);
      themeEngine.applyTheme(bundle);
      localStorage.setItem('opencustom_theme', themeId);
      this.renderThemeGrid();
      this.loadEditorFileContent();
    } catch (err) {
      console.warn(`Could not load theme ${themeId}, falling back to modern-dark:`, err);
      if (themeId !== 'modern-dark') {
        await this.switchTheme('modern-dark');
      }
    }
  }

  private renderThemeGrid() {
    const grid = document.getElementById('theme-grid');
    if (!grid) return;

    const currentThemeId = themeEngine.getActiveTheme()?.meta.id || '';
    grid.innerHTML = this.availableThemes
      .map(
        (t) => `
        <div class="theme-card ${t.id === currentThemeId ? 'selected' : ''}" data-theme-id="${t.id}">
          <h4>${t.name}</h4>
          <p>${t.description || ''}</p>
          <span style="font-size: 10px; opacity: 0.5;">v${t.version} • by ${t.author}</span>
        </div>
      `
      )
      .join('');

    grid.querySelectorAll('.theme-card').forEach((card) => {
      card.addEventListener('click', () => {
        const id = card.getAttribute('data-theme-id');
        if (id) this.switchTheme(id);
      });
    });
  }

  private async loadEditorFileContent() {
    const active = themeEngine.getActiveTheme();
    if (!active) return;

    const select = document.getElementById('editor-file-select') as HTMLSelectElement;
    const editor = document.getElementById('live-code-editor') as HTMLTextAreaElement;
    if (!select || !editor) return;

    const fileName = select.value;
    if (fileName === 'style.css') {
      editor.value = active.css;
    } else {
      const tKey = fileName.replace('templates/', '');
      editor.value = active.templates[tKey] || '';
    }
  }

  private async saveEditorContent() {
    const active = themeEngine.getActiveTheme();
    if (!active) return;

    const select = document.getElementById('editor-file-select') as HTMLSelectElement;
    const editor = document.getElementById('live-code-editor') as HTMLTextAreaElement;
    if (!select || !editor) return;

    const fileName = select.value;
    const content = editor.value;

    try {
      await api.saveThemeFile(active.meta.id, fileName, content);
      await this.switchTheme(active.meta.id);
      alert(`Saved and applied ${fileName}!`);
    } catch (err: any) {
      alert(`Save error: ${err}`);
    }
  }

  // -------------------------------------------------------------------------
  // 3. Ghost Mode Settings
  // -------------------------------------------------------------------------
  private async initGhostMode() {
    try {
      this.ghostSettings = await api.getGhostSettings();
      this.updateGhostUI();
    } catch (err) {
      console.warn('Failed to load ghost settings:', err);
    }
  }

  private updateGhostUI() {
    const pill = document.getElementById('ghost-pill');
    const chkRead = document.getElementById('chk-ghost-read') as HTMLInputElement;
    const chkTyping = document.getElementById('chk-ghost-typing') as HTMLInputElement;

    const isGhostOn = this.ghostSettings.hide_read_receipts || this.ghostSettings.hide_typing;
    if (pill) {
      pill.classList.toggle('active', isGhostOn);
    }
    if (chkRead) chkRead.checked = this.ghostSettings.hide_read_receipts;
    if (chkTyping) chkTyping.checked = this.ghostSettings.hide_typing;
  }

  // -------------------------------------------------------------------------
  // 4. Telegram Sync & Realtime Events
  // -------------------------------------------------------------------------
  private async initTelegramSync() {
    try {
      this.chats = await api.getChats();
      this.renderFolderTabs();
      this.renderChatList();

      const state = await api.getState();
      if (state.connection_state) {
        this.currentConnectionState = state.connection_state;
      }
      if (state.me) {
        this.currentUser = state.me;
      }
      if (state.chat_folders) {
        this.chatFolders = state.chat_folders;
        this.renderFolderTabs();
      }
      await this.handleAuthState(state.auth_state);

      await api.onTgEvent((event) => {
        this.processTelegramEvent(event);
      });
    } catch (err) {
      console.warn('Initial Telegram sync:', err);
    }
  }

  private isLoggedIn(): boolean {
    if (typeof this.currentAuthState === 'string') {
      return this.currentAuthState === 'Ready';
    }
    return false;
  }

  private getUserId(user: User | null | undefined): string | number {
    if (!user) return '';
    if (typeof user.id === 'object' && user.id !== null) {
      const obj = user.id as any;
      if (obj[0] !== undefined) return obj[0];
      if (obj['0'] !== undefined) return obj['0'];
      return JSON.stringify(obj);
    }
    return user.id;
  }

  private processTelegramEvent(event: any) {
    if (typeof event !== 'object' || event === null) return;

    if ('AuthStateChanged' in event) {
      this.handleAuthState(event.AuthStateChanged);
    } else if ('ConnectionStateChanged' in event) {
      this.currentConnectionState = event.ConnectionStateChanged;
      this.renderAccountInfo();
    } else if ('MeUpdated' in event) {
      this.currentUser = event.MeUpdated;
      this.renderAccountInfo();
    } else if ('UserUpdated' in event) {
      const u = event.UserUpdated;
      const uid = this.getUserId(u);
      const myUid = this.getUserId(this.currentUser);
      if (this.currentUser && uid === myUid) {
        this.currentUser = u;
        this.renderAccountInfo();
      }
    } else if ('ChatListUpdated' in event) {
      api.getChats().then((chats) => {
        this.chats = chats;
        this.renderFolderTabs();
        this.renderChatList();
      });
    } else if ('ChatFoldersUpdated' in event) {
      this.chatFolders = event.ChatFoldersUpdated || [];
      this.renderFolderTabs();
      this.renderChatList();
    } else if ('ChatUpdated' in event) {
      const updatedChat: Chat = event.ChatUpdated;
      const idx = this.chats.findIndex((c) => c.id === updatedChat.id);
      if (idx >= 0) {
        this.chats[idx] = updatedChat;
      } else {
        this.chats.unshift(updatedChat);
      }
      this.renderFolderTabs();
      this.renderChatList();
      if (this.activeChatId === updatedChat.id) {
        this.renderHeader();
      }
    } else if ('HistoryLoaded' in event) {
      const { chat_id } = event.HistoryLoaded;
      const rawId = typeof chat_id === 'object' ? chat_id[0] ?? chat_id : chat_id;
      if (this.activeChatId === rawId) {
        api.getMessages(rawId).then((msgs) => {
          this.activeChatMessages = msgs;
          this.renderMessages();
          this.scrollToBottom();
        });
      }
    } else if ('MessageReceived' in event) {
      const msg: Message = event.MessageReceived;
      if (this.activeChatId === msg.chat_id) {
        // If we had an optimistic message with same text or negative ID, replace it
        const optIdx = this.activeChatMessages.findIndex(
          (m) => m.id < 0 && extractMessageText(m.content) === extractMessageText(msg.content)
        );
        if (optIdx >= 0) {
          this.activeChatMessages[optIdx] = msg;
        } else {
          this.activeChatMessages.push(msg);
        }
        this.renderMessages();
        this.scrollToBottom();
      }
    } else if ('MessageUpdated' in event) {
      const msg: Message = event.MessageUpdated;
      if (this.activeChatId === msg.chat_id) {
        const idx = this.activeChatMessages.findIndex((m) => m.id === msg.id);
        if (idx >= 0) {
          this.activeChatMessages[idx] = msg;
          this.renderMessages();
        }
      }
    } else if ('MessageStatusChanged' in event) {
      const { chat_id, message_id, status } = event.MessageStatusChanged;
      const rawCid = typeof chat_id === 'object' ? chat_id[0] ?? chat_id : chat_id;
      const rawMid = typeof message_id === 'object' ? message_id[0] ?? message_id : message_id;
      if (this.activeChatId === rawCid) {
        const found = this.activeChatMessages.find((m) => m.id === rawMid);
        if (found) {
          found.status = status;
          this.renderMessages();
        }
      }
    } else if ('MessagesDeleted' in event) {
      const { chat_id, message_ids } = event.MessagesDeleted;
      const rawCid = typeof chat_id === 'object' ? chat_id[0] ?? chat_id : chat_id;
      if (this.activeChatId === rawCid) {
        const ids = message_ids.map((id: any) => (typeof id === 'object' ? id[0] ?? id : id));
        this.activeChatMessages = this.activeChatMessages.filter((m) => !ids.includes(m.id));
        this.renderMessages();
      }
    }
  }

  // -------------------------------------------------------------------------
  // 5. Folders & Categories Rendering
  // -------------------------------------------------------------------------
  private renderFolderTabs() {
    const container = document.getElementById('folder-tabs-container');
    if (!container) return;

    // Calculate badge counts
    const totalUnread = this.chats.reduce((acc, c) => acc + (c.unread_count || 0), 0);
    const unreadChatsCount = this.chats.filter((c) => (c.unread_count || 0) > 0).length;
    const personalUnread = this.chats
      .filter((c) => c.chat_type === 'Private')
      .reduce((acc, c) => acc + (c.unread_count || 0), 0);
    const groupsUnread = this.chats
      .filter((c) => c.chat_type === 'BasicGroup' || c.chat_type === 'Supergroup')
      .reduce((acc, c) => acc + (c.unread_count || 0), 0);
    const channelsUnread = this.chats
      .filter((c) => c.chat_type === 'Channel')
      .reduce((acc, c) => acc + (c.unread_count || 0), 0);

    const categories = [
      { id: 'all', title: 'Все', count: totalUnread },
      { id: 'personal', title: 'Личные', count: personalUnread },
      { id: 'groups', title: 'Группы', count: groupsUnread },
      { id: 'channels', title: 'Каналы', count: channelsUnread },
      { id: 'bots', title: 'Боты', count: 0 },
      { id: 'unread', title: 'Непрочитанные', count: unreadChatsCount },
    ];

    // Cloud folders
    const cloudTabs = this.chatFolders.map((f) => {
      const fUnread = this.chats
        .filter((c) => c.folder_ids && c.folder_ids.includes(f.id))
        .reduce((acc, c) => acc + (c.unread_count || 0), 0);
      return { id: `folder_${f.id}`, title: f.title, count: fUnread };
    });

    const allTabs = [...categories, ...cloudTabs];

    container.innerHTML = allTabs
      .map((tab) => {
        const isActive = this.currentFilter === tab.id ? 'active' : '';
        const badge = tab.count > 0 ? `<span class="folder-badge">${tab.count}</span>` : '';
        return `
          <button class="folder-tab ${isActive}" data-folder-id="${tab.id}">
            <span>${this.escapeHtml(tab.title)}</span>
            ${badge}
          </button>
        `;
      })
      .join('');

    container.querySelectorAll('[data-folder-id]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const fid = btn.getAttribute('data-folder-id') || 'all';
        this.currentFilter = fid;
        this.renderFolderTabs();
        this.renderChatList();
      });
    });
  }

  // -------------------------------------------------------------------------
  // 6. Chat List Rendering
  // -------------------------------------------------------------------------
  private renderChatList() {
    const listEl = document.getElementById('chat-list');
    if (!listEl) return;

    let filtered = this.chats;

    // Filter categories
    if (this.currentFilter === 'personal') {
      filtered = filtered.filter((c) => c.chat_type === 'Private');
    } else if (this.currentFilter === 'groups') {
      filtered = filtered.filter(
        (c) => c.chat_type === 'BasicGroup' || c.chat_type === 'Supergroup'
      );
    } else if (this.currentFilter === 'channels') {
      filtered = filtered.filter((c) => c.chat_type === 'Channel');
    } else if (this.currentFilter === 'bots') {
      filtered = filtered.filter(
        (c) =>
          c.chat_type === 'Private' &&
          (c.title.toLowerCase().includes('bot') ||
            c.last_message?.sender_name?.toLowerCase().includes('bot'))
      );
    } else if (this.currentFilter === 'unread') {
      filtered = filtered.filter((c) => (c.unread_count || 0) > 0);
    } else if (this.currentFilter.startsWith('folder_')) {
      const fId = Number(this.currentFilter.replace('folder_', ''));
      filtered = filtered.filter((c) => c.folder_ids && c.folder_ids.includes(fId));
    }

    // Search query
    if (this.searchQuery.trim()) {
      const q = this.searchQuery.toLowerCase();
      filtered = filtered.filter((c) => c.title.toLowerCase().includes(q));
    }

    if (filtered.length === 0) {
      listEl.innerHTML = `<div style="padding: 24px; text-align: center; font-size: 13px; color: var(--tg-text-muted);">No chats found</div>`;
      return;
    }

    listEl.innerHTML = filtered
      .map((chat) => {
        const lastMsgText = chat.last_message
          ? extractMessageText(chat.last_message.content)
          : 'No messages yet';

        const lastMsgTime = chat.last_message
          ? new Date(chat.last_message.date * 1000).toLocaleTimeString([], {
              hour: '2-digit',
              minute: '2-digit',
            })
          : '';

        const unreadBadge =
          chat.unread_count > 0 ? `<span class="badge-unread">${chat.unread_count}</span>` : '';

        const avatarData = this.avatarManager.getAvatarData(chat);

        const tokens: Record<string, string> = {
          id: String(chat.id),
          title: this.escapeHtml(chat.title),
          last_message: this.escapeHtml(lastMsgText),
          time: lastMsgTime,
          unread_count: String(chat.unread_count),
          unread_badge_html: unreadBadge,
          avatar_letter: avatarData.initials,
          avatar_content: avatarData.innerHtml,
          avatar_style: `background: ${avatarData.gradient};`,
          photo_path: avatarData.photoPath,
          active_class: chat.id === this.activeChatId ? 'active' : '',
        };

        return themeEngine.renderTemplate('chat_item.html', tokens);
      })
      .join('');

    // Bind chat click
    listEl.querySelectorAll('[data-chat-id]').forEach((row) => {
      row.addEventListener('click', () => {
        const cid = Number(row.getAttribute('data-chat-id'));
        if (!isNaN(cid)) {
          this.selectChat(cid);
        }
      });
    });
  }

  // -------------------------------------------------------------------------
  // 7. Chat Selection & Active Chat
  // -------------------------------------------------------------------------
  private async selectChat(chatId: number) {
    this.activeChatId = chatId;
    this.replyingToMsg = null;
    this.editingMsg = null;

    document.getElementById('empty-chat-placeholder')!.style.display = 'none';
    document.getElementById('active-chat-container')!.style.display = 'flex';

    this.renderChatList();
    this.renderActiveChat();

    // Load in-memory history first
    try {
      this.activeChatMessages = await api.getMessages(chatId);
      this.renderMessages();
      this.scrollToBottom();

      // Trigger TDLib native history retrieval
      const loaded = await api.loadHistory(chatId, undefined, 50);
      if (loaded && loaded.length > 0 && this.activeChatId === chatId) {
        this.activeChatMessages = loaded;
        this.renderMessages();
        this.scrollToBottom();
      }
    } catch (err) {
      console.error('Failed to load chat history:', err);
    }
  }

  private renderActiveChat() {
    if (this.activeChatId === null) return;
    this.renderHeader();
    this.renderMessages();
    this.renderInput();
  }

  private renderHeader() {
    const headerEl = document.getElementById('chat-header-container');
    if (!headerEl || this.activeChatId === null) return;

    const chat = this.chats.find((c) => c.id === this.activeChatId);
    if (!chat) return;

    const avatarData = this.avatarManager.getAvatarData(chat);

    let statusText = 'Online';
    if (chat.chat_type === 'Channel') {
      statusText = 'Channel';
    } else if (chat.chat_type === 'Supergroup' || chat.chat_type === 'BasicGroup') {
      statusText = 'Group conversation';
    }

    const tokens: Record<string, string> = {
      title: this.escapeHtml(chat.title),
      status: statusText,
      avatar_letter: avatarData.initials,
      avatar_content: avatarData.innerHtml,
      avatar_style: `background: ${avatarData.gradient};`,
      photo_path: avatarData.photoPath,
      icon_sparkles: `<span class="svg-icon" style="width:14px;height:14px;">${icons.sparkles}</span>`,
      icon_ghost: `<span class="svg-icon" style="width:14px;height:14px;">${icons.ghost}</span>`,
    };

    headerEl.innerHTML = themeEngine.renderTemplate('header.html', tokens);

    headerEl.querySelector('[data-action="ai-summarize-chat"]')?.addEventListener('click', () => {
      this.openAiModal('summarize');
    });
    headerEl.querySelector('[data-action="toggle-ghost"]')?.addEventListener('click', () => {
      this.openSettingsModal('ghost');
    });
  }

  // -------------------------------------------------------------------------
  // 8. Messages & Date Dividers Rendering
  // -------------------------------------------------------------------------
  private getMessageDay(dateSeconds: number): string {
    const msgDate = new Date(dateSeconds * 1000);
    const now = new Date();

    const isToday =
      msgDate.getDate() === now.getDate() &&
      msgDate.getMonth() === now.getMonth() &&
      msgDate.getFullYear() === now.getFullYear();

    if (isToday) return 'Today';

    const yesterday = new Date(now);
    yesterday.setDate(now.getDate() - 1);
    const isYesterday =
      msgDate.getDate() === yesterday.getDate() &&
      msgDate.getMonth() === yesterday.getMonth() &&
      msgDate.getFullYear() === yesterday.getFullYear();

    if (isYesterday) return 'Yesterday';

    return msgDate.toLocaleDateString([], { day: 'numeric', month: 'long', year: 'numeric' });
  }

  private renderMessages() {
    const container = document.getElementById('messages-container');
    if (!container) return;

    if (this.activeChatMessages.length === 0) {
      container.innerHTML = `<div style="text-align: center; margin: auto; color: var(--tg-text-muted); font-size: 13px;">No messages here yet. Send a greeting!</div>`;
      return;
    }

    let lastDay = '';
    let html = '';

    for (const msg of this.activeChatMessages) {
      const msgDay = this.getMessageDay(msg.date);
      if (msgDay !== lastDay) {
        html += `<div class="date-divider"><span>${msgDay}</span></div>`;
        lastDay = msgDay;
      }

      const rawText = extractMessageText(msg.content);
      const formattedText = formatMessageText(rawText);

      const timeStr = new Date(msg.date * 1000).toLocaleTimeString([], {
        hour: '2-digit',
        minute: '2-digit',
      });

      // Delivery Status Icon
      let statusIcon = '';
      if (msg.is_outgoing) {
        if (msg.status === 'Sending') {
          statusIcon = `<span class="status-clock" title="Sending...">${icons.clock}</span>`;
        } else if (msg.status === 'Sent') {
          statusIcon = `<span class="status-check" title="Sent">${icons.check}</span>`;
        } else if (msg.status === 'Read') {
          statusIcon = `<span class="status-read" title="Read">${icons.checkCheck}</span>`;
        } else if (msg.status === 'Failed') {
          statusIcon = `<span class="status-failed" title="Failed">⚠️</span>`;
        }
      }

      const replyPreview = msg.reply_to_message_id
        ? `<div class="msg-reply-snippet" data-reply-id="${msg.reply_to_message_id}">Reply to message #${msg.reply_to_message_id}</div>`
        : '';

      const tokens: Record<string, string> = {
        id: String(msg.id),
        sender: msg.is_outgoing ? 'You' : this.escapeHtml(msg.sender_name || 'User'),
        text: formattedText,
        time: timeStr,
        direction: msg.is_outgoing ? 'outgoing' : 'incoming',
        status_icon: statusIcon,
        reply_preview: replyPreview,
        media_html: '',
        icon_reply: `<span class="svg-icon" style="width:13px;height:13px;">${icons.cornerUpLeft}</span>`,
        icon_copy: `<span class="svg-icon" style="width:13px;height:13px;">${icons.copy}</span>`,
        icon_translate: `<span class="svg-icon" style="width:13px;height:13px;">${icons.sparkles}</span>`,
      };

      html += themeEngine.renderTemplate('message.html', tokens);
    }

    container.innerHTML = html;

    // Message inline action buttons
    container.querySelectorAll('[data-action="reply"]').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        const card = (e.target as HTMLElement).closest('[data-msg-id]');
        const mid = Number(card?.getAttribute('data-msg-id'));
        const found = this.activeChatMessages.find((m) => m.id === mid);
        if (found) {
          this.replyingToMsg = found;
          this.editingMsg = null;
          this.renderInput();
        }
      });
    });

    container.querySelectorAll('[data-action="copy"]').forEach((btn) => {
      btn.addEventListener('click', async (e) => {
        const card = (e.target as HTMLElement).closest('[data-msg-id]');
        const mid = Number(card?.getAttribute('data-msg-id'));
        const found = this.activeChatMessages.find((m) => m.id === mid);
        if (found) {
          const raw = extractMessageText(found.content);
          await navigator.clipboard.writeText(raw);
        }
      });
    });

    container.querySelectorAll('[data-action="ai-translate"]').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        const card = (e.target as HTMLElement).closest('[data-msg-id]');
        const mid = Number(card?.getAttribute('data-msg-id'));
        const found = this.activeChatMessages.find((m) => m.id === mid);
        if (found) {
          const raw = extractMessageText(found.content);
          this.openAiModal('translate', raw);
        }
      });
    });

    // Context menu right-click on messages
    container.querySelectorAll('[data-msg-id]').forEach((row) => {
      row.addEventListener('contextmenu', (e: any) => {
        e.preventDefault();
        const mid = Number(row.getAttribute('data-msg-id'));
        this.openContextMenu(e.clientX, e.clientY, mid);
      });
    });
  }

  // -------------------------------------------------------------------------
  // 9. Input & Optimistic Sending
  // -------------------------------------------------------------------------
  private renderInput() {
    const inputContainer = document.getElementById('chat-input-container');
    if (!inputContainer) return;

    let banner = '';
    if (this.editingMsg) {
      const rawText = extractMessageText(this.editingMsg.content);
      banner = `
        <div style="display: flex; justify-content: space-between; align-items: center; padding: 4px 10px; background: rgba(122,162,247,0.12); border-left: 3px solid var(--tg-accent); font-size: 11.5px; margin-bottom: 6px; border-radius: 4px;">
          <span>Editing: <strong>${this.escapeHtml(rawText.substring(0, 40))}</strong></span>
          <button id="btn-cancel-banner" style="background: none; border: none; color: inherit; cursor: pointer; font-size: 14px;">✕</button>
        </div>
      `;
    } else if (this.replyingToMsg) {
      banner = `
        <div style="display: flex; justify-content: space-between; align-items: center; padding: 4px 10px; background: rgba(122,162,247,0.12); border-left: 3px solid var(--tg-accent); font-size: 11.5px; margin-bottom: 6px; border-radius: 4px;">
          <span>Replying to <strong>${this.replyingToMsg.is_outgoing ? 'You' : this.escapeHtml(this.replyingToMsg.sender_name || 'User')}</strong></span>
          <button id="btn-cancel-banner" style="background: none; border: none; color: inherit; cursor: pointer; font-size: 14px;">✕</button>
        </div>
      `;
    }

    const tokens: Record<string, string> = {
      placeholder: this.editingMsg ? 'Edit message...' : 'Write a message...',
      reply_banner_html: banner,
      icon_attach: `<span class="svg-icon" style="width:18px;height:18px;">${icons.paperclip}</span>`,
      icon_sparkles: `<span class="svg-icon" style="width:18px;height:18px;">${icons.sparkles}</span>`,
      icon_send: `<span class="svg-icon" style="width:18px;height:18px;">${icons.send}</span>`,
    };

    inputContainer.innerHTML = themeEngine.renderTemplate('input.html', tokens);

    const textarea = inputContainer.querySelector('textarea') as HTMLTextAreaElement;
    const sendBtn = inputContainer.querySelector('[data-action="send-message"]');
    const aiAssistBtn = inputContainer.querySelector('[data-action="ai-assist"]');
    const cancelBannerBtn = inputContainer.querySelector('#btn-cancel-banner');

    if (this.editingMsg && textarea) {
      textarea.value = extractMessageText(this.editingMsg.content);
    }

    if (cancelBannerBtn) {
      cancelBannerBtn.addEventListener('click', () => {
        this.replyingToMsg = null;
        this.editingMsg = null;
        this.renderInput();
      });
    }

    if (textarea) {
      textarea.focus();
      textarea.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
          e.preventDefault();
          this.handleSendMessage(textarea.value);
        } else if (e.key === 'ArrowUp' && !textarea.value) {
          // Edit last outgoing message
          const lastOut = [...this.activeChatMessages].reverse().find((m) => m.is_outgoing);
          if (lastOut) {
            this.editingMsg = lastOut;
            this.replyingToMsg = null;
            this.renderInput();
          }
        }
      });
    }

    if (sendBtn && textarea) {
      sendBtn.addEventListener('click', () => {
        this.handleSendMessage(textarea.value);
      });
    }

    if (aiAssistBtn) {
      aiAssistBtn.addEventListener('click', () => {
        this.openAiModal('reply', textarea ? textarea.value : '');
      });
    }
  }

  private async handleSendMessage(text: string) {
    if (!text.trim() || this.activeChatId === null) return;
    const trimmed = text.trim();

    // Editing mode
    if (this.editingMsg) {
      const mid = this.editingMsg.id;
      this.editingMsg = null;
      this.renderInput();
      try {
        await api.editMessage(this.activeChatId, mid, trimmed);
      } catch (err) {
        console.error('Failed to edit message:', err);
      }
      return;
    }

    // Optimistic sending
    const replyId = this.replyingToMsg ? this.replyingToMsg.id : undefined;
    this.replyingToMsg = null;
    this.renderInput();

    const tempId = -Math.floor(Date.now() + Math.random() * 1000);
    const optimisticMsg: Message = {
      id: tempId,
      chat_id: this.activeChatId,
      sender_id:
        typeof this.currentUser?.id === 'object'
          ? this.currentUser?.id[0] ?? 0
          : this.currentUser?.id ?? 0,
      sender_name: this.currentUser
        ? [this.currentUser.first_name, this.currentUser.last_name].filter(Boolean).join(' ')
        : 'You',
      date: Math.floor(Date.now() / 1000),
      is_outgoing: true,
      content: { Text: { text: trimmed } },
      reply_to_message_id: replyId,
      status: 'Sending',
    };

    this.activeChatMessages.push(optimisticMsg);
    this.renderMessages();
    this.scrollToBottom();

    try {
      await api.sendMessage(this.activeChatId, trimmed, replyId);
    } catch (err) {
      console.error('Failed to send message:', err);
      optimisticMsg.status = 'Failed';
      this.renderMessages();
    }
  }

  private scrollToBottom() {
    const el = document.getElementById('messages-container');
    if (el) {
      el.scrollTop = el.scrollHeight;
    }
  }

  // -------------------------------------------------------------------------
  // 10. Message Context Menu
  // -------------------------------------------------------------------------
  private openContextMenu(x: number, y: number, msgId: number) {
    this.contextMenuMsgId = msgId;
    const menu = document.getElementById('message-context-menu');
    if (!menu) return;

    const msg = this.activeChatMessages.find((m) => m.id === msgId);
    const editBtn = document.getElementById('ctx-edit');
    if (editBtn) {
      editBtn.style.display = msg && msg.is_outgoing ? 'flex' : 'none';
    }

    menu.style.display = 'flex';

    // Boundary check
    const menuWidth = 160;
    const menuHeight = 150;
    const posX = x + menuWidth > window.innerWidth ? window.innerWidth - menuWidth - 10 : x;
    const posY = y + menuHeight > window.innerHeight ? window.innerHeight - menuHeight - 10 : y;

    menu.style.left = `${posX}px`;
    menu.style.top = `${posY}px`;
  }

  private closeContextMenu() {
    const menu = document.getElementById('message-context-menu');
    if (menu) menu.style.display = 'none';
    this.contextMenuMsgId = null;
  }

  // -------------------------------------------------------------------------
  // 11. Unified Settings Modal
  // -------------------------------------------------------------------------
  public openSettingsModal(tabName: 'account' | 'themes' | 'ghost' | 'storage' | 'hotkeys') {
    const modal = document.getElementById('settings-modal');
    if (!modal) return;
    modal.classList.add('open');
    this.switchSettingsTab(tabName);
  }

  private switchSettingsTab(tabName: string) {
    const tabs = ['account', 'themes', 'ghost', 'storage', 'hotkeys'];
    const titleMap: Record<string, string> = {
      account: 'My Account',
      themes: 'Appearance & Custom Themes',
      ghost: 'Privacy & Ghost Mode',
      storage: 'Data & Storage Usage',
      hotkeys: 'Hotkeys & Tips',
    };

    const titleEl = document.getElementById('settings-tab-title');
    if (titleEl) titleEl.textContent = titleMap[tabName] || 'Settings';

    document.querySelectorAll('.settings-nav-item').forEach((item) => {
      item.classList.toggle('active', item.getAttribute('data-tab') === tabName);
    });

    for (const t of tabs) {
      const pane = document.getElementById(`tab-pane-${t}`);
      if (pane) {
        pane.style.display = t === tabName ? 'flex' : 'none';
      }
    }

    if (tabName === 'account') {
      this.renderAccountInfo();
    } else if (tabName === 'themes') {
      this.renderThemeGrid();
      this.loadEditorFileContent();
    } else if (tabName === 'storage') {
      this.updateStorageTab();
    }
  }

  private async updateStorageTab() {
    const display = document.getElementById('cache-size-display');
    if (!display) return;
    display.textContent = 'Calculating...';
    try {
      const bytes = await api.getCacheSize();
      const mb = (bytes / (1024 * 1024)).toFixed(1);
      display.textContent = `${mb} MB (${bytes.toLocaleString()} bytes)`;
    } catch (err) {
      display.textContent = 'Unavailable';
    }
  }

  private renderAccountInfo() {
    const user = this.currentUser;
    const nameEl = document.getElementById('account-name');
    const userEl = document.getElementById('account-username');
    const phoneEl = document.getElementById('account-phone');
    const idEl = document.getElementById('account-id');
    const avatarEl = document.getElementById('account-avatar');
    const authBtn = document.getElementById('btn-auth-status');
    const statusEl = document.getElementById('account-status');
    const connEl = document.getElementById('account-connection');

    // Connection state indicator
    if (statusEl && connEl) {
      const conn = this.currentConnectionState;
      let statusColor = '#9ece6a';
      let statusText = 'Online';
      let connText = 'TDLib 1.8.x Native Core';

      if (conn === 'WaitingForNetwork') {
        statusColor = '#f7768e';
        statusText = 'Waiting for network';
        connText = 'Offline (No Internet)';
      } else if (conn === 'Connecting' || conn === 'ConnectingToProxy') {
        statusColor = '#e0af68';
        statusText = conn === 'ConnectingToProxy' ? 'Connecting to proxy...' : 'Connecting...';
        connText = 'Handshaking with Telegram Core';
      } else if (conn === 'Updating') {
        statusColor = '#7dcfff';
        statusText = 'Updating...';
        connText = 'Synchronizing State';
      }

      statusEl.style.color = statusColor;
      statusEl.innerHTML = `<span style="display: inline-block; width: 8px; height: 8px; border-radius: 50%; background: ${statusColor}; box-shadow: 0 0 6px ${statusColor};"></span> ${statusText}`;
      connEl.textContent = connText;
    }

    if (!this.isLoggedIn()) {
      if (nameEl) nameEl.textContent = 'Not Logged In';
      if (userEl) userEl.textContent = '@none';
      if (phoneEl) phoneEl.textContent = '—';
      if (idEl) idEl.textContent = '—';
      if (avatarEl) avatarEl.textContent = '?';
      if (authBtn) authBtn.title = 'Account / Log In';
      return;
    }

    if (!user) {
      if (nameEl) nameEl.textContent = 'Telegram User';
      if (userEl) userEl.textContent = '@connected';
      if (phoneEl) phoneEl.textContent = 'Active Session';
      if (idEl) idEl.textContent = '—';
      if (avatarEl) avatarEl.textContent = 'TG';
      if (authBtn) authBtn.title = 'Account (Logged In)';
      return;
    }

    const fullName = [user.first_name, user.last_name].filter(Boolean).join(' ') || 'Telegram User';
    const username = user.username ? `@${user.username}` : 'No username set';
    const phone = user.phone_number
      ? user.phone_number.startsWith('+')
        ? user.phone_number
        : `+${user.phone_number}`
      : 'Hidden / Private';
    const uid = this.getUserId(user);

    const avatarData = this.avatarManager.getAvatarData(user);

    if (nameEl) nameEl.textContent = fullName;
    if (userEl) userEl.textContent = username;
    if (phoneEl) phoneEl.textContent = phone;
    if (idEl) idEl.textContent = String(uid);
    if (avatarEl) {
      avatarEl.style.background = avatarData.gradient;
      avatarEl.innerHTML = avatarData.innerHtml;
    }
    if (authBtn) authBtn.title = `Account: ${fullName} (${username})`;
  }

  // -------------------------------------------------------------------------
  // 12. Auth & Login Flow
  // -------------------------------------------------------------------------
  private showAuthStep(stepId: string) {
    const steps = ['auth-step-phone', 'auth-step-code', 'auth-step-password', 'auth-step-qr'];
    for (const id of steps) {
      const el = document.getElementById(id);
      if (el) {
        el.style.display = id === stepId ? 'flex' : 'none';
        if (id === stepId && id === 'auth-step-qr') {
          el.style.flexDirection = 'column';
        }
      }
    }
  }

  private async renderQrCode(link: string) {
    const container = document.getElementById('qr-container');
    const msg = document.getElementById('qr-status-msg');
    if (!container) return;

    if (!link || !link.trim()) {
      container.innerHTML = `<div style="color: #333; font-size: 12px; padding: 16px;">Waiting for QR link from Telegram...</div>`;
      if (msg) msg.textContent = 'Connecting to Telegram authorization server...';
      return;
    }

    this.currentQrLink = link;
    try {
      container.innerHTML = '';
      const canvas = document.createElement('canvas');
      await QRCode.toCanvas(canvas, link, {
        width: 220,
        margin: 2,
        color: { dark: '#0f172a', light: '#ffffff' },
      });
      container.appendChild(canvas);
      if (msg) msg.textContent = 'Scan code with Telegram on your phone';
    } catch (err) {
      container.innerHTML = `<p style="color: #f7768e; font-size: 12px; padding: 12px;">Failed to generate QR code: ${err}</p>`;
      if (msg) msg.textContent = 'Error rendering QR. Click Refresh to retry.';
    }
  }

  private async handleAuthState(authState: any) {
    this.currentAuthState = authState;
    const modal = document.getElementById('auth-modal');
    if (!modal) return;

    let stateName = '';
    let qrLink = '';

    if (typeof authState === 'string') {
      stateName = authState;
    } else if (typeof authState === 'object' && authState !== null) {
      if ('WaitQrCode' in authState) {
        stateName = 'WaitQrCode';
        qrLink = authState.WaitQrCode.link || '';
      } else if ('WaitCode' in authState) {
        stateName = 'WaitCode';
      } else if ('WaitPassword' in authState) {
        stateName = 'WaitPassword';
      }
    }

    if (stateName === 'Ready') {
      this.renderAccountInfo();
      modal.classList.remove('open');
      return;
    }

    this.currentUser = null;
    this.renderAccountInfo();
    modal.classList.add('open');

    if (stateName === 'WaitQrCode' || stateName === 'WaitOtherDeviceConfirmation') {
      this.showAuthStep('auth-step-qr');
      const targetLink = qrLink || this.currentQrLink;
      await this.renderQrCode(targetLink);
    } else if (stateName === 'WaitCode') {
      this.showAuthStep('auth-step-code');
      const input = document.getElementById('auth-code-input') as HTMLInputElement;
      if (input) {
        input.value = '';
        input.focus();
      }
    } else if (stateName === 'WaitPassword') {
      this.showAuthStep('auth-step-password');
      const input = document.getElementById('auth-password-input') as HTMLInputElement;
      if (input) {
        input.value = '';
        input.focus();
      }
    } else {
      this.showAuthStep('auth-step-phone');
    }
  }

  // -------------------------------------------------------------------------
  // 13. AI Assistant Execution
  // -------------------------------------------------------------------------
  private openAiModal(action: 'summarize' | 'translate' | 'reply', contextText = '') {
    const modal = document.getElementById('ai-modal')!;
    modal.classList.add('open');

    const savedProvider = localStorage.getItem('ai_provider') || 'openai';
    const savedKey = localStorage.getItem('ai_key') || '';
    const savedModel =
      localStorage.getItem('ai_model') ||
      (savedProvider === 'gemini' ? 'gemini-1.5-flash' : 'gpt-4o');

    (document.getElementById('ai-provider') as HTMLSelectElement).value = savedProvider;
    (document.getElementById('ai-api-key') as HTMLInputElement).value = savedKey;
    (document.getElementById('ai-model') as HTMLInputElement).value = savedModel;

    const resultBox = document.getElementById('ai-result-box') as HTMLTextAreaElement;
    resultBox.value = '';

    if (action === 'summarize') {
      resultBox.placeholder = 'Click "Summarize Chat" below to analyze the active conversation.';
    } else if (action === 'translate') {
      resultBox.placeholder = 'Translating: ' + contextText;
      this.executeAiRequest('translate', contextText);
    } else if (action === 'reply') {
      resultBox.placeholder = 'Drafting a reply suggestion...';
      this.executeAiRequest('reply', contextText);
    }
  }

  private async executeAiRequest(action: string, customInput = '') {
    const provider = (document.getElementById('ai-provider') as HTMLSelectElement)
      .value as 'openai' | 'gemini';
    const apiKey = (document.getElementById('ai-api-key') as HTMLInputElement).value.trim();
    const model = (document.getElementById('ai-model') as HTMLInputElement).value.trim();
    const resultBox = document.getElementById('ai-result-box') as HTMLTextAreaElement;

    if (!apiKey) {
      resultBox.value = '⚠️ Please enter your AI API Key above to use this feature.';
      return;
    }

    localStorage.setItem('ai_provider', provider);
    localStorage.setItem('ai_key', apiKey);
    localStorage.setItem('ai_model', model);

    resultBox.value = '⏳ Communicating with AI model...';

    let systemPrompt = 'You are a helpful Telegram Assistant.';
    let userPrompt = '';

    if (action === 'summarize') {
      const historySnippets = this.activeChatMessages
        .slice(-25)
        .map(
          (m) =>
            `${m.is_outgoing ? 'Me' : m.sender_name || 'Other'}: ${extractMessageText(m.content)}`
        )
        .join('\n');

      systemPrompt =
        'You are a professional summarizer. Provide a concise, bulleted summary of this chat dialogue in Russian.';
      userPrompt = `Please summarize the recent messages from this conversation:\n\n${historySnippets}`;
    } else if (action === 'translate') {
      systemPrompt =
        'You are an accurate translator. Detect the input language and translate it into clear Russian (or into English if the input was Russian). Output only the translated text.';
      userPrompt = `Translate this message:\n${customInput}`;
    } else if (action === 'reply') {
      const recent = this.activeChatMessages
        .slice(-5)
        .map(
          (m) =>
            `${m.is_outgoing ? 'Me' : 'Other'}: ${extractMessageText(m.content)}`
        )
        .join('\n');
      systemPrompt =
        'You are a friendly Telegram user. Suggest a natural, polite response to the conversation.';
      userPrompt = `Conversation context:\n${recent}\n\nDraft input prompt: "${customInput}". Draft an appropriate message reply:`;
    }

    try {
      const response = await api.aiGenerate({
        provider,
        api_key: apiKey,
        model,
        system_prompt: systemPrompt,
        user_prompt: userPrompt,
      });
      resultBox.value = response;
    } catch (err: any) {
      resultBox.value = `❌ Error: ${err}`;
    }
  }

  // -------------------------------------------------------------------------
  // 14. Event Binding & Hotkeys
  // -------------------------------------------------------------------------
  private bindDOMEvents() {
    // Search input
    const searchInput = document.getElementById('chat-search') as HTMLInputElement;
    searchInput?.addEventListener('input', (e) => {
      this.searchQuery = (e.target as HTMLInputElement).value;
      this.renderChatList();
    });

    // Top Header Buttons
    document.getElementById('btn-open-settings')?.addEventListener('click', () => {
      this.openSettingsModal('themes');
    });

    document.getElementById('btn-open-ai')?.addEventListener('click', () => {
      this.openAiModal('summarize');
    });

    document.getElementById('ghost-pill')?.addEventListener('click', () => {
      this.openSettingsModal('ghost');
    });

    document.getElementById('btn-auth-status')?.addEventListener('click', () => {
      if (this.isLoggedIn()) {
        this.openSettingsModal('account');
      } else {
        document.getElementById('auth-modal')?.classList.add('open');
      }
    });

    // Settings Navigation Tabs
    document.querySelectorAll('.settings-nav-item').forEach((item) => {
      item.addEventListener('click', () => {
        const tab = item.getAttribute('data-tab') || 'account';
        this.switchSettingsTab(tab);
      });
    });

    // Quick Themes in Empty State
    document.querySelectorAll('.btn-quick-theme').forEach((btn) => {
      btn.addEventListener('click', () => {
        const tid = btn.getAttribute('data-theme-id');
        if (tid) this.switchTheme(tid);
      });
    });

    // Modals Close
    document.querySelectorAll('.btn-close-modal').forEach((btn) => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.modal-backdrop').forEach((m) => m.classList.remove('open'));
      });
    });

    // Theme Live Editor
    document.getElementById('editor-file-select')?.addEventListener('change', () => {
      this.loadEditorFileContent();
    });
    document.getElementById('btn-save-editor')?.addEventListener('click', () => {
      this.saveEditorContent();
    });

    // Copy AI Prompt Guide
    document.getElementById('btn-copy-ai-prompt')?.addEventListener('click', async () => {
      const promptText = `
You are an expert UI/UX designer and web developer.
Create a complete custom theme package for "OpenCustom Telegram Desktop" based on my idea.
Generate the following files:
1. theme.json (id, name, author, version, description)
2. style.css (with all --tg-* CSS variables and custom rules/animations)
3. templates/message.html (custom message bubble layout using tokens {{sender}}, {{text}}, {{time}}, {{direction}}, {{status_icon}})
4. templates/chat_item.html (custom chat row layout using {{avatar_style}}, {{avatar_content}}, {{title}}, {{last_message}})
5. templates/header.html (custom chat header)
6. templates/input.html (custom message composer)
7. preview.html (standalone browser mockup page)
Use CSS variables and declarative data-action attributes.
      `.trim();
      await navigator.clipboard.writeText(promptText);
      alert('AI Theme Prompt copied to clipboard!');
    });

    // Ghost Mode Save
    document.getElementById('btn-save-ghost')?.addEventListener('click', async () => {
      const chkRead = (document.getElementById('chk-ghost-read') as HTMLInputElement).checked;
      const chkTyping = (document.getElementById('chk-ghost-typing') as HTMLInputElement).checked;
      this.ghostSettings = await api.setGhostSettings({
        hide_read_receipts: chkRead,
        hide_typing: chkTyping,
      });
      this.updateGhostUI();
      alert('Ghost Mode privacy settings saved!');
    });

    // Clear Cache Action
    document.getElementById('btn-clear-cache')?.addEventListener('click', async () => {
      if (confirm('Clear local TDLib file & image cache?')) {
        try {
          await api.clearCache();
          await this.updateStorageTab();
          alert('Local cache cleared successfully!');
        } catch (err: any) {
          alert(`Cache clear error: ${err}`);
        }
      }
    });

    // Save Proxy Action
    document.getElementById('btn-save-proxy')?.addEventListener('click', async () => {
      const host = (document.getElementById('proxy-host') as HTMLInputElement).value.trim();
      const port = Number((document.getElementById('proxy-port') as HTMLInputElement).value);
      const ptype = (document.getElementById('proxy-type') as HTMLSelectElement).value as any;

      if (!host || !port) {
        await api.setProxy(null);
        alert('Proxy disabled.');
        return;
      }

      const proxyConfig: ProxyConfig = {
        server: host,
        port,
        proxy_type: ptype,
      };

      try {
        await api.setProxy(proxyConfig);
        alert(`Proxy set to ${host}:${port} (${ptype})`);
      } catch (err: any) {
        alert(`Proxy error: ${err}`);
      }
    });

    // AI Modal Actions
    document.getElementById('btn-ai-summarize')?.addEventListener('click', () => {
      this.executeAiRequest('summarize');
    });
    document.getElementById('btn-ai-translate')?.addEventListener('click', () => {
      const cur = this.activeChatMessages.slice(-1)[0];
      const text = cur ? extractMessageText(cur.content) : '';
      this.executeAiRequest('translate', text);
    });
    document.getElementById('btn-ai-reply')?.addEventListener('click', () => {
      this.executeAiRequest('reply');
    });
    document.getElementById('btn-ai-copy-result')?.addEventListener('click', async () => {
      const res = (document.getElementById('ai-result-box') as HTMLTextAreaElement).value;
      if (res) {
        await navigator.clipboard.writeText(res);
        alert('Copied to clipboard!');
      }
    });

    // Context Menu Item Actions
    document.getElementById('ctx-copy')?.addEventListener('click', async () => {
      if (this.contextMenuMsgId !== null) {
        const found = this.activeChatMessages.find((m) => m.id === this.contextMenuMsgId);
        if (found) {
          await navigator.clipboard.writeText(extractMessageText(found.content));
        }
      }
      this.closeContextMenu();
    });

    document.getElementById('ctx-reply')?.addEventListener('click', () => {
      if (this.contextMenuMsgId !== null) {
        const found = this.activeChatMessages.find((m) => m.id === this.contextMenuMsgId);
        if (found) {
          this.replyingToMsg = found;
          this.editingMsg = null;
          this.renderInput();
        }
      }
      this.closeContextMenu();
    });

    document.getElementById('ctx-edit')?.addEventListener('click', () => {
      if (this.contextMenuMsgId !== null) {
        const found = this.activeChatMessages.find((m) => m.id === this.contextMenuMsgId);
        if (found && found.is_outgoing) {
          this.editingMsg = found;
          this.replyingToMsg = null;
          this.renderInput();
        }
      }
      this.closeContextMenu();
    });

    document.getElementById('ctx-delete')?.addEventListener('click', async () => {
      if (this.contextMenuMsgId !== null && this.activeChatId !== null) {
        const mid = this.contextMenuMsgId;
        this.closeContextMenu();
        if (confirm('Delete this message?')) {
          try {
            await api.deleteMessages(this.activeChatId, [mid], true);
            this.activeChatMessages = this.activeChatMessages.filter((m) => m.id !== mid);
            this.renderMessages();
          } catch (err: any) {
            alert(`Delete failed: ${err}`);
          }
        }
      }
    });

    // Click outside closes context menu
    window.addEventListener('click', (e) => {
      const menu = document.getElementById('message-context-menu');
      if (menu && menu.style.display === 'flex' && !menu.contains(e.target as Node)) {
        this.closeContextMenu();
      }
    });

    // Global Hotkeys
    window.addEventListener('keydown', (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        searchInput?.focus();
      } else if (e.key === 'Escape') {
        this.closeContextMenu();
        document.querySelectorAll('.modal-backdrop').forEach((m) => m.classList.remove('open'));
        if (this.replyingToMsg || this.editingMsg) {
          this.replyingToMsg = null;
          this.editingMsg = null;
          this.renderInput();
        }
      }
    });

    // Auth Actions
    document.getElementById('btn-submit-phone')?.addEventListener('click', async () => {
      const phone = (document.getElementById('auth-phone-input') as HTMLInputElement).value.trim();
      if (phone) await api.sendPhoneNumber(phone);
    });
    document.getElementById('btn-submit-code')?.addEventListener('click', async () => {
      const code = (document.getElementById('auth-code-input') as HTMLInputElement).value.trim();
      if (code) await api.sendCode(code);
    });
    document.getElementById('btn-submit-password')?.addEventListener('click', async () => {
      const pwd = (document.getElementById('auth-password-input') as HTMLInputElement).value;
      if (pwd) await api.sendPassword(pwd);
    });

    const requestQr = async () => {
      this.showAuthStep('auth-step-qr');
      const container = document.getElementById('qr-container');
      const msg = document.getElementById('qr-status-msg');
      if (container) {
        container.innerHTML = `<div style="color: #333; font-size: 12px; padding: 16px;">Requesting QR code...</div>`;
      }
      if (msg) msg.textContent = 'Contacting Telegram authorization service...';
      try {
        await api.requestQrCode();
      } catch (err: any) {
        if (container) {
          container.innerHTML = `<p style="color: #f7768e; font-size: 12px; padding: 12px;">Failed to request QR: ${err}</p>`;
        }
        if (msg) msg.textContent = 'Click Refresh to try again.';
      }
    };

    document.getElementById('btn-request-qr')?.addEventListener('click', requestQr);
    document.getElementById('btn-refresh-qr')?.addEventListener('click', requestQr);
    document.getElementById('btn-copy-qr-link')?.addEventListener('click', async () => {
      if (this.currentQrLink) {
        await navigator.clipboard.writeText(this.currentQrLink);
        alert('QR code login link copied to clipboard!');
      } else {
        alert('No active QR code link available.');
      }
    });
    document.getElementById('btn-qr-back-to-phone')?.addEventListener('click', () => {
      this.showAuthStep('auth-step-phone');
    });
    document.getElementById('btn-code-back-to-phone')?.addEventListener('click', () => {
      this.showAuthStep('auth-step-phone');
    });

    document.getElementById('btn-account-logout')?.addEventListener('click', async () => {
      if (confirm('Are you sure you want to log out of Telegram?')) {
        try {
          await api.logOut();
          this.currentUser = null;
          this.chats = [];
          this.activeChatId = null;
          this.activeChatMessages = [];
          this.renderChatList();
          document.getElementById('empty-chat-placeholder')!.style.display = 'flex';
          document.getElementById('active-chat-container')!.style.display = 'none';
          document.getElementById('settings-modal')!.classList.remove('open');
          this.handleAuthState('WaitPhoneNumber');
        } catch (err: any) {
          alert(`Logout failed: ${err}`);
        }
      }
    });

    // Theme Drag-and-Drop
    this.setupDragAndDrop();
  }

  private setupDragAndDrop() {
    const dropzone = document.getElementById('theme-dropzone');
    const handleFiles = async (files: FileList | null) => {
      if (!files || files.length === 0) return;
      const file = files[0];
      if (!file.name.endsWith('.zip')) {
        alert('Please drop a .zip theme archive');
        return;
      }

      const reader = new FileReader();
      reader.onload = async () => {
        try {
          const buffer = reader.result as ArrayBuffer;
          const bytes = new Uint8Array(buffer);
          let binary = '';
          for (let i = 0; i < bytes.byteLength; i++) {
            binary += String.fromCharCode(bytes[i]);
          }
          const base64 = btoa(binary);

          const meta = await api.importThemeZip(base64);
          alert(`Theme "${meta.name}" imported successfully! Applying...`);

          this.availableThemes = await api.listThemes();
          await this.switchTheme(meta.id);
        } catch (err: any) {
          alert(`Theme import error: ${err}`);
        }
      };
      reader.readAsArrayBuffer(file);
    };

    window.addEventListener('dragover', (e) => e.preventDefault());
    window.addEventListener('drop', (e) => {
      e.preventDefault();
      handleFiles(e.dataTransfer?.files || null);
    });

    if (dropzone) {
      dropzone.addEventListener('dragover', (e) => {
        e.preventDefault();
        dropzone.classList.add('dragover');
      });
      dropzone.addEventListener('dragleave', () => dropzone.classList.remove('dragover'));
      dropzone.addEventListener('drop', (e) => {
        e.preventDefault();
        dropzone.classList.remove('dragover');
        handleFiles(e.dataTransfer?.files || null);
      });
      dropzone.addEventListener('click', () => {
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = '.zip';
        input.onchange = () => handleFiles(input.files);
        input.click();
      });
    }
  }

  private escapeHtml(str: string): string {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }
}

// Bootstrap application on DOM load
window.addEventListener('DOMContentLoaded', () => {
  const app = new OpenCustomApp();
  app.init().catch(console.error);
});
