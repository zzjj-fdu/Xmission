use tauri::{AppHandle, Emitter, Manager, menu::{Menu, MenuItem}};
use std::{io::{Read, Write}, net::{TcpListener, TcpStream}, time::Duration};

const INSTANCE_ADDRESS: &str = "127.0.0.1:43857";
const INSTANCE_REQUEST: &[u8] = b"XMISSION_SHOW_MAIN\n";
const INSTANCE_REPLY: &[u8] = b"XMISSION_READY\n";

pub fn show_main_window(app: &AppHandle) -> bool {
    let Some(main) = app.get_webview_window("main") else { return false };
    if !main.is_visible().unwrap_or(true) {
        let _ = main.emit("main:opened", ());
    }
    let _ = main.show();
    let _ = main.unminimize();
    let _ = main.set_focus();
    true
}

/// Reserve a loopback endpoint before Tauri creates any windows. The next
/// process can request the existing main window and then exit immediately.
pub fn claim_single_instance() -> Result<Option<TcpListener>, String> {
    let address = INSTANCE_ADDRESS.parse().map_err(|e| format!("单实例地址无效：{e}"))?;
    match TcpListener::bind(address) {
        Ok(listener) => Ok(Some(listener)),
        Err(bind_error) => {
            for _ in 0..20 {
                if let Ok(mut stream) = TcpStream::connect_timeout(&address, Duration::from_millis(250)) {
                    let _ = stream.set_read_timeout(Some(Duration::from_millis(400)));
                    if stream.write_all(INSTANCE_REQUEST).is_ok() {
                        let mut reply = vec![0_u8; INSTANCE_REPLY.len()];
                        if stream.read_exact(&mut reply).is_ok() && reply == INSTANCE_REPLY { return Ok(None); }
                    }
                }
                std::thread::sleep(Duration::from_millis(100));
            }
            Err(format!("无法启动 Xmission 单实例服务：{bind_error}"))
        }
    }
}

pub fn serve_single_instance(listener: TcpListener, app: AppHandle) {
    std::thread::spawn(move || {
        for connection in listener.incoming() {
            let Ok(mut stream) = connection else { continue };
            let _ = stream.set_read_timeout(Some(Duration::from_secs(1)));
            let mut request = vec![0_u8; INSTANCE_REQUEST.len()];
            if stream.read_exact(&mut request).is_ok() {
                if request == INSTANCE_REQUEST {
                    let _ = stream.write_all(INSTANCE_REPLY);
                    for _ in 0..20 {
                        if show_main_window(&app) { break; }
                        std::thread::sleep(Duration::from_millis(100));
                    }
                }
            }
        }
    });
}

#[cfg(windows)]
const RUN_KEY: &str = r"HKCU\Software\Microsoft\Windows\CurrentVersion\Run";

#[tauri::command]
pub async fn get_autostart() -> Result<bool, String> {
    tokio::task::spawn_blocking(read_autostart).await.map_err(|e| e.to_string())?
}

fn read_autostart() -> Result<bool, String> {
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        let output = std::process::Command::new("reg")
            .creation_flags(0x08000000)
            .args(["query", RUN_KEY, "/v", "Xmission"])
            .output().map_err(|e| format!("读取开机启动设置失败：{e}"))?;
        if !output.status.success() { return Ok(false); }
        let exe = std::env::current_exe().map_err(|e| format!("找不到应用程序：{e}"))?;
        let listing = String::from_utf8_lossy(&output.stdout);
        return Ok(listing.to_ascii_lowercase().contains(&exe.to_string_lossy().to_ascii_lowercase()));
    }
    #[cfg(not(windows))]
    { Ok(false) }
}

#[tauri::command]
pub async fn set_autostart(enabled: bool) -> Result<bool, String> {
    tokio::task::spawn_blocking(move || write_autostart(enabled)).await.map_err(|e| e.to_string())?
}

fn write_autostart(enabled: bool) -> Result<bool, String> {
    #[cfg(windows)]
    {
        let exe = std::env::current_exe().map_err(|e| format!("找不到应用程序：{e}"))?;
        let path = exe.to_string_lossy();
        if enabled && (path.contains(r"\target\debug\") || path.contains(r"\target\release\deps\")) {
            return Err("开发预览程序不能设为开机启动，请使用独立版或安装后的 Xmission".into());
        }
        use std::os::windows::process::CommandExt;
        let output = if enabled {
            std::process::Command::new("reg")
                .creation_flags(0x08000000)
                .args(["add", RUN_KEY, "/v", "Xmission", "/t", "REG_SZ", "/d", &format!("\"{path}\""), "/f"])
                .output()
        } else {
            std::process::Command::new("reg")
                .creation_flags(0x08000000)
                .args(["delete", RUN_KEY, "/v", "Xmission", "/f"])
                .output()
        }.map_err(|e| format!("修改开机启动设置失败：{e}"))?;
        if !output.status.success() && !( !enabled && !read_autostart()? ) {
            return Err("Windows 未接受开机启动设置，请检查当前账户权限".into());
        }
        return Ok(enabled);
    }
    #[cfg(not(windows))]
    { let _ = enabled; Err("当前系统暂不支持开机启动设置".into()) }
}

/// Strip native caption sizing rules before measuring or showing the compact ball.
/// A frameless WebView alone still inherits Windows' minimum caption width.
pub fn prepare_bubble(app: &AppHandle) -> Result<(), String> {
    #[cfg(windows)]
    {
        use std::ffi::c_void;
        #[link(name = "user32")]
        unsafe extern "system" {
            fn GetWindowLongPtrW(hwnd: *mut c_void, index: i32) -> isize;
            fn SetWindowLongPtrW(hwnd: *mut c_void, index: i32, value: isize) -> isize;
            fn SetWindowPos(hwnd: *mut c_void, after: *mut c_void, x: i32, y: i32, cx: i32, cy: i32, flags: u32) -> i32;
            fn SetWindowRgn(hwnd: *mut c_void, region: *mut c_void, redraw: i32) -> i32;
        }
        #[link(name = "gdi32")]
        unsafe extern "system" {
            fn CreateEllipticRgn(left: i32, top: i32, right: i32, bottom: i32) -> *mut c_void;
            fn DeleteObject(object: *mut c_void) -> i32;
        }
        let win = app.get_webview_window("bubble").ok_or("找不到任务球")?;
        let hwnd = win.hwnd().map_err(|e| e.to_string())?.0 as *mut c_void;
        let size = (43.0 * win.scale_factor().map_err(|e| e.to_string())?).round() as i32;
        // SAFETY: This HWND belongs to our ball. Successful SetWindowRgn transfers region ownership to Windows.
        unsafe {
            let style = GetWindowLongPtrW(hwnd, -16);
            SetWindowLongPtrW(hwnd, -16, (style & !(0x00C00000 | 0x00040000 | 0x00020000 | 0x00010000)) | 0x80000000);
            let extended = GetWindowLongPtrW(hwnd, -20);
            SetWindowLongPtrW(hwnd, -20, (extended & !0x00040000) | 0x00000080);
            if SetWindowPos(hwnd, std::ptr::null_mut(), 0, 0, size, size, 0x0002 | 0x0004 | 0x0010 | 0x0020) == 0 {
                return Err("设置任务球尺寸失败".into());
            }
            let region = CreateEllipticRgn(0, 0, size + 1, size + 1);
            if region.is_null() { return Err("创建任务球边界失败".into()); }
            if SetWindowRgn(hwnd, region, 1) == 0 {
                DeleteObject(region);
                return Err("设置任务球边界失败".into());
            }
        }
    }
    Ok(())
}

#[tauri::command]
pub fn prepare_bubble_window(app: AppHandle) -> Result<(), String> {
    prepare_bubble(&app)
}

#[tauri::command]
pub fn quit_app(app: AppHandle) {
    app.exit(0);
}

#[tauri::command]
pub fn show_widget_context_menu(app: AppHandle) -> Result<(), String> {
    let win = app.get_webview_window("bubble").ok_or("找不到任务球")?;
    let show = MenuItem::with_id(&app, "show-widget", "展开任务悬浮窗", true, None::<&str>)
        .map_err(|e| e.to_string())?;
    let hide = MenuItem::with_id(&app, "hide-widget", "完全关闭任务球", true, None::<&str>)
        .map_err(|e| e.to_string())?;
    let menu = Menu::with_items(&app, &[&show, &hide]).map_err(|e| e.to_string())?;
    win.popup_menu(&menu).map_err(|e| e.to_string())
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BubbleDragResult {
    moved: bool,
    x: i32,
    y: i32,
}

/// Polling the mouse on Windows keeps the compact tool window under the pointer.
/// Native window dragging would trigger Windows Snap Assist for this tool window.
#[cfg(windows)]
#[tauri::command]
pub async fn drag_bubble(app: AppHandle) -> Result<BubbleDragResult, String> {
    use std::{ffi::c_void, thread, time::Duration};

    #[repr(C)]
    struct Point { x: i32, y: i32 }
    #[link(name = "user32")]
    unsafe extern "system" {
        fn GetCursorPos(point: *mut Point) -> i32;
        fn GetAsyncKeyState(key: i32) -> i16;
        fn SetWindowPos(hwnd: *mut c_void, insert_after: *mut c_void, x: i32, y: i32, cx: i32, cy: i32, flags: u32) -> i32;
    }

    let win = app.get_webview_window("bubble").ok_or("找不到任务球")?;
    let hwnd = win.hwnd().map_err(|e| e.to_string())?.0 as usize;
    let origin = win.outer_position().map_err(|e| e.to_string())?;
    let size = win.outer_size().map_err(|e| e.to_string())?;
    let initial_monitor = win.current_monitor().map_err(|e| e.to_string())?;
    let monitor_rects: Vec<(i32, i32, i32, i32)> = app.available_monitors()
        .map_err(|e| e.to_string())?
        .into_iter()
        .map(|m| (m.position().x, m.position().y,
                  m.position().x + m.size().width as i32,
                  m.position().y + m.size().height as i32))
        .collect();
    let initial_rect = initial_monitor.map(|m| (m.position().x, m.position().y,
        m.position().x + m.size().width as i32,
        m.position().y + m.size().height as i32));

    tokio::task::spawn_blocking(move || {
        let mut start = Point { x: 0, y: 0 };
        // SAFETY: GetCursorPos writes a POINT into the valid local buffer.
        if unsafe { GetCursorPos(&mut start) } == 0 { return Err("读取鼠标位置失败".to_string()); }
        let mut x = origin.x;
        let mut y = origin.y;
        let mut moved = false;
        while unsafe { GetAsyncKeyState(0x01) as u16 & 0x8000 } != 0 {
            let mut cursor = Point { x: 0, y: 0 };
            if unsafe { GetCursorPos(&mut cursor) } == 0 { break; }
            let dx = cursor.x - start.x;
            let dy = cursor.y - start.y;
            if dx.abs() + dy.abs() > 4 { moved = true; }
            if moved {
                let requested_x = origin.x + dx;
                let requested_y = origin.y + dy;
                let target = monitor_rects.iter().copied().find(|(left, top, right, bottom)| {
                    cursor.x >= *left && cursor.x < *right && cursor.y >= *top && cursor.y < *bottom
                }).or(initial_rect);
                let (next_x, next_y) = if let Some((left, top, right, bottom)) = target {
                    // Keep half the ball visible horizontally: its centre can reach the real screen edge.
                    let half = size.width as i32 / 2;
                    // The pointer can stop at the desktop edge before its grab offset reaches the limit.
                    // Explicitly dock the centre at that edge, regardless of where the user grabbed it.
                    let edge_x = if cursor.x <= left + 2 { left - half }
                        else if cursor.x >= right - 3 { right - half }
                        else { requested_x.clamp(left - half, (right - half).max(left - half)) };
                    (edge_x, requested_y.clamp(top, (bottom - size.height as i32).max(top)))
                } else { (requested_x, requested_y) };
                if next_x != x || next_y != y {
                    // SAFETY: hwnd belongs to this app's bubble window; only its position changes.
                    let ok = unsafe { SetWindowPos(hwnd as *mut c_void, std::ptr::null_mut(), next_x, next_y, 0, 0, 0x0001 | 0x0004 | 0x0010 | 0x0200) };
                    if ok == 0 { return Err("移动任务球失败".to_string()); }
                    x = next_x;
                    y = next_y;
                }
            }
            thread::sleep(Duration::from_millis(8));
        }
        Ok(BubbleDragResult { moved, x, y })
    }).await.map_err(|e| e.to_string())?
}

#[cfg(not(windows))]
#[tauri::command]
pub async fn drag_bubble(_app: AppHandle) -> Result<BubbleDragResult, String> {
    Err("当前系统暂不支持任务球拖动".into())
}
