use chrono::{Datelike, NaiveDate};
use sqlx::SqlitePool;
use tauri::State;

use crate::course;
use crate::models::{CalendarCourseItem, CalendarTaskItem, DayCell};

/// 周一至周日 → 1~7。
fn weekday_of(date: NaiveDate) -> i64 {
    date.weekday().number_from_monday() as i64
}

async fn holiday_of(pool: &SqlitePool, date: NaiveDate) -> Result<(Option<String>, Option<bool>), String> {
    let row: Option<(String, bool)> =
        sqlx::query_as("SELECT name, is_off FROM holidays WHERE date = ?")
            .bind(date.format("%Y-%m-%d").to_string())
            .fetch_optional(pool)
            .await
            .map_err(|e| e.to_string())?;
    Ok(match row {
        Some((name, is_off)) => (Some(name), Some(is_off)),
        None => (None, None),
    })
}

/// 截止日落在当天的任务（含已完成）。deadline 可能是 RFC3339，按 YYYY-MM-DD 前缀匹配。
async fn tasks_due_on(pool: &SqlitePool, date: NaiveDate) -> Result<Vec<CalendarTaskItem>, String> {
    sqlx::query_as::<_, CalendarTaskItem>(
        "SELECT id, title, form, status FROM tasks
         WHERE deadline IS NOT NULL AND substr(deadline, 1, 10) = ?
         ORDER BY rowid",
    )
    .bind(date.format("%Y-%m-%d").to_string())
    .fetch_all(pool)
    .await
    .map_err(|e| e.to_string())
}

/// 单日聚合（供 get_month_view / get_day_detail 复用）。
async fn day_cell(pool: &SqlitePool, date: NaiveDate) -> Result<DayCell, String> {
    let (holiday_name, is_off) = holiday_of(pool, date).await?;
    let tasks_due = tasks_due_on(pool, date).await?;
    // 课程：周过滤（含 mask/parity/override 语义）后取当天 weekday 的槽
    let weekday = weekday_of(date);
    let filtered = course::courses_on_date(pool, date).await?;
    let mut courses: Vec<CalendarCourseItem> = Vec::new();
    for c in filtered {
        for s in &c.slots {
            if s.weekday == weekday {
                courses.push(CalendarCourseItem {
                    id: c.id.clone(),
                    name: c.name.clone(),
                    color: c.color.clone(),
                    start_time: s.start_time.clone(),
                    end_time: s.end_time.clone(),
                    location: c.location.clone(),
                });
            }
        }
    }
    courses.sort_by(|a, b| a.start_time.cmp(&b.start_time));
    Ok(DayCell {
        date: date.format("%Y-%m-%d").to_string(),
        weekday,
        holiday_name,
        is_off,
        tasks_due,
        courses,
    })
}

/// 月视图：返回当月每一天的聚合（month 1~12）。
#[tauri::command]
pub async fn get_month_view(
    state: State<'_, SqlitePool>,
    year: i64,
    month: i64,
) -> Result<Vec<DayCell>, String> {
    if !(1..=12).contains(&month) {
        return Err(format!("月份必须为 1~12：{month}"));
    }
    let first = NaiveDate::from_ymd_opt(year as i32, month as u32, 1)
        .ok_or_else(|| format!("日期无效：{year}-{month}"))?;
    let days = first.num_days_in_month() as u32;
    let pool = state.inner();
    let mut cells = Vec::with_capacity(days as usize);
    for d in 1..=days {
        let date = first.with_day(d).unwrap();
        cells.push(day_cell(pool, date).await?);
    }
    Ok(cells)
}

/// 单日详情。
#[tauri::command]
pub async fn get_day_detail(
    state: State<'_, SqlitePool>,
    date: String,
) -> Result<DayCell, String> {
    let date = NaiveDate::parse_from_str(date.trim(), "%Y-%m-%d")
        .map_err(|_| format!("日期格式不正确：「{date}」（应为 YYYY-MM-DD）"))?;
    day_cell(state.inner(), date).await
}

// ---------- 单元测试 ----------

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn weekday_monday_based() {
        // 2026-08-31 是周一
        let d = NaiveDate::from_ymd_opt(2026, 8, 31).unwrap();
        assert_eq!(weekday_of(d), 1);
        // 2026-09-06 是周日
        let d = NaiveDate::from_ymd_opt(2026, 9, 6).unwrap();
        assert_eq!(weekday_of(d), 7);
    }

    #[test]
    fn teaching_week_math() {
        let start = NaiveDate::from_ymd_opt(2026, 8, 31).unwrap(); // 第 1 周周一
        assert_eq!(course::teaching_week(start, start), 1);
        assert_eq!(
            course::teaching_week(NaiveDate::from_ymd_opt(2026, 9, 6).unwrap(), start),
            1
        );
        assert_eq!(
            course::teaching_week(NaiveDate::from_ymd_opt(2026, 9, 7).unwrap(), start),
            2
        );
        // 开学前 → 周数 <= 0
        assert!(
            course::teaching_week(NaiveDate::from_ymd_opt(2026, 8, 30).unwrap(), start) <= 0
        );
    }
}
