import { invoke } from "@tauri-apps/api/core";
import { listen, UnlistenFn } from "@tauri-apps/api/event";

export interface AppPaths {
  database_directory: string;
  files_directory: string;
  is_portable: boolean;
}

export interface TdResponse {
  "@type": string;
  [key: string]: any;
}

type UpdateCallback = (update: TdResponse) => void;

class TelegramService {
  private updateCallbacks: Set<UpdateCallback> = new Set();
  private unlistenUpdate: UnlistenFn | null = null;
  private isInitialized = false;

  async init(): Promise<void> {
    if (this.isInitialized) return;

    this.unlistenUpdate = await listen<string>("tdlib_update", (event) => {
      try {
        const parsed = JSON.parse(event.payload);
        this.notify(parsed);
      } catch (err) {
        console.error("[TDLib] Failed to parse update JSON:", err, event.payload);
      }
    });

    this.isInitialized = true;
    console.log("[TelegramService] Initialized TDLib update listener.");
  }

  destroy(): void {
    if (this.unlistenUpdate) {
      this.unlistenUpdate();
      this.unlistenUpdate = null;
    }
    this.isInitialized = false;
  }

  onUpdate(callback: UpdateCallback): () => void {
    this.updateCallbacks.add(callback);
    return () => this.updateCallbacks.delete(callback);
  }

  private notify(update: TdResponse) {
    for (const cb of this.updateCallbacks) {
      try {
        cb(update);
      } catch (e) {
        console.error("[TelegramService] Error in update callback:", e);
      }
    }
  }

  async send(request: object): Promise<void> {
    const raw = JSON.stringify(request);
    await invoke("tdlib_send", { request: raw });
  }

  async execute(request: object): Promise<TdResponse | null> {
    const raw = JSON.stringify(request);
    const res = await invoke<string | null>("tdlib_execute", { request: raw });
    if (!res) return null;
    try {
      return JSON.parse(res);
    } catch {
      return null;
    }
  }

  async getAppPaths(): Promise<AppPaths> {
    return await invoke<AppPaths>("tdlib_get_paths");
  }

  // High-level Auth Helpers
  async setParameters(paths: AppPaths, apiId = 2040, apiHash = "b18441a1ff607e10a989891a5462e627") {
    await this.send({
      "@type": "setTdlibParameters",
      use_test_dc: false,
      database_directory: paths.database_directory,
      files_directory: paths.files_directory,
      use_file_database: true,
      use_chat_info_database: true,
      use_message_database: true,
      use_secret_chats: false,
      api_id: apiId,
      api_hash: apiHash,
      system_language_code: "en",
      device_model: "Desktop",
      system_version: "Windows 11",
      application_version: "0.1.0",
      enable_storage_optimizer: true,
    });
  }

  async requestQrCode() {
    await this.send({ "@type": "requestQrCode" });
  }

  async setAuthenticationPhoneNumber(phoneNumber: string) {
    await this.send({
      "@type": "setAuthenticationPhoneNumber",
      phone_number: phoneNumber,
    });
  }

  async checkAuthenticationCode(code: string) {
    await this.send({
      "@type": "checkAuthenticationCode",
      code: code,
    });
  }

  async checkAuthenticationPassword(password: string) {
    await this.send({
      "@type": "checkAuthenticationPassword",
      password: password,
    });
  }

  async logOut() {
    await this.send({ "@type": "logOut" });
  }
}

export const telegram = new TelegramService();
