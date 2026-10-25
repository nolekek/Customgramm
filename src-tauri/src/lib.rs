use std::collections::HashMap;
use std::fs;
use std::io::Cursor;
use std::path::PathBuf;

use parking_lot::RwLock;
use serde::{Deserialize, Serialize};
use tauri::{Emitter, Manager, State};
use zip::ZipArchive;

use tg_core::domain::{Chat, ChatId, Message, MessageId};
use tg_core::handle::CoreHandle;
use tg_core::state::CoreState;
use tg_core::{Config, Engine};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GhostSettings {
    pub hide_read_receipts: bool,
    pub hide_typing: bool,
}

impl Default for GhostSettings {
    fn default() -> Self {
        Self {
            hide_read_receipts: true,
            hide_typing: true,
        }
    }
}

pub struct AppState {
    pub handle: CoreHandle,
    pub ghost: RwLock<GhostSettings>,
    pub themes_dir: PathBuf,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ThemeMeta {
    pub id: String,
    pub name: String,
    pub author: String,
    pub version: String,
    pub description: String,
    pub engine_version: Option<String>,
    #[serde(default)]
    pub tags: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ThemeBundle {
    pub meta: ThemeMeta,
    pub css: String,
    pub templates: HashMap<String, String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AiRequestPayload {
    pub provider: String,
    pub endpoint: Option<String>,
    pub api_key: String,
    pub model: String,
    pub system_prompt: Option<String>,
    pub user_prompt: String,
}

// ---------------------------------------------------------------------------
// Auth IPC Commands
// ---------------------------------------------------------------------------

#[tauri::command]
async fn auth_send_phone_number(phone: String, state: State<'_, AppState>) -> Result<(), String> {
    state.handle.send_phone_number(phone).await.map_err(|e| e.to_string())
}

#[tauri::command]
async fn auth_send_code(code: String, state: State<'_, AppState>) -> Result<(), String> {
    state.handle.send_code(code).await.map_err(|e| e.to_string())
}

#[tauri::command]
async fn auth_send_password(password: String, state: State<'_, AppState>) -> Result<(), String> {
    state.handle.send_password(password).await.map_err(|e| e.to_string())
}

#[tauri::command]
async fn auth_request_qr_code(state: State<'_, AppState>) -> Result<(), String> {
    state.handle.request_qr_code().await.map_err(|e| e.to_string())
}

#[tauri::command]
async fn auth_log_out(state: State<'_, AppState>) -> Result<(), String> {
    state.handle.log_out().await.map_err(|e| e.to_string())
}

// ---------------------------------------------------------------------------
// Telegram State & Messaging IPC Commands
// ---------------------------------------------------------------------------

#[tauri::command]
fn get_state(state: State<'_, AppState>) -> CoreState {
    state.handle.clone_state()
}

#[tauri::command]
fn get_chats(state: State<'_, AppState>) -> Vec<Chat> {
    let s = state.handle.read_state();
    let mut result = Vec::new();

    for id in &s.ordered_chats {
        if let Some(chat) = s.chats.get(id) {
            result.push(chat.clone());
        }
    }

    for (id, chat) in &s.chats {
        if !s.ordered_chats.contains(id) {
            result.push(chat.clone());
        }
    }

    result
}

#[tauri::command]
fn get_messages(chat_id: i64, state: State<'_, AppState>) -> Vec<Message> {
    let s = state.handle.read_state();
    s.messages.get(&ChatId(chat_id)).cloned().unwrap_or_default()
}

#[tauri::command]
async fn load_history(
    chat_id: i64,
    from_msg_id: Option<i64>,
    limit: i32,
    state: State<'_, AppState>,
) -> Result<(), String> {
    state
        .handle
        .load_history(ChatId(chat_id), from_msg_id.map(MessageId), limit)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
async fn send_message(
    chat_id: i64,
    text: String,
    reply_to: Option<i64>,
    state: State<'_, AppState>,
) -> Result<(), String> {
    state
        .handle
        .send_text_message(ChatId(chat_id), text, reply_to.map(MessageId))
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
async fn edit_message(
    chat_id: i64,
    message_id: i64,
    text: String,
    state: State<'_, AppState>,
) -> Result<(), String> {
    state
        .handle
        .edit_message_text(ChatId(chat_id), MessageId(message_id), text)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
async fn delete_messages(
    chat_id: i64,
    message_ids: Vec<i64>,
    revoke: bool,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let ids: Vec<MessageId> = message_ids.into_iter().map(MessageId).collect();
    state
        .handle
        .delete_messages(ChatId(chat_id), ids, revoke)
        .await
        .map_err(|e| e.to_string())
}

// ---------------------------------------------------------------------------
// Ghost Mode IPC Commands
// ---------------------------------------------------------------------------

#[tauri::command]
fn get_ghost_settings(state: State<'_, AppState>) -> GhostSettings {
    state.ghost.read().clone()
}

#[tauri::command]
fn set_ghost_settings(settings: GhostSettings, state: State<'_, AppState>) -> GhostSettings {
    let mut g = state.ghost.write();
    *g = settings.clone();
    settings
}

// ---------------------------------------------------------------------------
// Themes IPC Commands
// ---------------------------------------------------------------------------

fn resolve_themes_directory() -> PathBuf {
    let candidates = [
        PathBuf::from("themes"),
        PathBuf::from("../themes"),
        dirs::data_dir().map(|d| d.join("opencustom-telegram").join("themes")).unwrap_or_default(),
    ];
    for c in &candidates {
        if c.exists() && c.is_dir() {
            return c.clone();
        }
    }
    let dir = PathBuf::from("themes");
    let _ = fs::create_dir_all(&dir);
    dir
}

#[tauri::command]
fn list_themes(state: State<'_, AppState>) -> Result<Vec<ThemeMeta>, String> {
    let mut list = Vec::new();
    let themes_dir = &state.themes_dir;

    if !themes_dir.exists() {
        return Ok(list);
    }

    let entries = fs::read_dir(themes_dir).map_err(|e| e.to_string())?;
    for entry in entries.flatten() {
        let path = entry.path();
        if path.is_dir() {
            let meta_path = path.join("theme.json");
            if meta_path.exists() {
                if let Ok(content) = fs::read_to_string(&meta_path) {
                    if let Ok(meta) = serde_json::from_str::<ThemeMeta>(&content) {
                        list.push(meta);
                    }
                }
            }
        }
    }

    list.sort_by(|a, b| a.name.cmp(&b.name));
    Ok(list)
}

#[tauri::command]
fn load_theme(theme_id: String, state: State<'_, AppState>) -> Result<ThemeBundle, String> {
    let theme_dir = state.themes_dir.join(&theme_id);
    if !theme_dir.exists() {
        return Err(format!("Theme directory '{}' does not exist", theme_id));
    }

    let meta_file = theme_dir.join("theme.json");
    let meta_content = fs::read_to_string(&meta_file)
        .map_err(|e| format!("Failed to read theme.json: {}", e))?;
    let meta: ThemeMeta = serde_json::from_str(&meta_content)
        .map_err(|e| format!("Invalid theme.json format: {}", e))?;

    let css_file = theme_dir.join("style.css");
    let css = fs::read_to_string(&css_file).unwrap_or_default();

    let mut templates = HashMap::new();
    let tpl_dir = theme_dir.join("templates");
    if tpl_dir.exists() && tpl_dir.is_dir() {
        if let Ok(entries) = fs::read_dir(&tpl_dir) {
            for entry in entries.flatten() {
                let path = entry.path();
                if path.is_file() {
                    if let Some(file_name) = path.file_name().and_then(|n| n.to_str()) {
                        if let Ok(content) = fs::read_to_string(&path) {
                            templates.insert(file_name.to_string(), content);
                        }
                    }
                }
            }
        }
    }

    Ok(ThemeBundle { meta, css, templates })
}

#[tauri::command]
fn save_theme_file(
    theme_id: String,
    file_name: String,
    content: String,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let theme_dir = state.themes_dir.join(&theme_id);
    if !theme_dir.exists() {
        return Err(format!("Theme directory '{}' does not exist", theme_id));
    }

    let target_path = if file_name.starts_with("templates/") {
        let sub = file_name.trim_start_matches("templates/");
        let tpl_dir = theme_dir.join("templates");
        let _ = fs::create_dir_all(&tpl_dir);
        tpl_dir.join(sub)
    } else {
        theme_dir.join(&file_name)
    };

    fs::write(&target_path, content).map_err(|e| e.to_string())
}

#[tauri::command]
fn import_theme_zip(zip_base64: String, state: State<'_, AppState>) -> Result<ThemeMeta, String> {
    use base64::engine::general_purpose::STANDARD as BASE64;
    use base64::Engine as _;

    let bytes = BASE64.decode(zip_base64.trim()).map_err(|e| format!("Base64 error: {}", e))?;
    let reader = Cursor::new(bytes);
    let mut archive = ZipArchive::new(reader).map_err(|e| format!("ZIP error: {}", e))?;

    let temp_id = format!("imported-theme-{}", chrono::Utc::now().timestamp());
    let mut target_dir = state.themes_dir.join(&temp_id);

    for i in 0..archive.len() {
        let mut file = archive.by_index(i).map_err(|e| e.to_string())?;
        let outpath = match file.enclosed_name() {
            Some(path) => state.themes_dir.join(path),
            None => continue,
        };

        if file.name().ends_with('/') {
            fs::create_dir_all(&outpath).map_err(|e| e.to_string())?;
        } else {
            if let Some(p) = outpath.parent() {
                if !p.exists() {
                    fs::create_dir_all(p).map_err(|e| e.to_string())?;
                }
            }
            let mut outfile = fs::File::create(&outpath).map_err(|e| e.to_string())?;
            std::io::copy(&mut file, &mut outfile).map_err(|e| e.to_string())?;
            if outpath.file_name().and_then(|n| n.to_str()) == Some("theme.json") {
                if let Some(parent) = outpath.parent() {
                    target_dir = parent.to_path_buf();
                }
            }
        }
    }

    let meta_file = target_dir.join("theme.json");
    if !meta_file.exists() {
        return Err("Imported theme archive does not contain theme.json".to_string());
    }

    let meta_content = fs::read_to_string(&meta_file).map_err(|e| e.to_string())?;
    let meta: ThemeMeta = serde_json::from_str(&meta_content).map_err(|e| e.to_string())?;
    Ok(meta)
}

// ---------------------------------------------------------------------------
// AI Assistant IPC Command
// ---------------------------------------------------------------------------

#[tauri::command]
async fn ai_generate(payload: AiRequestPayload) -> Result<String, String> {
    let client = reqwest::Client::new();

    if payload.provider == "gemini" {
        let endpoint = payload.endpoint.unwrap_or_else(|| {
            format!(
                "https://generativelanguage.googleapis.com/v1beta/models/{}:generateContent?key={}",
                payload.model, payload.api_key
            )
        });

        let system_instruction = payload.system_prompt.unwrap_or_default();
        let body = serde_json::json!({
            "contents": [
                {
                    "parts": [
                        { "text": format!("{}\n\n{}", system_instruction, payload.user_prompt) }
                    ]
                }
            ]
        });

        let res = client
            .post(&endpoint)
            .json(&body)
            .send()
            .await
            .map_err(|e| e.to_string())?;

        let json: serde_json::Value = res.json().await.map_err(|e| e.to_string())?;
        if let Some(err) = json.get("error") {
            return Err(err.to_string());
        }

        let answer = json["candidates"][0]["content"]["parts"][0]["text"]
            .as_str()
            .unwrap_or("No response from Gemini")
            .to_string();

        Ok(answer)
    } else {
        let endpoint = payload
            .endpoint
            .unwrap_or_else(|| "https://api.openai.com/v1/chat/completions".to_string());

        let mut messages = Vec::new();
        if let Some(sys) = payload.system_prompt {
            messages.push(serde_json::json!({ "role": "system", "content": sys }));
        }
        messages.push(serde_json::json!({ "role": "user", "content": payload.user_prompt }));

        let body = serde_json::json!({
            "model": payload.model,
            "messages": messages,
            "temperature": 0.7,
        });

        let res = client
            .post(&endpoint)
            .header("Authorization", format!("Bearer {}", payload.api_key))
            .json(&body)
            .send()
            .await
            .map_err(|e| e.to_string())?;

        let json: serde_json::Value = res.json().await.map_err(|e| e.to_string())?;
        if let Some(err) = json.get("error") {
            return Err(err.to_string());
        }

        let answer = json["choices"][0]["message"]["content"]
            .as_str()
            .unwrap_or("No content returned")
            .to_string();

        Ok(answer)
    }
}

// ---------------------------------------------------------------------------
// Main Application Entry
// ---------------------------------------------------------------------------

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .setup(|app| {
            let app_handle = app.handle().clone();

            let mut config = Config::default();
            let (_conf_path, data_dir) = Config::resolve_paths(true, None, None);
            config.data_dir = data_dir;

            let themes_dir = resolve_themes_directory();

            tauri::async_runtime::block_on(async move {
                match Engine::start(config).await {
                    Ok((handle, mut rx)) => {
                        let app_state = AppState {
                            handle: handle.clone(),
                            ghost: RwLock::new(GhostSettings::default()),
                            themes_dir,
                        };
                        app_handle.manage(app_state);

                        let emitter = app_handle.clone();
                        tauri::async_runtime::spawn(async move {
                            while let Ok(event) = rx.recv().await {
                                let _ = emitter.emit("tg://event", &event);
                            }
                        });
                    }
                    Err(e) => {
                        eprintln!("Failed to initialize Telegram Engine: {}", e);
                    }
                }
            });

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            auth_send_phone_number,
            auth_send_code,
            auth_send_password,
            auth_request_qr_code,
            auth_log_out,
            get_state,
            get_chats,
            get_messages,
            load_history,
            send_message,
            edit_message,
            delete_messages,
            get_ghost_settings,
            set_ghost_settings,
            list_themes,
            load_theme,
            save_theme_file,
            import_theme_zip,
            ai_generate,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
