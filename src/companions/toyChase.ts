import type {ThemeKey} from '../themes'
import type {FoxAction,FoxDirection,PetPreferences} from './types'

export interface ToyChaseCue{phase:string;id?:number;direction?:FoxDirection;durationMs?:number}
interface ChaseState{dragging:boolean;gesture:FoxAction|null;home:{focus:boolean;preferences:PetPreferences}|null;act:(action:FoxAction,duration?:number)=>void}
interface ChaseHost{getState:()=>ChaseState;getTheme:()=>ThemeKey;preload:(theme:ThemeKey,action:FoxAction,direction:FoxDirection)=>Promise<unknown>;face:(direction:FoxDirection)=>void;setPhase:(phase:'run'|'catch'|null)=>void;ready:(id:number)=>Promise<unknown>;onError:(error:unknown)=>void}
/** A preload belongs to one native chase ticket; later cancellation invalidates it. */
export function createToyChase(host:ChaseHost){
 let generation=0,active:number|undefined,disposed=false
 const canRun=()=>{const s=host.getState(),p=s.home?.preferences;return !disposed&&!s.dragging&&!s.home?.focus&&!!p?.enabled&&p.desktopEnabled&&p.displayMode==='normal'}
 return{
  cancel(){disposed=true;generation++;active=undefined},
  async handle(cue:ToyChaseCue){
   if(disposed)return
   if(cue.phase==='end'){
    if(cue.id!==undefined&&active!==cue.id)return
    generation++;active=undefined;host.setPhase(null)
    const s=host.getState();if(!s.dragging&&['run-start','run','run-stop','toy-catch'].includes(s.gesture??''))s.act('idle',100)
    return
   }
   if(cue.phase==='prepare'){
    const issued=++generation;active=cue.id
    if(cue.id===undefined||!canRun())return
    const p=host.getState().home!.preferences,theme=p.appearance==='follow'?host.getTheme():p.appearance,direction=cue.direction??'right'
    try{
     await Promise.all((['run-start','run','run-stop','toy-catch'] as FoxAction[]).map(a=>host.preload(theme,a,direction)))
     if(issued!==generation||!canRun())return
     host.face(direction);host.setPhase('run');host.getState().act('run-start',(cue.durationMs??320)+80)
     await host.ready(cue.id)
    }catch(error){if(!disposed&&issued===generation)host.onError(error)}
    return
   }
   if(cue.id!==active||active===undefined||!canRun())return
   const s=host.getState()
   if(cue.phase==='run'){host.setPhase('run');s.act('run',(cue.durationMs??1000)+100)}
   else if(cue.phase==='brake')s.act('run-stop',(cue.durationMs??240)+80)
   else if(cue.phase==='catch'){host.setPhase('catch');s.act('toy-catch',cue.durationMs??1100)}
  },
 }
}
