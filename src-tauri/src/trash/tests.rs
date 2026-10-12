use super::*;
async fn pool()->SqlitePool{crate::planning::tests::pool().await}
async fn last(p:&SqlitePool)->String{sqlx::query_scalar("SELECT id FROM deleted_items ORDER BY deleted_at DESC LIMIT 1").fetch_one(p).await.unwrap()}
#[tokio::test]
async fn deleting_task_with_focus_history_restores_original_ids_without_rewards(){
 let p=pool().await;crate::steps::set_step_completed(&p,"leaf",true).await.unwrap();
 sqlx::query("INSERT INTO pomodoro_sessions(id,task_id,started_at,duration_min,state,remaining_secs,updated_at)VALUES('session','goal','2026-10-07',25,'done',0,'2026-10-07')").execute(&p).await.unwrap();
 let mut tx=crate::gamification::begin_write(&p).await.unwrap();crate::task_engine::delete_task_tx(&mut tx,"goal").await.unwrap();tx.commit().await.unwrap();
 let id=last(&p).await;restore_db(&p,&id).await.unwrap();restore_db(&p,&id).await.unwrap();
 assert_eq!(sqlx::query_scalar::<_,i64>("SELECT COUNT(*) FROM task_steps").fetch_one(&p).await.unwrap(),3);
 assert_eq!(sqlx::query_scalar::<_,String>("SELECT task_id FROM pomodoro_sessions").fetch_one(&p).await.unwrap(),"goal");
 assert_eq!(sqlx::query_scalar::<_,i64>("SELECT COUNT(*) FROM xp_ledger").fetch_one(&p).await.unwrap(),1);
}
#[tokio::test]
async fn undo_step_subtree_is_transactional_and_parent_must_exist(){
 let p=pool().await;let mut tx=crate::gamification::begin_write(&p).await.unwrap();crate::steps::delete_step_tx(&mut tx,"phase1").await.unwrap();tx.commit().await.unwrap();let id=last(&p).await;
 restore_db(&p,&id).await.unwrap();assert_eq!(sqlx::query_scalar::<_,i64>("SELECT COUNT(*) FROM task_steps").fetch_one(&p).await.unwrap(),3);
 let mut tx=crate::gamification::begin_write(&p).await.unwrap();crate::steps::delete_step_tx(&mut tx,"leaf").await.unwrap();tx.commit().await.unwrap();let id=last(&p).await;
 sqlx::query("DELETE FROM task_steps WHERE id='phase1'").execute(&p).await.unwrap();assert!(restore_db(&p,&id).await.is_err());assert_eq!(sqlx::query_scalar::<_,i64>("SELECT COUNT(*) FROM task_steps WHERE id='leaf'").fetch_one(&p).await.unwrap(),0);
}
#[tokio::test]
async fn restoring_preparation_always_requires_reauthorization(){
 let p=pool().await;sqlx::query("INSERT INTO preparation_rules(id,task_id,kind,config_json,start_at,lead_min,enabled,version,created_at,updated_at)VALUES('r','goal','writing','{}','2026-10-09',30,1,1,'now','now')").execute(&p).await.unwrap();
 let mut tx=crate::gamification::begin_write(&p).await.unwrap();crate::task_engine::delete_task_tx(&mut tx,"goal").await.unwrap();tx.commit().await.unwrap();restore_db(&p,&last(&p).await).await.unwrap();let(enabled,grant,version):(i64,i64,i64)=sqlx::query_as("SELECT enabled,needs_authorization,version FROM preparation_rules WHERE id='r'").fetch_one(&p).await.unwrap();assert_eq!((enabled,grant,version),(0,1,2));
}
