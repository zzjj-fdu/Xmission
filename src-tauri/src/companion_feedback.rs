//! Durable, task-specific pet receipts. No wallet inference and no model calls.
use sqlx::{Sqlite,SqlitePool,Transaction};
use serde::Serialize;
use chrono::{Local,Utc};
#[derive(Clone,Debug,Serialize,sqlx::FromRow)]
#[serde(rename_all="camelCase")]
pub struct Feedback {pub id:i64,pub event_key:String,pub kind:String,pub entity_id:String,pub title:String,pub form:String,pub created_at:i64}
pub async fn record(tx:&mut Transaction<'_,Sqlite>,key:&str,kind:&str,id:&str,title:&str,form:&str)->Result<(),String>{
 sqlx::query("INSERT OR IGNORE INTO companion_feedback(event_key,kind,entity_id,title,form,created_at)VALUES(?,?,?,?,?,?)")
 .bind(key).bind(kind).bind(id).bind(title.chars().take(120).collect::<String>()).bind(form).bind(Utc::now().timestamp_millis())
 .execute(&mut **tx).await.map_err(|e|e.to_string())?;Ok(())
}
pub async fn task(tx:&mut Transaction<'_,Sqlite>,t:&crate::models::Task)->Result<(),String>{
 let key=if t.recurrence=="none"{format!("task:{}",t.id)}else{format!("task:{}:{}",t.id,crate::gamification::task_day(Local::now()))};
 sqlx::query("DELETE FROM companion_notice_queue WHERE entity_id=? AND kind='task'").bind(&t.id).execute(&mut **tx).await.map_err(|e|e.to_string())?;
 crate::companion_memory::completed_task(tx,t).await?;
 record(tx,&key,"task",&t.id,&t.title,&t.form).await
}
pub async fn cancel(tx:&mut Transaction<'_,Sqlite>,entity:&str)->Result<(),String>{
 crate::companion_memory::cancel_task(tx,entity).await?;
 sqlx::query("UPDATE companion_feedback SET delivered_at=? WHERE entity_id=? AND delivered_at IS NULL AND kind IN('task','step')")
 .bind(Utc::now().timestamp_millis()).bind(entity).execute(&mut **tx).await.map_err(|e|e.to_string())?;Ok(())
}
pub async fn agent(tx:&mut Transaction<'_,Sqlite>,request:&str,name:&str,result:&serde_json::Value,args:&serde_json::Value)->Result<(),String>{
 let kind=match name{
 "xmission_create_task"|"xmission_add_step"=>"created",
 "xmission_update_task"|"xmission_update_step"=>"edited",
 "xmission_delete_task"|"xmission_delete_step"=>"deleted",
 "xmission_reopen_task"|"xmission_reopen_step"=>"reopened",
 _=>return Ok(())
 };
 let object=if result.get("task").is_some(){&result["task"]}else{&result["step"]};
 record(tx,&format!("agent:{request}"),kind,object["id"].as_str().or(args["id"].as_str()).unwrap_or(request),
 object["title"].as_str().unwrap_or("安排"),object["form"].as_str().unwrap_or("step")).await
}
pub async fn pending(pool:&SqlitePool,now:i64)->Result<Vec<Feedback>,String>{
 sqlx::query("UPDATE companion_feedback SET delivered_at=? WHERE delivered_at IS NULL AND created_at<?")
 .bind(now).bind(now-86400000).execute(pool).await.map_err(|e|e.to_string())?;
 sqlx::query_as("SELECT id,event_key,kind,entity_id,title,form,created_at FROM companion_feedback WHERE delivered_at IS NULL ORDER BY id LIMIT 80")
 .fetch_all(pool).await.map_err(|e|e.to_string())
}
pub async fn delivered(pool:&SqlitePool,items:&[Feedback],stamp:i64)->Result<(),String>{
 let mut tx=crate::gamification::begin_write(pool).await?;
 for item in items{sqlx::query("UPDATE companion_feedback SET delivered_at=? WHERE id=? AND delivered_at IS NULL").bind(stamp).bind(item.id).execute(&mut *tx).await.map_err(|e|e.to_string())?;}
 tx.commit().await.map_err(|e|e.to_string())?;Ok(())
}

pub fn message(items:&[Feedback])->(String,String){
 let completed:Vec<_>=items.iter().filter(|i|matches!(i.kind.as_str(),"task"|"step")).collect();
 let mut receipts=Vec::new();
 for(kind,word)in[("created","记下"),("edited","更新"),("deleted","移除"),("reopened","恢复待办")]{
  let count=items.iter().filter(|i|i.kind==kind).count();if count>0{receipts.push(format!("已{word} {count} 项安排"))}
 }
 let extra=if receipts.is_empty(){String::new()}else{format!("{}。",receipts.join("，"))};
 if let Some(main)=completed.iter().find(|i|i.kind=="task"&&i.form=="main_quest"){
  return(format!("主线「{}」完成啦。{}{}把这一段努力好好收进行囊吧。",main.title.chars().take(24).collect::<String>(),if completed.len()>1{format!("一起完成了 {} 项目标，",completed.len())}else{String::new()},extra),"main".into())
 }
 if !completed.is_empty(){
  let message=if completed.len()==1{format!("「{}」完成啦，辛苦了。",completed[0].title.chars().take(28).collect::<String>())}else{format!("一起完成了 {} 项目标，辛苦啦。",completed.len())};
  return(format!("{message}{extra}先收好这份完成，再慢慢继续。"),"completed".into())
 }
 (format!("{extra}要翻开任务看看结果吗？"),"receipt".into())
}

#[cfg(test)]
mod tests{
 use super::*;
 async fn pool()->SqlitePool{
  let p=sqlx::sqlite::SqlitePoolOptions::new().max_connections(1).connect("sqlite::memory:").await.unwrap();
  sqlx::migrate!().run(&p).await.unwrap();p
 }
 #[tokio::test]
 async fn feedback_is_durable_and_undo_redo_does_not_repeat(){
  let p=pool().await;let mut tx=crate::gamification::begin_write(&p).await.unwrap();
  record(&mut tx,"task:one","task","one","目标","main_quest").await.unwrap();
  record(&mut tx,"task:one","task","one","目标","main_quest").await.unwrap();
  tx.commit().await.unwrap();assert_eq!(pending(&p,Utc::now().timestamp_millis()).await.unwrap().len(),1);
  let mut tx=crate::gamification::begin_write(&p).await.unwrap();cancel(&mut tx,"one").await.unwrap();tx.commit().await.unwrap();
  let mut tx=crate::gamification::begin_write(&p).await.unwrap();record(&mut tx,"task:one","task","one","目标","main_quest").await.unwrap();tx.commit().await.unwrap();
  assert!(pending(&p,Utc::now().timestamp_millis()).await.unwrap().is_empty());
 }
 #[tokio::test]
 async fn aborted_transaction_does_not_leave_a_pet_receipt(){
  let p=pool().await;let mut tx=crate::gamification::begin_write(&p).await.unwrap();
  record(&mut tx,"agent:failed","created","two","安排","encounter").await.unwrap();tx.rollback().await.unwrap();
  assert!(pending(&p,Utc::now().timestamp_millis()).await.unwrap().is_empty());
 }
 #[test]
 fn mixed_batch_keeps_both_goal_and_claw_receipt(){
  let items=vec![
   Feedback{id:1,event_key:"task:a".into(),kind:"task".into(),entity_id:"a".into(),title:"长线目标".into(),form:"main_quest".into(),created_at:0},
   Feedback{id:2,event_key:"agent:b".into(),kind:"created".into(),entity_id:"b".into(),title:"新安排".into(),form:"encounter".into(),created_at:0}
  ];
  let(text,kind)=message(&items);assert_eq!(kind,"main");assert!(text.contains("长线目标"));assert!(text.contains("已记下 1 项"));
 }
}
