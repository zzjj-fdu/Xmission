//! Local, consent-based shared memories. Recorded inside the source transaction.
use chrono::{Local,Utc};
use serde::Serialize;
use sqlx::{Sqlite,SqlitePool,Transaction};
use tauri::{AppHandle,Emitter,State};
#[derive(Clone,Debug,Serialize,sqlx::FromRow)]
#[serde(rename_all="camelCase")]
pub struct Memory {pub event_key:String,pub kind:String,pub title:String,pub detail:String,pub theme:Option<String>,pub day:String,pub created_at:i64}
#[derive(Clone,Serialize)]
#[serde(rename_all="camelCase")]
pub struct Unlock {pub id:String,pub title:String,pub rule:String,pub progress:i64,pub target:i64,pub unlocked:bool}
#[derive(Serialize)]
#[serde(rename_all="camelCase")]
pub struct Journal {pub memories:Vec<Memory>,pub unlocks:Vec<Unlock>,pub relationship:String,pub memory_total:i64,pub care_days:i64}
#[derive(Serialize,sqlx::FromRow)]
#[serde(rename_all="camelCase")]
pub struct Goal {pub id:String,pub title:String,pub category:Option<String>}
pub async fn record(tx:&mut Transaction<'_,Sqlite>,key:&str,kind:&str,entity:&str,title:&str,detail:&str,theme:Option<&str>,day:&str)->Result<(),String>{
 sqlx::query(&crate::companion::owned_sql("INSERT INTO companion_memories(character,event_key,kind,entity_id,title,detail,theme,day,created_at)VALUES({active},?,?,?,?,?,?,?,?) ON CONFLICT(character,event_key)DO UPDATE SET reverted_at=NULL,kind=excluded.kind,title=excluded.title,detail=excluded.detail,theme=excluded.theme WHERE companion_memories.forgotten=0"))
 .bind(key).bind(kind).bind(entity).bind(title).bind(detail).bind(theme).bind(day).bind(Utc::now().timestamp_millis())
 .execute(&mut **tx).await.map_err(|e|e.to_string())?;Ok(())
}
pub async fn completed_task(tx:&mut Transaction<'_,Sqlite>,task:&crate::models::Task)->Result<(),String>{
 let day=crate::gamification::task_day(Local::now()).to_string();
 let suffix=if task.recurrence=="none"{task.id.clone()}else{format!("{}:{day}",task.id)};
 if task.form=="main_quest"{
  record(tx,&format!("main:{suffix}"),"main",&task.id,&format!("一起走完了「{}」",task.title),"这一段主线，收进我们的共同经历。",None,&day).await?;
 }
 let category:Option<String>=sqlx::query_scalar(&crate::companion::owned_sql("SELECT category FROM companion_goal_categories WHERE {owner} AND task_id=?")).bind(&task.id).fetch_optional(&mut **tx).await.map_err(|e|e.to_string())?;
 if let Some(category)=category{
  record(tx,&format!("goal:{suffix}"),&category,&task.id,&task.title,if category=="reading"{"你确认的阅读目标已完成。"}else{"你确认的写作目标已完成。"},None,&day).await?;
 }Ok(())
}
pub async fn cancel_task(tx:&mut Transaction<'_,Sqlite>,id:&str)->Result<(),String>{
 let recurring:Option<String>=sqlx::query_scalar("SELECT recurrence FROM tasks WHERE id=?").bind(id).fetch_optional(&mut **tx).await.map_err(|e|e.to_string())?;
 let day=crate::gamification::task_day(Local::now()).to_string();
 // Undo changes the shared source task. Revoke its factual completion records
 // for every companion; reads and direct memory actions stay owner-scoped.
 sqlx::query("UPDATE companion_memories SET reverted_at=? WHERE entity_id=? AND kind IN('main','reading','writing') AND (? OR day=?)")
 .bind(Utc::now().timestamp_millis()).bind(id).bind(recurring.as_deref().unwrap_or("none")=="none").bind(day).execute(&mut **tx).await.map_err(|e|e.to_string())?;Ok(())
}
pub async fn focused(tx:&mut Transaction<'_,Sqlite>,id:&str,minutes:i64,elapsed_secs:i64)->Result<(),String>{
 record(tx,&format!("focus:{id}"),"focus",id,"一起完成一段专注",&format!("计划 {minutes} 分钟，本段已专注 {} 分 {} 秒。",elapsed_secs/60,elapsed_secs%60),None,&Local::now().date_naive().to_string()).await
}
pub async fn cared(tx:&mut Transaction<'_,Sqlite>,id:&str,action:&str,day:&str)->Result<(),String>{
 if action=="brush"{record(tx,&format!("groom:{day}"),"groom",id,"尾巴又蓬松起来了","今天慢慢梳过毛，耳朵也放松下来。",None,day).await?;}
 if action=="game"{record(tx,&format!("game:{day}"),"game",id,"一起找齐了三对小惊喜","伙伴也参与了翻牌，记住了今天的颜色。",None,day).await?;}
 Ok(())
}
pub async fn traveled(tx:&mut Transaction<'_,Sqlite>,trip:&crate::companion::PetTrip)->Result<(),String>{
 let day=Local::now().date_naive().to_string();
 record(tx,&format!("trip:{}",trip.id),"trip",&trip.id,&format!("带回了{}",trip.item_name),&trip.story,Some(&trip.theme),&day).await?;
 record(tx,&format!("route:{}:{}",trip.theme,trip.route),"route",&trip.id,&format!("第一次沿这条路回来 · {}",trip.item_name),"一条新路线已经有了我们的足迹。",Some(&trip.theme),&day).await
}
pub async fn journal(pool:&SqlitePool,affection:i64)->Result<Journal,String>{
 let mut tx=pool.begin().await.map_err(|e|e.to_string())?;let result=journal_connection(&mut tx,affection).await?;tx.commit().await.map_err(|e|e.to_string())?;Ok(result)
}
pub(crate) async fn journal_connection(conn:&mut sqlx::SqliteConnection,affection:i64)->Result<Journal,String>{
 let memories=sqlx::query_as::<_,Memory>(&crate::companion::owned_sql("SELECT event_key,kind,title,detail,theme,day,created_at FROM companion_memories WHERE {owner} AND forgotten=0 AND reverted_at IS NULL ORDER BY created_at DESC,event_key LIMIT 12")).fetch_all(&mut *conn).await.map_err(|e|e.to_string())?;
 let rows:Vec<(String,i64)>=sqlx::query_as(&crate::companion::owned_sql("SELECT kind,COUNT(DISTINCT CASE WHEN kind IN('reading','groom') THEN day WHEN kind='main' THEN entity_id ELSE event_key END) FROM companion_memories WHERE {owner} AND forgotten=0 AND reverted_at IS NULL GROUP BY kind")).fetch_all(&mut *conn).await.map_err(|e|e.to_string())?;
 let count=|kind:&str|rows.iter().find(|r|r.0==kind).map(|r|r.1).unwrap_or(0);
 let unlocks=[("bookmark","第一张书签","完成一段专注",count("focus"),1),("reader","小小阅读习惯","在 3 个不同任务日完成你指定的阅读目标",count("reading"),3),("stamp","纪念邮戳","完成一项你指定的写作目标",count("writing"),1),("badge","旅团纪念章","完成一条主线；撤销和重做不会重复累积",count("main"),1),("keepsake","行囊里的发现","领取一份旅行纪念物",count("trip"),1),("groom","熟悉的梳毛回应","在 3 个不同日期梳毛",count("groom"),3)].into_iter().map(|(id,title,rule,progress,target)|Unlock{id:id.into(),title:title.into(),rule:rule.into(),progress,target,unlocked:progress>=target}).collect();
 let memory_total:i64=sqlx::query_scalar(&crate::companion::owned_sql("SELECT COUNT(*) FROM companion_memories WHERE {owner} AND forgotten=0 AND reverted_at IS NULL")).fetch_one(&mut *conn).await.map_err(|e|e.to_string())?;
 let care_days:i64=sqlx::query_scalar(&crate::companion::owned_sql("SELECT COUNT(DISTINCT day) FROM companion_care_events WHERE {owner} AND affection_delta>0")).fetch_one(&mut *conn).await.map_err(|e|e.to_string())?;
 let relationship=if affection>=80{"有了共同的小习惯"}else if affection>=40{"会主动分享小发现"}else if affection>=15{"正在慢慢熟悉"}else{"初次相识，也很安心"}.into();
 Ok(Journal{memories,unlocks,relationship,memory_total,care_days})
}

#[tauri::command]
pub async fn list_companion_goals(pool:State<'_,SqlitePool>)->Result<Vec<Goal>,String>{
 sqlx::query_as(&crate::companion::owned_sql("SELECT t.id,t.title,g.category FROM tasks t LEFT JOIN companion_goal_categories g ON g.task_id=t.id AND g.{owner} WHERE t.status NOT IN('shelved') ORDER BY g.category IS NULL,t.created_at DESC")).fetch_all(pool.inner()).await.map_err(|e|e.to_string())
}
#[tauri::command]
pub async fn set_companion_goal(app:AppHandle,pool:State<'_,SqlitePool>,task_id:String,category:Option<String>)->Result<(),String>{
 if category.as_deref().is_some_and(|c|!matches!(c,"reading"|"writing")){return Err("请选择阅读、写作或不记录".into())}
 let mut tx=crate::gamification::begin_write(pool.inner()).await?;
 let exists:bool=sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM tasks WHERE id=?)").bind(&task_id).fetch_one(&mut *tx).await.map_err(|e|e.to_string())?;
 if !exists{return Err("任务不存在".into())}
 if let Some(c)=category{
  sqlx::query(&crate::companion::owned_sql("INSERT INTO companion_goal_categories(character,task_id,category,confirmed_at)VALUES({active},?,?,?) ON CONFLICT(character,task_id)DO UPDATE SET category=excluded.category,confirmed_at=excluded.confirmed_at")).bind(task_id).bind(c).bind(Utc::now().timestamp_millis()).execute(&mut *tx).await.map_err(|e|e.to_string())?;
 }else{sqlx::query(&crate::companion::owned_sql("DELETE FROM companion_goal_categories WHERE {owner} AND task_id=?")).bind(task_id).execute(&mut *tx).await.map_err(|e|e.to_string())?;}
 tx.commit().await.map_err(|e|e.to_string())?;let _=app.emit("companion-changed",());Ok(())
}
#[tauri::command]
pub async fn forget_companion_memory(app:AppHandle,pool:State<'_,SqlitePool>,event_key:String)->Result<(),String>{
 // Leave an empty tombstone so undo/redo cannot resurrect a forgotten memory.
 sqlx::query(&crate::companion::owned_sql("UPDATE companion_memories SET forgotten=1,title='',detail='',theme=NULL WHERE {owner} AND event_key=?")).bind(event_key).execute(pool.inner()).await.map_err(|e|e.to_string())?;
 let _=app.emit("companion-changed",());Ok(())
}
#[tauri::command]
pub async fn set_companion_keepsake(app:AppHandle,pool:State<'_,SqlitePool>,id:Option<String>)->Result<(),String>{
 let mut tx=crate::gamification::begin_write(pool.inner()).await?;
 if let Some(id)=id{
  let exists:bool=sqlx::query_scalar(&crate::companion::owned_sql("SELECT EXISTS(SELECT 1 FROM companion_collection WHERE {owner} AND id=?)")).bind(&id).fetch_one(&mut *tx).await.map_err(|e|e.to_string())?;
  if !exists{return Err("这件纪念物还没收进背包".into())}
  sqlx::query("INSERT INTO settings(key,value)VALUES('companion_keepsake',?) ON CONFLICT(key)DO UPDATE SET value=excluded.value").bind(id).execute(&mut *tx).await.map_err(|e|e.to_string())?;
 }else{sqlx::query("DELETE FROM settings WHERE key='companion_keepsake'").execute(&mut *tx).await.map_err(|e|e.to_string())?;}
 tx.commit().await.map_err(|e|e.to_string())?;let _=app.emit("companion-changed",());Ok(())
}
#[tauri::command]
pub async fn polish_companion_letter(app:AppHandle,pool:State<'_,SqlitePool>,id:String)->Result<crate::companion::PetSouvenir,String>{
 let item=sqlx::query_as::<_,crate::companion::PetSouvenir>(&crate::companion::owned_sql("SELECT * FROM companion_collection WHERE {owner} AND id=?")).bind(&id).fetch_optional(pool.inner()).await.map_err(|e|e.to_string())?.ok_or("找不到这封来信")?;
 let (_,_,key)=crate::llm::current_config(pool.inner()).await?;
 if key.is_none(){return Err("请先配置 AI 服务；原来的来信已保留".into())}
 let value=crate::ai::companion_json(pool.inner(),"将这封虚构伙伴旅行来信润色成温暖简短的第一人称中文故事。保留目的地、纪念物和真实设定，不增加用户经历，不创造新的奖励。只在 text 中返回 120–240 字正文。",&format!("纪念物：{}。原故事：{}",item.item_name,item.story)).await?;
 let text=value["text"].as_str().unwrap_or("").trim();
 if text.chars().count()<20||text.chars().count()>1500{return Err("AI 来信格式不合适，原来信已保留".into())}
 let mut tx=crate::gamification::begin_write(pool.inner()).await?;
 let saved=sqlx::query(&crate::companion::owned_sql("UPDATE companion_collection SET story=? WHERE {owner} AND id=?")).bind(text).bind(&id).execute(&mut *tx).await.map_err(|e|e.to_string())?;
 if saved.rows_affected()!=1{return Err("伙伴已切换，原来的来信已保留；请切回后重试".into())}
 let item=sqlx::query_as(&crate::companion::owned_sql("SELECT * FROM companion_collection WHERE {owner} AND id=?")).bind(id).fetch_one(&mut *tx).await.map_err(|e|e.to_string())?;
 tx.commit().await.map_err(|e|e.to_string())?;
 let _=app.emit("companion-changed",());
 Ok(item)
}
#[cfg(test)]
mod tests{
 use super::*;
 async fn pool()->SqlitePool{let p=sqlx::sqlite::SqlitePoolOptions::new().max_connections(1).connect("sqlite::memory:").await.unwrap();sqlx::migrate!().run(&p).await.unwrap();p}
 #[tokio::test]async fn shared_task_undo_reverts_original_companion_facts(){
  let p=pool().await;
  let task=crate::agent_tools::call(&p,"xmission_create_task",serde_json::json!({"requestId":"shared-main","input":{"title":"共同目标","form":"main_quest"}})).await.unwrap();
  let id=task["task"]["id"].as_str().unwrap();
  let mut tx=crate::gamification::begin_write(&p).await.unwrap();
  sqlx::query(&crate::companion::owned_sql("INSERT INTO companion_goal_categories(character,task_id,category,confirmed_at)VALUES({active},?,'reading',1000)")).bind(id).execute(&mut *tx).await.unwrap();tx.commit().await.unwrap();
  crate::task_engine::complete_task_db(&p,id).await.unwrap();
  let fox=journal(&p,0).await.unwrap();assert_eq!(fox.memory_total,2);assert!(fox.unlocks.iter().find(|u|u.id=="badge").unwrap().unlocked);
  crate::companion::update_preferences_db(&p,serde_json::json!({"character":"red-panda"})).await.unwrap();assert_eq!(journal(&p,0).await.unwrap().memory_total,0);
  let mut tx=crate::gamification::begin_write(&p).await.unwrap();focused(&mut tx,"independent-focus",25,1500).await.unwrap();tx.commit().await.unwrap();
  crate::task_engine::reopen_task_db(&p,id).await.unwrap();
  let panda=journal(&p,0).await.unwrap();assert_eq!(panda.memory_total,1);assert_eq!(panda.memories[0].kind,"focus");
  crate::companion::update_preferences_db(&p,serde_json::json!({"character":"fox"})).await.unwrap();
  let fox=journal(&p,0).await.unwrap();assert_eq!(fox.memory_total,0,"undo revokes factual task memories even when their owner was inactive");assert!(!fox.unlocks.iter().find(|u|u.id=="badge").unwrap().unlocked);
  crate::task_engine::complete_task_db(&p,id).await.unwrap();assert_eq!(journal(&p,0).await.unwrap().memory_total,2,"redo reactivates original records without duplicating them");
 }
 #[tokio::test]async fn reverted_memory_reactivates_once_and_forgetting_is_final(){
  let p=pool().await;let mut tx=crate::gamification::begin_write(&p).await.unwrap();
  record(&mut tx,"main:a","main","a","目标","",None,"2026-10-07").await.unwrap();record(&mut tx,"main:a","main","a","目标","",None,"2026-10-07").await.unwrap();tx.commit().await.unwrap();
  assert_eq!(journal(&p,0).await.unwrap().memory_total,1);
  sqlx::query("UPDATE companion_memories SET reverted_at=1 WHERE event_key='main:a'").execute(&p).await.unwrap();
  assert_eq!(journal(&p,0).await.unwrap().memory_total,0);
  let mut tx=crate::gamification::begin_write(&p).await.unwrap();record(&mut tx,"main:a","main","a","目标","",None,"2026-10-08").await.unwrap();tx.commit().await.unwrap();
  assert_eq!(journal(&p,0).await.unwrap().memory_total,1);
  let mut tx=crate::gamification::begin_write(&p).await.unwrap();record(&mut tx,"main:a","writing","a","修订后的写作目标","",None,"2026-10-08").await.unwrap();tx.commit().await.unwrap();
  let corrected=journal(&p,0).await.unwrap();assert_eq!(corrected.memory_total,1);assert!(corrected.unlocks.iter().find(|u|u.id=="stamp").unwrap().unlocked);
  sqlx::query("UPDATE companion_memories SET forgotten=1,title='',detail='' WHERE event_key='main:a'").execute(&p).await.unwrap();
  let mut tx=crate::gamification::begin_write(&p).await.unwrap();record(&mut tx,"main:a","main","a","目标","",None,"2026-10-08").await.unwrap();tx.commit().await.unwrap();
  assert_eq!(journal(&p,0).await.unwrap().memory_total,0);
 }
 #[tokio::test]async fn reading_and_grooming_require_distinct_dates(){
  let p=pool().await;let mut tx=crate::gamification::begin_write(&p).await.unwrap();
  for (id,day) in [("a","2026-10-05"),("b","2026-10-05"),("c","2026-10-06")] {
   record(&mut tx,&format!("goal:{id}"),"reading",id,"读书","",None,day).await.unwrap();
  }tx.commit().await.unwrap();let j=journal(&p,100).await.unwrap();let u=j.unlocks.iter().find(|u|u.id=="reader").unwrap();assert_eq!(u.progress,2);assert!(!u.unlocked);assert_eq!(j.relationship,"有了共同的小习惯");
 }
 #[tokio::test]async fn failed_business_transaction_leaves_no_memory(){
  let p=pool().await;let mut tx=crate::gamification::begin_write(&p).await.unwrap();focused(&mut tx,"one",25,1500).await.unwrap();tx.rollback().await.unwrap();assert_eq!(journal(&p,0).await.unwrap().memory_total,0);
 }
}
