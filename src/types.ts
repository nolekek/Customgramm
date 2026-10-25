export type ChatType = 'Private' | 'BasicGroup' | 'Supergroup' | 'Channel' | 'Secret';

export interface ChatPosition {
  order: number;
  is_pinned: boolean;
}

export interface ChatFolder {
  id: number;
  title: string;
  icon_name?: string;
}

export interface MessageContent {
  text?: string;
  caption?: string;
  photo?: any;
  document?: any;
  voice?: any;
  audio?: any;
}

export interface Message {
  id: number;
  chat_id: number;
  sender_id: number;
  sender_name?: string;
  date: number;
  is_outgoing: boolean;
  content: MessageContent | string;
  reply_to_message_id?: number;
  edit_date?: number;
  status: 'Sending' | 'Sent' | 'Failed';
}

export interface Chat {
  id: number;
  title: string;
  chat_type: ChatType;
  unread_count: number;
  last_read_inbox_message_id: number;
  last_read_outbox_message_id: number;
  last_message?: Message;
  position?: ChatPosition;
  is_muted: boolean;
  has_unread_mention: boolean;
  folder_ids?: number[];
}

export interface CodeInfo {
  phone_number: string;
  timeout: number;
  code_type: string;
  next_type?: string;
}

export interface PasswordHint {
  hint?: string;
  has_recovery_email: boolean;
}

export interface QrCodeInfo {
  link: string;
}

export type AuthState =
  | 'WaitTdlibParameters'
  | 'WaitPhoneNumber'
  | 'WaitCode'
  | 'WaitOtherDeviceConfirmation'
  | 'WaitPassword'
  | 'WaitRegistration'
  | 'Ready'
  | 'LoggingOut'
  | 'Closing'
  | 'Closed'
  | { WaitCode: CodeInfo }
  | { WaitPassword: PasswordHint }
  | { WaitQrCode: QrCodeInfo }
  | Record<string, any>;

export type ConnectionState =
  | 'WaitingForNetwork'
  | 'ConnectingToProxy'
  | 'Connecting'
  | 'Updating'
  | 'Ready';

export interface User {
  id: number | { 0: number } | any;
  first_name: string;
  last_name: string;
  username?: string;
  phone_number?: string;
  status?: any;
  is_contact?: boolean;
  is_bot?: boolean;
  is_verified?: boolean;
}

export interface GhostSettings {
  hide_read_receipts: boolean;
  hide_typing: boolean;
}

export interface ThemeMeta {
  id: string;
  name: string;
  author: string;
  version: string;
  description: string;
  engine_version?: string;
  tags?: string[];
}

export interface ThemeBundle {
  meta: ThemeMeta;
  css: string;
  templates: Record<string, string>;
}

export interface AiRequestPayload {
  provider: 'openai' | 'gemini';
  endpoint?: string;
  api_key: string;
  model: string;
  system_prompt?: string;
  user_prompt: string;
}
