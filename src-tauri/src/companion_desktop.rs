//! Local attachment and nearby exploration; no screenshots, UI content or audio sampling.
mod automatic;
use std::{sync::{Arc,Mutex,atomic::Ordering},time::Duration};
use tauri::{AppHandle,Emitter,Manager};
use serde::Serialize;
use crate::{companion_window::PetRuntime,pet_dock::Area};
#[derive(Clone)]struct Choice{id:String,title:String,handle:isize,pid:u32}
#[derive(Clone)]struct Attachment{choice:Choice,origin:(i32,i32),until:i64,mode:String,along:f64,automatic:Option<u64>,cutout:Option<[f64;4]>}
#[derive(Clone,Serialize)]pub struct AttachmentView{mode:Option<String>,cutout:Option<[f64;4]>}
#[derive(Default)]pub struct DesktopRuntime{choices:Mutex<Vec<Choice>>,attached:Mutex<Option<Attachment>>,automatic:automatic::Runtime}
#[derive(Serialize)]pub struct WindowChoice{id:String,title:String}
pub fn attached(app:&AppHandle)->bool{app.state::<DesktopRuntime>().attached.lock().ok().is_some_and(|v|v.is_some())}
fn attachment_view(app:&AppHandle)->AttachmentView{let a=app.state::<DesktopRuntime>().attached.lock().ok().and_then(|s|s.clone());AttachmentView{mode:a.as_ref().map(|a|a.mode.clone()),cutout:a.and_then(|a|a.cutout)}}
fn publish(app:&AppHandle,mode:Option<&str>){let _=app.emit("companion-perch",mode.is_some());let _=app.emit("companion-attachment",attachment_view(app));}
#[tauri::command]pub fn get_companion_attachment_mode(app:AppHandle)->AttachmentView{attachment_view(&app)}
#[tauri::command]pub fn companion_perch_ready(app:AppHandle,id:u64){automatic::ready(&app,id)}
#[tauri::command]pub fn get_companion_perch_motion(app:AppHandle)->Option<automatic::Cue>{automatic::snapshot(&app)}
pub fn release_drag(app:&AppHandle){release(app,false);}
fn release(app:&AppHandle,restore:bool){
 #[cfg(windows)]if restore{
  let current=app.state::<DesktopRuntime>().attached.lock().ok().and_then(|s|s.clone());
  if let Some(old)=current{let owner=app.clone();tauri::async_runtime::spawn(async move{automatic::depart(&owner,old).await;});return}
 }
 automatic::cancel(app);
 let old=app.state::<DesktopRuntime>().attached.lock().ok().and_then(|mut s|s.take());
  if let Some(old)=old{if restore{let rt=app.state::<Arc<PetRuntime>>();if let Ok(_guard)=rt.placement.try_lock(){if !rt.moving.load(Ordering::SeqCst){if let Some(w)=app.get_webview_window("companion"){let pos=restore_position(&w,old.origin);let _=w.set_position(tauri::PhysicalPosition::new(pos.0,pos.1));}}};}publish(app,None);}
}
fn restore_position(w:&tauri::WebviewWindow,origin:(i32,i32))->(i32,i32){
 if let(Ok(monitors),Ok(size))=(w.available_monitors(),w.outer_size()){if let Some(m)=monitors.into_iter().find(|m|{let a=m.work_area();origin.0+size.width as i32/2>=a.position.x&&origin.0+size.width as i32/2<a.position.x+a.size.width as i32&&origin.1+size.height as i32/2>=a.position.y&&origin.1+size.height as i32/2<a.position.y+a.size.height as i32}){let a=m.work_area();return crate::pet_dock::clamp_pet(Area{left:a.position.x,top:a.position.y,right:a.position.x+a.size.width as i32,bottom:a.position.y+a.size.height as i32},origin.0,origin.1,size.width as i32,size.height as i32,m.scale_factor());}}
 crate::companion_window::clamp_position(w,origin.0,origin.1).unwrap_or(origin)
}
fn monitor_scale(app:&AppHandle,area:Area,fallback:f64)->f64{
 app.get_webview_window("companion").and_then(|w|w.available_monitors().ok()).and_then(|ms|ms.into_iter().find(|m|{let a=m.work_area();a.position.x==area.left&&a.position.y==area.top}).map(|m|m.scale_factor())).unwrap_or(fallback)
}
#[tauri::command]pub fn get_companion_attachment(app:AppHandle)->bool{attached(&app)}
#[tauri::command]pub fn release_companion_window(app:AppHandle){release(&app,true)}
#[tauri::command]pub fn list_companion_windows(app:AppHandle)->Result<Vec<WindowChoice>,String>{
 #[cfg(not(windows))]{let _=app;Err("窗口依附先支持 Windows，其他平台继续使用桌面陪伴".into())}
 #[cfg(windows)]{let choices=win::choices();let result=choices.iter().map(|c|WindowChoice{id:c.id.clone(),title:c.title.clone()}).collect();*app.state::<DesktopRuntime>().choices.lock().map_err(|_|"窗口列表暂不可用")?=choices;Ok(result)}
}
#[tauri::command]pub async fn list_companion_icons(app:AppHandle)->Result<Vec<WindowChoice>,String>{
 let icons=tokio::task::spawn_blocking(crate::desktop_icons::read).await.map_err(|e|e.to_string())??;
 let runtime=app.state::<DesktopRuntime>();let mut stored=runtime.choices.lock().map_err(|_|"图标列表暂不可用")?;stored.retain(|c|c.handle!=0);
 let choices:Vec<Choice>=icons.into_iter().map(|i|Choice{id:uuid::Uuid::new_v4().to_string(),title:i.name,handle:0,pid:0}).collect();let result=choices.iter().map(|c|WindowChoice{id:c.id.clone(),title:c.title.clone()}).collect();stored.extend(choices);Ok(result)
}
#[tauri::command]pub async fn attach_companion_window(app:AppHandle,id:String,mode:Option<String>)->Result<(),String>{
 #[cfg(not(windows))]{let _=(app,id,mode);Err("窗口依附先支持 Windows".into())}
 #[cfg(windows)]{
 let choice=app.state::<DesktopRuntime>().choices.lock().map_err(|_|"窗口列表暂不可用")?.iter().find(|c|c.id==id).cloned().ok_or("请先在列表选择一个窗口")?;
 let mut mode=if choice.handle==0{"icon".to_owned()}else{mode.unwrap_or_else(||"sit".into())};if !matches!(mode.as_str(),"sit"|"top"|"top-hang"|"left"|"right"|"bottom"|"icon"){return Err("依附姿势无效".into())}
 let rt=app.state::<Arc<PetRuntime>>();let _mode=rt.mode_lock.lock().await;
 let pool=app.state::<sqlx::SqlitePool>();let p=crate::companion::preferences_db(pool.inner()).await?;
 if !p.enabled||!p.desktop_enabled||p.display_mode!="normal"{return Err("先切换到普通桌面陪伴".into())}
 let w=app.get_webview_window("companion").filter(|w|w.is_visible().unwrap_or(false)).ok_or("先让伙伴出来")?;
 if rt.moving.load(Ordering::SeqCst)||rt.morphing.load(Ordering::SeqCst){return Err("等拖动或变身完成再坐上窗沿".into())}
 let pos=w.outer_position().map_err(|e|e.to_string())?;let(frame,area,scale)=automatic::lookup(&app,choice.clone()).await.map_err(|_|"正在确认目标位置，请稍后再试")?.ok_or("目标已收起、关闭或桌面图标被遮住，请重新选择")?;
 let scale=monitor_scale(&app,area,scale);let along=crate::pet_perch::nearest_along(frame,p.size as i32,scale,&mode,(pos.x,pos.y));
 let mut target=crate::pet_perch::position_along_character(frame,area,p.size as i32,scale,&mode,along,&p.character);
 if target.is_none()&&mode=="top"{mode="top-hang".into();target=crate::pet_perch::position_along_character(frame,area,p.size as i32,scale,&mode,along,&p.character);}
 if target.is_none()&&mode=="icon"{mode="icon-left".into();target=crate::pet_perch::position_along_character(frame,area,p.size as i32,scale,&mode,along,&p.character);}
 let target=target.ok_or("这一侧没有足够的空间，换一个外沿或稍微挪动目标")?;
 let origin=app.state::<DesktopRuntime>().attached.lock().ok().and_then(|v|v.as_ref().map(|a|a.origin)).unwrap_or((pos.x,pos.y));
 automatic::cancel(&app);
 let _lock=rt.placement.lock().map_err(|_|"伙伴位置暂不可用")?;
 crate::companion_dock::dismiss_state(&app);rt.generation.fetch_add(1,Ordering::SeqCst);
 w.set_position(tauri::PhysicalPosition::new(target.0,target.1)).map_err(|e|e.to_string())?;
 *app.state::<DesktopRuntime>().attached.lock().map_err(|_|"窗口依附暂不可用")?=Some(Attachment{choice,origin,mode:mode.clone(),along,until:chrono::Utc::now().timestamp_millis()+2*3600000,automatic:None,cutout:crate::pet_perch::icon_cutout(frame,target,scale,&mode)});
 publish(&app,Some(&mode));Ok(())
 }
}
pub fn start(app:AppHandle){
 automatic::start(app.clone());
 #[cfg(windows)]tauri::async_runtime::spawn(async move{let mut icon_tick=std::time::Instant::now();let mut misses=0u32;let mut tracked=String::new();let mut tick=tokio::time::interval(Duration::from_millis(250));loop{tick.tick().await;let current=app.state::<DesktopRuntime>().attached.lock().ok().and_then(|v|v.clone());let Some(a)=current else{misses=0;tracked.clear();continue};
 let tracking_key=format!("{}:{}:{}",a.choice.id,a.mode,a.until);if tracked!=tracking_key{tracked=tracking_key;misses=0;}
 let rt=app.state::<Arc<PetRuntime>>();if rt.dismissed.load(Ordering::SeqCst)||rt.morphing.load(Ordering::SeqCst){release(&app,false);continue}if rt.moving.load(Ordering::SeqCst)||app.state::<DesktopRuntime>().automatic.moving.load(Ordering::SeqCst){continue}
 let Some(w)=app.get_webview_window("companion").filter(|w|w.is_visible().unwrap_or(false))else{release(&app,false);continue};
 if a.choice.handle==0&&icon_tick.elapsed()<Duration::from_millis(1400){continue}icon_tick=std::time::Instant::now();
 let geometry=match automatic::lookup(&app,a.choice.clone()).await{Ok(value)=>value,Err(())=>continue};
 if !app.state::<DesktopRuntime>().attached.lock().ok().is_some_and(|v|v.as_ref().is_some_and(|now|now.choice.id==a.choice.id&&now.mode==a.mode)){continue}
 let Some((frame,area,scale))=geometry else{misses+=1;if misses>=3{release(&app,true);}continue};
 let mode=rt.presentation.lock().ok().map(|s|s.clone()).unwrap_or_default();if mode!="normal"{release(&app,true);continue}if chrono::Utc::now().timestamp_millis()>a.until&&a.automatic.is_none(){release(&app,true);continue}
 let Ok(size)=w.outer_size()else{continue};let nominal=(size.width as f64/w.scale_factor().unwrap_or(scale)/1.5).round()as i32;
 let attachment_scale=monitor_scale(&app,area,scale);
 let pool=app.state::<sqlx::SqlitePool>();let Ok(p)=crate::companion::preferences_db(pool.inner()).await else{continue};
 let Some((x,y))=crate::pet_perch::position_along_character(frame,area,nominal,attachment_scale,&a.mode,a.along,&p.character)else{misses+=1;if misses>=3{release(&app,true);}continue};
 if !win::space_free(&a.choice,frame,&a.mode,(x,y),size.width as i32){misses+=1;if misses>=3{release(&app,true);}continue}misses=0;
 let Ok(_guard)=rt.placement.try_lock()else{continue};if rt.moving.load(Ordering::SeqCst)||!app.state::<DesktopRuntime>().attached.lock().ok().is_some_and(|v|v.as_ref().is_some_and(|now|now.choice.id==a.choice.id&&now.mode==a.mode)){continue}
 if w.outer_position().ok().is_some_and(|p|p.x!=x||p.y!=y){if w.set_position(tauri::PhysicalPosition::new(x,y)).is_err(){continue}}
 // A changed companion size, desktop icon size or display scale also changes
 // the renderer's local contact box; moving the native window alone is stale.
 let cutout=crate::pet_perch::icon_cutout(frame,(x,y),attachment_scale,&a.mode);
 let changed=app.state::<DesktopRuntime>().attached.lock().ok().is_some_and(|mut s|{
  let Some(current)=s.as_mut().filter(|c|c.choice.id==a.choice.id&&c.mode==a.mode)else{return false};
  if current.cutout==cutout{return false}current.cutout=cutout;true
 });
 if changed{publish(&app,Some(&a.mode));}
 }});
 #[cfg(not(windows))]let _=app;
}
#[cfg(windows)]mod win{
 use super::*;use std::ffi::c_void;
 #[repr(C)]#[derive(Default)]struct Rect{left:i32,top:i32,right:i32,bottom:i32}
 #[repr(C)]struct MonitorInfo{size:u32,monitor:Rect,work:Rect,flags:u32}
 #[repr(C)]#[derive(Clone,Copy)]struct Point{x:i32,y:i32}
 #[link(name="user32")]unsafe extern "system"{fn MonitorFromPoint(p:Point,flags:u32)->*mut c_void;fn WindowFromPoint(p:Point)->*mut c_void;fn GetAncestor(h:*mut c_void,flags:u32)->*mut c_void;fn GetClassNameW(h:*mut c_void,name:*mut u16,n:i32)->i32;}
 #[link(name="user32")]unsafe extern "system"{fn EnumWindows(cb:unsafe extern "system" fn(*mut c_void,isize)->i32,data:isize)->i32;fn IsWindowVisible(h:*mut c_void)->i32;fn IsIconic(h:*mut c_void)->i32;fn GetWindowThreadProcessId(h:*mut c_void,p:*mut u32)->u32;fn GetWindowTextW(h:*mut c_void,t:*mut u16,n:i32)->i32;fn GetWindowRect(h:*mut c_void,r:*mut Rect)->i32;fn MonitorFromWindow(h:*mut c_void,f:u32)->*mut c_void;fn GetMonitorInfoW(h:*mut c_void,info:*mut MonitorInfo)->i32;fn GetDpiForWindow(h:*mut c_void)->u32;}
 // Import from the Windows DLL directly, including on self-contained GNU builds.
 #[link(name="dwmapi.dll",kind="raw-dylib",modifiers="+verbatim")]unsafe extern "system"{fn DwmGetWindowAttribute(h:*mut c_void,a:u32,v:*mut c_void,bytes:u32)->i32;}
 fn visible(handle:isize)->bool{unsafe{let h=handle as *mut c_void;let mut cloaked=0u32;let _=DwmGetWindowAttribute(h,14,&mut cloaked as *mut _ as *mut c_void,4);IsWindowVisible(h)!=0&&IsIconic(h)==0&&cloaked==0}}
 pub fn geometry(c:&Choice)->Option<(Area,Area,f64)>{
 if c.handle==0{
  let icon=crate::desktop_icons::find(&c.title)?;
  unsafe{let p=Point{x:(icon.rect.left+icon.rect.right)/2,y:icon.rect.top+12};let h=WindowFromPoint(p);let mut pid=0;GetWindowThreadProcessId(h,&mut pid);let root=GetAncestor(h,2);let mut name=[0u16;64];let n=GetClassNameW(root,name.as_mut_ptr(),64).max(0)as usize;let class=String::from_utf16_lossy(&name[..n]);let mut title=[0u16;128];let length=GetWindowTextW(root,title.as_mut_ptr(),128).max(0)as usize;let pet_overlay=pid==std::process::id()&&String::from_utf16_lossy(&title[..length])=="Xmission · 伙伴";if !pet_overlay&&class!="Progman"&&class!="WorkerW"{return None}
   let m=MonitorFromPoint(p,2);let mut info:MonitorInfo=std::mem::zeroed();info.size=std::mem::size_of::<MonitorInfo>()as u32;if GetMonitorInfoW(m,&mut info)==0{return None}let a=info.work;return Some((icon.rect,Area{left:a.left,top:a.top,right:a.right,bottom:a.bottom},1.0))}
 }
 if !visible(c.handle){return None}unsafe{let h=c.handle as *mut c_void;let mut pid=0;GetWindowThreadProcessId(h,&mut pid);if pid!=c.pid||pid==std::process::id(){return None}
 let mut r=Rect::default();if DwmGetWindowAttribute(h,9,&mut r as *mut _ as *mut c_void,std::mem::size_of::<Rect>()as u32)!=0&&GetWindowRect(h,&mut r)==0{return None}
 let monitor=MonitorFromWindow(h,2);let mut info:MonitorInfo=std::mem::zeroed();info.size=std::mem::size_of::<MonitorInfo>()as u32;if monitor.is_null()||GetMonitorInfoW(monitor,&mut info)==0{return None}
 let a=info.work;Some((Area{left:r.left,top:r.top,right:r.right,bottom:r.bottom},Area{left:a.left,top:a.top,right:a.right,bottom:a.bottom},GetDpiForWindow(h).max(96)as f64/96.0))}}
 // SAFETY: EnumWindows invokes this synchronously; data owns a live Vec for the call.
 unsafe extern "system" fn visit(h:*mut c_void,data:isize)->i32{let mut pid=0;GetWindowThreadProcessId(h,&mut pid);if pid==0||pid==std::process::id()||!visible(h as isize){return 1}let mut text=[0u16;256];let n=GetWindowTextW(h,text.as_mut_ptr(),256);if n<=0{return 1}let c=Choice{id:uuid::Uuid::new_v4().to_string(),title:String::from_utf16_lossy(&text[..n as usize]),handle:h as isize,pid};if geometry(&c).is_some(){(*(data as *mut Vec<Choice>)).push(c)}1}
 pub fn choices()->Vec<Choice>{let mut list=Vec::new();unsafe{EnumWindows(visit,&mut list as *mut _ as isize);}list.truncate(40);list}
 #[repr(C)]struct GuiInfo{size:u32,flags:u32,active:*mut c_void,focus:*mut c_void,capture:*mut c_void,menu:*mut c_void,move_size:*mut c_void,caret:*mut c_void,rect:Rect}
 #[link(name="user32")]unsafe extern "system"{fn GetCursorPos(p:*mut Point)->i32;fn GetGUIThreadInfo(thread:u32,info:*mut GuiInfo)->i32;fn GetWindow(h:*mut c_void,cmd:u32)->*mut c_void;}
 #[link(name="user32")]unsafe extern "system"{fn GetAsyncKeyState(key:i32)->i16;}
 pub fn input_active()->bool{unsafe{
  // Ordinary typing and mouse motion are compatible with desktop companionship.
  // Held mouse buttons still pause motion while the user drags a pet or window.
  GetAsyncKeyState(1)<0||GetAsyncKeyState(2)<0
 }}
 pub fn menu_active()->bool{unsafe{let mut info:GuiInfo=std::mem::zeroed();info.size=std::mem::size_of::<GuiInfo>()as u32;GetGUIThreadInfo(0,&mut info)!=0&&info.flags&(4|16)!=0}}
 pub fn cursor()->Option<(i32,i32)>{unsafe{let mut p=Point{x:0,y:0};(GetCursorPos(&mut p)!=0).then_some((p.x,p.y))}}
 fn pet_overlay(h:*mut c_void)->bool{unsafe{let mut pid=0;GetWindowThreadProcessId(h,&mut pid);let mut text=[0u16;64];let n=GetWindowTextW(h,text.as_mut_ptr(),64).max(0)as usize;pid==std::process::id()&&String::from_utf16_lossy(&text[..n])=="Xmission · 伙伴"}}
 fn root_at(x:i32,y:i32)->*mut c_void{unsafe{
  let mut root=GetAncestor(WindowFromPoint(Point{x,y}),2);if !pet_overlay(root){return root}
  for _ in 0..64{root=GetWindow(root,2);if root.is_null(){break}if !visible(root as isize)||pet_overlay(root){continue}let mut r=Rect::default();if GetWindowRect(root,&mut r)!=0&&x>=r.left&&x<r.right&&y>=r.top&&y<r.bottom{break}}
  root
 }}
 fn desktop_root(h:*mut c_void)->bool{unsafe{let mut name=[0u16;64];let n=GetClassNameW(h,name.as_mut_ptr(),64).max(0)as usize;matches!(String::from_utf16_lossy(&name[..n]).as_str(),"Progman"|"WorkerW")}}
 pub fn desktop_visible(x:i32,y:i32)->bool{desktop_root(root_at(x,y))}
 pub fn space_free(c:&Choice,frame:Area,mode:&str,target:(i32,i32),viewport:i32)->bool{
  let unit=viewport as f64/1.5;
  let pin=(target.0 as f64+unit*if mode=="left"||mode=="icon-left"{1.22}else if mode=="right"||mode=="icon"{0.28}else{0.75},target.1 as f64+unit*if mode=="top"{1.08}else if mode=="bottom"||mode=="top-hang"{0.14}else if mode.starts_with("icon"){0.62}else{0.70});
  let support=match mode{"top"|"top-hang"=>(pin.0.round()as i32,frame.top+6),"left"=>(frame.left+6,pin.1.round()as i32),"right"=>(frame.right-6,pin.1.round()as i32),"bottom"=>(pin.0.round()as i32,frame.bottom-6),_=>(frame.left+(frame.right-frame.left)/2,frame.top+(frame.bottom-frame.top)/2)};
  let root=root_at(support.0,support.1);if if c.handle==0{!desktop_root(root)}else{root as isize!=c.handle}{return false}
  // The supporting edge must be exposed. A companion may overlap other windows;
  // requiring empty desktop beneath its whole body rejects most usable frames.
  true
 }
}
