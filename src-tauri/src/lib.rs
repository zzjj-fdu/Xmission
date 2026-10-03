mod ai;
mod calendar;
mod course;
mod db;
mod export;
mod gamification;
mod llm;
mod lottery;
mod models;
mod pomodoro;
mod recurring;
mod scheduler;
mod school_schedule;
mod settings;
mod steps;
// Native menus/window operations pull GUI DLL entry points into the Windows GNU test binary.
// The startup module has no unit tests; keep pure logic tests independent of those DLLs.
#[cfg(not(test))]
mod startup;
mod task_engine;
#[cfg(test)]
mod audit_tests;

#[cfg(not(test))]
use tauri::{Emitter, Manager};
#[cfg(not(test))]
use tauri::{menu::{Menu, MenuItem}, tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent}};

// 测试构建时排除 Tauri 运行时入口：单元测试只覆盖纯校验函数，
// 而 run() 会把 wry/WebView2Loader 动态库引入测试可执行文件，
// 在本机 windows-gnu 环境下导致测试进程启动即崩（0xc0000139）。
#[cfg(not(test))]
#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let instance_listener = match startup::claim_single_instance() {
        Ok(Some(listener)) => listener,
        Ok(None) => return,
        Err(error) => { eprintln!("{error}"); return; }
    };
    tauri::Builder::default()
        .setup(move |app| {
            // WebViews can call IPC as soon as their scripts load. Prepare state first,
            // otherwise the first main-window requests race database initialization.
            let app_data_dir = if let Some(path) = std::env::var_os("XMISSION_DATA_DIR") {
                std::path::PathBuf::from(path)
            } else {
                app.path().app_data_dir()?
            };
            let pool = tauri::async_runtime::block_on(db::init_pool(&app_data_dir))?;
            app.manage(pool.clone());
            tauri::async_runtime::block_on(pomodoro::freeze_orphan_sessions(&pool))
                .map_err(std::io::Error::other)?;
            for config in &app.config().app.windows {
                tauri::WebviewWindowBuilder::from_config(app.handle(), config)?.build()?;
            }
            startup::prepare_bubble(app.handle()).map_err(std::io::Error::other)?;
            startup::serve_single_instance(instance_listener, app.handle().clone());
            let open = MenuItem::with_id(app, "open-main", "打开 Xmission", true, None::<&str>)?;
            let widget = MenuItem::with_id(app, "open-widget", "显示任务悬浮窗", true, None::<&str>)?;
            let quit = MenuItem::with_id(app, "quit", "退出 Xmission", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&open, &widget, &quit])?;
            let mut tray = TrayIconBuilder::new()
                .tooltip("Xmission · 点击打开")
                .menu(&menu)
                .show_menu_on_left_click(false)
                .on_menu_event(|app, event| match event.id.as_ref() {
                    "open-main" => { startup::show_main_window(app); },
                    "open-widget" | "show-widget" => { let _ = app.emit("widget:show", ()); },
                    "hide-widget" => {
                        if let Some(win) = app.get_webview_window("widget") { let _ = win.hide(); }
                        if let Some(win) = app.get_webview_window("bubble") { let _ = win.hide(); }
                    },
                    "quit" => app.exit(0),
                    _ => {},
                })
                .on_tray_icon_event(|tray, event| {
                    if let TrayIconEvent::Click { button: MouseButton::Left, button_state: MouseButtonState::Up, .. } = event {
                        let app = tray.app_handle();
                        startup::show_main_window(app);
                    }
                });
            if let Some(icon) = app.default_window_icon() { tray = tray.icon(icon.clone()); }
            tray.build(app)?;
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            task_engine::create_task,
            task_engine::update_task,
            task_engine::complete_task,
            task_engine::reopen_task,
            task_engine::delete_task,
            task_engine::list_tasks,
            steps::add_step,
            steps::update_step,
            steps::complete_step,
            steps::reopen_step,
            steps::delete_step,
            steps::list_steps,
            pomodoro::pomodoro_start,
            pomodoro::pomodoro_pause,
            pomodoro::pomodoro_resume,
            pomodoro::pomodoro_finish,
            pomodoro::pomodoro_current,
            gamification::get_wallet,
            gamification::add_reward,
            gamification::update_reward,
            gamification::delete_reward,
            gamification::list_rewards,
            gamification::list_redemptions,
            gamification::redeem_reward,
            lottery::get_lottery_config,
            lottery::save_lottery_config,
            lottery::list_lottery_draws,
            lottery::draw_lottery,
            startup::get_autostart,
            startup::set_autostart,
            startup::quit_app,
            startup::show_widget_context_menu,
            startup::drag_bubble,
            startup::prepare_bubble_window,
            scheduler::get_ranked_today,
            settings::get_setting,
            settings::get_settings,
            settings::set_setting,
            export::export_daily_report,
            export::export_json_backup,
            course::save_course,
            course::delete_course,
            course::list_courses,
            course::get_week_schedule,
            course::override_slot,
            course::clear_override,
            course::parse_courses_file,
            course::save_courses_batch,
            calendar::get_month_view,
            calendar::get_day_detail,
            llm::get_llm_config,
            llm::set_llm_config,
            llm::test_llm_connection,
            llm::summarize_task_for_widget,
            school_schedule::ai_find_school_periods,
            llm::list_llm_models,
            llm::ai_parse_schedule_image,
            ai::ai_parse_task,
            ai::ai_decompose_task,
            ai::ai_classify_icon,
            ai::ai_plan_week,
            ai::ai_suggest_slot,
            ai::update_suggestion_status,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
