use std::time::Duration;

use tauri::{
    menu::{Menu, MenuItem},
    tray::TrayIconBuilder,
    Manager, WebviewWindow,
};

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            // ---- 系统托盘 ----
            let show_i = MenuItem::with_id(app, "show", "显示", true, None::<&str>)?;
            let hide_i = MenuItem::with_id(app, "hide", "隐藏", true, None::<&str>)?;
            let quit_i = MenuItem::with_id(app, "quit", "退出", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&show_i, &hide_i, &quit_i])?;

            TrayIconBuilder::new()
                .icon(app.default_window_icon().unwrap().clone())
                .tooltip("Nyaapet")
                .menu(&menu)
                .on_menu_event(|app, event| match event.id.as_ref() {
                    "show" => {
                        if let Some(w) = app.get_webview_window("main") {
                            let _ = w.show();
                            let _ = w.set_focus();
                        }
                    }
                    "hide" => {
                        if let Some(w) = app.get_webview_window("main") {
                            let _ = w.hide();
                        }
                    }
                    "quit" => app.exit(0),
                    _ => {}
                })
                .build(app)?;

            // ---- 鼠标穿透 ----
            // 默认让窗口忽略鼠标(点击穿透到桌面),只有当光标真正落在
            // 猫身上时才恢复接收点击,从而实现“透明区域可穿透”。
            if let Some(window) = app.get_webview_window("main") {
                spawn_passthrough(window);
            }

            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

/// 后台线程:轮询全局光标位置,动态开关窗口的鼠标穿透。
fn spawn_passthrough(window: WebviewWindow) {
    std::thread::spawn(move || {
        let _ = window.set_ignore_cursor_events(true);
        let mut ignoring = true;
        loop {
            std::thread::sleep(Duration::from_millis(60));
            let on_pet = cursor_on_pet(&window).unwrap_or(false);
            let desired = !on_pet; // 在猫身上 -> 不忽略
            if desired != ignoring {
                let _ = window.set_ignore_cursor_events(desired);
                ignoring = desired;
            }
        }
    });
}

/// 判断全局光标是否落在“猫”的大致区域(底部居中的圆)内。
/// 所有坐标都用物理像素,避免 DPI 缩放带来的偏差。
fn cursor_on_pet(window: &WebviewWindow) -> tauri::Result<bool> {
    let cursor = window.cursor_position()?;
    let pos = window.outer_position()?;
    let size = window.outer_size()?;

    let rx = cursor.x - pos.x as f64;
    let ry = cursor.y - pos.y as f64;
    let w = size.width as f64;
    let h = size.height as f64;

    if rx < 0.0 || ry < 0.0 || rx > w || ry > h {
        return Ok(false);
    }

    // 用一个竖直椭圆覆盖模型的大致轮廓(全身 Live2D 偏高瘦)
    let cx = w * 0.5;
    let cy = h * 0.52;
    let a = w * 0.44; // 横向半轴
    let b = h * 0.48; // 纵向半轴
    let nx = (rx - cx) / a;
    let ny = (ry - cy) / b;
    Ok(nx * nx + ny * ny <= 1.0)
}
