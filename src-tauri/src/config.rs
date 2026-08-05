use std::path::Path;

const DEFAULT_SORT_BY_TIME: bool = true;
const DEFAULT_VXOD_VALUE: u8 = 2;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct RuntimeConfig {
    pub sort_by_time_status: bool,
    pub vxod_value: u8,
}

impl Default for RuntimeConfig {
    fn default() -> Self {
        Self {
            sort_by_time_status: DEFAULT_SORT_BY_TIME,
            vxod_value: DEFAULT_VXOD_VALUE,
        }
    }
}

fn attribute_value<'a>(tag: &'a str, name: &str) -> Option<&'a str> {
    for quote in ['"', '\''] {
        let marker = format!("{name}={quote}");
        if let Some(marker_start) = tag.find(&marker) {
            let start = marker_start + marker.len();
            let rest = tag.get(start..)?;
            if let Some(end) = rest.find(quote) {
                return Some(rest[..end].trim());
            }
        }
    }

    None
}

fn setting_value<'a>(text: &'a str, key: &str) -> Option<&'a str> {
    text.split("<add").skip(1).find_map(|tail| {
        let end = tail.find('>')?;
        let tag = tail.get(..end)?;
        if attribute_value(tag, "key") == Some(key) {
            attribute_value(tag, "value")
        } else {
            None
        }
    })
}

fn parse_runtime_config(text: &str) -> RuntimeConfig {
    let sort_by_time_status = setting_value(text, "sort_by_time_status_value")
        .map(|value| value.eq_ignore_ascii_case("true"))
        .unwrap_or(DEFAULT_SORT_BY_TIME);

    let vxod_value = setting_value(text, "vxod_value")
        .and_then(|value| value.parse::<u8>().ok())
        .filter(|value| *value <= 2)
        .unwrap_or(DEFAULT_VXOD_VALUE);

    RuntimeConfig {
        sort_by_time_status,
        vxod_value,
    }
}

pub fn read_runtime_config(project_root: &Path) -> RuntimeConfig {
    let config_path = project_root.join("Daily Dose.exe.config");
    std::fs::read_to_string(config_path)
        .map(|text| parse_runtime_config(&text))
        .unwrap_or_default()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_supported_runtime_values() {
        let text = r#"
            <appSettings>
                <add key="sort_by_time_status_value" value="False" />
                <add key="vxod_value" value="1" />
            </appSettings>
        "#;

        assert_eq!(
            parse_runtime_config(text),
            RuntimeConfig {
                sort_by_time_status: false,
                vxod_value: 1,
            }
        );
    }

    #[test]
    fn falls_back_for_missing_or_invalid_values() {
        let text = r#"
            <appSettings>
                <add key="vxod_value" value="7" />
            </appSettings>
        "#;

        assert_eq!(parse_runtime_config(text), RuntimeConfig::default());
    }

    #[test]
    fn accepts_single_quoted_attributes() {
        let text = r#"
            <appSettings>
                <add value='0' key='vxod_value' />
                <add value='true' key='sort_by_time_status_value' />
            </appSettings>
        "#;

        assert_eq!(
            parse_runtime_config(text),
            RuntimeConfig {
                sort_by_time_status: true,
                vxod_value: 0,
            }
        );
    }
}
