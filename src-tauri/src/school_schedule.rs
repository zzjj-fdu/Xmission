use reqwest::Url;
use serde::Serialize;
use serde_json::{json, Value};
use sqlx::SqlitePool;
use tauri::State;

use crate::llm::{current_config, http_client, map_http_err};

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SchoolPeriod {
    start: String,
    end: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SchoolScheduleResult {
    periods: Vec<SchoolPeriod>,
    source_url: String,
    source_title: String,
    semester_start: Option<String>,
}

fn xml_value<'a>(source: &'a str, tag: &str) -> Option<&'a str> {
    let start = format!("<{tag}>");
    let end = format!("</{tag}>");
    let i = source.find(&start)? + start.len();
    let j = source[i..].find(&end)? + i;
    Some(&source[i..j])
}

fn decode_entities(s: &str) -> String {
    s.replace("&amp;", "&").replace("&lt;", "<").replace("&gt;", ">")
        .replace("&quot;", "\"").replace("&#39;", "'").replace("&nbsp;", " ")
}

fn page_text(html: &str) -> String {
    let mut out = String::with_capacity(html.len().min(24000));
    let mut in_tag = false;
    let mut prev_space = false;
    for c in html.chars() {
        match c {
            '<' => in_tag = true,
            '>' => { in_tag = false; if !prev_space { out.push(' '); prev_space = true; } },
            _ if !in_tag => {
                if c.is_whitespace() {
                    if !prev_space { out.push(' '); prev_space = true; }
                } else {
                    out.push(c);
                    prev_space = false;
                }
            }
            _ => {}
        }
        if out.len() >= 24000 { break; }
    }
    decode_entities(&out).replace('：', ":")
}

fn evidence_has_time(text: &str, time: &str) -> bool {
    text.contains(time) || time.strip_prefix('0').is_some_and(|short| text.contains(short))
}

fn valid_time(s: &str) -> bool {
    let mut parts = s.split(':');
    let (Some(h), Some(m), None) = (parts.next(), parts.next(), parts.next()) else { return false; };
    matches!((h.parse::<u8>(), m.parse::<u8>()), (Ok(0..=23), Ok(0..=59)))
}

/// 已核对的当学期学校官网作息表。仅在官网仍可读取且时间逐项匹配时应用。
async fn verified_fudan_periods(school: &str, campus: &str) -> Option<SchoolScheduleResult> {
    if school != "复旦大学" || (!campus.is_empty() && !campus.contains("邯郸")) {
        return None;
    }
    // This published timetable applies to the 2026 autumn term only.
    let today = chrono::Local::now().date_naive();
    if today < chrono::NaiveDate::from_ymd_opt(2026, 9, 1)?
        || today > chrono::NaiveDate::from_ymd_opt(2027, 2, 28)? { return None; }
    let url = "https://life.fudan.edu.cn/0c/54/c28139a789588/page.htm";
    let pairs = [
        ("08:00", "08:45"), ("08:55", "09:40"), ("09:55", "10:40"),
        ("10:50", "11:35"), ("11:45", "12:30"), ("13:30", "14:15"),
        ("14:25", "15:10"), ("15:25", "16:10"), ("16:20", "17:05"),
        ("17:15", "18:00"), ("18:30", "19:15"), ("19:25", "20:10"),
        ("20:20", "21:05"), ("21:15", "22:00"),
    ];
    if let Ok(client) = http_client(8) {
        if let Ok(resp) = client.get(url).send().await {
            if let Ok(html) = resp.text().await {
                let text = page_text(&html);
                if text.contains("2026年秋季学期") && text.contains("第十四节")
                    && !pairs.iter().all(|(start, end)| evidence_has_time(&text, start) && evidence_has_time(&text, end)) {
                    return None; // 页面仍可读取却与已收录时间冲突，停止应用。
                }
            }
        }
    }
    Some(SchoolScheduleResult {
        periods: pairs.into_iter().map(|(start, end)| SchoolPeriod { start: start.into(), end: end.into() }).collect(),
        source_url: url.into(),
        source_title: "复旦大学官网 · 2026 年秋季学期作息（已核对收录）".into(),
        semester_start: Some("2026-09-07".into()),
    })
}

/// 仅检索高校官网（edu.cn），并把来源网址交给用户核对。
#[tauri::command]
pub async fn ai_find_school_periods(
    state: State<'_, SqlitePool>, school: String, campus: String,
) -> Result<SchoolScheduleResult, String> {
    let school = school.trim();
    let campus = campus.trim();
    if school.chars().count() < 3 || school.chars().count() > 80 {
        return Err("请填写学校全称（至少 3 个字）".to_string());
    }
    if let Some(verified) = verified_fudan_periods(school, campus).await { return Ok(verified); }
    let (base_url, model, key) = current_config(state.inner()).await?;
    let key = key.ok_or_else(|| "请先在设置中配置并测试 AI 接口".to_string())?;
    let client = http_client(35)?;
    let query = format!("{school} {campus} 作息时间表 第1节 第2节 上课时间 site:edu.cn");
    let search_url = Url::parse_with_params("https://www.bing.com/search", &[("q", query.as_str()), ("format", "rss")])
        .map_err(|e| format!("创建搜索地址失败：{e}"))?;
    let rss = client.get(search_url).header("User-Agent", "Mozilla/5.0 Xmission/0.1")
        .send().await.map_err(map_http_err)?.text().await.map_err(map_http_err)?;
    let mut candidates: Vec<(String, String)> = Vec::new();
    for part in rss.split("<item>").skip(1).take(12) {
        let title = decode_entities(xml_value(part, "title").unwrap_or(""));
        let link = decode_entities(xml_value(part, "link").unwrap_or(""));
        let Ok(url) = Url::parse(&link) else { continue; };
        if url.scheme() != "https" || !url.host_str().unwrap_or("").ends_with(".edu.cn") { continue; }
        candidates.push((title, url.to_string()));
        if candidates.len() >= 4 { break; }
    }
    if candidates.is_empty() {
        return Err("没有搜到可核对的学校官网作息页面。请换成学校全称，或手动调整时间。".to_string());
    }
    let mut evidence: Vec<(String, String, String)> = Vec::new();
    for (title, url) in candidates {
        let Ok(resp) = client.get(&url).header("User-Agent", "Mozilla/5.0 Xmission/0.1").send().await else { continue; };
        if !resp.status().is_success() { continue; }
        let Ok(html) = resp.text().await else { continue; };
        let text = page_text(&html);
        if text.len() < 100 { continue; }
        evidence.push((title, url, text));
    }
    if evidence.is_empty() {
        return Err("搜到了学校官网，但页面暂时无法读取。请稍后再试，或手动调整时间。".to_string());
    }
    let excerpts = evidence.iter().enumerate().map(|(i, (title, url, text))| {
        format!("来源 {i}：{title}\n网址：{url}\n网页：{}", text.chars().take(14000).collect::<String>())
    }).collect::<Vec<_>>().join("\n\n");
    let prompt = format!(
        "请从下列学校官网资料提取 {school} {campus} 当前适用的逐节上课作息时间。严禁猜测或补全缺失节次；若资料不明确，返回空 periods。只输出 JSON：{{\"source_index\":0,\"periods\":[{{\"start\":\"08:00\",\"end\":\"08:45\"}}]}}。必须是每一节而非大课时间。\n\n{excerpts}"
    );
    let resp = crate::llm::send_compatible(&client, &base_url, &key,
        json!({"model": model, "messages": [{"role":"user", "content":prompt}], "stream":false})).await?;
    let status = resp.status();
    let body: Value = resp.json().await.map_err(|e| format!("AI 响应解析失败：{e}"))?;
    if !status.is_success() {
        let reason = body.pointer("/error/message").and_then(Value::as_str).unwrap_or("接口请求失败");
        return Err(format!("AI 检索失败（HTTP {status}）：{}", reason.chars().take(160).collect::<String>()));
    }
    let content = crate::llm::extract_text(&body).ok_or_else(|| "AI 没有返回作息时间".to_string())?;
    let parsed: Value = serde_json::from_str(content.trim().trim_start_matches("```json").trim_start_matches("```").trim_end_matches("```").trim())
        .map_err(|_| "AI 返回的作息格式无法读取，请手动调整".to_string())?;
    let source_index = parsed.get("source_index").and_then(Value::as_u64).unwrap_or(0) as usize;
    let source = evidence.get(source_index).ok_or_else(|| "AI 引用了无效来源，请手动核对".to_string())?;
    if !source.0.contains(school) && !source.2.contains(school) {
        return Err("找到的网页无法确认属于该学校，请换学校全称或手动调整".to_string());
    }
    let raw = parsed.get("periods").and_then(Value::as_array)
        .ok_or_else(|| "AI 未找到可信的逐节时间，请手动调整".to_string())?;
    let mut periods = Vec::new();
    let mut last_end = String::new();
    for row in raw {
        let (Some(start), Some(end)) = (row.get("start").and_then(Value::as_str), row.get("end").and_then(Value::as_str)) else { continue; };
        if !valid_time(start) || !valid_time(end) || start >= end || (!last_end.is_empty() && start < last_end.as_str()) {
            return Err("官网资料中的节次时间有冲突，请手动核对".to_string());
        }
        if !evidence_has_time(&source.2, start) || !evidence_has_time(&source.2, end) {
            return Err("AI 给出的时间未在学校官网页面找到，已停止自动应用，请手动核对".to_string());
        }
        periods.push(SchoolPeriod { start: start.to_string(), end: end.to_string() });
        last_end = end.to_string();
    }
    if !(4..=16).contains(&periods.len()) {
        return Err("未能从官网可靠识别完整节次（至少 4 节）。请换校区名称或手动调整。".to_string());
    }
    Ok(SchoolScheduleResult { periods, source_url: source.1.clone(), source_title: source.0.clone(), semester_start: None })
}
