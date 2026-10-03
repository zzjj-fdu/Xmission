//! User initiated exports. API keys live in the OS keyring and never enter these files.
use chrono::{Local, Utc};
use serde_json::{Map, Value};
use sqlx::{Column, Row, SqlitePool, TypeInfo, ValueRef};
use tauri::{AppHandle, Manager, State};
use std::io::Write;

const TABLES: &[&str] = &[
    "tasks", "task_steps", "pomodoro_sessions", "xp_ledger", "coin_ledger",
    "rewards", "reward_redemptions", "streaks", "settings", "courses",
    "course_slots", "holidays", "ai_suggestions", "lottery_draws",
];

fn export_dir(app: &AppHandle) -> Result<std::path::PathBuf, String> {
    let dir = app.path().document_dir().map_err(|e| e.to_string())?.join("Xmission");
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir)
}

fn row_json(row: &sqlx::sqlite::SqliteRow) -> Result<Value, String> {
    let mut object = Map::new();
    for col in row.columns() {
        let name = col.name();
        let raw = row.try_get_raw(name).map_err(|e| e.to_string())?;
        let value = if raw.is_null() {
            Value::Null
        } else {
            match raw.type_info().name() {
                "INTEGER" => Value::from(row.try_get::<i64, _>(name).map_err(|e| e.to_string())?),
                "REAL" => Value::from(row.try_get::<f64, _>(name).map_err(|e| e.to_string())?),
                _ => Value::from(row.try_get::<String, _>(name).map_err(|e| e.to_string())?),
            }
        };
        object.insert(name.to_string(), value);
    }
    Ok(Value::Object(object))
}

#[tauri::command]
pub async fn export_json_backup(app: AppHandle, pool: State<'_, SqlitePool>) -> Result<String, String> {
    let document = backup_document(pool.inner()).await?;
    let path = write_backup(&export_dir(&app)?, &document)?;
    Ok(path.to_string_lossy().into_owned())
}

pub(crate) async fn backup_document(pool: &SqlitePool) -> Result<Value, String> {
    let mut tx = pool.begin().await.map_err(|e| e.to_string())?;
    let mut tables = Map::new();
    for table in TABLES {
        // Names are a fixed internal allowlist, never caller supplied.
        let rows = sqlx::query(&format!("SELECT * FROM {table}"))
            .fetch_all(&mut *tx).await.map_err(|e| e.to_string())?;
        let values = rows.iter().map(row_json).collect::<Result<Vec<_>, _>>()?;
        tables.insert((*table).to_string(), Value::Array(values));
    }
    tx.commit().await.map_err(|e| e.to_string())?;
    Ok(serde_json::json!({
        "format": "xmission-backup-v1",
        "exported_at": Utc::now().to_rfc3339(),
        "tables": tables,
    }))
}

pub(crate) fn write_backup(dir: &std::path::Path, document: &Value) -> Result<std::path::PathBuf, String> {
    let filename = format!("Xmission-backup-{}-{}.json", Local::now().format("%Y%m%d-%H%M%S"), uuid::Uuid::new_v4());
    let path = dir.join(filename);
    let bytes = serde_json::to_vec_pretty(document).map_err(|e| e.to_string())?;
    let mut file = std::fs::OpenOptions::new().write(true).create_new(true).open(&path).map_err(|e| e.to_string())?;
    if let Err(error) = file.write_all(&bytes).and_then(|()| file.sync_all()) {
        drop(file);
        let _ = std::fs::remove_file(&path);
        return Err(error.to_string());
    }
    Ok(path)
}

fn clean_markdown(text: &str) -> String {
    text.replace(['\r', '\n'], " ").trim().to_string()
}

#[tauri::command]
pub async fn export_daily_report(app: AppHandle, pool: State<'_, SqlitePool>) -> Result<String, String> {
    let today = crate::gamification::task_day(Local::now()).to_string();
    let rows = sqlx::query(
        "SELECT title, status, recurrence, last_done_date, completed_at, planned_date \
         FROM tasks ORDER BY created_at",
    ).fetch_all(pool.inner()).await.map_err(|e| e.to_string())?;
    let mut completed = Vec::new();
    let mut remaining = Vec::new();
    for row in rows {
        let title: String = row.try_get("title").map_err(|e| e.to_string())?;
        let status: String = row.try_get("status").map_err(|e| e.to_string())?;
        let recurrence: String = row.try_get("recurrence").map_err(|e| e.to_string())?;
        let last_done: Option<String> = row.try_get("last_done_date").map_err(|e| e.to_string())?;
        let completed_at: Option<String> = row.try_get("completed_at").map_err(|e| e.to_string())?;
        let planned: Option<String> = row.try_get("planned_date").map_err(|e| e.to_string())?;
        let done_today = if recurrence != "none" {
            last_done.as_deref() == Some(today.as_str())
        } else {
            completed_at.as_deref().is_some_and(|s| {
                chrono::DateTime::parse_from_rfc3339(s).ok()
                    .is_some_and(|dt| crate::gamification::task_day(dt.with_timezone(&Local)).to_string() == today)
            })
        };
        if done_today {
            completed.push(format!("- [x] {}", clean_markdown(&title)));
        } else if status != "done" && (planned.as_deref() == Some(today.as_str()) || planned.is_none()) {
            remaining.push(format!("- [ ] {}", clean_markdown(&title)));
        }
    }
    let focus: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM pomodoro_sessions WHERE state = 'done' \
         AND date(started_at, 'localtime', '-4 hours') = ?",
    ).bind(&today).fetch_one(pool.inner()).await.map_err(|e| e.to_string())?;
    let xp: i64 = sqlx::query_scalar(
        "SELECT COALESCE(SUM(delta), 0) FROM xp_ledger \
         WHERE date(created_at, 'localtime', '-4 hours') = ?",
    ).bind(&today).fetch_one(pool.inner()).await.map_err(|e| e.to_string())?;
    let coins: i64 = sqlx::query_scalar(
        "SELECT COALESCE(SUM(delta), 0) FROM coin_ledger \
         WHERE date(created_at, 'localtime', '-4 hours') = ?",
    ).bind(&today).fetch_one(pool.inner()).await.map_err(|e| e.to_string())?;
    let body = format!(
        "# Xmission 日报 · {today}\n\n完成 {done} 项任务 · {focus} 个番茄钟 · XP {xp:+} · 金币 {coins:+}\n\n## 已完成\n\n{completed}\n\n## 待继续\n\n{remaining}\n",
        done = completed.len(),
        completed = if completed.is_empty() { "暂无".to_string() } else { completed.join("\n") },
        remaining = if remaining.is_empty() { "暂无".to_string() } else { remaining.join("\n") },
    );
    let path = export_dir(&app)?.join(format!("Xmission-日报-{today}.md"));
    std::fs::write(&path, body).map_err(|e| e.to_string())?;
    Ok(path.to_string_lossy().into_owned())
}
