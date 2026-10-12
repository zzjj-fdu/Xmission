import {useEffect,useState} from 'react'
import {invoke} from '@tauri-apps/api/core'
import {listen} from '@tauri-apps/api/event'
export interface PetMorph {id:number;from:'normal'|'mini';to:'normal'|'mini';size:number;startedAt:number;durationMs:number;stage:'start'|'finish'|'cancel'}
export function usePetMorph(mode:string){
 const[morph,setMorph]=useState<PetMorph|null>(null)
 useEffect(()=>{
  let disposed=false,updated=false,stop:(()=>void)|undefined
  void listen<PetMorph>('companion-morph',({payload})=>{updated=true;if(!disposed)setMorph(payload.stage==='cancel'?null:payload)})
   .then(async fn=>{if(disposed){fn();return}stop=fn;const snapshot=await invoke<PetMorph|null>('get_companion_morph').catch(()=>null);if(!disposed&&!updated)setMorph(snapshot)}).catch(()=>{})
  return()=>{disposed=true;stop?.()}
 },[])
 useEffect(()=>{if(morph?.stage==='finish'&&mode===morph.to)setMorph(null)},[mode,morph])
 return morph
}
