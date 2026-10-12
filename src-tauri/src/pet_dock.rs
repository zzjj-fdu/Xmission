//! Pure geometry and timing for QQ-style edge hiding; coordinates are physical pixels.
#[derive(Clone, Copy, Debug, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "lowercase")]
pub enum Side { Left, Right }
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct Area { pub left:i32, pub top:i32, pub right:i32, pub bottom:i32 }
pub fn movement_margin(width:i32,scale:f64)->i32 {((width as f64/1.5*0.125).min(10.0*scale)).round().max(0.0)as i32}
pub fn clamp_pet(area:Area,x:i32,y:i32,width:i32,height:i32,scale:f64)->(i32,i32){
 let margin=movement_margin(width,scale);let bottom=margin.min((6.0*scale).round()as i32);
 (x.clamp(area.left-margin,(area.right-width+margin).max(area.left-margin)),y.clamp(area.top-margin,(area.bottom-height+bottom).max(area.top-margin)))
}
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct View { pub side:Option<Side>, pub hidden:bool, pub transitioning:bool, pub folded:bool }
#[derive(Debug, Default)]
pub struct Dock {
 pub side:Option<Side>, pub area:Area, pub width:i32, pub height:i32,
 pub y:i32, pub peek:i32, margin:i32, amount:f64, from:f64, target:f64, began:i64,
 pub last_seen:i64, hover_since:Option<i64>, pub reduced:bool,
}
impl Dock {
 pub fn armed(&self)->bool { self.side.is_some() }
 pub fn view(&self)->View { View{side:self.side,hidden:self.amount>=0.999,transitioning:(self.amount-self.target).abs()>0.001,folded:self.target>=0.5} }
 pub fn anchor(&self)->(i32,i32) {
  (match self.side {Some(Side::Left)=>self.area.left-self.margin,Some(Side::Right)=>self.area.right-self.width+self.margin,None=>self.area.left},self.y)
 }
 pub fn position(&self)->(i32,i32) {
  let (x,y)=self.anchor();let travel=self.width-self.peek;
  (x+(travel as f64*self.amount*if self.side==Some(Side::Left){-1.0}else{1.0}).round()as i32,y)
 }
 #[cfg(test)]
 pub fn offset(&self)->i32 {self.position().0-self.anchor().0}
 #[cfg(test)]
 pub fn clip(&self)->Option<[i32;4]> {
  self.side?;
  let (x,y)=self.position();
  Some([(self.area.left-x).max(0),(self.area.top-y).max(0),(self.area.right-x).min(self.width),(self.area.bottom-y).min(self.height)])
 }
 pub fn arm(&mut self,side:Side,area:Area,width:i32,height:i32,y:i32,scale:f64,reduced:bool,now:i64) {
  self.side=Some(side);self.amount=0.0;self.from=0.0;self.target=0.0;
  self.resize(area,width,height,y,scale,reduced);self.last_seen=now;self.hover_since=None;
 }
 pub fn resize(&mut self,area:Area,width:i32,height:i32,y:i32,scale:f64,reduced:bool) {
  self.area=area;self.width=width.max(1);self.height=height.max(1);
  self.margin=movement_margin(width,scale);self.y=clamp_pet(area,area.left,y,width,height,scale).1;
  self.peek=((width as f64*0.55).max(24.0*scale)).round().min(width as f64)as i32;
  self.reduced=reduced;
 }
 pub fn cancel(&mut self)->Option<(i32,i32)> {
  let anchor=self.side.map(|_|self.anchor());self.side=None;self.amount=0.0;self.target=0.0;self.hover_since=None;anchor
 }
 fn sample(&mut self,now:i64) {
  if self.reduced{self.amount=self.target;return}
  let t=((now-self.began)as f64/280.0).clamp(0.0,1.0);
  // Smooth endpoints, without overshoot or a spring that nudges the window off screen.
  self.amount=self.from+(self.target-self.from)*(t*t*(3.0-2.0*t));
 }
 fn aim(&mut self,target:f64,now:i64) {
  if self.target==target{return}
  self.from=self.amount;self.target=target;self.began=now;
  if self.reduced{self.amount=target;}
 }
 pub fn reveal(&mut self,now:i64,immediate:bool) {
  if !self.armed(){return}
  self.sample(now);self.last_seen=now;self.aim(0.0,now);
  if immediate{self.amount=0.0;self.from=0.0;}
 }
 pub fn tick(&mut self,now:i64,cursor:(f64,f64),blocked:bool,scale:f64) {
  if !self.armed(){return}
  self.sample(now);
  let (x,y)=self.position();let pad=4.0*scale;
  let inside=cursor.0>=(x.max(self.area.left)as f64-pad)&&cursor.0<=(x+self.width).min(self.area.right)as f64+pad
   &&cursor.1>=y as f64-pad&&cursor.1<=(y+self.height)as f64+pad;
  if blocked{self.last_seen=now;self.hover_since=None;self.aim(0.0,now);}
  else if inside {
   self.last_seen=now;
   if self.target==1.0 {
    let since=*self.hover_since.get_or_insert(now);
    if now-since>=120{self.aim(0.0,now);}
   }else{self.hover_since=None;}
  }else {
   self.hover_since=None;
   if now-self.last_seen>=1200{self.aim(1.0,now);}
  }
 }
}
pub fn nearest_side(area:Area,x:i32,width:i32,scale:f64)->Option<Side> {
 let left=(x-area.left).abs();let right=(area.right-x-width).abs();
 let threshold=(12.0*scale).round()as i32;
 if left<=threshold&&left<=right{Some(Side::Left)}else if right<=threshold{Some(Side::Right)}else{None}
}

#[cfg(test)]
mod tests {
 use super::*;
 fn area()->Area{Area{left:0,top:0,right:1920,bottom:1040}}
 fn pet(side:Side)->Dock{let mut p=Dock::default();p.arm(side,area(),96,96,800,1.0,false,0);p}
 #[test]fn waits_then_slides_and_reveals_without_changing_anchor(){
  let mut p=pet(Side::Right);
  p.tick(1199,(800.0,400.0),false,1.0);assert_eq!(p.position(),(1832,800));
  p.tick(1200,(800.0,400.0),false,1.0);assert!(p.view().transitioning);
  p.tick(1480,(800.0,400.0),false,1.0);assert!(p.view().hidden);assert_eq!(p.position(),(1875,800));assert_eq!(p.clip(),Some([0,0,45,96]));
  p.tick(1500,(1918.0,840.0),false,1.0);assert!(p.view().hidden);
  p.tick(1620,(1918.0,840.0),false,1.0);assert!(p.view().transitioning);
  p.tick(1900,(1880.0,840.0),false,1.0);assert_eq!(p.position(),(1832,800));assert!(!p.view().hidden);
  p.tick(3100,(800.0,400.0),false,1.0);p.tick(3380,(800.0,400.0),false,1.0);assert!(p.view().hidden);
 }
 #[test]fn left_edge_on_negative_monitor_is_clipped_to_its_own_screen(){
  let a=Area{left:-1920,top:-100,right:0,bottom:980};let mut p=Dock::default();
  p.arm(Side::Left,a,144,144,970,1.5,false,0);
  p.tick(1200,(-500.0,50.0),false,1.5);p.tick(1480,(-500.0,50.0),false,1.5);
  assert_eq!(p.anchor(),(-1932,845));assert_eq!(p.position(),(-1997,845));assert_eq!(p.clip(),Some([77,0,144,135]));
  assert_eq!(nearest_side(a,-1910,144,1.5),Some(Side::Left));
  assert_eq!(nearest_side(a,-168,144,1.5),None);
 }
 #[test]fn menus_and_contact_hold_the_pet_open(){
  let mut p=pet(Side::Right);
  p.tick(9000,(800.0,400.0),true,1.0);assert_eq!(p.position(),p.anchor());
  p.tick(10199,(800.0,400.0),false,1.0);assert!(!p.view().transitioning);
  p.tick(10200,(800.0,400.0),false,1.0);assert!(p.view().transitioning);
  p.tick(10300,(800.0,400.0),true,1.0);p.tick(10580,(800.0,400.0),true,1.0);
  assert_eq!(p.position(),p.anchor());
 }
 #[test]fn incidental_hover_entries_need_continuous_dwell(){
  let mut p=pet(Side::Right);
  p.tick(1200,(800.0,400.0),false,1.0);p.tick(1480,(800.0,400.0),false,1.0);
  let held=p.position();
  for n in 0..20{
   let now=2000+n*300;
   p.tick(now,(1918.0,840.0),false,1.0);
   p.tick(now+80,(800.0,400.0),false,1.0);
   assert!(p.view().hidden);assert_eq!(p.position(),held);
  }
  p.tick(9000,(1918.0,840.0),false,1.0);p.tick(9119,(1918.0,840.0),false,1.0);assert!(p.view().hidden);
  p.tick(9120,(1918.0,840.0),false,1.0);assert!(p.view().transitioning);assert!(!p.view().folded);
 }
 #[test]fn geometry_refresh_does_not_restart_tucked_pose(){
  for side in [Side::Left,Side::Right]{
   let mut p=pet(side);p.tick(1200,(800.0,400.0),false,1.0);p.tick(1480,(800.0,400.0),false,1.0);
   let held=p.position();
   for now in (2000..32000).step_by(2000){p.resize(area(),96,96,800,1.0,false);p.tick(now,(800.0,400.0),false,1.0);assert_eq!(p.position(),held);assert!(p.view().hidden);assert!(!p.view().transitioning);}
  }
 }
 #[test]fn transparent_padding_can_reach_closer_to_all_edges(){
  let a=area();assert_eq!(clamp_pet(a,-100,-100,144,144,1.0),(-10,-10));
  assert_eq!(clamp_pet(a,3000,3000,144,144,1.0),(1786,902));
  assert_eq!(movement_margin(96,1.0),8);assert_eq!(movement_margin(288,2.0),20);
  let mut p=Dock::default();p.arm(Side::Left,a,144,144,-10,1.0,false,0);assert_eq!(p.anchor(),(-10,-10));
 }
 #[test]fn closing_or_dragging_cancels_every_pending_fold(){
  let mut p=pet(Side::Right);p.tick(1200,(800.0,400.0),false,1.0);p.tick(1300,(800.0,400.0),false,1.0);
  assert_eq!(p.cancel(),Some((1832,800)));
  p.tick(60000,(1919.0,840.0),false,1.0);assert_eq!(p.view(),View::default());assert_eq!(p.clip(),None);
 }
 #[test]fn reduced_motion_stays_at_the_endpoint(){
  let mut p=pet(Side::Left);p.reduced=true;
  p.tick(1200,(800.0,400.0),false,1.0);assert!(p.view().hidden);
  p.tick(1300,(800.0,400.0),false,1.0);assert!(p.view().hidden);assert!(!p.view().transitioning);
  p.reveal(1301,true);p.tick(1302,(800.0,400.0),false,1.0);assert_eq!(p.position(),p.anchor());
 }
 #[test]fn switching_sizes_retains_y_and_visible_strip(){
  let mut p=pet(Side::Right);p.tick(1200,(800.0,400.0),false,1.0);p.tick(1480,(800.0,400.0),false,1.0);
  p.resize(area(),128,128,800,1.0,false);assert_eq!(p.anchor(),(1802,800));assert_eq!(p.position(),(1860,800));assert_eq!(p.clip(),Some([0,0,60,128]));
 }
 #[test]fn screen_sides_never_swap_on_a_second_monitor(){
  let a=Area{left:1920,top:0,right:3840,bottom:1440};
  assert_eq!(nearest_side(a,1920,144,1.5),Some(Side::Left));
  assert_eq!(nearest_side(a,3696,144,1.5),Some(Side::Right));
  for side in [Side::Left,Side::Right]{let mut p=Dock::default();p.arm(side,a,144,144,300,1.5,false,0);p.tick(1200,(2000.0,900.0),false,1.5);p.tick(1480,(2000.0,900.0),false,1.5);assert_eq!(p.offset().signum(),if side==Side::Left{-1}else{1});}
 }
}
