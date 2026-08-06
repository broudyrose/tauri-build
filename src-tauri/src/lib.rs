use tauri::Manager;

mod config;
mod data;
mod window;

use data::{get_advertised_catalog, get_upcoming_posters};
use window::{move_window_to_next_monitor, show_window, toggle_window_size_and_center};

#[tauri::command]
fn greet(name: &str) -> String {
    format!("Hello, {}! You've been greeted from Rust!", name)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.unminimize();
                let _ = window.show();
                let _ = window.set_focus();
            }
        }))
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            if let Some(project_root) = data::find_project_root() {
                let media_dir = project_root.join("media");
                if let Err(error) = app.asset_protocol_scope().allow_directory(&media_dir, true) {
                    eprintln!(
                        "failed to allow runtime media directory {}: {error}",
                        media_dir.display()
                    );
                }
            }
            if let Some(window) = app.get_webview_window("main") {
                let _ = window::move_window_to_next_monitor(window.clone());
                let _ = window::show_window(window);
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            greet,
            get_upcoming_posters,
            get_advertised_catalog,
            toggle_window_size_and_center,
            show_window,
            move_window_to_next_monitor
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
