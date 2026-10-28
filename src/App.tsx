import React, { useEffect } from "react";
import { useTelegramStore } from "./store/telegramStore";
import { telegram } from "./services/telegram";
import { Titlebar } from "./components/layout/Titlebar";
import { AuthScreen } from "./components/auth/AuthScreen";
import { ChatSidebar } from "./components/chat/ChatSidebar";
import { ChatArea } from "./components/chat/ChatArea";

export const App: React.FC = () => {
  const { authState, connectionState, handleUpdate } = useTelegramStore();

  useEffect(() => {
    let unlisten: (() => void) | undefined;

    const setup = async () => {
      try {
        await telegram.init();
        unlisten = telegram.onUpdate((update) => {
          handleUpdate(update);
        });

        // Query initial auth state in case Rust already received it before Webview loaded
        const lastAuth = await telegram.getLastAuthState();
        if (lastAuth) {
          handleUpdate(lastAuth);
        } else {
          await telegram.send({ "@type": "getAuthorizationState" });
        }
      } catch (err) {
        console.error("Failed to initialize Telegram service:", err);
      }
    };

    setup();

    return () => {
      if (unlisten) unlisten();
    };
  }, [handleUpdate]);

  return (
    <div className="h-screen w-screen flex flex-col overflow-hidden bg-[var(--bg-primary)]">
      {/* Frameless Customizable Titlebar */}
      <Titlebar statusText={connectionState} />

      {/* Main Content Area */}
      <div className="flex-1 flex overflow-hidden min-h-0">
        {authState === "Ready" ? (
          <>
            <ChatSidebar />
            <ChatArea />
          </>
        ) : (
          <AuthScreen />
        )}
      </div>
    </div>
  );
};
