use std::collections::HashSet;
use std::io::Cursor;

use chrono::NaiveDate;
use sqlx::SqlitePool;
use calamine::Reader as _;
use tauri::{AppHandle, Emitter, State};
use uuid::Uuid;

use crate::models::{
    Course, CourseDraft, CourseDraftSlot, CourseSlot, OverrideSlotInput, SaveCourseInput,
};

// ---------- 纯函数（必须可单测） ----------

/// 解析周次范围 "1-8,10-16" → [(1,8),(10,16)]。
/// 非法段跳过；空串 → 空 Vec（视为不限周次）。
pub fn parse_weeks_mask(mask: &str) -> Vec<(i64, i64)> {
    mask.split(',')
        .filter_map(|seg| {
            let seg = seg.trim();
            if seg.is_empty() {
                return None;
            }
            if let Some((a, b)) = seg.split_once('-') {
                let a: i64 = a.trim().parse().ok()?;
                let b: i64 = b.trim().parse().ok()?;
                if a >= 1 && a <= b {
                    Some((a, b))
                } else {
                    None
                }
            } else {
                // 单值段 "10" → (10,10)
                let a: i64 = seg.parse().ok()?;
                if a >= 1 {
                    Some((a, a))
                } else {
                    None
                }
            }
        })
        .collect()
}

/// 某教学周是否命中 周次范围 + 单双周。空 mask 视为不限周次。
pub fn week_matches(mask: &str, parity: &str, week: i64) -> bool {
    let ranges = parse_weeks_mask(mask);
    let in_range = ranges.is_empty() || ranges.iter().any(|&(a, b)| week >= a && week <= b);
    if !in_range {
        return false;
    }
    match parity {
        "odd" => week % 2 == 1,
        "even" => week % 2 == 0,
        _ => true, // all 及未知值按每周处理
    }
}

/// 周过滤核心语义（calendar / scheduler 复用）：
/// - semester_start 未设置（semester_start_set=false）→ 忽略 mask/parity 全量返回课程，
///   但 override 槽仍只在其指定周出现（week 传 <=0 即全部不现）；
/// - 已设置 → 常规槽按 mask+parity 过滤，override 槽仅 override_week==week 出现，
///   且同 (course,weekday) 有 override 槽时该 weekday 的常规槽被替换；
/// - 已设置时过滤后无槽的课程不返回；未设置时课程全量返回（即使当周无槽）。
pub fn apply_week_filter(
    courses: Vec<Course>,
    week: i64,
    semester_start_set: bool,
) -> Vec<Course> {
    courses
        .into_iter()
        .filter_map(|mut c| {
            // 本周 override 槽覆盖的 weekday 集合
            let override_weekdays: HashSet<i64> = c
                .slots
                .iter()
                .filter(|s| s.override_week == Some(week))
                .map(|s| s.weekday)
                .collect();
            let matches = week_matches(&c.weeks_mask, &c.week_parity, week);
            c.slots.retain(|s| match s.override_week {
                Some(w) => w == week,
                None => {
                    if !semester_start_set {
                        !override_weekdays.contains(&s.weekday)
                    } else {
                        matches && !override_weekdays.contains(&s.weekday)
                    }
                }
            });
            if semester_start_set && c.slots.is_empty() {
                None
            } else {
                Some(c)
            }
        })
        .collect()
}

/// "HH:MM" / "HH:MM:SS" 规整为 "HH:MM"；非法 → None。
pub fn normalize_time(raw: &str) -> Option<String> {
    let s = raw.trim();
    let mut parts = s.split(':');
    let h: i64 = parts.next()?.trim().parse().ok()?;
    let m: i64 = parts.next()?.trim().parse().ok()?;
    if !(0..=23).contains(&h) || !(0..=59).contains(&m) {
        return None;
    }
    Some(format!("{h:02}:{m:02}"))
}

/// "HH:MM" → 当日分钟数。
pub fn time_to_min(s: &str) -> Option<i64> {
    let norm = normalize_time(s)?;
    let h: i64 = norm[0..2].parse().ok()?;
    let m: i64 = norm[3..5].parse().ok()?;
    Some(h * 60 + m)
}

/// 星期值解析："周一"~"周日" / "星期一"~"星期日" / "1"~"7" → 1~7。
pub fn parse_weekday(raw: &str) -> Option<i64> {
    let s = raw.trim();
    if let Ok(n) = s.parse::<i64>() {
        return if (1..=7).contains(&n) { Some(n) } else { None };
    }
    let t = s.trim_start_matches("星期").trim_start_matches("周");
    match t {
        "一" => Some(1),
        "二" => Some(2),
        "三" => Some(3),
        "四" => Some(4),
        "五" => Some(5),
        "六" => Some(6),
        "日" | "天" => Some(7),
        _ => None,
    }
}

/// 单双周值解析：单/单周/odd → odd；双/双周/even → even；空/all/每周 → all。
pub fn parse_parity(raw: &str) -> Option<String> {
    let s = raw.trim().to_lowercase();
    match s.as_str() {
        "" | "all" | "每周" | "全部" => Some("all".to_string()),
        "单" | "单周" | "odd" => Some("odd".to_string()),
        "双" | "双周" | "even" => Some("even".to_string()),
        _ => None,
    }
}

/// CSV 文本 → 行单元格（去 BOM，按行切分，逗号切列，去 \r）。
pub fn parse_csv_text(text: &str) -> Vec<Vec<String>> {
    text.trim_start_matches('\u{feff}')
        .lines()
        .map(|line| {
            line.trim_end_matches('\r')
                .split(',')
                .map(|c| c.trim().to_string())
                .collect()
        })
        .collect()
}

/// 模板行 → CourseDraft 列表。模板首行表头固定：
/// 课程名,教师,地点,星期,开始时间,结束时间,周次,单双周,颜色
/// 按 课程名+教师+地点+周次+单双周 分组多行为一个 CourseDraft，slots 按 weekday+startTime 排序。
pub fn rows_to_drafts(rows: &[Vec<String>]) -> Result<Vec<CourseDraft>, String> {
    if rows.is_empty() {
        return Err("文件内容为空".to_string());
    }
    let mut drafts: Vec<CourseDraft> = Vec::new();
    // 跳过表头行；全空行跳过
    for (i, row) in rows.iter().enumerate().skip(1) {
        if row.iter().all(|c| c.trim().is_empty()) {
            continue;
        }
        let line = i + 1; // 1 基行号（含表头）
        let cell = |idx: usize| row.get(idx).map(|s| s.trim()).unwrap_or("");
        let name = cell(0);
        if name.is_empty() {
            return Err(format!("第{line}行：课程名不能为空"));
        }
        let weekday_raw = cell(3);
        let weekday = parse_weekday(weekday_raw)
            .ok_or_else(|| format!("第{line}行：星期值无法识别：「{weekday_raw}」"))?;
        let start_raw = cell(4);
        let start_time = normalize_time(start_raw)
            .ok_or_else(|| format!("第{line}行：开始时间格式不正确：「{start_raw}」"))?;
        let end_raw = cell(5);
        let end_time = normalize_time(end_raw)
            .ok_or_else(|| format!("第{line}行：结束时间格式不正确：「{end_raw}」"))?;
        let weeks_mask = {
            let raw = cell(6);
            if raw.is_empty() {
                "1-16".to_string()
            } else {
                raw.to_string()
            }
        };
        let parity_raw = cell(7);
        let week_parity = parse_parity(parity_raw)
            .ok_or_else(|| format!("第{line}行：单双周值无法识别：「{parity_raw}」"))?;
        let teacher = cell(1);
        let location = cell(2);
        let color = cell(8);

        let key = (
            name.to_string(),
            teacher.to_string(),
            location.to_string(),
            weeks_mask.clone(),
            week_parity.clone(),
        );
        let slot = CourseDraftSlot {
            weekday,
            start_time,
            end_time,
            start_period: None,
            end_period: None,
        };
        if let Some(d) = drafts.iter_mut().find(|d| {
            (
                d.name.clone(),
                d.teacher.clone().unwrap_or_default(),
                d.location.clone().unwrap_or_default(),
                d.weeks_mask.clone().unwrap_or_else(|| "1-16".to_string()),
                d.week_parity.clone().unwrap_or_else(|| "all".to_string()),
            ) == key
        }) {
            d.slots.push(slot);
        } else {
            drafts.push(CourseDraft {
                name: name.to_string(),
                teacher: if teacher.is_empty() {
                    None
                } else {
                    Some(teacher.to_string())
                },
                location: if location.is_empty() {
                    None
                } else {
                    Some(location.to_string())
                },
                color: if color.is_empty() {
                    None
                } else {
                    Some(color.to_string())
                },
                weeks_mask: Some(weeks_mask),
                week_parity: Some(week_parity),
                slots: vec![slot],
            });
        }
    }
    if drafts.is_empty() {
        return Err("未解析到任何课程行".to_string());
    }
    for d in &mut drafts {
        d.slots
            .sort_by(|a, b| (a.weekday, &a.start_time).cmp(&(b.weekday, &b.start_time)));
    }
    Ok(drafts)
}

// ---------- DB 组装 ----------

type CourseRow = (
    String,
    String,
    Option<String>,
    Option<String>,
    Option<String>,
    String,
    String,
);

fn row_to_course(r: CourseRow, slots: Vec<CourseSlot>) -> Course {
    Course {
        id: r.0,
        name: r.1,
        teacher: r.2,
        location: r.3,
        color: r.4,
        weeks_mask: r.5,
        week_parity: r.6,
        slots,
    }
}

/// 读全部课程并组装 slots（按 weekday+start_time 排序）。
pub async fn fetch_all_courses(pool: &SqlitePool) -> Result<Vec<Course>, String> {
    let rows = sqlx::query_as::<_, CourseRow>(
        "SELECT id, name, teacher, location, color, weeks_mask, week_parity FROM courses ORDER BY name, rowid",
    )
    .fetch_all(pool)
    .await
    .map_err(|e| e.to_string())?;
    let mut slots = sqlx::query_as::<_, CourseSlot>(
        "SELECT id, course_id, weekday, start_time, end_time, override_week FROM course_slots ORDER BY weekday, start_time",
    )
    .fetch_all(pool)
    .await
    .map_err(|e| e.to_string())?;
    let mut courses: Vec<Course> = Vec::with_capacity(rows.len());
    for row in rows {
        let cid = row.0.clone();
        let own: Vec<CourseSlot> = slots
            .iter()
            .filter(|s| s.course_id == cid)
            .cloned()
            .collect();
        slots.retain(|s| s.course_id != cid);
        courses.push(row_to_course(row, own));
    }
    Ok(courses)
}

async fn fetch_course(pool: &SqlitePool, id: &str) -> Result<Course, String> {
    let row = sqlx::query_as::<_, CourseRow>(
        "SELECT id, name, teacher, location, color, weeks_mask, week_parity FROM courses WHERE id = ?",
    )
    .bind(id)
    .fetch_optional(pool)
    .await
    .map_err(|e| e.to_string())?
    .ok_or_else(|| format!("课程不存在：{id}"))?;
    let slots = sqlx::query_as::<_, CourseSlot>(
        "SELECT id, course_id, weekday, start_time, end_time, override_week FROM course_slots WHERE course_id = ? ORDER BY weekday, start_time",
    )
    .bind(id)
    .fetch_all(pool)
    .await
    .map_err(|e| e.to_string())?;
    Ok(row_to_course(row, slots))
}

/// 读 semester_start 设置（YYYY-MM-DD）。Ok(Some(date)) 仅当已设置且格式合法。
pub async fn semester_start(pool: &SqlitePool) -> Result<Option<NaiveDate>, String> {
    let raw = sqlx::query_scalar::<_, String>("SELECT value FROM settings WHERE key = 'semester_start'")
        .fetch_optional(pool)
        .await
        .map_err(|e| e.to_string())?;
    Ok(raw
        .as_deref()
        .and_then(|s| NaiveDate::parse_from_str(s.trim(), "%Y-%m-%d").ok()))
}

/// 某日期的教学周数：floor((date - start)/7)+1，start 为周一。
pub fn teaching_week(date: NaiveDate, semester_start: NaiveDate) -> i64 {
    (date - semester_start).num_days().div_euclid(7) + 1
}

/// 某日期过滤后的课程（calendar / scheduler 复用入口）。
/// semester_start 未设置 → 全量返回（override 槽因 week 未知一律不现）。
pub async fn courses_on_date(pool: &SqlitePool, date: NaiveDate) -> Result<Vec<Course>, String> {
    let all = fetch_all_courses(pool).await?;
    let start = semester_start(pool).await?;
    match start {
        Some(s) => {
            let week = teaching_week(date, s);
            Ok(apply_week_filter(all, week, true))
        }
        None => Ok(apply_week_filter(all, 0, false)),
    }
}

fn emit_courses_changed(app: &AppHandle) {
    // 事件推送失败不应让已成功的写操作报错
    let _ = app.emit("courses-changed", ());
}

// ---------- 校验 ----------

fn validate_draft_fields(
    name: &str,
    weeks_mask: &str,
    week_parity: &str,
    slots: &[CourseDraftSlot],
) -> Result<(), String> {
    if name.trim().is_empty() {
        return Err("课程名不能为空".to_string());
    }
    if parse_weeks_mask(weeks_mask).is_empty() {
        return Err(format!("周次范围格式不正确：「{weeks_mask}」"));
    }
    if !matches!(week_parity, "all" | "odd" | "even") {
        return Err(format!("单双周取值不正确：「{week_parity}」（应为 all/odd/even）"));
    }
    for s in slots {
        if !(1..=7).contains(&s.weekday) {
            return Err(format!("星期取值必须为 1~7：{}", s.weekday));
        }
        let st = normalize_time(&s.start_time)
            .ok_or_else(|| format!("开始时间格式不正确：「{}」", s.start_time))?;
        let et = normalize_time(&s.end_time)
            .ok_or_else(|| format!("结束时间格式不正确：「{}」", s.end_time))?;
        if st >= et {
            return Err(format!("开始时间必须早于结束时间：{st} ~ {et}"));
        }
    }
    Ok(())
}

async fn insert_slots(
    tx: &mut sqlx::Transaction<'_, sqlx::Sqlite>,
    course_id: &str,
    slots: &[CourseDraftSlot],
) -> Result<(), String> {
    for s in slots {
        sqlx::query(
            "INSERT INTO course_slots (id, course_id, weekday, start_time, end_time, override_week)
             VALUES (?, ?, ?, ?, ?, NULL)",
        )
        .bind(Uuid::new_v4().to_string())
        .bind(course_id)
        .bind(s.weekday)
        .bind(normalize_time(&s.start_time).unwrap())
        .bind(normalize_time(&s.end_time).unwrap())
        .execute(&mut **tx)
        .await
        .map_err(|e| e.to_string())?;
    }
    Ok(())
}

// ---------- Tauri Commands ----------

/// 新建/编辑课程。有 id = 更新并全量替换常规槽（保留 override 槽）；无 id = 新建。
#[tauri::command]
pub async fn save_course(
    app: AppHandle,
    state: State<'_, SqlitePool>,
    input: SaveCourseInput,
) -> Result<Course, String> {
    let name = input.name.trim().to_string();
    let weeks_mask = input
        .weeks_mask
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .unwrap_or("1-16")
        .to_string();
    let week_parity = input
        .week_parity
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .unwrap_or("all")
        .to_string();
    validate_draft_fields(&name, &weeks_mask, &week_parity, &input.slots)?;

    let pool = state.inner();
    let mut tx = pool.begin().await.map_err(|e| e.to_string())?;
    let id = match &input.id {
        Some(id) => {
            let result = sqlx::query(
                "UPDATE courses SET name = ?, teacher = ?, location = ?, color = ?, weeks_mask = ?, week_parity = ? WHERE id = ?",
            )
            .bind(&name)
            .bind(&input.teacher)
            .bind(&input.location)
            .bind(&input.color)
            .bind(&weeks_mask)
            .bind(&week_parity)
            .bind(id)
            .execute(&mut *tx)
            .await
            .map_err(|e| e.to_string())?;
            if result.rows_affected() == 0 {
                return Err(format!("课程不存在：{id}"));
            }
            // 全量替换常规槽，保留 override 槽
            sqlx::query("DELETE FROM course_slots WHERE course_id = ? AND override_week IS NULL")
                .bind(id)
                .execute(&mut *tx)
                .await
                .map_err(|e| e.to_string())?;
            id.clone()
        }
        None => {
            let id = Uuid::new_v4().to_string();
            sqlx::query(
                "INSERT INTO courses (id, name, teacher, location, color, weeks_mask, week_parity, created_at)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
            )
            .bind(&id)
            .bind(&name)
            .bind(&input.teacher)
            .bind(&input.location)
            .bind(&input.color)
            .bind(&weeks_mask)
            .bind(&week_parity)
            .bind(chrono::Utc::now().to_rfc3339())
            .execute(&mut *tx)
            .await
            .map_err(|e| e.to_string())?;
            id
        }
    };
    insert_slots(&mut tx, &id, &input.slots).await?;
    tx.commit().await.map_err(|e| e.to_string())?;

    let course = fetch_course(pool, &id).await?;
    emit_courses_changed(&app);
    Ok(course)
}

/// 删除课程（course_slots 外键级联删除）。
#[tauri::command]
pub async fn delete_course(
    app: AppHandle,
    state: State<'_, SqlitePool>,
    id: String,
) -> Result<(), String> {
    let result = sqlx::query("DELETE FROM courses WHERE id = ?")
        .bind(&id)
        .execute(state.inner())
        .await
        .map_err(|e| e.to_string())?;
    if result.rows_affected() == 0 {
        return Err(format!("课程不存在：{id}"));
    }
    emit_courses_changed(&app);
    Ok(())
}

#[tauri::command]
pub async fn list_courses(state: State<'_, SqlitePool>) -> Result<Vec<Course>, String> {
    fetch_all_courses(state.inner()).await
}

/// 某教学周实际课表：应用 mask/parity 过滤与调课覆盖；未设置 semester_start 时全量返回。
#[tauri::command]
pub async fn get_week_schedule(
    state: State<'_, SqlitePool>,
    week: i64,
) -> Result<Vec<Course>, String> {
    if week < 1 {
        return Err("周次必须 ≥ 1".to_string());
    }
    let pool = state.inner();
    let all = fetch_all_courses(pool).await?;
    let set = semester_start(pool).await?.is_some();
    Ok(apply_week_filter(all, week, set))
}

/// 调课覆盖：插一条 override_week = week 的槽。
#[tauri::command]
pub async fn override_slot(
    app: AppHandle,
    state: State<'_, SqlitePool>,
    input: OverrideSlotInput,
) -> Result<(), String> {
    if input.week < 1 {
        return Err("周次必须 ≥ 1".to_string());
    }
    let slot = CourseDraftSlot {
        weekday: input.weekday,
        start_time: input.start_time.clone(),
        end_time: input.end_time.clone(),
        start_period: None,
        end_period: None,
    };
    validate_draft_fields("临时", "1-16", "all", &[slot])?;
    let pool = state.inner();
    fetch_course(pool, &input.course_id).await?; // 确认课程存在
    sqlx::query(
        "INSERT INTO course_slots (id, course_id, weekday, start_time, end_time, override_week)
         VALUES (?, ?, ?, ?, ?, ?)",
    )
    .bind(Uuid::new_v4().to_string())
    .bind(&input.course_id)
    .bind(input.weekday)
    .bind(normalize_time(&input.start_time).unwrap())
    .bind(normalize_time(&input.end_time).unwrap())
    .bind(input.week)
    .execute(pool)
    .await
    .map_err(|e| e.to_string())?;
    emit_courses_changed(&app);
    Ok(())
}

/// 删除某课程在某周的全部调课覆盖槽。
#[tauri::command]
pub async fn clear_override(
    app: AppHandle,
    state: State<'_, SqlitePool>,
    course_id: String,
    week: i64,
) -> Result<(), String> {
    sqlx::query("DELETE FROM course_slots WHERE course_id = ? AND override_week = ?")
        .bind(&course_id)
        .bind(week)
        .execute(state.inner())
        .await
        .map_err(|e| e.to_string())?;
    emit_courses_changed(&app);
    Ok(())
}

/// 解析 .xlsx/.xls/.csv 课表文件为草稿（不落库）。
#[tauri::command]
pub async fn parse_courses_file(
    file_name: String,
    bytes: Vec<u8>,
) -> Result<Vec<CourseDraft>, String> {
    let ext = file_name
        .rsplit('.')
        .next()
        .unwrap_or("")
        .to_lowercase();
    let rows: Vec<Vec<String>> = match ext.as_str() {
        "xlsx" | "xls" => {
            let mut wb = calamine::open_workbook_auto_from_rs(Cursor::new(bytes))
                .map_err(|e| format!("无法打开表格文件：{e}"))?;
            let sheet = wb
                .sheet_names()
                .first()
                .cloned()
                .ok_or_else(|| "表格中没有工作表".to_string())?;
            let range = wb
                .worksheet_range(&sheet)
                .map_err(|e| format!("读取工作表失败：{e}"))?;
            range
                .rows()
                .map(|row| row.iter().map(|c| c.to_string()).collect())
                .collect()
        }
        "csv" => {
            let text = String::from_utf8(bytes)
                .map_err(|_| "CSV 文件不是有效的 UTF-8 编码".to_string())?;
            parse_csv_text(&text)
        }
        _ => return Err(format!("不支持的文件类型：.{ext}（仅支持 .xlsx/.xls/.csv）")),
    };
    rows_to_drafts(&rows)
}

/// 批量落库（导入/AI 校对确认用），事务插入，返回写入课程数。
#[tauri::command]
pub async fn save_courses_batch(
    app: AppHandle,
    state: State<'_, SqlitePool>,
    drafts: Vec<CourseDraft>,
) -> Result<i64, String> {
    let pool = state.inner();
    let mut tx = pool.begin().await.map_err(|e| e.to_string())?;
    let mut count: i64 = 0;
    for d in &drafts {
        let name = d.name.trim().to_string();
        let weeks_mask = d
            .weeks_mask
            .as_deref()
            .map(str::trim)
            .filter(|s| !s.is_empty())
            .unwrap_or("1-16")
            .to_string();
        let week_parity = d
            .week_parity
            .as_deref()
            .map(str::trim)
            .filter(|s| !s.is_empty())
            .unwrap_or("all")
            .to_string();
        validate_draft_fields(&name, &weeks_mask, &week_parity, &d.slots)?;
        let id = Uuid::new_v4().to_string();
        sqlx::query(
            "INSERT INTO courses (id, name, teacher, location, color, weeks_mask, week_parity, created_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
        )
        .bind(&id)
        .bind(&name)
        .bind(&d.teacher)
        .bind(&d.location)
        .bind(&d.color)
        .bind(&weeks_mask)
        .bind(&week_parity)
        .bind(chrono::Utc::now().to_rfc3339())
        .execute(&mut *tx)
        .await
        .map_err(|e| e.to_string())?;
        insert_slots(&mut tx, &id, &d.slots).await?;
        count += 1;
    }
    tx.commit().await.map_err(|e| e.to_string())?;
    emit_courses_changed(&app);
    Ok(count)
}

// ---------- 单元测试 ----------

#[cfg(test)]
mod tests {
    use super::*;
    use crate::models::Course;

    fn slot(id: &str, course_id: &str, weekday: i64, override_week: Option<i64>) -> CourseSlot {
        CourseSlot {
            id: id.to_string(),
            course_id: course_id.to_string(),
            weekday,
            start_time: "08:00".to_string(),
            end_time: "09:40".to_string(),
            override_week,
        }
    }

    fn course(id: &str, mask: &str, parity: &str, slots: Vec<CourseSlot>) -> Course {
        Course {
            id: id.to_string(),
            name: format!("课程{id}"),
            teacher: None,
            location: None,
            color: None,
            weeks_mask: mask.to_string(),
            week_parity: parity.to_string(),
            slots,
        }
    }

    #[test]
    fn weeks_mask_parsing() {
        assert_eq!(parse_weeks_mask("1-16"), vec![(1, 16)]);
        assert_eq!(parse_weeks_mask("1-8,10-16"), vec![(1, 8), (10, 16)]);
        assert_eq!(parse_weeks_mask(""), Vec::<(i64, i64)>::new());
        assert_eq!(parse_weeks_mask("3"), vec![(3, 3)]);
        // 垃圾段跳过，合法段保留
        assert_eq!(parse_weeks_mask("abc,2-4,x-y,9-7,0-5"), vec![(2, 4)]);
    }

    #[test]
    fn week_matches_parity() {
        assert!(week_matches("1-16", "all", 10));
        assert!(!week_matches("1-16", "all", 17));
        assert!(week_matches("1-16", "odd", 3));
        assert!(!week_matches("1-16", "odd", 4));
        assert!(week_matches("1-16", "even", 4));
        assert!(!week_matches("1-16", "even", 3));
        // 空 mask = 不限周次
        assert!(week_matches("", "all", 99));
        // 未知 parity 按 all
        assert!(week_matches("1-16", "garbage", 5));
    }

    #[test]
    fn apply_filter_semester_unset_returns_all() {
        let courses = vec![
            course("a", "1-4", "odd", vec![slot("s1", "a", 1, None)]),
            course("b", "1-16", "all", vec![slot("s2", "b", 2, Some(3))]), // override 槽
        ];
        let out = apply_week_filter(courses, 10, false);
        // 全量返回：mask/parity 被忽略；override 槽 week=3 ≠ 10 不现
        assert_eq!(out.len(), 2);
        assert_eq!(out[0].slots.len(), 1);
        assert_eq!(out[1].slots.len(), 0);
    }

    #[test]
    fn apply_filter_override_replaces_regular() {
        let courses = vec![course(
            "a",
            "1-16",
            "all",
            vec![
                slot("s1", "a", 1, None),       // 周一常规槽
                slot("s2", "a", 1, Some(5)),    // 第 5 周周一调课槽
                slot("s3", "a", 3, None),       // 周三常规槽
            ],
        )];
        let w5 = apply_week_filter(courses.clone(), 5, true);
        let s = &w5[0].slots;
        // 周一常规槽被 override 替换，周三常规槽保留
        assert_eq!(s.len(), 2);
        assert!(s.iter().any(|x| x.id == "s2"));
        assert!(s.iter().any(|x| x.id == "s3"));
        assert!(!s.iter().any(|x| x.id == "s1"));

        let w6 = apply_week_filter(courses, 6, true);
        let ids: Vec<&str> = w6[0].slots.iter().map(|x| x.id.as_str()).collect();
        // 第 6 周 override 不现，常规槽照常
        assert_eq!(ids, vec!["s1", "s3"]);
    }

    #[test]
    fn apply_filter_drops_out_of_mask_courses_when_set() {
        let courses = vec![
            course("a", "1-4", "all", vec![slot("s1", "a", 1, None)]),
            course("b", "1-16", "all", vec![slot("s2", "b", 1, None)]),
        ];
        let out = apply_week_filter(courses, 10, true);
        assert_eq!(out.len(), 1);
        assert_eq!(out[0].id, "b");
    }

    #[test]
    fn csv_rows_to_drafts_ok() {
        let rows = parse_csv_text(
            "课程名,教师,地点,星期,开始时间,结束时间,周次,单双周,颜色\n\
             高等数学,张三,教一101,周一,08:00,09:40,1-16,单周,#fff\n\
             高等数学,张三,教一101,星期三,10:00:00,11:40,1-16,单周,\n\
             大学英语,李四,,5,14:00,15:40,,,",
        );
        let drafts = rows_to_drafts(&rows).unwrap();
        assert_eq!(drafts.len(), 2);
        let math = &drafts[0];
        assert_eq!(math.name, "高等数学");
        assert_eq!(math.weeks_mask.as_deref(), Some("1-16"));
        assert_eq!(math.week_parity.as_deref(), Some("odd"));
        // slots 按 weekday+startTime 排序：周一(1) 在周三(3) 前
        assert_eq!(math.slots.len(), 2);
        assert_eq!(math.slots[0].weekday, 1);
        assert_eq!(math.slots[1].weekday, 3);
        // HH:MM:SS 规整为 HH:MM
        assert_eq!(math.slots[1].start_time, "10:00");
        let eng = &drafts[1];
        assert_eq!(eng.slots[0].weekday, 5);
        // 周次/单双周缺省值
        assert_eq!(eng.weeks_mask.as_deref(), Some("1-16"));
        assert_eq!(eng.week_parity.as_deref(), Some("all"));
    }

    #[test]
    fn csv_grouping_splits_on_mask_or_parity_diff() {
        // 同名课程但单双周不同 → 按分组键拆成两个 CourseDraft
        let rows = parse_csv_text(
            "课程名,教师,地点,星期,开始时间,结束时间,周次,单双周,颜色\n\
             体育,王五,操场,1,08:00,09:40,1-16,单周,\n\
             体育,王五,操场,1,10:00,11:40,1-16,双周,",
        );
        let drafts = rows_to_drafts(&rows).unwrap();
        assert_eq!(drafts.len(), 2);
    }

    #[test]
    fn csv_bad_weekday_and_missing_cols() {
        // 垃圾星期值 → 中文报错
        let rows = parse_csv_text("课程名,教师,地点,星期,开始时间,结束时间\n语文课,,,周八,08:00,09:40");
        let err = rows_to_drafts(&rows).unwrap_err();
        assert!(err.contains("星期值无法识别"), "{err}");

        // 缺列（只有 5 列，结束时间缺失）→ 中文报错
        let rows = parse_csv_text("课程名,教师,地点,星期,开始时间\n数学,,,1,08:00");
        let err = rows_to_drafts(&rows).unwrap_err();
        assert!(err.contains("结束时间格式不正确"), "{err}");
    }

    #[test]
    fn normalize_and_parse_helpers() {
        assert_eq!(normalize_time("8:00"), Some("08:00".to_string()));
        assert_eq!(normalize_time("08:00:30"), Some("08:00".to_string()));
        assert_eq!(normalize_time("25:00"), None);
        assert_eq!(parse_weekday("周一"), Some(1));
        assert_eq!(parse_weekday("星期日"), Some(7));
        assert_eq!(parse_weekday("7"), Some(7));
        assert_eq!(parse_weekday("8"), None);
        assert_eq!(time_to_min("09:40"), Some(580));
    }
}
