use super::*;
struct Fixture { pool:SqlitePool, root:PathBuf, task:String }
impl Fixture {
    async fn new()->Self {
        let root=std::env::temp_dir().join(format!("xmission-preparation-test-{}",uuid::Uuid::new_v4()));
        std::fs::create_dir(&root).unwrap();
        let pool=sqlx::sqlite::SqlitePoolOptions::new().max_connections(1).connect("sqlite::memory:").await.unwrap();
        sqlx::migrate!().run(&pool).await.unwrap();
        let created=crate::agent_tools::call(&pool,"xmission_create_task",json!({"requestId":"create","input":{"title":"论文目标","form":"main_quest"}})).await.unwrap();
        Self { pool,root,task:created["task"]["id"].as_str().unwrap().to_string() }
    }
    fn input(&self,kind:&str)->RuleInput {
        RuleInput { task_id:self.task.clone(),kind:kind.into(),start_at:iso(Utc::now()+Duration::minutes(30)),lead_min:60,
            config:PreparationConfig {topic:"生态系统研究".into(),output_root:self.root.to_string_lossy().into(),sources:vec![],reading:"第一章".into(),mistakes:"定义混淆".into(),search:false,reference_limit:8,focus_min:40,sound:"brown".into(),open_sources:false,notify:false} }
    }
    async fn save(&self,input:RuleInput)->Rule {
        let mut tx=crate::gamification::begin_write(&self.pool).await.unwrap();let r=save_tx(&mut tx,input).await.unwrap();tx.commit().await.unwrap();r
    }
    async fn latest(&self)->Run {sqlx::query_as("SELECT * FROM preparation_runs ORDER BY rowid DESC LIMIT 1").fetch_one(&self.pool).await.unwrap()}
    async fn cleanup(self) {
        self.pool.close().await;
        assert_eq!(self.root.parent(),Some(std::env::temp_dir().as_path()));
        assert!(self.root.file_name().unwrap().to_string_lossy().starts_with("xmission-preparation-test-"));
        std::fs::remove_dir_all(&self.root).unwrap();
    }
}
#[tokio::test]
async fn quiet_preparation_creates_actual_files_without_completing_task_or_rewards() {
    let f=Fixture::new().await;let r=f.save(f.input("writing")).await;
    sqlx::query("INSERT INTO settings(key,value)VALUES('companion_preferences','{\"enabled\":false}')").execute(&f.pool).await.unwrap();
    assert_eq!(tick(&f.pool).await.unwrap(),Some((f.task.clone(),true,false)));
    let run=f.latest().await;assert_eq!(run.state,"ready");assert_eq!(run.version,r.version);assert!(artifacts_exist(&run));
    assert!(read_artifact(&f.pool,&run.id,"START-HERE.md").await.unwrap().contains("生态系统研究"));
    assert!(read_artifact(&f.pool,&run.id,"../../chapter.txt").await.is_err());
    let dir=Path::new(run.output_dir.as_deref().unwrap());
    for file in ["START-HERE.md","materials/README.md","notes/questions.md","drafts/README.md","references/index.md","references/candidates.json","manifest.json"] {assert!(dir.join(file).is_file());}
    assert_eq!(crate::task_engine::fetch_task(&f.pool,&f.task).await.unwrap().status,"open");
    assert_eq!(crate::gamification::build_wallet(&f.pool).await.unwrap().xp_total,0);
    assert_eq!(sqlx::query_scalar::<_,i64>("SELECT COUNT(*) FROM companion_feedback").fetch_one(&f.pool).await.unwrap(),1,"only original task creation may have a pet receipt");
    assert!(tick(&f.pool).await.unwrap().is_none());assert_eq!(f.latest().await.id,run.id);
    f.cleanup().await;
}
#[tokio::test]
async fn edits_cancel_in_flight_work_and_do_not_publish_old_results() {
    let f=Fixture::new().await;f.save(f.input("writing")).await;
    reconcile(&f.pool,Utc::now()).await.unwrap();let(run,rule)=claim(&f.pool,Utc::now()).await.unwrap().unwrap();
    let product=produce(&f.pool,&rule,&run).await;
    let patch=serde_json::from_value(json!({"title":"新的方向","deadline":iso(Utc::now()+Duration::hours(5))})).unwrap();
    crate::task_engine::update_task_db(&f.pool,&f.task,patch).await.unwrap();
    assert!(!current(&f.pool,&run).await.unwrap());assert!(!finish(&f.pool,&run,&rule,product).await.unwrap());
    assert!(!f.root.join(format!("Xmission-preparation-{}",run.id)).exists());
    assert_eq!(f.latest().await.state,"cancelled");
    reconcile(&f.pool,Utc::now()).await.unwrap();let next=f.latest().await;assert_eq!(next.version,2);assert_ne!(next.id,run.id);
    let topic:String=sqlx::query_scalar("SELECT json_extract(config_json,'$.topic') FROM preparation_rules").fetch_one(&f.pool).await.unwrap();assert_eq!(topic,"新的方向");
    let action=time(&next.action_at).unwrap();assert!(action>Utc::now()+Duration::hours(4));
    f.cleanup().await;
}
#[tokio::test]
async fn retries_reuse_the_run_and_restore_missing_artifact_without_overwriting_user_edits() {
    let f=Fixture::new().await;let mut input=f.input("study");
    let material=f.root.join("chapter.txt");std::fs::write(&material,"生态系统是生物群落与环境相互作用形成的统一整体。\n能量沿食物链流动并在各营养级逐级损失。\n").unwrap();
    input.config.sources.push(material.to_string_lossy().into());f.save(input).await;
    std::fs::remove_file(&material).unwrap();tick(&f.pool).await.unwrap();let failed=f.latest().await;assert_eq!(failed.state,"failed");assert!(failed.result_json.is_none());
    std::fs::write(&material,"生态系统是生物群落与环境相互作用形成的统一整体。\n").unwrap();
    let mut tx=crate::gamification::begin_write(&f.pool).await.unwrap();retry_tx(&mut tx,&failed.id).await.unwrap();tx.commit().await.unwrap();
    tick(&f.pool).await.unwrap();let ready=f.latest().await;assert_eq!(ready.state,"ready");assert_eq!(ready.id,failed.id);
    let exercises=Path::new(ready.output_dir.as_deref().unwrap()).join("exercises.md");let original=std::fs::read(&exercises).unwrap();std::fs::remove_file(&exercises).unwrap();
    assert_eq!(list_db(&f.pool,Some(&f.task)).await.unwrap()["runs"][0]["state"],"failed");
    let mut tx=crate::gamification::begin_write(&f.pool).await.unwrap();retry_tx(&mut tx,&ready.id).await.unwrap();tx.commit().await.unwrap();tick(&f.pool).await.unwrap();
    assert_eq!(std::fs::read(&exercises).unwrap(),original);
    std::fs::write(&exercises,"我的修改，必须保留").unwrap();
    // Force a retry through a simulated interruption; never overwrite it.
    sqlx::query("UPDATE preparation_runs SET state='failed' WHERE id=?").bind(&ready.id).execute(&f.pool).await.unwrap();
    let mut tx=crate::gamification::begin_write(&f.pool).await.unwrap();retry_tx(&mut tx,&ready.id).await.unwrap();tx.commit().await.unwrap();tick(&f.pool).await.unwrap();
    assert_eq!(f.latest().await.state,"failed");assert_eq!(std::fs::read_to_string(&exercises).unwrap(),"我的修改，必须保留");
    f.cleanup().await;
}
#[tokio::test]
async fn pause_delete_expiry_and_lease_recovery_do_not_replay_old_actions() {
    let f=Fixture::new().await;let rule=f.save(f.input("focus")).await;
    reconcile(&f.pool,Utc::now()).await.unwrap();let(run,_)=claim(&f.pool,Utc::now()).await.unwrap().unwrap();
    let mut tx=crate::gamification::begin_write(&f.pool).await.unwrap();pause_tx(&mut tx,&rule.id,true).await.unwrap();tx.commit().await.unwrap();
    assert!(!current(&f.pool,&run).await.unwrap());assert!(tick(&f.pool).await.unwrap().is_none());
    let mut tx=crate::gamification::begin_write(&f.pool).await.unwrap();pause_tx(&mut tx,&rule.id,false).await.unwrap();tx.commit().await.unwrap();
    reconcile(&f.pool,Utc::now()).await.unwrap();let(next,_)=claim(&f.pool,Utc::now()).await.unwrap().unwrap();assert_ne!(next.id,run.id);
    sqlx::query("UPDATE preparation_runs SET lease_until=? WHERE id=?").bind(iso(Utc::now()-Duration::seconds(1))).bind(&next.id).execute(&f.pool).await.unwrap();
    reconcile(&f.pool,Utc::now()).await.unwrap();assert_eq!(f.latest().await.state,"failed");let(retried,retried_rule)=claim(&f.pool,Utc::now()).await.unwrap().unwrap();assert_eq!(retried.id,next.id);
    assert!(!current(&f.pool,&next).await.unwrap(),"an expired attempt cannot own a reclaimed run");
    assert!(!finish(&f.pool,&next,&retried_rule,Err("旧尝试晚到的失败".into())).await.unwrap());
    assert_eq!(f.latest().await.state,"running","late old failure cannot cancel the new attempt");
    crate::agent_tools::call(&f.pool,"xmission_delete_task",json!({"id":f.task,"requestId":"delete"})).await.unwrap();assert!(!current(&f.pool,&retried).await.unwrap());assert!(tick(&f.pool).await.unwrap().is_none());
    f.cleanup().await;
    let f=Fixture::new().await;let mut input=f.input("focus");input.start_at=iso(Utc::now()-Duration::hours(3));f.save(input).await;
    assert!(tick(&f.pool).await.unwrap().is_none());assert_eq!(f.latest().await.state,"skipped");f.cleanup().await;
}
#[tokio::test]
async fn study_requires_material_and_focus_preferences_are_session_scoped() {
    let f=Fixture::new().await;assert!(validate(&f.input("study")).is_err());
    f.save(f.input("focus")).await;let session=crate::pomodoro::start_session_db(&f.pool,Some(f.task.clone())).await.unwrap();assert_eq!(session.duration_min,40);
    let other=crate::pomodoro::start_session_db(&f.pool,None).await.unwrap();assert_eq!(other.duration_min,25);
    // Nothing opened or sounded by the preparation worker itself.
    tick(&f.pool).await.unwrap();assert_eq!(f.latest().await.state,"ready");
    assert_eq!(sqlx::query_scalar::<_,i64>("SELECT COUNT(*) FROM settings WHERE key LIKE 'focus_environment:%'").fetch_one(&f.pool).await.unwrap(),0);
    f.cleanup().await;
}
#[tokio::test]
async fn weekly_schedule_and_claw_controls_preserve_task_permissions() {
    let f=Fixture::new().await;
    crate::task_engine::update_task_db(&f.pool,&f.task,serde_json::from_value(json!({"recurrence":"weekly","recurDays":"1,3,5"})).unwrap()).await.unwrap();
    let rule=f.save(f.input("writing")).await;let task=crate::task_engine::fetch_task(&f.pool,&f.task).await.unwrap();
    let at=occurrence(&rule,&task,Utc::now()).unwrap().unwrap();assert!([1,3,5].contains(&at.with_timezone(&Local).weekday().number_from_monday()));
    let args=json!({"id":rule.id,"paused":true,"requestId":"pause"});
    let result=crate::agent_tools::call(&f.pool,"xmission_pause_preparation",args.clone()).await.unwrap();assert_eq!(result,crate::agent_tools::call(&f.pool,"xmission_pause_preparation",args).await.unwrap());
    assert_eq!(crate::task_engine::fetch_task(&f.pool,&f.task).await.unwrap().status,"open");
    assert_eq!(crate::agent_tools::call(&f.pool,"xmission_list_preparations",json!({"taskId":f.task})).await.unwrap()["rules"][0]["enabled"],false);
    f.cleanup().await;
}
#[tokio::test]
async fn claw_scheduled_checks_are_deduplicated_and_use_existing_file_grants() {
    let f=Fixture::new().await;f.save(f.input("writing")).await;
    let args=json!({"requestId":"scheduled"});
    let checked=crate::agent_tools::call(&f.pool,"xmission_prepare_due",args.clone()).await.unwrap();
    assert_eq!(checked["processed"]["prepared"],true);
    assert_eq!(checked,crate::agent_tools::call(&f.pool,"xmission_prepare_due",args).await.unwrap());
    assert_eq!(sqlx::query_scalar::<_,i64>("SELECT COUNT(*) FROM preparation_runs").fetch_one(&f.pool).await.unwrap(),1);
    assert_eq!(crate::gamification::build_wallet(&f.pool).await.unwrap().coins,0);
    f.cleanup().await;
}
#[tokio::test]
async fn one_goal_can_keep_writing_and_focus_agreements_without_duplicate_tasks() {
    let f=Fixture::new().await;
    let writing=f.save(f.input("writing")).await;
    let focus=f.save(f.input("focus")).await;assert_ne!(writing.id,focus.id);
    tick(&f.pool).await.unwrap();tick(&f.pool).await.unwrap();
    assert_eq!(sqlx::query_scalar::<_,i64>("SELECT COUNT(*) FROM tasks").fetch_one(&f.pool).await.unwrap(),1);
    assert_eq!(sqlx::query_scalar::<_,i64>("SELECT COUNT(*) FROM preparation_runs WHERE state='ready'").fetch_one(&f.pool).await.unwrap(),2);
    let session=crate::pomodoro::start_session_db(&f.pool,Some(f.task.clone())).await.unwrap();assert_eq!(session.duration_min,40);
    let mut changed=f.input("writing");changed.config.topic="更换研究方向".into();let updated=f.save(changed).await;assert_eq!(updated.id,writing.id);assert_eq!(updated.version,2);
    let home=list_db(&f.pool,Some(&f.task)).await.unwrap();assert_eq!(home["rules"].as_array().unwrap().len(),2);
    let states:Vec<String>=sqlx::query_scalar("SELECT state FROM preparation_runs WHERE rule_id=?").bind(&focus.id).fetch_all(&f.pool).await.unwrap();assert_eq!(states,vec!["ready"]);
    f.cleanup().await;
}
