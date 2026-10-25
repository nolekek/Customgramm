import QRCode from 'qrcode';
import { api } from './api';
import { themeEngine } from './theme-engine';
import type { Chat, Message, ThemeMeta, GhostSettings, User, AuthState } from './types';

class OpenCustomApp {
  private chats: Chat[] = [];
  private activeChatId: number | null = null;
  private activeChatMessages: Message[] = [];
  private currentFilter: string = 'all';
  private searchQuery: string = '';
  private replyingToMsg: Message | null = null;
  private ghostSettings: GhostSettings = { hide_read_receipts: true, hide_typing: true };
  private availableThemes: ThemeMeta[] = [];
  private currentAuthState: AuthState = 'Closed';
  private currentUser: User | null = null;
  private currentQrLink: string = '';
  private currentConnectionState: string = 'Ready';

  public async init() {
    this.bindDOMEvents();
    await this.initThemes();
    await this.initGhostMode();
    await this.initTelegramSync();
  }

  // -------------------------------------------------------------------------
  // 1. Theme Engine & Live Hot-Reload
  // -------------------------------------------------------------------------

  private async initThemes() {
    try {
      this.availableThemes = await api.listThemes();
      this.renderThemeGrid();

      const savedThemeId = localStorage.getItem('opencustom_theme') || 'tokyo-night';
      await this.switchTheme(savedThemeId);

      // Re-render components whenever theme changes
      themeEngine.onThemeChanged(() => {
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
      console.warn(`Could not load theme ${themeId}, falling back to tokyo-night:`, err);
      if (themeId !== 'tokyo-night') {
        await this.switchTheme('tokyo-night');
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
      const tplName = fileName.replace('templates/', '');
      editor.value = active.templates[tplName] || '';
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
      // Reload and hot-apply instantly
      await this.switchTheme(active.meta.id);
      alert('Theme file saved and hot-reloaded successfully!');
    } catch (err: any) {
      alert(`Save failed: ${err}`);
    }
  }

  // -------------------------------------------------------------------------
  // 2. Ghost Mode
  // -------------------------------------------------------------------------

  private async initGhostMode() {
    try {
      this.ghostSettings = await api.getGhostSettings();
      this.updateGhostUI();
    } catch (err) {
      console.warn('Ghost mode init:', err);
    }
  }

  private updateGhostUI() {
    const pill = document.getElementById('ghost-pill');
    const chkRead = document.getElementById('chk-ghost-read') as HTMLInputElement;
    const chkTyping = document.getElementById('chk-ghost-typing') as HTMLInputElement;

    const isGhostOn = this.ghostSettings.hide_read_receipts || this.ghostSettings.hide_typing;
    if (pill) {
      pill.textContent = isGhostOn ? '👻 GHOST: ON' : '👻 GHOST: OFF';
      pill.classList.toggle('active', isGhostOn);
    }
    if (chkRead) chkRead.checked = this.ghostSettings.hide_read_receipts;
    if (chkTyping) chkTyping.checked = this.ghostSettings.hide_typing;
  }

  // -------------------------------------------------------------------------
  // 3. Telegram State & Realtime Sync
  // -------------------------------------------------------------------------

  private async initTelegramSync() {
    try {
      this.chats = await api.getChats();
      this.renderChatList();

      const state = await api.getState();
      if (state.connection_state) {
        this.currentConnectionState = state.connection_state;
      }
      if (state.me) {
        this.currentUser = state.me;
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

  private showStep(stepId: string) {
    const steps = [
      'auth-step-account',
      'auth-step-phone',
      'auth-step-code',
      'auth-step-password',
      'auth-step-qr',
    ];
    for (const id of steps) {
      const el = document.getElementById(id);
      if (el) {
        el.style.display = id === stepId ? 'flex' : 'none';
        if (id === stepId && (id === 'auth-step-qr' || id === 'auth-step-account')) {
          el.style.flexDirection = 'column';
        }
      }
    }
  }

  private async showAccountStep() {
    const modalTitle = document.getElementById('auth-modal-title');
    if (modalTitle) modalTitle.textContent = 'My Telegram Account';
    this.showStep('auth-step-account');
    if (!this.currentUser) {
      try {
        const state = await api.getState();
        if (state.me) {
          this.currentUser = state.me;
        }
      } catch (err) {
        console.warn('Failed to query me in showAccountStep:', err);
      }
    }
    this.renderAccountInfo();
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

    // Update connection & status badges
    if (statusEl && connEl) {
      const conn = this.currentConnectionState;
      let statusColor = '#9ece6a';
      let statusText = 'Online';
      let connText = 'Ready (TDLib Core)';

      if (conn === 'WaitingForNetwork') {
        statusColor = '#f7768e';
        statusText = 'Waiting for network';
        connText = 'No Network Connection';
      } else if (conn === 'Connecting' || conn === 'ConnectingToProxy') {
        statusColor = '#e0af68';
        statusText = conn === 'ConnectingToProxy' ? 'Connecting to proxy...' : 'Connecting...';
        connText = conn === 'ConnectingToProxy' ? 'Proxy Handshake' : 'Connecting to Telegram...';
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
      ? (user.phone_number.startsWith('+') ? user.phone_number : `+${user.phone_number}`)
      : 'Hidden / Private';
    const uid = this.getUserId(user);
    const initial = (user.first_name || user.username || 'U').charAt(0).toUpperCase();

    if (nameEl) nameEl.textContent = fullName;
    if (userEl) userEl.textContent = username;
    if (phoneEl) phoneEl.textContent = phone;
    if (idEl) idEl.textContent = String(uid);
    if (avatarEl) avatarEl.textContent = initial;
    if (authBtn) authBtn.title = `Account: ${fullName} (${username})`;
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
        color: {
          dark: '#0f172a',
          light: '#ffffff',
        },
      });
      container.appendChild(canvas);
      if (msg) msg.textContent = 'Scan code with Telegram on your phone';
    } catch (err) {
      console.error('Failed to generate QR code canvas:', err);
      container.innerHTML = `<p style="color: #f7768e; font-size: 12px; padding: 12px;">Failed to generate QR code: ${err}</p>`;
      if (msg) msg.textContent = 'Error rendering QR code. Click Refresh to retry.';
    }
  }

  private async handleAuthState(authState: any) {
    this.currentAuthState = authState;
    const modal = document.getElementById('auth-modal');
    const modalTitle = document.getElementById('auth-modal-title');
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
      if (modalTitle) modalTitle.textContent = 'My Telegram Account';
      if (modal.classList.contains('open')) {
        const stepAccount = document.getElementById('auth-step-account');
        if (stepAccount && stepAccount.style.display !== 'flex') {
          modal.classList.remove('open');
        }
      }
      return;
    }

    // Reset user profile if not in Ready state
    this.currentUser = null;
    this.renderAccountInfo();

    // Modal is required for authentication
    modal.classList.add('open');
    if (modalTitle) modalTitle.textContent = 'Telegram Authentication';

    if (stateName === 'WaitQrCode' || stateName === 'WaitOtherDeviceConfirmation') {
      this.showStep('auth-step-qr');
      const targetLink = qrLink || this.currentQrLink;
      if (targetLink) {
        await this.renderQrCode(targetLink);
      } else {
        await this.renderQrCode('');
      }
    } else if (stateName === 'WaitCode') {
      this.showStep('auth-step-code');
      const input = document.getElementById('auth-code-input') as HTMLInputElement;
      if (input) {
        input.value = '';
        input.focus();
      }
    } else if (stateName === 'WaitPassword') {
      this.showStep('auth-step-password');
      const input = document.getElementById('auth-password-input') as HTMLInputElement;
      if (input) {
        input.value = '';
        input.focus();
      }
    } else {
      this.showStep('auth-step-phone');
    }
  }

  private processTelegramEvent(event: any) {
    if (typeof event === 'object' && event !== null) {
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
          this.renderChatList();
        });
      } else if ('ChatUpdated' in event) {
        const updatedChat = event.ChatUpdated;
        const idx = this.chats.findIndex((c) => c.id === updatedChat.id);
        if (idx >= 0) {
          this.chats[idx] = updatedChat;
        } else {
          this.chats.unshift(updatedChat);
        }
        this.renderChatList();
      } else if ('MessageReceived' in event) {
        const msg = event.MessageReceived;
        if (this.activeChatId === msg.chat_id) {
          this.activeChatMessages.push(msg);
          this.renderMessages();
          this.scrollToBottom();
        }
      } else if ('MessageUpdated' in event) {
        const msg = event.MessageUpdated;
        if (this.activeChatId === msg.chat_id) {
          const idx = this.activeChatMessages.findIndex((m) => m.id === msg.id);
          if (idx >= 0) {
            this.activeChatMessages[idx] = msg;
            this.renderMessages();
          }
        }
      } else if ('MessagesDeleted' in event) {
        const { chat_id, message_ids } = event.MessagesDeleted;
        if (this.activeChatId === chat_id) {
          this.activeChatMessages = this.activeChatMessages.filter((m) => !message_ids.includes(m.id));
          this.renderMessages();
        }
      }
    }
  }

  // -------------------------------------------------------------------------
  // 4. UI Rendering via Theme Templates
  // -------------------------------------------------------------------------

  private renderChatList() {
    const listEl = document.getElementById('chat-list');
    if (!listEl) return;

    let filtered = this.chats;

    // Filter tabs
    if (this.currentFilter === 'private') {
      filtered = filtered.filter((c) => c.chat_type === 'Private');
    } else if (this.currentFilter === 'groups') {
      filtered = filtered.filter((c) => c.chat_type === 'BasicGroup' || c.chat_type === 'Supergroup');
    } else if (this.currentFilter === 'channels') {
      filtered = filtered.filter((c) => c.chat_type === 'Channel');
    }

    // Search query
    if (this.searchQuery.trim()) {
      const q = this.searchQuery.toLowerCase();
      filtered = filtered.filter((c) => c.title.toLowerCase().includes(q));
    }

    if (filtered.length === 0) {
      listEl.innerHTML = `<div style="padding: 20px; text-align: center; font-size: 13px; opacity: 0.5;">No chats found</div>`;
      return;
    }

    listEl.innerHTML = filtered
      .map((chat) => {
        const lastMsgText = chat.last_message
          ? typeof chat.last_message.content === 'string'
            ? chat.last_message.content
            : (chat.last_message.content as any).text || '[Media]'
          : 'No messages yet';

        const lastMsgTime = chat.last_message
          ? new Date(chat.last_message.date * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
          : '';

        const unreadBadge =
          chat.unread_count > 0 ? `<span class="badge-unread">${chat.unread_count}</span>` : '';

        const tokens: Record<string, string> = {
          id: String(chat.id),
          title: this.escapeHtml(chat.title),
          last_message: this.escapeHtml(lastMsgText),
          time: lastMsgTime,
          unread_count: String(chat.unread_count),
          unread_badge_html: unreadBadge,
          avatar_letter: chat.title.charAt(0).toUpperCase() || '?',
          avatar_url: '',
          active_class: chat.id === this.activeChatId ? 'active' : '',
        };

        return themeEngine.renderTemplate('chat_item.html', tokens);
      })
      .join('');

    // Bind chat click actions
    listEl.querySelectorAll('[data-chat-id]').forEach((row) => {
      row.addEventListener('click', () => {
        const cid = Number(row.getAttribute('data-chat-id'));
        if (!isNaN(cid)) {
          this.selectChat(cid);
        }
      });
    });
  }

  private async selectChat(chatId: number) {
    this.activeChatId = chatId;
    this.replyingToMsg = null;

    document.getElementById('empty-chat-placeholder')!.style.display = 'none';
    document.getElementById('active-chat-container')!.style.display = 'flex';

    this.renderChatList(); // Update active highlights
    this.renderActiveChat();

    // Load messages
    try {
      this.activeChatMessages = await api.getMessages(chatId);
      this.renderMessages();
      this.scrollToBottom();

      // Trigger TDLib history load in background
      await api.loadHistory(chatId, undefined, 30);
    } catch (err) {
      console.error('Failed to load chat history:', err);
    }
  }

  private renderActiveChat() {
    if (this.activeChatId === null) return;
    const chat = this.chats.find((c) => c.id === this.activeChatId);
    if (!chat) return;

    // 1. Render Header
    const headerEl = document.getElementById('chat-header-container');
    if (headerEl) {
      const tokens: Record<string, string> = {
        title: this.escapeHtml(chat.title),
        status: chat.chat_type === 'Channel' ? 'Channel' : 'Active Connection',
        avatar_letter: chat.title.charAt(0).toUpperCase() || '?',
      };
      headerEl.innerHTML = themeEngine.renderTemplate('header.html', tokens);

      headerEl.querySelector('[data-action="ai-summarize-chat"]')?.addEventListener('click', () => {
        this.openAiModal('summarize');
      });
      headerEl.querySelector('[data-action="toggle-ghost"]')?.addEventListener('click', () => {
        this.openGhostModal();
      });
    }

    // 2. Render Messages
    this.renderMessages();

    // 3. Render Input
    this.renderInput();
  }

  private renderMessages() {
    const container = document.getElementById('messages-container');
    if (!container) return;

    if (this.activeChatMessages.length === 0) {
      container.innerHTML = `<div style="text-align: center; padding: 40px; opacity: 0.5; font-size: 13px;">No messages in this chat yet. Say hi!</div>`;
      return;
    }

    container.innerHTML = this.activeChatMessages
      .map((msg) => {
        const textContent =
          typeof msg.content === 'string'
            ? msg.content
            : (msg.content as any).text || (msg.content as any).caption || '[Attachment]';

        const timeStr = new Date(msg.date * 1000).toLocaleTimeString([], {
          hour: '2-digit',
          minute: '2-digit',
        });

        const statusIcon = msg.is_outgoing ? (msg.status === 'Sent' ? '✓✓' : '✓') : '';

        const replyPreview = msg.reply_to_message_id
          ? `<div class="msg-reply-snippet" style="font-size: 11px; opacity: 0.7; border-left: 2px solid currentColor; padding-left: 6px; margin-bottom: 4px;">Reply to message #${msg.reply_to_message_id}</div>`
          : '';

        const tokens: Record<string, string> = {
          id: String(msg.id),
          sender: msg.is_outgoing ? 'You' : this.escapeHtml(msg.sender_name || 'User'),
          text: this.escapeHtml(textContent),
          time: timeStr,
          direction: msg.is_outgoing ? 'outgoing' : 'incoming',
          status_icon: statusIcon,
          reply_preview: replyPreview,
          media_html: '',
        };

        return themeEngine.renderTemplate('message.html', tokens);
      })
      .join('');

    // Bind message actions
    container.querySelectorAll('[data-action="reply"]').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        const card = (e.target as HTMLElement).closest('[data-msg-id]');
        const mid = Number(card?.getAttribute('data-msg-id'));
        const found = this.activeChatMessages.find((m) => m.id === mid);
        if (found) {
          this.replyingToMsg = found;
          this.renderInput();
        }
      });
    });

    container.querySelectorAll('[data-action="ai-translate"]').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        const card = (e.target as HTMLElement).closest('[data-msg-id]');
        const mid = Number(card?.getAttribute('data-msg-id'));
        const found = this.activeChatMessages.find((m) => m.id === mid);
        if (found) {
          const raw = typeof found.content === 'string' ? found.content : (found.content as any).text || '';
          this.openAiModal('translate', raw);
        }
      });
    });
  }

  private renderInput() {
    const inputContainer = document.getElementById('chat-input-container');
    if (!inputContainer) return;

    const replyBanner = this.replyingToMsg
      ? `<div style="display: flex; justify-content: space-between; align-items: center; padding: 4px 10px; background: rgba(122,162,247,0.1); border-left: 3px solid #7aa2f7; font-size: 11px; margin-bottom: 6px; border-radius: 4px;">
           <span>Replying to <strong>${this.replyingToMsg.is_outgoing ? 'You' : this.replyingToMsg.sender_name || 'User'}</strong></span>
           <button id="btn-cancel-reply" style="background: none; border: none; color: inherit; cursor: pointer; font-size: 14px;">✕</button>
         </div>`
      : '';

    const tokens: Record<string, string> = {
      placeholder: 'Write a message...',
      reply_banner_html: replyBanner,
    };

    inputContainer.innerHTML = themeEngine.renderTemplate('input.html', tokens);

    const textarea = inputContainer.querySelector('textarea') as HTMLTextAreaElement;
    const sendBtn = inputContainer.querySelector('[data-action="send-message"]');
    const aiAssistBtn = inputContainer.querySelector('[data-action="ai-assist"]');
    const cancelReplyBtn = inputContainer.querySelector('#btn-cancel-reply');

    if (cancelReplyBtn) {
      cancelReplyBtn.addEventListener('click', () => {
        this.replyingToMsg = null;
        this.renderInput();
      });
    }

    if (textarea) {
      textarea.focus();
      textarea.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
          e.preventDefault();
          this.handleSendMessage(textarea.value);
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
    const replyId = this.replyingToMsg ? this.replyingToMsg.id : undefined;

    try {
      await api.sendMessage(this.activeChatId, text.trim(), replyId);
      this.replyingToMsg = null;
      this.renderInput();
    } catch (err) {
      console.error('Failed to send message:', err);
    }
  }

  private scrollToBottom() {
    const el = document.getElementById('messages-container');
    if (el) {
      el.scrollTop = el.scrollHeight;
    }
  }

  // -------------------------------------------------------------------------
  // 5. AI Assistant Execution
  // -------------------------------------------------------------------------

  private openAiModal(action: 'summarize' | 'translate' | 'reply', contextText = '') {
    const modal = document.getElementById('ai-modal')!;
    modal.classList.add('open');

    // Restore saved API settings
    const savedProvider = localStorage.getItem('ai_provider') || 'openai';
    const savedKey = localStorage.getItem('ai_key') || '';
    const savedModel = localStorage.getItem('ai_model') || (savedProvider === 'gemini' ? 'gemini-1.5-flash' : 'gpt-4o');

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
    const provider = (document.getElementById('ai-provider') as HTMLSelectElement).value as 'openai' | 'gemini';
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
        .map((m) => `${m.is_outgoing ? 'Me' : m.sender_name || 'Other'}: ${typeof m.content === 'string' ? m.content : (m.content as any).text || ''}`)
        .join('\n');

      systemPrompt = 'You are a professional summarizer. Provide a concise, bulleted summary of this chat dialogue in Russian or the language of the conversation.';
      userPrompt = `Please summarize the recent messages from this conversation:\n\n${historySnippets}`;
    } else if (action === 'translate') {
      systemPrompt = 'You are an accurate translator. Detect the input language and translate it into clear Russian (or into English if the input was Russian). Output only the translated text.';
      userPrompt = `Translate this message:\n${customInput}`;
    } else if (action === 'reply') {
      const recent = this.activeChatMessages.slice(-5).map((m) => `${m.is_outgoing ? 'Me' : 'Other'}: ${typeof m.content === 'string' ? m.content : (m.content as any).text || ''}`).join('\n');
      systemPrompt = 'You are a witty, polite Telegram user. Suggest a natural, human-like response to the latest conversation context.';
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

  private openGhostModal() {
    document.getElementById('ghost-modal')!.classList.add('open');
    this.updateGhostUI();
  }

  // -------------------------------------------------------------------------
  // 6. DOM Events & Drag-and-Drop ZIP Theme Import
  // -------------------------------------------------------------------------

  private bindDOMEvents() {
    // Search input
    document.getElementById('chat-search')?.addEventListener('input', (e) => {
      this.searchQuery = (e.target as HTMLInputElement).value;
      this.renderChatList();
    });

    // Folder tabs
    document.querySelectorAll('.folder-tab').forEach((tab) => {
      tab.addEventListener('click', () => {
        document.querySelectorAll('.folder-tab').forEach((t) => t.classList.remove('active'));
        tab.classList.add('active');
        this.currentFilter = tab.getAttribute('data-folder') || 'all';
        this.renderChatList();
      });
    });

    // Header buttons
    document.getElementById('btn-open-themes')?.addEventListener('click', () => {
      document.getElementById('theme-modal')!.classList.add('open');
      this.renderThemeGrid();
      this.loadEditorFileContent();
    });

    document.getElementById('btn-open-ai')?.addEventListener('click', () => {
      this.openAiModal('summarize');
    });

    document.getElementById('ghost-pill')?.addEventListener('click', () => {
      this.openGhostModal();
    });

    document.getElementById('btn-auth-status')?.addEventListener('click', async () => {
      const modal = document.getElementById('auth-modal');
      if (!modal) return;
      modal.classList.add('open');

      if (this.isLoggedIn()) {
        await this.showAccountStep();
      } else {
        await this.handleAuthState(this.currentAuthState);
      }
    });

    // Quick theme buttons on empty screen
    document.querySelectorAll('.btn-quick-theme').forEach((btn) => {
      btn.addEventListener('click', () => {
        const tid = btn.getAttribute('data-theme-id');
        if (tid) this.switchTheme(tid);
      });
    });

    // Modal close buttons
    document.querySelectorAll('.btn-close-modal').forEach((btn) => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.modal-backdrop').forEach((m) => m.classList.remove('open'));
      });
    });

    // Theme live editor actions
    document.getElementById('editor-file-select')?.addEventListener('change', () => {
      this.loadEditorFileContent();
    });

    document.getElementById('btn-save-editor')?.addEventListener('click', () => {
      this.saveEditorContent();
    });

    // Copy AI prompt guide
    document.getElementById('btn-copy-ai-prompt')?.addEventListener('click', async () => {
      const promptText = `
You are an expert UI/UX designer and web developer.
Create a complete custom theme package for "OpenCustom Telegram Desktop" based on my idea.
Generate the following files:
1. theme.json (id, name, author, version, description)
2. style.css (with all --tg-* CSS variables and custom rules/animations)
3. templates/message.html (custom message bubble layout using tokens {{sender}}, {{text}}, {{time}}, {{direction}}, {{status_icon}})
4. templates/chat_item.html (custom chat row layout)
5. templates/header.html (custom chat header)
6. templates/input.html (custom message composer)
7. preview.html (standalone browser mockup page)
Do not use <script> tags. Use CSS variables and declarative data-action attributes.
      `.trim();

      await navigator.clipboard.writeText(promptText);
      alert('AI Theme Prompt copied to clipboard! You can now paste it into ChatGPT, Claude, or Gemini.');
    });

    // Ghost mode save
    document.getElementById('btn-save-ghost')?.addEventListener('click', async () => {
      const chkRead = (document.getElementById('chk-ghost-read') as HTMLInputElement).checked;
      const chkTyping = (document.getElementById('chk-ghost-typing') as HTMLInputElement).checked;
      this.ghostSettings = await api.setGhostSettings({
        hide_read_receipts: chkRead,
        hide_typing: chkTyping,
      });
      this.updateGhostUI();
      document.getElementById('ghost-modal')!.classList.remove('open');
    });

    // AI modal actions
    document.getElementById('btn-ai-summarize')?.addEventListener('click', () => {
      this.executeAiRequest('summarize');
    });
    document.getElementById('btn-ai-translate')?.addEventListener('click', () => {
      const cur = this.activeChatMessages.slice(-1)[0];
      const text = cur ? (typeof cur.content === 'string' ? cur.content : (cur.content as any).text || '') : '';
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

    // Auth actions
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
      this.showStep('auth-step-qr');
      const container = document.getElementById('qr-container');
      const msg = document.getElementById('qr-status-msg');
      if (container) {
        container.innerHTML = `<div style="color: #333; font-size: 12px; padding: 16px;">Requesting QR code...</div>`;
      }
      if (msg) msg.textContent = 'Contacting Telegram authorization service...';
      try {
        await api.requestQrCode();
      } catch (err: any) {
        console.error('Request QR error:', err);
        if (container) {
          container.innerHTML = `<p style="color: #f7768e; font-size: 12px; padding: 12px;">Failed to request QR code: ${err}</p>`;
        }
        if (msg) msg.textContent = 'Click "Refresh QR" to try again or use Phone Number.';
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
      this.showStep('auth-step-phone');
    });

    document.getElementById('btn-code-back-to-phone')?.addEventListener('click', () => {
      this.showStep('auth-step-phone');
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
          this.handleAuthState('WaitPhoneNumber');
        } catch (err: any) {
          alert(`Logout failed: ${err}`);
        }
      }
    });

    // Drag and Drop Theme ZIP
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
