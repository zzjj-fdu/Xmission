//! Native edge hiding. Keep the HWND inside its own monitor and slide its artwork.
//! The alpha region follows that offset, so adjacent monitors and DPI never move
//! an invisible part of the window onto another screen.
use std::sync::Arc;
use std::sync::atomic::Ordering;
use std::time::Duration;
use tauri::{AppHandle,Manager,Emitter,WebviewWindow};
use chrono::Utc;
use crate::{companion::PetPreferences,companion_window::{self,PetRuntime},pet_dock::{Area,Dock,Side,View}};
#[derive(Default)]
pub struct Controller { pub dock:Dock, active:bool, mode:String, pub menu_until:i64 }
pub fn view(app:&AppHandle)->View {
 app.state::<Arc<PetRuntime>>().dock.lock().map(|s|s.dock.view()).unwrap_or_default()
}
pub fn anchor(app:&AppHandle)->Option<(i32,i32)> {
 app.state::<Arc<PetRuntime>>().dock.lock().ok().and_then(|s|s.dock.armed().then(||s.dock.anchor()))
}
fn publish(app:&AppHandle,previous:View) {
 let state=view(app);if state!=previous{let _=app.emit_to("companion","companion-dock",state);}
}
fn area(win:&WebviewWindow,anchor:Option<(i32,i32)>)->Result<Area,String> {
 let size=win.outer_size().map_err(|e|e.to_string())?;
 let monitor=anchor.and_then(|(x,y)|win.app_handle().available_monitors().ok().and_then(|all|all.into_iter().find(|m|{
  let a=m.work_area();let cx=x+size.width as i32/2;let cy=y+size.height as i32/2;
  cx>=a.position.x&&cx<a.position.x+a.size.width as i32&&cy>=a.position.y&&cy<a.position.y+a.size.height as i32
 }))).or(win.current_monitor().map_err(|e|e.to_string())?).or(win.primary_monitor().map_err(|e|e.to_string())?).ok_or("未找到显示器")?;
 let a=monitor.work_area();Ok(Area{left:a.position.x,top:a.position.y,right:a.position.x+a.size.width as i32,bottom:a.position.y+a.size.height as i32})
}
fn place(app:&AppHandle,win:&WebviewWindow)->Result<(),String> {
 let position=app.state::<Arc<PetRuntime>>().dock.lock().ok().and_then(|s|s.dock.armed().then(||s.dock.anchor()));
 if let Some((x,y))=position{
  let current=win.outer_position().map_err(|e|e.to_string())?;
  if (current.x,current.y)!=(x,y){win.set_position(tauri::PhysicalPosition::new(x,y)).map_err(|e|e.to_string())?;}
 }
 companion_window::refresh_hit_region(app)
}
// The caller owns PetRuntime.placement; every native geometry change shares this lock.
pub fn configure_locked(app:&AppHandle,p:&PetPreferences,win:&WebviewWindow)->Result<(),String> {
 if crate::companion_desktop::attached(app){return Ok(())}
 let previous=view(app);let rt=app.state::<Arc<PetRuntime>>();let pos=win.outer_position().map_err(|e|e.to_string())?;
 let size=win.outer_size().map_err(|e|e.to_string())?;let scale=win.scale_factor().map_err(|e|e.to_string())?;
 let anchor=rt.dock.lock().ok().and_then(|s|s.dock.armed().then(||s.dock.anchor()));
 let a=area(win,anchor)?;
 let mut s=rt.dock.lock().map_err(|_|"伙伴收纳暂不可用")?;
 let active=p.enabled&&p.desktop_enabled&&p.display_mode!="closed"&&!rt.dismissed.load(Ordering::SeqCst);
 let changed=s.mode!=p.display_mode;let reactivated=!s.active;let mut restore=None;
 if !active||p.display_mode=="mini"||changed||(!p.auto_dock&&p.display_mode!="edge") {
  restore=s.dock.cancel().filter(|_|active);
 }
 s.active=active;s.mode=p.display_mode.clone();
 let preferred=if p.edge_side=="left"{Side::Left}else{Side::Right};
 if active&&p.display_mode=="edge"&&(!s.dock.armed()||s.dock.side!=Some(preferred)) {
  s.dock.arm(preferred,a,size.width as i32,size.height as i32,pos.y,scale,p.reduced_motion,Utc::now().timestamp_millis());
 }else if active&&reactivated&&p.auto_dock&&p.display_mode=="normal" {
  if let Some(side)=crate::pet_dock::nearest_side(a,pos.x,size.width as i32,scale){
   s.dock.arm(side,a,size.width as i32,size.height as i32,pos.y,scale,p.reduced_motion,Utc::now().timestamp_millis());
  }
 }else if s.dock.armed() {
  let y=s.dock.y;s.dock.resize(a,size.width as i32,size.height as i32,y,scale,p.reduced_motion);
 }
 drop(s);
 if let Some((x,y))=restore{win.set_position(tauri::PhysicalPosition::new(x,y)).map_err(|e|e.to_string())?;}
 place(app,win)?;publish(app,previous);Ok(())
}
pub fn reset_locked(app:&AppHandle)->Result<(),String> {
 let previous=view(app);let rt=app.state::<Arc<PetRuntime>>();
 let anchor=rt.dock.lock().map_err(|_|"伙伴收纳暂不可用")?.dock.cancel();
 if let(Some(win),Some((x,y)))=(app.get_webview_window("companion"),anchor){
  win.set_position(tauri::PhysicalPosition::new(x,y)).map_err(|e|e.to_string())?;
 }
 companion_window::refresh_hit_region(app)?;publish(app,previous);Ok(())
}
pub fn begin_drag(app:&AppHandle)->Result<(),String> {
 let rt=app.state::<Arc<PetRuntime>>();let _guard=rt.placement.lock().map_err(|_|"伙伴位置暂不可用")?;
 reset_locked(app)
}
pub fn user_placed(app:&AppHandle,p:&PetPreferences)->Result<Option<Side>,String> {
 let rt=app.state::<Arc<PetRuntime>>();let _guard=rt.placement.lock().map_err(|_|"伙伴位置暂不可用")?;
 let Some(win)=app.get_webview_window("companion")else{return Ok(None)};
 if rt.dismissed.load(Ordering::SeqCst)||!win.is_visible().unwrap_or(false){return Ok(None)}
 let previous=view(app);let pos=win.outer_position().map_err(|e|e.to_string())?;
 let size=win.outer_size().map_err(|e|e.to_string())?;let scale=win.scale_factor().map_err(|e|e.to_string())?;
 let a=area(&win,None)?;
 let side=if p.enabled&&p.desktop_enabled&&p.display_mode!="mini"&&p.display_mode!="closed"&&(p.auto_dock||p.display_mode=="edge"){
  crate::pet_dock::nearest_side(a,pos.x,size.width as i32,scale)
 }else{None};
 let mut s=rt.dock.lock().map_err(|_|"伙伴收纳暂不可用")?;
 // A user drag replaces the old anchor. A wandering pet never reaches this path.
 s.dock.cancel();
 if let Some(side)=side{s.dock.arm(side,a,size.width as i32,size.height as i32,pos.y,scale,p.reduced_motion,Utc::now().timestamp_millis());}
 drop(s);place(app,&win)?;publish(app,previous);Ok(side)
}
#[tauri::command]
pub fn get_companion_dock(app:AppHandle)->View { view(&app) }
#[tauri::command]
pub async fn reveal_companion(app:AppHandle)->Result<(),String> {
 let rt=app.state::<Arc<PetRuntime>>();
 if rt.dismissed.load(Ordering::SeqCst){return Ok(())}
 let previous=view(&app);
 rt.dock.lock().map_err(|_|"伙伴收纳暂不可用")?.dock.reveal(Utc::now().timestamp_millis(),false);
 publish(&app,previous);Ok(())
}
// Used by the native close callback: do not wait on a geometry lock from the UI thread.
pub fn dismiss_state(app:&AppHandle) {
 if let Ok(mut s)=app.state::<Arc<PetRuntime>>().dock.lock(){*s=Controller::default();}
}
pub fn menu_open(app:&AppHandle) {
 if let Ok(mut s)=app.state::<Arc<PetRuntime>>().dock.lock(){s.menu_until=Utc::now().timestamp_millis()+10000;}
}
pub fn menu_done(app:&AppHandle) {
 if let Ok(mut s)=app.state::<Arc<PetRuntime>>().dock.lock(){s.menu_until=0;s.dock.last_seen=Utc::now().timestamp_millis();}
}
pub fn start(app:AppHandle) {
 tauri::async_runtime::spawn(async move{
 let mut geometry_at=0;
 loop {
  let rt=app.state::<Arc<PetRuntime>>();
  let snapshot=view(&app);
  tokio::time::sleep(Duration::from_millis(if snapshot.transitioning{16}else if snapshot.side.is_none(){300}else{80})).await;
  if snapshot.side.is_none(){continue}
  if rt.morphing.load(Ordering::SeqCst)||rt.dismissed.load(Ordering::SeqCst)||rt.moving.load(Ordering::SeqCst)||rt.wandering.load(Ordering::SeqCst){continue}
  let Some(win)=app.get_webview_window("companion").filter(|w|w.is_visible().unwrap_or(false))else{continue};
  let (Ok(cursor),Ok(scale))=(win.cursor_position(),win.scale_factor())else{continue};
  let Ok(_guard)=rt.placement.lock()else{continue};
  // Check again inside the geometry lock so drag/close cannot be followed by a stale frame.
  if rt.morphing.load(Ordering::SeqCst)||rt.dismissed.load(Ordering::SeqCst)||rt.moving.load(Ordering::SeqCst)||rt.wandering.load(Ordering::SeqCst){continue}
  let previous=view(&app);
  // Queued gestures have no visible body while tucked and must not pull it out.
  let blocked=rt.hovering.load(Ordering::SeqCst)||(rt.performing.load(Ordering::SeqCst)&&!previous.folded)
   ||app.get_webview_window("companion-panel").is_some_and(|w|w.is_visible().unwrap_or(false))
   ||app.get_webview_window("companion-notice").is_some_and(|w|w.is_visible().unwrap_or(false))
   ||native_menu_active(&win);
  let now=Utc::now().timestamp_millis();
  if now-geometry_at>=2000 {
   geometry_at=now;
   if let (Some(anchor),Ok(size))=(anchor(&app),win.outer_size()){
    if let Ok(a)=area(&win,Some(anchor)){
     if let Ok(mut s)=rt.dock.lock(){
      let y=s.dock.y;let reduced=s.dock.reduced;
      s.dock.resize(a,size.width as i32,size.height as i32,y,scale,reduced);
     }
    }
   }
  }
  let Ok(mut s)=rt.dock.lock()else{continue};
  if !s.active||!s.dock.armed(){continue}
  let held=blocked||now<s.menu_until;
  s.dock.tick(now,(cursor.x,cursor.y),held,scale);drop(s);
  // Sliding changes artwork, not HWND geometry. The renderer posts its actual
  // silhouette, so the right edge cannot be clipped by an out-of-phase native mask.
  publish(&app,previous);
 }
 });
}
#[cfg(windows)]
fn native_menu_active(win:&WebviewWindow)->bool {
 use std::ffi::c_void;
 #[repr(C)]struct Rect { left:i32,top:i32,right:i32,bottom:i32 }
 #[repr(C)]struct GuiInfo { size:u32,flags:u32,active:*mut c_void,focus:*mut c_void,capture:*mut c_void,menu:*mut c_void,moving:*mut c_void,caret:*mut c_void,rect:Rect }
 #[link(name="user32")]unsafe extern "system" { fn GetWindowThreadProcessId(h:*mut c_void,p:*mut u32)->u32; fn GetGUIThreadInfo(id:u32,info:*mut GuiInfo)->i32; }
 let Ok(h)=win.hwnd()else{return false};
 // SAFETY: GUI information is read for this actor's own window thread.
 unsafe {
  let thread=GetWindowThreadProcessId(h.0 as *mut c_void,std::ptr::null_mut());
  let mut info:GuiInfo=std::mem::zeroed();info.size=std::mem::size_of::<GuiInfo>()as u32;
  thread!=0&&GetGUIThreadInfo(thread,&mut info)!=0&&info.flags&(0x4|0x10)!=0
 }
}
#[cfg(not(windows))]
fn native_menu_active(_win:&WebviewWindow)->bool { false }

#[cfg(target_os="macos")]
pub fn primary_button_down()->bool {
 #[link(name="CoreGraphics",kind="framework")]unsafe extern "C" { fn CGEventSourceButtonState(state:i32,button:u32)->bool; }
 // SAFETY: Reads the session's primary mouse button without taking event ownership.
 unsafe{CGEventSourceButtonState(1,0)}
}
#[cfg(all(not(windows),not(target_os="macos")))]
pub fn primary_button_down()->bool { false }
