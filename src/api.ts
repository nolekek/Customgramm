import { invoke } from '@tauri-apps/api/core';
import { listen, UnlistenFn } from '@tauri-apps/api/event';
import type {
  Chat,
  Message,
  GhostSettings,
  ThemeMeta,
  ThemeBundle,
  AiRequestPayload,
} from './types';

export const api = {
  // Auth
  async sendPhoneNumber(phone: string): Promise<void> {
    return invoke('auth_send_phone_number', { phone });
  },
  async sendCode(code: string): Promise<void> {
    return invoke('auth_send_code', { code });
  },
  async sendPassword(password: string): Promise<void> {
    return invoke('auth_send_password', { password });
  },
  async requestQrCode(): Promise<void> {
    return invoke('auth_request_qr_code');
  },
  async logOut(): Promise<void> {
    return invoke('auth_log_out');
  },

  // State & Data
  async getState(): Promise<any> {
    return invoke('get_state');
  },
  async getChats(): Promise<Chat[]> {
    return invoke('get_chats');
  },
  async getMessages(chatId: number): Promise<Message[]> {
    return invoke('get_messages', { chatId });
  },
  async loadHistory(chatId: number, fromMsgId?: number, limit = 30): Promise<void> {
    return invoke('load_history', { chatId, fromMsgId, limit });
  },
  async sendMessage(chatId: number, text: string, replyTo?: number): Promise<void> {
    return invoke('send_message', { chatId, text, replyTo });
  },
  async editMessage(chatId: number, messageId: number, text: string): Promise<void> {
    return invoke('edit_message', { chatId, messageId, text });
  },
  async deleteMessages(chatId: number, messageIds: number[], revoke = true): Promise<void> {
    return invoke('delete_messages', { chatId, messageIds, revoke });
  },

  // Ghost Mode
  async getGhostSettings(): Promise<GhostSettings> {
    return invoke('get_ghost_settings');
  },
  async setGhostSettings(settings: GhostSettings): Promise<GhostSettings> {
    return invoke('set_ghost_settings', { settings });
  },

  // Themes
  async listThemes(): Promise<ThemeMeta[]> {
    return invoke('list_themes');
  },
  async loadTheme(themeId: string): Promise<ThemeBundle> {
    return invoke('load_theme', { themeId });
  },
  async saveThemeFile(themeId: string, fileName: string, content: string): Promise<void> {
    return invoke('save_theme_file', { themeId, fileName, content });
  },
  async importThemeZip(zipBase64: string): Promise<ThemeMeta> {
    return invoke('import_theme_zip', { zipBase64 });
  },

  // AI Assistant
  async aiGenerate(payload: AiRequestPayload): Promise<string> {
    return invoke('ai_generate', { payload });
  },

  // Events
  onTgEvent(callback: (event: any) => void): Promise<UnlistenFn> {
    return listen('tg://event', (e) => callback(e.payload));
  },
};
