// Generated from original alpha bounds and paw anchors; scripts/export-perch-bounds.cjs.
pub const ICON_SLOT_RATIO:f64=0.422726856;
pub fn visible(mode:&str)->Option<[f64;4]>{match mode{
 "top"=>Some([-0.387136,-0.536941,0.387136,0.008968]),
 "top-hang"=>Some([-0.401334,-0.082579,0.401334,1.140950]),
 "left"=>Some([-0.836116,-0.331260,0.089951,0.707662]),
 "right"=>Some([-0.089951,-0.331260,0.836116,0.707662]),
 "bottom"=>Some([-0.401334,-0.082579,0.401334,1.140950]),
 "icon"=>Some([-0.162758,-0.647063,0.658972,0.319959]),
 "icon-left"=>Some([-0.658972,-0.647063,0.162758,0.319959]),
 "sit"=>Some([-0.56,-0.97,0.56,0.0]),_=>None}}

pub fn icon(mode:&str)->Option<[f64;4]>{match mode{
 "icon"=>Some([-0.519313,-1.721030,1.794872,0.907725]),
 "icon-left"=>Some([-1.794872,-1.721030,0.519313,0.907725]),
 _=>None}}
