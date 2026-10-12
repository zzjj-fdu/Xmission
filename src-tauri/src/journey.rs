//! A finite, user-entered chapter. Preparation runs are never a game input.
use serde::{Deserialize,Serialize};
use serde_json::{Value,json};
use sqlx::SqlitePool;
#[derive(Debug,Clone,Serialize,sqlx::FromRow)]
#[serde(rename_all="camelCase")]
pub struct Chapter {
    pub id:String,pub theme:String,pub task_id:Option<String>,pub node:i64,pub paused:bool,
    pub bag:Option<String>,pub route:Option<String>,pub discovery:Option<String>,
    pub game_best:Option<i64>,pub baseline:Option<String>,pub created_at:String,pub updated_at:String,
}
#[derive(Debug,Serialize,sqlx::FromRow)]
#[serde(rename_all="camelCase")]
pub struct Keepsake {pub id:String,pub chapter_id:String,pub theme:String,pub name:String,pub story:String,pub collected_at:String}
#[derive(Debug,Serialize,Deserialize)]
#[serde(rename_all="camelCase",deny_unknown_fields)]
pub struct JourneyInput {
    pub request_id:String,pub action:String,pub id:Option<String>,pub expected_node:Option<i64>,
    pub theme:Option<String>,pub task_id:Option<String>,pub choice:Option<String>,pub moves:Option<i64>,
}
pub(crate) async fn home(pool:&SqlitePool)->Result<Value,String> {
    let mut tx=pool.begin().await.map_err(|e|e.to_string())?;
    let chapter:Option<Chapter>=sqlx::query_as(&crate::companion::owned_sql("SELECT * FROM companion_chapters WHERE {owner} ORDER BY created_at DESC,rowid DESC LIMIT 1")).fetch_optional(&mut *tx).await.map_err(|e|e.to_string())?;
    let keepsakes:Vec<Keepsake>=sqlx::query_as(&crate::companion::owned_sql("SELECT * FROM companion_chapter_keepsakes WHERE {owner} ORDER BY collected_at DESC LIMIT 100")).fetch_all(&mut *tx).await.map_err(|e|e.to_string())?;
    let eligible=if let Some(c)=&chapter {commission_ready(&mut *tx,c).await?}else{false};
    tx.commit().await.map_err(|e|e.to_string())?;
    Ok(json!({"chapter":chapter,"keepsakes":keepsakes,"commissionReady":eligible}))
}
async fn commission_ready<'a>(db:impl sqlx::Executor<'a,Database=sqlx::Sqlite>,c:&Chapter)->Result<bool,String> {
    let Some(id)=&c.task_id else{return Ok(false);};
    let Some(baseline)=&c.baseline else{return Ok(false);};
    // Completion receipts are produced by the actual task engine; repeated or
    // assistant preparation output cannot satisfy this checkpoint.
    sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM tasks t WHERE t.id=? AND ((t.recurrence='none' AND t.status='done' AND julianday(t.completed_at)>=julianday(?)) OR (t.recurrence!='none' AND t.last_done_date=? AND EXISTS(SELECT 1 FROM companion_feedback f WHERE f.entity_id=t.id AND f.kind='task' AND f.created_at>=?))))")
        .bind(id).bind(baseline).bind(crate::gamification::task_day(chrono::Local::now()).to_string())
        .bind(chrono::DateTime::parse_from_rfc3339(baseline).map_err(|e|e.to_string())?.timestamp_millis())
        .fetch_one(db).await.map_err(|e|e.to_string())
}
pub(crate) async fn action(pool:&SqlitePool,input:JourneyInput)->Result<Value,String> {
    if input.request_id.trim().is_empty()||input.request_id.len()>128 {return Err("操作编号无效".into());}
    let args=serde_json::to_string(&input).map_err(|e|e.to_string())?;
    let mut tx=crate::gamification::begin_write(pool).await?;
    let prior:Option<(String,String,String)>=sqlx::query_as("SELECT tool,arguments_json,result_json FROM agent_requests WHERE request_id=?").bind(&input.request_id).fetch_optional(&mut *tx).await.map_err(|e|e.to_string())?;
    if let Some((tool,stored,result))=prior {
        if tool!="journey_action"||stored!=args {return Err("操作编号已被其他操作使用".into());}
        let owned:bool=sqlx::query_scalar(&crate::companion::owned_sql("SELECT EXISTS(SELECT 1 FROM companion_journey_requests WHERE {owner} AND request_id=?)")).bind(&input.request_id).fetch_one(&mut *tx).await.map_err(|e|e.to_string())?;
        if !owned{return Err("这次旅程属于另一位伙伴，请切回后继续".into());}
        return serde_json::from_str(&result).map_err(|e|e.to_string());
    }
    let now=chrono::Utc::now().to_rfc3339();
    let id=if input.action=="start" {
        let active:bool=sqlx::query_scalar(&crate::companion::owned_sql("SELECT EXISTS(SELECT 1 FROM companion_chapters WHERE {owner} AND node<5)")).fetch_one(&mut *tx).await.map_err(|e|e.to_string())?;
        if active {return Err("先继续或暂停当前章节，关联目标可以随时更换".into());}
        let theme=input.theme.as_deref().ok_or("请选择主题")?;
        if !matches!(theme,"pixel-jrpg"|"parchment-journal"|"animal-crossing"|"stardew-valley") {return Err("未知旅程主题".into());}
        if let Some(task)=&input.task_id {
            let t=crate::task_engine::fetch_task(&mut *tx,task).await?;
            if t.status=="done" {return Err("请选择还要推进的目标".into());}
        }
        let id=uuid::Uuid::new_v4().to_string();
        sqlx::query(&crate::companion::owned_sql("INSERT INTO companion_chapters(character,id,theme,task_id,baseline,created_at,updated_at)VALUES({active},?,?,?,?,?,?)"))
            .bind(&id).bind(theme).bind(&input.task_id).bind(&now).bind(&now).bind(&now).execute(&mut *tx).await.map_err(|e|e.to_string())?;id
    }else{
        let id=input.id.as_deref().ok_or("请选择章节")?;
        let c:Chapter=sqlx::query_as(&crate::companion::owned_sql("SELECT * FROM companion_chapters WHERE {owner} AND id=?")).bind(id).fetch_optional(&mut *tx).await.map_err(|e|e.to_string())?.ok_or("章节不存在")?;
        if c.node==5 {return Err("这一章已经结束，可以开启新章节".into());}
        if input.expected_node!=Some(c.node) {return Err("旅程状态已变化，请刷新后继续".into());}
        if c.paused && !matches!(input.action.as_str(),"resume"|"link") {return Err("旅程已暂停".into());}
        match input.action.as_str() {
            "pause"|"resume"=>{sqlx::query(&crate::companion::owned_sql("UPDATE companion_chapters SET paused=?,updated_at=? WHERE {owner} AND id=?")).bind(input.action=="pause").bind(&now).bind(id).execute(&mut *tx).await.map_err(|e|e.to_string())?;},
            "link"=>{
                if let Some(task)=&input.task_id {let t=crate::task_engine::fetch_task(&mut *tx,task).await?;if t.status=="done" {return Err("请选择未完成的目标".into());}}
                sqlx::query(&crate::companion::owned_sql("UPDATE companion_chapters SET task_id=?,baseline=?,updated_at=? WHERE {owner} AND id=?")).bind(&input.task_id).bind(&now).bind(&now).bind(id).execute(&mut *tx).await.map_err(|e|e.to_string())?;
            },
            "bag" if c.node==0=>{
                let choice=input.choice.as_deref().filter(|v|matches!(*v,"compass"|"notebook")).ok_or("请选择罗盘或记录本")?;
                sqlx::query(&crate::companion::owned_sql("UPDATE companion_chapters SET bag=?,node=1,updated_at=? WHERE {owner} AND id=?")).bind(choice).bind(&now).bind(id).execute(&mut *tx).await.map_err(|e|e.to_string())?;
            },
            "route" if c.node==1=>{
                let route=input.choice.as_deref().filter(|v|matches!(*v,"ridge"|"river")).ok_or("请选择一条路线")?;
                let discovery=match (c.bag.as_deref(),route){(Some("compass"),"ridge")=>"hidden-star",(Some("notebook"),"ridge")=>"old-ticket",(Some("compass"),_)=>"river-stone",_=>"leaf-page"};
                sqlx::query(&crate::companion::owned_sql("UPDATE companion_chapters SET route=?,discovery=?,node=2,updated_at=? WHERE {owner} AND id=?")).bind(route).bind(discovery).bind(&now).bind(id).execute(&mut *tx).await.map_err(|e|e.to_string())?;
            },
            "play" if (2..=4).contains(&c.node)=>{
                let moves=input.moves.filter(|m|(3..=1000).contains(m)).ok_or("请先完成一轮配对小游戏")?;
                sqlx::query(&crate::companion::owned_sql("UPDATE companion_chapters SET game_best=MIN(COALESCE(game_best,?),?),node=MAX(node,3),updated_at=? WHERE {owner} AND id=?")).bind(moves).bind(moves).bind(&now).bind(id).execute(&mut *tx).await.map_err(|e|e.to_string())?;
            },
            "commission" if c.node==3=>{
                if !commission_ready(&mut *tx,&c).await? {return Err("先推进并完成关联的真实目标，再来交付小委托".into());}
                sqlx::query(&crate::companion::owned_sql("UPDATE companion_chapters SET node=4,updated_at=? WHERE {owner} AND id=?")).bind(&now).bind(id).execute(&mut *tx).await.map_err(|e|e.to_string())?;
            },
            "claim" if c.node==4=>{
                let name=match c.theme.as_str(){"pixel-jrpg"=>"归途星图章","parchment-journal"=>"山谷旅行页","animal-crossing"=>"河岸手作挂饰",_=>"集市收获篮"};
                let story=if c.route.as_deref()==Some("ridge"){"我们沿着山道找到了新的线索，带着一份小小的勇气回家。"}else{"我们顺着河岸收集了线索，也把从容的脚步留在了旅途中。"};
                sqlx::query(&crate::companion::owned_sql("INSERT INTO companion_chapter_keepsakes(character,id,chapter_id,theme,name,story,collected_at)VALUES({active},?,?,?,?,?,?)"))
                    .bind(uuid::Uuid::new_v4().to_string()).bind(id).bind(&c.theme).bind(name).bind(story).bind(&now).execute(&mut *tx).await.map_err(|e|e.to_string())?;
                sqlx::query(&crate::companion::owned_sql("UPDATE companion_chapters SET node=5,updated_at=? WHERE {owner} AND id=?")).bind(&now).bind(id).execute(&mut *tx).await.map_err(|e|e.to_string())?;
            },_=>return Err("当前节点不支持这个动作".into()),
        }id.to_owned()
    };
    let c:Chapter=sqlx::query_as(&crate::companion::owned_sql("SELECT * FROM companion_chapters WHERE {owner} AND id=?")).bind(id).fetch_one(&mut *tx).await.map_err(|e|e.to_string())?;
    let result=json!({"chapter":c});
    sqlx::query("INSERT INTO agent_requests(request_id,tool,arguments_json,result_json,created_at)VALUES(?,'journey_action',?,?,?)")
        .bind(&input.request_id).bind(args).bind(result.to_string()).bind(&now).execute(&mut *tx).await.map_err(|e|e.to_string())?;
    sqlx::query(&crate::companion::owned_sql("INSERT INTO companion_journey_requests(request_id,character)VALUES(?,{active})")).bind(&input.request_id).execute(&mut *tx).await.map_err(|e|e.to_string())?;
    tx.commit().await.map_err(|e|e.to_string())?;Ok(result)
}
#[cfg(not(test))]
#[tauri::command]
pub async fn get_journey(pool:tauri::State<'_,SqlitePool>)->Result<Value,String> {home(pool.inner()).await}
#[cfg(not(test))]
#[tauri::command]
pub async fn journey_action(app:tauri::AppHandle,pool:tauri::State<'_,SqlitePool>,input:JourneyInput)->Result<Value,String> {
    use tauri::Emitter;
    let result=action(pool.inner(),input).await?;let _=app.emit("journey-changed",());Ok(result)
}
#[cfg(test)] mod tests;
