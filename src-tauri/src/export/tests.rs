use super::*;
async fn pool()->SqlitePool {
    let p=sqlx::sqlite::SqlitePoolOptions::new().max_connections(1).connect("sqlite::memory:").await.unwrap();sqlx::migrate!().run(&p).await.unwrap();p
}
#[tokio::test]
async fn companion_character_backups_and_legacy_journey_receipts_restore(){
 let p=pool().await;
 crate::companion::interact_db(&p,&uuid::Uuid::new_v4().to_string(),"game",Some(7)).await.unwrap();
 let input=serde_json::json!({"requestId":"legacy-chapter","action":"start","id":null,"expectedNode":null,"theme":"pixel-jrpg","taskId":null,"choice":null,"moves":null});
 let chapter=crate::journey::action(&p,serde_json::from_value(input.clone()).unwrap()).await.unwrap();
 let mut legacy=backup_document(&p).await.unwrap();legacy["tables"].as_object_mut().unwrap().remove("companion_journey_requests");
 for rows in legacy["tables"].as_object_mut().unwrap().values_mut(){for row in rows.as_array_mut().unwrap(){row.as_object_mut().unwrap().remove("character");}}
 crate::companion::update_preferences_db(&p,serde_json::json!({"character":"red-panda","name":"竹竹","outfit":"none"})).await.unwrap();
 crate::companion::interact_db(&p,&uuid::Uuid::new_v4().to_string(),"snack",None).await.unwrap();
 let current=backup_document(&p).await.unwrap();restore_document(&p,&current).await.unwrap();
 assert_eq!(crate::companion::preferences_db(&p).await.unwrap().name,"竹竹");assert_eq!(crate::companion::care_db(&p).await.unwrap().affection,3);
 crate::companion::update_preferences_db(&p,serde_json::json!({"character":"fox"})).await.unwrap();assert_eq!(crate::companion::care_db(&p).await.unwrap().affection,8);
 restore_document(&p,&legacy).await.unwrap();
 assert_eq!(crate::journey::action(&p,serde_json::from_value(input).unwrap()).await.unwrap(),chapter);
 assert_eq!(crate::companion::preferences_db(&p).await.unwrap().character,"fox");assert_eq!(crate::companion::care_db(&p).await.unwrap().affection,8);
 p.close().await;
}
#[tokio::test]
async fn restore_is_atomic_and_preserves_rewards_and_deduplication() {
    let p=pool().await;let args=serde_json::json!({"requestId":"create","input":{"title":"原目标"}});
    let task=crate::agent_tools::call(&p,"xmission_create_task",args.clone()).await.unwrap();let id=task["task"]["id"].as_str().unwrap();
    crate::task_engine::complete_task_db(&p,id).await.unwrap();let wallet=crate::gamification::build_wallet(&p).await.unwrap();
    let backup=backup_document(&p).await.unwrap();
    crate::agent_tools::call(&p,"xmission_create_task",serde_json::json!({"requestId":"later","input":{"title":"后来的目标"}})).await.unwrap();
    let before=backup_document(&p).await.unwrap();let mut invalid=backup.clone();invalid["tables"]["tasks"][0]["sql"]="DROP TABLE tasks".into();
    assert!(restore_document(&p,&invalid).await.is_err());assert_eq!(backup_document(&p).await.unwrap()["tables"],before["tables"]);
    restore_document(&p,&backup).await.unwrap();
    assert_eq!(sqlx::query_scalar::<_,i64>("SELECT COUNT(*) FROM tasks").fetch_one(&p).await.unwrap(),1);
    assert_eq!(crate::gamification::build_wallet(&p).await.unwrap().coins,wallet.coins);
    assert_eq!(crate::agent_tools::call(&p,"xmission_create_task",args).await.unwrap(),task,"retry receipt survives restore");
    assert_eq!(sqlx::query_scalar::<_,String>("SELECT value FROM settings WHERE key='agent_enabled'").fetch_one(&p).await.unwrap(),"false");
    p.close().await;
}
#[tokio::test]
async fn restored_file_grants_require_explicit_reauthorization() {
    let p=pool().await;let created=crate::agent_tools::call(&p,"xmission_create_task",serde_json::json!({"requestId":"create","input":{"title":"原目标"}})).await.unwrap();let id=created["task"]["id"].as_str().unwrap();
    sqlx::query("INSERT INTO preparation_rules(id,task_id,kind,config_json,start_at,lead_min,created_at,updated_at)VALUES('rule',?,'focus','{}','2026-10-10T19:00:00+08:00',60,'now','now')").bind(id).execute(&p).await.unwrap();
    let backup=backup_document(&p).await.unwrap();restore_document(&p,&backup).await.unwrap();
    let mut tx=crate::gamification::begin_write(&p).await.unwrap();assert!(crate::preparation::pause_tx(&mut tx,"rule",false).await.unwrap_err().contains("重新授权"));tx.rollback().await.unwrap();
    assert!(crate::preparation::tick(&p).await.unwrap().is_none());p.close().await;
}
