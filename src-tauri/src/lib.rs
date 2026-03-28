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

fn find_project_root() -> Result<PathBuf, String> {
    let mut dir = std::env::current_dir().map_err(|e| e.to_string())?;

    // Ищем вверх по дереву: где лежит db.db и папка media
    for _ in 0..10 {
        let db = dir.join("db.db");
        let media = dir.join("media");
        if db.exists() && media.exists() {
            return Ok(dir);
        }

        let Some(parent) = dir.parent() else {
            break;
        };
        dir = parent.to_path_buf();
    }

    Err("Не нашёл db.db и папку media ни в текущей папке, ни выше. Запускай `npm run tauri dev` из корня проекта (там где db.db и media).".to_string())
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

fn normalize_hhmm(now: &str) -> Result<String, String> {
    // Ждём "HH:MM"
    if now.len() != 5 || &now[2..3] != ":" {
        return Err(format!("now должен быть в формате HH:MM, получил: {}", now));
    }
    let hh = &now[0..2];
    let mm = &now[3..5];
    if !hh.chars().all(|c| c.is_ascii_digit()) || !mm.chars().all(|c| c.is_ascii_digit()) {
        return Err(format!("now должен быть в формате HH:MM, получил: {}", now));
    }
    Ok(now.to_string())
}

#[tauri::command]
fn get_upcoming_posters(limit: Option<u32>, now: String) -> Result<Vec<PosterItem>, String> {
    let limit = limit.unwrap_or(5).min(20) as i64;
    let now = normalize_hhmm(&now)?;

    let project_root = find_project_root()?;
    let db_path = project_root.join("db.db");
    let conn = rusqlite::Connection::open(db_path).map_err(|e| e.to_string())?;

    // 1) Пытаемся взять "предстоящие сегодня"
    let mut stmt = conn
        .prepare(
            r#"
            SELECT rid, id, title, time
            FROM rotation_view
            WHERE time >= ?1
            ORDER BY time ASC
            LIMIT ?2
            "#,
        )
        .map_err(|e| e.to_string())?;

    let rows = stmt
        .query_map(rusqlite::params![now.clone(), limit], |row| {
            Ok(PosterItem {
                rid: row.get(0)?,
                id: row.get(1)?,
                title: row.get(2)?,
                time: row.get(3)?,
                poster_data_url: None,
            })
        })
        .map_err(|e| e.to_string())?;

    let mut items: Vec<PosterItem> = Vec::new();
    for item in rows {
        let mut item = item.map_err(|e| e.to_string())?;
        item.poster_data_url = read_poster_as_data_url(&project_root, item.id);
        items.push(item);
    }

    // 2) Если "предстоящих" нет — значит день закончился.
    // Тогда показываем "первые по времени" (условно следующий день).
    if items.is_empty() {
        let mut stmt2 = conn
            .prepare(
                r#"
                SELECT rid, id, title, time
                FROM rotation_view
                ORDER BY time ASC
                LIMIT ?1
                "#,
            )
            .map_err(|e| e.to_string())?;

        let rows2 = stmt2
            .query_map([limit], |row| {
                Ok(PosterItem {
                    rid: row.get(0)?,
                    id: row.get(1)?,
                    title: row.get(2)?,
                    time: row.get(3)?,
                    poster_data_url: None,
                })
            })
            .map_err(|e| e.to_string())?;

        for item in rows2 {
            let mut item = item.map_err(|e| e.to_string())?;
            item.poster_data_url = read_poster_as_data_url(&project_root, item.id);
            items.push(item);
        }
    }

    Ok(items)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![greet, get_upcoming_posters])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}