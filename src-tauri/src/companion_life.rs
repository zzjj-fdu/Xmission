//! Raising is local. A completed, unique play session contributes at most once per day.
use chrono::{Local,Utc};
use serde::Serialize;
use sqlx::SqlitePool;
use tauri::{AppHandle,Emitter,State};
use uuid::Uuid;

#[derive(Serialize)]
#[serde(rename_all="camelCase")]
pub struct Growth {pub stage:String,pub care_days:i64,pub play_days:i64,pub paper_skill:bool,pub next:String}
pub async fn growth(pool:&SqlitePool)->Result<Growth,String>{
 let mut tx=pool.begin().await.map_err(|e|e.to_string())?;let result=growth_connection(&mut tx).await?;tx.commit().await.map_err(|e|e.to_string())?;Ok(result)
}
pub(crate) async fn growth_connection(conn:&mut sqlx::SqliteConnection)->Result<Growth,String>{
 let(care_days,affection):(i64,i64)=sqlx::query_as(&crate::companion::owned_sql("SELECT COUNT(DISTINCT CASE WHEN affection_delta>0 THEN day END),COALESCE(SUM(affection_delta),0) FROM companion_care_events WHERE {owner}")).fetch_one(&mut *conn).await.map_err(|e|e.to_string())?;
 let play_days:i64=sqlx::query_scalar(&crate::companion::owned_sql("SELECT COUNT(DISTINCT day) FROM companion_play_sessions WHERE {owner} AND completed_at IS NOT NULL")).fetch_one(&mut *conn).await.map_err(|e|e.to_string())?;
 let stage=if affection>=80||care_days>=7&&play_days>=3{"有了共同的小习惯"}else if affection>=40||care_days>=3||play_days>0{"开始主动邀请你"}else if affection>=15||care_days>0{"记住你的轻轻抚摸"}else{"先在你身边看看"}.into();
 let next=if play_days==0{"把桌面玩具丢给伙伴三次，一起学会第一个小游戏"}else if play_days<3{"换一天再玩一会儿，逐渐形成共同的小习惯"}else{"已经学会接玩具；闲暇时会想起你们一起玩的时间"}.into();
 Ok(Growth{stage,care_days,play_days,paper_skill:play_days>0,next})
}
pub async fn begin_play(pool:&SqlitePool,id:&str,now:i64)->Result<(),String>{
 Uuid::parse_str(id).map_err(|_|"游戏请求无效")?;
 let mut tx=crate::gamification::begin_write(pool).await?;
 let foreign:bool=sqlx::query_scalar(&crate::companion::owned_sql("SELECT EXISTS(SELECT 1 FROM companion_play_sessions WHERE id=? AND NOT ({owner}))")).bind(id).fetch_one(&mut *tx).await.map_err(|e|e.to_string())?;
 if foreign{return Err("这局游戏属于另一位伙伴，请切回后继续".into())}
 let busy:i64=sqlx::query_scalar(&crate::companion::owned_sql("SELECT (SELECT COUNT(*) FROM pomodoro_sessions WHERE state='running')+(SELECT COUNT(*) FROM companion_trips WHERE {owner} AND state='away')")).fetch_one(&mut *tx).await.map_err(|e|e.to_string())?;
 if busy>0{return Err("先安静陪你，忙完或旅行回来再一起玩".into())}
 sqlx::query(&crate::companion::owned_sql("DELETE FROM companion_play_sessions WHERE {owner} AND completed_at IS NULL AND started_at<?")).bind(now-86400000).execute(&mut *tx).await.map_err(|e|e.to_string())?;
 sqlx::query(&crate::companion::owned_sql("INSERT OR IGNORE INTO companion_play_sessions(character,id,started_at,day) VALUES({active},?,?,?)")).bind(id).bind(now).bind(Local::now().date_naive().to_string()).execute(&mut *tx).await.map_err(|e|e.to_string())?;
 tx.commit().await.map_err(|e|e.to_string())
}
pub async fn catch_paper(pool:&SqlitePool,id:&str,catch:i64,now:i64)->Result<Growth,String>{
 if !(1..=3).contains(&catch){return Err("纸球进度无效".into())}
 let mut tx=crate::gamification::begin_write(pool).await?;
 let(start,old,done,day):(i64,i64,Option<i64>,String)=sqlx::query_as(&crate::companion::owned_sql("SELECT started_at,catches,completed_at,day FROM companion_play_sessions WHERE {owner} AND id=?")).bind(id).fetch_optional(&mut *tx).await.map_err(|e|e.to_string())?.ok_or("先开始一局纸球游戏")?;
 if done.is_some()||catch<=old{let result=growth_connection(&mut tx).await?;tx.commit().await.map_err(|e|e.to_string())?;return Ok(result)}
 if catch!=old+1||now-start<catch*650||now-start>15*60000{return Err("等纸球停下来再拨回，或重新开始一局".into())}
 sqlx::query(&crate::companion::owned_sql("UPDATE companion_play_sessions SET catches=?,completed_at=CASE WHEN ?=3 THEN ? ELSE NULL END WHERE {owner} AND id=? AND catches=?")).bind(catch).bind(catch).bind(now).bind(id).bind(old).execute(&mut *tx).await.map_err(|e|e.to_string())?;
 if catch==3{crate::companion_memory::record(&mut tx,&format!("paper:{day}"),"game",id,"学会和你玩一个小玩具","今天一起玩了一小会儿，练习着接住你递过来的玩具。",None,&day).await?;}
 let result=growth_connection(&mut tx).await?;tx.commit().await.map_err(|e|e.to_string())?;Ok(result)
}
#[tauri::command]
pub async fn begin_companion_play(pool:State<'_,SqlitePool>,id:String)->Result<(),String>{begin_play(pool.inner(),&id,Utc::now().timestamp_millis()).await}
#[tauri::command]
pub async fn catch_companion_paper(app:AppHandle,pool:State<'_,SqlitePool>,id:String,catch:i64)->Result<Growth,String>{
 let result=catch_paper(pool.inner(),&id,catch,Utc::now().timestamp_millis()).await?;
 let _=app.emit("companion-changed",());let _=app.emit("companion-gesture",serde_json::json!({"action":if catch==3{"game-match"}else{"game-turn"}}));Ok(result)
}
#[cfg(test)]
mod tests{
 use super::*;
 #[tokio::test]
 async fn paper_progress_is_sequential_idempotent_and_daily(){
 let p=sqlx::sqlite::SqlitePoolOptions::new().max_connections(1).connect("sqlite::memory:").await.unwrap();sqlx::migrate!().run(&p).await.unwrap();
 let id=Uuid::new_v4().to_string();begin_play(&p,&id,1000).await.unwrap();begin_play(&p,&id,2000).await.unwrap();
 assert!(catch_paper(&p,&id,3,4000).await.is_err());assert!(catch_paper(&p,&id,1,1100).await.is_err());
 for n in 1..=3{catch_paper(&p,&id,n,1000+n*700).await.unwrap();}
 let(a,b)=tokio::join!(catch_paper(&p,&id,3,6000),catch_paper(&p,&id,3,6000));assert_eq!(a.unwrap().play_days,1);assert_eq!(b.unwrap().play_days,1);
 assert!(growth(&p).await.unwrap().paper_skill);
 let id2=Uuid::new_v4().to_string();begin_play(&p,&id2,8000).await.unwrap();for n in 1..=3{catch_paper(&p,&id2,n,8000+n*700).await.unwrap();}
 assert_eq!(growth(&p).await.unwrap().play_days,1);
 let count:i64=sqlx::query_scalar("SELECT COUNT(*) FROM companion_memories WHERE event_key LIKE 'paper:%'").fetch_one(&p).await.unwrap();assert_eq!(count,1);
 }
}
