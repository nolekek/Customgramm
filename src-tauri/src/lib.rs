pub mod tdlib;

use std::sync::Arc;
use tauri::{Manager, State, Window};
use tdlib::{AppPaths, TdlibManager};

#[tauri::command]
fn tdlib_send(state: State<'_, Arc<TdlibManager>>, request: String) -> Result<(), String> {
    state.send(&request);
    Ok(())
}

#[tauri::command]
fn tdlib_execute(state: State<'_, Arc<TdlibManager>>, request: String) -> Result<Option<String>, String> {
    Ok(state.execute(&request))
}

#[tauri::command]
fn tdlib_get_paths(state: State<'_, Arc<TdlibManager>>) -> Result<AppPaths, String> {
    Ok(state.get_paths())
}

#[tauri::command]
fn window_minimize(window: Window) -> Result<(), String> {
    window.minimize().map_err(|e| e.to_string())
}

#[tauri::command]
fn window_toggle_maximize(window: Window) -> Result<(), String> {
    if window.is_maximized().map_err(|e| e.to_string())? {
        window.unmaximize().map_err(|e| e.to_string())?;
    } else {
        window.maximize().map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
fn window_close(window: Window) -> Result<(), String> {
    window.close().map_err(|e| e.to_string())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .setup(|app| {
            println!("[Customgramm] Setting up TDLib bridge...");
            let handle = app.handle().clone();

            match TdlibManager::new(handle) {
                Ok(manager) => {
                    app.manage(manager);
                    println!("[Customgramm] TDLib successfully initialized.");
                }
                Err(err) => {
                    eprintln!("[Customgramm Error] Failed to initialize TDLib: {}", err);
                }
            }

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            tdlib_send,
            tdlib_execute,
            tdlib_get_paths,
            window_minimize,
            window_toggle_maximize,
            window_close
        ])
        .run(tauri::generate_context!())
        .expect("error while running Customgramm application");
}
