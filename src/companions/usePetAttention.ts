import {useCallback,useEffect,useRef,useState} from 'react'
import {invoke} from '@tauri-apps/api/core'
import type {FoxDirection} from './types'
import {quietHoursNow} from './behavior'
import {useCompanionStore} from '../store/companion'
import {cursorFacing,idleFacing,type PetSurroundings} from './petPolicy'

export function usePetAttention(animated:boolean,native=true){
 const[direction,updateDirection]=useState<FoxDirection>('right')
 const facing=useRef<FoxDirection>('right'),resting=useRef<FoxDirection>('right'),enabled=useRef(animated);enabled.current=animated
 const until=useRef(0),frontUntil=useRef(0),turn=useRef<number|undefined>(undefined),mounted=useRef(true)
 const canTurn=()=>{
  const s=useCompanionStore.getState(),p=s.home?.preferences
  return enabled.current&&!document.hidden&&!!p&&p.enabled&&p.displayMode==='normal'&&!s.exploring&&!s.perched&&!s.dragging&&!s.hovering&&!s.tool&&!s.home?.focus&&s.home?.trip?.state!=='away'&&!s.gesture&&!quietHoursNow(p,Date.now())
 }
 const setDirection=useCallback((next:FoxDirection)=>{
  clearTimeout(turn.current);frontUntil.current=0
  until.current=Date.now()+8000
  facing.current=next;if(next!=='front')resting.current=next
  if(mounted.current)updateDirection(next)
 },[])
 const glance=(next:FoxDirection)=>{
  if(!canTurn()||next===facing.current||Date.now()<until.current)return
  until.current=Date.now()+24000;clearTimeout(turn.current);frontUntil.current=0
  useCompanionStore.getState().act('attention')
  turn.current=window.setTimeout(()=>{
   const s=useCompanionStore.getState()
   const p=s.home?.preferences
   if(!mounted.current||!enabled.current||document.hidden||!p?.enabled||p.displayMode!=='normal'||quietHoursNow(p,Date.now())||s.dragging||s.hovering||s.tool||s.home?.focus||s.home?.trip?.state==='away'||s.gesture&&s.gesture!=='attention')return
   if(s.gesture&&s.gesture!=='attention')return
   facing.current=next;if(next!=='front')resting.current=next;updateDirection(next)
   if(next==='front')frontUntil.current=Date.now()+6500
  },720)
 }
 const latest=useRef({glance,canTurn});latest.current={glance,canTurn}
 useEffect(()=>{
  mounted.current=true;let disposed=false,busy=false,initialized=false,nextIdle=Date.now()+65000+Math.random()*85000
  let candidate:FoxDirection|null=null,since=0
  const timer=window.setInterval(async()=>{
   if(busy||!latest.current.canTurn())return
   if(facing.current==='front'&&frontUntil.current&&Date.now()>=frontUntil.current){frontUntil.current=0;facing.current=resting.current;updateDirection(resting.current);return}
   busy=true
   try{
    const context:PetSurroundings=native?await invoke('get_companion_surroundings'):{leftRoom:500,rightRoom:500,cursorX:-1000,cursorY:-1000,size:96,blocked:false}
    if(disposed)return
    if(context.blocked||!latest.current.canTurn()){candidate=null;since=Date.now();return}
    if(native&&!initialized){initialized=true;const next=idleFacing(context,Math.random());facing.current=next;resting.current=next;updateDirection(next);return}
    const now=Date.now(),look=cursorFacing(context)
    if(look!==candidate){candidate=look;since=now}
    if(now>=nextIdle){nextIdle=now+65000+Math.random()*85000;latest.current.glance(idleFacing(context,Math.random()))}
    else if(look&&now-since>=2400&&now>=until.current){
     const distance=Math.hypot(context.cursorX-context.size/2,context.cursorY-context.size/2)
     if(Math.random()<Math.max(.08,.65*(1-distance/(context.size*3))))latest.current.glance(look)
    }
   }catch{/* Stay facing the last stable direction when desktop geometry is unavailable. */}finally{busy=false}
  },2500)
  return()=>{disposed=true;mounted.current=false;clearInterval(timer);clearTimeout(turn.current)}
 },[native])
 return{direction,setDirection,glance}
}
