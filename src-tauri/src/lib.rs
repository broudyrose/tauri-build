use tauri::Manager;

mod config;
mod data;
mod window;

use data::get_upcoming_posters;
use window::{move_window_to_next_monitor, show_window, toggle_window_size_and_center};

#[tauri::command]
fn greet(name: &str) -> String {
    format!("Hello, {}! You've been greeted from Rust!", name)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run(){
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            if let Some(window) = app.get_webview_window("main") {
                let _ = window::place_window_on_preferred_monitor(&window);
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            greet,
            get_upcoming_posters,
            toggle_window_size_and_center,
            show_window,
            move_window_to_next_monitor
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
    }