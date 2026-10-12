//! Durable deletion undo. Restoration preserves identifiers and the existing reward receipts.
use chrono::{Duration,Utc};
use serde_json::{json,Value};
use sqlx::{Row,Sqlite,SqlitePool,Transaction};
use tauri::{AppHandle,Emitter,State};
fn err(e:impl std::fmt::Display)->String{e.to_string()}
async fn rows(tx:&mut Transaction<'_,Sqlite>,sql:&str,id:&str)->Result<Vec<Value>,String>{sqlx::query(sql).bind(id).fetch_all(&mut **tx).await.map_err(err)?.iter().map(crate::export::row_json).collect()}
pub(crate) async fn record_task(tx:&mut Transaction<'_,Sqlite>,id:&str)->Result<(),String>{
 let task=rows(tx,"SELECT * FROM tasks WHERE id=?",id).await?;let title=task.first().and_then(|t|t["title"].as_str()).ok_or("任务不存在")?.to_owned();
 let snapshot=json!({"tasks":task,"task_steps":rows(tx,"SELECT * FROM task_steps WHERE task_id=? ORDER BY order_index,rowid",id).await?,"children":rows(tx,"SELECT id FROM tasks WHERE parent_id=?",id).await?,"sessions":rows(tx,"SELECT id FROM pomodoro_sessions WHERE task_id=?",id).await?,"goal_preferences":rows(tx,"SELECT * FROM goal_preferences WHERE task_id=?",id).await?,"preparation_rules":rows(tx,"SELECT * FROM preparation_rules WHERE task_id=?",id).await?});
 record(tx,"task",id,&title,snapshot).await?;
 // Focus history must survive deleting its associated task, including finished sessions.
 sqlx::query("UPDATE pomodoro_sessions SET task_id=NULL WHERE task_id=?").bind(id).execute(&mut **tx).await.map_err(err)?;
 Ok(())
}
pub(crate) async fn record_step(tx:&mut Transaction<'_,Sqlite>,id:&str)->Result<(),String>{
 let steps=rows(tx,"WITH RECURSIVE sub(id) AS (SELECT id FROM task_steps WHERE id=? UNION SELECT t.id FROM task_steps t JOIN sub s ON t.parent_step_id=s.id) SELECT * FROM task_steps WHERE id IN(SELECT id FROM sub) ORDER BY order_index,rowid",id).await?;
 let title=steps.iter().find(|s|s["id"].as_str()==Some(id)).and_then(|s|s["title"].as_str()).ok_or("步骤不存在")?.to_owned();record(tx,"step",id,&title,json!({"task_steps":steps})).await
}
async fn record(tx:&mut Transaction<'_,Sqlite>,kind:&str,id:&str,title:&str,snapshot:Value)->Result<(),String>{
 sqlx::query("DELETE FROM deleted_items WHERE deleted_at<?").bind((Utc::now()-Duration::days(30)).to_rfc3339()).execute(&mut **tx).await.map_err(err)?;
 sqlx::query("INSERT INTO deleted_items(id,kind,entity_id,title,snapshot,deleted_at) VALUES(?,?,?,?,?,?)").bind(uuid::Uuid::new_v4().to_string()).bind(kind).bind(id).bind(title).bind(snapshot.to_string()).bind(Utc::now().to_rfc3339()).execute(&mut **tx).await.map_err(err)?;Ok(())
}
#[tauri::command]
pub async fn list_deleted_items(pool:State<'_,SqlitePool>)->Result<Vec<Value>,String>{
 let rows=sqlx::query("SELECT id,kind,entity_id,title,deleted_at FROM deleted_items WHERE restored_at IS NULL AND deleted_at>=? ORDER BY deleted_at DESC LIMIT 100").bind((Utc::now()-Duration::days(30)).to_rfc3339()).fetch_all(pool.inner()).await.map_err(err)?;
 Ok(rows.iter().map(|r|json!({"id":r.get::<String,_>("id"),"kind":r.get::<String,_>("kind"),"entityId":r.get::<String,_>("entity_id"),"title":r.get::<String,_>("title"),"deletedAt":r.get::<String,_>("deleted_at")})).collect())
}
async fn insert_row(tx:&mut Transaction<'_,Sqlite>,table:&str,row:&Value)->Result<(),String>{
 if !["tasks","task_steps","goal_preferences","preparation_rules"].contains(&table){return Err("恢复表无效".into())}
 let obj=row.as_object().ok_or("恢复记录损坏")?;
 let columns:Vec<String>=sqlx::query(&format!("PRAGMA table_info({table})")).fetch_all(&mut **tx).await.map_err(err)?.iter().map(|r|r.get("name")).collect();
 if obj.is_empty()||obj.keys().any(|k|!columns.contains(k)){return Err("恢复字段不兼容".into())}
 let keys:Vec<_>=obj.keys().collect();let mut qb=sqlx::QueryBuilder::<Sqlite>::new(format!("INSERT INTO {table} ({} ) VALUES (",keys.iter().map(|k|k.as_str()).collect::<Vec<_>>().join(",")));
 let mut values=qb.separated(",");for k in keys{match &obj[k]{Value::Null=>{values.push_bind(Option::<String>::None);},Value::Number(n)=>{values.push_bind(n.as_i64().ok_or("恢复数值无效")?);},Value::String(v)=>{values.push_bind(v);},_=>return Err("恢复类型无效".into())}}
 values.push_unseparated(")");qb.build().execute(&mut **tx).await.map_err(err)?;Ok(())
}
pub(crate) async fn restore_db(pool:&SqlitePool,id:&str)->Result<String,String>{
 let mut tx=crate::gamification::begin_write(pool).await?;sqlx::query("PRAGMA defer_foreign_keys=ON").execute(&mut *tx).await.map_err(err)?;
 let(kind,entity,payload,restored):(String,String,String,Option<String>)=sqlx::query_as("SELECT kind,entity_id,snapshot,restored_at FROM deleted_items WHERE id=? AND deleted_at>=?").bind(id).bind((Utc::now()-Duration::days(30)).to_rfc3339()).fetch_optional(&mut *tx).await.map_err(err)?.ok_or("删除记录不存在或已超过 30 天")?;
 if restored.is_some(){return Ok(entity)}let data:Value=serde_json::from_str(&payload).map_err(err)?;
 if kind=="task"{let mut task=data["tasks"].as_array().and_then(|a|a.first()).cloned().ok_or("任务快照损坏")?;
  if task["id"].as_str()!=Some(&entity){return Err("任务编号不匹配".into())}
  crate::task_engine::validate_title(task["title"].as_str().ok_or("标题缺失")?)?;
  crate::task_engine::validate_form(task["form"].as_str().ok_or("类型缺失")?)?;
  crate::task_engine::validate_status(task["status"].as_str().ok_or("状态缺失")?)?;
  crate::task_engine::validate_importance_urgency(task["importance"].as_i64().unwrap_or(3),task["urgency"].as_i64().unwrap_or(3))?;
  if let Some(parent)=task["parent_id"].as_str(){let exists:bool=sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM tasks WHERE id=?)").bind(parent).fetch_one(&mut *tx).await.map_err(err)?;if !exists{task["parent_id"]=Value::Null;}}
  insert_row(&mut tx,"tasks",&task).await?;
 }
 if let Some(steps)=data["task_steps"].as_array(){if steps.len()>5000{return Err("步骤快照过大".into())}for step in steps{crate::task_engine::validate_title(step["title"].as_str().ok_or("步骤标题缺失")?)?;if kind=="task"&&step["task_id"].as_str()!=Some(&entity){return Err("步骤所属任务不匹配".into())}insert_row(&mut tx,"task_steps",step).await?;}}
 if kind=="task"{
  for table in ["goal_preferences","preparation_rules"]{if let Some(items)=data[table].as_array(){for item in items{if item["task_id"].as_str()!=Some(&entity){return Err("授权所属任务不匹配".into())}let mut item=item.clone();if table=="goal_preferences"{item["focused"]=json!(0);}else{item["enabled"]=json!(0);item["needs_authorization"]=json!(1);item["version"]=json!(item["version"].as_i64().unwrap_or(1).saturating_add(1));}insert_row(&mut tx,table,&item).await?;}}}
  for (field,table,column)in [("children","tasks","parent_id"),("sessions","pomodoro_sessions","task_id")]{if let Some(items)=data[field].as_array(){for item in items{if let Some(id)=item["id"].as_str(){sqlx::query(&format!("UPDATE {table} SET {column}=? WHERE id=? AND {column} IS NULL")).bind(&entity).bind(id).execute(&mut *tx).await.map_err(err)?;}}}}
 }
 sqlx::query("UPDATE deleted_items SET restored_at=? WHERE id=?").bind(Utc::now().to_rfc3339()).bind(id).execute(&mut *tx).await.map_err(err)?;
 tx.commit().await.map_err(err)?;Ok(entity)
}
#[tauri::command]
pub async fn restore_deleted_item(app:AppHandle,pool:State<'_,SqlitePool>,id:String)->Result<String,String>{let entity=restore_db(pool.inner(),&id).await?;for event in ["tasks-changed","steps-changed","planning-changed","preparations-changed"]{let _=app.emit(event,());}Ok(entity)}
#[cfg(test)]mod tests;
