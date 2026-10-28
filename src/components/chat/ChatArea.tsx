import React, { useState, useRef, useEffect } from "react";
import { useTelegramStore } from "../../store/telegramStore";
import { EntityParser } from "./EntityParser";
import { Send, Paperclip, Smile, MoreVertical, Search, CheckCheck, FileText, Mic, Image as ImageIcon } from "lucide-react";

export const ChatArea: React.FC = () => {
  const { chats, selectedChatId, messages, sendMessage } = useTelegramStore();
  const [inputText, setInputText] = useState("");
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const activeChat = selectedChatId ? chats[selectedChatId] : null;
  const chatMessages = selectedChatId ? messages[selectedChatId] || [] : [];

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  useEffect(() => {
    scrollToBottom();
  }, [chatMessages.length]);

  const handleSend = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!inputText.trim() || !selectedChatId) return;

    const text = inputText;
    setInputText("");
    await sendMessage(selectedChatId, text);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const formatMessageTime = (date: number) => {
    return new Date(date * 1000).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  };

  if (!activeChat) {
    return (
      <div className="flex-1 h-full flex flex-col items-center justify-center bg-[var(--bg-primary)] text-[var(--text-muted)] select-none">
        <div className="w-16 h-16 rounded-full bg-[var(--bg-card)] border border-[var(--border-subtle)] flex items-center justify-center text-[var(--text-muted)] mb-3">
          <Send size={24} className="ml-1 text-[var(--accent-primary)] opacity-70" />
        </div>
        <p className="text-sm font-medium">Select a conversation to start messaging</p>
      </div>
    );
  }

  return (
    <div
      data-role="chat-area"
      className="flex-1 h-full flex flex-col bg-[var(--bg-primary)] text-[var(--text-primary)] min-w-0"
    >
      {/* Active Chat Header */}
      <div
        data-role="chat-header"
        className="h-14 px-4 flex items-center justify-between border-b border-[var(--border-subtle)] bg-[var(--bg-secondary)] select-none shrink-0"
      >
        <div className="flex items-center gap-3 min-w-0">
          <div className="w-9 h-9 rounded-full bg-blue-600 flex items-center justify-center text-white font-bold text-sm shrink-0">
            {activeChat.title.slice(0, 1).toUpperCase()}
          </div>
          <div className="flex flex-col min-w-0">
            <span className="font-semibold text-xs text-[var(--text-primary)] truncate">
              {activeChat.title}
            </span>
            <span className="text-[11px] text-[var(--text-muted)] truncate">
              conversation
            </span>
          </div>
        </div>

        <div className="flex items-center gap-1 text-[var(--text-secondary)]">
          <button className="p-2 rounded-lg hover:bg-[var(--bg-hover)] transition-colors hover:text-[var(--text-primary)]">
            <Search size={16} />
          </button>
          <button className="p-2 rounded-lg hover:bg-[var(--bg-hover)] transition-colors hover:text-[var(--text-primary)]">
            <MoreVertical size={16} />
          </button>
        </div>
      </div>

      {/* Message Stream */}
      <div
        data-role="messages-stream"
        className="flex-1 overflow-y-auto p-4 space-y-2.5 flex flex-col"
      >
        {chatMessages.length === 0 ? (
          <div className="flex-1 flex items-center justify-center text-xs text-[var(--text-muted)]">
            No messages yet. Say hello!
          </div>
        ) : (
          chatMessages.map((msg) => {
            const isOutgoing = msg.is_outgoing;
            const content = msg.content;
            const type = content["@type"];

            return (
              <div
                key={msg.id}
                data-role="message-row"
                className={`flex w-full ${isOutgoing ? "justify-end" : "justify-start"}`}
              >
                <div
                  data-role="message-bubble"
                  data-outgoing={isOutgoing ? "true" : "false"}
                  className={`max-w-[70%] rounded-[var(--radius-bubble)] px-3.5 py-2 shadow-sm text-xs relative flex flex-col gap-1 ${
                    isOutgoing
                      ? "bg-[var(--bubble-out-bg)] text-[var(--bubble-out-text)] rounded-br-none"
                      : "bg-[var(--bubble-in-bg)] text-[var(--bubble-in-text)] rounded-bl-none border border-[var(--border-subtle)]"
                  }`}
                >
                  {/* Text Message */}
                  {type === "messageText" && content.text && (
                    <EntityParser text={content.text.text} entities={content.text.entities} />
                  )}

                  {/* Photo Preview */}
                  {type === "messagePhoto" && (
                    <div className="flex flex-col gap-1.5">
                      <div className="rounded-lg overflow-hidden bg-black/20 flex items-center justify-center p-4">
                        <ImageIcon size={32} className="opacity-70" />
                        <span className="ml-2 font-medium">Photo</span>
                      </div>
                      {content.caption?.text && (
                        <EntityParser text={content.caption.text} entities={content.caption.entities} />
                      )}
                    </div>
                  )}

                  {/* Voice Note */}
                  {type === "messageVoiceNote" && (
                    <div className="flex items-center gap-2 p-1">
                      <div className="w-8 h-8 rounded-full bg-white/20 flex items-center justify-center cursor-pointer">
                        <Mic size={14} />
                      </div>
                      <div className="flex flex-col">
                        <span className="font-semibold text-[11px]">Voice Message</span>
                        <span className="text-[10px] opacity-80 font-mono">
                          {content.voice_note?.duration || 0}s
                        </span>
                      </div>
                    </div>
                  )}

                  {/* Document / File */}
                  {type === "messageDocument" && (
                    <div className="flex items-center gap-2.5 p-1.5 rounded bg-black/10">
                      <FileText size={20} className="shrink-0 opacity-80" />
                      <div className="flex flex-col truncate">
                        <span className="font-semibold truncate">
                          {content.document?.file_name || "Document"}
                        </span>
                        <span className="text-[10px] opacity-75 font-mono">
                          {content.document?.document?.size
                            ? `${(content.document.document.size / 1024).toFixed(1)} KB`
                            : ""}
                        </span>
                      </div>
                    </div>
                  )}

                  {/* Sticker */}
                  {type === "messageSticker" && (
                    <div className="p-2 text-2xl">
                      {content.sticker?.emoji || "🎨"}
                    </div>
                  )}

                  {/* Timestamp & Status Indicator */}
                  <div className="flex items-center justify-end gap-1 self-end text-[10px] opacity-70 font-mono mt-0.5 select-none">
                    <span>{formatMessageTime(msg.date)}</span>
                    {isOutgoing && (
                      <span title="Sent">
                        <CheckCheck size={12} />
                      </span>
                    )}
                  </div>
                </div>
              </div>
            );
          })
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Message Input Composer */}
      <form
        onSubmit={handleSend}
        data-role="message-composer"
        className="p-3 border-t border-[var(--border-subtle)] bg-[var(--bg-secondary)] flex items-end gap-2"
      >
        <button
          type="button"
          className="p-2 rounded-lg text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)] transition-colors shrink-0"
          title="Attach file"
        >
          <Paperclip size={18} />
        </button>

        <div className="flex-1 bg-[var(--bg-primary)] rounded-[var(--radius-input)] border border-[var(--border-subtle)] focus-within:border-[var(--accent-primary)] transition-colors flex items-center px-3 py-1.5 min-h-[42px]">
          <textarea
            value={inputText}
            onChange={(e) => setInputText(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Write a message..."
            rows={1}
            className="w-full bg-transparent resize-none outline-none text-xs text-[var(--text-primary)] placeholder-[var(--text-muted)] max-h-32"
          />
          <button
            type="button"
            className="text-[var(--text-secondary)] hover:text-[var(--text-primary)] p-1 shrink-0"
            title="Emoji / Stickers"
          >
            <Smile size={16} />
          </button>
        </div>

        <button
          type="submit"
          disabled={!inputText.trim()}
          className="w-10 h-10 rounded-[var(--radius-input)] bg-[var(--accent-primary)] hover:bg-[var(--accent-hover)] disabled:opacity-40 text-white flex items-center justify-center transition-colors shrink-0 shadow-sm"
          title="Send message"
        >
          <Send size={16} className="ml-0.5" />
        </button>
      </form>
    </div>
  );
};
