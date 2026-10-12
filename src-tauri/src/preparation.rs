//! Durable, quiet preparations. The DB owns permission and generation; files are
//! created only inside a new run directory, and no task/reward is completed here.
use chrono::{DateTime, Datelike, Duration, Local, NaiveDateTime, TimeZone, Utc};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sqlx::{Sqlite, SqlitePool};
use std::{path::{Path, PathBuf}, io::Write};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all="camelCase", deny_unknown_fields)]
pub struct PreparationConfig {
    pub topic: String,
    pub output_root: String,
    #[serde(default)] pub sources: Vec<String>,
    #[serde(default)] pub reading: String,
    #[serde(default)] pub mistakes: String,
    #[serde(default)] pub search: bool,
    #[serde(default="default_limit")] pub reference_limit: u32,
    #[serde(default="default_duration")] pub focus_min: u32,
    #[serde(default="default_sound")] pub sound: String,
    #[serde(default)] pub open_sources: bool,
    #[serde(default)] pub notify: bool,
}
fn default_limit()->u32 { 8 }
fn default_duration()->u32 { 25 }
fn default_sound()->String { "none".into() }

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all="camelCase", deny_unknown_fields)]
pub struct RuleInput {
    pub task_id: String, pub kind: String, pub start_at: String,
    pub lead_min: i64, pub config: PreparationConfig,
}
#[derive(Debug, Clone, Serialize, sqlx::FromRow)]
#[serde(rename_all="camelCase")]
pub struct Rule {
    pub id: String, pub task_id: String, pub kind: String, pub config_json: String,
    pub start_at: String, pub lead_min: i64, pub enabled: bool, pub needs_authorization: bool, pub version: i64,
    pub created_at: String, pub updated_at: String,
}
#[derive(Debug, Clone, Serialize, sqlx::FromRow)]
#[serde(rename_all="camelCase")]
pub struct Run {
    pub id: String, pub rule_id: String, pub task_id: String, pub version: i64,
    pub action_at: String, pub due_at: String, pub state: String, pub attempt: i64,
    pub lease_until: Option<String>, pub retry_at: Option<String>,
    pub output_dir: Option<String>, pub result_json: Option<String>, pub error: Option<String>,
    #[serde(skip_serializing)] pub product_json: Option<String>,
    pub created_at: String, pub updated_at: String,
}
fn iso(now: DateTime<Utc>)->String { now.to_rfc3339_opts(chrono::SecondsFormat::Millis,true) }
fn time(value: &str)->Result<DateTime<Utc>,String> {
    if let Ok(d)=DateTime::parse_from_rfc3339(value) { return Ok(d.with_timezone(&Utc)); }
    for format in ["%Y-%m-%dT%H:%M", "%Y-%m-%dT%H:%M:%S"] {
        if let Ok(d)=NaiveDateTime::parse_from_str(value,format) {
            return Local.from_local_datetime(&d).single().map(|d|d.with_timezone(&Utc))
                .ok_or_else(||"这个时间处于时区切换，请选择明确的时间".into());
        }
    }
    Err("请填写带时间的行动安排".into())
}
fn config(rule:&Rule)->Result<PreparationConfig,String> { serde_json::from_str(&rule.config_json).map_err(|e|e.to_string()) }
fn source_path(value:&str)->Result<PathBuf,String> {
    let path=Path::new(value);
    if !path.is_absolute() { return Err("资料与保存目录请使用完整路径".into()); }
    std::fs::canonicalize(path).map_err(|_|format!("找不到或无法访问：{value}"))
}
fn web_source(value:&str)->bool {
    reqwest::Url::parse(value).ok().is_some_and(|u| matches!(u.scheme(),"https"|"http") && u.host_str().is_some() && u.username().is_empty() && u.password().is_none())
}
fn validate(input:&RuleInput)->Result<(),String> {
    if !matches!(input.kind.as_str(),"writing"|"study"|"focus") {return Err("未知准备模板".into());}
    time(&input.start_at)?;
    if !(0..=10080).contains(&input.lead_min) {return Err("提前时间须在 0–10080 分钟之间".into());}
    let c=&input.config;
    if c.topic.trim().is_empty() || c.topic.chars().count()>400 {return Err("请填写 1–400 字的主题或目标".into());}
    if !(1..=20).contains(&c.reference_limit) || !(1..=180).contains(&c.focus_min) {return Err("资料数量须为 1–20，专注时长须为 1–180 分钟".into());}
    if !matches!(c.sound.as_str(),"none"|"rain"|"brown") {return Err("请选择支持的环境声".into());}
    if c.sources.len()>20 || c.reading.len()>8000 || c.mistakes.len()>16000 {return Err("准备范围过大，请减少资料或文本".into());}
    if !source_path(&c.output_root)?.is_dir() {return Err("请选一个已有的保存目录；准备会在其中新建独立目录".into());}
    if input.kind=="study" && c.sources.is_empty() {return Err("请先指定教材或材料来源".into());}
    for s in &c.sources {
        if s.len()>2000 {return Err("资料地址过长".into());}
        if !web_source(s) && !source_path(s)?.is_file() {return Err("资料必须是可访问的文件或网页链接".into());}
    }
    Ok(())
}

pub(crate) async fn save_tx(tx:&mut sqlx::Transaction<'_,Sqlite>,input:RuleInput)->Result<Rule,String> {
    validate(&input)?;
    let task=crate::task_engine::fetch_task(&mut **tx,&input.task_id).await?;
    if matches!(task.status.as_str(),"done"|"shelved") {return Err("请先恢复这项目标，再授权准备".into());}
    let previous:Option<Rule>=sqlx::query_as("SELECT * FROM preparation_rules WHERE task_id=? AND kind=?").bind(&input.task_id).bind(&input.kind).fetch_optional(&mut **tx).await.map_err(|e|e.to_string())?;
    if previous.is_none() {
        let count:i64=sqlx::query_scalar("SELECT COUNT(*) FROM preparation_rules").fetch_one(&mut **tx).await.map_err(|e|e.to_string())?;
        if count>=100 {return Err("当前最多建立 100 条准备约定，请先整理现有约定".into());}
    }
    let id=previous.as_ref().map(|r|r.id.clone()).unwrap_or_else(||uuid::Uuid::new_v4().to_string());
    let now=iso(Utc::now());
    invalidate_tx(tx,&id,"准备要求已修改，旧结果保留").await?;
    // Store the local offset too, so daily/weekly schedules retain wall-clock time.
    let start=time(&input.start_at)?.with_timezone(&Local).to_rfc3339();
    sqlx::query("INSERT INTO preparation_rules(id,task_id,kind,config_json,start_at,lead_min,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?) ON CONFLICT(task_id,kind) DO UPDATE SET config_json=excluded.config_json,start_at=excluded.start_at,lead_min=excluded.lead_min,enabled=1,needs_authorization=0,version=preparation_rules.version+1,updated_at=excluded.updated_at")
        .bind(&id).bind(&input.task_id).bind(&input.kind).bind(serde_json::to_string(&input.config).map_err(|e|e.to_string())?).bind(start).bind(input.lead_min).bind(&now).bind(&now)
        .execute(&mut **tx).await.map_err(|e|e.to_string())?;
    sqlx::query_as("SELECT * FROM preparation_rules WHERE id=?").bind(id).fetch_one(&mut **tx).await.map_err(|e|e.to_string())
}
async fn invalidate_tx(tx:&mut sqlx::Transaction<'_,Sqlite>,id:&str,reason:&str)->Result<(),String> {
    sqlx::query("UPDATE preparation_runs SET state=CASE WHEN state='ready' THEN 'stale' ELSE 'cancelled' END,error=?,updated_at=? WHERE rule_id=? AND state IN('queued','running','ready','failed')")
        .bind(reason).bind(iso(Utc::now())).bind(id).execute(&mut **tx).await.map_err(|e|e.to_string())?;
    Ok(())
}
pub(crate) async fn pause_tx(tx:&mut sqlx::Transaction<'_,Sqlite>,id:&str,paused:bool)->Result<Value,String> {
    let exists:bool=sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM preparation_rules WHERE id=?)").bind(id).fetch_one(&mut **tx).await.map_err(|e|e.to_string())?;
    if !exists {return Err("准备约定不存在".into());}
    if !paused {
        let needs:bool=sqlx::query_scalar("SELECT needs_authorization FROM preparation_rules WHERE id=?").bind(id).fetch_one(&mut **tx).await.map_err(|e|e.to_string())?;
        if needs {return Err("从备份恢复的文件范围需要在原任务中重新授权".into());}
    }
    // Pausing keeps ready artifacts usable. Resuming gets a fresh generation;
    // cancelled in-flight results cannot accidentally be adopted after resume.
    sqlx::query("UPDATE preparation_rules SET enabled=?,version=version+?,updated_at=? WHERE id=?")
        .bind(!paused).bind(if paused {0}else{1}).bind(iso(Utc::now())).bind(id).execute(&mut **tx).await.map_err(|e|e.to_string())?;
    sqlx::query("UPDATE preparation_runs SET state='cancelled',error='准备已暂停',updated_at=? WHERE rule_id=? AND state IN('queued','running','failed')")
        .bind(iso(Utc::now())).bind(id).execute(&mut **tx).await.map_err(|e|e.to_string())?;
    if !paused {
        sqlx::query("UPDATE preparation_runs SET state='stale',error='准备已恢复，新结果将另存' WHERE rule_id=? AND state='ready'").bind(id).execute(&mut **tx).await.map_err(|e|e.to_string())?;
    }
    Ok(json!({"ruleId":id,"paused":paused}))
}
pub(crate) async fn list_db(pool:&SqlitePool,task_id:Option<&str>)->Result<Value,String> {
    let rules:Vec<Rule>=sqlx::query_as("SELECT * FROM preparation_rules WHERE (? IS NULL OR task_id=?) ORDER BY created_at DESC")
        .bind(task_id).bind(task_id).fetch_all(pool).await.map_err(|e|e.to_string())?;
    let mut runs:Vec<Run>=sqlx::query_as("SELECT * FROM preparation_runs WHERE (? IS NULL OR task_id=?) ORDER BY created_at DESC,rowid DESC LIMIT 100")
        .bind(task_id).bind(task_id).fetch_all(pool).await.map_err(|e|e.to_string())?;
    for r in &mut runs {
        if r.state=="ready" && !artifacts_exist(r) {
            r.state="failed".into();r.error=Some("产物已移走或不可访问，可重试重新准备".into());
        }
    }
    let paused:Option<String>=sqlx::query_scalar("SELECT value FROM settings WHERE key='preparation_paused'").fetch_optional(pool).await.map_err(|e|e.to_string())?;
    Ok(json!({"rules":rules,"runs":runs,"paused":paused.as_deref()==Some("true"),"runtime":"local","boundary":"主程序进程或托盘运行时准备；完全退出或设备休眠时停止，恢复后补做仍有效的安排。宠物关闭不影响准备。"}))
}
async fn event(tx:&mut sqlx::Transaction<'_,Sqlite>,run:&str,state:&str,detail:&str)->Result<(),String> {
    sqlx::query("INSERT INTO preparation_events(run_id,at,state,detail)VALUES(?,?,?,?)").bind(run).bind(iso(Utc::now())).bind(state).bind(detail)
        .execute(&mut **tx).await.map_err(|e|e.to_string())?;Ok(())
}
fn occurrence(rule:&Rule,task:&crate::models::Task,now:DateTime<Utc>)->Result<Option<DateTime<Utc>>,String> {
    let anchor=time(&rule.start_at)?.with_timezone(&Local);
    if task.recurrence=="none" {return Ok(Some(anchor.with_timezone(&Utc)));}
    // Start with today's occurrence even when overdue so it gets a visible
    // skipped record; never replay earlier missed days.
    let today=now.with_timezone(&Local).date_naive().max(anchor.date_naive());
    for n in 0..8 {
        let day=today+Duration::days(n);
        if task.recurrence=="weekly" && !task.recur_days.as_deref().unwrap_or("").split(',').any(|d|d.trim().parse::<u32>().ok()==Some(day.weekday().number_from_monday())) {continue;}
        let Some(at)=Local.from_local_datetime(&day.and_time(anchor.time())).single() else {continue;};
        if task.last_done_date.as_deref()==Some(day.to_string().as_str()) && n==0 {continue;}
        return Ok(Some(at.with_timezone(&Utc)));
    }
    Ok(None)
}
pub(crate) async fn reconcile(pool:&SqlitePool,now:DateTime<Utc>)->Result<(),String> {
    let mut tx=crate::gamification::begin_write(pool).await?;
    let paused:Option<String>=sqlx::query_scalar("SELECT value FROM settings WHERE key='preparation_paused'").fetch_optional(&mut *tx).await.map_err(|e|e.to_string())?;
    if paused.as_deref()==Some("true") {return Ok(());}
    let rules:Vec<Rule>=sqlx::query_as("SELECT * FROM preparation_rules WHERE enabled=1").fetch_all(&mut *tx).await.map_err(|e|e.to_string())?;
    for rule in rules {
        let task=crate::task_engine::fetch_task(&mut *tx,&rule.task_id).await?;
        if matches!(task.status.as_str(),"done"|"shelved") {continue;}
        let Some(at)=occurrence(&rule,&task,now)? else {continue;};
        let state=if at+Duration::hours(2)<now {"skipped"}else{"queued"};
        let id=uuid::Uuid::new_v4().to_string();
        let changed=sqlx::query("INSERT OR IGNORE INTO preparation_runs(id,rule_id,task_id,version,action_at,due_at,state,created_at,updated_at,error) VALUES(?,?,?,?,?,?,?,?,?,?)")
            .bind(&id).bind(&rule.id).bind(&rule.task_id).bind(rule.version).bind(iso(at)).bind(iso(at-Duration::minutes(rule.lead_min))).bind(state).bind(iso(now)).bind(iso(now))
            .bind(if state=="skipped" {Some("错过行动时间，已跳过；可修改安排后重新准备")}else{None})
            .execute(&mut *tx).await.map_err(|e|e.to_string())?.rows_affected();
        if changed>0 {event(&mut tx,&id,state,"按准备约定建立本次执行").await?;}
    }
    // Lease recovery does not manufacture success, and retries reuse the run id.
    sqlx::query("UPDATE preparation_runs SET state='failed',error='运行中断，等待重试',lease_until=NULL,retry_at=?,updated_at=? WHERE state='running' AND lease_until<?")
        .bind(iso(now)).bind(iso(now)).bind(iso(now)).execute(&mut *tx).await.map_err(|e|e.to_string())?;
    sqlx::query("UPDATE preparation_runs SET state='skipped',error='已错过行动窗口',updated_at=? WHERE state IN('queued','failed') AND julianday(action_at)<julianday(?,'-2 hours')")
        .bind(iso(now)).bind(iso(now)).execute(&mut *tx).await.map_err(|e|e.to_string())?;
    tx.commit().await.map_err(|e|e.to_string())
}
async fn claim(pool:&SqlitePool,now:DateTime<Utc>)->Result<Option<(Run,Rule)>,String> {
    let mut tx=crate::gamification::begin_write(pool).await?;
    let run:Option<Run>=sqlx::query_as("SELECT r.* FROM preparation_runs r JOIN preparation_rules p ON p.id=r.rule_id JOIN tasks t ON t.id=p.task_id WHERE p.enabled=1 AND p.version=r.version AND t.status NOT IN('done','shelved') AND (r.state='queued' OR (r.state='failed' AND r.attempt<3 AND r.retry_at<=?)) AND r.due_at<=? AND NOT EXISTS(SELECT 1 FROM settings WHERE key='preparation_paused' AND value='true') AND (SELECT COUNT(*) FROM preparation_runs WHERE state='running')<2 ORDER BY r.due_at LIMIT 1")
        .bind(iso(now)).bind(iso(now)).fetch_optional(&mut *tx).await.map_err(|e|e.to_string())?;
    let Some(mut run)=run else {return Ok(None);};
    let rule:Rule=sqlx::query_as("SELECT * FROM preparation_rules WHERE id=?").bind(&run.rule_id).fetch_one(&mut *tx).await.map_err(|e|e.to_string())?;
    sqlx::query("UPDATE preparation_runs SET state='running',attempt=attempt+1,lease_until=?,updated_at=?,error=NULL WHERE id=?")
        .bind(iso(now+Duration::seconds(90))).bind(iso(now)).bind(&run.id).execute(&mut *tx).await.map_err(|e|e.to_string())?;
    event(&mut tx,&run.id,"running","后台准备开始").await?;
    run.attempt+=1;run.state="running".into();
    tx.commit().await.map_err(|e|e.to_string())?;Ok(Some((run,rule)))
}
async fn current(pool:&SqlitePool,run:&Run)->Result<bool,String> {
    sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM preparation_runs r JOIN preparation_rules p ON p.id=r.rule_id WHERE r.id=? AND r.attempt=? AND r.state='running' AND r.version=p.version AND p.enabled=1 AND NOT EXISTS(SELECT 1 FROM settings WHERE key='preparation_paused' AND value='true'))")
        .bind(&run.id).bind(run.attempt).fetch_one(pool).await.map_err(|e|e.to_string())
}
#[derive(Debug,Serialize,Deserialize)]
struct Product { files: Vec<(String,String)>, summary: String, sources: Value }
fn plain(s:&str)->String {s.replace(['\r','\n','\t']," ").replace(['[',']','<','>']," ")}
async fn reference_index(c:&PreparationConfig)->Result<(String,Value),String> {
    if !c.search {return Ok(("联网检索未授权。请把已有参考文献放入资料分区，或在准备要求中开启候选文献检索。\n".into(),json!([])));}
    let client=reqwest::Client::builder().timeout(std::time::Duration::from_secs(20)).user_agent("Xmission/0.67 preparation (Crossref metadata)").build().map_err(|e|e.to_string())?;
    let response=client.get("https://api.crossref.org/works").query(&[("query",c.topic.as_str()),("rows",&c.reference_limit.to_string()),("select","DOI,title,author,issued,URL")])
        .send().await.map_err(|_|"文献检索暂时无法连接，尚未完成准备".to_string())?.error_for_status().map_err(|e|format!("文献服务不可用：{}",e.status().map(|s|s.as_u16()).unwrap_or(0)))?;
    if response.content_length().is_some_and(|n|n>2_000_000) {return Err("检索结果过大".into());}
    let bytes=response.bytes().await.map_err(|e|e.to_string())?;
    if bytes.len()>2_000_000 {return Err("检索结果过大".into());}
    let data:Value=serde_json::from_slice(&bytes).map_err(|_|"文献服务返回格式无效".to_string())?;
    let items=data["message"]["items"].as_array().ok_or("文献服务没有返回候选清单")?;
    let mut records=Vec::new();
    let mut text=String::from("# 候选参考索引\n\n来源：Crossref 元数据；按主题相关度检索。尚未阅读全文，也未验证论点。请人工筛选；摘要与元数据不等于全文。\n\n");
    for item in items.iter().take(c.reference_limit as usize) {
        let title=item["title"][0].as_str().unwrap_or("无标题");
        let doi=item["DOI"].as_str().unwrap_or("");
        if doi.is_empty() {continue;}
        let mut url=reqwest::Url::parse("https://doi.org/").unwrap();url.set_path(doi);
        let authors=item["author"].as_array().map(|a|a.iter().take(8).map(|p|format!("{} {}",p["given"].as_str().unwrap_or(""),p["family"].as_str().unwrap_or(""))).filter(|s|!s.trim().is_empty()).collect::<Vec<_>>().join(", ")).filter(|s|!s.trim().is_empty()).unwrap_or_else(||"作者信息未提供".into());
        let year=item["issued"]["date-parts"][0][0].as_i64();
        text.push_str(&format!("- [{}]({}) — {}，{}\n  - DOI：{}；与主题的关系：检索匹配「{}」，待人工确认。可用范围：元数据，全文获取与许可待检查。\n",plain(title),url,plain(&authors),year.map(|y|y.to_string()).unwrap_or("年份未知".into()),plain(doi),plain(&c.topic)));
        records.push(json!({"title":title,"authors":authors,"year":year,"doi":doi,"url":url.as_str(),"access":"metadata","source":"Crossref","retrievedAt":iso(Utc::now())}));
    }
    if records.is_empty() {text.push_str("未找到候选结果。请调整检索主题；没有虚构参考文献。\n");}
    Ok((text,Value::Array(records)))
}
async fn produce(pool:&SqlitePool,rule:&Rule,run:&Run)->Result<Product,String> {
    if let Some(snapshot)=&run.product_json {return serde_json::from_str(snapshot).map_err(|e|e.to_string());}
    let c=config(rule)?;
    let task=crate::task_engine::fetch_task(pool,&run.task_id).await?;
    let mut sources=Vec::new();let mut excerpts=Vec::new();
    let source_client=reqwest::Client::builder().timeout(std::time::Duration::from_secs(5)).redirect(reqwest::redirect::Policy::limited(3)).build().map_err(|e|e.to_string())?;
    for value in &c.sources {
        if web_source(value) {
            let response=source_client.head(value).send().await.map_err(|_|format!("资料链接暂时无法访问：{value}"))?;
            if !response.status().is_success() {return Err(format!("资料链接返回 HTTP {}，可能需要登录或已失效：{value}",response.status().as_u16()));}
            sources.push(json!({"location":value,"access":"link-only","checkedAt":iso(Utc::now()),"note":"已检查链接响应，仅保存入口，尚未读取网页或全文"}));continue;
        }
        let path=source_path(value)?;
        let metadata=std::fs::metadata(&path).map_err(|e|e.to_string())?;
        sources.push(json!({"location":value,"bytes":metadata.len(),"modified":metadata.modified().ok().and_then(|t|t.duration_since(std::time::UNIX_EPOCH).ok()).map(|t|t.as_secs()),"access":"local"}));
        if rule.kind=="study" && matches!(path.extension().and_then(|e|e.to_str()).map(str::to_ascii_lowercase).as_deref(),Some("txt"|"md")) {
            if metadata.len()>2_000_000 {return Err("文本教材超过 2 MB，请指定较小的章节文件".into());}
            let text=tokio::fs::read_to_string(&path).await.map_err(|_|"文本教材须为 UTF-8；其他格式可作为资料入口使用".to_string())?;
            excerpts.extend(text.lines().map(str::trim).filter(|s|s.chars().count()>=16 && s.chars().count()<=300 && !s.starts_with('#')).take(3).map(str::to_owned));
        }
    }
    let source_text=c.sources.iter().map(|s|format!("- {}",plain(s))).collect::<Vec<_>>().join("\n");
    let title=plain(&c.topic);
    let mut files=Vec::new();
    let feedback=task.notes.as_deref().unwrap_or("").chars().take(16000).collect::<String>();
    files.push(("goal-context.txt".into(),format!("关联目标：{}\n目标版本：{}\n上次实际完成：{}\n\n原任务反馈（原格式文本快照，最多 16000 字）：\n{}\n",task.title,run.version,task.last_done_date.as_deref().or(task.completed_at.as_deref()).unwrap_or("尚无完成记录"),feedback)));
    let summary=match rule.kind.as_str() {
        "writing"=>{
            let (index,references)=reference_index(&c).await?;
            files.push(("references/index.md".into(),index));files.push(("references/candidates.json".into(),serde_json::to_string_pretty(&references).map_err(|e|e.to_string())?));
            sources.extend(references.as_array().cloned().unwrap_or_default());
            files.push(("notes/questions.md".into(),format!("# 待解决问题\n\n主题：{title}\n\n- 想回答的核心问题是什么？\n- 哪些候选资料真正支持这一问题？\n- 还缺哪些证据？\n")));
            files.push(("drafts/README.md".into(),"此处留给你写作。助理的准备不会生成或覆盖你的正文。\n".into()));
            files.push(("materials/README.md".into(),format!("# 已有材料\n\n{source_text}\n\n文件保留在原位置；本次只建立入口，未下载或宣称阅读全文。\n")));
            "写作目录与候选参考索引已备好"
        },
        "study"=>{
            let mut exercises=String::from("# 今天的练习\n\n");
            if excerpts.is_empty() {
                exercises.push_str("本次仅能检查资料入口，没有读取教材正文。以下为自查练习，请用指定教材核对。\n\n1. 不看教材，写出今天范围内的三个概念。\n2. 选一个概念，用自己的话解释，再回到原页逐句核对。\n3. 重做一项已有错题，记录差异及教材依据。\n\n完成判断：每个回答都有原页依据，错误已改正；不能自动判为正确。\n");
            } else {
                exercises.push_str("以下仅摘取你指定的 UTF-8 文本，用原句自行核对；没有推测教材内容。\n\n");
                for (i,line) in excerpts.iter().take(3).enumerate() {
                    let chars:Vec<char>=line.chars().collect();let end=chars.len().min(8);
                    exercises.push_str(&format!("{}. 补全原句开头：____{}\n   核对答案：{}\n\n",i+1,chars[end..].iter().collect::<String>(),chars[..end].iter().collect::<String>()));
                }
            }
            files.push(("exercises.md".into(),exercises));
            files.push(("mistakes.md".into(),format!("# 已有错题\n\n{}\n\n完成后把新的反馈填写回准备要求，下一次会使用最新版本。\n",if c.mistakes.trim().is_empty(){"还没有指定错题"}else{&c.mistakes})));
            files.push(("reading.md".into(),format!("# 今日学习范围\n\n目标：{title}\n\n页码 / 章节：{}\n\n上次实际完成：{}。本次先回顾已有错题，再阅读指定范围；章节推进由你确认。原任务的新反馈保存在 goal-context.txt。\n\n{source_text}\n\n资料版本见 manifest.json。PDF 与网页仅保留入口，练习不会假装基于未读全文。\n",if c.reading.trim().is_empty(){"尚未指定，请从选择的教材确认"}else{&c.reading},task.last_done_date.as_deref().or(task.completed_at.as_deref()).unwrap_or("尚无完成记录"))));
            "今天的材料、错题与自查练习已备好"
        },
        "focus"=>{
            files.push(("focus.json".into(),json!({"durationMin":c.focus_min,"sound":c.sound,"sources":c.sources,"openOnStart":c.open_sources,"activation":"user-start-only","end":"stop-only-session-owned-sound"}).to_string()));
            "专注偏好与本地资料入口已检查"
        },_=>return Err("未知模板".into()),
    }.to_string();
    files.push(("START-HERE.md".into(),format!("# 从这里开始\n\n{title}\n\n{summary}。\n\n行动时间：{}\n准备版本：{}；执行编号：{}\n\n1. 打开资料或参考索引，选择第一份材料。\n2. 明确一个待解决问题，开始你的行动。\n3. 在原任务更新要求、记录反馈或暂停准备。\n\n已有材料：\n{source_text}\n\n人的目标仍需你完成；准备不会结算任务奖励。\n",run.action_at,run.version,run.id)));
    Ok(Product{files,summary,sources:Value::Array(sources)})
}
fn run_directory(c:&PreparationConfig,run:&Run)->Result<PathBuf,String> {
    // UUID names stay stable across retries; never derive paths from a title.
    uuid::Uuid::parse_str(&run.id).map_err(|_|"执行编号无效".to_string())?;
    let root=source_path(&c.output_root)?;
    let path=root.join(format!("Xmission-preparation-{}",run.id));
    if path.exists() {
        let meta=std::fs::symlink_metadata(&path).map_err(|e|e.to_string())?;
        if meta.file_type().is_symlink() || std::fs::canonicalize(&path).map_err(|e|e.to_string())?!=path {return Err("准备目录指向其他位置，已停止写入".into());}
        if std::fs::read_to_string(path.join(".xmission-run")).ok().as_deref()!=Some(run.id.as_str()) {return Err("准备目录已存在且不属于本次执行，未覆盖".into());}
    } else {
        std::fs::create_dir(&path).map_err(|e|e.to_string())?;
        new_file(&path.join(".xmission-run"),run.id.as_bytes())?;
    }
    Ok(path)
}
fn new_file(path:&Path,bytes:&[u8])->Result<(),String> {
    let mut file=std::fs::OpenOptions::new().create_new(true).write(true).open(path).map_err(|e|e.to_string())?;
    if let Err(e)=file.write_all(bytes).and_then(|()|file.sync_all()) {
        drop(file);let _=std::fs::remove_file(path);return Err(e.to_string());
    }
    Ok(())
}
fn write_product(c:&PreparationConfig,run:&Run,product:&Product)->Result<(PathBuf,Value),String> {
    let dir=run_directory(c,run)?;
    let mut artifacts=Vec::new();
    for (name,body) in &product.files {
        let relative=Path::new(name);
        if relative.is_absolute() || relative.components().any(|c| !matches!(c,std::path::Component::Normal(_))) {return Err("产物路径无效".into());}
        let path=dir.join(relative);
        let parent=path.parent().ok_or("产物目录无效")?;
        std::fs::create_dir_all(parent).map_err(|e|e.to_string())?;
        if !std::fs::canonicalize(parent).map_err(|e|e.to_string())?.starts_with(&dir) {return Err("产物目录越界，已停止写入".into());}
        if path.exists() {
            if std::fs::symlink_metadata(&path).map_err(|e|e.to_string())?.file_type().is_symlink() {return Err("产物指向其他位置".into());}
            // A completed file from a previous attempt is kept exactly as-is.
            // Changed or user-edited files are never silently overwritten.
            if std::fs::read(&path).map_err(|e|e.to_string())?!=body.as_bytes() {return Err(format!("{name} 已存在且内容不同，未覆盖；请调整要求建立新版本"));}
        } else {new_file(&path,body.as_bytes())?;}
        artifacts.push(json!({"name":name,"path":path.to_string_lossy(),"bytes":body.len()}));
    }
    let result=json!({"summary":product.summary,"artifacts":artifacts,"sources":product.sources,"version":run.version,"runId":run.id,"scope":"仅在独立新目录写准备文件；不覆盖原稿、不完成人的目标"});
    let manifest=dir.join("manifest.json");
    if !manifest.exists() {new_file(&manifest,serde_json::to_vec_pretty(&result).map_err(|e|e.to_string())?.as_slice())?;}
    Ok((dir,result))
}
fn artifacts_exist(run:&Run)->bool {
    let Some(dir)=run.output_dir.as_ref().and_then(|d|std::fs::canonicalize(d).ok()) else{return false;};
    if run.output_dir.as_ref().is_none_or(|d|Path::new(d)!=dir) {return false;}
    let Some(result)=run.result_json.as_ref().and_then(|s|serde_json::from_str::<Value>(s).ok()) else{return false;};
    result["artifacts"].as_array().is_some_and(|items| !items.is_empty() && items.iter().all(|a|a["path"].as_str().is_some_and(|p|std::fs::canonicalize(p).ok().is_some_and(|p|p.starts_with(&dir)&&p.is_file()))))
}
pub(crate) async fn artifact_path(pool:&SqlitePool,id:&str,name:Option<&str>)->Result<PathBuf,String> {
    let run:Run=sqlx::query_as("SELECT * FROM preparation_runs WHERE id=?").bind(id).fetch_optional(pool).await.map_err(|e|e.to_string())?.ok_or("找不到准备结果")?;
    let saved=run.output_dir.as_deref().ok_or("尚无产物")?;let dir=source_path(saved)?;
    if dir!=Path::new(saved) {return Err("准备目录已移动或指向其他位置，未打开".into());}
    if let Some(name)=name {
        let result:Value=serde_json::from_str(run.result_json.as_deref().ok_or("尚无产物")?).map_err(|e|e.to_string())?;
        let item=result["artifacts"].as_array().and_then(|a|a.iter().find(|a|a["name"]==name)).ok_or("产物未登记")?;
        let path=source_path(item["path"].as_str().ok_or("产物路径无效")?)?;
        if !path.starts_with(&dir) {return Err("产物已移到授权目录之外".into());}Ok(path)
    }else{Ok(dir)}
}
pub(crate) async fn read_artifact(pool:&SqlitePool,id:&str,name:&str)->Result<String,String> {
    use std::io::Read;
    let path=artifact_path(pool,id,Some(name)).await?;
    if !matches!(path.extension().and_then(|e|e.to_str()),Some("md"|"txt"|"json")) {return Err("这种产物请通过项目目录打开".into());}
    let mut bytes=Vec::new();std::fs::File::open(path).map_err(|e|e.to_string())?.take(1_000_001).read_to_end(&mut bytes).map_err(|e|e.to_string())?;
    if bytes.len()>1_000_000 {return Err("资料超过 1 MB，请通过项目目录打开".into());}
    String::from_utf8(bytes).map_err(|_|"资料不是可显示的 UTF-8 文本".into())
}
async fn owns_run_tx(tx:&mut sqlx::Transaction<'_,Sqlite>,run:&Run)->Result<bool,String> {
    sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM preparation_runs r JOIN preparation_rules p ON p.id=r.rule_id WHERE r.id=? AND r.attempt=? AND r.state='running' AND p.enabled=1 AND p.version=r.version AND NOT EXISTS(SELECT 1 FROM settings WHERE key='preparation_paused' AND value='true'))")
        .bind(&run.id).bind(run.attempt).fetch_one(&mut **tx).await.map_err(|e|e.to_string())
}
async fn finish(pool:&SqlitePool,run:&Run,rule:&Rule,product:Result<Product,String>)->Result<bool,String> {
    let mut tx=crate::gamification::begin_write(pool).await?;
    let allowed=owns_run_tx(&mut tx,run).await?;
    if !allowed {return Ok(false);}
    // Commit files while holding the same write lock as task edits. Cancel and
    // goal-version changes either precede all writes or follow the result.
    // Freeze the generated payload before writing files. An interrupted write
    // or a retry after a file was moved reuses the exact same contents/sources.
    if let Ok(p)=&product {
        sqlx::query("UPDATE preparation_runs SET product_json=? WHERE id=? AND product_json IS NULL")
            .bind(serde_json::to_string(p).map_err(|e|e.to_string())?).bind(&run.id).execute(&mut *tx).await.map_err(|e|e.to_string())?;
        // Make the snapshot durable BEFORE filesystem writes. A killed worker
        // can retry the same payload even if only some files reached disk.
        tx.commit().await.map_err(|e|e.to_string())?;
        tx=crate::gamification::begin_write(pool).await?;
        if !owns_run_tx(&mut tx,run).await? {return Ok(false);}
    }
    let result=product.and_then(|p|write_product(&config(rule)?,run,&p));
    let now=Utc::now();
    let ready=match result {
        Ok((dir,result))=>{
            sqlx::query("UPDATE preparation_runs SET state='ready',output_dir=?,result_json=?,error=NULL,lease_until=NULL,retry_at=NULL,updated_at=? WHERE id=?")
                .bind(dir.to_string_lossy().as_ref()).bind(result.to_string()).bind(iso(now)).bind(&run.id).execute(&mut *tx).await.map_err(|e|e.to_string())?;
            event(&mut tx,&run.id,"ready","产物已创建并检查；人的目标未标记完成").await?;true
        },
        Err(error)=>{
            sqlx::query("UPDATE preparation_runs SET state='failed',error=?,lease_until=NULL,retry_at=?,updated_at=? WHERE id=?")
                .bind(&error).bind(iso(now+Duration::minutes(run.attempt*2))).bind(iso(now)).bind(&run.id).execute(&mut *tx).await.map_err(|e|e.to_string())?;
            event(&mut tx,&run.id,"failed",&error).await?;false
        }
    };
    tx.commit().await.map_err(|e|e.to_string())?;Ok(ready)
}
pub(crate) async fn tick(pool:&SqlitePool)->Result<Option<(String,bool,bool)>,String> {
    reconcile(pool,Utc::now()).await?;
    let Some((run,rule))=claim(pool,Utc::now()).await? else{return Ok(None);};
    let mut generation=Box::pin(tokio::time::timeout(std::time::Duration::from_secs(45),produce(pool,&rule,&run)));
    let result=loop {
        tokio::select! {
            value=&mut generation=>break value.unwrap_or_else(|_|Err("准备超时，未宣称完成".into())),
            _=tokio::time::sleep(std::time::Duration::from_secs(1))=>{
                if !current(pool,&run).await? {return Ok(Some((run.task_id.clone(),false,false)));}
            }
        }
    };
    let ready=finish(pool,&run,&rule,result).await?;
    Ok(Some((run.task_id.clone(),ready,config(&rule)?.notify)))
}

pub(crate) async fn retry_tx(tx:&mut sqlx::Transaction<'_,Sqlite>,id:&str)->Result<Value,String> {
    let run:Run=sqlx::query_as("SELECT * FROM preparation_runs WHERE id=?").bind(id).fetch_optional(&mut **tx).await.map_err(|e|e.to_string())?.ok_or("找不到执行记录")?;
    if run.state!="failed" && !(run.state=="ready"&&!artifacts_exist(&run)) {return Err("仅失败或产物丢失的当前执行可以重试；旧版本请更新要求".into());}
    let valid:bool=sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM preparation_rules WHERE id=? AND version=? AND enabled=1)").bind(&run.rule_id).bind(run.version).fetch_one(&mut **tx).await.map_err(|e|e.to_string())?;
    if !valid {return Err("约定已暂停或变化，不能重试旧安排".into());}
    if time(&run.action_at)?+Duration::hours(2)<Utc::now() {return Err("已错过行动窗口，请修改行动时间".into());}
    sqlx::query("UPDATE preparation_runs SET state='queued',attempt=0,due_at=?,error=NULL,updated_at=? WHERE id=?").bind(iso(Utc::now())).bind(iso(Utc::now())).bind(id).execute(&mut **tx).await.map_err(|e|e.to_string())?;
    event(tx,id,"queued","用户请求重试，沿用同一执行编号").await?;
    Ok(json!({"runId":id,"state":"queued"}))
}

#[cfg(not(test))]
pub fn start_service(app:tauri::AppHandle,pool:SqlitePool) {
    if !crate::features::PREPARATION_AUTOMATION { return; }
    use tauri::Emitter;
    tauri::async_runtime::spawn(async move {
        loop {
            match tick(&pool).await {
                Ok(Some((task,ready,notify)))=>{
                    let _=app.emit("preparations-changed",json!({"taskId":task}));
                    if ready && notify {let _=app.emit("preparation-notice",json!({"taskId":task,"text":"资料已备好"}));}
                },Err(e)=>eprintln!("[preparation] {e}"),_=>{}
            }
            tokio::time::sleep(std::time::Duration::from_secs(3)).await;
        }
    });
}

#[cfg(not(test))]
mod desktop {
    use super::*;
    use tauri::{State,Emitter};
    #[tauri::command]
    pub async fn open_preparation_task(app:tauri::AppHandle,pool:State<'_,SqlitePool>,task_id:String)->Result<(),String> {
        crate::task_engine::fetch_task(pool.inner(),&task_id).await?;
        let _=app.emit("main:navigate",json!({"page":"tasks","taskId":task_id}));
        crate::startup::show_main_window(&app);Ok(())
    }
    #[tauri::command]
    pub async fn save_preparation(app:tauri::AppHandle,pool:State<'_,SqlitePool>,input:RuleInput)->Result<Rule,String> {
        let mut tx=crate::gamification::begin_write(pool.inner()).await?;
        let rule=save_tx(&mut tx,input).await?;tx.commit().await.map_err(|e|e.to_string())?;
        let _=app.emit("preparations-changed",());Ok(rule)
    }
    #[tauri::command]
    pub async fn list_preparations(pool:State<'_,SqlitePool>,task_id:Option<String>)->Result<Value,String> {list_db(pool.inner(),task_id.as_deref()).await}
    #[tauri::command]
    pub async fn pause_preparation(app:tauri::AppHandle,pool:State<'_,SqlitePool>,id:String,paused:bool)->Result<Value,String> {
        let mut tx=crate::gamification::begin_write(pool.inner()).await?;let value=pause_tx(&mut tx,&id,paused).await?;tx.commit().await.map_err(|e|e.to_string())?;
        let _=app.emit("preparations-changed",());Ok(value)
    }
    #[tauri::command]
    pub async fn revoke_preparation(app:tauri::AppHandle,pool:State<'_,SqlitePool>,id:String)->Result<(),String> {
        let mut tx=crate::gamification::begin_write(pool.inner()).await?;
        invalidate_tx(&mut tx,&id,"准备授权已撤销，历史产物保留").await?;
        sqlx::query("UPDATE preparation_rules SET enabled=0,needs_authorization=1,updated_at=? WHERE id=?").bind(iso(Utc::now())).bind(id).execute(&mut *tx).await.map_err(|e|e.to_string())?;
        tx.commit().await.map_err(|e|e.to_string())?;let _=app.emit("preparations-changed",());Ok(())
    }
    #[tauri::command]
    pub async fn pause_all_preparations(app:tauri::AppHandle,pool:State<'_,SqlitePool>,paused:bool)->Result<(),String> {
        let mut tx=crate::gamification::begin_write(pool.inner()).await?;
        sqlx::query("INSERT INTO settings(key,value)VALUES('preparation_paused',?) ON CONFLICT(key)DO UPDATE SET value=excluded.value").bind(paused.to_string()).execute(&mut *tx).await.map_err(|e|e.to_string())?;
        if paused {sqlx::query("UPDATE preparation_runs SET state='failed',error='全部准备已暂停',lease_until=NULL,retry_at=? WHERE state='running'").bind(iso(Utc::now())).execute(&mut *tx).await.map_err(|e|e.to_string())?;}
        tx.commit().await.map_err(|e|e.to_string())?;let _=app.emit("preparations-changed",());Ok(())
    }
    #[tauri::command]
    pub async fn retry_preparation(app:tauri::AppHandle,pool:State<'_,SqlitePool>,id:String)->Result<Value,String> {
        let mut tx=crate::gamification::begin_write(pool.inner()).await?;let value=retry_tx(&mut tx,&id).await?;tx.commit().await.map_err(|e|e.to_string())?;
        let _=app.emit("preparations-changed",());Ok(value)
    }
    #[tauri::command]
    pub async fn preparation_history(pool:State<'_,SqlitePool>,id:String)->Result<Value,String> {
        let events:Vec<(String,String,String)>=sqlx::query_as("SELECT at,state,detail FROM preparation_events WHERE run_id=? ORDER BY id DESC LIMIT 100").bind(id).fetch_all(pool.inner()).await.map_err(|e|e.to_string())?;
        Ok(json!(events.into_iter().map(|(at,state,detail)|json!({"at":at,"state":state,"detail":detail})).collect::<Vec<_>>()))
    }
    #[tauri::command]
    pub async fn open_preparation_artifact(pool:State<'_,SqlitePool>,id:String,name:Option<String>)->Result<(),String> {
        let path=artifact_path(pool.inner(),&id,name.as_deref()).await?;
        open_local(&path)
    }
    #[tauri::command]
    pub async fn read_preparation_artifact(pool:State<'_,SqlitePool>,id:String,name:String)->Result<String,String> {read_artifact(pool.inner(),&id,&name).await}
    #[tauri::command]
    pub async fn open_preparation_source(pool:State<'_,SqlitePool>,id:String,source:String)->Result<(),String> {
        let stored:Option<String>=sqlx::query_scalar("SELECT result_json FROM preparation_runs WHERE id=?").bind(id).fetch_optional(pool.inner()).await.map_err(|e|e.to_string())?.flatten();
        let result:Value=serde_json::from_str(stored.as_deref().ok_or("尚无准备来源")?).map_err(|e|e.to_string())?;
        if !result["sources"].as_array().is_some_and(|items|items.iter().any(|s|s["url"]==source||s["location"]==source)) {return Err("来源没有登记在本次结果中".into());}
        if web_source(&source) {
            #[cfg(windows)] let program="explorer.exe";
            #[cfg(target_os="macos")] let program="open";
            #[cfg(target_os="linux")] let program="xdg-open";
            std::process::Command::new(program).arg(source).spawn().map_err(|e|format!("无法打开来源：{e}"))?;Ok(())
        }else{
            let path=source_path(&source)?;let ext=path.extension().and_then(|s|s.to_str()).unwrap_or("").to_ascii_lowercase();
            if !matches!(ext.as_str(),"pdf"|"txt"|"md"|"json"|"docx"|"xlsx"|"csv"|"pptx"|"png"|"jpg"|"jpeg") {return Err("这种文件请手动打开".into());}
            open_local(&path)
        }
    }
    #[tauri::command]
    pub async fn start_focus_environment(app:tauri::AppHandle,pool:State<'_,SqlitePool>,session_id:String)->Result<Value,String> {
        let mut tx=crate::gamification::begin_write(pool.inner()).await?;
        let task:Option<Option<String>>=sqlx::query_scalar("SELECT task_id FROM pomodoro_sessions WHERE id=? AND state='running'").bind(&session_id).fetch_optional(&mut *tx).await.map_err(|e|e.to_string())?;
        let Some(Some(task))=task else{return Ok(json!({"sound":"none","warnings":[]}));};
        let rule:Option<Rule>=sqlx::query_as("SELECT * FROM preparation_rules WHERE task_id=? AND kind='focus' AND enabled=1 AND NOT EXISTS(SELECT 1 FROM settings WHERE key='preparation_paused' AND value='true')")
            .bind(task).fetch_optional(&mut *tx).await.map_err(|e|e.to_string())?;
        let Some(rule)=rule else{return Ok(json!({"sound":"none","warnings":[]}));};
        let key=format!("focus_environment:{session_id}");
        let exists:bool=sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM settings WHERE key=?)").bind(&key).fetch_one(&mut *tx).await.map_err(|e|e.to_string())?;
        if exists {return Ok(json!({"sound":"none","warnings":[],"alreadyStarted":true}));}
        let c=config(&rule)?;let mut warnings=Vec::new();
        if c.open_sources {
            for source in &c.sources {
                if web_source(source) {continue;}
                let result=source_path(source).and_then(|path| {
                    let ext=path.extension().and_then(|e|e.to_str()).unwrap_or("").to_ascii_lowercase();
                    if !matches!(ext.as_str(),"pdf"|"txt"|"md"|"docx"|"xlsx"|"pptx"|"png"|"jpg"|"jpeg") {return Err("该文件格式不自动打开，请从资料入口手动查看".into());}
                    open_local(&path)
                });
                if let Err(e)=result {warnings.push(e);}
            }
        }
        sqlx::query("INSERT INTO settings(key,value)VALUES(?,'started')").bind(key).execute(&mut *tx).await.map_err(|e|e.to_string())?;
        tx.commit().await.map_err(|e|e.to_string())?;
        let result=json!({"sessionId":session_id,"sound":c.sound,"warnings":warnings});
        let _=app.emit("focus-environment",&result);Ok(result)
    }
    pub(super) fn open_local(path:&Path)->Result<(),String> {
        // OS handlers receive a path argument, never a shell command or URL.
        #[cfg(windows)] let mut command={
            let mut c=std::process::Command::new("explorer.exe");let raw=path.to_string_lossy();
            let display=if let Some(unc)=raw.strip_prefix("\\\\?\\UNC\\") {format!("\\\\{unc}")}else{raw.strip_prefix("\\\\?\\").unwrap_or(&raw).to_owned()};
            c.arg(display);c
        };
        #[cfg(target_os="macos")] let mut command={let mut c=std::process::Command::new("open");c.arg(path);c};
        #[cfg(target_os="linux")] let mut command={let mut c=std::process::Command::new("xdg-open");c.arg(path);c};
        command.spawn().map_err(|e|format!("无法打开产物：{e}"))?;Ok(())
    }
}
#[cfg(not(test))] pub use desktop::*;
#[cfg(test)] mod tests;
