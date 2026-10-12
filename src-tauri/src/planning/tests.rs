use super::*;
use chrono::TimeZone;
pub(crate) async fn pool()->SqlitePool{
 let p=sqlx::sqlite::SqlitePoolOptions::new().max_connections(1).connect("sqlite::memory:").await.unwrap();sqlx::migrate!().run(&p).await.unwrap();
 sqlx::query("INSERT INTO tasks(id,title,form,created_at,deadline)VALUES('goal','毕业项目','main_quest','2026-10-01','2026-10-09')").execute(&p).await.unwrap();
 sqlx::query("INSERT INTO task_steps(id,task_id,parent_step_id,title,order_index,deadline,estimated_min)VALUES('phase1','goal',NULL,'阅读',0,'2026-10-08',30),('leaf','goal','phase1','第三章',0,'2026-10-08',30),('phase2','goal',NULL,'写作',1,'2026-10-09',60)").execute(&p).await.unwrap();p
}
fn now()->DateTime<Local>{Local.with_ymd_and_hms(2026,10,7,10,0,0).single().unwrap()}
#[tokio::test]
async fn today_is_projection_and_completing_it_updates_original_step_once(){
 let p=pool().await;let mut tx=p.begin().await.unwrap();let s=snapshot(&mut tx).await.unwrap();tx.commit().await.unwrap();let o=overview(&s,now());
 assert_eq!(o.actions.len(),1);assert_eq!(o.actions[0].step_id.as_deref(),Some("leaf"));assert_eq!(o.actions[0].goal_title,"毕业项目");
 crate::steps::set_step_completed(&p,"leaf",true).await.unwrap();crate::steps::set_step_completed(&p,"leaf",true).await.unwrap();
 let mut tx=p.begin().await.unwrap();let o=overview(&snapshot(&mut tx).await.unwrap(),now());assert_eq!(o.actions[0].step_id.as_deref(),Some("phase1"));assert_eq!(o.actions[0].estimated_min,1);assert!(o.actions[0].title.starts_with("核对阶段："));assert!(o.actions[0].reasons.contains(&"截止临近".into()));tx.commit().await.unwrap();
 assert_eq!(sqlx::query_scalar::<_,i64>("SELECT COUNT(*) FROM tasks").fetch_one(&p).await.unwrap(),1);
 assert_eq!(sqlx::query_scalar::<_,i64>("SELECT COUNT(*) FROM xp_ledger WHERE reason='step'").fetch_one(&p).await.unwrap(),1);
 crate::steps::set_step_completed(&p,"phase1",true).await.unwrap();let mut tx=p.begin().await.unwrap();let s=snapshot(&mut tx).await.unwrap();let o=overview(&s,now());assert_eq!(o.goals[0].active_stage.as_deref(),Some("phase2"));assert_eq!(o.goals[0].advance_from.as_deref(),Some("phase1"));
}
#[tokio::test]
async fn paused_goal_and_its_child_never_surface(){
 let p=pool().await;sqlx::query("UPDATE tasks SET status='shelved' WHERE id='goal'").execute(&p).await.unwrap();let mut tx=p.begin().await.unwrap();let o=overview(&snapshot(&mut tx).await.unwrap(),now());assert!(o.actions.is_empty());assert!(o.goals[0].paused);
}
#[tokio::test]
async fn replan_rejects_changed_courses_or_completion_and_is_atomic(){
 let p=pool().await;let preview=preview_replan_db(&p,Local::now()).await.unwrap();
 sqlx::query("UPDATE task_steps SET title='改成第四章' WHERE id='leaf'").execute(&p).await.unwrap();assert!(apply_replan_db(&p,&preview.id).await.is_err());
 assert_eq!(sqlx::query_scalar::<_,i64>("SELECT COUNT(*) FROM planning_schedule").fetch_one(&p).await.unwrap(),0);
 let preview=preview_replan_db(&p,Local::now()).await.unwrap();apply_replan_db(&p,&preview.id).await.unwrap();apply_replan_db(&p,&preview.id).await.unwrap();
 assert!(sqlx::query_scalar::<_,i64>("SELECT COUNT(*) FROM planning_schedule").fetch_one(&p).await.unwrap()>0);
 sqlx::query("UPDATE task_steps SET estimated_min=90 WHERE id='leaf'").execute(&p).await.unwrap();assert_eq!(sqlx::query_scalar::<_,i64>("SELECT COUNT(*) FROM planning_schedule WHERE step_id='leaf'").fetch_one(&p).await.unwrap(),0);
}
#[tokio::test]
async fn replan_avoids_overridden_classes_and_capacity_preserves_deadline(){
 let p=pool().await;sqlx::query("INSERT INTO settings(key,value)VALUES('daily_capacity_min','30')").execute(&p).await.unwrap();
 sqlx::query("INSERT INTO courses(id,name,weeks_mask,week_parity,created_at)VALUES('course','临时课','1-99','all','2026-10-07')").execute(&p).await.unwrap();
 sqlx::query("INSERT INTO course_slots(id,course_id,weekday,start_time,end_time)VALUES('slot','course',3,'09:00','12:00')").execute(&p).await.unwrap();
 let mut tx=p.begin().await.unwrap();let s=snapshot(&mut tx).await.unwrap();tx.commit().await.unwrap();let preview=build_preview(&p,&s,now()).await.unwrap();let first=&preview.rows[0];let start=DateTime::parse_from_rfc3339(first.starts_at.as_ref().unwrap()).unwrap();assert!(start.hour()>=12);assert_eq!(first.minutes,30);assert_eq!(s.tasks[0].deadline.as_deref(),Some("2026-10-09"));
}
#[tokio::test]
async fn review_reports_unmeasured_as_null_and_only_recorded_focus(){
 let p=pool().await;sqlx::query("UPDATE tasks SET status='done',completed_at=?,estimated_min=60 WHERE id='goal'").bind(now().to_rfc3339()).execute(&p).await.unwrap();
 let report=review_db(&p,7,now()).await.unwrap();assert!(report["comparisons"][0]["actualFocusMin"].is_null());assert_eq!(report["goals"][0]["completed"],true);
 sqlx::query("INSERT INTO pomodoro_sessions(id,task_id,started_at,duration_min,state,remaining_secs,updated_at)VALUES('p','goal',?,25,'abandoned',300,?)").bind(now().to_rfc3339()).bind(now().to_rfc3339()).execute(&p).await.unwrap();let report=review_db(&p,7,now()).await.unwrap();assert_eq!(report["comparisons"][0]["actualFocusMin"],20);assert_eq!(report["comparisons"][0]["differenceMin"],-40);
}
#[tokio::test]
async fn recurring_trends_keep_daily_receipts_and_remove_undone_checkin(){
 let p=pool().await;sqlx::query("UPDATE tasks SET recurrence='daily' WHERE id='goal'").execute(&p).await.unwrap();
 for (id,at,delta,reason) in [("a","2026-10-06T12:00:00+08:00",10,"task"),("b","2026-10-07T12:00:00+08:00",10,"task"),("c","2026-10-07T13:00:00+08:00",-10,"task-revoke")]{let day=at[..10].to_owned();sqlx::query("INSERT INTO xp_ledger(id,delta,reason,ref_id,created_at)VALUES(?,?,?,?,?)").bind(id).bind(delta).bind(reason).bind(format!("goal:{day}")).bind(at).execute(&p).await.unwrap();}
 let report=review_db(&p,7,now()).await.unwrap();assert_eq!(report["trend"][5]["checkins"],1);assert_eq!(report["trend"][6]["checkins"],0);
}
#[tokio::test]
async fn queued_reminder_survives_restart_view_but_stale_time_and_completion_remove_it(){
 let p=pool().await;let now=Local::now();sqlx::query("UPDATE tasks SET planned_date=?,deadline=NULL WHERE id='goal'").bind(crate::gamification::task_day(now).to_string()).execute(&p).await.unwrap();
 // A single ordinary task uses the existing reminder projection; no new task is made.
 sqlx::query("DELETE FROM task_steps").execute(&p).await.unwrap();let items=crate::companion::today_items(&p,now).await.unwrap();let task=items.into_iter().find(|i|i.id=="goal").unwrap();
 crate::companion::queue_due_items(&p,&[task.clone()],now.timestamp_millis()).await.unwrap();assert_eq!(crate::companion::queued_items(&p,now.timestamp_millis()).await.unwrap().len(),1);
 sqlx::query("UPDATE tasks SET deadline=? WHERE id='goal'").bind((now+Duration::days(3)).to_rfc3339()).execute(&p).await.unwrap();sqlx::query("UPDATE tasks SET planned_date=NULL WHERE id='goal'").execute(&p).await.unwrap();assert!(crate::companion::queued_items(&p,now.timestamp_millis()).await.unwrap().is_empty());
 sqlx::query("UPDATE tasks SET deadline=NULL,planned_date=? WHERE id='goal'").bind(crate::gamification::task_day(now).to_string()).execute(&p).await.unwrap();let task=crate::companion::today_items(&p,now).await.unwrap().into_iter().find(|i|i.id=="goal").unwrap();crate::companion::queue_due_items(&p,&[task],now.timestamp_millis()).await.unwrap();crate::task_engine::complete_task_db(&p,"goal").await.unwrap();assert!(crate::companion::queued_items(&p,now.timestamp_millis()).await.unwrap().is_empty());
}
#[test]
fn sleep_recovery_has_bounded_windows(){
 let task=crate::companion::PetReminder{key:"a".into(),id:"a".into(),kind:"task".into(),title:"a".into(),detail:"a".into(),when_at:100_000_000,importance:3};
 assert_eq!(crate::companion::catch_up_due_items(&[task.clone()],task.when_at+3*3600000).len(),1);
 assert!(crate::companion::catch_up_due_items(&[task.clone()],task.when_at+25*3600000).is_empty());
 let mut course=task.clone();course.kind="course".into();assert!(crate::companion::catch_up_due_items(&[course],task.when_at+3*3600000).is_empty());
}
