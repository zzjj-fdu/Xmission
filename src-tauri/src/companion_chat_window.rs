use std::sync::{Arc,atomic::Ordering};
use tauri::{AppHandle,Manager,State,Emitter};
use sqlx::SqlitePool;
use crate::{companion::{PetNotice,PetReply},companion_window::{self,PetRuntime}};

fn place_input(app:&AppHandle,w:&tauri::WebviewWindow,height:u32)->Result<(),String>{
 let pet=app.get_webview_window("companion").ok_or("伙伴还没出来")?;
 let pos=pet.outer_position().map_err(|e|e.to_string())?;let ps=pet.outer_size().map_err(|e|e.to_string())?;
 let(l,t,r,b)=companion_window::bounds(&pet)?;let scale=pet.scale_factor().map_err(|e|e.to_string())?;
 w.set_size(tauri::LogicalSize::new(324.0f64.min((r-l)as f64/scale),(height as f64).min((b-t)as f64/scale))).map_err(|e|e.to_string())?;
 let size=w.outer_size().map_err(|e|e.to_string())?;let gap=(6.0*scale).round()as i32;
 // Prefer a writing strip beside the fox's paws. At a corner, fall back to
 // above/below rather than placing an invisible part of the field off-screen.
 let right=pos.x+ps.width as i32+gap;let left=pos.x-size.width as i32-gap;
 let(x,y)=if right+size.width as i32<=r{(right,pos.y+ps.height as i32-size.height as i32-gap)}
 else if left>=l{(left,pos.y+ps.height as i32-size.height as i32-gap)}
 else{let x=pos.x+ps.width as i32/2-size.width as i32/2;let below=pos.y+ps.height as i32+gap;
 (x,if below+size.height as i32<=b{below}else{pos.y-size.height as i32-gap})};
 w.set_position(tauri::PhysicalPosition::new(x.clamp(l,(r-size.width as i32).max(l)),y.clamp(t,(b-size.height as i32).max(t)))).map_err(|e|e.to_string())
}

#[tauri::command]
pub fn open_companion_input(app:AppHandle)->Result<(),String>{
 let rt=app.state::<Arc<PetRuntime>>();
 if rt.dismissed.load(Ordering::SeqCst){return Err("先让伙伴出来，再递句话给它".into())}
 rt.chat_serial.fetch_add(1,Ordering::SeqCst);
 let w=companion_window::window(&app,"companion-input",324.0)?;
 place_input(&app,&w,64)?;
 let _=app.emit_to("companion-input","companion-input-open",());
 w.show().map_err(|e|e.to_string())?;w.set_focus().map_err(|e|e.to_string())
}
#[tauri::command]
pub fn dismiss_companion_input(app:AppHandle){
 app.state::<Arc<PetRuntime>>().chat_serial.fetch_add(1,Ordering::SeqCst);
 if let Some(w)=app.get_webview_window("companion-input"){let _=w.hide();}
}
#[tauri::command]
pub fn resize_companion_input(app:AppHandle,height:u32)->Result<(),String>{
 if !(64..=240).contains(&height){return Err("输入框尺寸无效".into())}
 let w=app.get_webview_window("companion-input").ok_or("输入框已收起")?;
 place_input(&app,&w,height)
}
#[tauri::command]
pub async fn show_companion_last_reply(app:AppHandle,pool:State<'_,SqlitePool>)->Result<(),String>{
 let text:Option<String>=sqlx::query_scalar(&crate::companion::owned_sql("SELECT content FROM companion_help_drafts WHERE {owner} AND state='ready' AND expires_at>? AND scenario IN('chat','hint','example','tutorial') ORDER BY created_at DESC LIMIT 1")).bind(chrono::Utc::now().timestamp_millis()).fetch_optional(pool.inner()).await.map_err(|e|e.to_string())?;
 let text=text.ok_or("还没有保留的回应")?;
 companion_window::show_notice(&app,PetNotice{items:vec![],created_at:chrono::Utc::now().timestamp_millis(),message:Some(text.clone()),title:None,tab:Some("reply".into()),reply:Some(PetReply{text,emotion:"calm".into(),suggested_task:None,source:"ai".into(),draft_id:None})})?;
 dismiss_companion_input(app);Ok(())
}
#[tauri::command]
pub async fn send_companion_message(app:AppHandle,pool:State<'_,SqlitePool>,message:String,include_today:bool,scenario:Option<String>,shared_text:Option<String>)->Result<(),String>{
 let rt=app.state::<Arc<PetRuntime>>().inner().clone();let issued=rt.chat_serial.load(Ordering::SeqCst);
 let canceled=async{loop{if rt.chat_serial.load(Ordering::SeqCst)!=issued||rt.dismissed.load(Ordering::SeqCst){break}tokio::time::sleep(std::time::Duration::from_millis(100)).await;}};
 let reply:PetReply=tokio::select!{answer=crate::companion::companion_chat(pool,message,include_today,scenario,shared_text)=>answer?,_=canceled=>return Ok(())};
 if rt.chat_serial.load(Ordering::SeqCst)!=issued||rt.dismissed.load(Ordering::SeqCst){return Ok(())}
 companion_window::show_notice(&app,PetNotice{items:vec![],created_at:chrono::Utc::now().timestamp_millis(),message:Some(reply.text.clone()),title:None,tab:Some("reply".into()),reply:Some(reply)})?;
 if let Some(w)=app.get_webview_window("companion-input"){let _=w.hide();}
 let _=app.emit("companion-gesture",serde_json::json!({"action":"respond"}));Ok(())
}
