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
    "companion_trips", "companion_collection", "companion_reminders", "companion_care_events", "companion_feedback", "companion_notice_queue", "companion_memories", "companion_goal_categories",
    "preparation_rules", "preparation_runs", "preparation_events", "companion_chapters", "companion_chapter_keepsakes",
    "agent_requests",
    "companion_journey_requests",
    "goal_preferences", "planning_schedule", "deleted_items", "planning_previews",
    "companion_play_sessions", "companion_ai_calls", "companion_help_drafts",
];

fn export_dir(app: &AppHandle) -> Result<std::path::PathBuf, String> {
    let dir = app.path().document_dir().map_err(|e| e.to_string())?.join("Xmission");
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir)
}

pub(crate) fn row_json(row: &sqlx::sqlite::SqliteRow) -> Result<Value, String> {
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

/// Restore is all-or-nothing. Table/column identifiers come from our schema;
/// backup values are bound parameters and can never become executable SQL.
pub(crate) async fn restore_document(pool:&SqlitePool,document:&Value)->Result<(),String> {
    if document["format"]!="xmission-backup-v1" {return Err("不是支持的 Xmission 备份".into());}
    let tables=document["tables"].as_object().ok_or("备份缺少数据表")?;
    if !tables.contains_key("tasks")||!tables.contains_key("settings") {return Err("备份缺少任务或设置，未恢复".into());}
    if tables.keys().any(|key|!TABLES.contains(&key.as_str())) {return Err("备份包含当前版本不支持的数据表，请使用相应版本恢复".into());}
    let size=serde_json::to_vec(document).map_err(|e|e.to_string())?.len();
    if size>32*1024*1024 {return Err("备份超过 32 MB".into());}
    let mut tx=crate::gamification::begin_write(pool).await?;
    sqlx::query("PRAGMA defer_foreign_keys=ON").execute(&mut *tx).await.map_err(|e|e.to_string())?;
    for table in TABLES.iter().rev() {sqlx::query(&format!("DELETE FROM {table}")).execute(&mut *tx).await.map_err(|e|e.to_string())?;}
    let mut count=0usize;
    for table in TABLES {
        let Some(values)=tables.get(*table) else{continue;};
        let rows=values.as_array().ok_or("备份表必须是数组")?;count+=rows.len();if count>200_000 {return Err("备份记录过多".into());}
        let columns:Vec<String>=sqlx::query_scalar(&format!("SELECT name FROM pragma_table_info('{table}')")).fetch_all(&mut *tx).await.map_err(|e|e.to_string())?;
        for row in rows {
            let object=row.as_object().ok_or("备份记录格式错误")?;
            if object.is_empty()||object.keys().any(|k|!columns.contains(k)) {return Err(format!("{table} 的字段与当前版本不兼容"));}
            let names=object.keys().map(|k|format!("\"{k}\"")).collect::<Vec<_>>().join(",");
            let placeholders=vec!["?";object.len()].join(",");
            let sql=format!("INSERT INTO {table}({names})VALUES({placeholders})");let mut query=sqlx::query(&sql);
            for value in object.values() {
                query=match value {
                    Value::Null=>query.bind(None::<String>),Value::String(s)=>query.bind(s),
                    Value::Number(n) if n.is_i64()=>query.bind(n.as_i64().unwrap()),
                    Value::Number(n) if n.is_f64()=>query.bind(n.as_f64().unwrap()),
                    _=>return Err("备份字段必须是文本、数字或空值".into()),
                };
            }
            query.execute(&mut *tx).await.map_err(|e|format!("备份记录校验失败，原数据保留：{e}"))?;
        }
    }
    if !tables.contains_key("companion_journey_requests") {
        sqlx::query("INSERT INTO companion_journey_requests(request_id) SELECT request_id FROM agent_requests WHERE tool='journey_action'").execute(&mut *tx).await.map_err(|e|e.to_string())?;
    }
    // Restored history is readable; running work and machine/file grants are
    // explicitly not resurrected from a backup on another machine.
    sqlx::query("UPDATE preparation_rules SET enabled=0,needs_authorization=1").execute(&mut *tx).await.map_err(|e|e.to_string())?;
    sqlx::query("UPDATE preparation_runs SET state=CASE WHEN state='ready' THEN 'stale' ELSE 'cancelled' END,error='从备份恢复，执行已停止；文件范围需重新授权',lease_until=NULL WHERE state IN('queued','running','ready','failed')").execute(&mut *tx).await.map_err(|e|e.to_string())?;
    sqlx::query("UPDATE pomodoro_sessions SET state='paused' WHERE state='running'").execute(&mut *tx).await.map_err(|e|e.to_string())?;
    for (key,value) in [("agent_enabled","false"),("preparation_paused","true")] {
        sqlx::query("INSERT INTO settings(key,value)VALUES(?,?)ON CONFLICT(key)DO UPDATE SET value=excluded.value").bind(key).bind(value).execute(&mut *tx).await.map_err(|e|e.to_string())?;
    }
    for key in ["llm_api_key","agent_access_token"] {sqlx::query("DELETE FROM settings WHERE key=?").bind(key).execute(&mut *tx).await.map_err(|e|e.to_string())?;}
    tx.commit().await.map_err(|e|format!("备份关联检查失败，原数据保留：{e}"))
}

#[cfg(not(test))]
#[tauri::command]
pub async fn restore_json_backup(app:AppHandle,pool:State<'_,SqlitePool>,document:Value)->Result<String,String> {
    use tauri::Emitter;
    // Preserve a complete current snapshot before any restore writes.
    let safety=write_backup(&export_dir(&app)?,&backup_document(pool.inner()).await?)?;
    let port=crate::agent_api::saved_port(pool.inner()).await?;
    restore_document(pool.inner(),&document).await?;
    crate::agent_api::set_agent_connection(app.clone(),app.state::<crate::agent_api::AgentService>(),app.state::<SqlitePool>(),false,port).await?;
    for event in ["tasks-changed","steps-changed","preparations-changed","journey-changed","companion-changed","settings-changed"] {let _=app.emit(event,());}
    let _=app.emit("wallet-updated",crate::gamification::build_wallet(pool.inner()).await?);
    let _=app.emit("pomodoro-changed",crate::pomodoro::pomodoro_current(app.state::<SqlitePool>()).await?);
    let _=app.emit("backup-restored",());
    Ok(format!("已恢复备份，准备与接管已暂停。恢复前的备份：{}",safety.display()))
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
#[cfg(test)] mod tests;

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
