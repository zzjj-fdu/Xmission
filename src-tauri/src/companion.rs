//! Local companion data and reminder rules. The scheduler never calls a model.
use chrono::{DateTime,Datelike,Local,Timelike,Utc};
use serde::{Deserialize,Serialize};
use serde_json::{json,Value};
use sqlx::SqlitePool;
use tauri::{AppHandle,Emitter,State};
#[cfg(not(test))]
use tauri::Manager;
use uuid::Uuid;
use crate::{course,gamification,recurring,scheduler};
use crate::models::Task;
pub const PREF_KEY:&str="companion_preferences";
/// Evaluated by SQLite in the same statement/transaction as the companion data.
pub(crate) fn owned_sql(sql:&str)->String {
 let active="COALESCE((SELECT CASE WHEN json_valid(value) THEN CASE json_extract(value,'$.character') WHEN 'red-panda' THEN 'red-panda' ELSE 'fox' END ELSE 'fox' END FROM settings WHERE key='companion_preferences'),'fox')";
 sql.replace("{owner}",&format!("character={active}")).replace("{active}",active)
}
fn default_weather()->String{"clear".into()}
fn default_phase()->String{"noon".into()}
#[derive(Clone,Debug,Serialize,Deserialize)]
#[serde(rename_all="camelCase",default)]
pub struct PetPreferences {
 pub character:String,pub outfit:String,
 pub enabled:bool,pub desktop_enabled:bool,pub name:String,pub size:i64,
 pub wander:bool,pub reminders:bool,pub proactive:bool,pub quiet_start:String,pub quiet_end:String,
 pub reduced_motion:bool,pub muted_until:i64,pub appearance:String,
 pub display_mode:String,pub task_click:String,pub wander_range:i64,pub edge_side:String,pub important_during_focus:bool,pub follow_environment:bool,pub auto_dock:bool,pub auto_perch:bool,pub sound:bool,
}
impl Default for PetPreferences {
 fn default()->Self {Self{character:"fox".into(),outfit:"theme".into(),enabled:true,desktop_enabled:true,name:"小狐狸".into(),size:96,
 wander:false,reminders:true,proactive:true,quiet_start:"22:00".into(),quiet_end:"08:00".into(),
 reduced_motion:false,muted_until:0,appearance:"follow".into(),display_mode:"normal".into(),task_click:"double".into(),wander_range:96,edge_side:"right".into(),important_during_focus:false,follow_environment:true,auto_dock:true,auto_perch:true,sound:false}}
}
#[derive(Clone,Debug,Serialize,Deserialize,sqlx::FromRow)]
#[serde(rename_all="camelCase")]
pub struct PetTrip {
 pub id:String,pub theme:String,pub route:String,pub duration_min:i64,
 pub started_at:i64,pub returns_at:i64,pub state:String,pub item_key:String,
 pub item_name:String,pub story:String,
 #[serde(default="default_weather")]pub weather:String,#[serde(default="default_phase")]pub phase:String,
}
#[derive(Clone,Debug,Serialize,sqlx::FromRow)]
#[serde(rename_all="camelCase")]
pub struct PetSouvenir {
 pub id:String,pub trip_id:String,pub theme:String,pub item_key:String,
 pub item_name:String,pub route:String,pub story:String,pub collected_at:i64,
}
#[derive(Clone,Debug,Serialize,Deserialize)]
#[serde(rename_all="camelCase")]
pub struct PetReminder {
 pub key:String,pub id:String,pub kind:String,pub title:String,
 pub detail:String,pub when_at:i64,pub importance:i64,
}
#[derive(Clone,Debug,Serialize,Deserialize)]
#[serde(rename_all="camelCase")]
pub struct PetNotice {
 pub items:Vec<PetReminder>,pub created_at:i64,
 #[serde(default)]pub message:Option<String>,
 #[serde(default)]pub title:Option<String>,
 #[serde(default)]pub tab:Option<String>,
 #[serde(default)]pub reply:Option<PetReply>,
}
#[derive(Serialize)]
#[serde(rename_all="camelCase")]
pub struct PetHome {
 pub growth:crate::companion_life::Growth,
 pub preferences:PetPreferences,pub trip:Option<PetTrip>,pub collection:Vec<PetSouvenir>,
 pub today:Vec<PetReminder>,pub focus:bool,pub xp_total:i64,pub now:i64,pub collection_total:i64,pub care:PetCare,pub journal:crate::companion_memory::Journal,pub keepsake:Option<PetSouvenir>,
}
pub fn valid_theme(theme:&str)->bool {
 matches!(theme,"pixel-jrpg"|"parchment-journal"|"animal-crossing"|"stardew-valley")
}
fn validate_preferences(p:&PetPreferences)->Result<(),String> {
 if !matches!(p.character.as_str(),"fox"|"red-panda"){return Err("请选择狐狸或小熊猫伙伴".into())}
 if !matches!(p.outfit.as_str(),"theme"|"scarf"|"none"){return Err("请选择主题衣装、围巾或无附件".into())}
 if p.name.trim().is_empty()||p.name.chars().count()>16{return Err("伙伴名字请输入 1–16 个字".into())}
 if ![64,96,128].contains(&p.size){return Err("伙伴大小请选择 64、96 或 128".into())}
 if course::time_to_min(&p.quiet_start).is_none()||course::time_to_min(&p.quiet_end).is_none(){return Err("安静时段格式应为 HH:MM".into())}
 if p.appearance!="follow"&&!valid_theme(&p.appearance){return Err("伙伴衣装无效".into())}
 if !matches!(p.display_mode.as_str(),"normal"|"mini"|"edge"|"closed")||!matches!(p.task_click.as_str(),"single"|"double")||!matches!(p.edge_side.as_str(),"left"|"right")||!(32..=256).contains(&p.wander_range){return Err("桌面陪伴模式或走动范围无效".into())}
 if p.muted_until<0{return Err("暂停提醒时间无效".into())}
 Ok(())
}
pub fn quiet_at(p:&PetPreferences,now:&DateTime<Local>)->bool {
 if now.timestamp_millis()<p.muted_until{return true}
 let from=course::time_to_min(&p.quiet_start).unwrap_or(1320);
 let to=course::time_to_min(&p.quiet_end).unwrap_or(480);
 let minute=now.hour() as i64*60+now.minute() as i64;
 if from==to{false}else if from<to{minute>=from&&minute<to}else{minute>=from||minute<to}
}
pub async fn preferences_db(pool:&SqlitePool)->Result<PetPreferences,String> {
 let mut conn=pool.acquire().await.map_err(|e|e.to_string())?;preferences_connection(&mut conn).await
}
fn decode_preferences(raw:Option<String>)->PetPreferences {
 let value=raw.and_then(|s|serde_json::from_str::<Value>(&s).ok());
 if let Some(p)=value.clone().and_then(|v|serde_json::from_value::<PetPreferences>(v).ok()).filter(|p|validate_preferences(p).is_ok()){return p;}
 let mut p=PetPreferences::default();
 if value.as_ref().and_then(|v|v.get("character")).and_then(Value::as_str)==Some("red-panda"){p.character="red-panda".into();p.name="小熊猫".into();}
 p
}
pub(crate) async fn preferences_connection(conn:&mut sqlx::SqliteConnection)->Result<PetPreferences,String> {
 let value:Option<String>=sqlx::query_scalar("SELECT value FROM settings WHERE key=?").bind(PREF_KEY).fetch_optional(&mut *conn).await.map_err(|e|e.to_string())?;
 Ok(decode_preferences(value))
}
pub async fn update_preferences_db(pool:&SqlitePool,patch:Value)->Result<PetPreferences,String> {
 let Some(patch)=patch.as_object()else{return Err("伙伴设置格式无效".into())};
 let allowed=["character","outfit","enabled","desktopEnabled","name","size","wander","reminders","proactive","quietStart","quietEnd","reducedMotion","mutedUntil","appearance","displayMode","taskClick","wanderRange","edgeSide","importantDuringFocus","followEnvironment","autoDock","autoPerch","sound"];
 if patch.keys().any(|key|!allowed.contains(&key.as_str())){return Err("伙伴设置包含未知字段".into())}
 let mut tx=gamification::begin_write(pool).await?;
 let raw:Option<String>=sqlx::query_scalar("SELECT value FROM settings WHERE key=?").bind(PREF_KEY).fetch_optional(&mut *tx).await.map_err(|e|e.to_string())?;
 let previous=decode_preferences(raw);
 let target=patch.get("character").and_then(Value::as_str).unwrap_or(&previous.character);
 let mut object=serde_json::to_value(&previous).map_err(|e|e.to_string())?;
 if target!=previous.character {
  if !matches!(target,"fox"|"red-panda"){return Err("请选择狐狸或小熊猫伙伴".into())}
  let busy:bool=sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM companion_trips WHERE state IN('away','returned'))").fetch_one(&mut *tx).await.map_err(|e|e.to_string())?;
  if busy{return Err("先等伙伴旅行归来并收好纪念物，再切换伙伴".into())}
  let key=format!("companion_profile:{}",previous.character);
  let keepsake:Option<String>=sqlx::query_scalar("SELECT value FROM settings WHERE key='companion_keepsake'").fetch_optional(&mut *tx).await.map_err(|e|e.to_string())?;
  let profile=json!({"name":previous.name,"outfit":previous.outfit,"appearance":previous.appearance,"keepsake":keepsake});
  sqlx::query("INSERT INTO settings(key,value)VALUES(?,?) ON CONFLICT(key)DO UPDATE SET value=excluded.value").bind(key).bind(profile.to_string()).execute(&mut *tx).await.map_err(|e|e.to_string())?;
  let saved:Option<String>=sqlx::query_scalar("SELECT value FROM settings WHERE key=?").bind(format!("companion_profile:{target}")).fetch_optional(&mut *tx).await.map_err(|e|e.to_string())?;
  let profile=saved.and_then(|s|serde_json::from_str::<Value>(&s).ok()).unwrap_or_else(||json!({"name":if target=="fox"{"小狐狸"}else{"小熊猫"},"appearance":"follow","outfit":"theme"}));
  for field in ["name","appearance","outfit"]{if let Some(value)=profile.get(field){object[field]=value.clone();}}
  sqlx::query("DELETE FROM settings WHERE key='companion_keepsake'").execute(&mut *tx).await.map_err(|e|e.to_string())?;
  if let Some(id)=profile.get("keepsake").and_then(Value::as_str){
   sqlx::query("INSERT INTO settings(key,value)SELECT 'companion_keepsake',id FROM companion_collection WHERE id=? AND character=?").bind(id).bind(target).execute(&mut *tx).await.map_err(|e|e.to_string())?;
  }
 }
 for(key,value)in patch{object[key]=value.clone();}
 let mut p:PetPreferences=serde_json::from_value(object).map_err(|_|"伙伴设置类型不正确")?;
 p.name=p.name.trim().to_owned();validate_preferences(&p)?;
 sqlx::query("INSERT INTO settings(key,value)VALUES(?,?) ON CONFLICT(key)DO UPDATE SET value=excluded.value")
 .bind(PREF_KEY).bind(serde_json::to_string(&p).map_err(|e|e.to_string())?).execute(&mut *tx).await.map_err(|e|e.to_string())?;
 tx.commit().await.map_err(|e|e.to_string())?;Ok(p)
}
pub async fn settle_trips(pool:&SqlitePool,now:i64)->Result<bool,String> {
 Ok(sqlx::query(&crate::companion::owned_sql("UPDATE companion_trips SET state='returned' WHERE {owner} AND state='away' AND returns_at<=?"))
 .bind(now).execute(pool).await.map_err(|e|e.to_string())?.rows_affected()>0)
}
fn journey_story(theme:&str,route:&str,variant:usize)->(String,String) {
 let(places,items)=match theme {
 "pixel-jrpg"=>(["城堡石桥","月光山谷","星辰古道"],["晨星图章","星图纪念章","月湾罗盘"]),
 "parchment-journal"=>(["林间小径","河谷古城","远山驿站"],["压叶书签","植物明信片","远山旅行笺"]),
 "animal-crossing"=>(["小岛海滩","瀑布花谷","海风群岛"],["桃色贝壳","潮汐明信片","小岛花章"]),
 _=>(["农场篱边","向日葵山谷","秋收小镇"],["春芽种子袋","向日葵纪念章","秋收种子袋"]),
 };
 let index=match route{"nearby"=>0,"valley"=>1,_=>2};
 (items[variant].into(),format!("我沿着{}慢慢走，停下来观察风和云，也把一路上的小惊喜装进行囊。这件{}送给你。下次我们再一起找一条新路吧。",places[index],items[variant]))
}
#[cfg(test)]
pub async fn start_trip_db(pool:&SqlitePool,request_id:&str,theme:&str,route:&str,duration_min:i64,now:i64)->Result<PetTrip,String>{
 start_trip_context(pool,request_id,theme,route,duration_min,now,"clear","noon").await
}
async fn start_trip_context(pool:&SqlitePool,request_id:&str,theme:&str,route:&str,duration_min:i64,now:i64,weather:&str,phase:&str)->Result<PetTrip,String> {
 if !matches!(weather,"clear"|"cloudy"|"rain"|"snow"|"wind"|"fog")||!matches!(phase,"dawn"|"morning"|"noon"|"sunset"|"night"|"predawn"){return Err("旅途天气或时段无效".into())}
 let seed=Uuid::parse_str(request_id).map_err(|_|"旅行请求无效，请重新尝试")?;
 if !valid_theme(theme)||!matches!(route,"nearby"|"valley"|"faraway")||![30,120,480].contains(&duration_min){return Err("请选择有效主题、目的地和旅行时长".into())}
 let mut tx=gamification::begin_write(pool).await?;
 let foreign:bool=sqlx::query_scalar(&owned_sql("SELECT EXISTS(SELECT 1 FROM companion_trips WHERE id=? AND NOT ({owner}))")).bind(request_id).fetch_one(&mut *tx).await.map_err(|e|e.to_string())?;
 if foreign{return Err("这次旅行属于另一位伙伴，请切回后继续".into())}
 if let Some(existing)=sqlx::query_as::<_,PetTrip>(&crate::companion::owned_sql("SELECT * FROM companion_trips WHERE {owner} AND id=?")).bind(request_id).fetch_optional(&mut *tx).await.map_err(|e|e.to_string())? {
 if existing.theme!=theme||existing.route!=route||existing.duration_min!=duration_min{return Err("旅行请求已用于不同的安排".into())}
 tx.commit().await.map_err(|e|e.to_string())?;return Ok(existing)
 }
 let active:i64=sqlx::query_scalar(&crate::companion::owned_sql("SELECT COUNT(*) FROM companion_trips WHERE {owner} AND state IN('away','returned')")).fetch_one(&mut *tx).await.map_err(|e|e.to_string())?;
 if active>0{return Err("伙伴正在旅行，或带回的纪念物还没收好".into())}
 let variant=seed.as_bytes()[15]as usize%3;let(item_name,story)=journey_story(theme,route,variant);
 let atmosphere=match weather{"rain"=>"路上有细雨，我躲到屋檐下等雨歇，再把行囊扣紧。","snow"=>"小径落了一层薄雪，我顺着清晰的脚印慢慢往前走。","wind"=>"风把围巾吹起来，我压住地图，在背风处停了一会儿。","fog"=>"远处蒙着雾，我沿着熟悉的路标慢慢走，不急着赶路。","cloudy"=>"云影从小路上移过去，我等了一小束阳光。",_=>"天气很清朗，我在路边停下看看小小的风景。"};
 let light=if phase=="night"||phase=="predawn"{"返程时提灯亮着，收藏也安稳地放在包里。"}else if phase=="sunset"{"回程赶上了暖暖的晚霞。"}else{"我把这一点发现好好带回来。"};
 let story=format!("{story}{atmosphere}{light}");
 sqlx::query(&crate::companion::owned_sql("INSERT INTO companion_trips(character,id,theme,route,duration_min,started_at,returns_at,state,item_key,item_name,story,weather,phase)VALUES({active},?,?,?,?,?,?,'away',?,?,?,?,?)"))
 .bind(request_id).bind(theme).bind(route).bind(duration_min).bind(now).bind(now+duration_min*60000)
 .bind(format!("{}/{theme}/{route}/{variant}",preferences_connection(&mut tx).await?.character)).bind(item_name).bind(story).bind(weather).bind(phase).execute(&mut *tx).await.map_err(|e|e.to_string())?;
 let trip=sqlx::query_as::<_,PetTrip>(&crate::companion::owned_sql("SELECT * FROM companion_trips WHERE {owner} AND id=?")).bind(request_id).fetch_one(&mut *tx).await.map_err(|e|e.to_string())?;
 tx.commit().await.map_err(|e|e.to_string())?;Ok(trip)
}
pub async fn claim_trip_db(pool:&SqlitePool,id:&str,now:i64)->Result<PetSouvenir,String> {
 let mut tx=gamification::begin_write(pool).await?;
 if let Some(item)=sqlx::query_as::<_,PetSouvenir>(&crate::companion::owned_sql("SELECT * FROM companion_collection WHERE {owner} AND trip_id=?")).bind(id).fetch_optional(&mut *tx).await.map_err(|e|e.to_string())?{
 tx.commit().await.map_err(|e|e.to_string())?;return Ok(item)}
 let trip=sqlx::query_as::<_,PetTrip>(&crate::companion::owned_sql("SELECT * FROM companion_trips WHERE {owner} AND id=?")).bind(id).fetch_optional(&mut *tx).await.map_err(|e|e.to_string())?.ok_or("找不到这次旅行")?;
 if trip.returns_at>now||trip.state=="claimed"{return Err("伙伴还在路上，等它带着纪念物回来吧".into())}
 sqlx::query(&crate::companion::owned_sql("INSERT INTO companion_collection(character,id,trip_id,theme,item_key,item_name,route,story,collected_at)VALUES({active},?,?,?,?,?,?,?,?)"))
 .bind(Uuid::new_v4().to_string()).bind(id).bind(&trip.theme).bind(&trip.item_key).bind(&trip.item_name).bind(&trip.route).bind(&trip.story).bind(now)
 .execute(&mut *tx).await.map_err(|e|e.to_string())?;
 sqlx::query(&crate::companion::owned_sql("UPDATE companion_trips SET state='claimed' WHERE {owner} AND id=?")).bind(id).execute(&mut *tx).await.map_err(|e|e.to_string())?;
 let item=sqlx::query_as::<_,PetSouvenir>(&crate::companion::owned_sql("SELECT * FROM companion_collection WHERE {owner} AND trip_id=?")).bind(id).fetch_one(&mut *tx).await.map_err(|e|e.to_string())?;
 crate::companion_memory::traveled(&mut tx,&trip).await?;
 sqlx::query("INSERT OR IGNORE INTO settings(key,value)VALUES('companion_keepsake',?)").bind(&item.id).execute(&mut *tx).await.map_err(|e|e.to_string())?;
 tx.commit().await.map_err(|e|e.to_string())?;Ok(item)
}
fn reminder_order(a:&PetReminder,b:&PetReminder)->std::cmp::Ordering {
 a.when_at.cmp(&b.when_at).then(b.importance.cmp(&a.importance)).then(a.key.cmp(&b.key))
}
pub async fn today_items(pool:&SqlitePool,now:DateTime<Local>)->Result<Vec<PetReminder>,String> {
 let today=now.date_naive();let day=today.to_string();let task_day=gamification::task_day(now);let mut result=Vec::new();
 let mut tasks=sqlx::query_as::<_,Task>("SELECT * FROM tasks WHERE status NOT IN('done','shelved')").fetch_all(pool).await.map_err(|e|e.to_string())?;
 for t in &mut tasks {
 recurring::fill_done_today(t,task_day);
 if t.done_today||(t.recurrence!="none"&&!recurring::due_on(&t.recurrence,&t.recur_days,task_day)){continue}
 let deadline=scheduler::parse_deadline(&t.deadline,&now);let due=deadline.filter(|dt|dt.date_naive()<=today);
 let planned=t.planned_date.as_deref()==Some(task_day.to_string().as_str());
 if due.is_none()&&!planned&&t.recurrence=="none"{continue}
 let date_only=t.deadline.as_deref().is_some_and(|v|v.len()==10)&&due.is_some_and(|d|d.date_naive()==today);
 let morning_day=if date_only{today}else{task_day};
 let morning=morning_day.and_hms_opt(9,0,0).and_then(|v|v.and_local_timezone(Local).single()).map(|v|v.timestamp_millis()).unwrap_or(now.timestamp_millis());
 let at=if date_only{morning}else{due.map(|dt|dt.timestamp_millis()).unwrap_or(morning)};
 result.push(PetReminder{key:format!("task:{}:{}",t.id,due.map(|d|d.to_rfc3339()).unwrap_or(task_day.to_string())),id:t.id.clone(),kind:"task".into(),title:t.title.clone(),
 detail:if date_only{"今天截止".into()}else if due.is_some_and(|d|d<now){"待完成 · 已过截止时间".into()}else if let Some(d)=due{format!("{} 前完成",d.format("%H:%M"))}else{"今天的小目标".into()},when_at:at,importance:t.importance});
 }
 for c in course::courses_on_date(pool,today).await?{
 let mut slots:Vec<_>=c.slots.iter().filter(|s|s.weekday==today.weekday().number_from_monday()as i64).collect();
 slots.sort_by(|a,b|a.start_time.cmp(&b.start_time));let mut merged:Vec<(String,String)>=Vec::new();
 for s in slots{
 if let Some(last)=merged.last_mut(){
 let gap=course::time_to_min(&s.start_time).unwrap_or(0)-course::time_to_min(&last.1).unwrap_or(0);
 if(0..=25).contains(&gap){last.1=s.end_time.clone();continue}}
 merged.push((s.start_time.clone(),s.end_time.clone()));
 }
 for(start,end)in merged{
 let Some(time)=chrono::NaiveTime::parse_from_str(&start,"%H:%M").ok()else{continue};
 let Some(dt)=today.and_time(time).and_local_timezone(Local).single()else{continue};
 result.push(PetReminder{key:format!("course:{day}:{}:{start}",c.id),id:c.id.clone(),kind:"course".into(),title:c.name.clone(),
 detail:format!("{start}–{end} {}",c.location.as_deref().unwrap_or("")),when_at:dt.timestamp_millis(),importance:3});
 }}
 if crate::features::GOAL_EXPERIENCE {result.extend(crate::planning::today_step_reminders(pool,now).await?);}
 let stamp=now.timestamp_millis();
 result.sort_by(|a,b|{
 let rank=|i:&PetReminder|if i.when_at>=stamp-5*60000{0}else if i.kind=="task"&&i.when_at>=today.and_hms_opt(0,0,0).and_then(|v|v.and_local_timezone(Local).single()).map(|v|v.timestamp_millis()).unwrap_or(stamp){1}else{2};
 rank(a).cmp(&rank(b)).then_with(||reminder_order(a,b))
 });result.truncate(100);Ok(result)
}
pub fn due_items(items:&[PetReminder],now:i64)->Vec<PetReminder>{
 let mut due:Vec<_>=items.iter().filter(|i|i.when_at-now<=15*60000&&now-i.when_at<=5*60000).cloned().collect();
 due.sort_by(reminder_order);due.truncate(6);due
}
pub async fn claim_reminders(pool:&SqlitePool,items:Vec<PetReminder>,now:i64)->Result<Vec<PetReminder>,String>{
 let mut tx=gamification::begin_write(pool).await?;let mut fresh=Vec::new();
 for item in items{
 if sqlx::query("INSERT OR IGNORE INTO companion_reminders(event_key,delivered_at)VALUES(?,?)").bind(&item.key).bind(now)
 .execute(&mut *tx).await.map_err(|e|e.to_string())?.rows_affected()>0{fresh.push(item)}
 }
 sqlx::query("DELETE FROM companion_reminders WHERE delivered_at<?").bind(now-30*86400000).execute(&mut *tx).await.map_err(|e|e.to_string())?;
 tx.commit().await.map_err(|e|e.to_string())?;Ok(fresh)
}
pub async fn home_db(pool:&SqlitePool)->Result<PetHome,String>{
 let now=Local::now();let today=today_items(pool,now).await?;settle_trips(pool,now.timestamp_millis()).await?;
 let mut tx=pool.begin().await.map_err(|e|e.to_string())?;
 let preferences=preferences_connection(&mut tx).await?;
 let trip=sqlx::query_as::<_,PetTrip>(&crate::companion::owned_sql("SELECT * FROM companion_trips WHERE {owner} AND state IN('away','returned') LIMIT 1")).fetch_optional(&mut *tx).await.map_err(|e|e.to_string())?;
 let collection=sqlx::query_as::<_,PetSouvenir>(&crate::companion::owned_sql("SELECT * FROM companion_collection WHERE {owner} ORDER BY collected_at DESC,id DESC LIMIT 24")).fetch_all(&mut *tx).await.map_err(|e|e.to_string())?;
 let focus:i64=sqlx::query_scalar("SELECT COUNT(*) FROM pomodoro_sessions WHERE state='running'").fetch_one(&mut *tx).await.map_err(|e|e.to_string())?;
 let xp_total:i64=sqlx::query_scalar("SELECT COALESCE(SUM(delta),0) FROM xp_ledger").fetch_one(&mut *tx).await.map_err(|e|e.to_string())?;
 let collection_total:i64=sqlx::query_scalar(&crate::companion::owned_sql("SELECT COUNT(*) FROM companion_collection WHERE {owner}")).fetch_one(&mut *tx).await.map_err(|e|e.to_string())?;
 let care=care_connection(&mut tx).await?;
 let mut journal=crate::companion_memory::journal_connection(&mut tx,care.affection).await?;
 let growth=crate::companion_life::growth_connection(&mut tx).await?;journal.relationship=growth.stage.clone();
 let keepsake=sqlx::query_as::<_,PetSouvenir>(&crate::companion::owned_sql("SELECT * FROM companion_collection WHERE {owner} AND id=(SELECT value FROM settings WHERE key='companion_keepsake')")).fetch_optional(&mut *tx).await.map_err(|e|e.to_string())?;
 tx.commit().await.map_err(|e|e.to_string())?;
 Ok(PetHome{growth,preferences,trip,collection,today,focus:focus>0,xp_total,now:now.timestamp_millis(),collection_total,care,journal,keepsake})
}
#[tauri::command]
pub async fn get_companion_home(pool:State<'_,SqlitePool>)->Result<PetHome,String>{home_db(pool.inner()).await}
#[tauri::command]
pub async fn update_companion_preferences(app:AppHandle,pool:State<'_,SqlitePool>,patch:Value)->Result<PetPreferences,String>{
 #[cfg(not(test))]
 let runtime=app.state::<std::sync::Arc<crate::companion_window::PetRuntime>>();
 #[cfg(not(test))]
 let _mode=runtime.mode_lock.lock().await;
 let previous=preferences_db(pool.inner()).await?;
 let wake=patch.get("enabled").and_then(Value::as_bool)==Some(true)||patch.get("desktopEnabled").and_then(Value::as_bool)==Some(true);
 let mut patch=patch;
 if wake&&previous.display_mode=="closed"&&patch.get("displayMode").is_none(){patch["displayMode"]=json!("normal");}
 let p=update_preferences_db(pool.inner(),patch).await?;
 #[cfg(not(test))]
 if previous.character!=p.character{crate::companion_window::reset_character(&app)?;}
 let _=app.emit("companion-changed",());
 #[cfg(not(test))]
 if !p.enabled||!p.desktop_enabled||p.display_mode=="closed"{app.state::<std::sync::Arc<crate::companion_window::PetRuntime>>().dismissed.store(true,std::sync::atomic::Ordering::SeqCst)}else if wake{app.state::<std::sync::Arc<crate::companion_window::PetRuntime>>().dismissed.store(false,std::sync::atomic::Ordering::SeqCst)}
 #[cfg(test)]
 let _=wake;
 #[cfg(not(test))]
 {crate::companion_window::sync_desktop(&app,&p)?;}
 Ok(p)
}
#[tauri::command]
pub async fn start_companion_trip(app:AppHandle,pool:State<'_,SqlitePool>,request_id:String,theme:String,route:String,duration_min:i64,weather:Option<String>,phase:Option<String>)->Result<PetTrip,String>{
 let trip=start_trip_context(pool.inner(),&request_id,&theme,&route,duration_min,Utc::now().timestamp_millis(),weather.as_deref().unwrap_or("clear"),phase.as_deref().unwrap_or("noon")).await?;
 let _=app.emit("companion-changed",());let _=app.emit("companion-gesture",json!({"action":"depart"}));
 #[cfg(not(test))]
 crate::companion_window::show_travel_entry(app.clone(),pool.inner().clone());
 Ok(trip)
}
#[tauri::command]
pub async fn claim_companion_trip(app:AppHandle,pool:State<'_,SqlitePool>,id:String)->Result<PetSouvenir,String>{
 let item=claim_trip_db(pool.inner(),&id,Utc::now().timestamp_millis()).await?;
 let _=app.emit("companion-changed",());let _=app.emit("companion-gesture",json!({"action":"return"}));Ok(item)
}
#[derive(Clone,Debug,Serialize,Deserialize)]
#[serde(rename_all="camelCase")]
pub struct PetReply{pub text:String,pub emotion:String,pub suggested_task:Option<String>,pub source:String,pub draft_id:Option<String>}
#[tauri::command]
pub async fn companion_chat(pool:State<'_,SqlitePool>,message:String,include_today:bool,scenario:Option<String>,shared_text:Option<String>)->Result<PetReply,String>{
 if message.trim().is_empty()||message.chars().count()>1200{return Err("请输入 1–1200 字的消息".into())}
 let(_,_,key)=crate::llm::current_config(pool.inner()).await?;
 if key.is_none(){let p=preferences_db(pool.inner()).await?;let species=if p.character=="red-panda"{"小熊猫"}else{"小狐狸"};return Ok(PetReply{text:format!("我是住在 Xmission 里的游戏{species}，名字叫{}。我可以安静陪你；先喝口水或活动一下，再做一件最小、最清楚的事。还没有接通 AI 服务，暂时不能分析题目，也没有读取你的桌面。",p.name),emotion:"calm".into(),suggested_task:None,source:"local".into(),draft_id:None})}
 let mut context=if include_today{today_items(pool.inner(),Local::now()).await?.into_iter().take(6).map(|i|format!("{} {}",i.title,i.detail)).collect::<Vec<_>>().join("\n")}else{"用户未分享日程".into()};
 let growth=crate::companion_life::growth(pool.inner()).await?;
 context.push_str(&format!("\n游戏内关系：{}；接玩具技能：{}。这是虚构宠物进度，不是用户健康信息。当地时间：{}。",growth.stage,growth.paper_skill,Local::now().format("%H:%M")));
 if let Some(text)=shared_text{if text.chars().count()>12000{return Err("分享的题目或代码限 12000 字".into())}context.push_str("\n用户这次主动分享的题目或代码（不是实时桌面观测）：\n");context.push_str(&text);}
 let scenario=scenario.as_deref().unwrap_or("chat");if !matches!(scenario,"chat"|"hint"|"example"|"tutorial"){return Err("帮助方式无效".into())}
 let value=crate::companion_ai::respond(pool.inner(),&message,&context,scenario).await?;
 let text=value.get("text").and_then(Value::as_str).unwrap_or("").trim().chars().take(if scenario=="tutorial"{18000}else if scenario=="example"{6000}else{1500}).collect::<String>();
 if text.is_empty(){return Err("伙伴没有收到清晰的回复，请稍后再试".into())}
 let emotion=value.get("emotion").and_then(Value::as_str).filter(|s|matches!(*s,"happy"|"serious"|"curious"|"sleepy"|"surprised"|"calm")).unwrap_or("calm").to_owned();
 let suggested_task=value.get("suggestedTask").and_then(Value::as_str).map(|s|s.trim().chars().take(100).collect::<String>()).filter(|s|!s.is_empty());
 Ok(PetReply{text,emotion,suggested_task,source:"ai".into(),draft_id:value.get("draftId").and_then(Value::as_str).map(str::to_owned)})
}

#[tauri::command]
pub async fn list_companion_collection(pool:State<'_,SqlitePool>,offset:i64)->Result<Vec<PetSouvenir>,String>{
 if offset<0{return Err("收藏页码无效".into())}
 sqlx::query_as::<_,PetSouvenir>(&crate::companion::owned_sql("SELECT * FROM companion_collection WHERE {owner} ORDER BY collected_at DESC,id DESC LIMIT 24 OFFSET ?")).bind(offset).fetch_all(pool.inner()).await.map_err(|e|e.to_string())
}


#[cfg(test)]
mod tests{
 use super::*;
 async fn pool()->SqlitePool{
 let p=sqlx::sqlite::SqlitePoolOptions::new().max_connections(1).connect("sqlite::memory:").await.unwrap();
 sqlx::migrate!().run(&p).await.unwrap();p
 }
 #[tokio::test]
 async fn retry_and_concurrent_trips_keep_one_journey(){
 let p=pool().await;let a=Uuid::new_v4().to_string();let b=Uuid::new_v4().to_string();
 let (one,two)=tokio::join!(start_trip_db(&p,&a,"animal-crossing","nearby",30,1000),start_trip_db(&p,&b,"animal-crossing","nearby",30,1000));
 assert_ne!(one.is_ok(),two.is_ok());let trip=one.or(two).unwrap();
 let retry=start_trip_db(&p,&trip.id,"animal-crossing","nearby",30,2000).await.unwrap();
 assert_eq!(trip.returns_at,retry.returns_at);
 assert!(start_trip_db(&p,&trip.id,"animal-crossing","valley",30,2000).await.is_err());
 let count:i64=sqlx::query_scalar("SELECT COUNT(*) FROM companion_trips").fetch_one(&p).await.unwrap();assert_eq!(count,1);
 }
 #[tokio::test]
 async fn collection_claim_is_atomic_and_idempotent(){
 let p=pool().await;let trip=start_trip_db(&p,&Uuid::new_v4().to_string(),"parchment-journal","valley",30,1000).await.unwrap();
 assert!(claim_trip_db(&p,&trip.id,1001).await.is_err());
 let early:i64=sqlx::query_scalar("SELECT COUNT(*) FROM companion_collection").fetch_one(&p).await.unwrap();assert_eq!(early,0);
 let (a,b)=tokio::join!(claim_trip_db(&p,&trip.id,trip.returns_at),claim_trip_db(&p,&trip.id,trip.returns_at));
 assert_eq!(a.unwrap().id,b.unwrap().id);
 let count:i64=sqlx::query_scalar("SELECT COUNT(*) FROM companion_collection").fetch_one(&p).await.unwrap();assert_eq!(count,1);
 let state:String=sqlx::query_scalar("SELECT state FROM companion_trips").fetch_one(&p).await.unwrap();assert_eq!(state,"claimed");
 assert!(start_trip_db(&p,&Uuid::new_v4().to_string(),"pixel-jrpg","nearby",30,2000).await.is_ok());
 }
 #[tokio::test]
 async fn reminders_deliver_once_and_skip_stale_items(){
 let p=pool().await;let now=1000000;
 let item=PetReminder{key:"task:test:today".into(),id:"test".into(),kind:"task".into(),title:"fixture".into(),detail:"".into(),when_at:now+600000,importance:3};
 assert_eq!(due_items(&[item.clone()],now).len(),1);
 assert!(due_items(&[item.clone()],now+1200000).is_empty());
 let(a,b)=tokio::join!(claim_reminders(&p,vec![item.clone()],now),claim_reminders(&p,vec![item],now));
 assert_eq!(a.unwrap().len()+b.unwrap().len(),1);
 }
 #[tokio::test]
 async fn invalid_preferences_do_not_overwrite_saved_values(){
 let p=pool().await;
 let good=update_preferences_db(&p,json!({"name":"小红","quietStart":"23:00"})).await.unwrap();assert_eq!(good.name,"小红");
 assert!(update_preferences_db(&p,json!({"size":999})).await.is_err());
 assert!(update_preferences_db(&p,json!({"apiKey":"not-a-key"})).await.is_err());
 assert_eq!(preferences_db(&p).await.unwrap().size,96);
 assert_eq!(preferences_db(&p).await.unwrap().quiet_start,"23:00");
 sqlx::query("UPDATE settings SET value='broken json' WHERE key=?").bind(PREF_KEY).execute(&p).await.unwrap();
 assert_eq!(home_db(&p).await.unwrap().preferences.character,"fox");
 }
 #[tokio::test]
 async fn character_profiles_and_records_are_independent(){
  let p=pool().await;
  sqlx::query("INSERT INTO settings(key,value)VALUES(?,?)").bind(PREF_KEY).bind(r#"{"name":"旧狐狸","appearance":"pixel-jrpg"}"#).execute(&p).await.unwrap();
  assert_eq!(preferences_db(&p).await.unwrap().character,"fox");
  assert_eq!(preferences_db(&p).await.unwrap().outfit,"theme");
  update_preferences_db(&p,json!({"outfit":"scarf"})).await.unwrap();
  let fox_care=Uuid::new_v4().to_string();interact_db(&p,&fox_care,"game",Some(5)).await.unwrap();
  let trip=start_trip_db(&p,&Uuid::new_v4().to_string(),"animal-crossing","nearby",30,1000).await.unwrap();
  assert!(update_preferences_db(&p,json!({"character":"red-panda"})).await.unwrap_err().contains("旅行"));
  let souvenir=claim_trip_db(&p,&trip.id,trip.returns_at).await.unwrap();
  let panda=update_preferences_db(&p,json!({"character":"red-panda"})).await.unwrap();
  assert_eq!(panda.name,"小熊猫");assert_eq!(panda.outfit,"theme");assert_eq!(panda.appearance,"follow");
  assert_eq!(care_db(&p).await.unwrap().affection,0);
  assert_eq!(crate::companion_memory::journal(&p,0).await.unwrap().memory_total,0);
  assert!(claim_trip_db(&p,&trip.id,trip.returns_at).await.is_err());
  assert!(interact_db(&p,&fox_care,"game",Some(5)).await.is_err());
  update_preferences_db(&p,json!({"name":"竹竹","outfit":"none","appearance":"stardew-valley"})).await.unwrap();
  interact_db(&p,&Uuid::new_v4().to_string(),"brush",None).await.unwrap();
  let fox=update_preferences_db(&p,json!({"character":"fox"})).await.unwrap();
  assert_eq!(fox.name,"旧狐狸");assert_eq!(fox.outfit,"scarf");assert_eq!(fox.appearance,"pixel-jrpg");
  assert_eq!(care_db(&p).await.unwrap().best_moves,Some(5));
  let home=home_db(&p).await.unwrap();assert_eq!(home.keepsake.unwrap().id,souvenir.id);assert_eq!(home.collection_total,1);
  let panda=update_preferences_db(&p,json!({"character":"red-panda"})).await.unwrap();assert_eq!(panda.name,"竹竹");assert_eq!(panda.outfit,"none");
  assert_eq!(home_db(&p).await.unwrap().collection_total,0);
  for patch in [json!({"character":"cat"}),json!({"outfit":"hat"}),json!({"character":null})]{assert!(update_preferences_db(&p,patch).await.is_err());}
  assert_eq!(preferences_db(&p).await.unwrap().name,"竹竹");
 }
 #[test]
 fn overnight_quiet_hours(){
 use chrono::TimeZone;
 let p=PetPreferences::default();
 let at=|h|Local.with_ymd_and_hms(2026,10,6,h,0,0).single().unwrap();
 assert!(quiet_at(&p,&at(23)));assert!(quiet_at(&p,&at(7)));assert!(!quiet_at(&p,&at(12)));
 let mut all_day=p;all_day.quiet_start="00:00".into();all_day.quiet_end="00:00".into();assert!(!quiet_at(&all_day,&at(12)));
 }
 #[tokio::test]
 async fn character_play_memory_and_goal_ownership(){
  let p=pool().await;
  let play=Uuid::new_v4().to_string();crate::companion_life::begin_play(&p,&play,1000).await.unwrap();
  for catch in 1..=3{crate::companion_life::catch_paper(&p,&play,catch,1000+catch*700).await.unwrap();}
  assert_eq!(crate::companion_life::growth(&p).await.unwrap().play_days,1);
  let task=crate::agent_tools::call(&p,"xmission_create_task",json!({"requestId":"shared-task","input":{"title":"共享目标"}})).await.unwrap();
  let task_id=task["task"]["id"].as_str().unwrap();
  let mut tx=gamification::begin_write(&p).await.unwrap();
  sqlx::query(&owned_sql("INSERT INTO companion_goal_categories(character,task_id,category,confirmed_at)VALUES({active},?,'reading',1000)")).bind(task_id).execute(&mut *tx).await.unwrap();
  crate::companion_memory::record(&mut tx,"same-event","focus","same","狐狸的专注","",None,"2026-10-10").await.unwrap();tx.commit().await.unwrap();
  update_preferences_db(&p,json!({"character":"red-panda"})).await.unwrap();
  assert!(!crate::companion_life::growth(&p).await.unwrap().paper_skill);
  assert!(crate::companion_life::begin_play(&p,&play,4000).await.is_err());
  assert!(crate::companion_life::catch_paper(&p,&play,3,4000).await.is_err());
  assert_eq!(sqlx::query_scalar::<_,i64>(&owned_sql("SELECT COUNT(*) FROM companion_goal_categories WHERE {owner}")).fetch_one(&p).await.unwrap(),0);
  let mut tx=gamification::begin_write(&p).await.unwrap();
  crate::companion_memory::record(&mut tx,"same-event","focus","same","小熊猫的专注","",None,"2026-10-11").await.unwrap();
  sqlx::query(&owned_sql("UPDATE companion_memories SET forgotten=1 WHERE {owner} AND event_key='same-event'")).execute(&mut *tx).await.unwrap();tx.commit().await.unwrap();
  crate::task_engine::complete_task_db(&p,task_id).await.unwrap();let wallet=gamification::build_wallet(&p).await.unwrap();
  update_preferences_db(&p,json!({"character":"fox"})).await.unwrap();
  assert_eq!(crate::companion_life::growth(&p).await.unwrap().play_days,1);
  let j=crate::companion_memory::journal(&p,0).await.unwrap();assert!(j.memories.iter().any(|m|m.title=="狐狸的专注"));assert!(j.memories.iter().all(|m|m.title!="小熊猫的专注"));
  assert_eq!(gamification::build_wallet(&p).await.unwrap().xp_total,wallet.xp_total);
  assert_eq!(gamification::build_wallet(&p).await.unwrap().coins,wallet.coins);
 }
 #[tokio::test]
 async fn character_switch_and_trip_serialize_on_real_connections(){
  let path=std::env::temp_dir().join(format!("xmission-companion-{}.sqlite",Uuid::new_v4()));
  let options=sqlx::sqlite::SqliteConnectOptions::new().filename(&path).create_if_missing(true).journal_mode(sqlx::sqlite::SqliteJournalMode::Wal).busy_timeout(std::time::Duration::from_secs(10));
  let p=sqlx::sqlite::SqlitePoolOptions::new().max_connections(4).connect_with(options).await.unwrap();sqlx::migrate!().run(&p).await.unwrap();
  for _ in 0..8{
   update_preferences_db(&p,json!({"character":"fox"})).await.unwrap();
   let id=Uuid::new_v4().to_string();
   let (switched,trip)=tokio::join!(update_preferences_db(&p,json!({"character":"red-panda"})),start_trip_db(&p,&id,"animal-crossing","nearby",30,1000));
   let trip=trip.unwrap();let active=preferences_db(&p).await.unwrap();
   let owner:String=sqlx::query_scalar("SELECT character FROM companion_trips WHERE id=?").bind(&id).fetch_one(&p).await.unwrap();
   assert_eq!(owner,active.character);assert_eq!(switched.is_ok(),active.character=="red-panda");
   settle_trips(&p,trip.returns_at).await.unwrap();assert!(update_preferences_db(&p,json!({"character":if owner=="fox"{"red-panda"}else{"fox"}})).await.is_err());
   let home=home_db(&p).await.unwrap();assert_eq!(home.preferences.character,owner);assert_eq!(home.trip.unwrap().id,id);
   claim_trip_db(&p,&id,trip.returns_at).await.unwrap();
  }
  p.close().await;std::fs::remove_file(&path).unwrap();
 }
 #[tokio::test]
 async fn character_migration_assigns_old_records_to_fox(){
  let p=sqlx::sqlite::SqlitePoolOptions::new().max_connections(1).connect("sqlite::memory:").await.unwrap();
  let migrations=sqlx::migrate!();
  for migration in migrations.iter().filter(|m|m.version<17){sqlx::raw_sql(&migration.sql).execute(&p).await.unwrap();}
  sqlx::query("INSERT INTO companion_care_events(id,day,action,affection_delta,created_at)VALUES('old','2026-10-10','brush',3,1000)").execute(&p).await.unwrap();
  sqlx::query("INSERT INTO companion_memories(event_key,kind,entity_id,title,day,created_at)VALUES('groom:old','groom','old','旧记忆','2026-10-10',1000)").execute(&p).await.unwrap();
  sqlx::raw_sql(include_str!("../migrations/0017_companion_characters.sql")).execute(&p).await.unwrap();
  assert_eq!(care_db(&p).await.unwrap().affection,3);assert_eq!(crate::companion_memory::journal(&p,3).await.unwrap().memory_total,1);
  update_preferences_db(&p,json!({"character":"red-panda"})).await.unwrap();assert_eq!(care_db(&p).await.unwrap().affection,0);assert_eq!(crate::companion_memory::journal(&p,0).await.unwrap().memory_total,0);
  update_preferences_db(&p,json!({"character":"fox"})).await.unwrap();assert_eq!(care_db(&p).await.unwrap().affection,3);
 }
}


#[derive(Clone,Debug,Serialize)]
#[serde(rename_all="camelCase")]
pub struct PetCare {pub affection:i64,pub best_moves:Option<i64>,pub completed_games:i64,pub cared_today:Vec<String>}
pub async fn care_db(pool:&SqlitePool)->Result<PetCare,String>{
 let mut tx=pool.begin().await.map_err(|e|e.to_string())?;let result=care_connection(&mut tx).await?;tx.commit().await.map_err(|e|e.to_string())?;Ok(result)
}
pub(crate) async fn care_connection(conn:&mut sqlx::SqliteConnection)->Result<PetCare,String>{
 let(affection,best_moves,completed_games):(i64,Option<i64>,i64)=sqlx::query_as(&crate::companion::owned_sql("SELECT MIN(100,COALESCE(SUM(affection_delta),0)),MIN(CASE WHEN action='game' THEN moves END),COUNT(CASE WHEN action='game' THEN 1 END) FROM companion_care_events WHERE {owner}")).fetch_one(&mut *conn).await.map_err(|e|e.to_string())?;
 let cared_today=sqlx::query_scalar(&crate::companion::owned_sql("SELECT DISTINCT action FROM companion_care_events WHERE {owner} AND day=?")).bind(Local::now().date_naive().to_string()).fetch_all(&mut *conn).await.map_err(|e|e.to_string())?;
 Ok(PetCare{affection,best_moves,completed_games,cared_today})
}
pub async fn interact_db(pool:&SqlitePool,id:&str,action:&str,moves:Option<i64>)->Result<PetCare,String>{
 Uuid::parse_str(id).map_err(|_|"互动请求无效")?;
 if !matches!(action,"stroke"|"snack"|"brush"|"game"){return Err("不支持这项互动".into())}
 if action=="game"&&moves.is_none_or(|m|!(3..=99).contains(&m)){return Err("游戏步数无效".into())}
 if action!="game"&&moves.is_some(){return Err("互动参数无效".into())}
 let mut tx=gamification::begin_write(pool).await?;
 let foreign:bool=sqlx::query_scalar(&owned_sql("SELECT EXISTS(SELECT 1 FROM companion_care_events WHERE id=? AND NOT ({owner}))")).bind(id).fetch_one(&mut *tx).await.map_err(|e|e.to_string())?;
 if foreign{return Err("这次互动属于另一位伙伴，请切回后继续".into())}
 let old:Option<(String,Option<i64>)>=sqlx::query_as(&crate::companion::owned_sql("SELECT action,moves FROM companion_care_events WHERE {owner} AND id=?")).bind(id).fetch_optional(&mut *tx).await.map_err(|e|e.to_string())?;
 if let Some((previous,score))=old {if previous!=action||score!=moves{return Err("互动请求已经用于别的操作".into())}}
 else{
 let day=Local::now().date_naive().to_string();
 let seen:i64=sqlx::query_scalar(&crate::companion::owned_sql("SELECT COUNT(*) FROM companion_care_events WHERE {owner} AND day=? AND action=?")).bind(&day).bind(action).fetch_one(&mut *tx).await.map_err(|e|e.to_string())?;
 sqlx::query(&crate::companion::owned_sql("INSERT INTO companion_care_events(character,id,day,action,moves,affection_delta,created_at) VALUES({active},?,?,?,?,?,?)")).bind(id).bind(&day).bind(action).bind(moves).bind(if seen==0{if action=="game"{8}else{3}}else{0}).bind(Utc::now().timestamp_millis()).execute(&mut *tx).await.map_err(|e|e.to_string())?;
 crate::companion_memory::cared(&mut tx,id,action,&day).await?;
 }let care=care_connection(&mut tx).await?;tx.commit().await.map_err(|e|e.to_string())?;Ok(care)
}
#[tauri::command]
pub async fn interact_companion(app:AppHandle,pool:State<'_,SqlitePool>,request_id:String,action:String,moves:Option<i64>,animate:Option<bool>)->Result<PetCare,String>{
 let care=interact_db(pool.inner(),&request_id,&action,moves).await?;
 let gesture=match action.as_str(){"game"=>"game-match","brush"=>"groom","snack"=>"snack",_=>"pet"};
 let _=app.emit("companion-changed",());
 // Hover care already began locally; saving it must not restart the same animation.
 if animate.unwrap_or(true){let _=app.emit("companion-gesture",json!({"action":gesture}));}Ok(care)
}


#[cfg(test)]
mod care_tests{
 use super::*;
 #[tokio::test]
 async fn duplicate_interactions_do_not_duplicate_bond_and_games_keep_best_score(){
 let p=sqlx::sqlite::SqlitePoolOptions::new().max_connections(1).connect("sqlite::memory:").await.unwrap();
 sqlx::migrate!().run(&p).await.unwrap();
 let id=Uuid::new_v4().to_string();
 let(a,b)=tokio::join!(interact_db(&p,&id,"snack",None),interact_db(&p,&id,"snack",None));a.unwrap();b.unwrap();
 assert_eq!(care_db(&p).await.unwrap().affection,3);
 interact_db(&p,&Uuid::new_v4().to_string(),"snack",None).await.unwrap();
 assert_eq!(care_db(&p).await.unwrap().affection,3);
 assert!(interact_db(&p,&id,"brush",None).await.is_err());
 assert!(interact_db(&p,&Uuid::new_v4().to_string(),"game",Some(1)).await.is_err());
 let game=Uuid::new_v4().to_string();interact_db(&p,&game,"game",Some(9)).await.unwrap();
 interact_db(&p,&game,"game",Some(9)).await.unwrap();
 interact_db(&p,&Uuid::new_v4().to_string(),"game",Some(4)).await.unwrap();
 let c=care_db(&p).await.unwrap();assert_eq!(c.affection,11);assert_eq!(c.best_moves,Some(4));assert_eq!(c.completed_games,2);
 }
}


/// Pick whole strides that fit the actual physical work area, including high-DPI displays.
pub fn walk_right_chance(left:i32,right:i32)->f64 {
 let (left,right)=(left.max(0)as f64,right.max(0)as f64);
 if left+right==0.0{0.5}else{right/(left+right)}
}
pub fn catch_up_due_items(items:&[PetReminder],now:i64)->Vec<PetReminder>{
 let mut due:Vec<_>=items.iter().filter(|i|i.when_at-now<=15*60000&&now-i.when_at<=if matches!(i.kind.as_str(),"task"|"step"){24*60*60000}else{120*60000}).cloned().collect();
 due.sort_by(reminder_order);due.truncate(20);due
}
pub fn plan_walk(left:i32,right:i32,desired:i32,prefer_right:bool)->Option<(i32,u64)>{
 if desired<2{return None}
 let (first,second)=if prefer_right{(right,left)}else{(left,right)};
 let sign=if prefer_right{1}else{-1};
 if first>=desired{return Some((sign*desired,1920))}
 if second>=desired{return Some((-sign*desired,1920))}
 let step=(desired+1)/2;
 if first>=step{return Some((sign*step,960))}
 if second>=step{return Some((-sign*step,960))}
 None
}
#[cfg(test)]
mod motion_tests{
 use super::*;
 #[test]fn stride_plan_reflects_at_edges_and_keeps_dpi_distances(){
 assert_eq!(plan_walk(1000,22,91,true),Some((-91,1920)));
 assert_eq!(plan_walk(160,24,122,true),Some((-122,1920)));
 assert_eq!(plan_walk(35,21,61,true),Some((-31,960)));
 assert_eq!(plan_walk(5,5,61,true),None);
 }

 #[test]fn turn_probability_tracks_available_space(){
 assert_eq!(walk_right_chance(0,500),1.0);assert_eq!(walk_right_chance(500,0),0.0);
 assert_eq!(walk_right_chance(50,150),0.75);assert_eq!(walk_right_chance(100,100),0.5);
 assert_eq!(walk_right_chance(-5,0),0.5);
 }
}


pub async fn queue_due_items(pool:&SqlitePool,items:&[PetReminder],now:i64)->Result<(),String>{
 let mut tx=gamification::begin_write(pool).await?;
 for i in items{sqlx::query("INSERT OR IGNORE INTO companion_notice_queue(event_key,entity_id,kind,payload,queued_at) SELECT ?,?,?,?,? WHERE NOT EXISTS(SELECT 1 FROM companion_reminders WHERE event_key=?)")
 .bind(&i.key).bind(&i.id).bind(&i.kind).bind(serde_json::to_string(i).map_err(|e|e.to_string())?).bind(now).bind(&i.key).execute(&mut *tx).await.map_err(|e|e.to_string())?;}
 sqlx::query(&crate::companion::owned_sql("DELETE FROM companion_notice_queue WHERE queued_at<? OR (kind='task' AND entity_id NOT IN(SELECT id FROM tasks WHERE status NOT IN('done','shelved'))) OR (kind='trip' AND entity_id NOT IN(SELECT id FROM companion_trips WHERE {owner} AND state='returned'))"))
 .bind(now-86400000).execute(&mut *tx).await.map_err(|e|e.to_string())?;
 tx.commit().await.map_err(|e|e.to_string())?;Ok(())
}
pub async fn queued_items(pool:&SqlitePool,now:i64)->Result<Vec<PetReminder>,String>{
 let current=today_items(pool,Local::now()).await?;let valid:std::collections::HashSet<_>=current.iter().map(|i|i.key.clone()).collect();
 let raw:Vec<String>=sqlx::query_scalar("SELECT payload FROM companion_notice_queue ORDER BY queued_at,event_key LIMIT 100").fetch_all(pool).await.map_err(|e|e.to_string())?;
 let mut items=Vec::new();let mut stale=Vec::new();for value in raw{if let Ok(mut item)=serde_json::from_str::<PetReminder>(&value){
  let eligible=if item.kind=="trip"{sqlx::query_scalar::<_,bool>(&crate::companion::owned_sql("SELECT EXISTS(SELECT 1 FROM companion_trips WHERE {owner} AND id=? AND state='returned')")).bind(&item.id).fetch_one(pool).await.map_err(|e|e.to_string())?}else{valid.contains(&item.key)};
  if eligible&&(item.kind!="course"||now-item.when_at<120*60000){if let Some(updated)=current.iter().find(|i|i.key==item.key){item=updated.clone();}items.push(item);}else{stale.push(item.key);}
 }}if !stale.is_empty(){forget_queued(pool,&stale).await?;}items.truncate(20);Ok(items)
}
pub async fn forget_queued(pool:&SqlitePool,keys:&[String])->Result<(),String>{
 let mut tx=gamification::begin_write(pool).await?;
 for key in keys{sqlx::query("DELETE FROM companion_notice_queue WHERE event_key=?").bind(key).execute(&mut *tx).await.map_err(|e|e.to_string())?;}
 tx.commit().await.map_err(|e|e.to_string())?;Ok(())
}

#[tauri::command]
pub async fn get_reminder_inbox(pool:State<'_,SqlitePool>)->Result<Value,String>{
 let now=Local::now();let p=preferences_db(pool.inner()).await?;
 if p.reminders {let items=today_items(pool.inner(),now).await?;queue_due_items(pool.inner(),&catch_up_due_items(&items,now.timestamp_millis()),now.timestamp_millis()).await?;}
 let pending=queued_items(pool.inner(),now.timestamp_millis()).await?;
 let heartbeat:Option<String>=sqlx::query_scalar("SELECT value FROM settings WHERE key='reminder_heartbeat'").fetch_optional(pool.inner()).await.map_err(|e|e.to_string())?;
 let last:Option<i64>=sqlx::query_scalar("SELECT MAX(delivered_at) FROM companion_reminders").fetch_one(pool.inner()).await.map_err(|e|e.to_string())?;
 Ok(json!({"pending":pending,"enabled":p.reminders,"quiet":quiet_at(&p,&now),"petVisible":p.enabled&&p.desktop_enabled&&p.display_mode!="closed","heartbeat":heartbeat,"lastDeliveredAt":last,"boundary":"主程序或托盘进程运行时检查；完全退出和休眠期间不能提醒。唤醒后补查任务 24 小时、课程 2 小时内的安排；安静时段和专注时延后，过时或已完成提醒撤下。"}))
}
#[tauri::command]
pub async fn acknowledge_reminder(app:AppHandle,pool:State<'_,SqlitePool>,key:String)->Result<(),String>{
 let now=Utc::now().timestamp_millis();let items=queued_items(pool.inner(),now).await?;
 let item=items.into_iter().find(|i|i.key==key).ok_or("提醒已变化，请刷新")?;
 claim_reminders(pool.inner(),vec![item],now).await?;forget_queued(pool.inner(),&[key]).await?;let _=app.emit("reminders-changed",());Ok(())
}
