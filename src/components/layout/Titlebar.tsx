import React, { useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Minus, Square, Copy, X } from "lucide-react";

interface TitlebarProps {
  statusText?: string;
}

export const Titlebar: React.FC<TitlebarProps> = ({ statusText = "Ready" }) => {
  const [isMaximized, setIsMaximized] = useState(false);

  const handleMinimize = async () => {
    try {
      await invoke("window_minimize");
    } catch (e) {
      console.error(e);
    }
  };

  const handleToggleMaximize = async () => {
    try {
      await invoke("window_toggle_maximize");
      setIsMaximized(!isMaximized);
    } catch (e) {
      console.error(e);
    }
  };

  const handleClose = async () => {
    try {
      await invoke("window_close");
    } catch (e) {
      console.error(e);
    }
  };

  return (
    <div
      data-role="titlebar"
      data-tauri-drag-region
      className="h-9 w-full flex items-center justify-between px-3 select-none z-50 shrink-0 border-b border-[var(--border-subtle)] bg-[var(--titlebar-bg)] text-[var(--titlebar-text)]"
    >
      {/* Brand & App Info */}
      <div className="flex items-center gap-2 pointer-events-none" data-tauri-drag-region>
        <div className="w-4 h-4 rounded-full bg-[var(--accent-primary)] flex items-center justify-center text-[10px] text-white font-bold">
          C
        </div>
        <span className="font-semibold text-xs tracking-wider text-[var(--text-primary)]">
          Customgramm
        </span>
        {statusText && (
          <span className="text-[11px] text-[var(--text-muted)] ml-2 border-l border-[var(--border-subtle)] pl-2">
            {statusText}
          </span>
        )}
      </div>

      {/* Window Controls */}
      <div className="flex items-center h-full -mr-3">
        <button
          onClick={handleMinimize}
          className="h-full px-3.5 flex items-center justify-center hover:bg-[var(--titlebar-btn-hover)] transition-colors text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
          title="Minimize"
        >
          <Minus size={13} />
        </button>
        <button
          onClick={handleToggleMaximize}
          className="h-full px-3.5 flex items-center justify-center hover:bg-[var(--titlebar-btn-hover)] transition-colors text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
          title="Maximize"
        >
          {isMaximized ? <Copy size={11} /> : <Square size={11} />}
        </button>
        <button
          onClick={handleClose}
          className="h-full px-3.5 flex items-center justify-center hover:bg-[var(--titlebar-btn-close-hover)] hover:text-white transition-colors text-[var(--text-secondary)]"
          title="Close"
        >
          <X size={13} />
        </button>
      </div>
    </div>
  );
};
