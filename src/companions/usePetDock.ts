import {useEffect,useState} from 'react'
import {invoke} from '@tauri-apps/api/core'
import {listen} from '@tauri-apps/api/event'
import type {PetDockState} from './types'
const OPEN:PetDockState={side:null,hidden:false,transitioning:false,folded:false}
export function usePetDock(){
 const[state,setState]=useState<PetDockState>(OPEN)
 useEffect(()=>{
  let disposed=false,updated=false,stop:(()=>void)|undefined
  // Subscribe before reading the snapshot, so an unfold cannot be replaced by a stale read.
  void listen<PetDockState>('companion-dock',({payload})=>{updated=true;if(!disposed)setState(payload)})
   .then(async fn=>{
    if(disposed){fn();return}stop=fn
    const initial=await invoke<PetDockState>('get_companion_dock').catch(()=>OPEN)
    if(!disposed&&!updated)setState(initial)
   }).catch(()=>{})
  return()=>{disposed=true;stop?.()}
 },[])
 return state
}
