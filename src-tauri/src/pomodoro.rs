use chrono::Utc;
use sqlx::{Executor, Row, Sqlite, SqlitePool};
use tauri::{AppHandle, Emitter, State};
use uuid::Uuid;

use crate::gamification;
use crate::models::PomodoroSession;

const SESSION_SELECT: &str = "SELECT p.id, p.task_id, t.title AS task_title, p.started_at, p.duration_min, p.state, p.remaining_secs, p.updated_at
     FROM pomodoro_sessions p LEFT JOIN tasks t ON t.id = p.task_id";

fn now_utc_iso() -> String {
    Utc::now().to_rfc3339()
}

fn row_to_session(row: &sqlx::sqlite::SqliteRow) -> PomodoroSession {
    PomodoroSession {
        id: row.get("id"),
        task_id: row.get("task_id"),
        task_title: row.get("task_title"),
        started_at: row.get("started_at"),
        duration_min: row.get("duration_min"),
        state: row.get("state"),
        remaining_secs: row.get("remaining_secs"),
        updated_at: row.get("updated_at"),
    }
}

/// 与前端 remainingSecsNow 一致：running 时扣掉 updated_at 至今的流逝，paused 取冻结值。
fn live_remaining(state: &str, remaining_secs: i64, updated_at: &str) -> i64 {
    if state != "running" {
        return remaining_secs.max(0);
    }
    let updated = chrono::DateTime::parse_from_rfc3339(updated_at)
        .map(|d| d.with_timezone(&Utc))
        .unwrap_or_else(|_| Utc::now());
    (remaining_secs - (Utc::now() - updated).num_seconds()).max(0)
}

async fn fetch_session<'a>(executor: impl Executor<'a, Database = Sqlite>, id: &str) -> Result<PomodoroSession, String> {
    let sql = format!("{SESSION_SELECT} WHERE p.id = ?");
    sqlx::query(&sql)
        .bind(id)
        .fetch_optional(executor)
        .await
        .map_err(|e| e.to_string())?
        .map(|r| row_to_session(&r))
        .ok_or_else(|| format!("番茄钟会话不存在：{id}"))
}

/// 同时只允许一个活跃会话（running/paused）。
async fn active_session<'a>(executor: impl Executor<'a, Database = Sqlite>) -> Result<Option<PomodoroSession>, String> {
    let sql = format!("{SESSION_SELECT} WHERE p.state IN ('running', 'paused') ORDER BY p.updated_at DESC LIMIT 1");
    sqlx::query(&sql)
        .fetch_optional(executor)
        .await
        .map_err(|e| e.to_string())
        .map(|opt| opt.map(|r| row_to_session(&r)))
}

fn emit_pomodoro_changed(app: &AppHandle, session: Option<&PomodoroSession>) {
    let _ = app.emit("pomodoro-changed", session);
}

/// 启动崩溃恢复：把残留 running 会话冻结为 paused（lib.rs setup 中调用）。
pub async fn freeze_orphan_sessions(pool: &SqlitePool) -> Result<(), String> {
    let rows: Vec<(String, i64, String)> = sqlx::query_as(
        "SELECT id, remaining_secs, updated_at FROM pomodoro_sessions WHERE state = 'running'",
    )
    .fetch_all(pool)
    .await
    .map_err(|e| e.to_string())?;
    for (id, remaining_secs, updated_at) in rows {
        let frozen = live_remaining("running", remaining_secs, &updated_at);
        sqlx::query(
            "UPDATE pomodoro_sessions SET state = 'paused', remaining_secs = ?, updated_at = ? WHERE id = ?",
        )
        .bind(frozen)
        .bind(now_utc_iso())
        .bind(&id)
        .execute(pool)
        .await
        .map_err(|e| e.to_string())?;
    }
    Ok(())
}

// ---------- Tauri Commands（契约 §2.2） ----------

#[tauri::command]
pub async fn pomodoro_start(
    app: AppHandle,
    state: State<'_, SqlitePool>,
    task_id: Option<String>,
) -> Result<PomodoroSession, String> {
    let session = start_session_db(state.inner(), task_id).await?;
    emit_pomodoro_changed(&app, Some(&session));
    Ok(session)
}

pub(crate) async fn start_session_db(pool: &SqlitePool, task_id: Option<String>) -> Result<PomodoroSession, String> {
    let mut tx = gamification::begin_write(pool).await?;
    if let Some(id) = &task_id {
        let exists: bool = sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM tasks WHERE id = ?)")
            .bind(id).fetch_one(&mut *tx).await.map_err(|e| e.to_string())?;
        if !exists { return Err("任务不存在，原专注会话已保留".into()); }
    }
    let now = now_utc_iso();

    // 已有 running/paused 会话先标记 abandoned
    sqlx::query(
        "UPDATE pomodoro_sessions SET state = 'abandoned', updated_at = ? WHERE state IN ('running', 'paused')",
    )
    .bind(&now)
    .execute(&mut *tx)
    .await
    .map_err(|e| e.to_string())?;

    // duration 取 settings.pomodoro_work_min（缺省 25）
    let duration_min: i64 = sqlx::query_scalar::<_, String>(
        "SELECT value FROM settings WHERE key = 'pomodoro_work_min'",
    )
    .fetch_optional(&mut *tx)
    .await
    .map_err(|e| e.to_string())?
    .and_then(|v| v.parse::<i64>().ok())
    .filter(|v| (1..=180).contains(v))
    .unwrap_or(25);

    let id = Uuid::new_v4().to_string();
    sqlx::query(
        "INSERT INTO pomodoro_sessions (id, task_id, started_at, duration_min, state, remaining_secs, updated_at)
         VALUES (?, ?, ?, ?, 'running', ?, ?)",
    )
    .bind(&id)
    .bind(&task_id)
    .bind(&now)
    .bind(duration_min)
    .bind(duration_min * 60)
    .bind(&now)
    .execute(&mut *tx)
    .await
    .map_err(|e| e.to_string())?;

    let session = fetch_session(&mut *tx, &id).await?;
    tx.commit().await.map_err(|e| e.to_string())?;
    Ok(session)
}

#[tauri::command]
pub async fn pomodoro_pause(
    app: AppHandle,
    state: State<'_, SqlitePool>,
) -> Result<PomodoroSession, String> {
    let mut tx = gamification::begin_write(state.inner()).await?;
    let session = active_session(&mut *tx)
        .await?
        .ok_or_else(|| "没有活跃的番茄钟会话".to_string())?;
    if session.state == "paused" {
        tx.commit().await.map_err(|e| e.to_string())?;
        return Ok(session);
    }
    // running → paused，冻结剩余秒数
    let frozen = live_remaining(&session.state, session.remaining_secs, &session.updated_at);
    sqlx::query(
        "UPDATE pomodoro_sessions SET state = 'paused', remaining_secs = ?, updated_at = ? WHERE id = ?",
    )
    .bind(frozen)
    .bind(now_utc_iso())
    .bind(&session.id)
    .execute(&mut *tx)
    .await
    .map_err(|e| e.to_string())?;
    let session = fetch_session(&mut *tx, &session.id).await?;
    tx.commit().await.map_err(|e| e.to_string())?;
    emit_pomodoro_changed(&app, Some(&session));
    Ok(session)
}

#[tauri::command]
pub async fn pomodoro_resume(
    app: AppHandle,
    state: State<'_, SqlitePool>,
) -> Result<PomodoroSession, String> {
    let mut tx = gamification::begin_write(state.inner()).await?;
    let session = active_session(&mut *tx)
        .await?
        .ok_or_else(|| "没有活跃的番茄钟会话".to_string())?;
    if session.state == "running" {
        tx.commit().await.map_err(|e| e.to_string())?;
        return Ok(session);
    }
    // paused → running，updated_at = now（前端据此推导流逝）
    sqlx::query("UPDATE pomodoro_sessions SET state = 'running', updated_at = ? WHERE id = ?")
        .bind(now_utc_iso())
        .bind(&session.id)
        .execute(&mut *tx)
        .await
        .map_err(|e| e.to_string())?;
    let session = fetch_session(&mut *tx, &session.id).await?;
    tx.commit().await.map_err(|e| e.to_string())?;
    emit_pomodoro_changed(&app, Some(&session));
    Ok(session)
}

#[tauri::command]
pub async fn pomodoro_finish(
    app: AppHandle,
    state: State<'_, SqlitePool>,
    completed: bool,
) -> Result<(), String> {
    let wallet = finish_session_db(state.inner(), completed).await?;
    if let Some(wallet) = wallet { let _ = app.emit("wallet-updated", wallet); }
    emit_pomodoro_changed(&app, None);
    Ok(())
}

pub(crate) async fn finish_session_db(pool: &SqlitePool, completed: bool) -> Result<Option<crate::models::Wallet>, String> {
    let mut tx = gamification::begin_write(pool).await?;
    let Some(session) = active_session(&mut *tx).await? else {
        tx.commit().await.map_err(|e| e.to_string())?;
        return Ok(None);
    };
    let new_state = if completed { "done" } else { "abandoned" };
    let frozen = live_remaining(&session.state, session.remaining_secs, &session.updated_at);
    sqlx::query(
        "UPDATE pomodoro_sessions SET state = ?, remaining_secs = ?, updated_at = ? WHERE id = ?",
    )
    .bind(new_state)
    .bind(frozen)
    .bind(now_utc_iso())
    .bind(&session.id)
    .execute(&mut *tx)
    .await
    .map_err(|e| e.to_string())?;

    if completed {
        // 契约 §2.3：完成番茄钟结算 XP 5 / 金币 2（reason="pomodoro"）
        gamification::settle_earn(&mut tx, 5, 2, "pomodoro", Some(&session.id)).await?;
    }

    let wallet = gamification::build_wallet(&mut *tx).await?;
    tx.commit().await.map_err(|e| e.to_string())?;
    Ok(Some(wallet))
}

#[tauri::command]
pub async fn pomodoro_current(
    state: State<'_, SqlitePool>,
) -> Result<Option<PomodoroSession>, String> {
    active_session(state.inner()).await
}
