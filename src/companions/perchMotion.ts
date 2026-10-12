import type {ThemeKey} from '../themes'
import type {FoxAction,FoxDirection,PetPreferences} from './types'
import type {PerchMode} from './perchGeometry'
export interface PerchMotion{id:number;mode:PerchMode;phase:'enter'|'hold'|'leave';startedAt:number;durationMs:number}
export interface PerchCue{id:number;mode:PerchMode;phase:string;direction?:FoxDirection;durationMs?:number}
interface State{dragging:boolean;perched?:boolean;attachmentMotion?:PerchMotion|null;home:{focus:boolean;preferences:PetPreferences}|null;gesture:FoxAction|null;act:(a:FoxAction,ms?:number)=>void}
interface Host{getState:()=>State;getTheme:()=>ThemeKey;preload:(theme:ThemeKey,mode:PerchMode)=>Promise<unknown>;face:(d:FoxDirection)=>void;update:(p:Partial<{exploring:boolean;perched:boolean;attachment:PerchMode|null;attachmentMotion:PerchMotion|null;attachmentCutout:[number,number,number,number]|null}>)=>void;ready:(id:number)=>Promise<unknown>;error:(e:unknown)=>void}
export function createPerchMotion(host:Host){
 let generation=0,active:number|undefined,finished=0,disposed=false
 const allowed=()=>{const s=host.getState(),p=s.home?.preferences;return !disposed&&!s.dragging&&!s.home?.focus&&p?.enabled&&p.desktopEnabled&&p.displayMode==='normal'}
 return{
  cancel(){disposed=true;generation++},
  async handle(cue:PerchCue){
   if(disposed)return
   if(cue.phase==='end'){
    if(active!==cue.id)return
    finished=Math.max(finished,cue.id);active=undefined;generation++
    const current=host.getState(),newerGrip=current.perched&&current.attachmentMotion?.id!==cue.id
    host.update(newerGrip?{exploring:false}:{exploring:false,perched:false,attachment:null,attachmentMotion:null,attachmentCutout:null})
    const s=host.getState();if(!s.dragging&&['walk','attention'].includes(s.gesture??''))s.act('idle',100)
    return
   }
   if(cue.id<=finished||!['top','top-hang','left','right','bottom','icon','icon-left','sit'].includes(cue.mode))return
   if(['enter','hold','leave','settle'].includes(cue.phase)&&active===undefined)active=cue.id
   if(cue.phase==='prepare'){
    const issued=++generation;active=cue.id;if(!allowed())return
    host.update({exploring:true});const p=host.getState().home!.preferences,theme=p.appearance==='follow'?host.getTheme():p.appearance
    try{await host.preload(theme,cue.mode);if(issued!==generation||!allowed())return;host.face(cue.direction??'right');host.getState().act('attention',750);await host.ready(cue.id)}catch(e){if(!disposed&&issued===generation){host.update({exploring:false});host.error(e)}}
    return
   }
   if(active!==cue.id||!allowed())return
   const s=host.getState()
   if(cue.phase==='settle'){host.update({exploring:false,perched:false,attachment:null,attachmentMotion:null,attachmentCutout:null});s.act('land',800);return}
   if(cue.phase==='walk'){host.update({exploring:true,perched:false,attachment:null,attachmentMotion:null,attachmentCutout:null});if(cue.direction)host.face(cue.direction);s.act('walk',(cue.durationMs??1000)+100)}
   else if(['enter','hold','leave'].includes(cue.phase)){
    s.act('idle',100)
    host.update({exploring:cue.phase!=='hold',perched:true,attachment:cue.mode,attachmentMotion:{id:cue.id,mode:cue.mode,phase:cue.phase as PerchMotion['phase'],startedAt:Date.now(),durationMs:cue.durationMs??440}})
   }
  },
 }
}
