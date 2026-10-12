use super::*;
use crate::{agent_tools, gamification, steps, task_engine};

async fn pool() -> SqlitePool {
    let pool=sqlx::sqlite::SqlitePoolOptions::new().max_connections(1).connect("sqlite::memory:").await.unwrap();
    sqlx::migrate!().run(&pool).await.unwrap();
    sqlx::query("INSERT INTO settings(key,value)VALUES('agent_enabled','true')").execute(&pool).await.unwrap();
    pool
}
async fn write(pool:&SqlitePool, name:&str, args:Value) -> Value {
    agent_tools::call(pool,name,args).await.unwrap()
}
fn client() -> reqwest::Client {reqwest::Client::builder().no_proxy().build().unwrap()}
async fn rpc(server:&Running,method:&str,params:Value) -> Value {
    let response=client().post(format!("http://127.0.0.1:{}/mcp",server.bridge.port))
        .bearer_auth(&server.bridge.token).header("Accept","application/json, text/event-stream")
        .json(&json!({"jsonrpc":"2.0","id":"call","method":method,"params":params})).send().await.unwrap();
    assert_eq!(response.status(),StatusCode::OK);
    response.json().await.unwrap()
}

#[tokio::test]
async fn real_http_mcp_auth_discovery_and_mutation() {
    let pool=pool().await;
    let server=launch(pool.clone(),"test-secret".into(),0).await.unwrap();
    let url=format!("http://127.0.0.1:{}/mcp",server.bridge.port);
    probe(&url,"test-secret",agent_tools::catalog().len()).await.unwrap();
    assert!(probe(&url,"wrong",agent_tools::catalog().len()).await.is_err());
    let offline_request=json!({"name":"xmission_create_task","arguments":{"requestId":"forwarded","input":{"title":"转交界面"}}});
    assert!(crate::agent_once::forward(&url,"test-secret","other-database",&offline_request).await.is_err());
    assert!(crate::agent_once::forward(&url,"wrong",&server.bridge.data_scope,&offline_request).await.is_err());
    assert_eq!(sqlx::query_scalar::<_,i64>("SELECT COUNT(*) FROM tasks").fetch_one(&pool).await.unwrap(),0);
    let forwarded=crate::agent_once::forward(&url,"test-secret",&server.bridge.data_scope,&offline_request).await.unwrap().unwrap();
    assert_eq!(forwarded["task"]["title"],"转交界面");
    let unbound=tokio::net::TcpListener::bind((std::net::Ipv4Addr::LOCALHOST,0)).await.unwrap();
    let absent=format!("http://127.0.0.1:{}/mcp",unbound.local_addr().unwrap().port());
    drop(unbound);
    assert!(crate::agent_once::forward(&absent,"test-secret",&server.bridge.data_scope,&offline_request).await.unwrap().is_none());
    let request=json!({"jsonrpc":"2.0","id":1,"method":"tools/list"});
    assert_eq!(client().post(&url).json(&request).send().await.unwrap().status(),StatusCode::UNAUTHORIZED);
    assert_eq!(client().post(&url).bearer_auth("wrong").json(&request).send().await.unwrap().status(),StatusCode::UNAUTHORIZED);
    assert_eq!(client().post(&url).bearer_auth("test-secret").header("Origin","https://evil.example").json(&request).send().await.unwrap().status(),StatusCode::FORBIDDEN);
    assert_eq!(client().post(&url).bearer_auth("test-secret").header("Host","evil.example").json(&request).send().await.unwrap().status(),StatusCode::FORBIDDEN);
    assert_eq!(client().post(&url).bearer_auth("test-secret").header("MCP-Protocol-Version","unknown").json(&request).send().await.unwrap().status(),StatusCode::BAD_REQUEST);
    assert_eq!(client().get(&url).bearer_auth("test-secret").send().await.unwrap().status(),StatusCode::METHOD_NOT_ALLOWED);
    assert_eq!(client().post(&url).bearer_auth("test-secret").json(&json!({"jsonrpc":"2.0","method":"notifications/initialized"})).send().await.unwrap().status(),StatusCode::ACCEPTED);
    let initialized=rpc(&server,"initialize",json!({"protocolVersion":"2025-11-25","clientInfo":{"name":"test","version":"1"},"capabilities":{}})).await;
    assert_eq!(initialized["result"]["protocolVersion"],"2025-11-25");
    let catalog=rpc(&server,"tools/list",json!({})).await;
    assert_eq!(catalog["result"]["tools"].as_array().unwrap().len(),agent_tools::catalog().len());
    let created=rpc(&server,"tools/call",json!({"name":"xmission_create_task","arguments":{"requestId":"http-create","input":{"title":"周五前完成语文作业"}}})).await;
    assert_eq!(created["result"]["isError"],false);
    let id=created["result"]["structuredContent"]["task"]["id"].as_str().unwrap();
    let completed=rpc(&server,"tools/call",json!({"name":"xmission_complete_task","arguments":{"id":id,"requestId":"http-done"}})).await;
    assert_eq!(completed["result"]["structuredContent"]["task"]["status"],"done");
    assert_eq!(completed["result"]["structuredContent"]["wallet"]["xpTotal"],14);
    let error=rpc(&server,"tools/call",json!({"name":"xmission_create_task","arguments":{"input":{"title":"Missing retry ID"}}})).await;
    assert_eq!(error["result"]["isError"],true);
    let context=rpc(&server,"tools/call",json!({"name":"xmission_get_context","arguments":{}})).await;
    assert!(context["result"]["structuredContent"]["now"].as_str().is_some());
    assert_eq!(rpc(&server,"unknown",json!({})).await["error"]["code"],-32601);
    let old_port=server.bridge.port;
    let old_active=server.bridge.active.clone();
    server.stop().await;
    assert!(!old_active.load(Ordering::Acquire));
    // Stop releases the listener, and the original gate cannot authorize more calls.
    let again=launch(pool.clone(),"new-secret".into(),old_port).await.unwrap();
    let response=client().post(format!("http://127.0.0.1:{}/mcp",again.bridge.port)).bearer_auth("test-secret").json(&request).send().await.unwrap();
    assert_eq!(response.status(),StatusCode::UNAUTHORIZED);
    again.stop().await;pool.close().await;
}

#[tokio::test]
async fn stop_revokes_queued_mutations_before_waiting_for_in_flight_work() {
    let pool=pool().await;
    let server=launch(pool.clone(),"queue-secret".into(),0).await.unwrap();
    let bridge=server.bridge.clone();
    // Represent an already-authorized transaction holding the operation gate.
    let in_flight=bridge.operation.lock().await;
    let mut headers=HeaderMap::new();
    headers.insert("host",format!("127.0.0.1:{}",bridge.port).parse().unwrap());
    headers.insert("authorization","Bearer queue-secret".parse().unwrap());
    headers.insert("content-type","application/json".parse().unwrap());
    let body=Bytes::from(json!({"jsonrpc":"2.0","id":1,"method":"tools/call","params":{
        "name":"xmission_create_task","arguments":{"requestId":"queued","input":{"title":"不得在关闭后创建"}}
    }}).to_string());
    let mut queued=Box::pin(endpoint(State(bridge.clone()),Method::POST,headers,body));
    // Poll once so it queues before stop: the old single mutex let it write.
    assert!(tokio::time::timeout(std::time::Duration::from_millis(10),&mut queued).await.is_err());
    let stopping=tokio::spawn(server.stop());
    tokio::time::timeout(std::time::Duration::from_secs(2),async {
        while bridge.active.load(Ordering::Acquire) {tokio::task::yield_now().await;}
    }).await.unwrap();
    assert!(!stopping.is_finished(),"stop must wait for the authorized transaction");
    drop(in_flight);
    assert_eq!(queued.await.status(),StatusCode::UNAUTHORIZED);
    stopping.await.unwrap();
    for table in ["tasks","agent_requests"] {
        assert_eq!(sqlx::query_scalar::<_,i64>(&format!("SELECT COUNT(*) FROM {table}")).fetch_one(&pool).await.unwrap(),0);
    }
    pool.close().await;
}

#[tokio::test]
async fn recurring_check_ins_and_nullable_patches_preserve_ui_rules() {
    let pool=pool().await;
    let created=write(&pool,"xmission_create_task",json!({"requestId":"daily-create","input":{
        "title":"每天读书","recurrence":"daily","notes":"旧备注","deadline":"2026-10-09","estimatedMin":20
    }})).await;
    let id=created["task"]["id"].as_str().unwrap();
    let edited=write(&pool,"xmission_update_task",json!({"requestId":"daily-clear","id":id,"patch":{
        "notes":null,"deadline":null,"estimatedMin":null,"plannedDate":null
    }})).await;
    for key in ["notes","deadline","estimatedMin","plannedDate"] {assert!(edited["task"][key].is_null());}
    let args=json!({"requestId":"daily-done","id":id});
    let first=write(&pool,"xmission_complete_task",args.clone()).await;
    let again=write(&pool,"xmission_complete_task",json!({"requestId":"daily-second","id":id})).await;
    assert_eq!(first["wallet"]["xpTotal"],again["wallet"]["xpTotal"]);
    assert_eq!(first["task"]["lastDoneDate"],gamification::task_day(chrono::Local::now()).to_string());
    assert_ne!(first["task"]["status"],"done");
    write(&pool,"xmission_reopen_task",json!({"requestId":"daily-undo","id":id})).await;
    write(&pool,"xmission_complete_task",args).await;
    assert_eq!(gamification::build_wallet(&pool).await.unwrap().xp_total,0);
    assert!(task_engine::fetch_task(&pool,id).await.unwrap().last_done_date.is_none());
    assert!(agent_tools::call(&pool,"xmission_update_task",json!({"requestId":"bad-status","id":id,"patch":{"status":"done"}})).await.is_err());
    assert!(agent_tools::call(&pool,"xmission_update_task",json!({"requestId":"bad-weekly","id":id,"patch":{"recurrence":"weekly"}})).await.is_err());
    pool.close().await;
}

#[tokio::test]
async fn direct_crud_nested_steps_and_reward_invariants() {
    let pool=pool().await;
    let input=json!({"requestId":"create","input":{"title":"实验报告","form":"main_quest","importance":4,"deadline":"2026-10-09"},
        "steps":[{"title":"查资料"},{"title":"整理引用","parentIndex":0},{"title":"写初稿"}]});
    let created=write(&pool,"xmission_create_task",input.clone()).await;
    assert_eq!(created,write(&pool,"xmission_create_task",input).await);
    let id=created["task"]["id"].as_str().unwrap();
    let step_id=created["steps"][0]["id"].as_str().unwrap();
    assert_eq!(created["steps"][1]["parentStepId"],step_id);
    let edited=write(&pool,"xmission_update_task",json!({"requestId":"edit","id":id,"patch":{"title":"报告修改","notes":"周五前提交","deadline":null,"plannedDate":"2026-10-08"}})).await;
    assert_eq!(edited["task"]["title"],"报告修改");assert!(edited["task"]["deadline"].is_null());
    let edited=write(&pool,"xmission_update_step",json!({"requestId":"step-edit","id":step_id,"patch":{"title":"找论文","estimatedMin":25}})).await;
    assert_eq!(edited["step"]["estimatedMin"],25);
    write(&pool,"xmission_update_step",json!({"requestId":"step-clear","id":step_id,"patch":{"estimatedMin":null}})).await;
    let other=write(&pool,"xmission_create_task",json!({"requestId":"other","input":{"title":"其他任务"}})).await;
    assert!(agent_tools::call(&pool,"xmission_add_step",json!({"requestId":"cross","taskId":other["task"]["id"],"title":"跨任务步骤","parentStepId":step_id})).await.is_err());
    write(&pool,"xmission_complete_step",json!({"requestId":"step-done","id":step_id})).await;
    write(&pool,"xmission_complete_step",json!({"requestId":"step-done-again","id":step_id})).await;
    assert_eq!(gamification::build_wallet(&pool).await.unwrap().xp_total,7);
    write(&pool,"xmission_reopen_step",json!({"requestId":"step-undo","id":step_id})).await;
    assert_eq!(gamification::build_wallet(&pool).await.unwrap().xp_total,0);
    let completion=json!({"requestId":"done","id":id});
    let (a,b)=tokio::join!(agent_tools::call(&pool,"xmission_complete_task",completion.clone()),agent_tools::call(&pool,"xmission_complete_task",completion.clone()));
    assert_eq!(a.unwrap(),b.unwrap());
    assert_eq!(gamification::build_wallet(&pool).await.unwrap().xp_total,17);
    write(&pool,"xmission_reopen_task",json!({"requestId":"undo","id":id})).await;
    // An old completion retry must not re-complete a task deliberately reopened later.
    write(&pool,"xmission_complete_task",completion).await;
    assert_eq!(task_engine::fetch_task(&pool,id).await.unwrap().status,"open");
    assert_eq!(gamification::build_wallet(&pool).await.unwrap().xp_total,0);
    assert!(agent_tools::call(&pool,"xmission_update_task",json!({"requestId":"done","id":id,"patch":{"title":"conflict"}})).await.is_err());
    let child=write(&pool,"xmission_create_task",json!({"requestId":"child","input":{"title":"支线","form":"side_quest","parentId":id}})).await;
    write(&pool,"xmission_delete_step",json!({"requestId":"step-delete","id":step_id})).await;
    assert_eq!(steps::list_steps_db(&pool,id).await.unwrap().len(),1);
    let deletion=json!({"requestId":"delete","id":id});
    write(&pool,"xmission_delete_task",deletion.clone()).await;
    write(&pool,"xmission_delete_task",deletion).await;
    assert!(task_engine::fetch_task(&pool,id).await.is_err());
    assert!(task_engine::fetch_task(&pool,child["task"]["id"].as_str().unwrap()).await.unwrap().parent_id.is_none());
    assert_eq!(sqlx::query_scalar::<_,i64>("SELECT COUNT(*) FROM task_steps").fetch_one(&pool).await.unwrap(),0);
    pool.close().await;
}

#[tokio::test]
async fn failed_tree_creation_rolls_back_task_steps_and_receipt() {
    let pool=pool().await;
    for steps in [json!([{"title":"valid"},{"title":"invalid parent","parentIndex":1}]),json!([{"title":"valid"},{"title":"   "}])] {
        assert!(agent_tools::call(&pool,"xmission_create_task",json!({"requestId":"failed","input":{"title":"rollback"},"steps":steps})).await.is_err());
    }
    for table in ["tasks","task_steps","agent_requests"] {
        assert_eq!(sqlx::query_scalar::<_,i64>(&format!("SELECT COUNT(*) FROM {table}")).fetch_one(&pool).await.unwrap(),0);
    }
    assert!(agent_tools::call(&pool,"xmission_create_task",json!({"requestId":"bad-field","input":{"title":"x","deadLine":"2026-10-09"}})).await.is_err());
    assert!(agent_tools::call(&pool,"xmission_create_task",json!({"requestId":"bad-date","input":{"title":"x","deadline":"next Friday"}})).await.is_err());
    let result=write(&pool,"xmission_create_task",json!({"requestId":"failed","input":{"title":"可以重新提交"}})).await;
    assert!(result["task"]["id"].is_string());pool.close().await;
}

#[tokio::test]
async fn receipt_survives_database_and_http_server_restart() {
    let dir=std::env::temp_dir().join(format!("xmission-agent-{}",uuid::Uuid::new_v4()));
    let pool=crate::db::init_pool(&dir).await.unwrap();
    sqlx::query("INSERT INTO settings(key,value)VALUES('agent_enabled','true')").execute(&pool).await.unwrap();
    let server=launch(pool.clone(),"restart-test".into(),0).await.unwrap();
    let args=json!({"requestId":"durable","input":{"title":"一次创建"}});
    let before=rpc(&server,"tools/call",json!({"name":"xmission_create_task","arguments":args})).await;
    server.stop().await;pool.close().await;
    let pool=crate::db::init_pool(&dir).await.unwrap();
    let server=launch(pool.clone(),"restart-test".into(),0).await.unwrap();
    let after=rpc(&server,"tools/call",json!({"name":"xmission_create_task","arguments":args})).await;
    assert_eq!(before,after);
    assert_eq!(sqlx::query_scalar::<_,i64>("SELECT COUNT(*) FROM tasks").fetch_one(&pool).await.unwrap(),1);
    server.stop().await;pool.close().await;
    for i in 0..20 {
        if std::fs::remove_dir_all(&dir).is_ok() {break;}
        assert!(i<19);tokio::time::sleep(std::time::Duration::from_millis(25)).await;
    }
}

#[tokio::test]
async fn receipt_failure_rolls_back_completion_and_both_ledgers() {
    let pool=pool().await;
    let created=write(&pool,"xmission_create_task",json!({"requestId":"atomic-create","input":{"title":"事务校验"}})).await;
    let id=created["task"]["id"].as_str().unwrap();
    sqlx::query("CREATE TRIGGER fail_agent_receipt BEFORE INSERT ON agent_requests BEGIN SELECT RAISE(ABORT, 'receipt failure'); END")
        .execute(&pool).await.unwrap();
    let args=json!({"requestId":"atomic-complete","id":id});
    assert!(agent_tools::call(&pool,"xmission_complete_task",args.clone()).await.is_err());
    assert_eq!(task_engine::fetch_task(&pool,id).await.unwrap().status,"open");
    let wallet=gamification::build_wallet(&pool).await.unwrap();
    assert_eq!((wallet.xp_total,wallet.coins,wallet.streak),(0,0,0));
    sqlx::query("DROP TRIGGER fail_agent_receipt").execute(&pool).await.unwrap();
    write(&pool,"xmission_complete_task",args.clone()).await;
    write(&pool,"xmission_complete_task",args).await;
    let wallet=gamification::build_wallet(&pool).await.unwrap();
    assert_eq!((wallet.xp_total,wallet.coins),(14,7));
    pool.close().await;
}
