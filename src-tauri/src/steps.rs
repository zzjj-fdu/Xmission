use chrono::Utc;
use sqlx::{Executor, Sqlite, SqlitePool};
use tauri::{AppHandle, Emitter, State};
use uuid::Uuid;

use crate::gamification;
use crate::models::Step;
use crate::task_engine::validate_title;

fn now_utc_iso() -> String {
    Utc::now().to_rfc3339()
}

fn emit_steps_changed(app: &AppHandle) {
    // 事件推送失败不应让已成功的写操作报错
    let _ = app.emit("steps-changed", ());
}

pub(crate) async fn fetch_step<'a>(executor: impl Executor<'a, Database = Sqlite>, id: &str) -> Result<Step, String> {
    sqlx::query_as::<_, Step>("SELECT * FROM task_steps WHERE id = ?")
        .bind(id)
        .fetch_optional(executor)
        .await
        .map_err(|e| e.to_string())?
        .ok_or_else(|| format!("步骤不存在：{id}"))
}

async fn task_exists<'a>(executor: impl Executor<'a, Database = Sqlite>, task_id: &str) -> Result<bool, String> {
    sqlx::query_scalar::<_, bool>("SELECT EXISTS(SELECT 1 FROM tasks WHERE id = ?)")
        .bind(task_id)
        .fetch_one(executor)
        .await
        .map_err(|e| e.to_string())
}

// ---------- Tauri Commands（契约 §2.1） ----------

#[tauri::command]
pub async fn add_step(
    app: AppHandle,
    state: State<'_, SqlitePool>,
    task_id: String,
    title: String,
    parent_step_id: Option<String>,
    deadline: Option<String>,
    estimated_min: Option<i64>,
) -> Result<Step, String> {
    let mut tx = gamification::begin_write(state.inner()).await?;
    let step = add_step_tx(&mut tx, task_id, title, parent_step_id, deadline, estimated_min).await?;
    tx.commit().await.map_err(|e| e.to_string())?;
    emit_steps_changed(&app);
    Ok(step)
}

pub(crate) async fn add_step_tx(tx: &mut sqlx::Transaction<'_, Sqlite>, task_id: String, title: String,
    parent_step_id: Option<String>, deadline: Option<String>, estimated_min: Option<i64>) -> Result<Step, String> {
    validate_title(&title)?;
    crate::task_engine::validate_schedule(deadline.as_deref(), estimated_min)?;
    if !task_exists(&mut **tx, &task_id).await? {
        return Err(format!("任务不存在：{task_id}"));
    }
    if let Some(pid) = &parent_step_id {
        let parent = fetch_step(&mut **tx, pid).await?;
        if parent.task_id != task_id { return Err("父步骤必须属于同一个任务".into()); }
    }

    // 新步骤 order_index = 同父已有步骤 max+1
    let next_order: i64 = match &parent_step_id {
        Some(pid) => sqlx::query_scalar(
            "SELECT COALESCE(MAX(order_index) + 1, 0) FROM task_steps WHERE task_id = ? AND parent_step_id = ?",
        )
        .bind(&task_id)
        .bind(pid)
        .fetch_one(&mut **tx)
        .await
        .map_err(|e| e.to_string())?,
        None => sqlx::query_scalar(
            "SELECT COALESCE(MAX(order_index) + 1, 0) FROM task_steps WHERE task_id = ? AND parent_step_id IS NULL",
        )
        .bind(&task_id)
        .fetch_one(&mut **tx)
        .await
        .map_err(|e| e.to_string())?,
    };

    let id = Uuid::new_v4().to_string();
    sqlx::query(
        "INSERT INTO task_steps (id, task_id, parent_step_id, title, order_index, deadline, estimated_min, surface_days, status, completed_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, NULL, 'open', NULL)",
    )
    .bind(&id)
    .bind(&task_id)
    .bind(&parent_step_id)
    .bind(title.trim())
    .bind(next_order)
    .bind(&deadline)
    .bind(estimated_min)
    .execute(&mut **tx)
    .await
    .map_err(|e| e.to_string())?;

    let step = fetch_step(&mut **tx, &id).await?;
    Ok(step)
}

#[tauri::command]
pub async fn update_step(
    app: AppHandle,
    state: State<'_, SqlitePool>,
    id: String,
    title: Option<String>,
    deadline: Option<String>,
    estimated_min: Option<i64>,
) -> Result<Step, String> {
    let mut tx = gamification::begin_write(state.inner()).await?;
    let step = update_step_tx(&mut tx, &id, title, deadline.map(Some), estimated_min.map(Some)).await?;
    tx.commit().await.map_err(|e| e.to_string())?;
    emit_steps_changed(&app);
    Ok(step)
}

pub(crate) async fn update_step_tx(tx: &mut sqlx::Transaction<'_, Sqlite>, id: &str, title: Option<String>,
    deadline: Option<Option<String>>, estimated_min: Option<Option<i64>>) -> Result<Step, String> {
    if let Some(title) = &title { validate_title(title)?; }
    crate::task_engine::validate_schedule(deadline.as_ref().and_then(|v| v.as_deref()), estimated_min.flatten())?;
    fetch_step(&mut **tx, id).await?;
    sqlx::query("UPDATE task_steps SET title = COALESCE(?, title), deadline = CASE WHEN ? THEN ? ELSE deadline END, estimated_min = CASE WHEN ? THEN ? ELSE estimated_min END WHERE id = ?")
        .bind(title.as_deref().map(str::trim)).bind(deadline.is_some()).bind(deadline.as_ref().and_then(|v| v.as_deref()))
        .bind(estimated_min.is_some()).bind(estimated_min.flatten()).bind(id)
        .execute(&mut **tx).await.map_err(|e| e.to_string())?;
    fetch_step(&mut **tx, id).await
}

#[tauri::command]
pub async fn complete_step(app: AppHandle, state: State<'_, SqlitePool>, id: String) -> Result<Step, String> {
    let (step, wallet) = set_step_completed(state.inner(), &id, true).await?;
    let _ = app.emit("wallet-updated", &wallet);
    emit_steps_changed(&app);
    Ok(step)
}

#[tauri::command]
pub async fn reopen_step(app: AppHandle, state: State<'_, SqlitePool>, id: String) -> Result<Step, String> {
    let (step, wallet) = set_step_completed(state.inner(), &id, false).await?;
    let _ = app.emit("wallet-updated", &wallet);
    emit_steps_changed(&app);
    Ok(step)
}

pub(crate) async fn set_step_completed(pool: &SqlitePool, id: &str, completed: bool) -> Result<(Step, crate::models::Wallet), String> {
    let mut tx = gamification::begin_write(pool).await?;
    let result = set_step_completed_tx(&mut tx, id, completed).await?;
    tx.commit().await.map_err(|e| e.to_string())?;
    Ok(result)
}

pub(crate) async fn set_step_completed_tx(tx: &mut sqlx::Transaction<'_, Sqlite>, id: &str, completed: bool) -> Result<(Step, crate::models::Wallet), String> {
    let existing = fetch_step(&mut **tx, id).await?;
    if (existing.status == "done") != completed {
        let status = if completed { "done" } else { "open" };
        let completed_at = completed.then(now_utc_iso);
        sqlx::query("UPDATE task_steps SET status = ?, completed_at = ? WHERE id = ? AND status = ?")
            .bind(status).bind(completed_at).bind(id).bind(&existing.status)
            .execute(&mut **tx).await.map_err(|e| e.to_string())?;
        if completed {
            crate::companion_feedback::record(tx,&format!("step:{id}"),"step",id,&existing.title,"step").await?;
            let importance: i64 = sqlx::query_scalar("SELECT importance FROM tasks WHERE id = ?")
                .bind(&existing.task_id).fetch_one(&mut **tx).await.map_err(|e| e.to_string())?;
            let xp = gamification::step_xp(importance);
            gamification::settle_earn(tx, xp, gamification::coins_from_xp(xp), "step", Some(id)).await?;
        } else {
            crate::companion_feedback::cancel(tx,id).await?;
            gamification::revoke(tx, id, "step").await?;
        }
    }
    let step = fetch_step(&mut **tx, id).await?;
    let wallet = gamification::build_wallet(&mut **tx).await?;
    Ok((step, wallet))
}

#[tauri::command]
pub async fn delete_step(
    app: AppHandle,
    state: State<'_, SqlitePool>,
    id: String,
) -> Result<(), String> {
    let mut tx = gamification::begin_write(state.inner()).await?;
    delete_step_tx(&mut tx, &id).await?;
    tx.commit().await.map_err(|e| e.to_string())?;
    emit_steps_changed(&app);
    Ok(())
}

pub(crate) async fn delete_step_tx(tx: &mut sqlx::Transaction<'_, Sqlite>, id: &str) -> Result<(), String> {
    crate::trash::record_step(tx,id).await?;
    // 递归 CTE 级联删除所有子孙步骤
    let result = sqlx::query(
        "WITH RECURSIVE sub(id) AS (
           SELECT id FROM task_steps WHERE id = ?
           UNION ALL
           SELECT t.id FROM task_steps t JOIN sub s ON t.parent_step_id = s.id
         )
         DELETE FROM task_steps WHERE id IN (SELECT id FROM sub)",
    )
    .bind(&id)
    .execute(&mut **tx)
    .await
    .map_err(|e| e.to_string())?;
    if result.rows_affected() == 0 {
        return Err(format!("步骤不存在：{id}"));
    }
    Ok(())
}

#[tauri::command]
pub async fn list_steps(
    state: State<'_, SqlitePool>,
    task_id: String,
) -> Result<Vec<Step>, String> {
    list_steps_db(state.inner(), &task_id).await
}

pub(crate) async fn list_steps_db(pool: &SqlitePool, task_id: &str) -> Result<Vec<Step>, String> {
    crate::task_engine::fetch_task(pool, task_id).await?;
    // task_steps 表（0001 迁移）无 created_at 列，rowid 与插入顺序一致，作同值次序
    sqlx::query_as::<_, Step>(
        "SELECT * FROM task_steps WHERE task_id = ? ORDER BY order_index, rowid",
    )
    .bind(&task_id)
    .fetch_all(pool)
    .await
    .map_err(|e| e.to_string())
}
