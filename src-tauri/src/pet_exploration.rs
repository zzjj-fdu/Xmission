//! Pure nearby exploration rules; no desktop or GUI dependencies.
#[derive(Clone,Debug)]pub struct Candidate{pub key:String,pub distance:f64,pub free:bool}
pub struct Context{pub enabled:bool,pub desktop:bool,pub normal:bool,pub quiet:bool,pub focus:bool,pub busy:bool,pub typing:bool}
pub fn permitted(c:&Context)->bool{c.enabled&&c.desktop&&c.normal&&!c.quiet&&!c.focus&&!c.busy&&!c.typing}
pub fn weight(distance:f64,range:f64,age:Option<i64>)->f64{
 if !distance.is_finite()||!range.is_finite()||distance<0.0||range<=0.0||distance>range{return 0.0}
 let novelty=age.map(|ms|0.08+0.92*(ms.max(0)as f64/1800000.0).min(1.0)).unwrap_or(1.0);
 (0.05+0.95*(1.0-distance/range).powi(2))*novelty
}
pub fn choose(candidates:&[Candidate],recent:&[(String,i64)],now:i64,range:f64,sample:f64)->Option<usize>{
 let nearest=candidates.iter().filter(|c|c.free&&c.distance.is_finite()&&c.distance>=0.0&&c.distance<=range).map(|c|c.distance).reduce(f64::min)?;
 // Alternate nearby target kinds. A close window must not starve every icon;
 // keep the icon opportunity local rather than taking an excursion across town.
 let icon_turn=recent.last().is_none_or(|(key,_)|!key.starts_with("icon:"));
 let nearby_icon=candidates.iter().filter(|c|c.free&&c.key.starts_with("icon:")&&c.distance.is_finite()&&c.distance>=0.0&&c.distance<=range&&c.distance<=nearest+(range*0.4).clamp(64.0,128.0)).map(|c|c.distance).reduce(f64::min);
 let prefer_icons=icon_turn&&nearby_icon.is_some();let nearest=if prefer_icons{nearby_icon?}else{nearest};
 let neighbourhood=nearest+(range*0.2).clamp(48.0,80.0);
 let weights:Vec<f64>=candidates.iter().map(|c|if !c.free||c.distance>neighbourhood||(prefer_icons&&!c.key.starts_with("icon:")){0.0}else{
  let age=recent.iter().find(|(key,_)|key==&c.key).map(|(_,stamp)|now-*stamp);
  let alternatives=candidates.iter().filter(|other|other.key==c.key&&other.free).count().max(1);
  weight(c.distance,range,age)/alternatives as f64
 }).collect();
 let total: f64=weights.iter().sum();if total<=0.0||!sample.is_finite(){return None}
 let mut selected=sample.clamp(0.0,0.999999)*total;
 for(i,w)in weights.iter().enumerate(){if *w<=0.0{continue}if selected<*w{return Some(i)}selected-=w;}
 weights.iter().rposition(|w|*w>0.0)
}
#[derive(Default)]pub struct Clock{pub next_at:i64,pub recent:Vec<(String,i64)>}
impl Clock{pub fn new(now:i64)->Self{Self{next_at:now+12000,recent:vec![]}}pub fn visited(&mut self,key:String,now:i64,sample:f64){self.recent.retain(|(k,_)|k!=&key);self.recent.push((key,now));if self.recent.len()>8{self.recent.remove(0);}self.next_at=now+60000+(sample.clamp(0.0,1.0)*60000.0)as i64;}pub fn retry_later(&mut self,now:i64){self.next_at=now+15000;}pub fn interrupted(&mut self,now:i64){self.next_at=self.next_at.max(now+15000).min(now+120000);}}
#[cfg(test)]mod tests{
 use super::*;
 #[test]fn nearby_and_unfamiliar_have_more_weight(){assert!(weight(30.0,400.0,None)>weight(300.0,400.0,None));assert!(weight(80.0,400.0,None)>weight(80.0,400.0,Some(1000)));assert!(weight(80.0,400.0,Some(1800000))>weight(80.0,400.0,Some(1000)));assert_eq!(weight(401.0,400.0,None),0.0);assert_eq!(weight(f64::NAN,400.0,None),0.0);}
 #[test]fn occupied_and_out_of_range_never_selected(){let c=vec![Candidate{key:"covered".into(),distance:5.0,free:false},Candidate{key:"far".into(),distance:900.0,free:true},Candidate{key:"near".into(),distance:30.0,free:true}];for sample in [0.0,0.25,0.5,0.999,1.0]{assert_eq!(choose(&c,&[],1000,400.0,sample),Some(2));}assert_eq!(choose(&[],&[],0,400.0,0.5),None);}
 #[test]fn interaction_focus_quiet_and_typing_pause_exploration(){let mut c=Context{enabled:true,desktop:true,normal:true,quiet:false,focus:false,busy:false,typing:false};assert!(permitted(&c));c.busy=true;assert!(!permitted(&c));c.busy=false;c.focus=true;assert!(!permitted(&c));c.focus=false;c.quiet=true;assert!(!permitted(&c));c.quiet=false;c.typing=true;assert!(!permitted(&c));c.typing=false;c.normal=false;assert!(!permitted(&c));}
 #[test]fn recent_target_is_less_likely_and_visits_have_minutes_of_rest(){let c=vec![Candidate{key:"a".into(),distance:80.0,free:true},Candidate{key:"b".into(),distance:80.0,free:true}];let mut clock=Clock::new(1000);clock.visited("a".into(),2000,0.5);assert_eq!(choose(&c,&clock.recent,2500,400.0,0.2),Some(1));assert_eq!(clock.next_at,92000);for i in 0..20{clock.visited(i.to_string(),3000,0.0)}assert_eq!(clock.recent.len(),8);clock.retry_later(4000);assert_eq!(clock.next_at,19000);}
 #[test]fn ordinary_mouse_motion_is_not_a_typing_block(){let c=Context{enabled:true,desktop:true,normal:true,quiet:false,focus:false,busy:false,typing:false};assert!(permitted(&c),"Global mouse-idle time is unrelated to keyboard/care guards");}
 #[test]fn an_available_nearby_target_excludes_long_excursions(){let c=vec![Candidate{key:"near".into(),distance:40.0,free:true},Candidate{key:"far".into(),distance:280.0,free:true}];for sample in [0.1,0.7,0.99,0.99999]{assert_eq!(choose(&c,&[],0,320.0,sample),Some(0),"An idle visit should stay in the nearest neighbourhood");}}
 #[test]fn nearby_icons_get_a_turn_without_far_excursions(){let c=vec![Candidate{key:"window:1".into(),distance:20.0,free:true},Candidate{key:"icon:local".into(),distance:100.0,free:true},Candidate{key:"icon:far".into(),distance:300.0,free:true}];assert_eq!(choose(&c,&[],1000,320.0,0.01),Some(1),"An exposed nearby icon must not be perpetually starved by the same close window");let recent=vec![("icon:local".into(),900)];assert_eq!(choose(&c,&recent,1000,320.0,0.01),Some(0));}
}
