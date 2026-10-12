use crate::models::{CreateTaskInput,Task};
use sqlx::SqlitePool;
pub const DESKTOP_LABELS:[&str;7]=["widget","bubble","companion","companion-input","companion-panel","companion-notice","companion-toy"];
fn session_key(session:&str)->Result<String,String>{if session.len()<4||session.len()>64||!session.bytes().all(|b|b.is_ascii_alphanumeric()||b==b'-'){return Err("入门会话标识无效，请重新打开引导".into());}Ok(format!("inn_first_task:{session}"))}
fn checkpoint(session:&str,task:&Task)->String{serde_json::json!({"version":2,"sessionId":session,"taskId":task.id,"stage":"tutorial","tutorial":0}).to_string()}
pub(crate) async fn first_task_db(pool:&SqlitePool,session:&str)->Result<Option<Task>,String>{
    let id:Option<String>=sqlx::query_scalar("SELECT value FROM settings WHERE key=?").bind(session_key(session)?).fetch_optional(pool).await.map_err(|e|e.to_string())?;
    match id {Some(id)=>match crate::task_engine::fetch_task(pool,&id).await {Ok(t)=>Ok(Some(t)),Err(e)if e.starts_with("任务不存在：")=>Ok(None),Err(e)=>Err(e)},None=>Ok(None)}
}
pub(crate) async fn create_first_task_db(pool:&SqlitePool,input:CreateTaskInput,session:&str)->Result<Task,String>{
    let key=session_key(session)?;let mut tx=crate::gamification::begin_write(pool).await?;
    let id:Option<String>=sqlx::query_scalar("SELECT value FROM settings WHERE key=?").bind(&key).fetch_optional(&mut *tx).await.map_err(|e|e.to_string())?;
    let existing=if let Some(id)=id{match crate::task_engine::fetch_task(&mut *tx,&id).await{Ok(task)=>Some(task),Err(e)if e.starts_with("任务不存在：")=>None,Err(e)=>return Err(e)}}else{None};
    let task=match existing{Some(task)=>task,None=>crate::task_engine::create_task_tx(&mut tx,input).await?};
    for (name,value) in [(key,task.id.clone()),("first_experience_v2".to_owned(),checkpoint(session,&task))]{
        sqlx::query("INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").bind(name).bind(value).execute(&mut *tx).await.map_err(|e|e.to_string())?;
    }
    tx.commit().await.map_err(|e|e.to_string())?;Ok(task)
}
#[cfg(test)]
mod tests {
    use super::*;
    async fn fixture()->(SqlitePool,std::path::PathBuf){let dir=std::env::temp_dir().join(format!("xmission-inn-task-{}",uuid::Uuid::new_v4()));(crate::db::init_pool(&dir).await.unwrap(),dir)}
    fn input()->CreateTaskInput{serde_json::from_value(serde_json::json!({"title":"还书","form":"encounter"})).unwrap()}
    async fn cleanup(pool:SqlitePool,dir:std::path::PathBuf){pool.close().await;assert!(std::fs::canonicalize(&dir).unwrap().starts_with(std::fs::canonicalize(std::env::temp_dir()).unwrap()));std::fs::remove_dir_all(dir).unwrap();}
    #[tokio::test]
    async fn first_task_is_atomic_and_deduplicates_after_resume(){let(pool,dir)=fixture().await;let(a,b)=tokio::join!(create_first_task_db(&pool,input(),"fixture-session"),create_first_task_db(&pool,input(),"fixture-session"));assert_eq!(a.unwrap().id,b.unwrap().id);let count:i64=sqlx::query_scalar("SELECT count(*) FROM tasks").fetch_one(&pool).await.unwrap();assert_eq!(count,1);let value:String=sqlx::query_scalar("SELECT value FROM settings WHERE key='first_experience_v2'").fetch_one(&pool).await.unwrap();assert_eq!(serde_json::from_str::<serde_json::Value>(&value).unwrap()["stage"],"tutorial");cleanup(pool,dir).await;}
    #[tokio::test]
    async fn failed_checkpoint_rolls_back_task_and_can_retry(){let(pool,dir)=fixture().await;sqlx::query("CREATE TRIGGER checkpoint_failure BEFORE INSERT ON settings WHEN NEW.key='first_experience_v2' BEGIN SELECT RAISE(ABORT,'fixture disk failure'); END").execute(&pool).await.unwrap();assert!(create_first_task_db(&pool,input(),"fixture-failure").await.is_err());let count:i64=sqlx::query_scalar("SELECT count(*) FROM tasks").fetch_one(&pool).await.unwrap();assert_eq!(count,0);sqlx::query("DROP TRIGGER checkpoint_failure").execute(&pool).await.unwrap();assert!(create_first_task_db(&pool,input(),"fixture-failure").await.is_ok());cleanup(pool,dir).await;}
    #[test]fn presentation_uses_actual_owned_window_labels(){for label in ["companion","companion-input","companion-panel","companion-notice","companion-toy"]{assert!(DESKTOP_LABELS.contains(&label));}assert!(!DESKTOP_LABELS.contains(&"main"));}
}
#[cfg(not(test))]
mod native {
    use std::{collections::HashMap,sync::Mutex};
    use tauri::{AppHandle,Manager,State,WebviewWindow,Emitter};
    #[derive(Default)]
    pub struct OnboardingPresentation(Mutex<Option<HashMap<String,bool>>>);
    pub fn scene_active(app:&AppHandle)->bool{app.try_state::<OnboardingPresentation>().is_some_and(|state|state.0.lock().map(|v|v.is_some()).unwrap_or(false))}
    #[tauri::command]
    pub async fn get_first_task(window:WebviewWindow,pool:State<'_,sqlx::SqlitePool>,session_id:String)->Result<Option<crate::models::Task>,String>{if window.label()!="main"{return Err("请在主窗口录入任务".into());}super::first_task_db(pool.inner(),&session_id).await}
    #[tauri::command]
    pub async fn create_first_task(window:WebviewWindow,app:AppHandle,pool:State<'_,sqlx::SqlitePool>,input:crate::models::CreateTaskInput,session_id:String)->Result<crate::models::Task,String>{
        if window.label()!="main"{return Err("请在主窗口录入任务".into());}
        let task=super::create_first_task_db(pool.inner(),input,&session_id).await?;
        let _=app.emit("tasks-changed",());let _=app.emit("settings-changed",serde_json::json!({"key":"first_experience_v2","value":super::checkpoint(&session_id,&task)}));Ok(task)
    }
    #[tauri::command]
    pub fn onboarding_scene(app:AppHandle,window:WebviewWindow,state:State<'_,OnboardingPresentation>,active:bool)->Result<(),String>{
        if window.label()!="main"{return Err("请从主窗口打开入门体验".into());}
        if active {
            if state.0.lock().map_err(|_|"窗口状态暂不可用")?.is_some(){return Ok(());}
            let visibility=super::DESKTOP_LABELS.into_iter().filter_map(|label|app.get_webview_window(label).map(|w|(label.to_owned(),w.is_visible().unwrap_or(false)))).collect();
            *state.0.lock().map_err(|_|"窗口状态暂不可用")?=Some(visibility);
            for label in super::DESKTOP_LABELS{if let Some(w)=app.get_webview_window(label){w.hide().map_err(|e|e.to_string())?;}}
        }else {
          let visibility=state.0.lock().map_err(|_|"窗口状态暂不可用")?.take();
          if let Some(visibility)=visibility{
            for (label,visible) in visibility{if visible{if let Some(w)=app.get_webview_window(&label){w.show().map_err(|e|e.to_string())?;}}}
          }
        }
        Ok(())
    }
}
#[cfg(not(test))]
pub use native::*;
