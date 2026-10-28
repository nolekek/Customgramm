import React, { useState, useMemo } from "react";
import { useTelegramStore, ChatItem } from "../../store/telegramStore";
import { Search, Pin, Users, User, Radio, MessageSquare } from "lucide-react";

export const ChatSidebar: React.FC = () => {
  const { chats, chatIds, selectedChatId, setSelectedChatId } = useTelegramStore();
  const [searchQuery, setSearchQuery] = useState("");
  const [activeFolder, setActiveFolder] = useState<"all" | "personal" | "groups" | "channels">("all");

  const getChatSubtitle = (chat: ChatItem) => {
    if (!chat.last_message) return "No messages yet";
    const content = chat.last_message.content;
    const type = content["@type"];

    if (type === "messageText") {
      return content.text?.text || "";
    } else if (type === "messagePhoto") {
      return "📷 Photo";
    } else if (type === "messageVoiceNote") {
      return "🎤 Voice message";
    } else if (type === "messageSticker") {
      return "🎨 Sticker";
    } else if (type === "messageDocument") {
      return "📁 Document";
    }
    return "Message";
  };

  const formatChatTime = (timestamp?: number) => {
    if (!timestamp) return "";
    const date = new Date(timestamp * 1000);
    const now = new Date();
    if (date.toDateString() === now.toDateString()) {
      return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
    }
    return date.toLocaleDateString([], { month: "short", day: "numeric" });
  };

  const filteredChatList = useMemo(() => {
    return chatIds
      .map((id) => chats[id])
      .filter((chat): chat is ChatItem => {
        if (!chat) return false;

        // Search query filter
        if (searchQuery.trim()) {
          const query = searchQuery.toLowerCase();
          const titleMatches = chat.title.toLowerCase().includes(query);
          const subtitleMatches = getChatSubtitle(chat).toLowerCase().includes(query);
          if (!titleMatches && !subtitleMatches) return false;
        }

        // Folder filter
        if (activeFolder === "all") return true;
        const type = chat.type["@type"];
        if (activeFolder === "personal") return type === "chatTypePrivate" || type === "chatTypeSecret";
        if (activeFolder === "groups") return type === "chatTypeBasicGroup" || (type === "chatTypeSupergroup" && !chat.type.is_channel);
        if (activeFolder === "channels") return type === "chatTypeSupergroup" && chat.type.is_channel;
        return true;
      });
  }, [chats, chatIds, searchQuery, activeFolder]);

  // Stable avatar colors based on chat title hash
  const getAvatarBg = (title: string) => {
    const colors = [
      "bg-blue-600",
      "bg-indigo-600",
      "bg-purple-600",
      "bg-rose-600",
      "bg-amber-600",
      "bg-emerald-600",
      "bg-teal-600",
      "bg-cyan-600",
    ];
    let hash = 0;
    for (let i = 0; i < title.length; i++) {
      hash = title.charCodeAt(i) + ((hash << 5) - hash);
    }
    return colors[Math.abs(hash) % colors.length];
  };

  return (
    <div
      data-role="sidebar"
      className="w-80 h-full flex flex-col border-r border-[var(--border-subtle)] bg-[var(--bg-sidebar)] select-none shrink-0"
    >
      {/* Search Header */}
      <div className="p-3 pb-2 flex flex-col gap-2">
        <div className="relative">
          <input
            type="text"
            placeholder="Search chats..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full pl-9 pr-3 py-1.5 rounded-[var(--radius-input)] bg-[var(--bg-secondary)] border border-[var(--border-subtle)] text-xs text-[var(--text-primary)] placeholder-[var(--text-muted)] focus:outline-none focus:border-[var(--accent-primary)] transition-colors"
          />
          <Search size={14} className="absolute left-3 top-2.5 text-[var(--text-muted)] pointer-events-none" />
        </div>

        {/* Folder Tabs */}
        <div className="flex items-center gap-1 border-b border-[var(--border-divider)] pb-1.5 overflow-x-auto">
          {[
            { id: "all", label: "All", icon: MessageSquare },
            { id: "personal", label: "Personal", icon: User },
            { id: "groups", label: "Groups", icon: Users },
            { id: "channels", label: "Channels", icon: Radio },
          ].map((tab) => {
            const Icon = tab.icon;
            const isActive = activeFolder === tab.id;
            return (
              <button
                key={tab.id}
                onClick={() => setActiveFolder(tab.id as any)}
                className={`flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-medium transition-colors whitespace-nowrap ${
                  isActive
                    ? "bg-[var(--accent-light)] text-[var(--accent-primary)] font-semibold"
                    : "text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]"
                }`}
              >
                <Icon size={12} />
                <span>{tab.label}</span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Chat List Stream */}
      <div className="flex-1 overflow-y-auto px-1.5 space-y-0.5">
        {filteredChatList.length === 0 ? (
          <div className="p-8 text-center text-xs text-[var(--text-muted)]">
            {searchQuery ? "No chats found" : "Loading conversations..."}
          </div>
        ) : (
          filteredChatList.map((chat) => {
            const isSelected = selectedChatId === chat.id;
            const isPinned = chat.positions?.[0]?.is_pinned;
            const subtitle = getChatSubtitle(chat);
            const timeStr = formatChatTime(chat.last_message?.date);

            return (
              <div
                key={chat.id}
                data-role="chat-item"
                data-selected={isSelected}
                onClick={() => setSelectedChatId(chat.id)}
                className={`flex items-center gap-3 p-2.5 rounded-[var(--radius-card)] cursor-pointer transition-colors relative ${
                  isSelected
                    ? "bg-[var(--bg-active)] text-[var(--text-primary)]"
                    : "hover:bg-[var(--bg-hover)] text-[var(--text-secondary)]"
                }`}
              >
                {/* Chat Avatar */}
                <div
                  className={`w-11 h-11 rounded-full flex items-center justify-center font-bold text-white shrink-0 text-sm shadow-sm ${getAvatarBg(
                    chat.title
                  )}`}
                >
                  {chat.title.slice(0, 1).toUpperCase()}
                </div>

                {/* Chat Details */}
                <div className="flex-1 min-w-0 flex flex-col justify-center">
                  <div className="flex items-center justify-between gap-1 mb-0.5">
                    <span className="font-semibold text-xs truncate text-[var(--text-primary)]">
                      {chat.title}
                    </span>
                    <span className="text-[10px] text-[var(--text-muted)] shrink-0 font-mono">
                      {timeStr}
                    </span>
                  </div>

                  <div className="flex items-center justify-between gap-1">
                    <span className="text-[11px] truncate text-[var(--text-muted)]">
                      {subtitle}
                    </span>

                    <div className="flex items-center gap-1.5 shrink-0">
                      {isPinned && <Pin size={11} className="text-[var(--accent-primary)]" />}
                      {chat.unread_count > 0 && (
                        <span
                          data-role="unread-badge"
                          className="px-1.5 py-0.5 rounded-full text-[10px] font-bold leading-none bg-[var(--status-unread-badge)] text-[var(--status-unread-text)] min-w-[18px] text-center"
                        >
                          {chat.unread_count}
                        </span>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
};
