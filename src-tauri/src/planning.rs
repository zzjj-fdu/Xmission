//! Local goal projections and reversible planning. Never duplicate a task or settle rewards here.
use chrono::{DateTime, Datelike, Duration, Local, TimeZone, Timelike, Utc};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sqlx::{Sqlite, SqlitePool, Transaction};
use tauri::{AppHandle, Emitter, State};
use std::{collections::HashSet, hash::{Hash, Hasher}};
use crate::models::{Task, Step};

#[derive(Clone, Serialize, Deserialize, sqlx::FromRow)]
#[serde(rename_all="camelCase")]
pub struct GoalPreference { pub task_id:String, pub focused:bool, pub stage_ack:Option<String>, pub manual_order:i64 }
#[derive(Clone, Serialize, Deserialize, sqlx::FromRow)]
#[serde(rename_all="camelCase")]
pub struct Scheduled { pub entity_key:String, pub task_id:String, pub step_id:Option<String>, pub starts_at:String, pub ends_at:String, pub signature:String, pub created_at:String }
#[derive(Serialize)]
#[serde(rename_all="camelCase")]
pub struct Overview { pub today:String, pub actions:Vec<Action>, pub goals:Vec<Goal>, pub preferences:Vec<GoalPreference>, pub schedule:Vec<Scheduled>, pub overload:Option<String>, pub daily_budget:i64 }
#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all="camelCase")]
pub struct Action {pub key:String,pub task_id:String,pub step_id:Option<String>,pub title:String,pub goal_title:String,pub estimated_min:i64,pub deadline:Option<String>,pub reasons:Vec<String>,pub focused:bool}
#[derive(Serialize)]
#[serde(rename_all="camelCase")]
pub struct Goal {pub task_id:String,pub title:String,pub paused:bool,pub completed:bool,pub focused:bool,pub done:i64,pub total:i64,pub stages:Vec<Stage>,pub active_stage:Option<String>,pub advance_from:Option<String>,pub pause_suggested:bool}
#[derive(Serialize)]
#[serde(rename_all="camelCase")]
pub struct Stage {pub id:String,pub title:String,pub done:i64,pub total:i64,pub complete:bool,pub deadline:Option<String>}
#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all="camelCase")]
pub struct Proposal {pub key:String,pub task_id:String,pub step_id:Option<String>,pub title:String,pub previous:Option<String>,pub starts_at:Option<String>,pub ends_at:Option<String>,pub minutes:i64,pub warning:Option<String>,pub reasons:Vec<String>}
#[derive(Serialize, Deserialize)]
#[serde(rename_all="camelCase")]
pub struct Preview {pub id:String,pub rows:Vec<Proposal>,pub notes:Vec<String>,pub created_at:String}

#[derive(Serialize)]
struct Snapshot {tasks:Vec<Task>,steps:Vec<Step>,preferences:Vec<GoalPreference>,schedule:Vec<Scheduled>,courses:Vec<Value>,sessions:Vec<Value>,settings:Vec<(String,String)>}
fn err(e:impl std::fmt::Display)->String{e.to_string()}
async fn snapshot(tx:&mut Transaction<'_,Sqlite>)->Result<Snapshot,String>{
 let tasks=sqlx::query_as("SELECT * FROM tasks ORDER BY id").fetch_all(&mut **tx).await.map_err(err)?;
 let steps=sqlx::query_as("SELECT * FROM task_steps ORDER BY task_id,order_index,id").fetch_all(&mut **tx).await.map_err(err)?;
 let preferences=sqlx::query_as("SELECT * FROM goal_preferences ORDER BY task_id").fetch_all(&mut **tx).await.map_err(err)?;
 let schedule=sqlx::query_as("SELECT * FROM planning_schedule ORDER BY entity_key").fetch_all(&mut **tx).await.map_err(err)?;
 let mut courses=Vec::new();
 for table in ["courses","course_slots"] { for row in sqlx::query(&format!("SELECT * FROM {table} ORDER BY id")).fetch_all(&mut **tx).await.map_err(err)? {courses.push(crate::export::row_json(&row)?);} }
 let sessions=sqlx::query("SELECT * FROM pomodoro_sessions ORDER BY id").fetch_all(&mut **tx).await.map_err(err)?.iter().map(crate::export::row_json).collect::<Result<Vec<_>,_>>()?;
 let settings=sqlx::query_as("SELECT key,value FROM settings WHERE key IN('daily_capacity_min','main_quest_soft_cap','semester_start') ORDER BY key").fetch_all(&mut **tx).await.map_err(err)?;
 Ok(Snapshot{tasks,steps,preferences,schedule,courses,sessions,settings})
}
fn signature(s:&Snapshot)->String{let mut h=std::collections::hash_map::DefaultHasher::new();serde_json::to_string(s).unwrap_or_default().hash(&mut h);format!("{:016x}",h.finish())}
fn setting(s:&Snapshot,key:&str,default:i64,min:i64,max:i64)->i64{s.settings.iter().find(|v|v.0==key).and_then(|v|v.1.parse::<i64>().ok()).unwrap_or(default).clamp(min,max)}
fn descendants<'a>(steps:&'a[Step],root:&str)->Vec<&'a Step>{
 let mut ids=HashSet::from([root.to_owned()]);
 loop{let before=ids.len();for s in steps{if s.parent_step_id.as_ref().is_some_and(|p|ids.contains(p)){ids.insert(s.id.clone());}}if before==ids.len(){break}}
 steps.iter().filter(|s|ids.contains(&s.id)).collect()
}
fn roots<'a>(steps:&'a[Step],task:&str)->Vec<&'a Step>{steps.iter().filter(|s|s.task_id==task&&s.parent_step_id.is_none()).collect()}
fn complete(steps:&[Step],root:&str)->bool{let sub=descendants(steps,root);!sub.is_empty()&&sub.iter().all(|s|s.status=="done")}
fn is_leaf(steps:&[Step],id:&str)->bool{!steps.iter().any(|s|s.parent_step_id.as_deref()==Some(id))}
fn active_root<'a>(s:&'a Snapshot,task:&str)->Option<&'a Step>{roots(&s.steps,task).into_iter().find(|r|!complete(&s.steps,&r.id))}
fn available(s:&Snapshot,t:&Task)->bool{!matches!(t.status.as_str(),"done"|"shelved")&&!t.parent_id.as_ref().is_some_and(|id|s.tasks.iter().any(|p|p.id==*id&&matches!(p.status.as_str(),"done"|"shelved")))}
fn focused(s:&Snapshot,t:&Task)->bool{s.preferences.iter().any(|p|p.focused&&(p.task_id==t.id||t.parent_id.as_ref()==Some(&p.task_id)))}
fn candidates(s:&Snapshot,now:DateTime<Local>)->Vec<Action>{
 let today=crate::gamification::task_day(now);let mut result=Vec::new();
 for t in s.tasks.iter().filter(|t|available(s,t)){
  if t.recurrence!="none" {continue} // Recurring work remains in the existing daily task engine.
  let root=active_root(s,&t.id);
  if let Some(root)=root {for step in descendants(&s.steps,&root.id).into_iter().filter(|v|v.status!="done"&&(is_leaf(&s.steps,&v.id)||descendants(&s.steps,&v.id).iter().all(|child|child.id==v.id||child.status=="done"))){
   let leaf=is_leaf(&s.steps,&step.id);
   result.push(Action{key:format!("step:{}",step.id),task_id:t.id.clone(),step_id:Some(step.id.clone()),title:if leaf{step.title.clone()}else{format!("核对阶段：{}",step.title)},goal_title:t.title.clone(),estimated_min:if leaf{step.estimated_min.unwrap_or(30).clamp(1,525600)}else{1},deadline:step.deadline.clone().or_else(||root.deadline.clone()).or_else(||t.deadline.clone()),reasons:if leaf{vec![format!("当前阶段：{}",root.title)]}else{vec!["子行动已完成，核对后确认这一阶段".into()]},focused:focused(s,t)});
  }}else if !s.steps.iter().any(|v|v.task_id==t.id){result.push(Action{key:format!("task:{}",t.id),task_id:t.id.clone(),step_id:None,title:t.title.clone(),goal_title:t.title.clone(),estimated_min:t.estimated_min.unwrap_or(30).clamp(1,525600),deadline:t.deadline.clone(),reasons:vec![],focused:focused(s,t)});}
 }
 result.sort_by(|a,b|b.focused.cmp(&a.focused).then_with(||{
  let overdue=|a:&Action|crate::scheduler::parse_deadline(&a.deadline,&now).is_some_and(|d|d.date_naive()<today);
  overdue(b).cmp(&overdue(a))
 }).then_with(||a.deadline.clone().unwrap_or("9999".into()).cmp(&b.deadline.clone().unwrap_or("9999".into()))).then_with(||a.key.cmp(&b.key)));
 result
}
fn overview(s:&Snapshot,now:DateTime<Local>)->Overview{
 let today=crate::gamification::task_day(now);let day=today.to_string();let mut actions=Vec::new();
 for mut a in candidates(s,now){
  let planned=s.schedule.iter().any(|p|p.entity_key==a.key&&p.starts_at.starts_with(&day));
  let task=s.tasks.iter().find(|t|t.id==a.task_id).unwrap();
  let pinned=a.step_id.is_none()&&task.planned_date.as_deref()==Some(day.as_str());
  let surface=a.step_id.as_ref().and_then(|id|s.steps.iter().find(|v|v.id==*id)).and_then(|v|v.surface_days).unwrap_or((a.estimated_min+119)/120).clamp(0,365);
  let near=crate::scheduler::parse_deadline(&a.deadline,&now).is_some_and(|d|d.date_naive()<=today+Duration::days(surface));
  if planned||pinned||near||a.focused {if planned{a.reasons.push("已安排今天".into())}if pinned{a.reasons.push("今日重点".into())}if near{a.reasons.push(if crate::scheduler::parse_deadline(&a.deadline,&now).is_some_and(|d|d<now){"已过截止时间"}else{"截止临近"}.into())}if a.focused{a.reasons.push("聚焦主线".into())}actions.push(a);}
 }
 let cap=setting(s,"main_quest_soft_cap",3,1,20);let budget=setting(s,"daily_capacity_min",180,30,720);
 let active=s.tasks.iter().filter(|t|t.form=="main_quest"&&available(s,t)).count()as i64;
 let minutes: i64=actions.iter().map(|a|a.estimated_min).sum();
 let overload=(active>cap||minutes>budget).then(||format!("{} 条主线，今日预计 {} 分钟（容量 {} 分钟）。聚焦一条，或暂缓低优先级主线。",active,minutes,budget));
 let goals=s.tasks.iter().filter(|t|t.form=="main_quest"&&t.status!="done").map(|t|{
  let nodes:Vec<_>=s.steps.iter().filter(|v|v.task_id==t.id).collect();let rs=roots(&s.steps,&t.id);let current=active_root(s,&t.id);
  let pref=s.preferences.iter().find(|p|p.task_id==t.id);
  let previous=rs.iter().take_while(|r|complete(&s.steps,&r.id)).last().map(|r|r.id.clone());
  let advance_from=previous.filter(|id|pref.and_then(|p|p.stage_ack.as_ref())!=Some(id));
  Goal{task_id:t.id.clone(),title:t.title.clone(),paused:t.status=="shelved",completed:false,focused:focused(s,t),done:nodes.iter().filter(|v|v.status=="done").count()as i64,total:nodes.len()as i64,
   stages:rs.iter().map(|r|{let sub=descendants(&s.steps,&r.id);Stage{id:r.id.clone(),title:r.title.clone(),done:sub.iter().filter(|v|v.status=="done").count()as i64,total:sub.len()as i64,complete:complete(&s.steps,&r.id),deadline:r.deadline.clone()}}).collect(),active_stage:current.map(|v|v.id.clone()),advance_from,pause_suggested:active>cap&&!focused(s,t)&&available(s,t)&&t.importance<=3}
 }).collect();
 Overview{today:day,actions,goals,preferences:s.preferences.clone(),schedule:s.schedule.clone(),overload,daily_budget:budget}
}
#[tauri::command]
pub async fn get_goal_overview(pool:State<'_,SqlitePool>)->Result<Overview,String>{let mut tx=pool.begin().await.map_err(err)?;let s=snapshot(&mut tx).await?;tx.commit().await.map_err(err)?;Ok(overview(&s,Local::now()))}
fn changed(app:&AppHandle){let _=app.emit("planning-changed",());let _=app.emit("tasks-changed",());let _=app.emit("steps-changed",());}
#[tauri::command]
pub async fn set_goal_focus(app:AppHandle,pool:State<'_,SqlitePool>,task_id:Option<String>)->Result<(),String>{
 let mut tx=crate::gamification::begin_write(pool.inner()).await?;
 if let Some(id)=&task_id{let t=crate::task_engine::fetch_task(&mut *tx,id).await?;if t.form!="main_quest"||matches!(t.status.as_str(),"done"|"shelved"){return Err("请选择进行中的主线".into())}}
 sqlx::query("UPDATE goal_preferences SET focused=0").execute(&mut *tx).await.map_err(err)?;
 if let Some(id)=task_id{sqlx::query("INSERT INTO goal_preferences(task_id,focused) VALUES(?,1) ON CONFLICT(task_id) DO UPDATE SET focused=1").bind(id).execute(&mut *tx).await.map_err(err)?;}
 tx.commit().await.map_err(err)?;changed(&app);Ok(())
}
#[tauri::command]
pub async fn advance_goal_stage(app:AppHandle,pool:State<'_,SqlitePool>,task_id:String,stage_id:String)->Result<(),String>{
 let mut tx=crate::gamification::begin_write(pool.inner()).await?;let s=snapshot(&mut tx).await?;
 let t=s.tasks.iter().find(|t|t.id==task_id&&t.form=="main_quest").ok_or("主线不存在")?;
 if !available(&s,t){return Err("先恢复这条主线".into())}
 let prev=roots(&s.steps,&task_id).into_iter().take_while(|r|complete(&s.steps,&r.id)).last().ok_or("当前阶段还有未完成步骤")?;
 if prev.id!=stage_id{return Err("阶段已经变化，请刷新后继续".into())}
 sqlx::query("INSERT INTO goal_preferences(task_id,stage_ack) VALUES(?,?) ON CONFLICT(task_id) DO UPDATE SET stage_ack=excluded.stage_ack").bind(task_id).bind(stage_id).execute(&mut *tx).await.map_err(err)?;
 tx.commit().await.map_err(err)?;changed(&app);Ok(())
}
#[tauri::command]
pub async fn configure_step_plan(app:AppHandle,pool:State<'_,SqlitePool>,id:String,deadline:Option<String>,estimated_min:Option<i64>,surface_days:Option<i64>)->Result<(),String>{
 if surface_days.is_some_and(|d|!(0..=365).contains(&d)){return Err("提前浮现天数请填 0–365".into())}
 let mut tx=crate::gamification::begin_write(pool.inner()).await?;
 crate::steps::update_step_tx(&mut tx,&id,None,Some(deadline),Some(estimated_min)).await?;
 sqlx::query("UPDATE task_steps SET surface_days=? WHERE id=?").bind(surface_days).bind(id).execute(&mut *tx).await.map_err(err)?;
 tx.commit().await.map_err(err)?;changed(&app);Ok(())
}
#[tauri::command]
pub async fn reorder_work(app:AppHandle,pool:State<'_,SqlitePool>,kind:String,ids:Vec<String>)->Result<(),String>{
 if ids.is_empty()||ids.len()>500||ids.iter().collect::<HashSet<_>>().len()!=ids.len(){return Err("排序列表无效".into())}
 let mut tx=crate::gamification::begin_write(pool.inner()).await?;
 if kind=="task"{
  for(i,id)in ids.iter().enumerate(){crate::task_engine::fetch_task(&mut *tx,id).await?;sqlx::query("INSERT INTO goal_preferences(task_id,manual_order) VALUES(?,?) ON CONFLICT(task_id) DO UPDATE SET manual_order=excluded.manual_order").bind(id).bind(i as i64).execute(&mut *tx).await.map_err(err)?;}
 }else if kind=="step"{
  let first=crate::steps::fetch_step(&mut *tx,&ids[0]).await?;
  let siblings:Vec<String>=sqlx::query_scalar("SELECT id FROM task_steps WHERE task_id=? AND parent_step_id IS ?").bind(&first.task_id).bind(&first.parent_step_id).fetch_all(&mut *tx).await.map_err(err)?;
  if siblings.len()!=ids.len()||siblings.iter().any(|id|!ids.contains(id)){return Err("只能排序同一层的全部步骤，请刷新".into())}
  for(i,id)in ids.iter().enumerate(){sqlx::query("UPDATE task_steps SET order_index=? WHERE id=?").bind(i as i64).bind(id).execute(&mut *tx).await.map_err(err)?;}
 }else{return Err("排序类型无效".into())}
 tx.commit().await.map_err(err)?;changed(&app);Ok(())
}

fn calibrated_minutes(s:&Snapshot,t:&Task,estimate:i64)->i64{
 let actual:i64=s.sessions.iter().filter(|p|p["task_id"].as_str()==Some(&t.id)&&matches!(p["state"].as_str(),Some("done"|"abandoned"))).map(|p|(p["duration_min"].as_i64().unwrap_or(0)*60-p["remaining_secs"].as_i64().unwrap_or(0)).max(0)/60).sum();
 // Only a completed task with a real estimate can teach us an observed ratio.
 let observations:Vec<f64>=s.tasks.iter().filter(|v|v.status=="done"&&v.estimated_min.is_some_and(|m|m>0)).filter_map(|v|{
  let secs:i64=s.sessions.iter().filter(|p|p["task_id"].as_str()==Some(&v.id)&&matches!(p["state"].as_str(),Some("done"|"abandoned"))).map(|p|(p["duration_min"].as_i64().unwrap_or(0)*60-p["remaining_secs"].as_i64().unwrap_or(0)).max(0)).sum();
  (secs>0).then(||secs as f64/60.0/v.estimated_min.unwrap()as f64)
 }).collect();
 let ratio=if observations.is_empty(){1.0}else{(observations.iter().sum::<f64>()/observations.len()as f64).clamp(0.5,2.0)};
 let remaining=if t.estimated_min.is_some()&&t.status!="done"{(estimate-actual).max(15)}else{estimate};
 ((remaining as f64*ratio).ceil()as i64).clamp(15,525600)
}
async fn build_preview(pool:&SqlitePool,s:&Snapshot,now:DateTime<Local>)->Result<Preview,String>{
 let today=crate::gamification::task_day(now);let budget=setting(s,"daily_capacity_min",180,30,720);let mut windows:Vec<(DateTime<Local>,DateTime<Local>)>=Vec::new();
 for offset in 0..14{
  let day=today+Duration::days(offset);let mut occupied:Vec<(i64,i64)>=Vec::new();
  for c in crate::course::courses_on_date(pool,day).await?{for slot in c.slots.iter().filter(|v|v.weekday==day.weekday().number_from_monday()as i64){if let(Some(a),Some(b))=(crate::course::time_to_min(&slot.start_time),crate::course::time_to_min(&slot.end_time)){occupied.push((a,b));}}}
  // Reserve today's recurring tasks first, so the week plan never consumes their budget.
  let recurring:i64=s.tasks.iter().filter(|t|available(s,t)&&t.recurrence!="none"&&crate::recurring::due_on(&t.recurrence,&t.recur_days,day)&&!(day==today&&t.last_done_date.as_deref()==Some(today.to_string().as_str()))).map(|t|t.estimated_min.unwrap_or(30).clamp(1,720)).sum();
  let mut remaining=(budget-recurring).max(0);occupied.sort();let start=if day==now.date_naive(){(now.hour()as i64*60+now.minute()as i64+14)/15*15}else{9*60};let mut cursor=start.max(9*60);
  for(a,b)in occupied.into_iter().chain(std::iter::once((21*60,21*60))){let a=a.clamp(9*60,21*60);let b=b.clamp(9*60,21*60);let length=(a-cursor).max(0).min(remaining);
   if length>0{let at=|m:i64|day.and_hms_opt((m/60)as u32,(m%60)as u32,0).and_then(|d|Local.from_local_datetime(&d).single());if let(Some(from),Some(to))=(at(cursor),at(cursor+length)){windows.push((from,to));remaining-=length;}}
   cursor=cursor.max(b);if remaining<=0{break}
  }
 }
 let mut rows=Vec::new();let mut candidates=candidates(s,now);
 candidates.sort_by(|a,b|{let importance=|a:&Action|s.tasks.iter().find(|t|t.id==a.task_id).map(|t|t.importance).unwrap_or(3);b.focused.cmp(&a.focused).then_with(||importance(b).cmp(&importance(a))).then_with(||a.deadline.clone().unwrap_or("9999".into()).cmp(&b.deadline.clone().unwrap_or("9999".into()))).then_with(||a.key.cmp(&b.key))});
 for a in candidates.into_iter().take(200){let t=s.tasks.iter().find(|t|t.id==a.task_id).unwrap();let minutes=if a.step_id.is_none(){calibrated_minutes(s,t,a.estimated_min)}else{a.estimated_min};let index=windows.iter().position(|(from,to)|(*to-*from).num_minutes()>=minutes);
  let previous=s.schedule.iter().find(|p|p.entity_key==a.key).map(|p|p.starts_at.clone()).or_else(||t.planned_date.clone());let mut reasons=a.reasons.clone();if previous.as_ref().is_some_and(|v|v.as_str()<today.to_string().as_str()){reasons.push("原计划未完成，安排剩余行动".into())}if minutes!=a.estimated_min{reasons.push("按已记录专注与完成任务耗时修正估时".into())}reasons.push("避开现有课程与临时调课；保留每日容量".into());
  let (starts_at,ends_at,warning)=if let Some(i)=index{let from=windows[i].0;let end=from+Duration::minutes(minutes);windows[i].0=end;
   let late=crate::scheduler::parse_deadline(&a.deadline,&now).is_some_and(|d|end>d);
   (Some(from.to_rfc3339()),Some(end.to_rfc3339()),late.then(||"剩余空档无法在原截止前完成；原截止日期保持不变".into()))
  }else{(None,None,Some("未来 14 天没有足够连续空档；请拆小步骤或增加容量".into()))};
  rows.push(Proposal{key:a.key,task_id:a.task_id,step_id:a.step_id,title:a.title,previous,starts_at,ends_at,minutes,warning,reasons});
 }
 Ok(Preview{id:uuid::Uuid::new_v4().to_string(),rows,notes:vec!["先预览，再应用；不会改动截止日期、重复规则或完成记录。".into(),"仅安排当前阶段，单项需连续空档；未知耗时暂按 30 分钟，课程之外的固定安排仍需自己核对。".into()],created_at:Utc::now().to_rfc3339()})
}
#[tauri::command]
pub async fn preview_replan(pool:State<'_,SqlitePool>)->Result<Preview,String>{preview_replan_db(pool.inner(),Local::now()).await}
pub(crate) async fn preview_replan_db(pool:&SqlitePool,now:DateTime<Local>)->Result<Preview,String>{
 let mut tx=pool.begin().await.map_err(err)?;let s=snapshot(&mut tx).await?;tx.commit().await.map_err(err)?;
 let preview=build_preview(pool,&s,now).await?;
 let mut tx=crate::gamification::begin_write(pool).await?;if signature(&snapshot(&mut tx).await?)!=signature(&s){return Err("任务或课表刚有变化，请重新预览".into())}
 sqlx::query("DELETE FROM planning_previews WHERE created_at<?").bind((Utc::now()-Duration::days(2)).to_rfc3339()).execute(&mut *tx).await.map_err(err)?;
 sqlx::query("INSERT INTO planning_previews(id,signature,payload,created_at) VALUES(?,?,?,?)").bind(&preview.id).bind(signature(&s)).bind(serde_json::to_string(&preview).map_err(err)?).bind(&preview.created_at).execute(&mut *tx).await.map_err(err)?;
 tx.commit().await.map_err(err)?;Ok(preview)
}
#[tauri::command]
pub async fn apply_replan(app:AppHandle,pool:State<'_,SqlitePool>,id:String)->Result<(),String>{apply_replan_db(pool.inner(),&id).await?;changed(&app);Ok(())}
pub(crate) async fn apply_replan_db(pool:&SqlitePool,id:&str)->Result<(),String>{
 let mut tx=crate::gamification::begin_write(pool).await?;
 let (old,payload,created,applied):(String,String,String,Option<String>)=sqlx::query_as("SELECT signature,payload,created_at,applied_at FROM planning_previews WHERE id=?").bind(id).fetch_optional(&mut *tx).await.map_err(err)?.ok_or("排程预览不存在，请重新生成")?;
 if applied.is_some(){return Ok(())}
 if DateTime::parse_from_rfc3339(&created).map_err(err)?<Utc::now()-Duration::hours(2)||old!=signature(&snapshot(&mut tx).await?){return Err("任务、专注或课表已变化，旧排程未应用，请重新预览".into())}
 let preview:Preview=serde_json::from_str(&payload).map_err(err)?;
 sqlx::query("DELETE FROM planning_schedule").execute(&mut *tx).await.map_err(err)?;
 for row in preview.rows {if let(Some(from),Some(to))=(row.starts_at,row.ends_at){sqlx::query("INSERT INTO planning_schedule(entity_key,task_id,step_id,starts_at,ends_at,signature,created_at) VALUES(?,?,?,?,?,?,?)").bind(row.key).bind(row.task_id).bind(row.step_id).bind(from).bind(to).bind(&old).bind(Utc::now().to_rfc3339()).execute(&mut *tx).await.map_err(err)?;}}
 sqlx::query("UPDATE planning_previews SET applied_at=? WHERE id=?").bind(Utc::now().to_rfc3339()).bind(id).execute(&mut *tx).await.map_err(err)?;
 tx.commit().await.map_err(err)?;Ok(())
}

#[tauri::command]
pub async fn get_progress_review(pool:State<'_,SqlitePool>,days:i64)->Result<Value,String>{review_db(pool.inner(),days,Local::now()).await}
pub(crate) async fn review_db(pool:&SqlitePool,days:i64,now:DateTime<Local>)->Result<Value,String>{
 if ![7,30].contains(&days){return Err("请选择 7 天或 30 天".into())}let mut tx=pool.begin().await.map_err(err)?;let s=snapshot(&mut tx).await?;tx.commit().await.map_err(err)?;let today=crate::gamification::task_day(now);
 let focus_secs=|p:&Value|(p["duration_min"].as_i64().unwrap_or(0)*60-p["remaining_secs"].as_i64().unwrap_or(0)).max(0);
 let date=|raw:&str|DateTime::parse_from_rfc3339(raw).ok().map(|d|crate::gamification::task_day(d.with_timezone(&Local)));
 let trend:Vec<_>=(0..days).rev().map(|offset|{let day=today-Duration::days(offset);
  let tasks=s.tasks.iter().filter(|t|t.completed_at.as_deref().and_then(date)==Some(day)&&t.status=="done").count();
  let steps=s.steps.iter().filter(|v|v.completed_at.as_deref().and_then(date)==Some(day)&&v.status=="done").count();
  let checkins=0; // Count recurring task receipts below, rather than collapsing their last completion.
  let seconds:i64=s.sessions.iter().filter(|p|p["updated_at"].as_str().and_then(date)==Some(day)&&matches!(p["state"].as_str(),Some("done"|"abandoned"))).map(focus_secs).sum();
  json!({"date":day.to_string(),"tasks":tasks,"steps":steps,"checkins":checkins,"focusMin":seconds/60})
 }).collect();
 let mut trend=trend;let receipts:Vec<String>=sqlx::query_scalar("SELECT ref_id FROM xp_ledger WHERE reason IN('task','task-revoke') AND ref_id IS NOT NULL GROUP BY ref_id HAVING SUM(delta)>0").fetch_all(pool).await.map_err(err)?;
 for point in &mut trend {let day=point["date"].as_str().unwrap();let count=receipts.iter().filter(|id|s.tasks.iter().any(|t|t.recurrence!="none"&&*id==&format!("{}:{}",t.id,day))).count();point["checkins"]=json!(count);}
 let comparisons:Vec<_>=s.tasks.iter().filter(|t|t.status=="done"&&t.completed_at.as_deref().and_then(date).is_some_and(|d|d>=today-Duration::days(days-1)&&d<=today)).map(|t|{
  let measured:i64=s.sessions.iter().filter(|p|p["task_id"].as_str()==Some(&t.id)&&matches!(p["state"].as_str(),Some("done"|"abandoned"))).map(focus_secs).sum();
  json!({"id":t.id,"title":t.title,"estimatedMin":t.estimated_min,"actualFocusMin":if measured>0{Some(measured/60)}else{None},"differenceMin":t.estimated_min.filter(|_|measured>0).map(|estimate|measured/60-estimate)})
 }).collect();
 let mut goals=overview(&s,now).goals;
 for t in s.tasks.iter().filter(|t|t.form=="main_quest"&&t.status=="done"){
  let nodes:Vec<_>=s.steps.iter().filter(|v|v.task_id==t.id).collect();
  let stages=roots(&s.steps,&t.id).iter().map(|r|{let sub=descendants(&s.steps,&r.id);Stage{id:r.id.clone(),title:r.title.clone(),done:sub.iter().filter(|v|v.status=="done").count()as i64,total:sub.len()as i64,complete:complete(&s.steps,&r.id),deadline:r.deadline.clone()}}).collect();
  goals.push(Goal{task_id:t.id.clone(),title:t.title.clone(),paused:false,completed:true,focused:false,done:nodes.iter().filter(|v|v.status=="done").count()as i64,total:nodes.len()as i64,stages,active_stage:None,advance_from:None,pause_suggested:false});
 }
 Ok(json!({"days":days,"trend":trend,"comparisons":comparisons,"goals":goals,"note":"实际耗时仅统计已结束且关联任务的专注记录，不能代表离开软件后的全部投入；未计时的任务显示未记录。"}))
}

#[cfg(test)] pub(crate) mod tests;

pub(crate) async fn today_step_reminders(pool:&SqlitePool,now:DateTime<Local>)->Result<Vec<crate::companion::PetReminder>,String>{
 let mut tx=pool.begin().await.map_err(err)?;let s=snapshot(&mut tx).await?;tx.commit().await.map_err(err)?;
 let o=overview(&s,now);let today=crate::gamification::task_day(now);
 let morning=today.and_hms_opt(9,0,0).and_then(|d|Local.from_local_datetime(&d).single()).unwrap_or(now);
 Ok(o.actions.into_iter().filter(|a|a.step_id.is_some()).map(|a|{
  let slot=s.schedule.iter().find(|p|p.entity_key==a.key);
  let at=slot.and_then(|p|DateTime::parse_from_rfc3339(&p.starts_at).ok()).map(|d|d.with_timezone(&Local)).unwrap_or(morning);
  let task=s.tasks.iter().find(|t|t.id==a.task_id).unwrap();
  crate::companion::PetReminder{key:format!("goal-step:{}:{}",a.step_id.unwrap(),at.to_rfc3339()),id:a.task_id,kind:"step".into(),title:a.title,detail:format!("来自「{}」· {} 分钟",a.goal_title,a.estimated_min),when_at:at.timestamp_millis(),importance:task.importance}
 }).collect())
}
