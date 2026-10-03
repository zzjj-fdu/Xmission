//! M4「AI 参谋」：自然语言录入、主线分解、图标归类、周计划与时段推荐。
//! 全部命令在 LLM 未配置（无 API Key）时返回固定前缀的中文错误，前端据此优雅降级；
//! 所有 LLM 调用走 chat_json helper（timeout 60s、response_format json_object、
//! 剥离 ```json 围栏、整体失败重试 1 次），不复制粘贴。

use chrono::{Datelike, Duration, Local, NaiveDate};
use serde_json::{json, Value};
use sqlx::SqlitePool;
use tauri::State;
use uuid::Uuid;

use crate::course;
use crate::llm;
use crate::models::{SlotSuggestion, StepDraft, Task, TaskDraft, WeekPlan, WeekPlanDay, WeekPlanItem};
use crate::recurring;

/// LLM 未配置时的固定错误前缀（前端据此识别降级场景）。
pub const ERR_NOT_CONFIGURED: &str = "LLM 未配置";

// ---------- 公共 helper ----------

/// 读取 LLM 配置并要求 key 存在；未配置返回固定前缀中文错误。
async fn require_llm(pool: &SqlitePool) -> Result<(reqwest::Client, String, String, String), String> {
    let (base_url, model, key) = llm::current_config(pool).await?;
    let key = key.ok_or_else(|| {
        format!("{ERR_NOT_CONFIGURED}：尚未配置 API Key，请到「设置 → LLM 设置」保存后再使用 AI 功能")
    })?;
    let client = llm::http_client(60)?;
    Ok((client, base_url, model, key))
}

/// 单次 chat/completions 调用 → 响应文本。
async fn chat_once(
    client: &reqwest::Client,
    base_url: &str,
    model: &str,
    key: &str,
    prompt: &str,
    temperature: f64,
) -> Result<String, String> {
    let body = json!({
        "model": model,
        "messages": [{ "role": "user", "content": prompt }],
        "response_format": { "type": "json_object" },
        "temperature": temperature,
    });
    let resp = llm::send_compatible(client, base_url, key, body).await?;
    let status = resp.status();
    if status == reqwest::StatusCode::UNAUTHORIZED || status == reqwest::StatusCode::FORBIDDEN {
        return Err("API Key 无效或已过期，请到设置页重新保存".to_string());
    }
    if !status.is_success() {
        let text = resp.text().await.unwrap_or_default();
        let detail: String = text.chars().take(200).collect();
        return Err(format!("服务返回错误（HTTP {status}）：{detail}"));
    }
    let resp_json: Value = resp
        .json()
        .await
        .map_err(|e| format!("解析响应失败：{e}"))?;
    llm::extract_text(&resp_json).ok_or_else(|| "响应中缺少文本内容".to_string())
}

/// 剥离 ```json 围栏并解析为 JSON。
pub fn strip_fence_parse(content: &str) -> Result<Value, String> {
    let text = content
        .trim()
        .trim_start_matches("```json")
        .trim_start_matches("```")
        .trim_end_matches("```")
        .trim();
    serde_json::from_str(text).map_err(|e| format!("模型输出不是合法 JSON：{e}"))
}

/// 调用 LLM 并解析 JSON：整体失败（网络/解析）重试 1 次，错误中文化。
async fn chat_json(
    client: &reqwest::Client,
    base_url: &str,
    model: &str,
    key: &str,
    prompt: &str,
    temperature: f64,
) -> Result<Value, String> {
    let mut last_err = String::new();
    for attempt in 0..2 {
        match chat_once(client, base_url, model, key, prompt, temperature).await {
            Ok(text) => match strip_fence_parse(&text) {
                Ok(v) => return Ok(v),
                Err(e) => last_err = e,
            },
            Err(e) => last_err = e,
        }
        if attempt == 0 {
            continue; // 重试 1 次
        }
    }
    Err(format!("AI 生成失败（已重试 1 次）：{last_err}"))
}

/// 写一条 ai_suggestions 记录，返回 id。
async fn record_suggestion(
    pool: &SqlitePool,
    kind: &str,
    input_summary: &str,
    payload: &Value,
) -> Result<String, String> {
    let id = Uuid::new_v4().to_string();
    sqlx::query(
        "INSERT INTO ai_suggestions (id, kind, input_summary, payload_json, status, created_at)
         VALUES (?, ?, ?, ?, 'pending', ?)",
    )
    .bind(&id)
    .bind(kind)
    .bind(input_summary)
    .bind(serde_json::to_string(payload).map_err(|e| e.to_string())?)
    .bind(chrono::Utc::now().to_rfc3339())
    .execute(pool)
    .await
    .map_err(|e| e.to_string())?;
    Ok(id)
}

/// 13 分类表（prompt 用）。
const CATEGORY_TABLE: &str = "study=学习, code=编程, read=阅读, write=写作, sport=运动, health=健康, \
chore=杂务, finance=财务, shopping=购物, meeting=会议, art=创作, social=社交, food=饮食";

/// 从 JSON 值取 1~5 整数，缺省 3。
fn int_1_5(v: Option<&Value>) -> i64 {
    v.and_then(|x| x.as_i64()).unwrap_or(3).clamp(1, 5)
}

/// deadline 字段规整：接受 "YYYY-MM-DD" 或 RFC3339/本地 ISO，非法 → None。
fn normalize_deadline(v: Option<&Value>) -> Option<String> {
    let s = v?.as_str()?.trim().to_string();
    if s.is_empty() {
        return None;
    }
    if NaiveDate::parse_from_str(&s, "%Y-%m-%d").is_ok() {
        return Some(s);
    }
    if chrono::DateTime::parse_from_rfc3339(&s).is_ok() {
        return Some(s);
    }
    // "YYYY-MM-DDTHH:MM(:SS)" 本地时间原样保留（scheduler::parse_deadline 兼容）
    if chrono::NaiveDateTime::parse_from_str(&s, "%Y-%m-%dT%H:%M:%S").is_ok()
        || chrono::NaiveDateTime::parse_from_str(&s, "%Y-%m-%dT%H:%M").is_ok()
    {
        return Some(s);
    }
    None
}

/// icon 字段规整：必须是 13 分类 key 之一，否则 ''。
fn normalize_icon(v: Option<&Value>) -> String {
    let s = v.and_then(|x| x.as_str()).unwrap_or("").trim();
    if recurring::VALID_ICONS.contains(&s) {
        s.to_string()
    } else {
        String::new()
    }
}

/// recurrence / recur_days 规整：非法一律回退 none。
fn normalize_recurrence(v: Option<&Value>, days_v: Option<&Value>) -> (String, Option<String>) {
    let r = v.and_then(|x| x.as_str()).unwrap_or("none").trim();
    match r {
        "daily" => ("daily".to_string(), None),
        "weekly" => {
            let raw = days_v.and_then(|x| x.as_str()).unwrap_or("").to_string();
            if recurring::validate_recur_days(&raw).is_ok() {
                ("weekly".to_string(), Some(raw))
            } else {
                ("none".to_string(), None)
            }
        }
        _ => ("none".to_string(), None),
    }
}

fn now_prompt_context() -> String {
    let now = Local::now();
    let wd = ["周一", "周二", "周三", "周四", "周五", "周六", "周日"]
        [(now.weekday().number_from_monday() - 1) as usize];
    format!(
        "当前本地时间：{}（{}）",
        now.format("%Y-%m-%d %H:%M"),
        wd
    )
}

// ---------- 1. 自然语言录入任务 ----------

#[tauri::command]
pub async fn ai_parse_task(state: State<'_, SqlitePool>, text: String) -> Result<TaskDraft, String> {
    let text = text.trim().to_string();
    if text.is_empty() {
        return Err("请输入任务描述".to_string());
    }
    let pool = state.inner();
    let (client, base_url, model, key) = require_llm(pool).await?;

    let prompt = format!(
        "你是任务管理助手的解析器。把用户的一句话任务描述解析成结构化任务草稿。\n\
         {now}\n\
         输出严格的 JSON（不要输出任何其他文字、不要用代码块包裹）：\n\
         {{\"title\":\"任务标题（必填，简洁）\",\"details\":\"补充说明，可空\",\"importance\":1到5的整数,\"urgency\":1到5的整数,\
         \"deadline\":\"YYYY-MM-DD 或 YYYY-MM-DDTHH:MM，无截止时间填 null\",\"estimated_min\":预估分钟数或 null,\
         \"icon\":\"分类 key\",\"recurrence\":\"none|daily|weekly\",\"recur_days\":\"1,3,5 或 null\"}}\n\
         规则：\n\
         - importance：用户说「很重要/紧急重要」→ 5；「比较重要」→ 4；默认 3\n\
         - urgency：截止越近越高；「马上/今天」→ 5；无截止 → 2\n\
         - deadline 用 24 小时制；「周五下午5点前」这类相对时间按当前日期换算\n\
         - icon 只能从以下 13 个 key 选（拿不准填空字符串）：{CATEGORY_TABLE}\n\
         - 「每天/每周×」→ recurrence 对应 daily/weekly；weekly 时 recur_days 为逗号分隔的 1-7（周一=1）；否则 none + null\n\
         用户输入：{text}",
        now = now_prompt_context(),
        text = text,
    );
    let v = chat_json(&client, &base_url, &model, &key, &prompt, 0.2).await?;

    let title = v
        .get("title")
        .and_then(|x| x.as_str())
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .ok_or_else(|| "AI 未能解析出任务标题，请换种说法或手动创建".to_string())?
        .to_string();
    let details = v
        .get("details")
        .and_then(|x| x.as_str())
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(str::to_string);
    let estimated_min = v
        .get("estimated_min")
        .and_then(|x| x.as_i64())
        .filter(|m| *m > 0);
    let (recurrence, recur_days) = normalize_recurrence(v.get("recurrence"), v.get("recur_days"));

    Ok(TaskDraft {
        title,
        details,
        importance: int_1_5(v.get("importance")),
        urgency: int_1_5(v.get("urgency")),
        deadline: normalize_deadline(v.get("deadline")),
        estimated_min,
        icon: normalize_icon(v.get("icon")),
        recurrence,
        recur_days,
    })
}

// ---------- 2. 主线任务 AI 分解支线 ----------

#[tauri::command]
pub async fn ai_decompose_task(
    state: State<'_, SqlitePool>,
    task_id: String,
) -> Result<Vec<StepDraft>, String> {
    let pool = state.inner();
    let task = sqlx::query_as::<_, Task>("SELECT * FROM tasks WHERE id = ?")
        .bind(&task_id)
        .fetch_optional(pool)
        .await
        .map_err(|e| e.to_string())?
        .ok_or_else(|| format!("任务不存在：{task_id}"))?;
    let existing: Vec<String> = sqlx::query_scalar(
        "SELECT title FROM task_steps WHERE task_id = ? ORDER BY order_index",
    )
    .bind(&task_id)
    .fetch_all(pool)
    .await
    .map_err(|e| e.to_string())?;

    let (client, base_url, model, key) = require_llm(pool).await?;

    let existing_text = if existing.is_empty() {
        "（暂无）".to_string()
    } else {
        existing.join("、")
    };
    let prompt = format!(
        "你是任务分解助手。把下面的任务分解为 3 到 8 个有序、可独立执行的步骤。\n\
         {now}\n\
         任务标题：{title}\n\
         任务详情：{notes}\n\
         已存在的步骤（不要重复生成）：{existing}\n\
         输出严格的 JSON（不要输出任何其他文字、不要用代码块包裹）：\n\
         {{\"steps\":[{{\"title\":\"步骤标题\",\"estimated_min\":预估分钟数或 null,\"order_hint\":1}}]}}\n\
         规则：\n\
         - 步骤按执行顺序排列，order_hint 从 1 递增\n\
         - 每个步骤一句话、动词开头、可勾选验收\n\
         - estimated_min 为 10 的倍数更佳，估不出填 null",
        now = now_prompt_context(),
        title = task.title,
        notes = task.notes.as_deref().unwrap_or("（无）"),
        existing = existing_text,
    );
    let v = chat_json(&client, &base_url, &model, &key, &prompt, 0.3).await?;
    let arr = v
        .get("steps")
        .and_then(|x| x.as_array())
        .ok_or_else(|| "模型输出缺少 steps 数组".to_string())?;

    let mut drafts: Vec<StepDraft> = Vec::new();
    for (i, item) in arr.iter().enumerate() {
        let Some(title) = item
            .get("title")
            .and_then(|x| x.as_str())
            .map(str::trim)
            .filter(|s| !s.is_empty())
        else {
            continue; // 单条非法跳过
        };
        // 与已有步骤重名的跳过（双保险，prompt 已声明）
        if existing.iter().any(|e| e.trim() == title) {
            continue;
        }
        let estimated_min = item
            .get("estimated_min")
            .and_then(|x| x.as_i64())
            .filter(|m| *m > 0);
        let order_hint = item
            .get("order_hint")
            .and_then(|x| x.as_i64())
            .unwrap_or((i + 1) as i64);
        drafts.push(StepDraft {
            title: title.to_string(),
            estimated_min,
            order_hint,
        });
    }
    if drafts.is_empty() {
        return Err("AI 未能分解出新步骤（可能与已有步骤重复），请调整后再试".to_string());
    }
    drafts.sort_by_key(|d| d.order_hint);
    drafts.truncate(8);

    let payload = json!({ "task_id": task_id, "task_title": task.title, "steps": drafts.iter().map(|d| {
        json!({"title": d.title, "estimated_min": d.estimated_min, "order_hint": d.order_hint})
    }).collect::<Vec<_>>() });
    record_suggestion(pool, "decompose", &task.title, &payload).await?;
    Ok(drafts)
}

// ---------- 3. 图标自动归类（轻量，永不报错） ----------

/// 标题+详情 → 13 分类 key 之一。未配置/失败一律静默回退 ''（不阻塞保存流程）。
#[tauri::command]
pub async fn ai_classify_icon(
    state: State<'_, SqlitePool>,
    title: String,
    details: String,
) -> Result<String, String> {
    let pool = state.inner();
    let Ok((client, base_url, model, key)) = require_llm(pool).await else {
        return Ok(String::new()); // 未配置：静默回退
    };
    let prompt = format!(
        "把下面的任务归入一个语义分类。只输出严格 JSON：{{\"icon\":\"分类 key\"}}\n\
         分类 key 只能从这里选（都不合适就填空字符串 \"\"）：{CATEGORY_TABLE}\n\
         任务标题：{title}\n补充说明：{details}",
        title = title.trim(),
        details = details.trim(),
    );
    // 轻量调用：只试 1 次，失败静默回退
    match chat_once(&client, &base_url, &model, &key, &prompt, 0.0).await {
        Ok(text) => match strip_fence_parse(&text) {
            Ok(v) => Ok(normalize_icon(v.get("icon"))),
            Err(_) => Ok(String::new()),
        },
        Err(_) => Ok(String::new()),
    }
}

// ---------- 4. 周计划与时段推荐 ----------

/// 某日 [08:00,22:00] 减课程槽后的空档段（"HH:MM-HH:MM" 列表）。
async fn free_windows_of_day(pool: &SqlitePool, date: NaiveDate) -> Result<Vec<(i64, i64)>, String> {
    let weekday = date.weekday().number_from_monday() as i64;
    let courses = course::courses_on_date(pool, date).await?;
    let mut busy: Vec<(i64, i64)> = courses
        .iter()
        .flat_map(|c| c.slots.iter())
        .filter(|s| s.weekday == weekday)
        .filter_map(|s| Some((course::time_to_min(&s.start_time)?, course::time_to_min(&s.end_time)?)))
        .collect();
    busy.sort();
    // 合并重叠
    let mut merged: Vec<(i64, i64)> = Vec::new();
    for (a, b) in busy {
        if let Some(last) = merged.last_mut() {
            if a <= last.1 {
                last.1 = last.1.max(b);
                continue;
            }
        }
        merged.push((a, b));
    }
    const DAY_START: i64 = 8 * 60;
    const DAY_END: i64 = 22 * 60;
    let mut free: Vec<(i64, i64)> = Vec::new();
    let mut cursor = DAY_START;
    for (a, b) in merged {
        let (a, b) = (a.clamp(DAY_START, DAY_END), b.clamp(DAY_START, DAY_END));
        if a > cursor {
            free.push((cursor, a));
        }
        cursor = cursor.max(b);
    }
    if cursor < DAY_END {
        free.push((cursor, DAY_END));
    }
    Ok(free)
}

fn fmt_min(m: i64) -> String {
    format!("{:02}:{:02}", m / 60, m % 60)
}

const WEEKDAY_CN: [&str; 7] = ["周一", "周二", "周三", "周四", "周五", "周六", "周日"];

/// 未来 7 天的上下文文本：日期/星期/节假日/课程/空档。
async fn week_context(
    pool: &SqlitePool,
    start: NaiveDate,
) -> Result<(Vec<String>, Vec<NaiveDate>), String> {
    let mut lines: Vec<String> = Vec::new();
    let mut dates: Vec<NaiveDate> = Vec::new();
    for i in 0..7 {
        let date = start + Duration::days(i);
        dates.push(date);
        let wd = WEEKDAY_CN[(date.weekday().number_from_monday() - 1) as usize];
        let holiday: Option<(String, bool)> = sqlx::query_as(
            "SELECT name, is_off FROM holidays WHERE date = ?",
        )
        .bind(date.format("%Y-%m-%d").to_string())
        .fetch_optional(pool)
        .await
        .map_err(|e| e.to_string())?;
        let holiday_text = match &holiday {
            Some((name, true)) => format!("，节假日：{name}（放假）"),
            Some((name, false)) => format!("，节假日：{name}（调休上班）"),
            None => String::new(),
        };
        let courses = course::courses_on_date(pool, date).await?;
        let weekday = date.weekday().number_from_monday() as i64;
        let mut course_texts: Vec<String> = Vec::new();
        for c in &courses {
            for s in &c.slots {
                if s.weekday == weekday {
                    course_texts.push(format!("{} {}-{}", c.name, s.start_time, s.end_time));
                }
            }
        }
        course_texts.sort();
        let free = free_windows_of_day(pool, date).await?;
        let free_text = if free.is_empty() {
            "无空档".to_string()
        } else {
            free.iter().map(|(a, b)| format!("{}-{}", fmt_min(*a), fmt_min(*b))).collect::<Vec<_>>().join("、")
        };
        lines.push(format!(
            "{}（{}）{}：课程[{}]；空档[{}]",
            date.format("%Y-%m-%d"),
            wd,
            holiday_text,
            course_texts.join("，"),
            free_text,
        ));
    }
    Ok((lines, dates))
}

#[tauri::command]
pub async fn ai_plan_week(
    state: State<'_, SqlitePool>,
    week_offset: i64,
) -> Result<WeekPlan, String> {
    let pool = state.inner();
    let (client, base_url, model, key) = require_llm(pool).await?;

    let today = Local::now().date_naive();
    let start = today + Duration::days(week_offset * 7);
    let (context_lines, dates) = week_context(pool, start).await?;

    let tasks = sqlx::query_as::<_, Task>(
        "SELECT * FROM tasks WHERE status IN ('open', 'doing') ORDER BY created_at",
    )
    .fetch_all(pool)
    .await
    .map_err(|e| e.to_string())?;
    if tasks.is_empty() {
        return Err("当前没有进行中的任务，先创建一些任务再生成周计划".to_string());
    }
    let task_lines: Vec<String> = tasks
        .iter()
        .map(|t| {
            format!(
                "id={} | {} | 重要性{} 紧迫性{} | 截止 {} | 预估 {} 分钟 | 分类 {}",
                t.id,
                t.title,
                t.importance,
                t.urgency,
                t.deadline.as_deref().unwrap_or("无"),
                t.estimated_min.map(|m| m.to_string()).unwrap_or_else(|| "未知".to_string()),
                if t.icon.is_empty() { "无" } else { t.icon.as_str() },
            )
        })
        .collect();

    let prompt = format!(
        "你是周计划参谋。根据用户的开放任务和本周日程，生成逐日任务排程计划。\n\
         {now}\n\
         开放任务列表：\n{tasks}\n\n\
         本周每日情况（计划只允许排在空档内）：\n{context}\n\n\
         输出严格的 JSON（不要输出任何其他文字、不要用代码块包裹）：\n\
         {{\"days\":[{{\"date\":\"YYYY-MM-DD\",\"items\":[{{\"task_id\":\"任务id\",\"start_time\":\"HH:MM\",\"end_time\":\"HH:MM\",\"note\":\"一句话安排理由\"}}],\"rest_advice\":\"休息建议或 null\"}}]}}\n\
         规则：\n\
         - 只把任务排进当天的空档时段，不得与课程重叠\n\
         - 节假日（放假）默认少排或不排并给出 rest_advice；除非任务 deadline 就在当天或次日（很急）\n\
         - 每天排程总时长不超过当天空档总长的 80%\n\
         - 临近截止、重要性/紧迫性高的任务优先往前排\n\
         - task_id 必须原样来自上面的任务列表，不得编造\n\
         - 每天 items 可为空数组；7 天都要出现在 days 里",
        now = now_prompt_context(),
        tasks = task_lines.join("\n"),
        context = context_lines.join("\n"),
    );
    let v = chat_json(&client, &base_url, &model, &key, &prompt, 0.3).await?;

    // 校验：日期必须在本周 7 天内、task_id 必须真实存在、时间合法且 start<end；单条非法跳过
    let valid_dates: Vec<String> = dates.iter().map(|d| d.format("%Y-%m-%d").to_string()).collect();
    let valid_task_ids: std::collections::HashSet<&str> = tasks.iter().map(|t| t.id.as_str()).collect();
    let mut days: Vec<WeekPlanDay> = Vec::new();
    let empty = Vec::new();
    let arr = v.get("days").and_then(|x| x.as_array()).unwrap_or(&empty);
    for day in arr {
        let Some(date) = day.get("date").and_then(|x| x.as_str()).map(str::to_string) else {
            continue;
        };
        if !valid_dates.contains(&date) {
            continue;
        }
        let mut items: Vec<WeekPlanItem> = Vec::new();
        if let Some(list) = day.get("items").and_then(|x| x.as_array()) {
            for item in list {
                let Some(task_id) = item.get("task_id").and_then(|x| x.as_str()) else { continue };
                if !valid_task_ids.contains(task_id) {
                    continue;
                }
                let (Some(st), Some(et)) = (
                    item.get("start_time").and_then(|x| x.as_str()).and_then(course::normalize_time),
                    item.get("end_time").and_then(|x| x.as_str()).and_then(course::normalize_time),
                ) else {
                    continue;
                };
                if st >= et {
                    continue;
                }
                let note = item
                    .get("note")
                    .and_then(|x| x.as_str())
                    .map(str::trim)
                    .filter(|s| !s.is_empty())
                    .map(str::to_string);
                items.push(WeekPlanItem { task_id: task_id.to_string(), start_time: st, end_time: et, note });
            }
        }
        items.sort_by(|a, b| a.start_time.cmp(&b.start_time));
        let rest_advice = day
            .get("rest_advice")
            .and_then(|x| x.as_str())
            .map(str::trim)
            .filter(|s| !s.is_empty() && *s != "null")
            .map(str::to_string);
        days.push(WeekPlanDay { date, items, rest_advice });
    }
    if days.is_empty() {
        return Err("AI 未能生成有效计划，请稍后重试".to_string());
    }

    let payload = json!({ "week_offset": week_offset, "days": days });
    let suggestion_id = record_suggestion(pool, "week_plan", &format!("week_offset={week_offset}"), &payload).await?;
    Ok(WeekPlan { suggestion_id, days })
}

/// 单任务时段推荐：给 LLM 该任务信息 + 本周逐日空档。
#[tauri::command]
pub async fn ai_suggest_slot(
    state: State<'_, SqlitePool>,
    task_id: String,
) -> Result<SlotSuggestion, String> {
    let pool = state.inner();
    let task = sqlx::query_as::<_, Task>("SELECT * FROM tasks WHERE id = ?")
        .bind(&task_id)
        .fetch_optional(pool)
        .await
        .map_err(|e| e.to_string())?
        .ok_or_else(|| format!("任务不存在：{task_id}"))?;
    let (client, base_url, model, key) = require_llm(pool).await?;

    let today = Local::now().date_naive();
    let (context_lines, dates) = week_context(pool, today).await?;
    let prompt = format!(
        "你是时间规划助手。为下面的任务在本周选一个最合适的执行时段。\n\
         {now}\n\
         任务：{title} | 重要性{importance} 紧迫性{urgency} | 截止 {deadline} | 预估 {est} 分钟 | 详情：{notes}\n\
         本周每日情况（推荐时段必须落在某天空档内）：\n{context}\n\n\
         输出严格的 JSON（不要输出任何其他文字、不要用代码块包裹）：\n\
         {{\"date\":\"YYYY-MM-DD\",\"start_time\":\"HH:MM\",\"end_time\":\"HH:MM\",\"reason\":\"一句话推荐理由\"}}\n\
         规则：时段长度约等于预估分钟数（未知则 60 分钟）；优先安排在截止日前；避开课程。",
        importance = task.importance,
        urgency = task.urgency,
        deadline = task.deadline.as_deref().unwrap_or("无"),
        est = task.estimated_min.map(|m| m.to_string()).unwrap_or_else(|| "未知".to_string()),
        now = now_prompt_context(),
        title = task.title,
        notes = task.notes.as_deref().unwrap_or("（无）"),
        context = context_lines.join("\n"),
    );
    let v = chat_json(&client, &base_url, &model, &key, &prompt, 0.3).await?;

    let valid_dates: Vec<String> = dates.iter().map(|d| d.format("%Y-%m-%d").to_string()).collect();
    let date = v
        .get("date")
        .and_then(|x| x.as_str())
        .filter(|s| valid_dates.contains(&s.to_string()))
        .ok_or_else(|| "AI 推荐的日期不在本周内，请重试".to_string())?
        .to_string();
    let (Some(st), Some(et)) = (
        v.get("start_time").and_then(|x| x.as_str()).and_then(course::normalize_time),
        v.get("end_time").and_then(|x| x.as_str()).and_then(course::normalize_time),
    ) else {
        return Err("AI 推荐的时段格式不正确，请重试".to_string());
    };
    if st >= et {
        return Err("AI 推荐的时段起止颠倒，请重试".to_string());
    }
    let reason = v
        .get("reason")
        .and_then(|x| x.as_str())
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .unwrap_or("该时段空闲且临近截止")
        .to_string();
    Ok(SlotSuggestion { date, start_time: st, end_time: et, reason })
}

/// 更新 ai_suggestions 状态（采纳/忽略）。
#[tauri::command]
pub async fn update_suggestion_status(
    state: State<'_, SqlitePool>,
    id: String,
    status: String,
) -> Result<(), String> {
    if !matches!(status.as_str(), "adopted" | "dismissed") {
        return Err(format!("非法的建议状态：{status}（应为 adopted | dismissed）"));
    }
    let result = sqlx::query("UPDATE ai_suggestions SET status = ? WHERE id = ?")
        .bind(&status)
        .bind(&id)
        .execute(state.inner())
        .await
        .map_err(|e| e.to_string())?;
    if result.rows_affected() == 0 {
        return Err(format!("建议记录不存在：{id}"));
    }
    Ok(())
}

// ---------- 单元测试 ----------

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn strip_fence_variants() {
        assert_eq!(strip_fence_parse("{\"a\":1}").unwrap()["a"], 1);
        assert_eq!(strip_fence_parse("```json\n{\"a\":1}\n```").unwrap()["a"], 1);
        assert_eq!(strip_fence_parse("```\n{\"a\":1}\n```").unwrap()["a"], 1);
        assert!(strip_fence_parse("not json").is_err());
    }

    #[test]
    fn normalize_deadline_accepts_date_and_iso() {
        assert_eq!(
            normalize_deadline(Some(&json!("2026-03-01"))),
            Some("2026-03-01".to_string())
        );
        assert_eq!(
            normalize_deadline(Some(&json!("2026-03-01T17:00"))),
            Some("2026-03-01T17:00".to_string())
        );
        assert_eq!(normalize_deadline(Some(&json!("下周再说"))), None);
        assert_eq!(normalize_deadline(Some(&json!(""))), None);
        assert_eq!(normalize_deadline(None), None);
    }

    #[test]
    fn normalize_icon_whitelist() {
        assert_eq!(normalize_icon(Some(&json!("study"))), "study");
        assert_eq!(normalize_icon(Some(&json!("homework"))), "");
        assert_eq!(normalize_icon(Some(&json!(""))), "");
        assert_eq!(normalize_icon(None), "");
    }

    #[test]
    fn normalize_recurrence_rules() {
        assert_eq!(normalize_recurrence(Some(&json!("daily")), None), ("daily".to_string(), None));
        assert_eq!(
            normalize_recurrence(Some(&json!("weekly")), Some(&json!("1,3,5"))),
            ("weekly".to_string(), Some("1,3,5".to_string()))
        );
        // weekly 但 recur_days 非法 → 整体回退 none
        assert_eq!(
            normalize_recurrence(Some(&json!("weekly")), Some(&json!("8,9"))),
            ("none".to_string(), None)
        );
        assert_eq!(normalize_recurrence(Some(&json!("每月")), None), ("none".to_string(), None));
        assert_eq!(normalize_recurrence(None, None), ("none".to_string(), None));
    }

    #[test]
    fn int_1_5_clamps() {
        assert_eq!(int_1_5(Some(&json!(5))), 5);
        assert_eq!(int_1_5(Some(&json!(9))), 5);
        assert_eq!(int_1_5(Some(&json!(0))), 1);
        assert_eq!(int_1_5(None), 3);
    }
}
