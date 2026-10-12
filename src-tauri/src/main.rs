// 桌面端入口：发布版隐藏控制台窗口
#![cfg_attr(target_os = "windows", windows_subsystem = "windows")]

fn main() {
    // Handle one-shot calls before the single-instance or GUI startup path.
    // Never create WebViews, a tray icon, a bubble or a background listener.
    if let Some(code) = xmission_lib::run_cli() {
        std::process::exit(code);
    }
    xmission_lib::run()
}
