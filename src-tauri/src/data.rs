use serde::Serialize;
use std::cmp::Ordering;
use std::path::{Path, PathBuf};

use base64::Engine;

use crate::config::read_runtime_config;

#[derive(Debug, Serialize, Clone)]
pub struct PosterItem {
    pub rid: i64,
    pub id: i64,
    pub advertising: bool,
    pub time: String,
    pub title: String,
    pub age: String,
    pub hall: String,
    pub duration: String,
    pub price: String,
    pub soldout: i64,
    pub soldout_badge: Option<String>,
    pub poster_data_url: Option<String>,
    pub gallery_paths: Vec<String>,
    pub header_path: Option<String>,
    pub trailer_path: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct BoardSnapshot {
    pub items: Vec<PosterItem>,
    pub upcoming_rids: Vec<i64>,
    pub upcoming_schedule: Vec<UpcomingSession>,
    pub vxod_value: u8,
}

#[derive(Debug, Serialize, Clone)]
pub struct UpcomingSession {
    pub rid: i64,
    pub time: String,
}

impl BoardSnapshot {
    fn empty() -> Self {
        Self {
            items: Vec::new(),
            upcoming_rids: Vec::new(),
            upcoming_schedule: Vec::new(),
            vxod_value: 2,
        }
    }
}

fn has_runtime_data(dir: &Path) -> bool {
    dir.join("db.db").exists() && dir.join("media").exists()
}

pub(crate) fn find_project_root() -> Option<PathBuf> {
    let exe = std::env::current_exe().ok()?;
    let dir = exe.parent()?.to_path_buf();
    has_runtime_data(&dir).then_some(dir)
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

fn find_media_path(project_root: &Path, film_id: i64, names: &[&str]) -> Option<String> {
    let media_dir = project_root.join("media").join(film_id.to_string());

    names.iter().find_map(|name| {
        let path = media_dir.join(name);
        path.is_file().then(|| path.to_string_lossy().into_owned())
    })
}

fn gallery_image_name(path: &Path) -> Option<String> {
    let extension = path.extension()?.to_str()?.to_ascii_lowercase();
    if !matches!(extension.as_str(), "jpg" | "jpeg" | "png" | "webp" | "avif") {
        return None;
    }

    Some(path.file_name()?.to_string_lossy().into_owned())
}

fn natural_file_name_cmp(left: &str, right: &str) -> Ordering {
    let left_folded = left.to_lowercase();
    let right_folded = right.to_lowercase();
    let left_bytes = left_folded.as_bytes();
    let right_bytes = right_folded.as_bytes();
    let mut left_index = 0;
    let mut right_index = 0;

    while left_index < left_bytes.len() && right_index < right_bytes.len() {
        let left_digit = left_bytes[left_index].is_ascii_digit();
        let right_digit = right_bytes[right_index].is_ascii_digit();

        if left_digit && right_digit {
            let left_end = (left_index..left_bytes.len())
                .find(|&index| !left_bytes[index].is_ascii_digit())
                .unwrap_or(left_bytes.len());
            let right_end = (right_index..right_bytes.len())
                .find(|&index| !right_bytes[index].is_ascii_digit())
                .unwrap_or(right_bytes.len());
            let left_number = &left_bytes[left_index..left_end];
            let right_number = &right_bytes[right_index..right_end];
            let left_trimmed = left_number
                .iter()
                .position(|byte| *byte != b'0')
                .map(|index| &left_number[index..])
                .unwrap_or(&left_number[left_number.len().saturating_sub(1)..]);
            let right_trimmed = right_number
                .iter()
                .position(|byte| *byte != b'0')
                .map(|index| &right_number[index..])
                .unwrap_or(&right_number[right_number.len().saturating_sub(1)..]);
            let ordering = left_trimmed
                .len()
                .cmp(&right_trimmed.len())
                .then_with(|| left_trimmed.cmp(right_trimmed))
                .then_with(|| left_number.len().cmp(&right_number.len()));
            if ordering != Ordering::Equal {
                return ordering;
            }
            left_index = left_end;
            right_index = right_end;
            continue;
        }

        let ordering = left_bytes[left_index].cmp(&right_bytes[right_index]);
        if ordering != Ordering::Equal {
            return ordering;
        }
        left_index += 1;
        right_index += 1;
    }

    left_bytes
        .len()
        .cmp(&right_bytes.len())
        .then_with(|| left.cmp(right))
}

fn find_gallery_paths(project_root: &Path, film_id: i64) -> Vec<String> {
    let gallery_dir = project_root
        .join("media")
        .join(film_id.to_string())
        .join("gallery");
    let Ok(entries) = std::fs::read_dir(gallery_dir) else {
        return Vec::new();
    };

    let mut images = entries
        .filter_map(Result::ok)
        .filter_map(|entry| {
            let path = entry.path();
            if !path.is_file() {
                return None;
            }

            let file_name = gallery_image_name(&path)?;
            Some((file_name, path))
        })
        .collect::<Vec<_>>();
    images.sort_by(|left, right| natural_file_name_cmp(&left.0, &right.0));

    if images.len() < 2 {
        return Vec::new();
    }

    images
        .into_iter()
        .map(|(_, path)| path.to_string_lossy().into_owned())
        .collect()
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
        advertising: false,
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
        gallery_paths: Vec::new(),
        header_path: None,
        trailer_path: None,
    })
}

fn map_catalog_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<PosterItem> {
    let id: i64 = row.get(0)?;

    Ok(PosterItem {
        rid: -id,
        id,
        advertising: true,
        title: clean_text(row.get(1)?),
        age: clean_text(row.get(2)?),
        hall: clean_text(row.get(3)?),
        duration: clean_text(row.get(4)?),
        price: clean_text(row.get(5)?),
        time: String::new(),
        soldout: 0,
        soldout_badge: None,
        poster_data_url: None,
        gallery_paths: Vec::new(),
        header_path: None,
        trailer_path: None,
    })
}

fn enrich_media(project_root: &Path, items: &mut [PosterItem]) {
    for item in items {
        item.poster_data_url = read_poster_as_data_url(project_root, item.id);
        item.gallery_paths = find_gallery_paths(project_root, item.id);
        item.header_path = find_media_path(
            project_root,
            item.id,
            &["header.jpg", "header.jpeg", "header.png", "header.webp"],
        );
        item.trailer_path =
            find_media_path(project_root, item.id, &["trailer.mp4", "trailer.webm"]);
    }
}

fn read_upcoming_schedule(
    conn: &rusqlite::Connection,
    sort_by_time: bool,
    now: &str,
) -> Vec<UpcomingSession> {
    let sql = if sort_by_time {
        r#"
        SELECT rid, time
        FROM rotation_view
        WHERE time > ?1
          AND time IS NOT NULL
          AND TRIM(time) <> ''
        ORDER BY time ASC, rid ASC
        "#
    } else {
        r#"
        SELECT rid, time
        FROM rotation_view
        WHERE time IS NOT NULL
          AND TRIM(time) <> ''
        ORDER BY time ASC, rid ASC
        "#
    };

    let Ok(mut stmt) = conn.prepare(sql) else {
        return Vec::new();
    };
    let map_schedule = |row: &rusqlite::Row<'_>| {
        Ok(UpcomingSession {
            rid: row.get(0)?,
            time: clean_text(row.get(1)?),
        })
    };
    let mut schedule = Vec::new();

    if sort_by_time {
        if let Ok(rows) = stmt.query_map(rusqlite::params![now], map_schedule) {
            schedule.extend(rows.filter_map(Result::ok));
        }
    } else if let Ok(rows) = stmt.query_map([], map_schedule) {
        schedule.extend(rows.filter_map(Result::ok));
    }

    schedule
}

fn read_upcoming_items(
    conn: &rusqlite::Connection,
    sort_by_time: bool,
    now: &str,
    limit: i64,
) -> Vec<PosterItem> {
    let sql = if sort_by_time {
        r#"
        SELECT rid, id, title, age, hall, duration, price, time, soldout
        FROM rotation_view
        WHERE time > ?1
          AND time IS NOT NULL
          AND TRIM(time) <> ''
        ORDER BY time ASC, rid ASC
        LIMIT ?2
        "#
    } else {
        r#"
        SELECT rid, id, title, age, hall, duration, price, time, soldout
        FROM rotation_view
        WHERE time IS NOT NULL
          AND TRIM(time) <> ''
        ORDER BY time ASC, rid ASC
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

    rows.filter_map(Result::ok).collect()
}

#[tauri::command]
pub fn get_upcoming_posters(limit: Option<u32>, now: String) -> BoardSnapshot {
    let limit = limit.unwrap_or(8).min(20) as i64;
    let Some(now) = normalize_hhmm(&now) else {
        return BoardSnapshot::empty();
    };

    let Some(project_root) = find_project_root() else {
        return BoardSnapshot::empty();
    };

    let runtime_config = read_runtime_config(&project_root);
    let sort_by_time = runtime_config.sort_by_time_status;
    let (upcoming_schedule, mut items) = (|| -> Option<(Vec<UpcomingSession>, Vec<PosterItem>)> {
        let db_path = project_root.join("db.db");
        let mut conn = rusqlite::Connection::open(db_path).ok()?;
        let transaction = conn.transaction().ok()?;
        let upcoming_schedule = read_upcoming_schedule(&transaction, sort_by_time, &now);
        let items = read_upcoming_items(&transaction, sort_by_time, &now, limit);
        transaction.commit().ok()?;
        Some((upcoming_schedule, items))
    })()
    .unwrap_or_default();
    let upcoming_rids = upcoming_schedule.iter().map(|item| item.rid).collect();

    enrich_media(&project_root, &mut items);

    BoardSnapshot {
        items,
        upcoming_rids,
        upcoming_schedule,
        vxod_value: runtime_config.vxod_value,
    }
}

#[tauri::command]
pub fn get_advertised_catalog() -> Result<Vec<PosterItem>, String> {
    let project_root = find_project_root()
        .ok_or_else(|| "Не найдена папка с db.db и media для рекламного каталога".to_string())?;
    let db_path = project_root.join("db.db");
    let conn = rusqlite::Connection::open(&db_path).map_err(|error| {
        format!(
            "Не удалось открыть рекламный каталог {}: {error}",
            db_path.display()
        )
    })?;
    let mut stmt = conn
        .prepare(
            r#"
        SELECT id, title, age, hall, duration, price
        FROM catalog
        WHERE ad = 1
          AND id <> 0
        ORDER BY id ASC
        "#,
        )
        .map_err(|error| format!("Не удалось подготовить рекламный каталог: {error}"))?;
    let rows = stmt
        .query_map([], map_catalog_row)
        .map_err(|error| format!("Не удалось прочитать рекламный каталог: {error}"))?;
    let mut items = rows
        .collect::<rusqlite::Result<Vec<_>>>()
        .map_err(|error| format!("Некорректная запись рекламного каталога: {error}"))?;
    enrich_media(&project_root, &mut items);
    Ok(items)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::{SystemTime, UNIX_EPOCH};

    #[test]
    fn gallery_images_are_filtered_and_naturally_sorted_across_formats() {
        let nonce = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("system time must be after unix epoch")
            .as_nanos();
        let root =
            std::env::temp_dir().join(format!("showmaster-gallery-{}-{nonce}", std::process::id()));
        let gallery = root.join("media").join("42").join("gallery");
        std::fs::create_dir_all(&gallery).expect("gallery directory must be created");

        for name in [
            "10.webp",
            "0.png",
            "2.jpg",
            "Beta.JPEG",
            "alpha.avif",
            "1.gif",
        ] {
            std::fs::write(gallery.join(name), b"test").expect("gallery fixture must be written");
        }

        let paths = find_gallery_paths(&root, 42);
        let names = paths
            .iter()
            .filter_map(|path| Path::new(path).file_name()?.to_str())
            .collect::<Vec<_>>();
        assert_eq!(
            names,
            ["0.png", "2.jpg", "10.webp", "alpha.avif", "Beta.JPEG"]
        );

        std::fs::remove_dir_all(root).expect("gallery fixture must be removed");
    }
}
