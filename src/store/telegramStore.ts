import { create } from "zustand";
import { telegram, TdResponse } from "../services/telegram";

export type AuthState =
  | "Initializing"
  | "WaitTdlibParameters"
  | "WaitPhoneNumber"
  | "WaitCode"
  | "WaitPassword"
  | "WaitOtherDeviceConfirmation"
  | "Ready"
  | "LoggingOut"
  | "Closed";

export interface ChatItem {
  id: number;
  title: string;
  type: {
    "@type": string;
    [key: string]: any;
  };
  unread_count: number;
  last_read_outbox_message_id?: number;
  last_read_inbox_message_id?: number;
  last_message?: {
    id: number;
    sender_id: any;
    date: number;
    content: any;
    is_outgoing: boolean;
  };
  positions: Array<{
    order: string;
    is_pinned: boolean;
  }>;
}

export interface MessageItem {
  id: number;
  chat_id: number;
  sender_id: any;
  date: number;
  is_outgoing: boolean;
  content: {
    "@type": string;
    text?: {
      text: string;
      entities: Array<{
        offset: number;
        length: number;
        type: { "@type": string; [key: string]: any };
      }>;
    };
    caption?: {
      text: string;
      entities: any[];
    };
    photo?: any;
    voice_note?: any;
    sticker?: any;
    document?: any;
    [key: string]: any;
  };
  reply_to?: {
    "@type": string;
    message_id?: number;
    [key: string]: any;
  };
  edit_date?: number;
  can_be_edited?: boolean;
}

interface TelegramStore {
  authState: AuthState;
  connectionState: string;
  qrLink: string | null;
  authError: string | null;
  currentUserId: number | null;
  users: Record<number, any>;
  chats: Record<number, ChatItem>;
  chatIds: number[];
  selectedChatId: number | null;
  messages: Record<number, MessageItem[]>;

  // Interaction State
  replyingTo: MessageItem | null;
  editingMessage: MessageItem | null;

  // Actions
  setAuthState: (state: AuthState) => void;
  setQrLink: (link: string | null) => void;
  setAuthError: (err: string | null) => void;
  setSelectedChatId: (chatId: number | null) => void;
  setReplyingTo: (msg: MessageItem | null) => void;
  setEditingMessage: (msg: MessageItem | null) => void;
  handleUpdate: (update: TdResponse) => void;
  sendMessage: (chatId: number, text: string) => Promise<void>;
  editMessageText: (chatId: number, messageId: number, text: string) => Promise<void>;
  deleteMessage: (chatId: number, messageId: number) => Promise<void>;
  loadHistory: (chatId: number) => Promise<void>;
  logout: () => Promise<void>;
}

export const useTelegramStore = create<TelegramStore>((set, get) => ({
  authState: "Initializing",
  connectionState: "Connecting",
  qrLink: null,
  authError: null,
  currentUserId: null,
  users: {},
  chats: {},
  chatIds: [],
  selectedChatId: null,
  messages: {},
  replyingTo: null,
  editingMessage: null,

  setAuthState: (authState) => set({ authState }),
  setQrLink: (qrLink) => set({ qrLink }),
  setAuthError: (authError) => set({ authError }),
  setReplyingTo: (replyingTo) => set({ replyingTo, editingMessage: null }),
  setEditingMessage: (editingMessage) => set({ editingMessage, replyingTo: null }),

  setSelectedChatId: (selectedChatId) => {
    const prevChatId = get().selectedChatId;
    if (prevChatId && prevChatId !== selectedChatId) {
      telegram.send({ "@type": "closeChat", chat_id: prevChatId }).catch(console.error);
    }

    set({ selectedChatId, replyingTo: null, editingMessage: null });

    if (selectedChatId) {
      telegram.send({ "@type": "openChat", chat_id: selectedChatId }).catch(console.error);
      get().loadHistory(selectedChatId);
    }
  },

  handleUpdate: async (update: TdResponse) => {
    const type = update["@type"];

    switch (type) {
      case "updateAuthorizationState": {
        const authStateObj = update.authorization_state;
        const subType = authStateObj["@type"];
        console.log("[TDLib Client] Auth State:", subType, authStateObj);

        if (subType === "authorizationStateWaitTdlibParameters") {
          set({ authState: "WaitTdlibParameters" });
          const paths = await telegram.getAppPaths();
          await telegram.setParameters(paths);
        } else if (subType === "authorizationStateWaitEncryptionKey") {
          telegram.send({ "@type": "checkDatabaseEncryptionKey", encryption_key: "" }).catch(console.error);
        } else if (subType === "authorizationStateWaitPhoneNumber") {
          set({ authState: "WaitPhoneNumber", authError: null });
          telegram.requestQrCode().catch(console.error);
        } else if (subType === "authorizationStateWaitOtherDeviceConfirmation") {
          set({
            authState: "WaitOtherDeviceConfirmation",
            qrLink: authStateObj.link,
            authError: null,
          });
        } else if (subType === "authorizationStateWaitCode") {
          set({ authState: "WaitCode", authError: null });
        } else if (subType === "authorizationStateWaitPassword") {
          set({ authState: "WaitPassword", authError: null });
        } else if (subType === "authorizationStateReady") {
          set({ authState: "Ready", authError: null, qrLink: null });
          // Fetch current user and load main chat list
          telegram.send({ "@type": "getMe" }).catch(console.error);
          telegram.send({
            "@type": "loadChats",
            chat_list: { "@type": "chatListMain" },
            limit: 50,
          }).catch(console.error);
        } else if (subType === "authorizationStateLoggingOut") {
          set({ authState: "LoggingOut" });
        } else if (subType === "authorizationStateClosed") {
          set({ authState: "Closed" });
        }
        break;
      }

      case "updateConnectionState": {
        const stateType = update.state["@type"];
        let conn = "Connecting";
        if (stateType === "connectionStateReady") conn = "Ready";
        else if (stateType === "connectionStateUpdating") conn = "Updating";
        else if (stateType === "connectionStateWaitingForNetwork") conn = "Waiting for network";
        set({ connectionState: conn });
        break;
      }

      case "updateUser": {
        const user = update.user;
        set((prev) => ({
          users: { ...prev.users, [user.id]: user },
          currentUserId: user.is_current_user ? user.id : prev.currentUserId,
        }));
        break;
      }

      case "updateNewChat": {
        const chat = update.chat as ChatItem;
        set((prev) => {
          const newChats = { ...prev.chats, [chat.id]: chat };
          let newIds = prev.chatIds;
          if (!newIds.includes(chat.id)) {
            newIds = [chat.id, ...newIds];
          }
          return { chats: newChats, chatIds: newIds };
        });
        break;
      }

      case "updateChatPosition": {
        const chatId = update.chat_id;
        const position = update.position;
        set((prev) => {
          const chat = prev.chats[chatId];
          if (!chat) return prev;
          const updatedChat = {
            ...chat,
            positions: [position],
          };
          // Re-sort chatIds by order
          const sortedIds = [...prev.chatIds].sort((a, b) => {
            const chatA = a === chatId ? updatedChat : prev.chats[a];
            const chatB = b === chatId ? updatedChat : prev.chats[b];
            const orderA = BigInt(chatA?.positions?.[0]?.order || "0");
            const orderB = BigInt(chatB?.positions?.[0]?.order || "0");
            return orderB > orderA ? 1 : orderB < orderA ? -1 : 0;
          });

          return {
            chats: { ...prev.chats, [chatId]: updatedChat },
            chatIds: sortedIds,
          };
        });
        break;
      }

      case "updateChatLastMessage": {
        const chatId = update.chat_id;
        const lastMsg = update.last_message;
        set((prev) => {
          const chat = prev.chats[chatId];
          if (!chat) return prev;
          return {
            chats: {
              ...prev.chats,
              [chatId]: { ...chat, last_message: lastMsg },
            },
          };
        });
        break;
      }

      case "updateChatReadOutbox": {
        const chatId = update.chat_id;
        const lastReadMsgId = update.last_read_outbox_message_id;
        set((prev) => {
          const chat = prev.chats[chatId];
          if (!chat) return prev;
          return {
            chats: {
              ...prev.chats,
              [chatId]: { ...chat, last_read_outbox_message_id: lastReadMsgId },
            },
          };
        });
        break;
      }

      case "updateChatReadInbox": {
        const chatId = update.chat_id;
        const unreadCount = update.unread_count;
        const lastReadMsgId = update.last_read_inbox_message_id;
        set((prev) => {
          const chat = prev.chats[chatId];
          if (!chat) return prev;
          return {
            chats: {
              ...prev.chats,
              [chatId]: {
                ...chat,
                unread_count: unreadCount,
                last_read_inbox_message_id: lastReadMsgId,
              },
            },
          };
        });
        break;
      }

      case "messages": {
        const extra = update["@extra"];
        if (extra && typeof extra === "string" && extra.startsWith("history_")) {
          const chatId = Number(extra.replace("history_", ""));
          const newMsgs = (update.messages || []) as MessageItem[];
          // TDLib returns newest to oldest; reverse so oldest is first
          const reversed = [...newMsgs].reverse();
          set((prev) => {
            const existing = prev.messages[chatId] || [];
            const existingIds = new Set(existing.map((m) => m.id));
            const merged = [...reversed.filter((m) => !existingIds.has(m.id)), ...existing];
            return {
              messages: {
                ...prev.messages,
                [chatId]: merged,
              },
            };
          });
        }
        break;
      }

      case "updateNewMessage": {
        const msg = update.message as MessageItem;
        set((prev) => {
          const chatMsgs = prev.messages[msg.chat_id] || [];
          if (chatMsgs.some((m) => m.id === msg.id)) {
            return prev;
          }
          return {
            messages: {
              ...prev.messages,
              [msg.chat_id]: [...chatMsgs, msg],
            },
          };
        });

        // If this message belongs to the open chat and is incoming, mark as read
        if (get().selectedChatId === msg.chat_id && !msg.is_outgoing) {
          telegram.send({
            "@type": "viewMessages",
            chat_id: msg.chat_id,
            message_ids: [msg.id],
            force_read: true,
          }).catch(console.error);
        }
        break;
      }

      case "updateMessageSendSucceeded": {
        const newMsg = update.message as MessageItem;
        const oldId = update.old_message_id;
        set((prev) => {
          const chatMsgs = prev.messages[newMsg.chat_id] || [];
          const updated = chatMsgs.map((m) => (m.id === oldId ? newMsg : m));
          return {
            messages: {
              ...prev.messages,
              [newMsg.chat_id]: updated,
            },
          };
        });
        break;
      }

      case "updateMessageContent": {
        const chatId = update.chat_id;
        const msgId = update.message_id;
        const newContent = update.new_content;
        set((prev) => {
          const chatMsgs = prev.messages[chatId] || [];
          const updated = chatMsgs.map((m) =>
            m.id === msgId ? { ...m, content: newContent } : m
          );
          return {
            messages: {
              ...prev.messages,
              [chatId]: updated,
            },
          };
        });
        break;
      }

      case "updateMessageEdited": {
        const chatId = update.chat_id;
        const msgId = update.message_id;
        const editDate = update.edit_date;
        set((prev) => {
          const chatMsgs = prev.messages[chatId] || [];
          const updated = chatMsgs.map((m) =>
            m.id === msgId ? { ...m, edit_date: editDate } : m
          );
          return {
            messages: {
              ...prev.messages,
              [chatId]: updated,
            },
          };
        });
        break;
      }

      case "updateDeleteMessages": {
        const chatId = update.chat_id;
        const deletedIds = new Set(update.message_ids);
        set((prev) => {
          const chatMsgs = prev.messages[chatId] || [];
          const filtered = chatMsgs.filter((m) => !deletedIds.has(m.id));
          return {
            messages: {
              ...prev.messages,
              [chatId]: filtered,
            },
          };
        });
        break;
      }

      default:
        break;
    }
  },

  loadHistory: async (chatId: number) => {
    await telegram.send({
      "@type": "getChatHistory",
      chat_id: chatId,
      from_message_id: 0,
      offset: 0,
      limit: 50,
      only_local: false,
      "@extra": `history_${chatId}`,
    });
  },

  sendMessage: async (chatId: number, text: string) => {
    if (!text.trim()) return;
    const { replyingTo } = get();

    const replyParam = replyingTo
      ? {
          "@type": "inputMessageReplyToMessage",
          message_id: replyingTo.id,
        }
      : undefined;

    set({ replyingTo: null });

    await telegram.send({
      "@type": "sendMessage",
      chat_id: chatId,
      reply_to: replyParam,
      input_message_content: {
        "@type": "inputMessageText",
        text: {
          "@type": "formattedText",
          text: text,
          entities: [],
        },
        clear_draft: true,
      },
    });
  },

  editMessageText: async (chatId: number, messageId: number, text: string) => {
    if (!text.trim()) return;
    set({ editingMessage: null });

    await telegram.send({
      "@type": "editMessageText",
      chat_id: chatId,
      message_id: messageId,
      input_message_content: {
        "@type": "inputMessageText",
        text: {
          "@type": "formattedText",
          text: text,
          entities: [],
        },
      },
    });
  },

  deleteMessage: async (chatId: number, messageId: number) => {
    await telegram.send({
      "@type": "deleteMessages",
      chat_id: chatId,
      message_ids: [messageId],
      revoke: true,
    });
  },

  logout: async () => {
    await telegram.logOut();
  },
}));
