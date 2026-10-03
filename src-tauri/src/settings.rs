use sqlx::SqlitePool;
use tauri::{AppHandle, Emitter, State};

#[tauri::command]
pub async fn get_settings(state: State<'_, SqlitePool>) -> Result<std::collections::HashMap<String, String>, String> {
    let rows: Vec<(String, String)> = sqlx::query_as("SELECT key, value FROM settings")
        .fetch_all(state.inner()).await.map_err(|e| e.to_string())?;
    Ok(rows.into_iter().collect())
}

// 契约 §2.6：约定 key 为 main_quest_soft_cap / pomodoro_work_min / pomodoro_break_min，
// 读取方负责缺省值 fallback，本模块不内置默认值。

#[tauri::command]
pub async fn get_setting(
    state: State<'_, SqlitePool>,
    key: String,
) -> Result<Option<String>, String> {
    sqlx::query_scalar::<_, String>("SELECT value FROM settings WHERE key = ?")
        .bind(&key)
        .fetch_optional(state.inner())
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn set_setting(
    state: State<'_, SqlitePool>,
    app: AppHandle,
    key: String,
    value: String,
) -> Result<(), String> {
    validate_generic_setting(&key, &value)?;
    sqlx::query(
        "INSERT INTO settings (key, value) VALUES (?, ?)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value",
    )
    .bind(&key)
    .bind(&value)
    .execute(state.inner())
    .await
    .map_err(|e| e.to_string())?;
    if let Err(err) = app.emit("settings-changed", serde_json::json!({ "key": key, "value": value })) {
        eprintln!("[settings] 设置已保存，但广播更新失败: {err}");
    }
    Ok(())
}

fn validate_generic_setting(key: &str, value: &str) -> Result<(), String> {
    if key.trim().is_empty() { return Err("设置项 key 不能为空".into()); }
    if matches!(key, "llm_base_url" | "llm_model" | "llm_api_key" | "lottery_config") {
        return Err("请使用 AI 或抽奖专用配置入口保存此设置".into());
    }
    if matches!(key, "pomodoro_work_min" | "pomodoro_break_min")
        && !value.parse::<i64>().is_ok_and(|n| (1..=180).contains(&n)) {
        return Err("专注和休息时长必须为 1–180 分钟".into());
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn generic_settings_cannot_bypass_protected_configuration() {
        for key in ["llm_base_url", "llm_model", "llm_api_key", "lottery_config"] {
            assert!(validate_generic_setting(key, "anything").is_err());
        }
        assert!(validate_generic_setting("theme", "stardew-valley").is_ok());
        for value in ["0", "-5", "181", "not a number"] {
            assert!(validate_generic_setting("pomodoro_work_min", value).is_err());
        }
        assert!(validate_generic_setting("pomodoro_work_min", "25").is_ok());
    }
}
