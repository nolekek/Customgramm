import type { ThemeBundle } from './types';

export class ThemeEngine {
  private activeBundle: ThemeBundle | null = null;
  private styleElement: HTMLStyleElement;
  private onThemeChangeListeners: Array<(bundle: ThemeBundle) => void> = [];

  // Default fallback templates
  private fallbackTemplates: Record<string, string> = {
    'message.html': `
      <div class="msg-container msg-{{direction}}" data-msg-id="{{id}}">
        <div class="msg-bubble">
          {{reply_preview}}
          <div class="msg-header"><span class="msg-sender">{{sender}}</span></div>
          {{media_html}}
          <div class="msg-content">{{text}}</div>
          <div class="msg-footer">
            <span class="msg-time">{{time}}</span>
            <span class="msg-status">{{status_icon}}</span>
            <div class="msg-actions">
              <button class="msg-btn" data-action="reply" title="Reply">{{icon_reply}}</button>
              <button class="msg-btn" data-action="copy" title="Copy text">{{icon_copy}}</button>
              <button class="msg-btn" data-action="ai-translate" title="Translate">{{icon_translate}}</button>
            </div>
          </div>
        </div>
      </div>
    `.trim(),

    'chat_item.html': `
      <div class="chat-row {{active_class}}" data-chat-id="{{id}}" data-action="select-chat">
        <div class="chat-avatar" style="{{avatar_style}}" data-avatar-path="{{photo_path}}">
          {{avatar_content}}
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
    `.trim(),

    'header.html': `
      <div class="chat-header-bar">
        <div class="chat-header-info">
          <div class="chat-header-avatar" style="{{avatar_style}}" data-avatar-path="{{photo_path}}">{{avatar_content}}</div>
          <div class="chat-header-text">
            <h2 class="chat-header-title">{{title}}</h2>
            <span class="chat-header-status">{{status}}</span>
          </div>
        </div>
        <div class="chat-header-actions">
          <button class="btn-header" data-action="ai-summarize-chat" title="Summarize conversation with AI">
            {{icon_sparkles}}
            <span>Summarize</span>
          </button>
          <button class="btn-header" data-action="toggle-ghost" title="Toggle Ghost Mode">
            {{icon_ghost}}
            <span>Ghost</span>
          </button>
        </div>
      </div>
    `.trim(),

    'input.html': `
      <div class="chat-input-bar">
        {{reply_banner_html}}
        <div class="input-row">
          <button class="btn-input-tool" data-action="attach-file" title="Attach file">{{icon_attach}}</button>
          <textarea class="chat-textarea" placeholder="{{placeholder}}" rows="1"></textarea>
          <button class="btn-input-tool" data-action="ai-assist" title="AI Draft Assistant">{{icon_sparkles}}</button>
          <button class="btn-send" data-action="send-message" title="Send (Enter)">{{icon_send}}</button>
        </div>
      </div>
    `.trim(),
  };

  constructor() {
    let el = document.getElementById('app-active-theme') as HTMLStyleElement;
    if (!el) {
      el = document.createElement('style');
      el.id = 'app-active-theme';
      document.head.appendChild(el);
    }
    this.styleElement = el;
  }

  public getActiveTheme(): ThemeBundle | null {
    return this.activeBundle;
  }

  public applyTheme(bundle: ThemeBundle) {
    this.activeBundle = bundle;
    this.styleElement.textContent = bundle.css;
    document.documentElement.setAttribute('data-theme', bundle.meta.id);
    this.notifyListeners(bundle);
  }

  public onThemeChanged(cb: (bundle: ThemeBundle) => void) {
    this.onThemeChangeListeners.push(cb);
  }

  private notifyListeners(bundle: ThemeBundle) {
    for (const listener of this.onThemeChangeListeners) {
      try {
        listener(bundle);
      } catch (err) {
        console.error('Error in theme change listener:', err);
      }
    }
  }

  public renderTemplate(templateName: string, tokens: Record<string, string>): string {
    let template =
      (this.activeBundle && this.activeBundle.templates[templateName]) ||
      this.fallbackTemplates[templateName] ||
      '';

    for (const [key, val] of Object.entries(tokens)) {
      const regex = new RegExp(`\\{\\{${key}\\}\\}`, 'g');
      template = template.replace(regex, val ?? '');
    }

    return template;
  }
}

export const themeEngine = new ThemeEngine();
