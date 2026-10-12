import {create} from 'zustand'
import {listen} from '@tauri-apps/api/event'
import {invoke} from '@tauri-apps/api/core'
import {getCompanionHome,updateCompanionPreferences} from '../api/companion'
import type {FoxAction,FoxActivity,FoxEmotion,PetHome,PetNotice,PetPreferences,PetFeedback} from '../companions/types'
import {normalizePetPreferences} from '../companions/types'
import {FOX_ACTIONS} from '../companions/behavior'
import type {PerchMotion} from '../companions/perchMotion'
type Beat={action:FoxAction;ms:number}
interface Store{
 home:PetHome|null;notice:PetNotice|null;loading:boolean;error:string;gesture:FoxAction|null;gestureUntil:number;gestureStarted:number;emotion:FoxEmotion;
 dragging:boolean;hovering:boolean;perched:boolean;attachment:'sit'|'top'|'top-hang'|'left'|'right'|'bottom'|'icon'|'icon-left'|null;paperPlaying:boolean;fetchPhase:'run'|'catch'|null;returnedTrip:string|null;tool:'stroke'|'brush'|null;clock:number;activity:FoxActivity;pose:FoxActivity;
 feedback:PetFeedback|null;pending:PetFeedback[];activityElapsed:Record<FoxActivity,number>;activitySince:number;
 exploring:boolean;attachmentMotion:PerchMotion|null;
 attachmentCutout:[number,number,number,number]|null;
 refresh:()=>Promise<void>;save:(patch:Partial<PetPreferences>)=>Promise<void>;act:(action:FoxAction,duration?:number)=>void;
 setActivity:(next:FoxActivity)=>void;reset:()=>void;acceptFeedback:(p:PetFeedback)=>void;flush:()=>void;playPaper:()=>void
}
let inFlight:Promise<void>|null=null,revision=0,timer:number|undefined,ticket=0
const received=new Set<string>()
export const useCompanionStore=create<Store>((set,get)=>{
 const beat=(action:FoxAction,ms=FOX_ACTIONS[action].duration||4500):Beat=>({action,ms})
 const run=(plan:Beat[],done:()=>void)=>{
  const token=++ticket;clearTimeout(timer)
  const advance=(i:number)=>{
   if(token!==ticket)return
   const b=plan[i];if(!b){set({gesture:null,gestureUntil:0,clock:Date.now()});done();return}
   set({gesture:b.action,gestureStarted:Date.now(),gestureUntil:Date.now()+b.ms,clock:Date.now(),emotion:b.action==='celebrate'||b.action==='milestone'||b.action==='pet'?'happy':b.action==='lift'||b.action==='lifted'?'surprised':'calm'})
   timer=window.setTimeout(()=>advance(i+1),b.ms)
  }
  advance(0)
 }
 const restore=()=>{
  const s=get(),target=s.activity
  if(target===s.pose){get().flush();return}
  const plan:Beat[]=[]
  if(s.pose==='focus')plan.push(beat('book-close'))
  else if(s.pose==='sleep')plan.push(beat('wake'))
  if(target==='focus')plan.push(beat('book-open'))
  else if(target==='sleep')plan.push(beat('sleep-down'))
  run(plan,()=>{set({pose:target,activitySince:Date.now()});if(get().activity!==target)restore();else get().flush()})
 }
 return{
 exploring:false,attachmentMotion:null,attachmentCutout:null,
 home:null,notice:null,loading:false,error:'',gesture:null,gestureUntil:0,gestureStarted:0,emotion:'calm',dragging:false,hovering:false,perched:false,attachment:null,paperPlaying:false,fetchPhase:null,returnedTrip:null,tool:null,clock:Date.now(),activity:'idle',pose:'idle',feedback:null,pending:[],activityElapsed:{idle:0,focus:0,sleep:0},activitySince:Date.now(),
 refresh:()=>{
  if(inFlight)return inFlight
  const started=revision;set({loading:!get().home})
  const request=getCompanionHome().then(home=>{if(started===revision){home={...home,preferences:normalizePetPreferences(home.preferences)};if(get().home&&get().home?.preferences.character!==home.preferences.character)get().reset();set({home,loading:false,error:'',clock:Date.now()})}})
  .catch(e=>{if(started===revision)set({loading:false,error:String(e)})}).finally(()=>{if(inFlight===request)inFlight=null})
  inFlight=request;return request
 },
 save:async patch=>{const previous=get().home?.preferences.character??'fox',preferences=normalizePetPreferences(await updateCompanionPreferences(patch));revision++;inFlight=null;if(previous!==preferences.character)get().reset();else set(s=>({home:s.home?{...s.home,preferences}:null,error:''}));await get().refresh()},
 reset:()=>{++ticket;clearTimeout(timer);set({exploring:false,attachmentMotion:null,attachment:null,attachmentCutout:null,perched:false,gesture:null,gestureUntil:0,gestureStarted:0,dragging:false,hovering:false,pose:'idle',activity:'idle',tool:null,paperPlaying:false,fetchPhase:null,feedback:null,pending:[],notice:null,returnedTrip:null,emotion:'calm',activityElapsed:{idle:0,focus:0,sleep:0},activitySince:Date.now()})},
 playPaper:()=>{
  const s=get()
  const p=s.home?.preferences
  if(!p?.enabled||!p.desktopEnabled||p.displayMode!=='normal'||s.home?.focus||s.home?.trip?.state==='away'||s.exploring||s.fetchPhase||!s.home?.growth?.paperSkill||s.gesture||s.dragging||s.hovering||s.perched||s.activity!=='idle')return
  set({paperPlaying:true})
  run([beat('game-turn',650),beat('game-wait',1000),beat('game-turn',650),beat('game-match',1200)],()=>{set({paperPlaying:false});restore()})
 },
 setActivity:activity=>{const s=get();if(s.activity===activity)return;if(!s.gesture&&s.pose!=='idle')set({activityElapsed:{...s.activityElapsed,[s.pose]:s.activityElapsed[s.pose]+Math.max(0,Date.now()-s.activitySince)}});set({activity});if(!get().gesture&&!get().dragging)restore()},
 act:(action,duration)=>{
  const s=get();
  if(s.dragging&&!['lift','lifted','land'].includes(action))return
  if(s.hovering&&['daily','attention','sit','stretch','rain','snow','wind','night','read-habit'].includes(action))return
  set({paperPlaying:false})
  if(!s.gesture&&s.pose!=='idle')set({activityElapsed:{...s.activityElapsed,[s.pose]:s.activityElapsed[s.pose]+Math.max(0,Date.now()-s.activitySince)}});
  if(action==='return'&&s.home?.trip?.id)set({returnedTrip:s.home.trip.id})
  const plan:Beat[]=[]
  const direct=!['idle','walk','attention','book-open','book-close','sleep-down','wake'].includes(action)
  if(direct&&s.pose==='focus')plan.push(beat('book-close',650))
  else if(direct&&s.pose==='sleep')plan.push(beat('wake',800))
  if(direct)set({pose:'idle'})
  if(action==='depart')plan.push(beat('bag-open',1200),beat('bag-close',800),beat('adjust-scarf',1200),beat('depart',800))
  else if(action==='read-habit')plan.push(beat('book-open'),beat('focus',duration??8000),beat('book-close'))
  else if(action==='game-match')plan.push(beat('game-match',1800))
  else if(action==='land')plan.push(beat('land'),beat('adjust-scarf'))
  else if(action==='lifted')plan.push(beat('lift'),beat('lifted',3600000))
  else if(action==='remind')plan.push(beat('bag-open'),beat('remind',duration??10000),beat('bag-close'))
  else if(action==='bag-open')plan.push(beat('bag-open'),beat('remind',700),beat('bag-close'))
  else plan.push(beat(action,Math.min(3600000,Math.max(100,duration??(FOX_ACTIONS[action].duration||4500)))))
  run(plan,restore)
 },
 acceptFeedback:p=>{if(!p?.batchId||received.has(p.batchId))return;received.add(p.batchId);if(received.size>256)received.delete(received.values().next().value!);set(s=>({pending:[...s.pending,p]}));get().flush()},
 flush:()=>{
  const s=get();if(!s.pending.length||s.gesture||s.dragging||s.hovering||s.exploring||s.perched||s.activity!=='idle'||!s.home?.preferences.enabled||!s.home.preferences.proactive)return
  const batch=s.pending;set({pending:[],feedback:batch.find(p=>p.kind==='main')??batch[0]})
  get().act(batch.some(p=>p.kind==='main')?'milestone':batch.some(p=>p.kind==='completed')?'daily':'bag-open')
 },
 }
})
let users=0,dispose:(()=>void)|null=null
export function startCompanionStore(){
 users++
 if(users===1){
  let cancelled=false;const stops:Array<()=>void>=[]
  const sub=<T,>(name:string,cb:(p:T)=>void)=>void listen<T>(name,e=>cb(e.payload)).then(fn=>{if(cancelled)fn();else stops.push(fn)}).catch(()=>{})
  sub('companion-changed',()=>{revision++;inFlight=null;void useCompanionStore.getState().refresh()})
  let attachmentRevision=0
  sub('companion-perch-motion',()=>{attachmentRevision++})
  type AttachmentView={mode:Store['attachment'];cutout:Store['attachmentCutout']}
  const applyAttachment=(value:AttachmentView|Store['attachment'])=>{const attachment=typeof value==='object'&&value?value.mode:value as Store['attachment'],cutout=typeof value==='object'&&value?value.cutout:null;useCompanionStore.setState({attachment,perched:!!attachment,attachmentCutout:cutout,attachmentMotion:null})}
  sub<boolean>('companion-perch',()=>{attachmentRevision++})
  sub<AttachmentView|Store['attachment']>('companion-attachment',value=>{attachmentRevision++;applyAttachment(value)})
  const attachmentIssued=attachmentRevision
  void invoke<AttachmentView|Store['attachment']>('get_companion_attachment_mode').then(value=>{if(!cancelled&&attachmentRevision===attachmentIssued)applyAttachment(value)}).catch(()=>{})
  let changeTimer:number|undefined
  const changed=()=>{revision++;inFlight=null;clearTimeout(changeTimer);changeTimer=window.setTimeout(()=>void useCompanionStore.getState().refresh(),80)}
  sub('tasks-changed',changed);sub('steps-changed',changed)
  sub<{action:FoxAction;duration?:number}>('companion-gesture',p=>{const s=useCompanionStore.getState();if(!p||!Object.prototype.hasOwnProperty.call(FOX_ACTIONS,p.action))return;if(p.action==='return'&&s.home?.trip?.state==='returned'&&s.returnedTrip===s.home.trip.id)return;s.act(p.action,p.duration)})
  sub<PetFeedback>('companion-feedback',p=>useCompanionStore.getState().acceptFeedback(p))
  let toolTimer:number|undefined,noticeTimer:number|undefined
  sub<{tool:'stroke'|'brush'|null}>('companion-tool',p=>{clearTimeout(toolTimer);const tool=p?.tool==='stroke'||p?.tool==='brush'?p.tool:null;useCompanionStore.setState({tool});if(tool)toolTimer=window.setTimeout(()=>useCompanionStore.setState({tool:null}),45000)})
  sub<PetNotice>('companion-reminder',notice=>{clearTimeout(noticeTimer);useCompanionStore.setState({notice});const s=useCompanionStore.getState();if(!s.dragging&&!s.hovering&&s.activity==='idle'&&!s.gesture){if(!notice.message)s.act('remind',12000);else if(notice.tab)s.act('bag-open')}noticeTimer=window.setTimeout(()=>useCompanionStore.setState({notice:null}),18000)})
  sub<{xpTotal:number}>('wallet-updated',p=>{const s=useCompanionStore.getState();if(s.home)useCompanionStore.setState({home:{...s.home,xpTotal:p.xpTotal}})})
  let focusId:string|null=null
  sub<{state:string;id?:string}|null>('pomodoro-changed',p=>{if(p?.id&&p.id!==focusId){focusId=p.id;useCompanionStore.setState(s=>({activityElapsed:{...s.activityElapsed,focus:0},activitySince:Date.now()}))}useCompanionStore.setState(s=>({home:s.home?{...s.home,focus:p?.state==='running'}:null}))})
  const clock=window.setInterval(()=>{if(!document.hidden)useCompanionStore.setState({clock:Date.now()})},15000)
  const refresh=window.setInterval(()=>{if(!document.hidden)void useCompanionStore.getState().refresh()},30000)
  const visible=()=>{if(!document.hidden){useCompanionStore.setState({clock:Date.now()});void useCompanionStore.getState().refresh()}}
  document.addEventListener('visibilitychange',visible)
  dispose=()=>{cancelled=true;stops.forEach(fn=>fn());clearInterval(clock);clearInterval(refresh);clearTimeout(timer);++ticket;clearTimeout(noticeTimer);clearTimeout(toolTimer);clearTimeout(changeTimer);document.removeEventListener('visibilitychange',visible)}
  void useCompanionStore.getState().refresh()
 }
 let stopped=false;return()=>{if(stopped)return;stopped=true;if(--users===0){dispose?.();dispose=null}}
}
