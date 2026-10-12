import {useEffect,useRef} from 'react'
import {invoke} from '@tauri-apps/api/core'
import {useCompanionStore} from '../store/companion'
import {quietHoursNow,FOX_ACTIONS} from './behavior'
import type {FoxAction} from './types'
import type {useFox} from './useFox'
import {createLifeClock,nextLifeAction,type PetSurroundings} from './petPolicy'
export function usePetLife(pet:ReturnType<typeof useFox>,docked=false,native=true){
 const tucked=useRef(docked);tucked.current=docked
 const latest=useRef(pet);latest.current=pet
 const clock=useRef<ReturnType<typeof createLifeClock>|null>(null)
 if(!clock.current)clock.current=createLifeClock(Date.now())
 useEffect(()=>{
  let disposed=false,busy=false
  const timer=window.setInterval(async()=>{
   if(busy)return
   const p=latest.current,s=useCompanionStore.getState(),time=Date.now()
   if(tucked.current||document.hidden||!p.animated||!p.preferences.enabled||!p.preferences.desktopEnabled||p.preferences.displayMode!=='normal'||s.dragging||s.hovering||s.tool||p.home?.focus||p.home?.trip?.state==='away'||quietHoursNow(p.preferences,time)||s.gesture){clock.current!.restUntil=Math.max(clock.current!.restUntil,time+5000);return}
   const c=clock.current!,returned=p.home?.trip?.state==='returned'&&s.returnedTrip!==p.home.trip.id
   if(!returned&&time<Math.min(c.weatherAt,c.idleAt))return
   busy=true
   try{
    if(native&&(await invoke<PetSurroundings>('get_companion_surroundings')).blocked){c.restUntil=Math.max(c.restUntil,time+10000);return}
    const current=useCompanionStore.getState()
    if(disposed||tucked.current||current.gesture||current.dragging||current.hovering||current.tool||current.home?.focus||!current.home?.preferences.enabled||!current.home.preferences.desktopEnabled||current.home.preferences.displayMode!=='normal'||current.home.trip?.state==='away'||quietHoursNow(current.home.preferences,Date.now())||document.hidden)return
    if(returned){if(current.home.trip?.id===p.home?.trip?.id&&current.home.trip?.state==='returned')current.act('return',4800);return}
    const unlocked=p.home?.journal?.unlocks.filter(u=>u.unlocked).map(u=>u.id)??[],choices:FoxAction[]=['daily','sit','stretch','adjust-scarf']
    if(p.home?.keepsake?.theme===p.theme)choices.push('keepsake')
    if(unlocked.includes('reader'))choices.push('read-habit')
    if(p.home?.growth?.paperSkill)choices.push('game-turn')
    const environment:FoxAction|null=!p.preferences.followEnvironment?null:p.weather==='snow'?'snow':p.weather==='rain'?'rain':p.weather==='wind'?'wind':p.phase==='night'||p.phase==='predawn'?'night':null
    const action=nextLifeAction(c,time,p.weather+':'+p.phase,environment,choices)
    if(action==='game-turn')current.playPaper()
    else if(action)current.act(action,action==='rain'?9000:action==='snow'?6200:action==='wind'?3200:action==='night'?8500:FOX_ACTIONS[action].duration)
   }catch{/* Native activity wins over optional idle animation. */}finally{busy=false}
  },2500)
  return()=>{disposed=true;clearInterval(timer)}
 },[native])
}
