//! One small desktop object, one existing actor; no full-screen input-catching layer.
use std::{sync::{Arc,Mutex,atomic::{AtomicBool,AtomicU64,AtomicI64,Ordering}},time::{Duration,Instant}};
use tauri::{AppHandle,Manager,Emitter,State};
use sqlx::SqlitePool;
use crate::companion_window::{self,PetRuntime};
#[derive(Clone)]struct Game{id:String,count:i64}
#[derive(Default)]pub struct ToyRuntime{game:Mutex<Option<Game>>,busy:AtomicBool,serial:AtomicU64,ready:AtomicU64,last_used:AtomicI64}
struct Busy<'a>(&'a AtomicBool);impl Drop for Busy<'_>{fn drop(&mut self){self.0.store(false,Ordering::SeqCst);}}
pub fn active(app:&AppHandle)->bool{app.state::<ToyRuntime>().game.lock().ok().is_some_and(|v|v.is_some())}
pub fn start(app:AppHandle){tauri::async_runtime::spawn(async move{let mut timer=tokio::time::interval(Duration::from_secs(1));loop{timer.tick().await;if !active(&app){continue}let rt=app.state::<Arc<PetRuntime>>();let toy=app.state::<ToyRuntime>();let mode=rt.presentation.lock().ok().map(|v|v.clone()).unwrap_or_default();if rt.dismissed.load(Ordering::SeqCst)||mode!="normal"||chrono::Utc::now().timestamp_millis()-toy.last_used.load(Ordering::SeqCst)>10*60000{dismiss_toy(app.clone());}}});}
#[tauri::command]pub fn toy_ready(app:AppHandle,id:u64){app.state::<ToyRuntime>().ready.store(id,Ordering::SeqCst);}
#[tauri::command]pub fn dismiss_toy(app:AppHandle){
 let s=app.state::<ToyRuntime>();s.serial.fetch_add(1,Ordering::SeqCst);if let Ok(mut g)=s.game.lock(){*g=None;}
 if let Some(w)=app.get_webview_window("companion-toy"){let _=w.hide();}
 let _=app.emit("companion-fetch",serde_json::json!({"phase":"end"}));
}
#[tauri::command]pub async fn start_toy(app:AppHandle,pool:State<'_,SqlitePool>)->Result<(),String>{
 let p=crate::companion::preferences_db(pool.inner()).await?;
 if !p.enabled||!p.desktop_enabled||p.display_mode!="normal"{return Err("先让伙伴以普通桌面模式出来".into())}
 let s=app.state::<ToyRuntime>();if s.busy.load(Ordering::SeqCst){return Err("等它把玩具接住，再丢下一次".into())}
 let id=uuid::Uuid::new_v4().to_string();crate::companion_life::begin_play(pool.inner(),&id,chrono::Utc::now().timestamp_millis()).await?;
 crate::companion_desktop::release_companion_window(app.clone());
 let pet=app.get_webview_window("companion").filter(|w|w.is_visible().unwrap_or(false)).ok_or("伙伴还没出来")?;
 {let rt=app.state::<Arc<PetRuntime>>();let _guard=rt.placement.lock().map_err(|_|"伙伴位置暂不可用")?;crate::companion_dock::reset_locked(&app)?;}
 let toy_size=(p.size as f64*0.38).ceil()+8.0;let toy=companion_window::window(&app,"companion-toy",toy_size)?;toy.set_size(tauri::LogicalSize::new(toy_size,toy_size)).map_err(|e|e.to_string())?;
 let pos=pet.outer_position().map_err(|e|e.to_string())?;let size=pet.outer_size().map_err(|e|e.to_string())?;let scale=pet.scale_factor().map_err(|e|e.to_string())?;
 let(l,t,r,b)=companion_window::bounds(&pet)?;let ts=toy.outer_size().map_err(|e|e.to_string())?;
 let x=(pos.x+size.width as i32-ts.width as i32/2).clamp(l,(r-ts.width as i32).max(l));let y=(pos.y+size.height as i32-ts.height as i32-(8.0*scale)as i32).clamp(t,(b-ts.height as i32).max(t));
 toy.set_position(tauri::PhysicalPosition::new(x,y)).map_err(|e|e.to_string())?;
 *s.game.lock().map_err(|_|"玩具暂不可用")?=Some(Game{id,count:0});s.serial.fetch_add(1,Ordering::SeqCst);
 s.last_used.store(chrono::Utc::now().timestamp_millis(),Ordering::SeqCst);
 round_region(&toy);let _=app.emit_to("companion-toy","companion-toy-open",());toy.show().map_err(|e|e.to_string())
}
#[cfg(windows)]fn round_region(w:&tauri::WebviewWindow){
 use std::ffi::c_void;
 #[link(name="gdi32")]unsafe extern "system"{fn CreateEllipticRgn(l:i32,t:i32,r:i32,b:i32)->*mut c_void;fn DeleteObject(r:*mut c_void)->i32;}
 #[link(name="user32")]unsafe extern "system"{fn SetWindowRgn(h:*mut c_void,r:*mut c_void,redraw:i32)->i32;}
 if let(Ok(h),Ok(size))=(w.hwnd(),w.outer_size()){unsafe{let region=CreateEllipticRgn(2,2,size.width as i32-2,size.height as i32-2);if !region.is_null()&&SetWindowRgn(h.0 as _,region,1)==0{DeleteObject(region);}}}
}
#[cfg(not(windows))]fn round_region(_w:&tauri::WebviewWindow){}

#[tauri::command]pub async fn drag_toy(app:AppHandle,pool:State<'_,SqlitePool>)->Result<(),String>{
 if !active(&app){return Err("先把玩具拿出来".into())}
 let s=app.state::<ToyRuntime>();if s.busy.swap(true,Ordering::SeqCst){return Err("玩具正在被接住".into())}
 s.last_used.store(chrono::Utc::now().timestamp_millis(),Ordering::SeqCst);
 let lock=Busy(&s.busy);let issued=s.serial.load(Ordering::SeqCst);
 let w=app.get_webview_window("companion-toy").ok_or("玩具还没出现")?;
 #[cfg(windows)]{
  let h=w.hwnd().map_err(|e|e.to_string())?.0 as usize;
  tokio::task::spawn_blocking(move||unsafe{
   use std::ffi::c_void;#[repr(C)]struct Point{x:i32,y:i32}#[repr(C)]struct Rect{l:i32,t:i32,r:i32,b:i32}
   #[link(name="user32")]unsafe extern "system"{fn GetCursorPos(p:*mut Point)->i32;fn GetAsyncKeyState(k:i32)->i16;fn GetWindowRect(h:*mut c_void,r:*mut Rect)->i32;fn SetWindowPos(h:*mut c_void,a:*mut c_void,x:i32,y:i32,w:i32,z:i32,f:u32)->i32;}
   let mut origin=Rect{l:0,t:0,r:0,b:0};let mut start=Point{x:0,y:0};if GetCursorPos(&mut start)==0||GetWindowRect(h as _,&mut origin)==0{return}
   let began=Instant::now();while GetAsyncKeyState(1)as u16&0x8000!=0&&began.elapsed()<Duration::from_secs(60){let mut p=Point{x:0,y:0};if GetCursorPos(&mut p)==0{break}SetWindowPos(h as _,std::ptr::null_mut(),origin.l+p.x-start.x,origin.t+p.y-start.y,0,0,0x0001|0x0004|0x0010|0x0200);std::thread::sleep(Duration::from_millis(8));}
  }).await.map_err(|e|e.to_string())?;
 }
 #[cfg(not(windows))]{w.start_dragging().map_err(|e|e.to_string())?;while crate::companion_dock::primary_button_down(){tokio::time::sleep(Duration::from_millis(20)).await;}}
 drop(lock);if s.serial.load(Ordering::SeqCst)!=issued{return Ok(())}
 let pos=w.outer_position().map_err(|e|e.to_string())?;let size=w.outer_size().map_err(|e|e.to_string())?;let(l,t,r,b)=companion_window::bounds(&w)?;w.set_position(tauri::PhysicalPosition::new(pos.x.clamp(l,(r-size.width as i32).max(l)),pos.y.clamp(t,(b-size.height as i32).max(t)))).map_err(|e|e.to_string())?;
 fetch_toy(app.clone(),pool).await
}
#[tauri::command]pub async fn fetch_toy(app:AppHandle,pool:State<'_,SqlitePool>)->Result<(),String>{
 let s=app.state::<ToyRuntime>();if s.busy.swap(true,Ordering::SeqCst){return Err("等它接住这一个玩具".into())}let _busy=Busy(&s.busy);
 s.last_used.store(chrono::Utc::now().timestamp_millis(),Ordering::SeqCst);
 let mut game=s.game.lock().map_err(|_|"玩具暂不可用")?.clone().ok_or("先把玩具拿出来")?;
 let p=crate::companion::preferences_db(pool.inner()).await?;
 if !p.enabled||!p.desktop_enabled||p.display_mode!="normal"{dismiss_toy(app.clone());return Ok(())}
 let focus:i64=sqlx::query_scalar("SELECT COUNT(*) FROM pomodoro_sessions WHERE state='running'").fetch_one(pool.inner()).await.map_err(|e|e.to_string())?;
 if focus>0{return Err("专注时先放着玩具，结束后再一起玩".into())}
 if game.count>=3{game=Game{id:uuid::Uuid::new_v4().to_string(),count:0};crate::companion_life::begin_play(pool.inner(),&game.id,chrono::Utc::now().timestamp_millis()).await?;}
 let pet=app.get_webview_window("companion").ok_or("伙伴还没出来")?;let toy=app.get_webview_window("companion-toy").ok_or("玩具还没出现")?;
 let rt=app.state::<Arc<PetRuntime>>().inner().clone();if rt.moving.load(Ordering::SeqCst)||rt.morphing.load(Ordering::SeqCst){return Err("先等拖动或变身完成".into())}
 let serial=s.serial.fetch_add(1,Ordering::SeqCst)+1;s.ready.store(0,Ordering::SeqCst);let ticket=rt.generation.fetch_add(1,Ordering::SeqCst)+1;
 let start=pet.outer_position().map_err(|e|e.to_string())?;let tp=toy.outer_position().map_err(|e|e.to_string())?;let ts=toy.outer_size().map_err(|e|e.to_string())?;
 let scale=toy.scale_factor().map_err(|e|e.to_string())?;let(l,t,r,b)=companion_window::bounds(&toy)?;let viewport=(p.size as f64*1.5*scale).ceil()as i32;
 let(x,y)=crate::pet_dock::clamp_pet(crate::pet_dock::Area{left:l,top:t,right:r,bottom:b},tp.x+ts.width as i32/2-viewport/2,tp.y+ts.height as i32-viewport+(p.size as f64*0.08*scale)as i32,viewport,viewport,scale);
 let distance=((x-start.x)as f64).hypot((y-start.y)as f64);let stride_speed=if p.character=="red-panda"{75.0*p.size as f64/96.0}else{185.0};let duration=if p.reduced_motion{220}else{(distance/scale/stride_speed*1000.0).clamp(500.0,45000.0)as u64};
 if rt.wandering.swap(true,Ordering::SeqCst){return Err("它正在走动，稍等一下".into())}
 let outcome=async{
  let canceled=||rt.moving.load(Ordering::SeqCst)||rt.dismissed.load(Ordering::SeqCst)||rt.generation.load(Ordering::SeqCst)!=ticket||s.serial.load(Ordering::SeqCst)!=serial;
  let preparation=if p.reduced_motion{0}else{320};
  let _=app.emit_to("companion","companion-fetch",serde_json::json!({"phase":"prepare","id":serial,"direction":if x<start.x{"left"}else{"right"},"durationMs":preparation}));
  for _ in 0..100{if canceled(){return Ok(false)}if s.ready.load(Ordering::SeqCst)==serial{break}tokio::time::sleep(Duration::from_millis(20)).await;}
  if s.ready.load(Ordering::SeqCst)!=serial{return Err("追跑素材还没准备好，请稍后再试".into())}
  tokio::time::sleep(Duration::from_millis(preparation)).await;if canceled(){return Ok(false)}
  let _=app.emit_to("companion","companion-fetch",serde_json::json!({"phase":"run","id":serial,"durationMs":duration}));
  let began=Instant::now();loop{
   if canceled(){return Ok(false)}
   let t=(began.elapsed().as_millis()as f64/duration as f64).min(1.0);
   pet.set_position(tauri::PhysicalPosition::new(start.x+((x-start.x)as f64*t)as i32,start.y+((y-start.y)as f64*t)as i32)).map_err(|e|e.to_string())?;
   if t>=1.0{break}tokio::time::sleep(Duration::from_millis(16)).await;
  }
  if !p.reduced_motion{
   let _=app.emit_to("companion","companion-fetch",serde_json::json!({"phase":"brake","id":serial,"durationMs":240}));
   tokio::time::sleep(Duration::from_millis(240)).await;if canceled(){return Ok(false)}
  }
  let _=toy.hide();let _=app.emit_to("companion","companion-fetch",serde_json::json!({"phase":"catch","id":serial,"durationMs":1100}));
  tokio::time::sleep(Duration::from_millis(1000)).await;
  if s.serial.load(Ordering::SeqCst)!=serial||rt.moving.load(Ordering::SeqCst)||rt.generation.load(Ordering::SeqCst)!=ticket{return Ok(false)}
  crate::companion_life::catch_paper(pool.inner(),&game.id,game.count+1,chrono::Utc::now().timestamp_millis()).await?;game.count+=1;
  *s.game.lock().map_err(|_|"玩具暂不可用")?=Some(game.clone());let _=app.emit("companion-changed",());
  let pos=pet.outer_position().map_err(|e|e.to_string())?;let size=pet.outer_size().map_err(|e|e.to_string())?;let(l,t,r,b)=companion_window::bounds(&pet)?;
  toy.set_position(tauri::PhysicalPosition::new((pos.x+size.width as i32-ts.width as i32/2).clamp(l,(r-ts.width as i32).max(l)),(pos.y+size.height as i32-ts.height as i32).clamp(t,(b-ts.height as i32).max(t)))).map_err(|e|e.to_string())?;toy.show().map_err(|e|e.to_string())?;
  Ok(true)
 }.await;
 rt.wandering.store(false,Ordering::SeqCst);let _=app.emit_to("companion","companion-fetch",serde_json::json!({"phase":"end","id":serial}));
 if !rt.dismissed.load(Ordering::SeqCst)&&s.serial.load(Ordering::SeqCst)==serial{let _=toy.show();}
 outcome.map(|_|())
}
