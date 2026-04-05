use serde::Serialize;
use std::path::{Path, PathBuf};

use base64::Engine;

use crate::config::read_sort_by_time_status;

#[derive(Debug, Serialize, Clone)]
pub struct PosterItem {
    pub rid: i64,
    pub id: i64,
    pub time: String,
    pub title: String,
    pub age: String,
    pub hall: String,
    pub duration: String,
    pub price: String,
    pub soldout: i64,
    pub soldout_badge: Option<String>,
    pub poster_data_url: Option<String>,
}

fn find_project_root() -> Option<PathBuf> {
    let mut dir = std::env::current_dir().ok()?;

    for _ in 0..10 {
        let db = dir.join("db.db");
        let media = dir.join("media");
        if db.exists() && media.exists() {
            return Some(dir);
        }

        dir = dir.parent()?.to_path_buf();
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

fn clean_text(value: Option<String>) -> String {
    value.unwrap_or_default().trim().to_string()
}

fn map_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<PosterItem> {
    let soldout: i64 = row.get(8)?;

    Ok(PosterItem {
        rid: row.get(0)?,
        id: row.get(1)?,
        title: clean_text(row.get(2)?),
        age: clean_text(row.get(3)?),
        hall: clean_text(row.get(4)?),
        duration: clean_text(row.get(5)?),
        price: clean_text(row.get(6)?),
        time: clean_text(row.get(7)?),
        soldout,
        soldout_badge: if soldout == 1 {
            Some("Нет мест".to_string())
        } else {
            None
        },
        poster_data_url: None,
    })
}

#[tauri::command]
pub fn get_upcoming_posters(limit: Option<u32>, now: String) -> Vec<PosterItem> {
    let limit = limit.unwrap_or(8).min(20) as i64;
    let Some(now) = normalize_hhmm(&now) else {
        return Vec::new();
    };

    let Some(project_root) = find_project_root() else {
        return Vec::new();
    };

    let sort_by_time = read_sort_by_time_status(&project_root);

    let db_path = project_root.join("db.db");
    let Ok(conn) = rusqlite::Connection::open(db_path) else {
        return Vec::new();
    };

    let sql = if sort_by_time {
        r#"
        SELECT rid, id, title, age, hall, duration, price, time, soldout
        FROM rotation_view
        WHERE time > ?1
          AND time IS NOT NULL
          AND TRIM(time) <> ''
        ORDER BY time ASC
        LIMIT ?2
        "#
    } else {
        r#"
        SELECT rid, id, title, age, hall, duration, price, time, soldout
        FROM rotation_view
        WHERE time IS NOT NULL
          AND TRIM(time) <> ''
        ORDER BY time ASC
        LIMIT ?1
        "#
    };

    let Ok(mut stmt) = conn.prepare(sql) else {
        return Vec::new();
    };

    let mapped = if sort_by_time {
        stmt.query_map(rusqlite::params![now, limit], map_row)
    } else {
        stmt.query_map(rusqlite::params![limit], map_row)
    };

    let Ok(rows) = mapped else {
        return Vec::new();
    };

    let mut items = Vec::new();
    for item in rows {
        let Ok(mut item) = item else {
            return Vec::new();
        };
        item.poster_data_url = read_poster_as_data_url(&project_root, item.id);
        items.push(item);
    }

    items
}