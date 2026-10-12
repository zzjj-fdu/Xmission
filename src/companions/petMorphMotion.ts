import type {FoxAction} from './types'
import type {PetMorph} from './usePetMorph'
const smooth=(n:number)=>{const t=Math.min(1,Math.max(0,n));return t*t*(3-2*t)}
export const PET_MORPH_OUT_MS=1800
export const PET_MORPH_IN_MS=2450
/** One clock drives the sprite poses, suspension, light, and native window handoff. */
export function petMorphMotion(morph:PetMorph,now:number){
 const reduced=morph.durationMs<=200,out=morph.to==='mini',total=out?PET_MORPH_OUT_MS:PET_MORPH_IN_MS
 const progress=Math.min(1,Math.max(0,(now-morph.startedAt)/morph.durationMs)),t=progress*total
 let action:FoxAction='lifted',start=out?500:0,duration=220,rise=1,glow=0
 if(reduced)return{action:'idle' as FoxAction,startedAt:morph.startedAt,durationMs:morph.durationMs,rise:0,light:Math.sin(Math.PI*progress)*.6,foxAlpha:out?1-progress:progress,ballAlpha:out?progress:1-progress,sway:0,thread:0,finished:progress===1}
 if(out){
  if(t<500){action='lift';start=0;duration=500;rise=smooth(t/500)}
  glow=Math.max(0,(t-720)/1080)
 }else{
  glow=Math.min(1,t/1080)
  if(t>=1300&&t<1800)rise=1-((t-1300)/500)**2
  if(t>=1800){action='land';start=1800;duration=650;rise=0}
 }
 const fox=smooth((glow-.2)/.65),ball=smooth((glow-.25)/.65)
 return{action,startedAt:morph.startedAt+start/total*morph.durationMs,durationMs:duration/total*morph.durationMs,rise,
  light:Math.sin(Math.PI*glow),foxAlpha:out?1-fox:fox,ballAlpha:out?ball:1-ball,
  sway:action==='lifted'?Math.sin(t/210)*rise:0,thread:rise*(out?1-fox:fox),finished:progress===1}
}
