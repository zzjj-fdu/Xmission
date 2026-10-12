mod ai;
mod agent_api;
mod agent_tools;
mod agent_once;
mod openclaw;
mod onboarding;
mod credentials;
pub use agent_once::run_cli;
mod calendar;
mod companion;
mod companion_life;
mod companion_ai;
mod pet_perch;
mod perch_bounds;
mod panda_bounds;
mod pet_exploration;
#[cfg(not(test))]
mod companion_desktop;
#[cfg(not(test))]
mod companion_toy;
#[cfg(not(test))]
mod companion_chat_window;
#[cfg(not(test))]
mod desktop_icons;
mod companion_feedback;
mod companion_memory;
mod pet_dock;
#[cfg(any(windows,test))]
mod pet_hit_region;
#[cfg(not(test))]
mod companion_dock;
#[cfg(not(test))]
mod companion_window;
mod course;
mod db;
mod export;
mod gamification;
mod llm;
mod lottery;
mod models;
mod pomodoro;
mod preparation;
mod journey;
mod planning;
mod trash;
mod features;
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
            app.manage(onboarding::OnboardingPresentation::default());
            app.manage(std::sync::Arc::new(companion_window::PetRuntime::default()));
            app.manage(companion_desktop::DesktopRuntime::default());
            app.manage(companion_toy::ToyRuntime::default());
            app.manage(startup::TaskEntryRuntime::default());
            let agent_service = agent_api::AgentService::default();
            tauri::async_runtime::block_on(agent_api::restore(&agent_service, &pool, app.handle().clone()));
            app.manage(agent_service);
            let claw_runtime = std::sync::Arc::new(openclaw::ClawRuntime::default());
            app.manage(claw_runtime.clone());
            openclaw::restore(app.handle().clone(),pool.clone(),claw_runtime);
            tauri::async_runtime::block_on(pomodoro::freeze_orphan_sessions(&pool))
                .map_err(std::io::Error::other)?;
            for config in &app.config().app.windows {
                let builder=tauri::WebviewWindowBuilder::from_config(app.handle(), config)
                    .map_err(|e|std::io::Error::other(format!("初始化 {} 窗口配置：{e}",config.label)))?;
                #[cfg(windows)]
                let builder=if std::env::var_os("XMISSION_DATA_DIR").is_some(){builder.data_directory(app_data_dir.join("webview"))}else{builder};
                builder.build().map_err(|e|std::io::Error::other(format!("创建 {} 窗口：{e}",config.label)))?;
            }
            startup::prepare_bubble(app.handle()).map_err(|e|std::io::Error::other(format!("准备任务球窗口：{e}")))?;
            startup::serve_single_instance(instance_listener, app.handle().clone());
            let open = MenuItem::with_id(app, "open-main", "打开 Xmission", true, None::<&str>)?;
            let widget = MenuItem::with_id(app, "open-widget", "显示任务悬浮窗", true, None::<&str>)?;
            let summon = MenuItem::with_id(app, "pet-summon", "召回桌面小狐狸", true, None::<&str>)?;
            let pet = MenuItem::with_id(app, "pet-home", "打开伙伴菜单", true, None::<&str>)?;
            let quit = MenuItem::with_id(app, "quit", "退出 Xmission", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&open, &widget, &summon, &pet, &quit])?;
            let mut tray = TrayIconBuilder::new()
                .tooltip("Xmission · 点击打开")
                .menu(&menu)
                .show_menu_on_left_click(false)
                .on_menu_event(|app, event| match event.id.as_ref() {
                    "open-main" => { startup::show_main_window(app); },
                    "open-widget" | "show-widget" => { let _ = app.emit("widget:show", ()); },
                    "hide-widget" => {
                        startup::hide_task_windows(app);
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
            companion_window::start_service(app.handle().clone(),pool.clone());
            companion_desktop::start(app.handle().clone());
            companion_toy::start(app.handle().clone());
            preparation::start_service(app.handle().clone(),pool.clone());
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            planning::get_goal_overview,
            planning::set_goal_focus,
            planning::advance_goal_stage,
            planning::configure_step_plan,
            planning::reorder_work,
            planning::preview_replan,
            planning::apply_replan,
            planning::get_progress_review,
            trash::list_deleted_items,
            trash::restore_deleted_item,
            preparation::save_preparation,
            preparation::list_preparations,
            preparation::pause_preparation,
            preparation::revoke_preparation,
            preparation::pause_all_preparations,
            preparation::retry_preparation,
            preparation::preparation_history,
            preparation::open_preparation_artifact,
            preparation::read_preparation_artifact,
            preparation::open_preparation_source,
            preparation::open_preparation_task,
            preparation::start_focus_environment,
            journey::get_journey,
            journey::journey_action,
            companion::get_companion_home,
            companion::get_reminder_inbox,
            companion::acknowledge_reminder,
            companion_memory::list_companion_goals,
            companion_memory::set_companion_goal,
            companion_memory::forget_companion_memory,
            companion_memory::set_companion_keepsake,
            companion_memory::polish_companion_letter,
            companion_window::summon_companion,
            companion::interact_companion,
            companion::list_companion_collection,
            companion::update_companion_preferences,
            companion::start_companion_trip,
            companion::claim_companion_trip,
            companion::companion_chat,
            companion_life::begin_companion_play,
            companion_life::catch_companion_paper,
            companion_ai::get_companion_ai_budget,
            companion_ai::set_companion_ai_budget,
            companion_ai::list_companion_help,
            companion_ai::dismiss_companion_help,
            companion_desktop::list_companion_windows,
            companion_desktop::attach_companion_window,
            companion_desktop::release_companion_window,
            companion_desktop::get_companion_attachment,
            companion_desktop::get_companion_attachment_mode,
            companion_desktop::companion_perch_ready,
            companion_desktop::get_companion_perch_motion,
            companion_desktop::list_companion_icons,
            companion_toy::start_toy,
            companion_toy::drag_toy,
            companion_toy::fetch_toy,
            companion_toy::dismiss_toy,
            companion_toy::toy_ready,
            companion_chat_window::open_companion_input,
            companion_chat_window::dismiss_companion_input,
            companion_chat_window::send_companion_message,
            companion_chat_window::resize_companion_input,
            companion_chat_window::show_companion_last_reply,
            companion_window::expand_companion_note,
            companion_window::get_companion_notice,
            companion_window::dismiss_companion_notice,
            companion_window::open_companion_home,
            companion_window::get_companion_panel_tab,
            companion_window::dismiss_companion_panel,
            companion_window::show_companion_menu,
            companion_window::drag_companion,
            companion_window::wander_companion,
            companion_window::prepare_companion_walk,
            companion_window::get_companion_surroundings,
            companion_window::stop_companion_motion,
            companion_window::save_companion_position,
            companion_window::companion_double_click_ms,
            companion_window::companion_hovering,
            companion_window::companion_activity,
            companion_window::set_companion_mode,
            companion_window::get_companion_morph,
            companion_window::companion_morph_ready,
            companion_dock::get_companion_dock,
            companion_dock::reveal_companion,
            companion_window::set_companion_hit_mask,
            companion_window::show_companion_bubble,
            companion_window::open_companion_tasks,
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
            startup::collapse_task_widget,
            startup::expand_task_widget,
            scheduler::get_ranked_today,
            agent_api::get_agent_status,
            agent_api::set_agent_connection,
            agent_api::reset_agent_token,
            agent_api::get_agent_config,
            openclaw::claw_status,
            openclaw::claw_action,
            onboarding::onboarding_scene,
            onboarding::get_first_task,
            onboarding::create_first_task,
            agent_api::get_agent_once_instructions,
            agent_api::test_agent_connection,
            agent_api::get_agent_activity,
            settings::get_setting,
            settings::get_settings,
            settings::set_setting,
            export::export_daily_report,
            export::export_json_backup,
            export::restore_json_backup,
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
            llm::summarize_calendar_event,
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
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|_app, _event| {
            if matches!(_event,tauri::RunEvent::Exit) { openclaw::shutdown(&_app.state::<std::sync::Arc<openclaw::ClawRuntime>>()); }
            // Finder/Dock reopens an existing macOS process without starting a second one.
            #[cfg(target_os = "macos")]
            if let tauri::RunEvent::Reopen { .. } = _event {
                startup::show_main_window(_app);
            }
        });
}
