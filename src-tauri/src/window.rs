use tauri::{LogicalSize, PhysicalPosition, WebviewWindow};

#[cfg(windows)]
use windows_sys::Win32::UI::WindowsAndMessaging::{
    SetWindowPos, SWP_NOACTIVATE, SWP_NOOWNERZORDER, SWP_NOZORDER,
};

fn set_window_size(window: &WebviewWindow, width: f64, height: f64) -> Result<(), String> {
    window
        .set_size(LogicalSize::new(width, height))
        .map_err(|e| e.to_string())
}
#[cfg(windows)]
fn set_window_bounds(
    window: &WebviewWindow,
    x: i32,
    y: i32,
    width: i32,
    height: i32,
) -> Result<(), String> {
    let hwnd = window.hwnd().map_err(|e| e.to_string())?;
    let ok = unsafe {
        SetWindowPos(
            hwnd.0 as _,
            std::ptr::null_mut(),
            x,
            y,
            width,
            height,
            SWP_NOZORDER | SWP_NOOWNERZORDER | SWP_NOACTIVATE,
        )
    };

    if ok == 0 {
        Err(std::io::Error::last_os_error().to_string())
    } else {
        Ok(())
    }
}

#[cfg(not(windows))]
fn set_window_bounds(
    window: &WebviewWindow,
    x: i32,
    y: i32,
    width: i32,
    height: i32,
) -> Result<(), String> {
    window
        .set_position(PhysicalPosition::new(x, y))
        .map_err(|e| e.to_string())?;
    window
        .set_size(tauri::PhysicalSize::new(width as u32, height as u32))
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn toggle_window_size_and_center(window: WebviewWindow, compact: bool) -> Result<(), String> {
    let (target_w, target_h) = if compact {
        (640.0, 352.0)
    } else {
        (1280.0, 704.0)
    };

    let monitor = window.current_monitor().map_err(|e| e.to_string())?;

    if let Some(monitor) = monitor {
        let area = monitor.work_area();
        let scale = monitor.scale_factor();

        let w = (target_w * scale).round() as i32;
        let h = (target_h * scale).round() as i32;
        let x = area.position.x + ((area.size.width as i32 - w) / 2);
        let y = area.position.y + ((area.size.height as i32 - h) / 2);

        set_window_bounds(&window, x, y, w, h)?;
    } else {
        set_window_size(&window, target_w, target_h)?;
        window.center().map_err(|e| e.to_string())?;
    }

    Ok(())
}
#[tauri::command]
pub fn show_window(window: WebviewWindow) -> Result<(), String> {
    window.show().map_err(|e| e.to_string())?;
    window.set_focus().map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn move_window_to_next_monitor(window: WebviewWindow) -> Result<(), String> {
    let monitors = window.available_monitors().map_err(|e| e.to_string())?;
    if monitors.is_empty() {
        return Ok(());
    }

    let current = window
        .current_monitor()
        .map_err(|e| e.to_string())?
        .unwrap_or_else(|| monitors[0].clone());

    let current_idx = monitors
        .iter()
        .position(|m| {
            m.position() == current.position()
                && m.size() == current.size()
                && m.name() == current.name()
        })
        .unwrap_or(0);

    let next = if monitors.len() > 1 {
        &monitors[(current_idx + 1) % monitors.len()]
    } else {
        &monitors[current_idx]
    };

    let target_w = 1280.0;
    let target_h = 704.0;

    window.hide().map_err(|e| e.to_string())?;
    set_window_size(&window, target_w, target_h)?;

    let area = next.work_area();
    let scale = next.scale_factor();

    let w = (target_w * scale).round() as i32;
    let h = (target_h * scale).round() as i32;

    let x = area.position.x + ((area.size.width as i32 - w) / 2);
    let y = area.position.y + ((area.size.height as i32 - h) / 2);

    window
        .set_position(PhysicalPosition::new(x, y))
        .map_err(|e| e.to_string())?;

    Ok(())
}
