use chrono::{DateTime, Datelike, Local, NaiveDate, NaiveDateTime, TimeZone, Timelike};
use sqlx::SqlitePool;
use tauri::State;

use crate::course;
use crate::models::{RankedTask, Task};

// ---------- 纯函数（契约 §2.5，时间注入，必须可单测） ----------

/// deadline 解析：兼容 RFC3339、"YYYY-MM-DD"（视作当天 23:59:59）、
/// "YYYY-MM-DDTHH:MM:SS" 本地时间。解析失败按无 deadline 处理。
pub fn parse_deadline(raw: &Option<String>, _now: &DateTime<Local>) -> Option<DateTime<Local>> {
    let s = raw.as_deref()?.trim();
    if s.is_empty() {
        return None;
    }
    if let Ok(dt) = DateTime::parse_from_rfc3339(s) {
        return Some(dt.with_timezone(&Local));
    }
    if let Ok(d) = NaiveDate::parse_from_str(s, "%Y-%m-%d") {
        return d
            .and_hms_opt(23, 59, 59)
            .and_then(|ndt| Local.from_local_datetime(&ndt).single());
    }
    if let Ok(ndt) = NaiveDateTime::parse_from_str(s, "%Y-%m-%dT%H:%M:%S") {
        return Local.from_local_datetime(&ndt).single();
    }
    None
}

/// 各形态的紧迫度时间窗（天）。
fn horizon_days(form: &str) -> f64 {
    match form {
        "encounter" => 1.0,
        "side_quest" => 7.0,
        _ => 30.0, // main_quest
    }
}

/// 课表空档契合度（M3，纯函数）：
/// estimated 为空 → 0.5；无课表数据（free_gap None）→ 0.5；
/// gap >= estimated → 1.0；否则 gap/estimated 线性。
pub fn compute_schedule_fit(estimated_min: Option<i64>, free_gap_min: Option<i64>) -> f64 {
    match (estimated_min, free_gap_min) {
        (None, _) => 0.5,
        (_, None) => 0.5,
        (Some(est), Some(gap)) => {
            if est <= 0 {
                0.5
            } else if gap >= est {
                1.0
            } else {
                (gap as f64 / est as f64).clamp(0.0, 1.0)
            }
        }
    }
}

/// 今日空档（分钟）：[08:00,22:00] 减课程槽，再与 now 取交集（now 之前不算空档）。
/// 今日无课程 → None（中性 0.5）；有课程但空档耗尽 → Some(0)。
pub async fn today_free_gap_min(pool: &SqlitePool, now: DateTime<Local>) -> Result<Option<i64>, String> {
    let today = now.date_naive();
    let weekday = today.weekday().number_from_monday() as i64;
    let courses = course::courses_on_date(pool, today).await?;
    let mut slots: Vec<(i64, i64)> = courses
        .iter()
        .flat_map(|c| c.slots.iter())
        .filter(|s| s.weekday == weekday)
        .filter_map(|s| {
            Some((
                course::time_to_min(&s.start_time)?,
                course::time_to_min(&s.end_time)?,
            ))
        })
        .collect();
    if slots.is_empty() {
        return Ok(None);
    }
    const DAY_START: i64 = 8 * 60;
    const DAY_END: i64 = 22 * 60;
    let now_min = now.hour() as i64 * 60 + now.minute() as i64;
    let win_start = DAY_START.max(now_min);
    if win_start >= DAY_END {
        return Ok(Some(0));
    }
    // 裁剪到窗口内并合并重叠槽
    slots = slots
        .into_iter()
        .filter_map(|(a, b)| {
            let (a, b) = (a.clamp(DAY_START, DAY_END), b.clamp(DAY_START, DAY_END));
            if a < b { Some((a, b)) } else { None }
        })
        .collect();
    slots.sort();
    let mut merged: Vec<(i64, i64)> = Vec::new();
    for (a, b) in slots {
        if let Some(last) = merged.last_mut() {
            if a <= last.1 {
                last.1 = last.1.max(b);
                continue;
            }
        }
        merged.push((a, b));
    }
    // 空档 = 窗口减合并槽，取最大段
    let mut best: i64 = 0;
    let mut cursor = win_start;
    for (a, b) in merged {
        if a > cursor {
            best = best.max(a - cursor);
        }
        cursor = cursor.max(b);
    }
    if DAY_END > cursor {
        best = best.max(DAY_END - cursor);
    }
    Ok(Some(best))
}

/// 规则引擎打分（契约 §2.5）：
/// score = 0.35*imp + 0.30*urg + 0.20*fit + 0.10*streak + 0.05*fresh，逾期 +1.0。
/// schedule_fit 由 compute_schedule_fit 给出；has_class_today 用于生成"适合当前空档"理由。
pub fn score_task(
    task: &Task,
    now: DateTime<Local>,
    schedule_fit: f64,
    has_class_today: bool,
) -> (f64, Vec<String>) {
    let importance_n = (task.importance as f64 - 1.0) / 4.0;

    let deadline = parse_deadline(&task.deadline, &now);
    let mut urgency_time = 0.0;
    let mut overdue = false;
    if let Some(dl) = deadline {
        let horizon_secs = horizon_days(&task.form) * 86400.0;
        let remain_secs = (dl - now).num_seconds() as f64;
        urgency_time = (1.0 - remain_secs / horizon_secs).clamp(0.0, 1.0);
        // 已逾期：deadline < now 且未完成
        overdue = dl < now && task.status != "done";
    }
    let urgency_n = ((task.urgency as f64 - 1.0) / 4.0).max(urgency_time);

    let streak_bonus = 0.0; // M2 无聚焦主线

    let created = DateTime::parse_from_rfc3339(&task.created_at)
        .map(|d| d.with_timezone(&Local))
        .unwrap_or(now);
    let age_days = (now - created).num_seconds().max(0) as f64 / 86400.0;
    let freshness = (1.0 - age_days / 30.0).clamp(0.0, 1.0);

    let mut score = 0.35 * importance_n
        + 0.30 * urgency_n
        + 0.20 * schedule_fit
        + 0.10 * streak_bonus
        + 0.05 * freshness;

    let mut reasons: Vec<String> = Vec::new();
    if importance_n >= 0.75 {
        reasons.push("重要度高".to_string());
    }
    if urgency_time >= 0.7 {
        reasons.push("截止日期临近".to_string());
    }
    if schedule_fit >= 1.0 && has_class_today {
        reasons.push("适合当前空档".to_string());
    }
    if overdue {
        score += 1.0;
        reasons.push("已逾期".to_string());
    }
    (score, reasons)
}

// ---------- Tauri Commands ----------

#[tauri::command]
pub async fn get_ranked_today(state: State<'_, SqlitePool>) -> Result<Vec<RankedTask>, String> {
    let tasks = sqlx::query_as::<_, Task>(
        "SELECT * FROM tasks WHERE status IN ('open', 'doing')",
    )
    .fetch_all(state.inner())
    .await
    .map_err(|e| e.to_string())?;

    let now = Local::now();
    let today = crate::gamification::task_day(now);
    // M3：今日课表空档（分钟）；今日无课程 → None（中性 0.5）
    let free_gap = today_free_gap_min(state.inner(), now).await?;
    let has_class_today = free_gap.is_some();

    // (分组, RankedTask)：① 逾期未完成 ② 今日循环日常未完成 ③ 24h 内截止
    // ④ 其余按综合分 ⑤ 已完成（循环任务今日已打卡）沉底；组内分数降序
    let mut ranked: Vec<(u8, RankedTask)> = Vec::new();
    for mut task in tasks {
        let is_recurring = task.recurrence != "none";
        // 循环任务只在应做日进入今日排序列表
        if is_recurring && !crate::recurring::due_on(&task.recurrence, &task.recur_days, today) {
            continue;
        }
        crate::recurring::fill_done_today(&mut task, today);

        let fit = compute_schedule_fit(task.estimated_min, free_gap);
        let (score, mut reasons) = score_task(&task, now, fit, has_class_today);

        let deadline = parse_deadline(&task.deadline, &now);
        let overdue = deadline.is_some_and(|dl| dl < now) && task.status != "done";
        let due_within_24h = deadline.is_some_and(|dl| dl >= now && (dl - now).num_hours() < 24);
        // AI 参谋排程过的任务（planned_date = 今天）提前到日常组，推荐直接体现在顺序上
        let today_str = today.format("%Y-%m-%d").to_string();
        let planned_today = task.planned_date.as_deref() == Some(today_str.as_str());

        let group: u8 = if is_recurring && task.done_today {
            5
        } else if overdue {
            1
        } else if is_recurring || planned_today {
            2
        } else if due_within_24h {
            3
        } else {
            4
        };
        if group == 2 {
            if is_recurring {
                reasons.insert(0, "日常事务（今日应做，网游日常置顶）".to_string());
            } else {
                reasons.insert(0, "AI 参谋计划今日执行".to_string());
            }
            if task.streak >= 2 {
                reasons.push(format!("已连续打卡 {} 天", task.streak));
            }
        }
        ranked.push((group, RankedTask { task, score, reasons }));
    }
    ranked.sort_by(|(ga, a), (gb, b)| {
        ga.cmp(gb).then(
            b.score
                .partial_cmp(&a.score)
                .unwrap_or(std::cmp::Ordering::Equal),
        )
    });
    Ok(ranked.into_iter().map(|(_, r)| r).collect())
}

// ---------- 单元测试 ----------

#[cfg(test)]
mod tests {
    use super::*;

    fn make_task(importance: i64, urgency: i64, form: &str, deadline: Option<String>) -> Task {
        Task {
            id: "t1".to_string(),
            title: "测试任务".to_string(),
            notes: None,
            form: form.to_string(),
            importance,
            urgency,
            deadline,
            estimated_min: None,
            status: "open".to_string(),
            parent_id: None,
            xp_value: 10,
            created_at: "2026-08-27T00:00:00+00:00".to_string(),
            completed_at: None,
            recurrence: "none".to_string(),
            recur_days: None,
            last_done_date: None,
            streak: 0,
            icon: String::new(),
            planned_date: None,
            done_today: false,
        }
    }

    fn now() -> DateTime<Local> {
        Local.with_ymd_and_hms(2026, 8, 27, 12, 0, 0).unwrap()
    }

    fn rfc3339_local(dt: DateTime<Local>) -> String {
        dt.to_rfc3339()
    }

    #[test]
    fn overdue_task_gets_bonus_and_reason() {
        let n = now();
        let past = rfc3339_local(n - chrono::Duration::hours(2));
        let mut task = make_task(3, 3, "side_quest", Some(past));
        let (score_overdue, reasons) = score_task(&task, n, 0.5, false);
        assert!(reasons.contains(&"已逾期".to_string()));

        task.status = "done".to_string();
        let (score_done, reasons_done) = score_task(&task, n, 0.5, false);
        assert!(!reasons_done.contains(&"已逾期".to_string()));
        assert!((score_overdue - score_done - 1.0).abs() < 1e-9);
    }

    #[test]
    fn nearer_deadline_raises_urgency_time() {
        let n = now();
        let soon = rfc3339_local(n + chrono::Duration::hours(2));
        let later = rfc3339_local(n + chrono::Duration::hours(20));
        let task_soon = make_task(3, 1, "encounter", Some(soon));
        let task_later = make_task(3, 1, "encounter", Some(later));
        let (score_soon, reasons_soon) = score_task(&task_soon, n, 0.5, false);
        let (score_later, _) = score_task(&task_later, n, 0.5, false);
        assert!(
            score_soon > score_later,
            "deadline 越近 score 应越高：{score_soon} vs {score_later}"
        );
        assert!(reasons_soon.contains(&"截止日期临近".to_string()));
    }

    #[test]
    fn no_deadline_does_not_panic() {
        let task = make_task(3, 3, "main_quest", None);
        let (score, reasons) = score_task(&task, now(), 0.5, false);
        assert!(score.is_finite());
        assert!(!reasons.contains(&"已逾期".to_string()));
        assert!(!reasons.contains(&"截止日期临近".to_string()));
    }

    #[test]
    fn garbage_deadline_falls_back_to_none() {
        let task = make_task(3, 3, "main_quest", Some("not-a-date".to_string()));
        let (score, _) = score_task(&task, now(), 0.5, false);
        assert!(score.is_finite());
    }

    #[test]
    fn importance_normalization_boundaries() {
        let n = now();
        let low = make_task(1, 1, "side_quest", None);
        let high = make_task(5, 1, "side_quest", None);
        let (score_low, reasons_low) = score_task(&low, n, 0.5, false);
        let (score_high, reasons_high) = score_task(&high, n, 0.5, false);
        // importance_n：1 → 0.0，5 → 1.0，差距 0.35
        assert!((score_high - score_low - 0.35).abs() < 1e-9);
        assert!(!reasons_low.contains(&"重要度高".to_string()));
        assert!(reasons_high.contains(&"重要度高".to_string()));
    }

    #[test]
    fn date_only_deadline_treated_as_end_of_day() {
        let n = now();
        let task = make_task(3, 1, "encounter", Some("2026-08-27".to_string()));
        let (score, _) = score_task(&task, n, 0.5, false);
        assert!(score.is_finite());
        // 当天 23:59 未过 → 不算逾期
        let (_, reasons) = score_task(&task, n, 0.5, false);
        assert!(!reasons.contains(&"已逾期".to_string()));
    }

    #[test]
    fn schedule_fit_boundaries() {
        // estimated 为空 → 中性 0.5
        assert!((compute_schedule_fit(None, Some(120)) - 0.5).abs() < 1e-9);
        // 无课表数据 → 中性 0.5
        assert!((compute_schedule_fit(Some(60), None) - 0.5).abs() < 1e-9);
        // gap >= estimated → 1.0
        assert!((compute_schedule_fit(Some(60), Some(60)) - 1.0).abs() < 1e-9);
        assert!((compute_schedule_fit(Some(60), Some(90)) - 1.0).abs() < 1e-9);
        // 否则线性：30/60 = 0.5
        assert!((compute_schedule_fit(Some(60), Some(30)) - 0.5).abs() < 1e-9);
        assert!((compute_schedule_fit(Some(60), Some(0)) - 0.0).abs() < 1e-9);
        // estimated <= 0 防除零 → 0.5
        assert!((compute_schedule_fit(Some(0), Some(10)) - 0.5).abs() < 1e-9);
    }

    #[test]
    fn fit_1_0_scores_0_2_higher_than_0_0() {
        let n = now();
        let task = make_task(3, 3, "side_quest", None);
        let (score_full, reasons_full) = score_task(&task, n, 1.0, true);
        let (score_zero, reasons_zero) = score_task(&task, n, 0.0, true);
        // fit 权重 0.20：1.0 比 0.0 高 0.2 分
        assert!((score_full - score_zero - 0.2).abs() < 1e-9);
        assert!(reasons_full.contains(&"适合当前空档".to_string()));
        assert!(!reasons_zero.contains(&"适合当前空档".to_string()));
        // 今日无课 → 即使 fit=1.0 也不给该理由
        let (_, reasons_no_class) = score_task(&task, n, 1.0, false);
        assert!(!reasons_no_class.contains(&"适合当前空档".to_string()));
    }
}
