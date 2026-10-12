//! Read only the Explorer desktop list, after an explicit user request.
use crate::pet_dock::Area;
#[cfg(windows)]mod shell;
#[cfg(windows)]mod metrics;
#[derive(Clone)]pub struct Icon{pub name:String,pub rect:Area}
#[cfg(windows)]pub fn read()->Result<Vec<Icon>,String>{read_matching(None)}
#[cfg(windows)]pub fn find(name:&str)->Option<Icon>{read_matching(Some(name)).ok()?.into_iter().next()}
#[cfg(windows)]fn read_matching(wanted:Option<&str>)->Result<Vec<Icon>,String>{
 use std::ffi::c_void;
 use windows::{core::IUnknown,Win32::{Foundation::HWND,System::Com::{CoInitializeEx,CoUninitialize,CoCreateInstance,COINIT_MULTITHREADED,CLSCTX_INPROC_SERVER},UI::Accessibility::{IUIAutomation,CUIAutomation,TreeScope_Children,UIA_ListItemControlTypeId,UIA_ImageControlTypeId}}};
 #[link(name="user32")]unsafe extern "system"{fn EnumWindows(cb:unsafe extern "system" fn(*mut c_void,isize)->i32,data:isize)->i32;fn FindWindowExW(parent:*mut c_void,after:*mut c_void,class:*const u16,title:*const u16)->*mut c_void;}
 fn wide(s:&str)->Vec<u16>{s.encode_utf16().chain(Some(0)).collect()}
 unsafe extern "system" fn desktop(h:*mut c_void,data:isize)->i32{
  let view=FindWindowExW(h,std::ptr::null_mut(),wide("SHELLDLL_DefView").as_ptr(),std::ptr::null());
  if !view.is_null(){let list=FindWindowExW(view,std::ptr::null_mut(),wide("SysListView32").as_ptr(),std::ptr::null());if !list.is_null(){*(data as *mut isize)=list as isize;return 0}}
  1
 }
 struct Com;impl Drop for Com{fn drop(&mut self){unsafe{CoUninitialize()}}}
 // This function runs on a blocking worker; COM values never leave that thread.
 unsafe{
  CoInitializeEx(None,COINIT_MULTITHREADED).ok().map_err(|e|e.to_string())?;let _com=Com;
  let pictures=shell::read(wanted).unwrap_or_default();
  // The Shell view already provides physical picture geometry. Do not issue
  // hundreds of redundant UIA calls merely to rediscover the same items.
  if !pictures.is_empty(){let mut counts=std::collections::HashMap::new();for icon in &pictures{*counts.entry(icon.name.clone()).or_insert(0)+=1;}return Ok(pictures.into_iter().filter(|i|counts.get(&i.name)==Some(&1)).collect())}
  let mut handle=0isize;EnumWindows(desktop,&mut handle as *mut _ as isize);
  if handle==0{return Err("没有找到可见的系统桌面图标；请先显示 Windows 桌面图标".into())}
  let automation:IUIAutomation=CoCreateInstance(&CUIAutomation,None::<&IUnknown>,CLSCTX_INPROC_SERVER).map_err(|e|e.to_string())?;
  let list=automation.ElementFromHandle(HWND(handle as *mut c_void)).map_err(|e|e.to_string())?;
  let condition=automation.CreateTrueCondition().map_err(|e|e.to_string())?;
  let children=list.FindAll(TreeScope_Children,&condition).map_err(|e|e.to_string())?;
  let mut out=Vec::new();for i in 0..children.Length().unwrap_or(0).min(128){
   let Ok(el)=children.GetElement(i)else{continue};let Ok(name)=el.CurrentName()else{continue};let name=name.to_string();if wanted.is_some_and(|expected|expected!=name){continue}
   if el.CurrentIsOffscreen().map(|v|v.as_bool()).unwrap_or(true)||el.CurrentControlType().ok()!=Some(UIA_ListItemControlTypeId){continue}
   let Ok(mut r)=el.CurrentBoundingRectangle()else{continue};
   // The list item's box can include its label. Prefer the actual picture box.
   let mut picture=None;
   if let Ok(parts)=el.FindAll(TreeScope_Children,&condition){for j in 0..parts.Length().unwrap_or(0).min(6){let Ok(part)=parts.GetElement(j)else{continue};let Ok(rect)=part.CurrentBoundingRectangle()else{continue};if part.CurrentControlType().ok()==Some(UIA_ImageControlTypeId)&&rect.right>rect.left&&rect.bottom>rect.top{picture=Some(rect)}}}
   if let Some(rect)=picture{r=rect;}else if let Some(native)=pictures.iter().find(|icon|icon.name==name){r.left=native.rect.left;r.top=native.rect.top;r.right=native.rect.right;r.bottom=native.rect.bottom;}else{continue}
   if !name.is_empty()&&name.chars().count()<=512&&r.right>r.left&&r.bottom>r.top{out.push(Icon{name,rect:Area{left:r.left,top:r.top,right:r.right,bottom:r.bottom}})}
  }
  let mut counts=std::collections::HashMap::new();for i in &out{*counts.entry(i.name.clone()).or_insert(0)+=1;}out.retain(|i|counts.get(&i.name)==Some(&1));Ok(out)
 }
}
#[cfg(not(windows))]pub fn read()->Result<Vec<Icon>,String>{Err("桌面图标依附先支持 Windows".into())}
