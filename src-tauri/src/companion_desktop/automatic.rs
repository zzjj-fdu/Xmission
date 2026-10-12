//! Idle-only nearby exploration. Geometry queries run outside all placement locks.
use super::*;
use std::sync::atomic::{AtomicBool,AtomicU64};
use crate::pet_exploration::{self,Candidate,Clock,Context};
#[derive(Clone,Serialize)]#[serde(rename_all="camelCase")]
pub struct Cue{pub id:u64,pub mode:String,pub phase:String,pub direction:String,pub duration_ms:u64}
#[derive(Default)]pub(super) struct Runtime{
 pub moving:AtomicBool,serial:AtomicU64,ready:AtomicU64,probe:Arc<AtomicBool>,clock:Mutex<Clock>,cue:Mutex<Option<Cue>>,icons:Arc<Mutex<(i64,Vec<crate::desktop_icons::Icon>)>>,
}
#[derive(Clone)]struct Spot{choice:Choice,frame:Area,work:Area,scale:f64,mode:String,along:f64,target:(i32,i32),key:String,distance:f64}
struct ProbeGuard(Arc<AtomicBool>);impl Drop for ProbeGuard{fn drop(&mut self){self.0.store(false,Ordering::SeqCst)}}
struct MotionGuard(AppHandle);impl Drop for MotionGuard{fn drop(&mut self){self.0.state::<DesktopRuntime>().automatic.moving.store(false,Ordering::SeqCst);self.0.state::<Arc<PetRuntime>>().wandering.store(false,Ordering::SeqCst)}}
pub(super) fn cancel(app:&AppHandle){
 let runtime=app.state::<DesktopRuntime>();runtime.automatic.serial.fetch_add(1,Ordering::SeqCst);
 let cue=runtime.automatic.cue.lock().ok().and_then(|mut c|c.take());
 if let Some(mut cue)=cue{cue.phase="end".into();let _=app.emit_to("companion","companion-perch-motion",cue);}
 if let Ok(mut c)=runtime.automatic.clock.lock(){c.interrupted(chrono::Utc::now().timestamp_millis());};
}
pub(super) fn ready(app:&AppHandle,id:u64){let rt=app.state::<DesktopRuntime>();if rt.automatic.serial.load(Ordering::SeqCst)==id{rt.automatic.ready.store(id,Ordering::SeqCst)}}
pub(super) fn snapshot(app:&AppHandle)->Option<Cue>{app.state::<DesktopRuntime>().automatic.cue.lock().ok()?.clone()}
#[cfg(windows)]pub(super) async fn lookup(app:&AppHandle,c:Choice)->Result<Option<(Area,Area,f64)>,()>{
 let probe=app.state::<DesktopRuntime>().automatic.probe.clone();if probe.swap(true,Ordering::SeqCst){return Err(())}
 let job=tokio::task::spawn_blocking(move||{let _guard=ProbeGuard(probe);win::geometry(&c)});
 tokio::time::timeout(Duration::from_secs(2),job).await.map_err(|_|())?.map_err(|_|())
}
#[cfg(windows)]fn emit(app:&AppHandle,id:u64,mode:&str,phase:&str,direction:&str,ms:u64){
 let cue=Cue{id,mode:mode.into(),phase:phase.into(),direction:direction.into(),duration_ms:ms};
 if let Ok(mut stored)=app.state::<DesktopRuntime>().automatic.cue.lock(){*stored=Some(cue.clone());}
 let _=app.emit_to("companion","companion-perch-motion",cue);
}
#[cfg(windows)]fn user_busy(app:&AppHandle,rt:&PetRuntime)->bool{
 rt.dismissed.load(Ordering::SeqCst)||rt.moving.load(Ordering::SeqCst)||rt.morphing.load(Ordering::SeqCst)||rt.hovering.load(Ordering::SeqCst)||win::menu_active()
 ||["companion-panel","companion-input","companion-notice"].iter().any(|name|app.get_webview_window(name).is_some_and(|w|w.is_visible().unwrap_or(false)))
}
#[cfg(windows)]async fn permitted(app:&AppHandle,allow_own_motion:bool)->Option<crate::companion::PetPreferences>{
 let rt=app.state::<Arc<PetRuntime>>();
 if user_busy(app,&rt)||win::input_active()||crate::companion_toy::active(app)||(!allow_own_motion&&(rt.wandering.load(Ordering::SeqCst)||rt.performing.load(Ordering::SeqCst)||attached(app)||crate::companion_dock::view(app).side.is_some())){return None}
 let pool=app.state::<sqlx::SqlitePool>();let p=crate::companion::preferences_db(pool.inner()).await.ok()?;
 let focusing:i64=sqlx::query_scalar("SELECT COUNT(*) FROM pomodoro_sessions WHERE state='running'").fetch_one(pool.inner()).await.unwrap_or(1);
 let away:i64=sqlx::query_scalar(&crate::companion::owned_sql("SELECT COUNT(*) FROM companion_trips WHERE {owner} AND state='away'")).fetch_one(pool.inner()).await.unwrap_or(1);
 let busy=user_busy(app,&rt)||crate::companion_toy::active(app)||away>0||(!allow_own_motion&&(rt.wandering.load(Ordering::SeqCst)||rt.performing.load(Ordering::SeqCst)||attached(app)||crate::companion_dock::view(app).side.is_some()));
 let context=Context{enabled:p.enabled&&p.auto_perch&&!p.reduced_motion,desktop:p.desktop_enabled,normal:p.display_mode=="normal",quiet:crate::companion::quiet_at(&p,&chrono::Local::now()),focus:focusing>0,busy,typing:win::input_active()};
 pet_exploration::permitted(&context).then_some(p)
}
#[cfg(windows)]fn sample()->f64{u16::from_le_bytes([uuid::Uuid::new_v4().as_bytes()[0],uuid::Uuid::new_v4().as_bytes()[1]])as f64/65536.0}
#[cfg(windows)]async fn discover(app:&AppHandle,p:&crate::companion::PetPreferences)->Option<Spot>{
 let pet=app.get_webview_window("companion").filter(|w|w.is_visible().unwrap_or(false))?;
 let pos=pet.outer_position().ok()?;let size=pet.outer_size().ok()?;let scale=pet.scale_factor().ok()?;
 let(l,t,r,b)=crate::companion_window::bounds(&pet).ok()?;let own_work=Area{left:l,top:t,right:r,bottom:b};
 let runtime=app.state::<DesktopRuntime>();let probe=runtime.automatic.probe.clone();if probe.swap(true,Ordering::SeqCst){return None}
 let cache=runtime.automatic.icons.clone();let character=p.character.clone();let nominal=p.size as i32;let range=(p.wander_range as f64).max(p.size as f64*2.0).clamp(180.0,320.0);let now=chrono::Utc::now().timestamp_millis();
 let job=tokio::task::spawn_blocking(move||{
  let _guard=ProbeGuard(probe);let mut targets:Vec<(Choice,Area,Area,f64)>=win::choices().into_iter().filter_map(|c|win::geometry(&c).map(|(f,a,s)|(c,f,a,s))).filter(|(_,f,a,_)|*a==own_work&&f.right-f.left>=240&&f.bottom-f.top>=140).collect();
  // Nearby exposed icons may lie beyond the three points beside the actor.
  // Keep the cheap cache available; each candidate's actual support point is
  // still checked below so icons covered by application windows are rejected.
  {
   let stale=cache.lock().ok().is_some_and(|v|now-v.0>10000);
   if stale{if let Ok(icons)=crate::desktop_icons::read(){if let Ok(mut stored)=cache.lock(){*stored=(now,icons);}}}
   let icons=cache.lock().ok().map(|v|v.1.clone()).unwrap_or_default();
   for icon in icons{if icon.rect.left>=l&&icon.rect.right<=r&&icon.rect.top>=t&&icon.rect.bottom<=b{targets.push((Choice{id:format!("icon:{}",icon.name),title:icon.name,handle:0,pid:0},icon.rect,own_work,scale));}}
  }
  let mut spots=Vec::new();
  for(choice,frame,work,_)in targets{
   let modes:&[&str]=if choice.handle==0{&["icon","icon-left"]}else{&["top","top-hang","left","right","bottom"]};
   let top_fits=crate::pet_perch::position_along_character(frame,work,nominal,scale,"top",crate::pet_perch::nearest_along(frame,nominal,scale,"top",(pos.x,pos.y)),&character).is_some();
   for mode in modes{if *mode=="top-hang"&&top_fits{continue}let along=crate::pet_perch::nearest_along(frame,nominal,scale,mode,(pos.x,pos.y));let Some(target)=crate::pet_perch::position_along_character(frame,work,nominal,scale,mode,along,&character)else{continue};
    let distance=((target.0-pos.x)as f64).hypot((target.1-pos.y)as f64)/scale;if distance>range{continue}
    if !win::space_free(&choice,frame,mode,target,size.width as i32){continue}
    let key=if choice.handle==0{choice.id.clone()}else{format!("window:{}:{}",choice.handle,choice.pid)};
    spots.push(Spot{choice:choice.clone(),frame,work,scale,mode:mode.to_string(),along,target,key,distance});
   }
  }spots
 });
 let spots=tokio::time::timeout(Duration::from_secs(2),job).await.ok()?.ok()?;
 let candidates:Vec<Candidate>=spots.iter().map(|s|Candidate{key:s.key.clone(),distance:s.distance,free:true}).collect();
 let recent=runtime.automatic.clock.lock().ok()?.recent.clone();
 pet_exploration::choose(&candidates,&recent,now,range,sample()).map(|i|spots[i].clone())
}
#[cfg(windows)]async fn move_actor(app:&AppHandle,w:&tauri::WebviewWindow,from:(i32,i32),to:(i32,i32),ms:u64,id:u64,ticket:u64)->bool{
 let rt=app.state::<Arc<PetRuntime>>();let runtime=app.state::<DesktopRuntime>();let started=std::time::Instant::now();
 loop{
  if runtime.automatic.serial.load(Ordering::SeqCst)!=id||rt.generation.load(Ordering::SeqCst)!=ticket||user_busy(app,&rt)||win::input_active()||!w.is_visible().unwrap_or(false){return false}
  let elapsed=(started.elapsed().as_millis()as f64/ms.max(1)as f64).min(1.0);
  let placed={if let Ok(_guard)=rt.placement.try_lock(){if rt.moving.load(Ordering::SeqCst){return false}if w.set_position(tauri::PhysicalPosition::new(from.0+((to.0-from.0)as f64*elapsed)as i32,from.1+((to.1-from.1)as f64*elapsed)as i32)).is_err(){return false}true}else{false}};
  if !placed{tokio::time::sleep(Duration::from_millis(16)).await;continue}
  if elapsed>=1.0{return true}tokio::time::sleep(Duration::from_millis(16)).await;
 }
}
#[cfg(windows)]async fn visit(app:&AppHandle,mut spot:Spot,p:crate::companion::PetPreferences){
 let Some(w)=app.get_webview_window("companion")else{return};let Ok(start)=w.outer_position()else{return};
 let runtime=app.state::<DesktopRuntime>();let rt=app.state::<Arc<PetRuntime>>().inner().clone();
 if rt.wandering.compare_exchange(false,true,Ordering::SeqCst,Ordering::SeqCst).is_err(){return}
 runtime.automatic.moving.store(true,Ordering::SeqCst);let _motion=MotionGuard(app.clone());
 let id=runtime.automatic.serial.fetch_add(1,Ordering::SeqCst)+1;let ticket=rt.generation.fetch_add(1,Ordering::SeqCst)+1;runtime.automatic.ready.store(0,Ordering::SeqCst);
 let direction=if spot.target.0<start.x{"left"}else{"right"};emit(app,id,&spot.mode,"prepare",direction,650);
 for _ in 0..100{if runtime.automatic.serial.load(Ordering::SeqCst)!=id||user_busy(app,&rt){break}if runtime.automatic.ready.load(Ordering::SeqCst)==id{break}tokio::time::sleep(Duration::from_millis(20)).await;}
 let result=async{
  if runtime.automatic.ready.load(Ordering::SeqCst)!=id{return None}tokio::time::sleep(Duration::from_millis(650)).await;
  if runtime.automatic.serial.load(Ordering::SeqCst)!=id||permitted(app,true).await.is_none(){return None}
  let(frame,work,_)=lookup(app,spot.choice.clone()).await.ok()??;let scale=monitor_scale(app,work,spot.scale);
  let target=crate::pet_perch::position_along_character(frame,work,p.size as i32,scale,&spot.mode,spot.along,&p.character)?;spot.frame=frame;spot.work=work;spot.target=target;
  let range=(p.wander_range as f64).max(p.size as f64*2.0).clamp(180.0,320.0);if ((target.0-start.x)as f64).hypot((target.1-start.y)as f64)/scale>range{return None}
  if !win::space_free(&spot.choice,frame,&spot.mode,target,(p.size as f64*1.5*scale).ceil()as i32){return None}
  let mut approach=target;approach.1+=(p.size as f64*scale*0.25).round()as i32;approach=crate::companion_window::clamp_position(&w,approach.0,approach.1).ok()?;
  let distance=((approach.0-start.x)as f64).hypot((approach.1-start.y)as f64)/scale;let stride_speed=if p.character=="red-panda"{38.0*p.size as f64/96.0}else{90.0};let ms=(distance/stride_speed*1000.0).clamp(550.0,9500.0)as u64;
  emit(app,id,&spot.mode,"walk",direction,ms);
  if !move_actor(app,&w,(start.x,start.y),approach,ms,id,ticket).await{return None}
  if permitted(app,true).await.is_none(){return None}
  let(fresh_frame,fresh_work,_)=lookup(app,spot.choice.clone()).await.ok()??;
  let target=crate::pet_perch::position_along_character(fresh_frame,fresh_work,p.size as i32,monitor_scale(app,fresh_work,scale),&spot.mode,spot.along,&p.character)?;
  if !win::space_free(&spot.choice,fresh_frame,&spot.mode,target,(p.size as f64*1.5*scale).ceil()as i32){return None}
  *runtime.attached.lock().ok()?=Some(Attachment{choice:spot.choice.clone(),origin:(start.x,start.y),until:chrono::Utc::now().timestamp_millis()+25000+(sample()*40000.0)as i64,mode:spot.mode.clone(),along:spot.along,automatic:Some(id),cutout:crate::pet_perch::icon_cutout(fresh_frame,target,monitor_scale(app,fresh_work,scale),&spot.mode)});
  emit(app,id,&spot.mode,"enter",direction,440);
  if !move_actor(app,&w,approach,target,440,id,ticket).await{return None}
  publish(app,Some(&spot.mode));emit(app,id,&spot.mode,"hold",direction,0);
  if let Ok(mut clock)=runtime.automatic.clock.lock(){clock.visited(spot.key.clone(),chrono::Utc::now().timestamp_millis(),sample());}Some(())
 }.await;
 if result.is_none(){if runtime.automatic.serial.load(Ordering::SeqCst)==id{release(app,false);}else{let cue=Cue{id,mode:spot.mode,phase:"end".into(),direction:direction.into(),duration_ms:0};let _=app.emit_to("companion","companion-perch-motion",cue);}}
}
#[cfg(windows)]pub(super) async fn depart(app:&AppHandle,a:Attachment){
 if !app.state::<DesktopRuntime>().attached.lock().ok().is_some_and(|s|s.as_ref().is_some_and(|current|current.choice.id==a.choice.id&&current.mode==a.mode&&current.until==a.until)){return}
 let runtime=app.state::<DesktopRuntime>();let id=a.automatic.unwrap_or_else(||runtime.automatic.serial.fetch_add(1,Ordering::SeqCst)+1);let rt=app.state::<Arc<PetRuntime>>().inner().clone();
 if user_busy(app,&rt)||win::input_active()||rt.wandering.swap(true,Ordering::SeqCst){return}runtime.automatic.moving.store(true,Ordering::SeqCst);let _motion=MotionGuard(app.clone());
 if !app.get_webview_window("companion").is_some_and(|w|w.is_visible().unwrap_or(false)){release(app,false);return}rt.generation.fetch_add(1,Ordering::SeqCst);
 emit(app,id,&a.mode,"leave","right",400);tokio::time::sleep(Duration::from_millis(400)).await;
 if runtime.automatic.serial.load(Ordering::SeqCst)!=id{return}
 if user_busy(app,&rt){emit(app,id,&a.mode,"hold","right",0);return}
 if let Ok(mut attached)=runtime.attached.lock(){*attached=None;}
 publish(app,None);emit(app,id,&a.mode,"settle","right",800);cancel(app);
}
pub(super) fn start(app:AppHandle){
 #[cfg(windows)]tauri::async_runtime::spawn(async move{
  if let Ok(mut clock)=app.state::<DesktopRuntime>().automatic.clock.lock(){*clock=Clock::new(chrono::Utc::now().timestamp_millis());}
  let mut timer=tokio::time::interval(Duration::from_secs(5));loop{timer.tick().await;
   let current=app.state::<DesktopRuntime>().attached.lock().ok().and_then(|v|v.clone());
   if let Some(a)=current{if a.automatic.is_some(){let pool=app.state::<sqlx::SqlitePool>();let pref=crate::companion::preferences_db(pool.inner()).await.ok();let focus:i64=sqlx::query_scalar("SELECT COUNT(*) FROM pomodoro_sessions WHERE state='running'").fetch_one(pool.inner()).await.unwrap_or(1);
    if focus>0||pref.as_ref().is_none_or(|p|!p.auto_perch||!p.enabled||!p.desktop_enabled||p.display_mode!="normal"||p.reduced_motion||crate::companion::quiet_at(p,&chrono::Local::now())){release(&app,true);continue}
    if chrono::Utc::now().timestamp_millis()>=a.until{depart(&app,a).await;}
   }continue}
   let now=chrono::Utc::now().timestamp_millis();if app.state::<DesktopRuntime>().automatic.clock.lock().ok().is_none_or(|c|now<c.next_at){continue}
   let Some(p)=permitted(&app,false).await else{continue};
   if let Some(spot)=discover(&app,&p).await{visit(&app,spot,p).await}else{if let Ok(mut clock)=app.state::<DesktopRuntime>().automatic.clock.lock(){clock.retry_later(now);}}
  }
 });
 #[cfg(not(windows))]let _=app;
}
