use chrono::{Datelike, Duration, NaiveDate};

use crate::models::Task;

pub const VALID_RECURRENCES: [&str; 3] = ["none", "daily", "weekly"];

/// 语义分类图标 key 全集（'' = 默认卷轴）。
pub const VALID_ICONS: [&str; 14] = [
    "", "study", "code", "read", "write", "sport", "health", "chore", "finance", "shopping",
    "meeting", "art", "social", "food",
];

/// recurrence 必须是 none | daily | weekly。
pub fn validate_recurrence(recurrence: &str) -> Result<(), String> {
    if VALID_RECURRENCES.contains(&recurrence) {
        Ok(())
    } else {
        Err(format!(
            "非法的重复周期：{recurrence}，可选值：none | daily | weekly"
        ))
    }
}

/// recur_days 必须是逗号分隔的 1-7（周一=1，周日=7），如 "1,3,5"。
pub fn validate_recur_days(raw: &str) -> Result<(), String> {
    if raw.trim().is_empty() {
        return Err("每周重复的星期列表不能为空".to_string());
    }
    for part in raw.split(',') {
        let p = part.trim();
        match p.parse::<u32>() {
            Ok(d) if (1..=7).contains(&d) => {}
            _ => {
                return Err(format!(
                    "非法的星期值：{p}，recur_days 必须是逗号分隔的 1-7，如 \"1,3,5\""
                ))
            }
        }
    }
    Ok(())
}

/// 图标 key 必须在已知集合内（'' = 默认卷轴）。
pub fn validate_icon(icon: &str) -> Result<(), String> {
    if VALID_ICONS.contains(&icon) {
        Ok(())
    } else {
        Err(format!("非法的任务图标分类：{icon}"))
    }
}

/// 解析 recur_days 为去重排序后的星期集合（1-7）；NULL/空 → 空集。
pub fn parse_recur_days(raw: &Option<String>) -> Vec<u32> {
    let mut days: Vec<u32> = raw
        .as_deref()
        .unwrap_or("")
        .split(',')
        .filter_map(|p| p.trim().parse::<u32>().ok())
        .filter(|d| (1..=7).contains(d))
        .collect();
    days.sort_unstable();
    days.dedup();
    days
}

/// 某天是否为该循环任务的应做日。none → false；daily → 每天；weekly → 星期在 recur_days 内。
pub fn due_on(recurrence: &str, recur_days: &Option<String>, date: NaiveDate) -> bool {
    match recurrence {
        "daily" => true,
        "weekly" => {
            let wd = date.weekday().number_from_monday();
            parse_recur_days(recur_days).contains(&wd)
        }
        _ => false,
    }
}

/// 今天之前最近的一个应做日（streak 连续性判定用）。
/// daily → 昨天；weekly → 严格早于今天的最近 recur_days 日（可能跨周）；无法推算 → None。
pub fn prev_expected_day(
    recurrence: &str,
    recur_days: &Option<String>,
    today: NaiveDate,
) -> Option<NaiveDate> {
    match recurrence {
        "daily" => Some(today - Duration::days(1)),
        "weekly" => {
            let days = parse_recur_days(recur_days);
            if days.is_empty() {
                return None;
            }
            let today_wd = today.weekday().number_from_monday();
            // 本周内严格早于今天的最大应做日；否则取上周最大的应做日
            if let Some(&d) = days.iter().rev().find(|&&d| d < today_wd) {
                Some(today - Duration::days((today_wd - d) as i64))
            } else {
                let d = *days.last().unwrap();
                Some(today - Duration::days((today_wd + 7 - d) as i64))
            }
        }
        _ => None,
    }
}

/// 计算字段 done_today：daily = 今天已打卡；weekly = 今天应做且已打卡；none → false。
pub fn compute_done_today(task: &Task, today: NaiveDate) -> bool {
    if task.recurrence == "none" {
        return false;
    }
    let today_s = today.format("%Y-%m-%d").to_string();
    match task.recurrence.as_str() {
        "daily" => task.last_done_date.as_deref() == Some(today_s.as_str()),
        "weekly" => {
            due_on("weekly", &task.recur_days, today)
                && task.last_done_date.as_deref() == Some(today_s.as_str())
        }
        _ => false,
    }
}

/// 查询出库后填充计算字段 done_today。
pub fn fill_done_today(task: &mut Task, today: NaiveDate) {
    task.done_today = compute_done_today(task, today);
}

/// 连续打卡额外 XP 加成：min(streak-1, 7) * 5。
pub fn streak_bonus(streak: i64) -> i64 {
    (streak - 1).clamp(0, 7) * 5
}

/// 打卡后的新 streak：last_done == 上一个应做日 → +1；今天已打过 → 不变；否则重置 1。
pub fn next_recur_streak(
    current: i64,
    recurrence: &str,
    recur_days: &Option<String>,
    last_done: Option<NaiveDate>,
    today: NaiveDate,
) -> i64 {
    if last_done == Some(today) {
        return current;
    }
    match prev_expected_day(recurrence, recur_days, today) {
        Some(prev) if last_done == Some(prev) => current + 1,
        _ => 1,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn d(y: i32, m: u32, day: u32) -> NaiveDate {
        NaiveDate::from_ymd_opt(y, m, day).unwrap()
    }

    fn days(s: &str) -> Option<String> {
        Some(s.to_string())
    }

    #[test]
    fn daily_due_every_day() {
        assert!(due_on("daily", &None, d(2026, 2, 9)));
        assert!(!due_on("none", &None, d(2026, 2, 9)));
    }

    #[test]
    fn weekly_due_only_on_listed_weekdays() {
        // 2026-02-09 是周一(1)，2026-02-10 周二(2)
        assert!(due_on("weekly", &days("1,3,5"), d(2026, 2, 9)));
        assert!(!due_on("weekly", &days("1,3,5"), d(2026, 2, 10)));
    }

    #[test]
    fn daily_prev_expected_is_yesterday() {
        assert_eq!(
            prev_expected_day("daily", &None, d(2026, 2, 9)),
            Some(d(2026, 2, 8))
        );
    }

    #[test]
    fn weekly_prev_expected_same_week_and_cross_week() {
        // 周一(1) 的上一个应做日：recur_days=1,3,5 → 上周五(5)，跨周
        assert_eq!(
            prev_expected_day("weekly", &days("1,3,5"), d(2026, 2, 9)),
            Some(d(2026, 2, 6))
        );
        // 周三(3) 的上一个应做日 → 本周一(1)
        assert_eq!(
            prev_expected_day("weekly", &days("1,3,5"), d(2026, 2, 11)),
            Some(d(2026, 2, 9))
        );
        // recur_days 只有周一本身：周一的上一个应做日 = 上周一
        assert_eq!(
            prev_expected_day("weekly", &days("1"), d(2026, 2, 9)),
            Some(d(2026, 2, 2))
        );
    }

    #[test]
    fn streak_increments_on_consecutive_expected_day() {
        let today = d(2026, 2, 9);
        assert_eq!(next_recur_streak(4, "daily", &None, Some(d(2026, 2, 8)), today), 5);
        assert_eq!(next_recur_streak(4, "daily", &None, Some(d(2026, 2, 5)), today), 1);
        assert_eq!(next_recur_streak(4, "daily", &None, None, today), 1);
        // 今天已打过卡 → 不变
        assert_eq!(next_recur_streak(4, "daily", &None, Some(today), today), 4);
    }

    #[test]
    fn streak_bonus_capped_at_35() {
        assert_eq!(streak_bonus(1), 0);
        assert_eq!(streak_bonus(2), 5);
        assert_eq!(streak_bonus(8), 35);
        assert_eq!(streak_bonus(100), 35);
    }

    #[test]
    fn recur_days_validation() {
        assert!(validate_recur_days("1,3,5").is_ok());
        assert!(validate_recur_days("7").is_ok());
        assert!(validate_recur_days("").is_err());
        assert!(validate_recur_days("0,2").is_err());
        assert!(validate_recur_days("8").is_err());
        assert!(validate_recur_days("一,三").is_err());
    }
}
