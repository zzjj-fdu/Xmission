import { useEffect,useState } from 'react'
import { useCompanionStore,startCompanionStore } from '../store/companion'
import { currentSceneWeather,useSceneWeatherStore } from '../store/sceneWeather'
import { useSceneSession } from '../store/sceneSession'
 import { DEFAULT_PET_PREFERENCES,normalizePetPreferences } from './types'
import { currentThemeKey } from '../themes'
import { quietHoursNow,resolveFoxAction } from './behavior'
export function useFox(){
 useEffect(startCompanionStore,[])
 const pet=useCompanionStore(),weather=useSceneWeatherStore(currentSceneWeather),motion=useSceneWeatherStore(s=>s.motion),phase=useSceneSession(s=>s.phase)
 const [systemReduced,setSystemReduced]=useState(()=>matchMedia('(prefers-reduced-motion:reduce)').matches)
 const [visible,setVisible]=useState(()=>!document.hidden)
 useEffect(()=>{
   const q=matchMedia('(prefers-reduced-motion:reduce)'),change=()=>setSystemReduced(q.matches),visibility=()=>setVisible(!document.hidden)
   q.addEventListener('change',change);document.addEventListener('visibilitychange',visibility)
   return()=>{q.removeEventListener('change',change);document.removeEventListener('visibilitychange',visibility)}
 },[])
 const trip=pet.home?.trip
 const [travelBag,setTravelBag]=useState(false)
 useEffect(()=>{
   setTravelBag(false)
   if(trip?.state!=='away')return
   const remaining=Math.max(0,trip.startedAt+4800-Date.now())
   if(!remaining){setTravelBag(true);return}
   const timer=setTimeout(()=>setTravelBag(true),remaining)
   return()=>clearTimeout(timer)
 },[trip?.id,trip?.state,trip?.startedAt])
 const preferences=pet.home?normalizePetPreferences(pet.home.preferences):DEFAULT_PET_PREFERENCES
 useEffect(()=>{
   if(!preferences.enabled||!preferences.desktopEnabled||preferences.displayMode==='closed'){useCompanionStore.getState().reset();return}
   useCompanionStore.getState().setActivity(pet.home?.trip?.state==='away'?'idle':pet.home?.focus?'focus':pet.perched?'idle':quietHoursNow(preferences,pet.clock)?'sleep':'idle')
 },[preferences.enabled,preferences.desktopEnabled,preferences.displayMode,preferences.quietStart,preferences.quietEnd,pet.home?.focus,pet.home?.trip?.state,pet.perched,pet.clock])
 const action=resolveFoxAction({preferences,trip:pet.home?.trip??null,focus:pet.home?.focus??false,dragging:pet.dragging,gesture:pet.gesture,gestureUntil:pet.gestureUntil,weather,phase,now:pet.clock,notice:!!pet.notice&&!pet.notice.message&&pet.clock-pet.notice.createdAt<18000})
 const shown=pet.perched&&!pet.gesture&&action==='sleep'?'idle':action
 return {...pet,preferences,travelBag,theme:preferences.appearance==='follow'?currentThemeKey():preferences.appearance,action:pet.perched&&shown==='idle'?(pet.attachment==='bottom'?'window-hang':!pet.attachment||pet.attachment==='sit'?'sit':shown):shown,animated:visible&&!systemReduced&&!preferences.reducedMotion&&motion==='full',weather,phase}
}
