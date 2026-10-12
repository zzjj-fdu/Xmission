import { StrictMode,useEffect,useRef,useState } from 'react'
import { createRoot } from 'react-dom/client'
import { invoke } from '@tauri-apps/api/core'
import { getCurrentWindow } from '@tauri-apps/api/window'
import { listen } from '@tauri-apps/api/event'
import { PetSurface } from './companions/PetSurface'
import { usePetSound } from './companions/usePetSound'
import { usePetDock } from './companions/usePetDock'
import { usePetMorph } from './companions/usePetMorph'
import { usePetAttention } from './companions/usePetAttention'
import { useFox } from './companions/useFox'
import { preloadCompanionAction,preloadCompanionPerch } from './companions/CompanionSprite'
import {createPerchMotion,type PerchCue} from './companions/perchMotion'
import { PetMenu } from './companions/PetMenu'
import { PetSpeechCard } from './companions/PetSpeechCard'
import { PetDesktopInput } from './companions/PetDesktopInput'
import { PetDesktopToy } from './companions/PetDesktopToy'
import {createToyChase,type ToyChaseCue} from './companions/toyChase'
import { solarScenePhase } from './scenes/environment'
import { useSceneSession } from './store/sceneSession'
import { useSceneWeatherStore } from './store/sceneWeather'
import { useCompanionStore } from './store/companion'
import { openCompanionHome } from './api/companion'
import { quietHoursNow } from './companions/behavior'
import type { PetNotice } from './companions/types'
import './index.css'
import './companions/companion.css'
document.documentElement.classList.add('xm-pet-desktop')
document.body.classList.add('xm-pet-desktop')
document.documentElement.dataset.xmMotion='full'
function DesktopFox(){
 const pet=useFox(),dock=usePetDock(),morph=usePetMorph(pet.preferences.displayMode),theme=pet.theme,{direction,setDirection,glance}=usePetAttention(pet.animated&&!pet.perched&&!dock.side&&morph?.stage!=='start')
 usePetSound(pet)
 const docking=useRef(dock);docking.current=dock
 useEffect(()=>{if(pet.animated)void Promise.all([preloadCompanionAction(theme,'walk','right'),preloadCompanionAction(theme,'walk','left'),preloadCompanionAction(theme,'idle','right'),preloadCompanionAction(theme,'idle','left'),preloadCompanionAction(theme,'edge-left','front'),preloadCompanionAction(theme,'edge-right','front'),preloadCompanionAction(theme,'dock-left'),preloadCompanionAction(theme,'dock-right'),preloadCompanionAction(theme,'undock-left'),preloadCompanionAction(theme,'undock-right')]).catch(error=>useCompanionStore.setState({error:String(error)}))},[theme,pet.animated,pet.preferences.character])
 const latestAction=useRef(pet.action);latestAction.current=pet.action
 const mounted=useRef(true)
 useEffect(()=>{
   mounted.current=true;void useSceneWeatherStore.getState().hydrate()
   let disposed=false;const unlisteners:Array<()=>void>=[]
   let positionTimer:number|undefined
   if(!navigator.userAgent.includes('Windows'))void getCurrentWindow().onMoved(({payload})=>{
     if(docking.current.side)return
     const userPlaced=!walking.current
     clearTimeout(positionTimer);positionTimer=window.setTimeout(()=>void invoke('save_companion_position',{x:payload.x,y:payload.y,userPlaced}).catch(()=>{}),250)
   }).then(fn=>{if(disposed)fn();else unlisteners.push(fn)}).catch(()=>{})
   return()=>{disposed=true;mounted.current=false;unlisteners.forEach(fn=>fn());clearTimeout(positionTimer)}
 },[])
 const walking=useRef(false),motionAllowed=useRef(pet.animated);motionAllowed.current=pet.animated&&morph?.stage!=='start'
 const doWalk=useRef<(manual:boolean)=>Promise<void>>(async()=>{})
 doWalk.current=async manual=>{
   const state=useCompanionStore.getState(),p=state.home?.preferences
   if(docking.current.side||walking.current||state.exploring||state.perched||(state.dragging||state.hovering)||document.hidden||!p||p.displayMode!=='normal'||state.home?.focus||state.home?.trip?.state==='away'||!motionAllowed.current||(!manual&&(quietHoursNow(p,Date.now())||state.tool||latestAction.current!=='idle')))return
   walking.current=true
   try{
     const plan=await invoke<{distance:number;durationMs:number}>('prepare_companion_walk',{preferRight:Math.random()<.5,manual})
     const facing=plan.distance<0?'left':'right'
     const activeTheme=p.appearance==='follow'?theme:p.appearance
     await preloadCompanionAction(activeTheme,'walk',facing,p.character)
     const current=useCompanionStore.getState(),prefs=current.home?.preferences
     if(prefs?.character!==p.character||current.dragging||current.hovering||current.tool||current.home?.focus||current.home?.trip?.state==='away'||!prefs?.enabled||!prefs.desktopEnabled||prefs.displayMode!=='normal'||!motionAllowed.current||!mounted.current||(!manual&&(current.gesture||quietHoursNow(prefs,Date.now()))))return
     setDirection(facing);useCompanionStore.getState().act('walk',plan.durationMs)
     await invoke('wander_companion',{distance:plan.distance,durationMs:plan.durationMs,manual})
   }catch{/* A short or occupied work area leaves the partner quietly in place. */}
   finally{walking.current=false;const state=useCompanionStore.getState();if(mounted.current&&state.home?.preferences.character===p.character&&state.gesture==='walk')state.act('idle',100);}
 }
 useEffect(()=>{
   let disposed=false,stop:(()=>void)|undefined
   void listen('companion-walk',()=>void doWalk.current(true)).then(fn=>{if(disposed)fn();else stop=fn}).catch(()=>{})
   return()=>{disposed=true;stop?.()}
 },[])
 useEffect(()=>{
  let disposed=false,stop:(()=>void)|undefined
  const chase=createToyChase({getState:useCompanionStore.getState,getTheme:()=>theme,preload:preloadCompanionAction,face:setDirection,setPhase:fetchPhase=>useCompanionStore.setState({fetchPhase}),ready:id=>invoke('toy_ready',{id}),onError:error=>useCompanionStore.setState({error:String(error)})})
  void listen<ToyChaseCue>('companion-fetch',({payload})=>void chase.handle(payload)).then(fn=>{if(disposed)fn();else stop=fn}).catch(()=>{})
  return()=>{disposed=true;chase.cancel();stop?.()}
 },[theme,setDirection,pet.preferences.character])
 useEffect(()=>{
  let disposed=false,stop:(()=>void)|undefined,eventRevision=0
  const motion=createPerchMotion({getState:useCompanionStore.getState,getTheme:()=>theme,preload:preloadCompanionPerch,face:setDirection,update:patch=>useCompanionStore.setState(patch),ready:id=>invoke('companion_perch_ready',{id}),error:e=>useCompanionStore.setState({error:String(e)})})
  void listen<PerchCue>('companion-perch-motion',({payload})=>{eventRevision++;void motion.handle(payload)}).then(fn=>{if(disposed)fn();else stop=fn}).catch(()=>{})
  void invoke<PerchCue|null>('get_companion_perch_motion').then(cue=>{if(!disposed&&!eventRevision&&cue)void motion.handle(cue)}).catch(()=>{})
  return()=>{disposed=true;motion.cancel();stop?.()}
 },[theme,setDirection,pet.preferences.character])
 useEffect(()=>{if(!pet.exploring&&!pet.fetchPhase&&(!pet.animated||pet.action!=='walk'))void invoke('stop_companion_motion').catch(()=>{})},[pet.animated,pet.action,pet.fetchPhase,pet.exploring])
 useEffect(()=>{
   if(!pet.preferences.wander||!pet.animated||!pet.preferences.desktopEnabled)return
   let timer:number|undefined,disposed=false
   const schedule=()=>{timer=window.setTimeout(async()=>{await doWalk.current(false);if(!disposed)schedule()},75000+Math.random()*75000)}
   schedule();return()=>{disposed=true;clearTimeout(timer)}
 },[pet.preferences.wander,pet.preferences.desktopEnabled,pet.animated])
 return <PetSurface pet={pet} dock={dock} morph={morph} size={morph?.stage==='start'?morph.size:pet.preferences.size} direction={direction} glance={glance} onMenu={()=>void openCompanionHome()}/>
}

function CompanionNotice(){
 const pet=useFox()
 const [notice,setNotice]=useState<PetNotice|null>(null),theme=pet.theme
 useEffect(()=>{
   let disposed=false,stop:(()=>void)|undefined
   void invoke<PetNotice|null>('get_companion_notice').then(n=>{if(!disposed)setNotice(n)}).catch(()=>{})
   void listen<PetNotice>('companion-reminder',e=>setNotice(e.payload)).then(fn=>{if(disposed)fn();else stop=fn}).catch(()=>{})
   return()=>{disposed=true;stop?.()}
 },[])
 if(!notice)return null
 return <PetSpeechCard notice={notice} name={pet.preferences.name} theme={theme} animated={pet.animated} onClose={()=>{setNotice(null);void invoke('dismiss_companion_notice')}} onOpen={tab=>{if(tab.startsWith('preparation:'))void invoke('open_preparation_task',{taskId:tab.slice('preparation:'.length)}).catch(()=>{});else if(tab==='tasks')void invoke('open_companion_tasks');else void invoke('open_companion_home',{tab})}}/>

}
function PetPanel(){
 useEffect(()=>{
   document.body.classList.add('xm-pet-panel-root')
   let disposed=false,stop:(()=>void)|undefined,wasFocused=false
   void getCurrentWindow().isFocused().then(value=>{if(!disposed)wasFocused=value}).catch(()=>{})
   void getCurrentWindow().onFocusChanged(({payload})=>{
     if(payload)wasFocused=true
     else if(wasFocused)void invoke('dismiss_companion_panel')
   }).then(fn=>{if(disposed)fn();else stop=fn}).catch(()=>{})
   const escape=(event:KeyboardEvent)=>{if(event.key==='Escape')void invoke('dismiss_companion_panel')}
   document.addEventListener('keydown',escape)
   return()=>{disposed=true;stop?.();document.removeEventListener('keydown',escape)}
 },[])
 return <PetMenu onClose={()=>void invoke('dismiss_companion_panel')}/>
}
function PetRoot(){
 const character=useCompanionStore(s=>s.home?.preferences.character??'fox')
 const city=useSceneWeatherStore(s=>s.city),observation=useSceneWeatherStore(s=>s.observation)
 useEffect(()=>{
   const sync=()=>{const now=new Date(),phase=solarScenePhase(now,city,observation);document.documentElement.dataset.xmLighting=phase==='night'||phase==='predawn'?'night':'day';useSceneSession.setState({phase,openedAt:now})}
   sync();const timer=setInterval(sync,30000)
   document.addEventListener('visibilitychange',sync)
   return()=>{clearInterval(timer);document.removeEventListener('visibilitychange',sync)}
 },[city,observation])
 useEffect(()=>{
   void useSceneWeatherStore.getState().hydrate()
   let disposed=false,stop:(()=>void)|undefined
   void listen<{key:string}>('settings-changed',({payload})=>{
     if(payload.key==='theme')location.reload()
     if(payload.key==='scene_weather_preferences')void useSceneWeatherStore.getState().hydrate()
   }).then(fn=>{if(disposed)fn();else stop=fn}).catch(()=>{})
   return()=>{disposed=true;stop?.()}
 },[])
 const params=new URLSearchParams(location.search)
 return params.has('toy')?<DesktopToy key={character}/>:params.has('input')?<DesktopInput key={character}/>:params.has('notice')?<CompanionNotice key={character}/>:params.has('panel')?<PetPanel key={character}/>:<DesktopFox key={character}/>
}
function DesktopInput(){const pet=useFox();return <PetDesktopInput theme={pet.theme} name={pet.preferences.name} character={pet.preferences.character}/>}
function DesktopToy(){const pet=useFox();return <PetDesktopToy theme={pet.theme} name={pet.preferences.name}/>}
createRoot(document.getElementById('root')!).render(<StrictMode><PetRoot/></StrictMode>)
