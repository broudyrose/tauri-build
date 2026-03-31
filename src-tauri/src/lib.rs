use serde::Serialize;
use std::path::{Path, PathBuf};

use base64::Engine;

#[tauri::command]
fn greet(name: &str) -> String {
    format!("Hello, {}! You've been greeted from Rust!", name)
}

#[derive(Debug, Serialize, Clone)]
struct PosterItem {
    rid: i64,
    id: i64,
    time: String,
    title: String,
    poster_data_url: Option<String>, // "data:image/jpeg;base64,...."
}

fn find_project_root() -> Option<PathBuf> {
    let mut dir = std::env::current_dir().ok()?;

    for _ in 0..10 {
        let db = dir.join("db.db");
        let media = dir.join("media");
        if db.exists() && media.exists() {
            return Some(dir);
        }

        let parent = dir.parent()?;
        dir = parent.to_path_buf();
    }

    None
}

fn read_poster_as_data_url(project_root: &Path, film_id: i64) -> Option<String> {
    let poster_path = project_root
        .join("media")
        .join(film_id.to_string())
        .join("poster.jpg");

    let bytes = std::fs::read(poster_path).ok()?;
    let b64 = base64::engine::general_purpose::STANDARD.encode(bytes);
    Some(format!("data:image/jpeg;base64,{}", b64))
}

fn normalize_hhmm(now: &str) -> Option<String> {
    if now.len() != 5 || &now[2..3] != ":" {
        return None;
    }
    let hh = &now[0..2];
    let mm = &now[3..5];
    if !hh.chars().all(|c| c.is_ascii_digit()) || !mm.chars().all(|c| c.is_ascii_digit()) {
        return None;
    }
    Some(now.to_string())
}

#[tauri::command]
fn get_upcoming_posters(limit: Option<u32>, now: String) -> Vec<PosterItem> {
    let limit = limit.unwrap_or(5).min(20) as i64;
    let Some(now) = normalize_hhmm(&now) else {
        return Vec::new();
    };

    let Some(project_root) = find_project_root() else {
        return Vec::new();
    };

    let db_path = project_root.join("db.db");
    let Ok(conn) = rusqlite::Connection::open(db_path) else {
        return Vec::new();
    };

    let Ok(mut stmt) = conn.prepare(
        r#"
        SELECT rid, id, title, time
        FROM rotation_view
        WHERE time >= ?1
        ORDER BY time ASC
        LIMIT ?2
        "#,
    ) else {
        return Vec::new();
    };

    let Ok(rows) = stmt.query_map(rusqlite::params![now, limit], |row| {
        Ok(PosterItem {
            rid: row.get(0)?,
            id: row.get(1)?,
            title: row.get(2)?,
            time: row.get(3)?,
            poster_data_url: None,
        })
    }) else {
        return Vec::new();
    };

    let mut items: Vec<PosterItem> = Vec::new();
    for item in rows {
        let Ok(mut item) = item else {
            return Vec::new();
        };
        item.poster_data_url = read_poster_as_data_url(&project_root, item.id);
        items.push(item);
    }

    items
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![greet, get_upcoming_posters])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}