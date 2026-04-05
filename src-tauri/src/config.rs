use std::path::Path;

pub fn read_sort_by_time_status(project_root: &Path) -> bool {
    let config_path = project_root.join("Daily Dose.exe.config");
    let text = match std::fs::read_to_string(config_path) {
        Ok(v) => v,
        Err(_) => return true,
    };

    let marker = r#"key="sort_by_time_status_value" value=""#;
    if let Some(start) = text.find(marker) {
        let value_start = start + marker.len();
        if let Some(rest) = text.get(value_start..) {
            if let Some(end) = rest.find('"') {
                return rest[..end].trim().eq_ignore_ascii_case("true");
            }
        }
    }

    true
}