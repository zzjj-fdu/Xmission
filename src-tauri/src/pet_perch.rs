//! The paws, rather than the transparent viewport, sit on the visible window frame.
use crate::pet_dock::Area;
pub fn icon_cutout(frame:Area,target:(i32,i32),scale:f64,mode:&str)->Option<[f64;4]>{
 if !mode.starts_with("icon")||!scale.is_finite()||scale<=0.0{return None}
 Some([(frame.left-target.0)as f64/scale,(frame.top-target.1)as f64/scale,(frame.right-target.0)as f64/scale,(frame.bottom-target.1)as f64/scale])
}
pub fn position(frame:Area,work:Area,size:i32,scale:f64)->Option<(i32,i32)>{
 position_for(frame,work,size,scale,"sit")
}
pub fn position_for(frame:Area,work:Area,size:i32,scale:f64,mode:&str)->Option<(i32,i32)>{
 position_along(frame,work,size,scale,mode,0.4)
}
pub fn nearest_along(frame:Area,size:i32,scale:f64,mode:&str,origin:(i32,i32))->f64{
 let unit=size as f64*scale;
 let horizontal=matches!(mode,"top"|"top-hang"|"bottom"|"sit");
 let coordinate=if horizontal{origin.0 as f64+unit*0.75}else{origin.1 as f64+unit*0.70};
 let start=if horizontal{frame.left}else{frame.top}as f64;let length=if horizontal{frame.right-frame.left}else{frame.bottom-frame.top}as f64;
 ((coordinate-start)/length.max(1.0)).clamp(0.0,1.0)
}
pub fn position_along(frame:Area,work:Area,size:i32,scale:f64,mode:&str,along:f64)->Option<(i32,i32)>{
 position_along_character(frame,work,size,scale,mode,along,"fox")
}
pub fn position_along_character(frame:Area,work:Area,size:i32,scale:f64,mode:&str,along:f64,character:&str)->Option<(i32,i32)>{
 if size<=0||!scale.is_finite()||scale<=0.0||frame.right<=frame.left||frame.bottom<=frame.top{return None}
 if !matches!(character,"fox"|"red-panda"){return None}
 let panda=character=="red-panda";
 if mode.starts_with("icon"){
  if panda{
   let e=crate::panda_bounds::icon(mode)?;let unit=size as f64*scale;let viewport=(unit*1.5).ceil();
   // Panda hug bounds are normalized to companion size at the real near edge,
   // rather than to the fox's bounded icon slot or the image centre.
   let(cx,cy)=(if mode=="icon"{frame.right as f64}else{frame.left as f64},frame.top as f64);
   if cx+e[0]*unit<work.left as f64||cx+e[2]*unit>work.right as f64||cy+e[1]*unit<work.top as f64||cy+e[3]*unit>work.bottom as f64{return None}
   let(xlo,xhi)=(-e[0]*unit+scale,viewport-e[2]*unit-scale);let(ylo,yhi)=(-e[1]*unit+scale,viewport-e[3]*unit-scale);
   if xlo>xhi||ylo>yhi{return None}
   let px=(unit*if mode=="icon"{0.8}else{0.7}).clamp(xlo,xhi);let py=(unit*0.62).clamp(ylo,yhi);
   return Some(((cx-px).round()as i32,(cy-py).round()as i32))
  }
  let e=crate::perch_bounds::icon(mode)?;let side=((frame.right-frame.left)as f64).min(size as f64*scale*crate::perch_bounds::ICON_SLOT_RATIO);
  let viewport=(size as f64*1.5*scale).ceil();let unit=size as f64*scale;
  // Match the renderer's small inward contact overlap, including at high DPI.
  let press=(3.0*scale).min(unit*0.02).min((frame.right-frame.left)as f64*0.045);
  let(cx,cy)=(if mode=="icon"{frame.right as f64-side/2.0-press}else{frame.left as f64+side/2.0+press},frame.top as f64+side/2.0+press);
  if cx+e[0]*side<work.left as f64||cx+e[2]*side>work.right as f64||cy+e[1]*side<work.top as f64||cy+e[3]*side>work.bottom as f64{return None}
  let(xlo,xhi)=(-e[0]*side+scale,viewport-e[2]*side-scale);let(ylo,yhi)=(-e[1]*side+scale,viewport-e[3]*side-scale);
  if xlo>xhi||ylo>yhi{return None}
  let px=(unit*if mode=="icon"{0.4}else{1.1}).clamp(xlo,xhi);let py=(unit*0.95).clamp(ylo,yhi);
  return Some(((cx-px).round()as i32,(cy-py).round()as i32))
 }
 let extent=if panda{crate::panda_bounds::visible(mode)?}else{crate::perch_bounds::visible(mode)?};
 let viewport=(size as f64*1.5*scale).ceil()as i32;
 let baseline=(viewport as f64-size as f64*0.08*scale).round()as i32;
 let unit=size as f64*scale;
 let horizontal=matches!(mode,"top"|"top-hang"|"bottom"|"sit");
 let low=if horizontal{(frame.left as f64+16.0*scale).max(work.left as f64-extent[0]*unit)}else{(frame.top as f64+32.0*scale).max(work.top as f64-extent[1]*unit)};
 let high=if horizontal{(frame.right as f64-if mode.starts_with("top"){112.0*scale}else{16.0*scale}).min(work.right as f64-extent[2]*unit)}else{(frame.bottom as f64-12.0*scale).min(work.bottom as f64-extent[3]*unit)};
 if low>high{return None}
 let point=if horizontal{frame.left as f64+(frame.right-frame.left)as f64*along.clamp(0.0,1.0)}else{frame.top as f64+(frame.bottom-frame.top)as f64*along.clamp(0.0,1.0)};
 let point=point.clamp(low,high);
 let centre=point.round()as i32-viewport/2;
 let(x,y)=match mode{
  "sit"=>(centre,frame.top-baseline),
  "top"=>(centre,frame.top-(unit*1.08).round()as i32),
  "top-hang"=>(centre,(frame.top as f64-extent[1]*unit+scale-unit*0.14).round()as i32),
  "left"=>(frame.left-(unit*1.22).round()as i32,point.round()as i32-(unit*0.70).round()as i32),
  "right"=>(frame.right-(unit*0.28).round()as i32,point.round()as i32-(unit*0.70).round()as i32),
  "bottom"=>(centre,frame.bottom-(unit*0.14).round()as i32),
  _=>return None,
 };
 // Never clamp a grip onto a different edge: an unavailable side is rejected.
 let pin_x=if mode=="left"{unit*1.22}else if mode=="right"{unit*0.28}else{unit*0.75};
 let pin_y=if mode=="top"{unit*1.08}else if mode=="bottom"||mode=="top-hang"{unit*0.14}else if mode=="sit"{baseline as f64}else{unit*0.70};
 let anchor=(x as f64+pin_x,y as f64+pin_y);
 if anchor.0+extent[0]*unit<work.left as f64-1.0||anchor.0+extent[2]*unit>work.right as f64+1.0||anchor.1+extent[1]*unit<work.top as f64-1.0||anchor.1+extent[3]*unit>work.bottom as f64+1.0{return None}
 Some((x,y))
}
#[cfg(test)]mod tests{
 use super::*;
 #[test]fn panda_icon_bounds_follow_actual_edge_at_every_dpi_and_size(){
  let work=Area{left:-2560,top:-1440,right:0,bottom:0};let icon=Area{left:-1600,top:-1000,right:-1504,bottom:-904};
  for size in [64,96,128]{for scale in [1.0,1.25,1.5,2.0]{for mode in ["icon","icon-left"]{
   let (x,y)=position_along_character(icon,work,size,scale,mode,0.4,"red-panda").unwrap();let e=crate::panda_bounds::icon(mode).unwrap();
   let unit=size as f64*scale;let viewport=(unit*1.5).ceil();let anchor=(if mode=="icon"{icon.right}else{icon.left}as f64,icon.top as f64);
   let actual=[anchor.0+e[0]*unit,anchor.1+e[1]*unit,anchor.0+e[2]*unit,anchor.1+e[3]*unit];
   assert!(actual[0]>=work.left as f64&&actual[1]>=work.top as f64&&actual[2]<=work.right as f64&&actual[3]<=work.bottom as f64);
   assert!(actual[0]>=x as f64+scale-0.5&&actual[1]>=y as f64+scale-0.5&&actual[2]<=x as f64+viewport-scale+0.5&&actual[3]<=y as f64+viewport-scale+0.5,"entire panda body fits native canvas: {mode}, {size}, {scale}");
   let moved=Area{left:icon.left+40,top:icon.top+20,right:icon.right+40,bottom:icon.bottom+20};assert_eq!(position_along_character(moved,work,size,scale,mode,0.4,"red-panda"),Some((x+40,y+20)));
   let taller=Area{bottom:icon.bottom+40,..icon};assert_eq!(position_along_character(taller,work,size,scale,mode,0.4,"red-panda"),Some((x,y)),"real near edge and top anchor do not use icon centre/ruler");
   let cutout=icon_cutout(icon,(x,y),scale,mode).unwrap();assert!((cutout[0]*scale+x as f64-icon.left as f64).abs()<0.001);assert!((cutout[1]*scale+y as f64-icon.top as f64).abs()<0.001);
  }}}
 }
 #[test]fn panda_first_row_and_insufficient_window_headroom_are_rejected(){
  let work=Area{left:0,top:0,right:1920,bottom:1080};
  for size in [64,96,128]{for scale in [1.0,1.25,1.5,2.0]{
   let icon=Area{left:450,top:8,right:498,bottom:56};for mode in ["icon","icon-left"]{assert!(position_along_character(icon,work,size,scale,mode,0.4,"red-panda").is_none(),"first row must leave room for panda ears");}
   let frame=Area{left:300,top:0,right:1300,bottom:850};for mode in ["top","sit"]{assert!(position_along_character(frame,work,size,scale,mode,0.4,"red-panda").is_none());}
   assert!(position_along_character(frame,work,size,scale,"top-hang",0.4,"red-panda").is_some(),"header grip can use inside headroom");
  }}
 }
 #[test]fn panda_window_bounds_fit_screen_and_canvas_with_negative_monitor_origins(){
  let work=Area{left:-2560,top:-1440,right:0,bottom:0};let frame=Area{left:-2200,top:-1000,right:-500,bottom:-450};
  for size in [64,96,128]{for scale in [1.0,1.25,1.5,2.0]{for mode in ["sit","top","top-hang","left","right","bottom"]{
   let (x,y)=position_along_character(frame,work,size,scale,mode,0.4,"red-panda").unwrap();let e=crate::panda_bounds::visible(mode).unwrap();let unit=size as f64*scale;let viewport=(unit*1.5).ceil();
   let pin_x=match mode{"left"=>1.22,"right"=>0.28,_=>0.75};let pin_y=match mode{"top"=>1.08,"bottom"|"top-hang"=>0.14,"sit"=>1.42,_=>0.70};
   let actual=[x as f64+(pin_x+e[0])*unit,y as f64+(pin_y+e[1])*unit,x as f64+(pin_x+e[2])*unit,y as f64+(pin_y+e[3])*unit];
   assert!(actual[0]>=work.left as f64-1.0&&actual[1]>=work.top as f64-1.0&&actual[2]<=work.right as f64+1.0&&actual[3]<=work.bottom as f64+1.0);
   assert!(actual[0]>=x as f64-1.0&&actual[1]>=y as f64-1.0&&actual[2]<=x as f64+viewport+1.0&&actual[3]<=y as f64+viewport+1.0,"panda parts fit 1.5x native viewport: {mode}");
   let moved=Area{left:frame.left+40,top:frame.top+20,right:frame.right+40,bottom:frame.bottom+20};assert_eq!(position_along_character(moved,work,size,scale,mode,0.4,"red-panda"),Some((x+40,y+20)));
  }}}
 }
 #[test]fn a_large_icon_does_not_exclude_a_small_fox(){let work=Area{left:0,top:0,right:1920,bottom:1080};let icon=Area{left:450,top:350,right:546,bottom:446};for mode in ["icon","icon-left"]{assert!(position_for(icon,work,64,1.0,mode).is_some(),"A 64px companion needs a bounded embrace, not an icon-sized enlargement");}}
 #[test]fn paws_follow_frames_and_negative_monitors(){for scale in [1.0,1.25,1.5,2.0]{for size in [64,96,128]{let w=Area{left:-2560,top:0,right:0,bottom:1440};let a=Area{left:-2200,top:400,right:-500,bottom:1200};let(x,y)=position(a,w,size,scale).unwrap();let b=Area{left:a.left+40,top:a.top+20,right:a.right+40,bottom:a.bottom+20};assert_eq!(position(b,w,size,scale),Some((x+40,y+20)));assert!(x>=w.left&&x+(size as f64*1.5*scale).ceil()as i32<=w.right);assert!(position(Area{top:0,..a},w,size,scale).is_none());}}}
 #[test]fn every_window_side_is_outside_and_rejects_insufficient_space(){let work=Area{left:-1600,top:0,right:0,bottom:1000};let frame=Area{left:-1200,top:300,right:-500,bottom:700};for mode in ["sit","top","left","right","bottom"]{let(x,y)=position_for(frame,work,96,1.0,mode).unwrap();if mode=="left"{assert!(x<frame.left)}if mode=="right"||mode=="icon"{assert!(x+144>frame.right)}if mode=="top"{assert!(y<frame.top)}if mode=="bottom"{assert!(y+144>frame.bottom)}assert_eq!(position_for(Area{left:frame.left+20,right:frame.right+20,top:frame.top+10,bottom:frame.bottom+10},work,96,1.0,mode),Some((x+20,y+10)));}assert!(position_for(Area{left:work.left,..frame},work,96,1.0,"left").is_none());assert!(position_for(frame,work,96,1.0,"unknown").is_none());}
 #[test]fn first_row_icon_is_rejected_if_the_whole_hug_cannot_fit(){let work=Area{left:0,top:0,right:1920,bottom:1080};let icon=Area{left:12,top:8,right:60,bottom:56};assert!(position_for(icon,work,96,1.0,"icon").is_none());}
 #[test]fn icon_slot_is_the_picture_not_its_label(){let work=Area{left:0,top:0,right:1920,bottom:1080};let icon=Area{left:450,top:350,right:546,bottom:446};let target=position_for(icon,work,128,2.0,"icon").unwrap();let slot=icon_cutout(icon,target,2.0,"icon").unwrap();assert_eq!(slot[2]-slot[0],48.0);assert_eq!(slot[3]-slot[1],48.0);assert!((slot[0]*2.0+target.0 as f64-icon.left as f64).abs()<1.0);}
 #[test]fn transparent_padding_does_not_reject_a_visible_top_pose(){let work=Area{left:0,top:0,right:1920,bottom:1080};let frame=Area{left:200,top:60,right:1200,bottom:800};assert!(position_for(frame,work,96,1.0,"top").is_some(),"The head fits although the transparent canvas extends above the monitor");}
 #[test]fn nearest_side_projects_onto_the_pet_instead_of_fixed_forty_percent(){let frame=Area{left:300,top:200,right:1300,bottom:900};let work=Area{left:0,top:0,right:1920,bottom:1080};let size=96;let origin=(950,410);for mode in ["top","bottom","left","right"]{let along=nearest_along(frame,size,1.0,mode,origin);let target=position_along(frame,work,size,1.0,mode,along).unwrap();if matches!(mode,"top"|"bottom"){assert!((target.0-origin.0).abs()<=1)}else{assert!((target.1-origin.1).abs()<=1)}}}
 #[test]fn far_right_icon_can_be_hugged_from_left(){let work=Area{left:0,top:0,right:1920,bottom:1080};let icon=Area{left:1810,top:300,right:1906,bottom:396};assert!(position_for(icon,work,128,2.0,"icon").is_none());assert!(position_for(icon,work,128,2.0,"icon-left").is_some());}
 #[test]fn actual_icon_cutout_tracks_high_dpi_and_negative_coordinates(){let icon=Area{left:-240,top:800,right:-144,bottom:896};assert_eq!(icon_cutout(icon,(-400,750),2.0,"icon-left"),Some([80.0,25.0,128.0,73.0]));assert_eq!(icon_cutout(icon,(-400,750),2.0,"top"),None);}
 #[test]fn maximized_window_has_an_inside_header_grip(){let work=Area{left:0,top:0,right:1920,bottom:1040};assert!(position_for(work,work,96,1.0,"top-hang").is_some(),"A maximized window must not lose every attachable edge");}
 #[test]fn the_entire_embrace_fits_its_actual_icon_and_native_canvas(){let work=Area{left:0,top:0,right:1920,bottom:1080};let icon=Area{left:450,top:350,right:546,bottom:446};for mode in ["icon","icon-left"]{let(x,y)=position_for(icon,work,128,2.0,mode).unwrap();let e=crate::perch_bounds::icon(mode).unwrap();let(cx,cy)=((icon.left+icon.right)as f64/2.0,(icon.top+icon.bottom)as f64/2.0);assert!(cx+e[0]*96.0>=x as f64-1.0&&cx+e[2]*96.0<=x as f64+384.0+1.0,"The grip box, not a single outer paw, must fit horizontally");assert!(cy+e[1]*96.0>=y as f64-1.0&&cy+e[3]*96.0<=y as f64+384.0+1.0,"The full head and tail must fit vertically");}}
}
