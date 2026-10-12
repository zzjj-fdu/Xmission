//! Shell returns an icon size in logical pixels, but item positions are view pixels.
pub(super) fn picture_side(logical:i32,dpi:u32)->Option<i32>{
 if !(16..=512).contains(&logical)||!(96..=768).contains(&dpi){return None}
 Some((logical as f64*dpi as f64/96.0).round()as i32)
}
pub(super) fn visible_rect(frame:crate::pet_dock::Area,width:u32,height:u32,bgra:&[u8])->crate::pet_dock::Area{
 if width==0||height==0||width>512||height>512||frame.right<=frame.left||frame.bottom<=frame.top||bgra.len()!=width as usize*height as usize*4{return frame}
 let(mut l,mut t,mut r,mut b)=(width,height,0,0);
 for y in 0..height{for x in 0..width{if bgra[((y*width+x)*4+3)as usize]>=64{l=l.min(x);t=t.min(y);r=r.max(x+1);b=b.max(y+1);}}}
 if l>=r||t>=b{return frame} // Legacy icons can have no alpha channel.
 let(w,h)=((frame.right-frame.left)as i64,(frame.bottom-frame.top)as i64);
 crate::pet_dock::Area{left:frame.left+(l as i64*w/width as i64)as i32,top:frame.top+(t as i64*h/height as i64)as i32,right:frame.left+((r as i64*w+width as i64-1)/width as i64)as i32,bottom:frame.top+((b as i64*h+height as i64-1)/height as i64)as i32}
}
#[cfg(test)]mod tests{
 use super::*;
 #[test]fn scale_picture_not_already_physical_item_position(){
  assert_eq!(picture_side(48,96),Some(48));
  assert_eq!(picture_side(48,144),Some(72));
  assert_eq!(picture_side(48,192),Some(96));
  assert_eq!(picture_side(48,240),Some(120));
 }
 #[test]fn invalid_metrics_are_not_guessed(){assert_eq!(picture_side(0,192),None);assert_eq!(picture_side(48,0),None);}
 #[test]fn paws_use_opaque_icon_edges_not_transparent_bitmap_padding(){let frame=crate::pet_dock::Area{left:100,top:200,right:196,bottom:296};let mut pixels=vec![0u8;48*48*4];for y in 6..42{for x in 6..42{pixels[(y*48+x)*4+3]=255;}}pixels[(2*48+2)*4+3]=8;let r=visible_rect(frame,48,48,&pixels);assert_eq!([r.left,r.top,r.right,r.bottom],[112,212,184,284]);}
 #[test]fn old_icons_without_alpha_retain_known_shell_geometry(){let f=crate::pet_dock::Area{left:-200,top:100,right:-104,bottom:196};let r=visible_rect(f,48,48,&vec![0u8;48*48*4]);assert_eq!([r.left,r.top,r.right,r.bottom],[-200,100,-104,196]);}
}
