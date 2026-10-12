use std::sync::{Arc,Mutex,atomic::{AtomicBool,AtomicU64,AtomicI64,Ordering}};
use std::time::Duration;
use tauri::{AppHandle,Manager,Emitter,Listener,WebviewUrl,WebviewWindow,WebviewWindowBuilder,menu::{Menu,MenuItem}};
use sqlx::SqlitePool;
use chrono::{Local,Utc};
use crate::companion::{self,PetNotice,PetPreferences,PetReminder};

#[derive(Default)]
pub struct PetRuntime {
 pub notice:Mutex<Option<PetNotice>>,pub serial:AtomicU64,pub moving:AtomicBool,pub hovering:AtomicBool,pub performing:AtomicBool,pub wandering:AtomicBool,
 pub presentation:Mutex<String>,
 pub hit_mask:Mutex<Option<HitMask>>,pub dock:Mutex<crate::companion_dock::Controller>,pub placement:Mutex<()>,
 pub hit_region_pending:AtomicBool,pub hit_region_revision:AtomicU64,
 pub last_speech:AtomicI64,pub last_contact:AtomicI64,pub help_shown:AtomicBool,
 pub generation:AtomicU64,pub window_lock:Mutex<()>,pub panel_tab:Mutex<String>,pub dismissed:AtomicBool,
 pub morphing:AtomicBool,pub morph_serial:AtomicU64,pub morph_ready:AtomicU64,pub morph:Mutex<Option<PetMorph>>,
 pub mode_lock:tokio::sync::Mutex<()>,
 pub chat_serial:AtomicU64,
}
pub const PET_VIEWPORT_RATIO:f64=1.5;
#[derive(Clone,serde::Serialize)]
#[serde(rename_all="camelCase")]
pub struct PetMorph {id:u64,from:String,to:String,size:u32,started_at:i64,duration_ms:u64,stage:String}
fn cancel_morph(app:&AppHandle){
 let rt=app.state::<Arc<PetRuntime>>();rt.morph_serial.fetch_add(1,Ordering::SeqCst);
 rt.morphing.store(false,Ordering::SeqCst);
 if let Ok(mut stored)=rt.morph.lock(){if let Some(mut cue)=stored.take(){cue.stage="cancel".into();let _=app.emit_to("companion","companion-morph",cue);}};
}
/// Invalidate every outstanding native cue before presenting another companion.
pub(crate) fn reset_character(app:&AppHandle)->Result<(),String>{
 let rt=app.state::<Arc<PetRuntime>>();rt.generation.fetch_add(1,Ordering::SeqCst);
 cancel_morph(app);crate::companion_toy::dismiss_toy(app.clone());crate::companion_desktop::release_drag(app);
 dismiss_companion_panel(app.clone());dismiss_companion_notice(app.clone());crate::companion_chat_window::dismiss_companion_input(app.clone());
 rt.hovering.store(false,Ordering::SeqCst);rt.performing.store(false,Ordering::SeqCst);
 rt.help_shown.store(false,Ordering::SeqCst);rt.last_speech.store(0,Ordering::SeqCst);
 *rt.hit_mask.lock().map_err(|_|"伙伴轮廓暂不可用")?=None;
 let _guard=rt.placement.lock().map_err(|_|"伙伴位置暂不可用")?;
 crate::companion_dock::reset_locked(app)?;
 refresh_hit_region(app)?;
 Ok(())
}
#[tauri::command]
pub fn get_companion_morph(app:AppHandle)->Option<PetMorph>{
 let rt=app.state::<Arc<PetRuntime>>();
 if !rt.morphing.load(Ordering::SeqCst){return None}
 let snapshot=rt.morph.lock().ok()?.clone();snapshot
}
#[tauri::command]
pub fn companion_morph_ready(app:AppHandle,id:u64){let rt=app.state::<Arc<PetRuntime>>();if rt.morph_serial.load(Ordering::SeqCst)==id{rt.morph_ready.store(id,Ordering::SeqCst);}}
pub(crate) fn window(app:&AppHandle,label:&str,size:f64)->Result<WebviewWindow,String>{
 let runtime=app.state::<Arc<PetRuntime>>();let _guard=runtime.window_lock.lock().map_err(|_|"伙伴窗口暂不可用")?;
 if let Some(win)=app.get_webview_window(label){return Ok(win)}
 let url=match label{"companion-notice"=>"pet.html?notice=1","companion-panel"=>"pet.html?panel=1","companion-input"=>"pet.html?input=1","companion-toy"=>"pet.html?toy=1",_=>"pet.html"};
 let builder=WebviewWindowBuilder::new(app,label,WebviewUrl::App(url.into()))
 .title("Xmission · 伙伴").inner_size(match label{"companion-notice"=>360.0,"companion-panel"=>352.0,_=>size},match label{"companion-notice"=>188.0,"companion-panel"=>528.0,_=>size})
 .decorations(false).transparent(label!="companion-panel").shadow(false).resizable(false).maximizable(false).minimizable(false)
 .skip_taskbar(true).always_on_top(true).focused(false).visible(false);
 let builder=if label=="companion-panel"{builder.background_color(tauri::window::Color(244,232,207,255))}else{builder.background_color(tauri::window::Color(0,0,0,0))};
 let win=builder.build().map_err(|e|e.to_string())?;
 #[cfg(windows)] strip_frame(&win)?;

 // Native close (including Alt+F4) has the same meaning as the pet's own close control.
 let owner=app.clone();let label=label.to_owned();let handle=win.clone();
 win.on_window_event(move|event|{
 if let tauri::WindowEvent::CloseRequested{api,..}=event{
 api.prevent_close();let _=handle.hide();
 if label=="companion"{
 cancel_morph(&owner);
 owner.state::<Arc<PetRuntime>>().dismissed.store(true,Ordering::SeqCst);
 crate::companion_dock::dismiss_state(&owner);
 owner.state::<Arc<PetRuntime>>().hovering.store(false,Ordering::SeqCst);
 let _=crate::startup::sync_task_entry(&owner);
 dismiss_companion_panel(owner.clone());dismiss_companion_notice(owner.clone());
 crate::companion_toy::dismiss_toy(owner.clone());crate::companion_chat_window::dismiss_companion_input(owner.clone());
 crate::companion_desktop::release_drag(&owner);
 let owner=owner.clone();tauri::async_runtime::spawn(async move{
 let pool=owner.state::<SqlitePool>().inner().clone();
 let _=companion::update_preferences_db(&pool,serde_json::json!({"enabled":false,"desktopEnabled":false})).await;
 let _=owner.emit("companion-changed",());
 });
 }else if label=="companion-toy"{crate::companion_toy::dismiss_toy(owner.clone());}else if label=="companion-input"{crate::companion_chat_window::dismiss_companion_input(owner.clone());}}});

 Ok(win)
}
#[cfg(windows)]
fn strip_frame(win:&WebviewWindow)->Result<(),String>{
 use std::ffi::c_void;
 #[link(name="user32")]unsafe extern "system"{
 fn GetWindowLongPtrW(h:*mut c_void,i:i32)->isize;
 fn SetWindowLongPtrW(h:*mut c_void,i:i32,v:isize)->isize;
 fn SetWindowPos(h:*mut c_void,a:*mut c_void,x:i32,y:i32,w:i32,z:i32,f:u32)->i32;
 }
 let h=win.hwnd().map_err(|e|e.to_string())?.0 as *mut c_void;
 // SAFETY: These styles apply only to this app's compact, non-resizable tool window.
 unsafe{
 let style=GetWindowLongPtrW(h,-16);
 SetWindowLongPtrW(h,-16,(style&!(0x00C00000|0x00040000|0x00020000|0x00010000))|0x80000000);
 let ex=GetWindowLongPtrW(h,-20);SetWindowLongPtrW(h,-20,(ex&!0x00040000)|0x00000080);
 SetWindowPos(h,std::ptr::null_mut(),0,0,0,0,0x0001|0x0002|0x0004|0x0010|0x0020);
 }Ok(())
}
pub(crate) fn bounds(win:&WebviewWindow)->Result<(i32,i32,i32,i32),String>{
 let monitor=win.current_monitor().map_err(|e|e.to_string())?.or(win.primary_monitor().map_err(|e|e.to_string())?).ok_or("未找到显示器")?;
 let area=monitor.work_area();
 Ok((area.position.x,area.position.y,area.position.x+area.size.width as i32,area.position.y+area.size.height as i32))
}
pub(crate) fn clamp_position(win:&WebviewWindow,x:i32,y:i32)->Result<(i32,i32),String>{
 let(l,t,r,b)=bounds(win)?;let s=win.outer_size().map_err(|e|e.to_string())?;
 let scale=win.scale_factor().map_err(|e|e.to_string())?;
 Ok(crate::pet_dock::clamp_pet(crate::pet_dock::Area{left:l,top:t,right:r,bottom:b},x,y,s.width as i32,s.height as i32,scale))
}
pub fn sync_desktop(app:&AppHandle,p:&PetPreferences)->Result<(),String>{
 if crate::onboarding::scene_active(app){return Ok(())}
 let rt=app.state::<Arc<PetRuntime>>();
 if rt.morphing.load(Ordering::SeqCst){
  if !p.enabled||!p.desktop_enabled||p.display_mode=="closed"||rt.dismissed.load(Ordering::SeqCst){cancel_morph(app);}else{return Ok(())}
 }
 if !p.enabled||!p.desktop_enabled||p.display_mode=="closed"||!p.wander||p.reduced_motion {rt.generation.fetch_add(1,Ordering::SeqCst);}
 let _guard=rt.placement.lock().map_err(|_|"伙伴位置暂不可用")?;
 if !p.enabled||!p.desktop_enabled||p.display_mode=="closed"||rt.dismissed.load(Ordering::SeqCst) {
  crate::companion_toy::dismiss_toy(app.clone());crate::companion_chat_window::dismiss_companion_input(app.clone());
  crate::companion_desktop::release_drag(app);
  rt.hovering.store(false,Ordering::SeqCst);rt.performing.store(false,Ordering::SeqCst);
  if let Some(win)=app.get_webview_window("companion"){
   crate::companion_dock::configure_locked(app,p,&win)?;win.hide().map_err(|e|e.to_string())?;
  }
  return crate::startup::sync_task_entry(app)
 }
 if rt.moving.load(Ordering::SeqCst){return Ok(())}
 let fresh=app.get_webview_window("companion").is_none();let win=window(app,"companion",p.size as f64)?;
 let view=if p.display_mode=="mini"{43.0}else{(p.size as f64*PET_VIEWPORT_RATIO).ceil()};
 let changed=rt.presentation.lock().map_err(|_|"伙伴模式暂不可用")?.as_str()!=p.display_mode;
 if changed{crate::companion_dock::reset_locked(app)?;clear_hit_region(&win);}
 *rt.presentation.lock().map_err(|_|"伙伴模式暂不可用")?=p.display_mode.clone();
 let scale=win.scale_factor().map_err(|e|e.to_string())?;let old=win.inner_size().map_err(|e|e.to_string())?;
 if (old.width as f64-view*scale).abs()>1.0||(old.height as f64-view*scale).abs()>1.0 {
  win.set_size(tauri::LogicalSize::new(view,view)).map_err(|e|e.to_string())?;
 }
 let(_,_,r,b)=bounds(&win)?;let size=win.outer_size().map_err(|e|e.to_string())?;
 if fresh{win.set_position(tauri::PhysicalPosition::new(r-size.width as i32-22,b-size.height as i32-12)).map_err(|e|e.to_string())?;}
 if crate::companion_dock::view(app).side.is_none(){
  let pos=win.outer_position().map_err(|e|e.to_string())?;let(x,y)=clamp_position(&win,pos.x,pos.y)?;
  win.set_position(tauri::PhysicalPosition::new(x,y)).map_err(|e|e.to_string())?;
 }
 crate::companion_dock::configure_locked(app,p,&win)?;
 win.show().map_err(|e|e.to_string())?;crate::startup::sync_task_entry(app)
}
async fn save_position(pool:&SqlitePool,x:i32,y:i32)->Result<(),String>{
 sqlx::query("INSERT INTO settings(key,value)VALUES('companion_position',?) ON CONFLICT(key)DO UPDATE SET value=excluded.value")
 .bind(serde_json::json!({"x":x,"y":y}).to_string()).execute(pool).await.map_err(|e|e.to_string())?;Ok(())
}
async fn settle_user_position(app:&AppHandle,pool:&SqlitePool,x:i32,y:i32)->Result<(),String>{
 let mut p=companion::preferences_db(pool).await?;
 let side=crate::companion_dock::user_placed(app,&p)?;
 if p.display_mode=="edge" {
  let patch=if let Some(side)=side{serde_json::json!({"edgeSide":if side==crate::pet_dock::Side::Left{"left"}else{"right"}})}else{serde_json::json!({"displayMode":"normal"})};
  p=companion::update_preferences_db(pool,patch).await?;let _=app.emit("companion-changed",());
 }
 let (x,y)=crate::companion_dock::anchor(app).unwrap_or((x,y));
 save_position(pool,x,y).await?;save_anchor(pool,x,y).await?;
 let _=sync_desktop(app,&p);Ok(())
}
#[tauri::command]
pub async fn save_companion_position(app:AppHandle,pool:tauri::State<'_,SqlitePool>,x:i32,y:i32,user_placed:Option<bool>)->Result<(),String>{
 if x.abs()>100000||y.abs()>100000{return Err("伙伴位置无效".into())}
 let rt=app.state::<Arc<PetRuntime>>();
 // Native docking frames are never user placements and must not overwrite the anchor.
 if rt.moving.load(Ordering::SeqCst)||crate::companion_dock::view(&app).side.is_some(){return Ok(())}
 if user_placed.unwrap_or(true)&&!rt.wandering.load(Ordering::SeqCst){settle_user_position(&app,pool.inner(),x,y).await}
 else{save_position(pool.inner(),x,y).await}
}
async fn wake_panel(app:&AppHandle,tab:&str)->Result<(),String>{
 let pool=app.state::<SqlitePool>().inner().clone();
 let p=companion::preferences_db(&pool).await?;
 app.state::<Arc<PetRuntime>>().dismissed.store(false,Ordering::SeqCst);
 let p=if !p.enabled||!p.desktop_enabled||p.display_mode=="closed"{companion::update_preferences_db(&pool,serde_json::json!({"enabled":true,"desktopEnabled":true,"displayMode":"normal"})).await?}else{p};
 let fresh=app.get_webview_window("companion").is_none();sync_desktop(app,&p)?;if fresh{restore_position(app,&pool).await;}
 let _=app.emit("companion-changed",());show_panel(app,tab).await
}
#[tauri::command]
pub async fn open_companion_home(app:AppHandle,tab:Option<String>)->Result<(),String>{
 if tab.as_deref()==Some("talk"){return crate::companion_chat_window::open_companion_input(app)}
 wake_panel(&app,tab.as_deref().unwrap_or("home")).await
}
#[tauri::command]
pub fn get_companion_notice(runtime:tauri::State<'_,Arc<PetRuntime>>)->Option<PetNotice>{
 runtime.notice.lock().ok()?.clone()
}
#[tauri::command]
pub fn dismiss_companion_notice(app:AppHandle){
 app.state::<Arc<PetRuntime>>().serial.fetch_add(1,Ordering::SeqCst);
 if let Ok(mut notice)=app.state::<Arc<PetRuntime>>().notice.lock(){*notice=None;}
 if let Some(win)=app.get_webview_window("companion-notice"){let _=win.hide();}
}
#[tauri::command]
pub fn expand_companion_note(app:AppHandle)->Result<(),String>{
 let rt=app.state::<Arc<PetRuntime>>();rt.serial.fetch_add(1,Ordering::SeqCst);
 let win=app.get_webview_window("companion-notice").ok_or("小纸条已经收起")?;
 let pos=win.outer_position().map_err(|e|e.to_string())?;
 let(l,t,r,b)=bounds(&win)?;let scale=win.scale_factor().map_err(|e|e.to_string())?;
 win.set_size(tauri::LogicalSize::new(360.0f64.min((r-l)as f64/scale),388.0f64.min((b-t)as f64/scale))).map_err(|e|e.to_string())?;
 let size=win.outer_size().map_err(|e|e.to_string())?;
 win.set_position(tauri::PhysicalPosition::new(pos.x.clamp(l,(r-size.width as i32).max(l)),pos.y.clamp(t,(b-size.height as i32).max(t)))).map_err(|e|e.to_string())?;
 win.set_focus().map_err(|e|e.to_string())
}
#[tauri::command]
pub async fn show_companion_menu(app:AppHandle)->Result<(),String>{
 crate::companion_dock::menu_open(&app);let _=crate::companion_dock::reveal_companion(app.clone()).await;
 let win=app.get_webview_window("companion").ok_or("伙伴窗口尚未打开")?;
 let tasks=MenuItem::with_id(&app,"pet-tasks","查看任务",true,None::<&str>).map_err(|e|e.to_string())?;
 let home=MenuItem::with_id(&app,"pet-home","打开宠物菜单",true,None::<&str>).map_err(|e|e.to_string())?;
 let travel=MenuItem::with_id(&app,"pet-travel","出去逛逛",true,None::<&str>).map_err(|e|e.to_string())?;
 let collection=MenuItem::with_id(&app,"pet-collection","旅行背包",true,None::<&str>).map_err(|e|e.to_string())?;
 let game=MenuItem::with_id(&app,"pet-game","玩翻牌小游戏",true,None::<&str>).map_err(|e|e.to_string())?;
 let paper=MenuItem::with_id(&app,"pet-paper","一起丢玩具",true,None::<&str>).map_err(|e|e.to_string())?;
 let talk=MenuItem::with_id(&app,"pet-talk","在这里说句话",true,None::<&str>).map_err(|e|e.to_string())?;
 let dress=MenuItem::with_id(&app,"pet-dress","换件衣装",true,None::<&str>).map_err(|e|e.to_string())?;
 let settings=MenuItem::with_id(&app,"pet-settings","陪伴设置",true,None::<&str>).map_err(|e|e.to_string())?;
 let normal=MenuItem::with_id(&app,"pet-normal","普通陪伴",true,None::<&str>).map_err(|e|e.to_string())?;
 let mini=MenuItem::with_id(&app,"pet-mini","简易任务入口（悬浮球）",true,None::<&str>).map_err(|e|e.to_string())?;
 let edge=MenuItem::with_id(&app,"pet-edge","收进屏幕边缘",true,None::<&str>).map_err(|e|e.to_string())?;
 let sit=MenuItem::with_id(&app,"pet-sit","安静坐一会儿",true,None::<&str>).map_err(|e|e.to_string())?;
 let mute=MenuItem::with_id(&app,"pet-mute","暂停提醒 1 小时",true,None::<&str>).map_err(|e|e.to_string())?;
 let hide=MenuItem::with_id(&app,"pet-hide","关闭伙伴",true,None::<&str>).map_err(|e|e.to_string())?;
 win.popup_menu(&Menu::with_items(&app,&[&tasks,&talk,&paper,&home,&travel,&collection,&game,&dress,&settings,&normal,&mini,&edge,&sit,&mute,&hide]).map_err(|e|e.to_string())?).map_err(|e|e.to_string())
}
pub fn menu_event(app:&AppHandle,id:&str){
 crate::companion_dock::menu_done(app);
 match id{
 "pet-summon"=>{let owner=app.clone();tauri::async_runtime::spawn(async move{let _=summon_companion(owner).await;});},
 "pet-tasks"=>{let _=open_companion_tasks(app.clone());},
 "pet-talk"|"pet-paper"=>{let owner=app.clone();let kind=if id=="pet-paper"{"paper"}else{"conversation"};tauri::async_runtime::spawn(async move{let pool=owner.state::<SqlitePool>();let _=show_companion_bubble(owner.clone(),pool,kind.into()).await;});},
 "pet-home"|"pet-travel"|"pet-game"|"pet-collection"|"pet-dress"|"pet-settings"=>{
 let app=app.clone();let tab=match id{"pet-travel"=>"travel","pet-game"=>"game","pet-collection"=>"collection","pet-dress"=>"dress","pet-settings"=>"settings",_=>"home"}.to_string();
 tauri::async_runtime::spawn(async move{let _=wake_panel(&app,&tab).await;});
 },
 "pet-normal"|"pet-mini"|"pet-edge"=>{let owner=app.clone();let mode=id.strip_prefix("pet-").unwrap_or("normal").to_owned();tauri::async_runtime::spawn(async move{let pool=owner.state::<SqlitePool>();let _=set_companion_mode(owner.clone(),pool,mode).await;});},
 "pet-sit"=>{let _=app.emit("companion-gesture",serde_json::json!({"action":"sit","duration":60000}));},
 "pet-mute"|"pet-hide"=>{
 if id=="pet-hide"{cancel_morph(app);app.state::<Arc<PetRuntime>>().dismissed.store(true,Ordering::SeqCst);crate::companion_dock::dismiss_state(app);app.state::<Arc<PetRuntime>>().hovering.store(false,Ordering::SeqCst);dismiss_companion_panel(app.clone());dismiss_companion_notice(app.clone());}
 let app=app.clone();let id=id.to_string();
 tauri::async_runtime::spawn(async move{
 let pool=app.state::<SqlitePool>().inner().clone();
 let patch=if id=="pet-hide"{serde_json::json!({"enabled":false,"desktopEnabled":false})}else{serde_json::json!({"mutedUntil":Utc::now().timestamp_millis()+3600000})};
 if let Ok(p)=companion::update_preferences_db(&pool,patch).await{let _=sync_desktop(&app,&p);let _=app.emit("companion-changed",());}
 });
 },_=>{}
 }
}
async fn restore_position(app:&AppHandle,pool:&SqlitePool){
 if let Some(win)=app.get_webview_window("companion"){
 let raw:Option<String>=sqlx::query_scalar("SELECT value FROM settings WHERE key='companion_position'").fetch_optional(pool).await.ok().flatten();
 if let Some(pos)=raw.and_then(|v|serde_json::from_str::<serde_json::Value>(&v).ok()){
 if let(Some(x),Some(y))=(pos["x"].as_i64(),pos["y"].as_i64()){
 let x=x.clamp(-100000,100000)as i32;let y=y.clamp(-100000,100000)as i32;
 if let Ok(size)=win.outer_size(){
 if let Ok(monitors)=app.available_monitors(){
 if let Some(m)=monitors.into_iter().find(|m|{let a=m.work_area();x+size.width as i32/2>=a.position.x&&x+size.width as i32/2<a.position.x+a.size.width as i32&&y+size.height as i32/2>=a.position.y&&y+size.height as i32/2<a.position.y+a.size.height as i32}){
 let a=m.work_area();let(x,y)=crate::pet_dock::clamp_pet(crate::pet_dock::Area{left:a.position.x,top:a.position.y,right:a.position.x+a.size.width as i32,bottom:a.position.y+a.size.height as i32},x,y,size.width as i32,size.height as i32,m.scale_factor());let _=win.set_position(tauri::PhysicalPosition::new(x,y));if let Ok(p)=companion::preferences_db(pool).await{let _=crate::companion_dock::user_placed(app,&p);let _=sync_desktop(app,&p);}return;
 }}}
 if let Ok((x,y))=clamp_position(&win,x,y){let _=win.set_position(tauri::PhysicalPosition::new(x,y));if let Ok(p)=companion::preferences_db(pool).await{let _=crate::companion_dock::user_placed(app,&p);let _=sync_desktop(app,&p);}}
 }}}
}
pub(crate) fn show_notice(app:&AppHandle,notice:PetNotice)->Result<(),String>{
 if crate::onboarding::scene_active(app){return Ok(())}
 if app.state::<Arc<PetRuntime>>().dismissed.load(Ordering::SeqCst){return Err("伙伴已收起".into())}
 let win=window(app,"companion-notice",360.0)?;
 let runtime=app.state::<Arc<PetRuntime>>().inner().clone();
 let serial=runtime.serial.fetch_add(1,Ordering::SeqCst)+1;
 runtime.last_speech.store(Utc::now().timestamp_millis(),Ordering::SeqCst);
 let height=if let Some(text)=&notice.message{
  let rows=(text.chars().count().div_ceil(17)).clamp(1,4);
  40.0+rows as f64*23.0+if notice.tab.is_some(){26.0}else{0.0}+if notice.title.is_some(){16.0}else{0.0}+if notice.reply.as_ref().is_some_and(|reply|reply.suggested_task.is_some()){20.0}else{0.0}
 }else{188.0};
 win.set_size(tauri::LogicalSize::new(if notice.message.is_some(){288.0}else{360.0},height)).map_err(|e|e.to_string())?;
 *runtime.notice.lock().map_err(|_|"伙伴提醒暂不可用")?=Some(notice.clone());
 let(l,t,r,b)=bounds(&win)?;let size=win.outer_size().map_err(|e|e.to_string())?;
 let mut x=r-size.width as i32-18;let mut y=b-size.height as i32-18;
 if let Some(pet)=app.get_webview_window("companion").filter(|w|w.is_visible().unwrap_or(false)){
 if let Ok(pos)=pet.outer_position(){let pet_size=pet.outer_size().map_err(|e|e.to_string())?;
 x=if pos.x-size.width as i32-8>=l{pos.x-size.width as i32-8}else{pos.x+pet_size.width as i32+8};
 x=x.clamp(l,(r-size.width as i32).max(l));y=(pos.y+pet_size.height as i32-size.height as i32).clamp(t,(b-size.height as i32).max(t));}
 }
 win.set_position(tauri::PhysicalPosition::new(x,y)).map_err(|e|e.to_string())?;
 let _=app.emit("companion-reminder",&notice);win.show().map_err(|e|e.to_string())?;
 if notice.reply.is_some(){return Ok(())}
 let app=app.clone();tauri::async_runtime::spawn(async move{
 tokio::time::sleep(Duration::from_secs(18)).await;
 if runtime.serial.load(Ordering::SeqCst)==serial{if let Ok(mut notice)=runtime.notice.lock(){*notice=None;}if let Some(w)=app.get_webview_window("companion-notice"){let _=w.hide();}}
 });Ok(())
}
pub fn start_service(app:AppHandle,pool:SqlitePool){
 start_hit_tracking(app.clone());crate::companion_dock::start(app.clone());
 start_completion_feedback(app.clone(),pool.clone());
 let motion=app.state::<Arc<PetRuntime>>().inner().clone();
 app.listen("pomodoro-changed",move|_|{if !motion.moving.load(Ordering::SeqCst){motion.generation.fetch_add(1,Ordering::SeqCst);}});
 app.on_menu_event(|app,event|menu_event(app,event.id.as_ref()));
 tauri::async_runtime::spawn(async move{
 if let Ok(p)=companion::preferences_db(&pool).await{let _=sync_desktop(&app,&p);restore_position(&app,&pool).await;}
 let mut ticks=tokio::time::interval(Duration::from_secs(30));
 loop{
 ticks.tick().await;
 let now=Local::now();let stamp=now.timestamp_millis();
 let Ok(p)=companion::preferences_db(&pool).await else{continue};
 let returned=companion::settle_trips(&pool,stamp).await.unwrap_or(false);
 let trip=sqlx::query_as::<_,companion::PetTrip>(&crate::companion::owned_sql("SELECT * FROM companion_trips WHERE {owner} AND state IN('away','returned') LIMIT 1")).fetch_optional(&pool).await.ok().flatten();
 let missing=app.get_webview_window("companion").is_none_or(|w|!w.is_visible().unwrap_or(false));
 if p.enabled&&p.desktop_enabled&&missing&&!app.state::<Arc<PetRuntime>>().dismissed.load(Ordering::SeqCst)&&!app.state::<Arc<PetRuntime>>().morphing.load(Ordering::SeqCst){
 let _=sync_desktop(&app,&p);restore_position(&app,&pool).await;
 }
 if returned {let _=app.emit("companion-changed",());} // Idle life scheduling presents the gift after focus/quiet; never interrupt the reader here.
 let _=sqlx::query("INSERT INTO settings(key,value)VALUES('reminder_heartbeat',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").bind(stamp.to_string()).execute(&pool).await;
 if p.reminders {if let Ok(items)=companion::today_items(&pool,now).await {let due=companion::catch_up_due_items(&items,stamp);if companion::queue_due_items(&pool,&due,stamp).await.is_ok(){let _=app.emit("reminders-changed",());}}}
 if !p.enabled||!p.desktop_enabled||p.display_mode=="closed"||app.state::<Arc<PetRuntime>>().dismissed.load(Ordering::SeqCst)||companion::quiet_at(&p,&now){continue}
 let occupied=app.state::<Arc<PetRuntime>>().morphing.load(Ordering::SeqCst)||app.state::<Arc<PetRuntime>>().moving.load(Ordering::SeqCst)||app.state::<Arc<PetRuntime>>().hovering.load(Ordering::SeqCst)||app.state::<Arc<PetRuntime>>().performing.load(Ordering::SeqCst)||["companion-panel","companion-notice"].into_iter().any(|label|app.get_webview_window(label).is_some_and(|w|w.is_visible().unwrap_or(false)));
 let focusing:i64=sqlx::query_scalar("SELECT COUNT(*) FROM pomodoro_sessions WHERE state='running'").fetch_one(&pool).await.unwrap_or(1);
 
 let Ok(items)=companion::today_items(&pool,now).await else{continue};
 let mut due=if p.reminders{companion::catch_up_due_items(&items,stamp)}else{Vec::new()};

 if let Some(t)=trip.filter(|t|t.state=="returned"&&p.reminders){
 due.insert(0,PetReminder{key:format!("trip-return:{}",t.id),id:t.id,kind:"trip".into(),title:format!("{}回来啦",p.name),detail:format!("带回了{}",t.item_name),when_at:stamp,importance:4});
 }
 if p.reminders{if companion::queue_due_items(&pool,&due,stamp).await.is_err(){continue}due=companion::queued_items(&pool,stamp).await.unwrap_or_default();}else{due.clear();}
 if occupied{continue}
 if focusing>0{
 if !p.important_during_focus{continue}
 due.retain(|i|i.kind=="course"||i.importance>=4);
 }
 if due.is_empty(){if focusing==0{offer_conversation(&app,&pool,&p,&items,stamp).await;}continue}
 // Build the receiver before marking delivery; initial UI reads the stored batch.
 if window(&app,"companion-notice",360.0).is_err(){continue}
 let due_keys=due.iter().map(|i|i.key.clone()).collect::<Vec<_>>();
 if let Ok(fresh)=companion::claim_reminders(&pool,due,stamp).await{
  let keys:Vec<_>=fresh.iter().map(|i|i.key.clone()).collect();
  if fresh.is_empty(){let _=companion::forget_queued(&pool,&due_keys).await;}
  else if show_notice(&app,PetNotice{items:fresh,created_at:stamp,message:None,title:None,tab:Some("tasks".into()),reply:None}).is_ok(){
   let _=companion::forget_queued(&pool,&keys).await;
  }else{
   for key in &keys{let _=sqlx::query("DELETE FROM companion_reminders WHERE event_key=? AND delivered_at=?").bind(key).bind(stamp).execute(&pool).await;}
  }
 }
 }
 });
}
#[derive(serde::Serialize)]
#[serde(rename_all="camelCase")]
pub struct PetMove{moved:bool,x:i32,y:i32,care:Option<String>}
#[cfg(windows)]
#[tauri::command]
pub async fn drag_companion(app:AppHandle,pool:tauri::State<'_,SqlitePool>,mode:Option<String>)->Result<PetMove,String>{
 use std::ffi::c_void;
 #[repr(C)]struct Point{x:i32,y:i32}
 #[repr(C)]struct Rect{left:i32,top:i32,right:i32,bottom:i32}
 #[repr(C)]struct MonitorInfo{size:u32,monitor:Rect,work:Rect,flags:u32}
 #[link(name="user32")]unsafe extern "system"{
 fn GetCursorPos(p:*mut Point)->i32;fn GetAsyncKeyState(k:i32)->i16;
 fn MonitorFromPoint(p:Point,flags:u32)->*mut c_void;
 fn GetMonitorInfoW(m:*mut c_void,i:*mut MonitorInfo)->i32;
 fn GetWindowRect(h:*mut c_void,r:*mut Rect)->i32;
 fn SetWindowPos(h:*mut c_void,a:*mut c_void,x:i32,y:i32,w:i32,z:i32,f:u32)->i32;
 }
 let mode=mode.unwrap_or_else(||"body".into());
 if !matches!(mode.as_str(),"body"|"stroke"|"brush"){return Err("鼠标互动方式无效".into())}
 let runtime=app.state::<Arc<PetRuntime>>().inner().clone();
 if runtime.dismissed.load(Ordering::SeqCst)||runtime.morphing.load(Ordering::SeqCst){return Err("伙伴正在收起或变身".into())}
 let win=app.get_webview_window("companion").ok_or("伙伴窗口尚未打开")?;
 if runtime.moving.swap(true,Ordering::SeqCst){return Err("伙伴正在移动，请稍后再拖动".into())}
 let _drag_guard=MoveGuard(runtime.clone());
 if let Err(e)=crate::companion_dock::begin_drag(&app){runtime.moving.store(false,Ordering::SeqCst);return Err(e)}
 let h=win.hwnd().map_err(|e|e.to_string())?.0 as usize;let pos=win.outer_position().map_err(|e|e.to_string())?;let size=win.outer_size().map_err(|e|e.to_string())?;
 let scale=win.scale_factor().map_err(|e|e.to_string())?;let logical_threshold=4.0*scale;
 let ticket=runtime.generation.fetch_add(1,Ordering::SeqCst)+1;
 runtime.last_contact.store(Utc::now().timestamp_millis(),Ordering::SeqCst);
 let runtime_copy=runtime.clone();let app_copy=app.clone();
 let result=tokio::task::spawn_blocking(move||{
 let mut start=Point{x:0,y:0};let mut moved=false;let(mut x,mut y)=(pos.x,pos.y);
 let(mut vx,mut vy,mut path,mut reversals)=(0,0,0.0,0);
 let mut reported=String::new();
 // SAFETY: Valid Win32 buffers and the HWND belong to this app's compact tool window.
 unsafe{
 if GetCursorPos(&mut start)==0{return Err("读取鼠标位置失败".to_string())}
 let(mut last_x,mut last_y)=(start.x,start.y);
 while GetAsyncKeyState(1)as u16&0x8000!=0{
 if runtime_copy.dismissed.load(Ordering::SeqCst)||runtime_copy.generation.load(Ordering::SeqCst)!=ticket{break}
 let mut cursor=Point{x:0,y:0};if GetCursorPos(&mut cursor)==0{break}
 let dx=cursor.x-start.x;let dy=cursor.y-start.y;
 let step_x=cursor.x-last_x;let step_y=cursor.y-last_y;
 let inside=cursor.x>=pos.x&&cursor.x<=pos.x+size.width as i32&&cursor.y>=pos.y&&cursor.y<=pos.y+size.height as i32;
 if (step_x as f64).hypot(step_y as f64)>=scale{
 if inside{if (vx as i64)*(step_x as i64)+(vy as i64)*(step_y as i64)<0{reversals+=1}path+=(step_x as f64).hypot(step_y as f64).min(size.width as f64*0.35);}
 vx=step_x;vy=step_y;last_x=cursor.x;last_y=cursor.y;
 }
 let displacement=(dx as f64).hypot(dy as f64);
 if mode=="body"&&displacement>logical_threshold||mode=="stroke"&&displacement>size.width as f64*0.40{moved=true}
 let kind=if moved{"drag"}else if mode!="body"&&path>size.width as f64*0.12{mode.as_str()}else{""};
 if !kind.is_empty()&&reported!=kind{reported=kind.to_owned();if kind=="drag"{crate::companion_desktop::release_drag(&app_copy);crate::companion_chat_window::dismiss_companion_input(app_copy.clone());}let _=app_copy.emit("companion-contact",serde_json::json!({"kind":kind}));}
 if moved{
 let m=MonitorFromPoint(Point{x:cursor.x,y:cursor.y},2);
 let mut info=MonitorInfo{size:std::mem::size_of::<MonitorInfo>()as u32,monitor:Rect{left:0,top:0,right:0,bottom:0},work:Rect{left:0,top:0,right:0,bottom:0},flags:0};
 let(mut next_x,mut next_y)=(pos.x+dx,pos.y+dy);
 let mut rect=Rect{left:0,top:0,right:size.width as i32,bottom:size.height as i32};
 GetWindowRect(h as *mut c_void,&mut rect);
 let(w,hgt)=((rect.right-rect.left).max(1),(rect.bottom-rect.top).max(1));
 if GetMonitorInfoW(m,&mut info)!=0{(next_x,next_y)=crate::pet_dock::clamp_pet(crate::pet_dock::Area{left:info.work.left,top:info.work.top,right:info.work.right,bottom:info.work.bottom},next_x,next_y,w,hgt,scale);}
 if next_x!=x||next_y!=y{SetWindowPos(h as *mut c_void,std::ptr::null_mut(),next_x,next_y,0,0,0x0001|0x0004|0x0010|0x0200);x=next_x;y=next_y;}
 }
 std::thread::sleep(Duration::from_millis(8));
 }}
 if runtime_copy.dismissed.load(Ordering::SeqCst)||runtime_copy.generation.load(Ordering::SeqCst)!=ticket{return Err("鼠标互动已结束".into())}
 let care=if !moved&&mode!="body"&&path>=size.width as f64*0.65&&reversals>=2&&!runtime_copy.dismissed.load(Ordering::SeqCst){Some(mode)}else{None};
 runtime_copy.moving.store(false,Ordering::SeqCst);Ok(PetMove{moved,x,y,care})
 }).await;
 runtime.moving.store(false,Ordering::SeqCst);
 let result=result.map_err(|e|e.to_string())??;
 if result.moved{settle_user_position(&app,pool.inner(),result.x,result.y).await?;}
 // Clicking the visible head unfolds it, without permanently changing desktop mode.
 else{if let Ok(p)=companion::preferences_db(pool.inner()).await{let _=crate::companion_dock::user_placed(&app,&p);}}
 Ok(result)
}
#[cfg(not(windows))]
#[tauri::command]
pub async fn drag_companion(app:AppHandle,pool:tauri::State<'_,SqlitePool>)->Result<PetMove,String>{
 let rt=app.state::<Arc<PetRuntime>>().inner().clone();
 if rt.dismissed.load(Ordering::SeqCst){return Err("伙伴已收起".into())}
 if rt.moving.swap(true,Ordering::SeqCst){return Err("伙伴正在移动".into())}
 let result=async{
  crate::companion_dock::begin_drag(&app)?;
  let win=app.get_webview_window("companion").ok_or("伙伴窗口尚未打开")?;
  let ticket=rt.generation.fetch_add(1,Ordering::SeqCst)+1;
  let origin=win.outer_position().map_err(|e|e.to_string())?;
  win.start_dragging().map_err(|e|e.to_string())?;
  let began=std::time::Instant::now();
  while crate::companion_dock::primary_button_down()&&began.elapsed()<Duration::from_secs(60){
   if rt.dismissed.load(Ordering::SeqCst)||rt.generation.load(Ordering::SeqCst)!=ticket{return Err("鼠标互动已结束".into())}
   tokio::time::sleep(Duration::from_millis(40)).await;
  }
  let pos=win.outer_position().map_err(|e|e.to_string())?;
  rt.moving.store(false,Ordering::SeqCst);
  if pos!=origin{crate::companion_desktop::release_drag(&app);}
  settle_user_position(&app,pool.inner(),pos.x,pos.y).await?;
  Ok(PetMove{moved:pos!=origin,x:pos.x,y:pos.y,care:None})
 }.await;
 rt.moving.store(false,Ordering::SeqCst);result
}
#[tauri::command]
pub async fn wander_companion(app:AppHandle,pool:tauri::State<'_,SqlitePool>,distance:i32,duration_ms:Option<u64>,manual:Option<bool>)->Result<PetMove,String>{
 if crate::companion_dock::view(&app).side.is_some(){return Err("先把伙伴拖离边缘，再一起走走".into())}
 let p=companion::preferences_db(pool.inner()).await?;
 let focusing:i64=sqlx::query_scalar("SELECT COUNT(*) FROM pomodoro_sessions WHERE state='running'").fetch_one(pool.inner()).await.unwrap_or(1);
 if !p.enabled||!p.desktop_enabled||p.display_mode!="normal"||(!manual.unwrap_or(false)&&!p.wander)||p.reduced_motion||focusing>0{return Err("现在安静陪伴".into())}
 if ["companion-panel","companion-input"].into_iter().any(|label|app.get_webview_window(label).is_some_and(|w|w.is_visible().unwrap_or(false))){return Err("正在和伙伴说话".into())}
 let duration=duration_ms.unwrap_or(1920).clamp(960,3840);
 let runtime=app.state::<Arc<PetRuntime>>().inner().clone();
 if runtime.moving.load(Ordering::SeqCst)||runtime.hovering.load(Ordering::SeqCst){return Err("伙伴正在被拖动".into())}
 let ticket=runtime.generation.fetch_add(1,Ordering::SeqCst)+1;
 let win=app.get_webview_window("companion").ok_or("伙伴窗口尚未打开")?;
 let start=win.outer_position().map_err(|e|e.to_string())?;
 let(x,y)=clamp_position(&win,start.x+distance.clamp(-(win.outer_size().map_err(|e|e.to_string())?.width.min(4096)as i32),win.outer_size().map_err(|e|e.to_string())?.width.min(4096)as i32),start.y)?;
 if x==start.x{return Err("这边没有走动空间".into())}
 if runtime.wandering.compare_exchange(false,true,Ordering::SeqCst,Ordering::SeqCst).is_err(){return Err("伙伴已经在走动了".into())}
 let _walking=WanderGuard(runtime.clone());
 let mut moved=false;let began=std::time::Instant::now();
 loop{
 if runtime.generation.load(Ordering::SeqCst)!=ticket||!win.is_visible().unwrap_or(false){break}
 let elapsed=(began.elapsed().as_millis() as u64).min(duration);
 let next=start.x+((x-start.x)as i64*elapsed as i64/duration as i64)as i32;win.set_position(tauri::PhysicalPosition::new(next,y)).map_err(|e|e.to_string())?;
 moved=true;if elapsed==duration{break}tokio::time::sleep(Duration::from_millis(16)).await;
 }
 let pos=win.outer_position().map_err(|e|e.to_string())?;if moved&&!runtime.moving.load(Ordering::SeqCst){save_position(pool.inner(),pos.x,pos.y).await?}Ok(PetMove{moved,x:pos.x,y:pos.y,care:None})
}

pub fn show_travel_entry(app:AppHandle,pool:SqlitePool){
 tauri::async_runtime::spawn(async move{
 tokio::time::sleep(Duration::from_millis(4800)).await;
 let away:i64=sqlx::query_scalar(&crate::companion::owned_sql("SELECT COUNT(*) FROM companion_trips WHERE {owner} AND state='away'")).fetch_one(&pool).await.unwrap_or(0);
 if away>0{app.state::<Arc<PetRuntime>>().generation.fetch_add(1,Ordering::SeqCst);let _=app.emit("companion-changed",());}
 });
}


async fn show_panel(app:&AppHandle,tab:&str)->Result<(),String>{
 if matches!(tab,"today"|"chapter")&&!crate::features::GOAL_EXPERIENCE{return Err("该入口已暂停开放".into())}
 let _=crate::companion_dock::reveal_companion(app.clone()).await;
 let valid=["home","talk","travel","collection","game","dress","settings","memories","today","chapter"];
 if !valid.contains(&tab){return Err("宠物菜单无效".into())}
 let runtime=app.state::<Arc<PetRuntime>>();runtime.generation.fetch_add(1,Ordering::SeqCst);
 *runtime.panel_tab.lock().map_err(|_|"宠物菜单暂不可用")?=tab.to_owned();
 let win=window(app,"companion-panel",352.0)?;
 let monitor=app.get_webview_window("companion").and_then(|w|w.current_monitor().ok().flatten()).or(win.primary_monitor().map_err(|e|e.to_string())?).ok_or("未找到显示器")?;
 let area=monitor.work_area();let scale=monitor.scale_factor();
 let width=376.0f64.min(area.size.width as f64/scale);let height=552.0f64.min(area.size.height as f64/scale);
 win.set_size(tauri::LogicalSize::new(width,height)).map_err(|e|e.to_string())?;
 let size=win.outer_size().map_err(|e|e.to_string())?;
 let(l,t,r,b)=(area.position.x,area.position.y,area.position.x+area.size.width as i32,area.position.y+area.size.height as i32);
 let mut x=r-size.width as i32-16;let mut y=b-size.height as i32-16;
 if let Some(pet)=app.get_webview_window("companion"){
 if let(Ok(pos),Ok(pet_size))=(pet.outer_position(),pet.outer_size()){
 x=if pos.x-size.width as i32-8>=l{pos.x-size.width as i32-8}else{pos.x+pet_size.width as i32+8};
 y=pos.y+pet_size.height as i32-size.height as i32;
 }}
 win.set_position(tauri::PhysicalPosition::new(x.clamp(l,(r-size.width as i32).max(l)),y.clamp(t,(b-size.height as i32).max(t)))).map_err(|e|e.to_string())?;
 let _=app.emit("companion-panel",serde_json::json!({"tab":tab}));win.show().map_err(|e|e.to_string())?;win.set_focus().map_err(|e|e.to_string())
}
#[tauri::command]
pub fn get_companion_panel_tab(app:AppHandle)->String{
 app.state::<Arc<PetRuntime>>().panel_tab.lock().ok().filter(|v|!v.is_empty()).map(|v|v.to_string()).unwrap_or("home".into())
}
#[tauri::command]
pub fn dismiss_companion_panel(app:AppHandle){
 if let Some(w)=app.get_webview_window("companion-panel"){let _=w.hide();}
}


#[derive(serde::Serialize)]
#[serde(rename_all="camelCase")]
pub struct WalkPlan{distance:i32,duration_ms:u64}
#[derive(serde::Serialize)]
#[serde(rename_all="camelCase")]
pub struct PetSurroundings{left_room:f64,right_room:f64,cursor_x:f64,cursor_y:f64,size:f64,blocked:bool}
#[tauri::command]
pub async fn get_companion_surroundings(app:AppHandle)->Result<PetSurroundings,String>{
 let win=app.get_webview_window("companion").ok_or("伙伴还没出来")?;
 let pos=win.outer_position().map_err(|e|e.to_string())?;let size=win.outer_size().map_err(|e|e.to_string())?;
 let cursor=win.cursor_position().map_err(|e|e.to_string())?;let scale=win.scale_factor().map_err(|e|e.to_string())?.max(0.1);
 let(l,_,r,_)=bounds(&win)?;let rt=app.state::<Arc<PetRuntime>>();
 let blocked=crate::companion_desktop::attached(&app)||crate::companion_toy::active(&app)||rt.morphing.load(Ordering::SeqCst)||!win.is_visible().unwrap_or(false)||rt.dismissed.load(Ordering::SeqCst)||rt.moving.load(Ordering::SeqCst)||rt.wandering.load(Ordering::SeqCst)||rt.hovering.load(Ordering::SeqCst)||rt.performing.load(Ordering::SeqCst)||crate::companion_dock::view(&app).side.is_some()
  ||["companion-panel","companion-notice","companion-input"].into_iter().any(|label|app.get_webview_window(label).is_some_and(|w|w.is_visible().unwrap_or(false)));
 let nominal=size.width as f64/scale/PET_VIEWPORT_RATIO;let pad=(size.width as f64/scale-nominal)/2.0;
 Ok(PetSurroundings{left_room:(pos.x-l).max(0)as f64/scale,right_room:(r-pos.x-size.width as i32).max(0)as f64/scale,cursor_x:(cursor.x-pos.x as f64)/scale-pad,cursor_y:(cursor.y-pos.y as f64)/scale-pad,size:nominal,blocked})
}
#[tauri::command]
pub async fn prepare_companion_walk(app:AppHandle,pool:tauri::State<'_,SqlitePool>,prefer_right:bool,manual:Option<bool>)->Result<WalkPlan,String>{
 if crate::companion_desktop::attached(&app){return Err("坐在窗沿时先安静陪你；拖离窗口就能继续散步".into())}
 if crate::companion_toy::active(&app)&&!manual.unwrap_or(false){return Err("等着接住你的玩具，暂时不自己散步".into())}
 if app.get_webview_window("companion-input").is_some_and(|w|w.is_visible().unwrap_or(false)){return Err("正在听你说话，先不走开".into())}
 if app.state::<Arc<PetRuntime>>().morphing.load(Ordering::SeqCst){return Err("等伙伴变身完成再走走".into())}
 if crate::companion_dock::view(&app).side.is_some(){return Err("先把伙伴拖离边缘，再一起走走".into())}
 if app.state::<Arc<PetRuntime>>().moving.load(Ordering::SeqCst)||app.state::<Arc<PetRuntime>>().hovering.load(Ordering::SeqCst){return Err("正在鼠标互动，先安静陪你".into())}
 let p=companion::preferences_db(pool.inner()).await?;
 if !p.enabled||!p.desktop_enabled||p.display_mode!="normal"||p.reduced_motion||(!manual.unwrap_or(false)&&(!p.wander||companion::quiet_at(&p,&Local::now()))){return Err("现在安静陪伴".into())}
 let focus:i64=sqlx::query_scalar("SELECT COUNT(*) FROM pomodoro_sessions WHERE state='running'").fetch_one(pool.inner()).await.unwrap_or(1);if focus>0{return Err("正在专注，先安静陪你".into())}
 let win=app.get_webview_window("companion").ok_or("伙伴还没出来")?;
 let(l,_,r,_)=bounds(&win)?;let pos=win.outer_position().map_err(|e|e.to_string())?;let size=win.outer_size().map_err(|e|e.to_string())?;
 let desired=(p.size as f64*win.scale_factor().map_err(|e|e.to_string())?*0.64).round()as i32;
 let raw:Option<String>=sqlx::query_scalar("SELECT value FROM settings WHERE key='companion_anchor'").fetch_optional(pool.inner()).await.map_err(|e|e.to_string())?;
 let anchor=raw.and_then(|v|serde_json::from_str::<serde_json::Value>(&v).ok()).and_then(|v|v["x"].as_i64()).unwrap_or(pos.x as i64)as i32;
 let range=(p.wander_range as f64*win.scale_factor().map_err(|e|e.to_string())?)as i32;
 let margin=crate::pet_dock::movement_margin(size.width as i32,win.scale_factor().map_err(|e|e.to_string())?);
 let left=(l-margin).max(anchor-range);let right=(r-size.width as i32+margin).min(anchor+range);
 let (left_room,right_room)=((pos.x-left).max(0),(right-pos.x).max(0));
 let prefer_right=if manual.unwrap_or(false){prefer_right}else{let sample=uuid::Uuid::new_v4().as_bytes()[0]as f64/256.0;sample<companion::walk_right_chance(left_room,right_room)};
 let(distance,duration_ms)=companion::plan_walk(left_room,right_room,desired,prefer_right).ok_or("这里空间小，先坐一会儿")?;
 Ok(WalkPlan{distance,duration_ms})
}
#[tauri::command]
pub fn stop_companion_motion(app:AppHandle){let r=app.state::<Arc<PetRuntime>>();if !r.moving.load(Ordering::SeqCst)&&!r.wandering.load(Ordering::SeqCst)&&!crate::companion_desktop::attached(&app){r.generation.fetch_add(1,Ordering::SeqCst);}}


#[tauri::command]
pub fn companion_hovering(app:AppHandle,active:bool){
 let r=app.state::<Arc<PetRuntime>>();
 r.hovering.store(active,Ordering::SeqCst);
 if active{r.last_contact.store(Utc::now().timestamp_millis(),Ordering::SeqCst);if !r.moving.load(Ordering::SeqCst)&&!crate::companion_desktop::attached(&app){r.generation.fetch_add(1,Ordering::SeqCst);}}
}
#[tauri::command]
pub fn companion_double_click_ms()->u32{
 #[cfg(windows)]{#[link(name="user32")]unsafe extern "system"{fn GetDoubleClickTime()->u32;}unsafe{GetDoubleClickTime().clamp(100,1500)}}
 #[cfg(not(windows))]{480}
}
#[tauri::command]
pub fn open_companion_tasks(app:AppHandle)->Result<(),String>{
 if app.get_webview_window("widget").is_none(){return Err("任务悬浮窗尚未准备好".into())}
 app.emit("widget:show",()).map_err(|e|e.to_string())
}
fn speech(app:&AppHandle,title:&str,message:String,tab:Option<&str>)->Result<(),String>{
 show_notice(app,PetNotice{items:Vec::new(),created_at:Utc::now().timestamp_millis(),message:Some(message),title:Some(title.to_owned()),tab:tab.map(str::to_owned),reply:None})
}
#[tauri::command]
pub async fn show_companion_bubble(app:AppHandle,pool:tauri::State<'_,SqlitePool>,kind:String)->Result<(),String>{
 // Care is expressed by the fox's animation, not an interrupting speech card.
 if matches!(kind.as_str(),"stroke"|"brush"){return Ok(())}
 let p=companion::preferences_db(pool.inner()).await?;
 if !p.enabled||!p.desktop_enabled||p.display_mode=="closed"||app.state::<Arc<PetRuntime>>().dismissed.load(Ordering::SeqCst){return Ok(())}
 if kind=="touch-help"&&app.state::<Arc<PetRuntime>>().help_shown.swap(true,Ordering::SeqCst){return Ok(())}
 if kind=="paper"{return crate::companion_toy::start_toy(app,pool).await}
 if kind=="conversation"{return crate::companion_chat_window::open_companion_input(app)}
 let text=match kind.as_str(){
 "reminder-test"=>"这是一条测试提醒。任务与课程到时会在这里轻声提醒；收起伙伴后也能在主窗口查看待看记录。",
 "stroke"=>"轻轻摸过头顶，耳朵都放松下来啦。",
 "brush"=>"尾巴又蓬松起来了，谢谢你慢慢梳好。",
 "tool-stroke"=>"鼠标停在头顶就能摸摸，也可以轻轻来回扫过；按住专门拖动。",
 "tool-brush"=>"沿背部或尾巴轻轻滑动，就能顺毛，无需选工具；按住拖动。",
 "touch-help"=>"轻扫头部是摸头，沿身体滑动是顺毛；按住只用于拖动，双击查看任务。",
 _=>return Err("不支持这张小纸条".into())
 };
 speech(&app,&p.name,text.into(),None)
}
async fn offer_conversation(app:&AppHandle,pool:&SqlitePool,p:&PetPreferences,items:&[PetReminder],now:i64){
 if !p.proactive||!p.desktop_enabled{return}
 let runtime=app.state::<Arc<PetRuntime>>();
 if now-runtime.last_speech.load(Ordering::SeqCst)<20*60000||now-runtime.last_contact.load(Ordering::SeqCst)<15000{return}
 let play_offer:Option<String>=sqlx::query_scalar("SELECT value FROM settings WHERE key='companion_play_offer_day'").fetch_optional(pool).await.ok().flatten();
 let day=Local::now().date_naive().to_string();
 if play_offer.as_deref()!=Some(&day){
  if let Ok(growth)=crate::companion_life::growth(pool).await{if growth.care_days>0{
   if speech(app,&p.name,if growth.paper_skill{"还记得我们的小玩具吗？有空再丢出去一次吧。"}else{"我发现一个小玩具。要一起试着接住吗？"}.into(),Some("paper")).is_ok(){let _=sqlx::query("INSERT INTO settings(key,value)VALUES('companion_play_offer_day',?) ON CONFLICT(key)DO UPDATE SET value=excluded.value").bind(day).execute(pool).await;}
   return;
  }}
 }
 if !crate::features::PREPARATION_AUTOMATION {
  let candidate=items.iter().filter(|i|i.kind=="task"&&i.importance>=3).max_by_key(|i|i.importance);
  let text=if let Some(item)=candidate{format!("如果现在有空，可以先把「{}」推进一小步。要翻开今天的安排吗？",item.title.chars().take(28).collect::<String>())}
  else{match (now/60000)%3{0=>"我在这里陪你。盯屏幕久了，可以看看远处，活动一下肩膀。".into(),1=>"不妨留一点空隙，喝口水，再慢慢继续。".into(),_=>"今天也可以留下一件小小的完成。不赶路，我们按你的节奏来。".into()}};
  let _=speech(app,&p.name,text,Some(if candidate.is_some(){"tasks"}else{"talk"}));return;
 }
 let cooldown:Option<String>=sqlx::query_scalar("SELECT value FROM settings WHERE key='preparation_help_cooldown'").fetch_optional(pool).await.ok().flatten();
 if cooldown.and_then(|c|c.parse::<i64>().ok()).is_some_and(|c|c>now){return;}
 let prepared:Vec<String>=sqlx::query_scalar("SELECT task_id FROM preparation_rules").fetch_all(pool).await.unwrap_or_default();
 let candidate=items.iter().filter(|i|i.kind=="task"&&i.importance>=3&&!prepared.contains(&i.id)).max_by_key(|i|i.importance);
 let Some(item)=candidate else{return;};
 let text=format!("「{}」要不要提前准备资料？",item.title.chars().take(28).collect::<String>());
 if speech(app,&p.name,text,Some(&format!("preparation:{}",item.id))).is_ok(){
  // Being shown is sufficient to start cooldown; ignored/dismissed offers do
  // not reappear after restarting the app.
  let _=sqlx::query("INSERT INTO settings(key,value)VALUES('preparation_help_cooldown',?) ON CONFLICT(key)DO UPDATE SET value=excluded.value")
   .bind((now+7*86400000).to_string()).execute(pool).await;
  let _=app.emit("settings-changed",serde_json::json!({"key":"preparation_help_cooldown","value":(now+7*86400000).to_string()}));
 }
}
fn start_completion_feedback(app:AppHandle,pool:SqlitePool){
 let runtime=app.state::<Arc<PetRuntime>>().inner().clone();
 runtime.last_speech.store(Utc::now().timestamp_millis()-20*60000+60000,Ordering::SeqCst);
 tauri::async_runtime::spawn(async move{
 let mut ticks=tokio::time::interval(Duration::from_secs(2));let mut last_feedback=0i64;
 loop{
 ticks.tick().await;let now=Local::now();let stamp=now.timestamp_millis();
 if runtime.moving.load(Ordering::SeqCst)||runtime.hovering.load(Ordering::SeqCst)||runtime.performing.load(Ordering::SeqCst)||runtime.dismissed.load(Ordering::SeqCst)||stamp-last_feedback<12000{continue}
 let Ok(p)=companion::preferences_db(&pool).await else{continue};
 if !p.proactive||!p.enabled||!p.desktop_enabled||p.display_mode=="closed"||companion::quiet_at(&p,&now)||stamp-runtime.last_contact.load(Ordering::SeqCst)<5000{continue}
 if ["companion-panel","companion-notice"].into_iter().any(|label|app.get_webview_window(label).is_some_and(|w|w.is_visible().unwrap_or(false))){continue}
 let focus:i64=sqlx::query_scalar("SELECT COUNT(*) FROM pomodoro_sessions WHERE state='running'").fetch_one(&pool).await.unwrap_or(1);if focus>0{continue}
 let Ok(items)=crate::companion_feedback::pending(&pool,stamp).await else{continue};if items.is_empty(){continue}
 if stamp-items.last().map(|i|i.created_at).unwrap_or(stamp)<3000{continue}
 let(text,kind)=crate::companion_feedback::message(&items);
 if speech(&app,&p.name,text,Some("tasks")).is_ok(){
 if crate::companion_feedback::delivered(&pool,&items,stamp).await.is_ok(){
 let _=app.emit("companion-feedback",serde_json::json!({"batchId":format!("{}-{}",items[0].id,items.last().unwrap().id),"kind":kind,"count":items.len()}));
 last_feedback=stamp;
 }}
 }
 });
}

#[tauri::command]
pub fn companion_activity(app:AppHandle,active:bool){
 app.state::<Arc<PetRuntime>>().performing.store(active,Ordering::SeqCst);
}
#[tauri::command]
pub async fn set_companion_mode(app:AppHandle,pool:tauri::State<'_,SqlitePool>,mode:String)->Result<(),String>{
 if !matches!(mode.as_str(),"normal"|"mini"|"edge"|"closed"){return Err("桌面模式无效".into())}
 if mode!="normal"{crate::companion_desktop::release_drag(&app);}
 let rt=app.state::<Arc<PetRuntime>>().inner().clone();
 if mode=="closed"{cancel_morph(&app);}
 // Ignore repeated transition requests; closing always cancels the outstanding cue.
 let _mode_guard=if mode=="closed"{rt.mode_lock.lock().await}else{let Ok(guard)=rt.mode_lock.try_lock()else{return Ok(())};guard};
 let before=companion::preferences_db(pool.inner()).await?;
 let pet_visible=app.get_webview_window("companion").is_some_and(|w|w.is_visible().unwrap_or(false));
 let ball=app.get_webview_window("bubble").filter(|w|w.is_visible().unwrap_or(false));
 let from=if pet_visible&&before.display_mode!="mini"{"normal"}else{"mini"};
 let animate=(mode=="mini"&&from=="normal")||(mode=="normal"&&from=="mini"&&(pet_visible||ball.is_some()));
 if !animate{return apply_companion_mode(&app,pool.inner(),&mode,None).await}
 rt.morphing.store(true,Ordering::SeqCst);rt.generation.fetch_add(1,Ordering::SeqCst);
 rt.hovering.store(false,Ordering::SeqCst);rt.performing.store(false,Ordering::SeqCst);
 let id=rt.morph_serial.fetch_add(1,Ordering::SeqCst)+1;
 rt.morph_ready.store(0,Ordering::SeqCst);rt.dismissed.store(false,Ordering::SeqCst);
 let result:Result<(),String>=async{
  let view=(before.size as f64*PET_VIEWPORT_RATIO).ceil();let win=window(&app,"companion",view)?;
  let origin=if pet_visible{win.clone()}else{ball.clone().unwrap_or_else(||win.clone())};
  let pos=origin.outer_position().map_err(|e|e.to_string())?;let size=origin.outer_size().map_err(|e|e.to_string())?;
  let centre=(pos.x+size.width as i32/2,pos.y+size.height as i32/2);
  {
   let _placement=rt.placement.lock().map_err(|_|"伙伴位置暂不可用")?;
   crate::companion_dock::reset_locked(&app)?;
   win.hide().map_err(|e|e.to_string())?;
   win.set_size(tauri::LogicalSize::new(view,view)).map_err(|e|e.to_string())?;
   let s=win.outer_size().map_err(|e|e.to_string())?;
   let(x,y)=clamp_position(&win,centre.0-s.width as i32/2,centre.1-s.height as i32/2)?;
   win.set_position(tauri::PhysicalPosition::new(x,y)).map_err(|e|e.to_string())?;
  }
  let mut cue=PetMorph{id,from:from.into(),to:mode.clone(),size:before.size as u32,started_at:Utc::now().timestamp_millis()+60000,duration_ms:if before.reduced_motion{160}else if mode=="mini"{1800}else{2450},stage:"start".into()};
  *rt.morph.lock().map_err(|_|"伙伴变身暂不可用")?=Some(cue.clone());
  let _=app.emit_to("companion","companion-morph",cue.clone());
  // The renderer acknowledges its decoded full-size fox, including newly created WebViews.
  for _ in 0..160{
   if rt.morph_serial.load(Ordering::SeqCst)!=id{return Ok(())}
   if rt.morph_ready.load(Ordering::SeqCst)==id{break}
   tokio::time::sleep(Duration::from_millis(25)).await;
  }
  if rt.morph_serial.load(Ordering::SeqCst)!=id{return Ok(())}
  if rt.morph_ready.load(Ordering::SeqCst)!=id{return Err("变身素材尚未准备好，请稍后再试".into())}
  cue.started_at=Utc::now().timestamp_millis()+60;
  *rt.morph.lock().map_err(|_|"伙伴变身暂不可用")?=Some(cue.clone());
  let _=app.emit_to("companion","companion-morph",cue.clone());
  win.show().map_err(|e|e.to_string())?;
  if let Some(ball)=ball{let _=ball.hide();}
  crate::startup::sync_task_entry(&app)?;
  for _ in 0..((cue.duration_ms+100)/25+1){
   tokio::time::sleep(Duration::from_millis(25)).await;
   if rt.morph_serial.load(Ordering::SeqCst)!=id||rt.dismissed.load(Ordering::SeqCst){return Ok(())}
  }
  rt.morphing.store(false,Ordering::SeqCst);
  apply_companion_mode(&app,pool.inner(),&mode,Some(id)).await?;
  if rt.morph_serial.load(Ordering::SeqCst)==id&&!rt.dismissed.load(Ordering::SeqCst){
   cue.stage="finish".into();*rt.morph.lock().map_err(|_|"伙伴变身暂不可用")?=Some(cue.clone());
   let _=app.emit_to("companion","companion-morph",cue);
  }
  Ok(())
 }.await;
 if rt.morph_serial.load(Ordering::SeqCst)==id{
  rt.morphing.store(false,Ordering::SeqCst);
  if result.is_err(){cancel_morph(&app);let p=companion::preferences_db(pool.inner()).await?;let _=sync_desktop(&app,&p);}
 }
 result
}
async fn apply_companion_mode(app:&AppHandle,pool:&SqlitePool,mode:&str,expected:Option<u64>)->Result<(),String>{
 let mut patch=serde_json::json!({"displayMode":mode,"desktopEnabled":mode!="closed","enabled":true});
 let runtime=app.state::<Arc<PetRuntime>>();
 if mode=="edge" {
  if let Some(w)=app.get_webview_window("companion") {
   if let Ok(pos)=w.outer_position(){let(l,_,r,_)=bounds(&w)?;patch["edgeSide"]=serde_json::json!(if pos.x+w.outer_size().map_err(|e|e.to_string())?.width as i32/2<(l+r)/2{"left"}else{"right"});}
  }
 }
 let centre=app.get_webview_window("companion").and_then(|w|Some((w.outer_position().ok()?,w.outer_size().ok()?))).map(|(p,s)|(p.x+s.width as i32/2,p.y+s.height as i32/2));
 if expected.is_some_and(|id|runtime.morph_serial.load(Ordering::SeqCst)!=id){return Ok(())}
 let p=companion::update_preferences_db(pool,patch).await?;
 if expected.is_some_and(|id|runtime.morph_serial.load(Ordering::SeqCst)!=id){
  if runtime.dismissed.load(Ordering::SeqCst){let _=companion::update_preferences_db(pool,serde_json::json!({"enabled":false,"desktopEnabled":false})).await;}
  return Ok(())
 }
 runtime.dismissed.store(mode=="closed",Ordering::SeqCst);runtime.generation.fetch_add(1,Ordering::SeqCst);
 runtime.hovering.store(false,Ordering::SeqCst);runtime.performing.store(false,Ordering::SeqCst);
 {
  let _guard=runtime.placement.lock().map_err(|_|"伙伴位置暂不可用")?;
  crate::companion_dock::reset_locked(&app)?;
 }
 sync_desktop(&app,&p)?;
 if mode=="normal"||mode=="mini"{if let(Some((cx,cy)),Some(w))=(centre,app.get_webview_window("companion")){
  let _placement=runtime.placement.lock().map_err(|_|"伙伴位置暂不可用")?;
  let s=w.outer_size().map_err(|e|e.to_string())?;let(x,y)=clamp_position(&w,cx-s.width as i32/2,cy-s.height as i32/2)?;
  w.set_position(tauri::PhysicalPosition::new(x,y)).map_err(|e|e.to_string())?;
 }}
 if mode=="closed"{dismiss_companion_panel(app.clone());dismiss_companion_notice(app.clone());}
 if let Some(w)=app.get_webview_window("companion") {
  let pos=crate::companion_dock::anchor(&app).or_else(||w.outer_position().ok().map(|p|(p.x,p.y)));
  if let Some((x,y))=pos{save_position(pool,x,y).await?;save_anchor(pool,x,y).await?;}
 }
 let _=app.emit("companion-changed",());Ok(())
}
async fn save_anchor(pool:&SqlitePool,x:i32,y:i32)->Result<(),String>{
 sqlx::query("INSERT INTO settings(key,value)VALUES('companion_anchor',?) ON CONFLICT(key)DO UPDATE SET value=excluded.value")
 .bind(serde_json::json!({"x":x,"y":y}).to_string()).execute(pool).await.map_err(|e|e.to_string())?;Ok(())
}
#[tauri::command]
pub async fn set_companion_hit_mask(app:AppHandle,width:u32,height:u32,spans:Vec<[u32;3]>)->Result<(),String>{
 if width==0||height==0||width>512||height>512||spans.len()>2048||spans.iter().any(|r|r[0]>=height||r[1]>=width||r[2]==0||r[2]>width-r[1]){return Err("伙伴轮廓无效".into())}
 let runtime=app.state::<Arc<PetRuntime>>();
 *runtime.hit_mask.lock().map_err(|_|"伙伴轮廓暂不可用")?=Some(HitMask{width,height,spans});
 refresh_hit_region(&app)
}
pub(super) fn refresh_hit_region(app:&AppHandle)->Result<(),String>{
 let runtime=app.state::<Arc<PetRuntime>>();
 runtime.hit_region_revision.fetch_add(1,Ordering::SeqCst);
 queue_hit_region(app)
}
fn queue_hit_region(app:&AppHandle)->Result<(),String>{
 let runtime=app.state::<Arc<PetRuntime>>().inner().clone();
 if runtime.hit_region_pending.swap(true,Ordering::SeqCst){return Ok(())}
 let owner=app.clone();let queued=runtime.clone();
 let result=app.run_on_main_thread(move||{
  let revision=queued.hit_region_revision.load(Ordering::SeqCst);
  // No geometry mutex is acquired on the UI thread. SetWindowRgn can synchronously
  // send window messages; applying it from a worker while UI IPC waits on placement
  // deadlocks the entire application.
  if let Err(error)=apply_hit_region(&owner){eprintln!("伙伴轮廓更新失败：{error}");}
  queued.hit_region_pending.store(false,Ordering::SeqCst);
  if queued.hit_region_revision.load(Ordering::SeqCst)!=revision{let _=queue_hit_region(&owner);}
 });
 if result.is_err(){runtime.hit_region_pending.store(false,Ordering::SeqCst);}
 result.map_err(|e|e.to_string())
}
fn apply_hit_region(app:&AppHandle)->Result<(),String>{
 let Some(win)=app.get_webview_window("companion")else{return Ok(())};
 let runtime=app.state::<Arc<PetRuntime>>();
 let mask=runtime.hit_mask.lock().map_err(|_|"伙伴轮廓暂不可用")?.clone();
 #[cfg(windows)]{
 use std::ffi::c_void;
 #[link(name="user32")]unsafe extern "system"{fn SetWindowRgn(h:*mut c_void,r:*mut c_void,redraw:i32)->i32;}
 #[link(name="gdi32")]unsafe extern "system"{
 fn ExtCreateRegion(transform:*const c_void,bytes:u32,data:*const c_void)->*mut c_void;
 fn CreateRectRgn(left:i32,top:i32,right:i32,bottom:i32)->*mut c_void;
 fn DeleteObject(o:*mut c_void)->i32;
 }
 let size=win.inner_size().map_err(|e|e.to_string())?;
 let h=win.hwnd().map_err(|e|e.to_string())?.0 as *mut c_void;
 let Some(mask)=mask else{unsafe{SetWindowRgn(h,std::ptr::null_mut(),1);}return Ok(())};
 let rects=crate::pet_hit_region::rectangles(size.width,size.height,mask.width,mask.height,&mask.spans);
 let position=win.outer_position().map_err(|e|e.to_string())?;let(l,t,r,b)=bounds(&win)?;
 let rects:Vec<[i32;4]>=rects.into_iter().filter_map(|v|{let v=[v[0].max(l-position.x),v[1].max(t-position.y),v[2].min(r-position.x),v[3].min(b-position.y)];(v[0]<v[2]&&v[1]<v[3]).then_some(v)}).collect();
 // RGNDATAHEADER followed by sorted, non-overlapping RECT bands. One GDI operation
 // replaces hundreds of temporary regions per animation frame; ownership transfers
 // only after SetWindowRgn succeeds.
 let empty=rects.is_empty();let mut data=vec![32u32,1,rects.len()as u32,(rects.len()*16)as u32,0,0,0,0];
 if !rects.is_empty(){
  data[4]=rects.iter().map(|r|r[0]).min().unwrap()as u32;
  data[5]=rects.iter().map(|r|r[1]).min().unwrap()as u32;
  data[6]=rects.iter().map(|r|r[2]).max().unwrap()as u32;
  data[7]=rects.iter().map(|r|r[3]).max().unwrap()as u32;
 }
 for r in rects{data.extend(r.map(|v|v as u32));}
 unsafe{
  let region=if empty{CreateRectRgn(0,0,0,0)}else{ExtCreateRegion(std::ptr::null(),(data.len()*4)as u32,data.as_ptr()as *const c_void)};
  if region.is_null(){return Err("伙伴轮廓创建失败".into())}
  if SetWindowRgn(h,region,1)==0{DeleteObject(region);return Err("伙伴轮廓设置失败".into())}
 }
 }
 #[cfg(not(windows))]{let _=(win,mask);}
 Ok(())
}
#[derive(Clone)]
pub struct HitMask{width:u32,height:u32,spans:Vec<[u32;3]>}
fn start_hit_tracking(app:AppHandle){
 #[cfg(not(windows))]
 tauri::async_runtime::spawn(async move{
 let mut ticks=tokio::time::interval(Duration::from_millis(80));let mut ignored=false;let mut last_mode=String::new();
 loop{ticks.tick().await;let rt=app.state::<Arc<PetRuntime>>();
 let Some(w)=app.get_webview_window("companion").filter(|w|w.is_visible().unwrap_or(false))else{continue};
 if rt.moving.load(Ordering::SeqCst)||rt.hovering.load(Ordering::SeqCst){continue}
 let mode=rt.presentation.lock().ok().map(|v|v.clone()).unwrap_or_default();
 if mode!=last_mode{ignored=false;let _=w.set_ignore_cursor_events(false);last_mode=mode.clone();}
 let inside={
 let mask=rt.hit_mask.lock().ok().and_then(|v|v.clone());
 match(mask,w.cursor_position(),w.outer_position(),w.inner_size()){
 (Some(m),Ok(c),Ok(p),Ok(s))if s.width>0&&s.height>0=>{
 // The canvas mask already includes its side-specific slide and viewport crop.
 let x=(c.x-p.x as f64)*m.width as f64/s.width as f64;let y=(c.y-p.y as f64)*m.height as f64/s.height as f64;
 x>=0.0&&y>=0.0&&x<m.width as f64&&y<m.height as f64&&m.spans.iter().any(|r|r[0]==y as u32&&x>=r[1]as f64&&x<(r[1]+r[2])as f64)
 },_=>true}};
 if ignored==inside{ignored=!inside;let _=w.set_ignore_cursor_events(ignored);}
 }
 });
 #[cfg(windows)]let _=app;
}
fn clear_hit_region(win:&WebviewWindow){
 #[cfg(windows)]{
 use std::ffi::c_void;
 #[link(name="user32")]unsafe extern "system"{fn SetWindowRgn(h:*mut c_void,r:*mut c_void,d:i32)->i32;}
 if let Ok(h)=win.hwnd(){unsafe{SetWindowRgn(h.0 as *mut c_void,std::ptr::null_mut(),1);}}
 }
 let _=win.set_ignore_cursor_events(false);
}

struct WanderGuard(Arc<PetRuntime>);
impl Drop for WanderGuard{fn drop(&mut self){self.0.wandering.store(false,Ordering::SeqCst);}}

struct MoveGuard(Arc<PetRuntime>);
impl Drop for MoveGuard{fn drop(&mut self){self.0.moving.store(false,Ordering::SeqCst);}}

#[tauri::command]
pub async fn summon_companion(app:AppHandle)->Result<(),String>{
 let pool=app.state::<SqlitePool>().inner().clone();
 let p=companion::update_preferences_db(&pool,serde_json::json!({"enabled":true,"desktopEnabled":true,"displayMode":"normal"})).await?;
 let runtime=app.state::<Arc<PetRuntime>>();
 runtime.dismissed.store(false,Ordering::SeqCst);runtime.generation.fetch_add(1,Ordering::SeqCst);
 {let _guard=runtime.placement.lock().map_err(|_|"伙伴位置暂不可用")?;crate::companion_dock::reset_locked(&app)?;}
 sync_desktop(&app,&p)?;restore_position(&app,&pool).await;
 let _=app.emit("companion-changed",());let _=app.emit_to("companion","companion-gesture",serde_json::json!({"action":"respond","duration":1400}));
 Ok(())
}
