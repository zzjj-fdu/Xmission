//! Build sorted, non-overlapping pixel bands for a small native alpha region.
//! No window calls or locks: the caller applies one completed region on the UI thread.
pub fn rectangles(width:u32,height:u32,source_width:u32,source_height:u32,spans:&[[u32;3]])->Vec<[i32;4]> {
 if width==0||height==0||source_width==0||source_height==0||width>2048||height>2048{return Vec::new()}
 let mut rows=vec![Vec::<(i32,i32)>::new();source_height as usize];
 for &[y,x,length] in spans{
  if y>=source_height||x>=source_width||length==0{continue}
  let right=x.saturating_add(length).min(source_width);
  let l=(x as u64*width as u64/source_width as u64)as i32;
  let r=(right as u64*width as u64).div_ceil(source_width as u64)as i32;
  if l<r{rows[y as usize].push((l,r.min(width as i32)));}
 }
 for row in &mut rows{
  row.sort_unstable();let mut merged=Vec::<(i32,i32)>::new();
  for &(l,r) in row.iter(){if let Some(last)=merged.last_mut().filter(|last|l<=last.1){last.1=last.1.max(r)}else{merged.push((l,r))}}
  *row=merged;
 }
 let mut out=Vec::new();let mut prior=Vec::new();let mut start=0;
 for y in 0..=height{
  let row=if y==height{&[][..]}else{rows[(y as u64*source_height as u64/height as u64)as usize].as_slice()};
  if row!=prior.as_slice(){
   out.extend(prior.iter().map(|&(l,r)|[l,start,r,y as i32]));
   prior=row.to_vec();start=y as i32;
  }
 }
 out
}
#[cfg(test)]mod tests{
 use super::*;
 #[test]fn merges_opaque_bands_without_double_scaling(){let r=rectangles(144,144,192,192,&(50..100).map(|y|[y,160,32]).collect::<Vec<_>>());assert_eq!(r,vec![[120,38,144,75]]);}
 #[test]fn left_and_right_peeks_retain_their_own_edge(){let l=rectangles(96,96,192,192,&[[60,0,72]]);let r=rectangles(96,96,192,192,&[[60,120,72]]);assert_eq!(l,vec![[0,30,36,31]]);assert_eq!(r,vec![[60,30,96,31]]);}
 #[test]fn odd_dpi_rows_are_non_overlapping_sorted_bands(){let r=rectangles(121,121,192,192,&[[50,1,8],[50,7,10],[51,1,16],[52,80,12]]);for (i,a) in r.iter().enumerate(){assert!(a[0]<a[2]&&a[1]<a[3]);for b in &r[i+1..]{assert!(a[3]<=b[1]||a[2]<=b[0]||b[2]<=a[0]);}}}
}

