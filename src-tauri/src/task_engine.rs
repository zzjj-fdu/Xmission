use chrono::{Local, NaiveDate, Utc};
use sqlx::{Executor, Sqlite, SqlitePool};
use tauri::{AppHandle, Emitter, State};
use uuid::Uuid;

use crate::models::{CreateTaskInput, Task, TaskFilter, UpdateTaskPatch};
use crate::recurring;

const VALID_FORMS: [&str; 3] = ["encounter", "side_quest", "main_quest"];
const VALID_STATUSES: [&str; 5] = ["open", "doing", "done", "overdue", "shelved"];

// ---------- 校验纯函数 ----------

/// 标题去空格后必须非空。
pub fn validate_title(title: &str) -> Result<(), String> {
    if title.trim().is_empty() {
        Err("任务标题不能为空".to_string())
    } else {
        Ok(())
    }
}

/// 重要度 / 紧迫度必须在 1~5 之间。
pub fn validate_importance_urgency(importance: i64, urgency: i64) -> Result<(), String> {
    if !(1..=5).contains(&importance) {
        return Err(format!("重要度必须在 1~5 之间，当前值：{importance}"));
    }
    if !(1..=5).contains(&urgency) {
        return Err(format!("紧迫度必须在 1~5 之间，当前值：{urgency}"));
    }
    Ok(())
}

/// 任务形态必须是 encounter | side_quest | main_quest。
pub fn validate_form(form: &str) -> Result<(), String> {
    if VALID_FORMS.contains(&form) {
        Ok(())
    } else {
        Err(format!(
            "非法的任务形态：{form}，可选值：encounter | side_quest | main_quest"
        ))
    }
}

/// 任务状态必须是 open | doing | done | overdue | shelved。
pub fn validate_status(status: &str) -> Result<(), String> {
    if VALID_STATUSES.contains(&status) {
        Ok(())
    } else {
        Err(format!(
            "非法的任务状态：{status}，可选值：open | doing | done | overdue | shelved"
        ))
    }
}

/// 父任务校验（纯函数）：parent_form 为 None 表示父任务不存在；
/// 支线/子任务只能挂在主线（main_quest）下。
pub fn validate_parent_form(parent_id: &str, parent_form: Option<&str>) -> Result<(), String> {
    match parent_form {
        None => Err(format!("父任务不存在：{parent_id}")),
        Some("main_quest") => Ok(()),
        Some(form) => Err(format!(
            "支线任务只能挂在主线任务下，父任务 {parent_id} 的形态是 {form}，不是 main_quest"
        )),
    }
}

// ---------- 内部工具 ----------

fn now_utc_iso() -> String {
    Utc::now().to_rfc3339()
}

fn emit_tasks_changed(app: &AppHandle) {
    // 事件推送失败不应让已成功的写操作报错
    let _ = app.emit("tasks-changed", ());
}

async fn fetch_task<'a>(executor: impl Executor<'a, Database = Sqlite>, id: &str) -> Result<Task, String> {
    let mut task = sqlx::query_as::<_, Task>("SELECT * FROM tasks WHERE id = ?")
        .bind(id)
        .fetch_optional(executor)
        .await
        .map_err(|e| e.to_string())?
        .ok_or_else(|| format!("任务不存在：{id}"))?;
    recurring::fill_done_today(&mut task, crate::gamification::task_day(Local::now()));
    Ok(task)
}

// ---------- Tauri Commands ----------

#[tauri::command]
pub async fn create_task(
    app: AppHandle,
    state: State<'_, SqlitePool>,
    input: CreateTaskInput,
) -> Result<Task, String> {
    validate_title(&input.title)?;
    validate_form(&input.form)?;
    let importance = input.importance.unwrap_or(3);
    let urgency = input.urgency.unwrap_or(3);
    validate_importance_urgency(importance, urgency)?;
    let recurrence = input.recurrence.clone().unwrap_or_else(|| "none".to_string());
    recurring::validate_recurrence(&recurrence)?;
    if recurrence == "weekly" {
        recurring::validate_recur_days(input.recur_days.as_deref().unwrap_or(""))?;
    }
    let recur_days = if recurrence == "weekly" {
        input.recur_days.clone()
    } else {
        None
    };
    let icon = input.icon.clone().unwrap_or_default();
    recurring::validate_icon(&icon)?;

    let id = Uuid::new_v4().to_string();
    let created_at = now_utc_iso();
    let pool = state.inner();

    // 支线只能挂主线：parent_id 存在时校验父任务存在且 form = 'main_quest'
    if let Some(pid) = &input.parent_id {
        let parent_form: Option<String> = sqlx::query_scalar("SELECT form FROM tasks WHERE id = ?")
            .bind(pid)
            .fetch_optional(pool)
            .await
            .map_err(|e| e.to_string())?;
        validate_parent_form(pid, parent_form.as_deref())?;
    }

    sqlx::query(
        "INSERT INTO tasks (id, title, notes, form, importance, urgency, deadline, estimated_min, status, parent_id, xp_value, created_at, completed_at, recurrence, recur_days, icon)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'open', ?, 10, ?, NULL, ?, ?, ?)",
    )
    .bind(&id)
    .bind(input.title.trim())
    .bind(&input.notes)
    .bind(&input.form)
    .bind(importance)
    .bind(urgency)
    .bind(&input.deadline)
    .bind(input.estimated_min)
    .bind(&input.parent_id)
    .bind(&created_at)
    .bind(&recurrence)
    .bind(&recur_days)
    .bind(&icon)
    .execute(pool)
    .await
    .map_err(|e| e.to_string())?;

    let task = fetch_task(pool, &id).await?;
    emit_tasks_changed(&app);
    Ok(task)
}

#[tauri::command]
pub async fn update_task(
    app: AppHandle,
    state: State<'_, SqlitePool>,
    id: String,
    patch: UpdateTaskPatch,
) -> Result<Task, String> {
    let task = update_task_db(state.inner(), &id, patch).await?;
    emit_tasks_changed(&app);
    Ok(task)
}

pub(crate) async fn update_task_db(pool: &SqlitePool, id: &str, patch: UpdateTaskPatch) -> Result<Task, String> {
    let mut tx = crate::gamification::begin_write(pool).await?;
    if let Some(title) = &patch.title {
        validate_title(title)?;
    }
    let importance = patch.importance;
    let urgency = patch.urgency;
    if importance.is_some() || urgency.is_some() {
        let existing = fetch_task(&mut *tx, id).await?;
        validate_importance_urgency(
            importance.unwrap_or(existing.importance),
            urgency.unwrap_or(existing.urgency),
        )?;
    }
    if let Some(status) = &patch.status {
        validate_status(status)?;
        let existing = fetch_task(&mut *tx, id).await?;
        if status != &existing.status && (status == "done" || existing.status == "done") {
            return Err("请使用完成或撤销完成操作修改任务状态".into());
        }
    }
    if let Some(recurrence) = &patch.recurrence {
        recurring::validate_recurrence(recurrence)?;
    }
    if let Some(Some(recur_days)) = &patch.recur_days {
        recurring::validate_recur_days(recur_days)?;
    }
    if let Some(icon) = &patch.icon {
        recurring::validate_icon(icon)?;
    }

    let result = sqlx::query(
        "UPDATE tasks SET
           title = COALESCE(?, title),
           notes = CASE WHEN ? THEN ? ELSE notes END,
           importance = COALESCE(?, importance),
           urgency = COALESCE(?, urgency),
           deadline = CASE WHEN ? THEN ? ELSE deadline END,
           estimated_min = CASE WHEN ? THEN ? ELSE estimated_min END,
           status = COALESCE(?, status),
           recurrence = COALESCE(?, recurrence),
           recur_days = CASE WHEN ? THEN ? ELSE recur_days END,
           icon = COALESCE(?, icon),
           planned_date = CASE WHEN ? THEN ? ELSE planned_date END
         WHERE id = ?",
    )
    .bind(patch.title.as_deref().map(str::trim))
    .bind(patch.notes.is_some())
    .bind(patch.notes.as_ref().and_then(|v| v.as_deref()))
    .bind(patch.importance)
    .bind(patch.urgency)
    .bind(patch.deadline.is_some())
    .bind(patch.deadline.as_ref().and_then(|v| v.as_deref()))
    .bind(patch.estimated_min.is_some())
    .bind(patch.estimated_min.flatten())
    .bind(&patch.status)
    .bind(&patch.recurrence)
    .bind(patch.recur_days.is_some())
    .bind(patch.recur_days.as_ref().and_then(|v| v.as_deref()))
    .bind(&patch.icon)
    .bind(patch.planned_date.is_some())
    .bind(patch.planned_date.as_ref().and_then(|v| v.as_deref()))
    .bind(&id)
    .execute(&mut *tx)
    .await
    .map_err(|e| e.to_string())?;

    if result.rows_affected() == 0 {
        return Err(format!("任务不存在：{id}"));
    }

    let task = fetch_task(&mut *tx, id).await?;
    tx.commit().await.map_err(|e| e.to_string())?;
    Ok(task)
}

#[tauri::command]
pub async fn complete_task(app: AppHandle, state: State<'_, SqlitePool>, id: String) -> Result<Task, String> {
    let (task, wallet) = complete_task_db(state.inner(), &id).await?;
    let _ = app.emit("wallet-updated", &wallet);
    emit_tasks_changed(&app);
    Ok(task)
}

pub(crate) async fn complete_task_db(pool: &SqlitePool, id: &str) -> Result<(Task, crate::models::Wallet), String> {
    let mut tx = crate::gamification::begin_write(pool).await?;

    // 循环任务：永不进入永久 done，打卡写 last_done_date + streak，任务保持 active
    let existing = fetch_task(&mut *tx, id).await?;
    if existing.recurrence != "none" {
        let now = Local::now();
        let today = crate::gamification::task_day(now);
        let today_s = today.format("%Y-%m-%d").to_string();
        let already_done = existing.last_done_date.as_deref() == Some(today_s.as_str());
        if !already_done {
            let last_done = existing
                .last_done_date
                .as_deref()
                .and_then(|s| NaiveDate::parse_from_str(s, "%Y-%m-%d").ok());
            let new_streak = recurring::next_recur_streak(
                existing.streak,
                &existing.recurrence,
                &existing.recur_days,
                last_done,
                today,
            );
            sqlx::query("UPDATE tasks SET last_done_date = ?, streak = ? WHERE id = ?")
                .bind(&today_s)
                .bind(new_streak)
                .bind(&id)
                .execute(&mut *tx)
                .await
                .map_err(|e| e.to_string())?;
            // 基础 XP + 连续加成；ref_id 带日期后缀，reopen 只撤回今天的打卡
            let base_xp = crate::gamification::task_xp(existing.importance, existing.estimated_min);
            let total = base_xp + recurring::streak_bonus(new_streak);
            crate::gamification::settle_earn(
                &mut tx,
                total,
                crate::gamification::coins_from_xp(total),
                "task",
                Some(&format!("{id}:{today_s}")),
            )
            .await?;
        }
        let task = fetch_task(&mut *tx, id).await?;
        let wallet = crate::gamification::build_wallet(&mut *tx).await?;
        tx.commit().await.map_err(|e| e.to_string())?;
        return Ok((task, wallet));
    }

    let completed_at = now_utc_iso();
    let result = sqlx::query("UPDATE tasks SET status = 'done', completed_at = ? WHERE id = ? AND status != 'done'")
        .bind(&completed_at)
        .bind(&id)
        .execute(&mut *tx)
        .await
        .map_err(|e| e.to_string())?;

    let task = fetch_task(&mut *tx, id).await?;
    // M2 契约 §2.3：完成任务结算 XP/金币/streak（emit wallet-updated）
    if result.rows_affected() > 0 {
        let xp = crate::gamification::task_xp(task.importance, task.estimated_min);
        crate::gamification::settle_earn(&mut tx, xp, crate::gamification::coins_from_xp(xp), "task", Some(id)).await?;
    }
    let wallet = crate::gamification::build_wallet(&mut *tx).await?;
    tx.commit().await.map_err(|e| e.to_string())?;
    Ok((task, wallet))
}

#[tauri::command]
pub async fn reopen_task(app: AppHandle, state: State<'_, SqlitePool>, id: String) -> Result<Task, String> {
    let (task, wallet) = reopen_task_db(state.inner(), &id).await?;
    let _ = app.emit("wallet-updated", &wallet);
    emit_tasks_changed(&app);
    Ok(task)
}

pub(crate) async fn reopen_task_db(pool: &SqlitePool, id: &str) -> Result<(Task, crate::models::Wallet), String> {
    let mut tx = crate::gamification::begin_write(pool).await?;

    // 循环任务：reopen = 撤销今天的打卡（扣回本次 XP 含加成、streak-1、last_done_date 回退）
    let existing = fetch_task(&mut *tx, id).await?;
    if existing.recurrence != "none" {
        let today = crate::gamification::task_day(Local::now());
        let today_s = today.format("%Y-%m-%d").to_string();
        if existing.last_done_date.as_deref() != Some(today_s.as_str()) {
            let wallet = crate::gamification::build_wallet(&mut *tx).await?;
            tx.commit().await.map_err(|e| e.to_string())?;
            return Ok((existing, wallet));
        }
        let new_streak = (existing.streak - 1).max(0);
        // last_done_date 回退：连击未断则回到上一个应做日（保住剩余 streak），否则清空
        let rollback: Option<String> = if new_streak > 0 {
            recurring::prev_expected_day(&existing.recurrence, &existing.recur_days, today)
                .map(|d| d.format("%Y-%m-%d").to_string())
        } else {
            None
        };
        sqlx::query("UPDATE tasks SET last_done_date = ?, streak = ? WHERE id = ?")
            .bind(&rollback)
            .bind(new_streak)
            .bind(&id)
            .execute(&mut *tx)
            .await
            .map_err(|e| e.to_string())?;
        // 撤回今天这次打卡的 XP/金币（含连续加成；按日期作用域 ref_id，幂等）
        crate::gamification::revoke(&mut tx, &format!("{id}:{today_s}"), "task").await?;
        let task = fetch_task(&mut *tx, id).await?;
        let wallet = crate::gamification::build_wallet(&mut *tx).await?;
        tx.commit().await.map_err(|e| e.to_string())?;
        return Ok((task, wallet));
    }

    let result = sqlx::query("UPDATE tasks SET status = 'open', completed_at = NULL WHERE id = ?")
        .bind(&id)
        .execute(&mut *tx)
        .await
        .map_err(|e| e.to_string())?;

    if result.rows_affected() == 0 {
        return Err(format!("任务不存在：{id}"));
    }

    let task = fetch_task(&mut *tx, id).await?;
    // 取消完成：回收该任务已结算的 XP/金币（幂等，不动 streak）
    if existing.status == "done" { crate::gamification::revoke(&mut tx, &task.id, "task").await?; }
    let wallet = crate::gamification::build_wallet(&mut *tx).await?;
    tx.commit().await.map_err(|e| e.to_string())?;
    Ok((task, wallet))
}

#[tauri::command]
pub async fn delete_task(app: AppHandle, state: State<'_, SqlitePool>, id: String) -> Result<(), String> {
    let result = sqlx::query("DELETE FROM tasks WHERE id = ?")
        .bind(&id)
        .execute(state.inner())
        .await
        .map_err(|e| e.to_string())?;

    if result.rows_affected() == 0 {
        return Err(format!("任务不存在：{id}"));
    }

    emit_tasks_changed(&app);
    Ok(())
}

#[tauri::command]
pub async fn list_tasks(state: State<'_, SqlitePool>, filter: TaskFilter) -> Result<Vec<Task>, String> {
    if let Some(status) = &filter.status {
        validate_status(status)?;
    }
    if let Some(form) = &filter.form {
        validate_form(form)?;
    }

    let mut qb = sqlx::QueryBuilder::new("SELECT * FROM tasks WHERE 1 = 1");
    if let Some(status) = &filter.status {
        qb.push(" AND status = ").push_bind(status);
    }
    if let Some(form) = &filter.form {
        qb.push(" AND form = ").push_bind(form);
    }
    qb.push(" ORDER BY created_at DESC");

    let mut tasks = qb
        .build_query_as::<Task>()
        .fetch_all(state.inner())
        .await
        .map_err(|e| e.to_string())?;
    let today = crate::gamification::task_day(Local::now());
    for task in &mut tasks {
        recurring::fill_done_today(task, today);
    }
    Ok(tasks)
}

// ---------- 单元测试 ----------

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rejects_empty_title() {
        assert!(validate_title("").is_err());
    }

    #[test]
    fn rejects_whitespace_only_title() {
        assert!(validate_title("   \t\n  ").is_err());
    }

    #[test]
    fn accepts_valid_title() {
        assert!(validate_title("写高数作业").is_ok());
        assert!(validate_title("  带空格的标题  ").is_ok());
    }

    #[test]
    fn rejects_importance_out_of_range() {
        assert!(validate_importance_urgency(0, 3).is_err());
        assert!(validate_importance_urgency(6, 3).is_err());
    }

    #[test]
    fn rejects_urgency_out_of_range() {
        assert!(validate_importance_urgency(3, 0).is_err());
        assert!(validate_importance_urgency(3, 6).is_err());
    }

    #[test]
    fn accepts_importance_urgency_in_range() {
        assert!(validate_importance_urgency(1, 1).is_ok());
        assert!(validate_importance_urgency(3, 3).is_ok());
        assert!(validate_importance_urgency(5, 5).is_ok());
    }

    #[test]
    fn rejects_invalid_form() {
        assert!(validate_form("quest").is_err());
        assert!(validate_form("").is_err());
        assert!(validate_form("MAIN_QUEST").is_err());
    }

    #[test]
    fn accepts_valid_forms() {
        for form in ["encounter", "side_quest", "main_quest"] {
            assert!(validate_form(form).is_ok(), "form 应合法：{form}");
        }
    }

    #[test]
    fn rejects_invalid_status() {
        assert!(validate_status("closed").is_err());
        assert!(validate_status("").is_err());
        assert!(validate_status("DONE").is_err());
    }

    #[test]
    fn accepts_valid_statuses() {
        for status in ["open", "doing", "done", "overdue", "shelved"] {
            assert!(validate_status(status).is_ok(), "status 应合法：{status}");
        }
    }

    #[test]
    fn rejects_missing_parent() {
        let err = validate_parent_form("pid-1", None).unwrap_err();
        assert!(err.contains("父任务不存在"), "错误信息应说明父任务不存在：{err}");
    }

    #[test]
    fn rejects_non_main_quest_parent() {
        for form in ["encounter", "side_quest"] {
            let err = validate_parent_form("pid-1", Some(form)).unwrap_err();
            assert!(err.contains("main_quest"), "错误信息应指向 main_quest：{err}");
        }
    }

    #[test]
    fn accepts_main_quest_parent() {
        assert!(validate_parent_form("pid-1", Some("main_quest")).is_ok());
    }
}
