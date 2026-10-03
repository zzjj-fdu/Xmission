use base64::{engine::general_purpose::STANDARD as B64, Engine as _};
use serde_json::{json, Value};
use sqlx::SqlitePool;
use tauri::{AppHandle, Emitter, State};
use uuid::Uuid;

use crate::models::{CourseDraft, CourseDraftSlot, LlmConfig, LlmModelInfo};

const KEYRING_SERVICE: &str = "xmission";
const KEYRING_USER: &str = "llm_api_key";
const DEFAULT_BASE_URL: &str = "https://api.moonshot.cn/v1";
// moonshot-v1 全系已停止新用户使用、2026-08-31 全平台下线；当前官方视觉示例模型为 kimi-k3
const DEFAULT_MODEL: &str = "kimi-k3";

/// 始终按截图中的星期列和节次行识别；没有作息表时也保留课程，留待校对时补时间。
fn build_ocr_prompt(periods: &[(String, String)]) -> String {
    let period_lines: Vec<String> = periods
        .iter()
        .enumerate()
        .map(|(i, (s, e))| format!("第{}节 {}-{}", i + 1, s, e))
        .collect();
    format!(
        "这是一张大学课表截图。课表是二维网格：横轴是星期（按截图表头识别，可能周日开头），纵轴是节次（从上到下）。\
        已核实的节次时间如下；即使图片的节次比列表更多，也必须提取全部课程，不可省略超出列表的课程：\n{periods_text}\n\
        你的任务：先读表头确认列与星期的对应关系，再逐格读取，把每个课程格子提取为一行 JSON。\
        【不要】猜测具体时间——一律用截图中的节次编号描述纵轴位置，时间由系统换算或留待用户校对。\n\
        输出严格 JSON（不要输出任何其他文字、不要用代码块包裹）：\n\
        {{\"courses\":[{{\"name\":\"课程名\",\"teacher\":\"教师\",\"location\":\"地点\",\"weekday\":1,\"start_period\":1,\"end_period\":2,\"weeks\":\"1-16\",\"parity\":\"all\"}}]}}\n\
        要求：\n\
        - weekday 完全由格子所在【列】的表头决定：1=周一、7=周日。若表头周日开头，第一列为 7、第二列为 1\n\
        - start_period/end_period 由格子纵跨的【行】决定：连排几节就跨几节（例如一个大格占第 3、4 节 → start_period=3, end_period=4）\n\
        - 同一门课出现在多个格子就输出多行\n\
        - weeks 为上课周次，如 \"1-16\"、\"1-8,10-16\"；格子里没写周次就填 \"1-16\"\n\
        - parity 为 all|odd|even（all=每周，odd=单周，even=双周）；没写单双周就填 \"all\"\n\
        - 同名课程的不同格子若教师、地点或周次不同，逐格保留各自字段；同一格有多段不同周次/教师时拆成多行\n\
        - 格子内文字通常分行排列：第一行课程名，其后可能是教师/地点/周次；无法识别的字段填空字符串\n\
        - 只提取真正的课程格，忽略表头、节次列、个人信息、备注及课外活动",
        periods_text = if period_lines.is_empty() { "（尚未设置，请仍按图片上的节次识别）".to_string() } else { period_lines.join("\n") }
    )
}

// ---------- 配置与钥匙串 ----------

fn keyring_entry() -> Result<keyring::Entry, String> {
    keyring::Entry::new(KEYRING_SERVICE, KEYRING_USER)
        .map_err(|e| format!("无法访问系统钥匙串：{e}"))
}

fn read_api_key() -> Result<Option<String>, String> {
    match keyring_entry()?.get_password() {
        // 读取时 trim：历史版本曾把带换行/空白的 key 原样存入，导致鉴权 401
        Ok(k) if !k.trim().is_empty() => Ok(Some(normalize_api_key(&k)?)),
        Ok(_) => Ok(None),
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(e) => Err(format!("读取钥匙串失败：{e}")),
    }
}

async fn get_setting(pool: &SqlitePool, key: &str) -> Result<Option<String>, String> {
    sqlx::query_scalar::<_, String>("SELECT value FROM settings WHERE key = ?")
        .bind(key)
        .fetch_optional(pool)
        .await
        .map_err(|e| e.to_string())
}

async fn set_setting(pool: &SqlitePool, key: &str, value: &str) -> Result<(), String> {
    sqlx::query(
        "INSERT INTO settings (key, value) VALUES (?, ?)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value",
    )
    .bind(key)
    .bind(value)
    .execute(pool)
    .await
    .map_err(|e| e.to_string())?;
    Ok(())
}

pub(crate) async fn current_config(pool: &SqlitePool) -> Result<(String, String, Option<String>), String> {
    let base_url = get_setting(pool, "llm_base_url")
        .await?
        .filter(|s| !s.trim().is_empty())
        .unwrap_or_else(|| DEFAULT_BASE_URL.to_string());
    let base_url = normalize_base_url(&base_url)?;
    let model = get_setting(pool, "llm_model")
        .await?
        .filter(|s| !s.trim().is_empty())
        .unwrap_or_else(|| DEFAULT_MODEL.to_string());
    let key = tokio::task::spawn_blocking(read_api_key).await.map_err(|e| e.to_string())??;
    Ok((base_url, model, key))
}

pub(crate) fn http_client(timeout_secs: u64) -> Result<reqwest::Client, String> {
    reqwest::Client::builder()
        // Do not follow a provider redirect that could downgrade HTTPS to HTTP.
        .redirect(reqwest::redirect::Policy::none())
        .timeout(std::time::Duration::from_secs(timeout_secs))
        .build()
        .map_err(|e| format!("创建网络客户端失败：{e}"))
}

/// reqwest 错误 → 中文错误。
pub(crate) fn map_http_err(e: reqwest::Error) -> String {
    if e.is_timeout() {
        "连接超时，请检查网络后重试".to_string()
    } else if e.is_connect() {
        "无法连接到服务器，请检查网络与接口地址".to_string()
    } else {
        format!("网络请求失败：{e}")
    }
}

// ---------- Tauri Commands ----------

/// 读 LLM 配置：永远不回传 key 本体，只回传 has_key。
#[tauri::command]
pub async fn get_llm_config(state: State<'_, SqlitePool>) -> Result<LlmConfig, String> {
    let (base_url, model, key) = current_config(state.inner()).await?;
    Ok(LlmConfig {
        base_url,
        model,
        has_key: key.is_some(),
    })
}

/// 保存 LLM 配置：baseUrl/model 存 settings；apiKey 非空才写钥匙串，空 = 保留不动。
#[tauri::command]
pub async fn set_llm_config(
    state: State<'_, SqlitePool>,
    app: AppHandle,
    base_url: String,
    model: String,
    api_key: String,
) -> Result<(), String> {
    let base_url = normalize_base_url(&base_url)?;
    let model = model.trim();
    if base_url.is_empty() {
        return Err("接口地址（baseUrl）不能为空".to_string());
    }
    if model.is_empty() {
        return Err("模型名称不能为空".to_string());
    }
    let pool = state.inner();
    set_setting(pool, "llm_base_url", &base_url).await?;
    set_setting(pool, "llm_model", model).await?;
    // 写入前 trim：粘贴来的 key 常带首尾空白/换行，原样存会鉴权 401
    let api_key = api_key.trim();
    if !api_key.is_empty() {
        let api_key = normalize_api_key(api_key)?;
        tokio::task::spawn_blocking(move || {
            keyring_entry()?.set_password(&api_key)
                .map_err(|e| format!("写入系统钥匙串失败：{e}"))
        }).await.map_err(|e| e.to_string())??;
    }
    let _ = app.emit("llm-config-changed", ());
    Ok(())
}

fn normalize_api_key(raw: &str) -> Result<String, String> {
    let mut key = raw.trim().trim_matches(['"', '\'']).trim().to_string();
    if key.starts_with('{') {
        let value: Value = serde_json::from_str(&key).map_err(|_| "密钥 JSON 格式无效".to_string())?;
        key = ["api_key", "apiKey", "OPENAI_API_KEY", "key", "token"]
            .iter().find_map(|name| value.get(name).and_then(Value::as_str))
            .ok_or_else(|| "密钥 JSON 中缺少 api_key 或 token 字段".to_string())?.to_string();
    }
    if let Some(line) = key.lines().find(|line| line.to_ascii_lowercase().contains("api_key=")) {
        key = line.split_once('=').map(|(_, value)| value.trim().to_string()).unwrap_or(key);
    }
    for prefix in ["Authorization:", "Bearer ", "x-api-key:", "api-key:"] {
        if key.to_ascii_lowercase().starts_with(&prefix.to_ascii_lowercase()) {
            key = key[prefix.len()..].trim().to_string();
        }
    }
    if key.to_ascii_lowercase().starts_with("bearer ") { key = key[7..].trim().to_string(); }
    key = key.trim_matches(['"', '\'']).trim().to_string();
    if key.is_empty() || key.contains(['\r', '\n']) { return Err("密钥为空或包含多行；请粘贴单个 API Key".into()); }
    Ok(key)
}

fn normalize_base_url(raw: &str) -> Result<String, String> {
    let mut url = raw.trim().trim_end_matches('/').to_string();
    for suffix in ["/chat/completions", "/models"] {
        if url.ends_with(suffix) { url.truncate(url.len() - suffix.len()); }
    }
    if url == "https://llmapi.paratera.com" { url.push_str("/v1"); }
    let parsed = reqwest::Url::parse(&url).map_err(|_| "接口地址不是有效 URL".to_string())?;
    if !matches!(parsed.scheme(), "https" | "http") || parsed.host_str().is_none() { return Err("接口地址需要 http 或 https".into()); }
    let loopback = parsed.host_str().is_some_and(|host| {
        host == "localhost" || host.trim_matches(['[', ']']).parse::<std::net::IpAddr>()
            .is_ok_and(|ip| ip.is_loopback())
    });
    if parsed.scheme() == "http" && !loopback {
        return Err("外部 AI 接口必须使用 HTTPS；只有本机服务可以使用 HTTP".into());
    }
    if !parsed.username().is_empty() || parsed.password().is_some() {
        return Err("请把密钥填入密钥栏，接口地址不能包含用户名或密码".into());
    }
    Ok(url)
}

fn response_api(base_url: &str) -> bool { base_url.ends_with("/responses") }
fn model_base_url(base_url: &str) -> &str { base_url.strip_suffix("/responses").unwrap_or(base_url) }

pub(crate) fn extract_text(body: &Value) -> Option<String> {
    if let Some(text) = body.pointer("/choices/0/message/content").and_then(Value::as_str) { return Some(text.to_string()); }
    if let Some(text) = body.get("output_text").and_then(Value::as_str) { return Some(text.to_string()); }
    let parts = body.get("output")?.as_array()?.iter()
        .filter_map(|item| item.get("content").and_then(Value::as_array))
        .flat_map(|items| items.iter())
        .filter_map(|item| item.get("text").and_then(Value::as_str))
        .collect::<Vec<_>>();
    if parts.is_empty() { None } else { Some(parts.join("")) }
}

pub(crate) async fn send_compatible(client: &reqwest::Client, base_url: &str, key: &str, chat_body: Value) -> Result<reqwest::Response, String> {
    let (url, body) = if response_api(base_url) {
        let input = chat_body.get("messages").and_then(Value::as_array).ok_or("请求缺少 messages")?
            .iter().map(|message| {
                let content = if let Some(items) = message.get("content").and_then(Value::as_array) {
                    Value::Array(items.iter().map(|item| {
                        if item.get("type").and_then(Value::as_str) == Some("image_url") {
                            json!({"type":"input_image", "image_url":item.pointer("/image_url/url")})
                        } else { json!({"type":"input_text", "text":item.get("text")}) }
                    }).collect())
                } else { message.get("content").cloned().unwrap_or(Value::Null) };
                json!({"role":message.get("role"), "content":content})
            }).collect::<Vec<_>>();
        (base_url.to_string(), json!({"model":chat_body.get("model"), "input":input}))
    } else { (format!("{base_url}/chat/completions"), chat_body) };
    client.post(url).bearer_auth(key).json(&body).send().await.map_err(map_http_err)
}

/// 窄悬浮窗用的短标题。只在用户已配置 API 且自动概括开启时由前端调用。
#[tauri::command]
pub async fn summarize_task_for_widget(
    state: State<'_, SqlitePool>, title: String, notes: String,
) -> Result<String, String> {
    let (base_url, model, key) = current_config(state.inner()).await?;
    let key = key.ok_or_else(|| "LLM 未配置".to_string())?;
    let title = title.chars().take(240).collect::<String>();
    let notes = notes.chars().take(800).collect::<String>();
    let client = http_client(25)?;
    let resp = send_compatible(&client, &base_url, &key, json!({
            "model": model,
            "messages": [
                {"role":"system", "content":"你是任务栏文案编辑。把任务概括为清楚的行动短语，最多 12 个汉字或 22 个英文字母。保留具体行动和对象，不添新信息，不要引号、序号或解释。"},
                {"role":"user", "content":format!("标题：{title}\n备注：{notes}")}
            ],
            "stream": false
        })).await?;
    let status = resp.status();
    let body: Value = resp.json().await.map_err(|e| format!("概括响应解析失败：{e}"))?;
    if !status.is_success() { return Err(format!("概括请求失败（HTTP {status}）")); }
    let content = extract_text(&body).unwrap_or_default();
    let reply = content.trim().trim_matches(['\"', '\'', '。', '“', '”']);
    if reply.is_empty() || reply.chars().count() > 28 { return Err("概括结果无效".to_string()); }
    Ok(reply.to_string())
}

/// 用当前模型发送最小对话，真实验证地址、密钥和模型的推理通路。
#[tauri::command]
pub async fn test_llm_connection(state: State<'_, SqlitePool>) -> Result<String, String> {
    let (base_url, model, key) = current_config(state.inner()).await?;
    let key = key.ok_or_else(|| "尚未配置 API Key，请先保存配置".to_string())?;
    let client = http_client(30)?;
    let resp = send_compatible(&client, &base_url, &key, json!({
            "model": model,
            "messages": [{"role": "user", "content": "请只回复：通路正常"}],
            "stream": false
        })).await?;
    let status = resp.status();
    if status == reqwest::StatusCode::UNAUTHORIZED || status == reqwest::StatusCode::FORBIDDEN {
        return Err("API Key 无效或已过期".to_string());
    }
    let body: Value = resp
        .json()
        .await
        .map_err(|e| format!("解析服务响应失败：{e}"))?;
    if !status.is_success() {
        let reason = body.pointer("/error/message").and_then(Value::as_str).unwrap_or("请检查模型名称与账户权限");
        return Err(format!("服务返回错误（HTTP {status}）：{}", reason.chars().take(180).collect::<String>()));
    }
    let content = extract_text(&body).unwrap_or_default();
    let reply = content.trim();
    if reply.is_empty() {
        return Err("接口已响应，但模型没有返回正文；请换一个对话模型重试".to_string());
    }
    Ok(format!("{model} · 已收到模型回复"))
}

/// 拉取远端可用模型列表：GET {base_url}/models，返回 id + 是否支持图片输入。
#[tauri::command]
pub async fn list_llm_models(state: State<'_, SqlitePool>) -> Result<Vec<LlmModelInfo>, String> {
    let (base_url, _model, key) = current_config(state.inner()).await?;
    let key = key.ok_or_else(|| "尚未配置 API Key，请先保存配置".to_string())?;
    let client = http_client(15)?;
    let resp = client
        .get(format!("{}/models", model_base_url(&base_url)))
        .bearer_auth(&key)
        .send()
        .await
        .map_err(map_http_err)?;
    let status = resp.status();
    if status == reqwest::StatusCode::UNAUTHORIZED || status == reqwest::StatusCode::FORBIDDEN {
        return Err("API Key 无效或已过期".to_string());
    }
    if !status.is_success() {
        return Err(format!("服务返回错误（HTTP {status}）"));
    }
    let body: Value = resp
        .json()
        .await
        .map_err(|e| format!("解析响应失败：{e}"))?;
    let arr = body
        .get("data")
        .and_then(|d| d.as_array())
        .ok_or_else(|| "响应中缺少 models 列表（data 数组）".to_string())?;
    let mut out: Vec<LlmModelInfo> = Vec::new();
    for m in arr {
        let Some(id) = m.get("id").and_then(|i| i.as_str()) else {
            continue;
        };
        let supports_image_in = m
            .get("supports_image_in")
            .and_then(|v| v.as_bool())
            .unwrap_or(false);
        out.push(LlmModelInfo {
            id: id.to_string(),
            supports_image_in,
        });
    }
    if out.is_empty() {
        return Err("模型列表为空，请检查接口地址与 API Key".to_string());
    }
    Ok(out)
}

/// 读取课次时间模板（setting 'course_periods'，JSON [{start,end}]）。
/// 返回空 Vec = 未配置 → 识图回退到时间模式。
async fn load_periods(pool: &SqlitePool) -> Vec<(String, String)> {
    let Ok(Some(raw)) = get_setting(pool, "course_periods").await else {
        return Vec::new();
    };
    let Ok(v) = serde_json::from_str::<Value>(&raw) else {
        return Vec::new();
    };
    v.as_array()
        .map(|arr| {
            arr.iter()
                .filter_map(|p| {
                    let s = p.get("start").and_then(|x| x.as_str())?;
                    let e = p.get("end").and_then(|x| x.as_str())?;
                    Some((s.to_string(), e.to_string()))
                })
                .collect()
        })
        .unwrap_or_default()
}

/// AI 课表截图识别 → CourseDraft[]（不落 courses 表，写一条 ai_suggestions 记录）。
#[tauri::command]
pub async fn ai_parse_schedule_image(
    state: State<'_, SqlitePool>,
    file_name: String,
    bytes_base64: String,
) -> Result<Vec<CourseDraft>, String> {
    let pool = state.inner();
    let (base_url, model, key) = current_config(pool).await?;
    let key = key.ok_or_else(|| "尚未配置 API Key，请先在设置中保存".to_string())?;
    // 用户已调好的节次模板：有 → 节次模式（模型只数格子，时间由模板换算，准确率显著更高）
    let periods = load_periods(pool).await;

    // base64 解码校验（mime 按扩展名）
    let cleaned: String = bytes_base64.chars().filter(|c| !c.is_whitespace()).collect();
    B64.decode(&cleaned).map_err(|_| "图片数据不是有效的 base64".to_string())?;
    let ext = file_name.rsplit('.').next().unwrap_or("").to_lowercase();
    let mime = match ext.as_str() {
        "jpg" | "jpeg" => "image/jpeg",
        "webp" => "image/webp",
        _ => "image/png",
    };
    let data_url = format!("data:{mime};base64,{cleaned}");

    let client = http_client(90)?;
    // 解析失败重试 1 次
    let mut last_err = String::new();
    for attempt in 0..2 {
        match request_and_parse(&client, &base_url, &model, &key, &data_url, &periods).await {
            Ok(drafts) => {
                // 写一条 pending 的 ai_suggestions 记录
                let payload = serde_json::to_string(&drafts).map_err(|e| e.to_string())?;
                sqlx::query(
                    "INSERT INTO ai_suggestions (id, kind, input_summary, payload_json, status, created_at)
                     VALUES (?, 'schedule_ocr', ?, ?, 'pending', ?)",
                )
                .bind(Uuid::new_v4().to_string())
                .bind(&file_name)
                .bind(&payload)
                .bind(chrono::Utc::now().to_rfc3339())
                .execute(pool)
                .await
                .map_err(|e| e.to_string())?;
                return Ok(drafts);
            }
            Err(e) => {
                last_err = e;
                if attempt == 0 {
                    continue; // 重试 1 次
                }
            }
        }
    }
    Err(format!("AI 识别失败（已重试 1 次）：{last_err}"))
}

async fn request_and_parse(
    client: &reqwest::Client,
    base_url: &str,
    model: &str,
    key: &str,
    data_url: &str,
    periods: &[(String, String)],
) -> Result<Vec<CourseDraft>, String> {
    let prompt = build_ocr_prompt(periods);
    let body = json!({
        "model": model,
        "messages": [{
            "role": "user",
            "content": [
                {"type": "text", "text": prompt},
                {"type": "image_url", "image_url": {"url": data_url}},
            ],
        }],
        "response_format": {"type": "json_object"},
        "temperature": 0.1,
    });
    let resp = send_compatible(client, base_url, key, body).await?;
    let status = resp.status();
    if status == reqwest::StatusCode::UNAUTHORIZED || status == reqwest::StatusCode::FORBIDDEN {
        return Err("API Key 无效或已过期".to_string());
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
    let content = extract_text(&resp_json).ok_or_else(|| "响应中缺少文本内容".to_string())?;
    let drafts = parse_courses_json(&content, periods)?;
    if drafts.is_empty() {
        return Err("未能从截图中识别到任何课程".to_string());
    }
    Ok(drafts)
}

/// 模型输出文本 → CourseDraft[]。只合并课程名、教师、地点、周次都相同的格子。
/// 时间模板缺少对应节次时保留空时间和节次号，交由预览界面提醒用户补齐。
fn parse_courses_json(
    content: &str,
    periods: &[(String, String)],
) -> Result<Vec<CourseDraft>, String> {
    let text = content
        .trim()
        .trim_start_matches("```json")
        .trim_start_matches("```")
        .trim_end_matches("```")
        .trim();
    let v: Value = serde_json::from_str(text).map_err(|e| format!("模型输出不是合法 JSON：{e}"))?;
    let arr = v
        .get("courses")
        .and_then(|c| c.as_array())
        .ok_or_else(|| "模型输出缺少 courses 数组".to_string())?;

    let mut drafts: Vec<CourseDraft> = Vec::new();
    for item in arr {
        let name = item.get("name").and_then(|x| x.as_str()).unwrap_or("").trim();
        if name.is_empty() {
            continue; // 无课名的行跳过
        }
        let weekday = match item.get("weekday").and_then(|x| x.as_i64()) {
            Some(w) if (1..=7).contains(&w) => w,
            _ => continue, // weekday 非法的行跳过
        };
        let (start_time, end_time, start_period, end_period) = if item.get("start_period").is_some() {
            let sp = item.get("start_period").and_then(|x| x.as_i64());
            let ep = item.get("end_period").and_then(|x| x.as_i64());
            match (sp, ep) {
                (Some(sp), Some(ep)) if sp >= 1 && ep >= sp && ep <= 30 => {
                    (
                        periods.get((sp - 1) as usize).map(|p| p.0.clone()).unwrap_or_default(),
                        periods.get((ep - 1) as usize).map(|p| p.1.clone()).unwrap_or_default(),
                        Some(sp as usize),
                        Some(ep as usize),
                    )
                }
                _ => continue,
            }
        } else {
            let start_raw = item.get("start_time").and_then(|x| x.as_str()).unwrap_or("");
            let end_raw = item.get("end_time").and_then(|x| x.as_str()).unwrap_or("");
            let (Some(s), Some(e)) = (
                crate::course::normalize_time(start_raw),
                crate::course::normalize_time(end_raw),
            ) else {
                continue; // 时间非法的行跳过
            };
            (s, e, None, None)
        };
        let teacher = item
            .get("teacher")
            .and_then(|x| x.as_str())
            .map(str::trim)
            .filter(|s| !s.is_empty())
            .map(str::to_string);
        let location = item
            .get("location")
            .and_then(|x| x.as_str())
            .map(str::trim)
            .filter(|s| !s.is_empty())
            .map(str::to_string);
        let weeks = item
            .get("weeks")
            .and_then(|x| x.as_str())
            .map(str::trim)
            .filter(|s| !s.is_empty())
            .unwrap_or("1-16")
            .replace('~', "-")
            .replace('～', "-")
            .replace('—', "-")
            .replace('–', "-")
            .replace('，', ",")
            .to_string();
        let parity = item
            .get("parity")
            .and_then(|x| x.as_str())
            .map(str::trim)
            .filter(|s| matches!(*s, "all" | "odd" | "even"))
            .unwrap_or("all")
            .to_string();

        let slot = CourseDraftSlot {
            weekday,
            start_time,
            end_time,
            start_period,
            end_period,
        };
        if let Some(d) = drafts.iter_mut().find(|d| {
            d.name == name && d.teacher == teacher && d.location == location
                && d.weeks_mask.as_deref() == Some(weeks.as_str())
                && d.week_parity.as_deref() == Some(parity.as_str())
        }) {
            d.slots.push(slot);
        } else {
            drafts.push(CourseDraft {
                name: name.to_string(),
                teacher,
                location,
                color: None,
                weeks_mask: Some(weeks),
                week_parity: Some(parity),
                slots: vec![slot],
            });
        }
    }
    for d in &mut drafts {
        d.slots
            .sort_by(|a, b| (a.weekday, &a.start_time).cmp(&(b.weekday, &b.start_time)));
    }
    Ok(drafts)
}

// ---------- 单元测试 ----------

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn accepts_common_key_wrappers_without_storing_the_wrapper() {
        for input in [
            "sk-example",
            "Bearer sk-example",
            "Authorization: Bearer sk-example",
            "OPENAI_API_KEY=sk-example",
            r#"{"api_key":"sk-example"}"#,
        ] {
            assert_eq!(normalize_api_key(input).unwrap(), "sk-example");
        }
    }

    #[test]
    fn external_services_require_https_but_loopback_http_is_supported() {
        for url in ["https://example.com/v1", "http://localhost:11434/v1", "http://127.0.0.1:8080/v1", "http://[::1]:8080/v1"] {
            assert!(normalize_base_url(url).is_ok(), "{url}");
        }
        for url in ["http://example.com/v1", "http://localhost.example.com/v1", "http://192.168.1.2/v1", "https://user:secret@example.com/v1", "file:///tmp/model"] {
            assert!(normalize_base_url(url).is_err(), "{url}");
        }
    }

    #[test]
    fn responses_text_and_endpoint_are_recognized() {
        assert_eq!(normalize_base_url("https://llmapi.paratera.com").unwrap(), "https://llmapi.paratera.com/v1");
        let endpoint = "https://llmapi.paratera.com/v1/responses";
        assert!(response_api(endpoint));
        assert_eq!(model_base_url(endpoint), "https://llmapi.paratera.com/v1");
        let body = json!({"output":[{"content":[{"type":"output_text","text":"通路正常"}]}]});
        assert_eq!(extract_text(&body).as_deref(), Some("通路正常"));
    }

    #[test]
    fn parse_courses_json_groups_by_name() {
        let content = r#"{"courses":[
            {"name":"高等数学","teacher":"张三","location":"教一101","weekday":1,"start_time":"08:00","end_time":"09:40","weeks":"1-16","parity":"all"},
            {"name":"高等数学","teacher":"张三","location":"教一101","weekday":3,"start_time":"10:00","end_time":"11:40","weeks":"1-16","parity":"all"},
            {"name":"体育","teacher":"","location":"操场","weekday":5,"start_time":"14:00","end_time":"15:40","weeks":"","parity":""}
        ]}"#;
        let drafts = parse_courses_json(content, &[]).unwrap();
        assert_eq!(drafts.len(), 2);
        assert_eq!(drafts[0].name, "高等数学");
        assert_eq!(drafts[0].slots.len(), 2);
        assert_eq!(drafts[1].weeks_mask.as_deref(), Some("1-16"));
        assert_eq!(drafts[1].week_parity.as_deref(), Some("all"));
        assert_eq!(drafts[1].teacher, None);
    }

    #[test]
    fn parse_courses_json_skips_invalid_rows() {
        let content = r#"{"courses":[
            {"name":"数学","weekday":9,"start_time":"08:00","end_time":"09:40"},
            {"name":"数学","weekday":1,"start_time":"bad","end_time":"09:40"},
            {"name":"数学","weekday":1,"start_time":"08:00","end_time":"09:40"}
        ]}"#;
        let drafts = parse_courses_json(content, &[]).unwrap();
        assert_eq!(drafts.len(), 1);
        assert_eq!(drafts[0].slots.len(), 1);
    }

    #[test]
    fn parse_courses_json_strips_fence() {
        let content = "```json\n{\"courses\":[{\"name\":\"英语\",\"weekday\":2,\"start_time\":\"10:00\",\"end_time\":\"11:40\"}]}\n```";
        let drafts = parse_courses_json(content, &[]).unwrap();
        assert_eq!(drafts.len(), 1);
        assert_eq!(drafts[0].name, "英语");
    }

    #[test]
    fn parse_courses_json_garbage_errors() {
        assert!(parse_courses_json("not json", &[]).is_err());
        assert!(parse_courses_json("{\"nope\":[]}", &[]).is_err());
    }

    #[test]
    fn parse_courses_json_period_mode_maps_times() {
        let periods: Vec<(String, String)> = vec![
            ("08:00".into(), "08:45".into()),
            ("08:55".into(), "09:40".into()),
            ("10:00".into(), "10:45".into()),
        ];
        let content = r#"{"courses":[
            {"name":"高等数学","weekday":1,"start_period":1,"end_period":2,"weeks":"1-16","parity":"all"},
            {"name":"坏行","weekday":2,"start_period":2,"end_period":9},
            {"name":"英语","weekday":3,"start_period":3,"end_period":3}
        ]}"#;
        let drafts = parse_courses_json(content, &periods).unwrap();
        assert_eq!(drafts.len(), 3); // 超出模板的课程仍保留，等待补齐节次时间
        assert_eq!(drafts[0].slots[0].start_time, "08:00");
        assert_eq!(drafts[0].slots[0].end_time, "09:40"); // 1-2 节连排 → 第2节下课时间
        assert_eq!(drafts[1].slots[0].start_time, "08:55");
        assert_eq!(drafts[1].slots[0].end_time, "");
        assert_eq!(drafts[1].slots[0].end_period, Some(9));
        assert_eq!(drafts[2].slots[0].start_time, "10:00");
        assert_eq!(drafts[2].slots[0].end_time, "10:45");
    }

    #[test]
    fn timetable_with_fourteen_periods_keeps_every_cell_and_distinct_details() {
        // 取自用户的 2026 秋季课表网格；不包含截图中的个人信息。
        let periods = [
            ("08:00", "08:45"), ("08:55", "09:40"), ("09:55", "10:40"),
            ("10:50", "11:35"), ("11:45", "12:30"), ("13:30", "14:15"),
            ("14:25", "15:10"), ("15:25", "16:10"), ("16:20", "17:05"),
            ("17:15", "18:00"), ("18:30", "19:15"), ("19:25", "20:10"),
            ("20:20", "21:05"), ("21:15", "22:00"),
        ].map(|(a, b)| (a.to_string(), b.to_string()));
        let content = r#"{"courses":[
            {"name":"数字逻辑与部件设计","teacher":"王老师","location":"H40301","weekday":1,"start_period":2,"end_period":2,"weeks":"1~16"},
            {"name":"数字逻辑与部件设计","teacher":"王老师","location":"H305/H302","weekday":1,"start_period":4,"end_period":5,"weeks":"1-16"},
            {"name":"数据结构","teacher":"朱老师","location":"H4203","weekday":1,"start_period":6,"end_period":8,"weeks":"1-16"},
            {"name":"数据结构","teacher":"朱老师","location":"H202/H302","weekday":2,"start_period":1,"end_period":2,"weeks":"1-16"},
            {"name":"集合与图论","teacher":"阚老师","location":"H3309","weekday":2,"start_period":4,"end_period":5,"weeks":"1-16"},
            {"name":"集合与图论","teacher":"阚老师","location":"H3309","weekday":4,"start_period":6,"end_period":7,"weeks":"1-16"},
            {"name":"概率论与数理统计","teacher":"刘老师","location":"H2101","weekday":3,"start_period":8,"end_period":10,"weeks":"1-16"},
            {"name":"改变世界的流行病","teacher":"赵老师","location":"H4201","weekday":1,"start_period":11,"end_period":12,"weeks":"1-4,6,10,14-15"},
            {"name":"改变世界的流行病","teacher":"其他教师","location":"H4201","weekday":1,"start_period":11,"end_period":12,"weeks":"7-9,11-13"},
            {"name":"中国近现代史纲要","teacher":"张老师","location":"HGX506","weekday":3,"start_period":11,"end_period":12,"weeks":"1-15"},
            {"name":"中国近现代史纲要","teacher":"张老师","location":"HGX506","weekday":3,"start_period":13,"end_period":13,"weeks":"1-15"},
            {"name":"改革开放史","teacher":"赵老师","location":"H2101","weekday":4,"start_period":11,"end_period":12,"weeks":"1-15"}
        ]}"#;
        let drafts = parse_courses_json(content, &periods).unwrap();
        assert_eq!(drafts.iter().map(|d| d.slots.len()).sum::<usize>(), 12);
        assert_eq!(drafts.len(), 10);
        assert_eq!(drafts.iter().filter(|d| d.name == "数字逻辑与部件设计").count(), 2);
        assert_eq!(drafts.iter().filter(|d| d.name == "改变世界的流行病").count(), 2);
        let history = drafts.iter().find(|d| d.name == "中国近现代史纲要").unwrap();
        assert_eq!(history.slots.len(), 2);
        assert_eq!(history.slots[1].start_time, "20:20");
        assert_eq!(history.slots[1].end_time, "21:05");
        assert_eq!(drafts[0].weeks_mask.as_deref(), Some("1-16"));
    }
}
