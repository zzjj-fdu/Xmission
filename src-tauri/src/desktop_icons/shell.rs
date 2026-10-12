//! Read-only Shell folder view metrics; never select, move or open an item.
use super::*;
use windows::{core::{Interface,IUnknown,PWSTR},Win32::{Foundation::{HWND,POINT},System::{Com::{CoCreateInstance,CoTaskMemFree,CLSCTX_ALL,IServiceProvider},Variant::VARIANT},UI::Shell::{IShellWindows,IShellBrowser,IFolderView2,IShellFolder,FOLDERVIEWMODE,ShellWindows,SWC_DESKTOP,SWFO_NEEDDISPATCH,SID_STopLevelBrowser,SVGIO_ALLVIEW,SHGDN_NORMAL,StrRetToStrW,Common::STRRET}}};
use windows::Win32::{Foundation::SIZE,Graphics::Gdi::{HBITMAP,HGDIOBJ,BITMAP,BITMAPINFO,BITMAPINFOHEADER,GetObjectW,GetDC,ReleaseDC,GetDIBits,DeleteObject,DIB_RGB_COLORS},UI::Shell::{SHCreateItemWithParent,IShellItemImageFactory,SIIGBF_ICONONLY,SIIGBF_INCACHEONLY,SIIGBF_BIGGERSIZEOK,Common::ITEMIDLIST}};
#[link(name="user32")]unsafe extern "system"{fn GetDpiForWindow(hwnd:*mut std::ffi::c_void)->u32;fn MapWindowPoints(from:*mut std::ffi::c_void,to:*mut std::ffi::c_void,points:*mut POINT,count:u32)->i32;}
struct Alloc(*mut std::ffi::c_void);impl Drop for Alloc{fn drop(&mut self){unsafe{CoTaskMemFree(Some(self.0))}}}
struct Bitmap(HBITMAP);impl Drop for Bitmap{fn drop(&mut self){unsafe{let _=DeleteObject(HGDIOBJ(self.0.0));}}}
// Icon only: never request document thumbnails, contents or screen capture.
// This runs on the existing Shell worker, outside all GUI/placement locks.
unsafe fn ink_rect(folder:&IShellFolder,pidl:*const ITEMIDLIST,frame:Area)->Option<Area>{
 let side=(frame.right-frame.left).clamp(16,512);
 let factory:IShellItemImageFactory=SHCreateItemWithParent(None,folder,pidl).ok()?;
 let size=SIZE{cx:side,cy:side};
 let bitmap=Bitmap(factory.GetImage(size,SIIGBF_ICONONLY|SIIGBF_INCACHEONLY|SIIGBF_BIGGERSIZEOK).or_else(|_|factory.GetImage(size,SIIGBF_ICONONLY|SIIGBF_BIGGERSIZEOK)).ok()?);
 let mut info=BITMAP::default();if GetObjectW(HGDIOBJ(bitmap.0.0),std::mem::size_of::<BITMAP>()as i32,Some((&mut info as *mut BITMAP).cast()))==0{return None}
 let(w,h)=(info.bmWidth,info.bmHeight.checked_abs()?);if !(1..=512).contains(&w)||!(1..=512).contains(&h){return None}
 let mut format=BITMAPINFO{bmiHeader:BITMAPINFOHEADER{biSize:std::mem::size_of::<BITMAPINFOHEADER>()as u32,biWidth:w,biHeight:-h,biPlanes:1,biBitCount:32,..Default::default()},..Default::default()};
 let mut data=vec![0u8;w as usize*h as usize*4];let dc=GetDC(None);if dc.0.is_null(){return None}
 let rows=GetDIBits(dc,bitmap.0,0,h as u32,Some(data.as_mut_ptr().cast()),&mut format,DIB_RGB_COLORS);let _=ReleaseDC(None,dc);
 (rows==h).then(||metrics::visible_rect(frame,w as u32,h as u32,&data))
}
// Explorer's Shell view requires an STA caller. Keep UI Automation on its
// existing MTA worker and never carry COM interfaces across apartments.
pub(super) fn read(wanted:Option<&str>)->windows::core::Result<Vec<Icon>>{
 let wanted=wanted.map(str::to_owned);
 std::thread::spawn(move||unsafe{
  use windows::Win32::System::Com::{CoInitializeEx,CoUninitialize,COINIT_APARTMENTTHREADED};
  CoInitializeEx(None,COINIT_APARTMENTTHREADED).ok()?;
  struct Com;impl Drop for Com{fn drop(&mut self){unsafe{CoUninitialize()}}}
  let _com=Com;pictures(wanted.as_deref())
 }).join().unwrap_or_else(|_|Err(windows::core::Error::from_hresult(windows::core::HRESULT(0x80004005u32 as i32))))
}
pub(super) unsafe fn pictures(wanted:Option<&str>)->windows::core::Result<Vec<Icon>>{
 let shells:IShellWindows=CoCreateInstance(&ShellWindows,None::<&IUnknown>,CLSCTX_ALL)?;
 let mut handle=0;let dispatch=shells.FindWindowSW(&VARIANT::from(0i32),&VARIANT::default(),SWC_DESKTOP,&mut handle,SWFO_NEEDDISPATCH)?;
 let service:IServiceProvider=dispatch.cast()?;let browser:IShellBrowser=service.QueryService(&SID_STopLevelBrowser)?;
 let view=browser.QueryActiveShellView()?;let hwnd:HWND=view.GetWindow()?;let folder_view:IFolderView2=view.cast()?;let folder:IShellFolder=folder_view.GetFolder()?;
 let mut mode=FOLDERVIEWMODE::default();let mut side=0;folder_view.GetViewModeAndIconSize(&mut mode,&mut side)?;
 let Some(side)=metrics::picture_side(side,GetDpiForWindow(hwnd.0))else{return Ok(vec![])};
 let mut result=Vec::new();
 for index in 0..folder_view.ItemCount(SVGIO_ALLVIEW)?.min(128){
  let Ok(pidl)=folder_view.Item(index)else{continue};if pidl.is_null(){continue}let _pidl=Alloc(pidl.cast());
  let mut ret=STRRET::default();if folder.GetDisplayNameOf(pidl,SHGDN_NORMAL,&mut ret).is_err(){continue}
  let mut text=PWSTR::null();if StrRetToStrW(&mut ret,Some(pidl),&mut text).is_err()||text.is_null(){continue}let _text=Alloc(text.0.cast());
  let Ok(name)=text.to_string()else{continue};if wanted.is_some_and(|expected|expected!=name){continue}
  let Ok(mut point)=folder_view.GetItemPosition(pidl)else{continue};MapWindowPoints(hwnd.0,std::ptr::null_mut(),&mut point,1);
  let frame=Area{left:point.x,top:point.y,right:point.x+side,bottom:point.y+side};
  // Bulk discovery remains cheap. Only a selected nearby target needs the
  // visible alpha edge; extraction happens on this worker, never on the UI.
  let rect=if wanted.is_some(){ink_rect(&folder,pidl,frame).unwrap_or(frame)}else{frame};
  result.push(Icon{name,rect});
 }
 Ok(result)
}
