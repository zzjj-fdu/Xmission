use super::*;
async fn fixture()->(SqlitePool,String) {
    let p=sqlx::sqlite::SqlitePoolOptions::new().max_connections(1).connect("sqlite::memory:").await.unwrap();sqlx::migrate!().run(&p).await.unwrap();
    let t=crate::agent_tools::call(&p,"xmission_create_task",json!({"requestId":"task","input":{"title":"实际目标"}})).await.unwrap();
    (p,t["task"]["id"].as_str().unwrap().into())
}
fn input(action:&str,id:Option<&str>,node:Option<i64>,task:Option<&str>,choice:Option<&str>)->JourneyInput {
    JourneyInput {request_id:uuid::Uuid::new_v4().to_string(),action:action.into(),id:id.map(str::to_owned),expected_node:node,theme:Some("pixel-jrpg".into()),task_id:task.map(str::to_owned),choice:choice.map(str::to_owned),moves:Some(6)}
}
#[tokio::test]
async fn character_chapters_and_request_retries_are_scoped(){
 let(p,_)=fixture().await;
 let start=input("start",None,None,None,None);let retry=serde_json::from_value(serde_json::to_value(&start).unwrap()).unwrap();
 let fox=action(&p,start).await.unwrap();let fox_id=fox["chapter"]["id"].as_str().unwrap();
 crate::companion::update_preferences_db(&p,json!({"character":"red-panda"})).await.unwrap();
 assert_eq!(home(&p).await.unwrap()["chapter"],Value::Null);
 assert!(action(&p,retry).await.unwrap_err().contains("另一位伙伴"));
 assert!(action(&p,input("bag",Some(fox_id),Some(0),None,Some("compass"))).await.is_err());
 let panda=action(&p,input("start",None,None,None,None)).await.unwrap();let panda_id=panda["chapter"]["id"].as_str().unwrap();assert_ne!(fox_id,panda_id);
 action(&p,input("bag",Some(panda_id),Some(0),None,Some("notebook"))).await.unwrap();
 crate::companion::update_preferences_db(&p,json!({"character":"fox"})).await.unwrap();
 assert_eq!(home(&p).await.unwrap()["chapter"]["id"],fox_id);assert_eq!(home(&p).await.unwrap()["chapter"]["node"],0);
 p.close().await;
}
#[tokio::test]
async fn full_chapter_requires_real_completion_and_keeps_one_guaranteed_souvenir() {
    let(p,task)=fixture().await;
    let started=action(&p,input("start",None,None,Some(&task),None)).await.unwrap();let id=started["chapter"]["id"].as_str().unwrap();
    assert!(action(&p,input("claim",Some(id),Some(0),None,None)).await.is_err());
    action(&p,input("bag",Some(id),Some(0),None,Some("compass"))).await.unwrap();
    let routed=action(&p,input("route",Some(id),Some(1),None,Some("ridge"))).await.unwrap();assert_eq!(routed["chapter"]["discovery"],"hidden-star");
    action(&p,input("play",Some(id),Some(2),None,None)).await.unwrap();
    assert_eq!(home(&p).await.unwrap()["commissionReady"],false);
    assert!(action(&p,input("commission",Some(id),Some(3),None,None)).await.is_err());
    assert_eq!(crate::gamification::build_wallet(&p).await.unwrap().coins,0);
    crate::task_engine::complete_task_db(&p,&task).await.unwrap();
    assert_eq!(home(&p).await.unwrap()["commissionReady"],true);
    action(&p,input("commission",Some(id),Some(3),None,None)).await.unwrap();
    let args=input("claim",Some(id),Some(4),None,None);let retry=serde_json::from_value(serde_json::to_value(&args).unwrap()).unwrap();
    let wallet=crate::gamification::build_wallet(&p).await.unwrap();
    let result=action(&p,args).await.unwrap();assert_eq!(result,action(&p,retry).await.unwrap());assert_eq!(result["chapter"]["node"],5);
    assert_eq!(home(&p).await.unwrap()["keepsakes"].as_array().unwrap().len(),1);
    assert_eq!(crate::gamification::build_wallet(&p).await.unwrap().coins,wallet.coins,"chapter collection adds no extra task rewards");
    assert!(!home(&p).await.unwrap()["keepsakes"][0]["story"].as_str().unwrap().contains("实际目标"));
    p.close().await;
}
#[tokio::test]
async fn pause_relink_and_undo_keep_real_and_game_progress_separate() {
    let(p,task)=fixture().await;let start=action(&p,input("start",None,None,Some(&task),None)).await.unwrap();let id=start["chapter"]["id"].as_str().unwrap();
    action(&p,input("pause",Some(id),Some(0),None,None)).await.unwrap();assert!(action(&p,input("bag",Some(id),Some(0),None,Some("notebook"))).await.is_err());
    action(&p,input("resume",Some(id),Some(0),None,None)).await.unwrap();action(&p,input("bag",Some(id),Some(0),None,Some("notebook"))).await.unwrap();
    let route=action(&p,input("route",Some(id),Some(1),None,Some("river"))).await.unwrap();assert_eq!(route["chapter"]["discovery"],"leaf-page");
    action(&p,input("play",Some(id),Some(2),None,None)).await.unwrap();
    crate::task_engine::complete_task_db(&p,&task).await.unwrap();crate::task_engine::reopen_task_db(&p,&task).await.unwrap();
    assert_eq!(home(&p).await.unwrap()["commissionReady"],false);
    action(&p,input("link",Some(id),Some(3),None,None)).await.unwrap();assert_eq!(home(&p).await.unwrap()["chapter"]["taskId"],Value::Null);
    assert_eq!(home(&p).await.unwrap()["chapter"]["node"],3);
    p.close().await;
}
