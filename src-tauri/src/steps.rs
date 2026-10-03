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

async fn fetch_step<'a>(executor: impl Executor<'a, Database = Sqlite>, id: &str) -> Result<Step, String> {
    sqlx::query_as::<_, Step>("SELECT * FROM task_steps WHERE id = ?")
        .bind(id)
        .fetch_optional(executor)
        .await
        .map_err(|e| e.to_string())?
        .ok_or_else(|| format!("步骤不存在：{id}"))
}

async fn task_exists(pool: &SqlitePool, task_id: &str) -> Result<bool, String> {
    sqlx::query_scalar::<_, bool>("SELECT EXISTS(SELECT 1 FROM tasks WHERE id = ?)")
        .bind(task_id)
        .fetch_one(pool)
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
    validate_title(&title)?;
    let pool = state.inner();
    if !task_exists(pool, &task_id).await? {
        return Err(format!("任务不存在：{task_id}"));
    }
    if let Some(pid) = &parent_step_id {
        fetch_step(pool, pid).await?;
    }

    // 新步骤 order_index = 同父已有步骤 max+1
    let next_order: i64 = match &parent_step_id {
        Some(pid) => sqlx::query_scalar(
            "SELECT COALESCE(MAX(order_index) + 1, 0) FROM task_steps WHERE task_id = ? AND parent_step_id = ?",
        )
        .bind(&task_id)
        .bind(pid)
        .fetch_one(pool)
        .await
        .map_err(|e| e.to_string())?,
        None => sqlx::query_scalar(
            "SELECT COALESCE(MAX(order_index) + 1, 0) FROM task_steps WHERE task_id = ? AND parent_step_id IS NULL",
        )
        .bind(&task_id)
        .fetch_one(pool)
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
    .execute(pool)
    .await
    .map_err(|e| e.to_string())?;

    let step = fetch_step(pool, &id).await?;
    emit_steps_changed(&app);
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
    if let Some(t) = &title {
        validate_title(t)?;
    }
    let pool = state.inner();
    let result = sqlx::query(
        "UPDATE task_steps SET
           title = COALESCE(?, title),
           deadline = COALESCE(?, deadline),
           estimated_min = COALESCE(?, estimated_min)
         WHERE id = ?",
    )
    .bind(title.as_deref().map(str::trim))
    .bind(&deadline)
    .bind(estimated_min)
    .bind(&id)
    .execute(pool)
    .await
    .map_err(|e| e.to_string())?;
    if result.rows_affected() == 0 {
        return Err(format!("步骤不存在：{id}"));
    }
    let step = fetch_step(pool, &id).await?;
    emit_steps_changed(&app);
    Ok(step)
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
    let existing = fetch_step(&mut *tx, id).await?;
    if (existing.status == "done") != completed {
        let status = if completed { "done" } else { "open" };
        let completed_at = completed.then(now_utc_iso);
        sqlx::query("UPDATE task_steps SET status = ?, completed_at = ? WHERE id = ? AND status = ?")
            .bind(status).bind(completed_at).bind(id).bind(&existing.status)
            .execute(&mut *tx).await.map_err(|e| e.to_string())?;
        if completed {
            let importance: i64 = sqlx::query_scalar("SELECT importance FROM tasks WHERE id = ?")
                .bind(&existing.task_id).fetch_one(&mut *tx).await.map_err(|e| e.to_string())?;
            let xp = gamification::step_xp(importance);
            gamification::settle_earn(&mut tx, xp, gamification::coins_from_xp(xp), "step", Some(id)).await?;
        } else {
            gamification::revoke(&mut tx, id, "step").await?;
        }
    }
    let step = fetch_step(&mut *tx, id).await?;
    let wallet = gamification::build_wallet(&mut *tx).await?;
    tx.commit().await.map_err(|e| e.to_string())?;
    Ok((step, wallet))
}

#[tauri::command]
pub async fn delete_step(
    app: AppHandle,
    state: State<'_, SqlitePool>,
    id: String,
) -> Result<(), String> {
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
    .execute(state.inner())
    .await
    .map_err(|e| e.to_string())?;
    if result.rows_affected() == 0 {
        return Err(format!("步骤不存在：{id}"));
    }
    emit_steps_changed(&app);
    Ok(())
}

#[tauri::command]
pub async fn list_steps(
    state: State<'_, SqlitePool>,
    task_id: String,
) -> Result<Vec<Step>, String> {
    // task_steps 表（0001 迁移）无 created_at 列，rowid 与插入顺序一致，作同值次序
    sqlx::query_as::<_, Step>(
        "SELECT * FROM task_steps WHERE task_id = ? ORDER BY order_index, rowid",
    )
    .bind(&task_id)
    .fetch_all(state.inner())
    .await
    .map_err(|e| e.to_string())
}
