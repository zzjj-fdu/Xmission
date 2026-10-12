import {useEffect,useRef,useState} from 'react'
import {invoke} from '@tauri-apps/api/core'
import type {ThemeKey} from '../themes'
import type {ScenePhase} from '../scenes'
import {useSceneViewport} from '../hooks/useSceneViewport'
import {startCompanionStore,useCompanionStore} from '../store/companion'
import {CompanionSprite} from './CompanionSprite'
import './scene-companion.css'

/** Ground landmarks in the same source camera as the scenery, not percentages of the panel. */
export const FOX_SCENE_ANCHORS:Record<ThemeKey,{x:number;y:number;size:number}>={
 'pixel-jrpg':{x:126,y:615,size:74},
 'parchment-journal':{x:212,y:758,size:78},
 'animal-crossing':{x:238,y:480,size:65},
 'stardew-valley':{x:215,y:440,size:62},
}
export function SceneCompanionSticker({theme,phase,enabled=true}:{theme:ThemeKey;phase:ScenePhase;enabled?:boolean}){
 useEffect(startCompanionStore,[])
 const root=useRef<HTMLDivElement>(null),viewport=useSceneViewport(root,theme)
 const preferences=useCompanionStore(s=>s.home?.preferences)
 const[busy,setBusy]=useState(false),[error,setError]=useState('')
 const closed=!!preferences&&(!preferences.enabled||!preferences.desktopEnabled||preferences.displayMode==='closed')
 const[leaving,setLeaving]=useState(false)
 useEffect(()=>{if(closed)setLeaving(false)},[closed])
 useEffect(()=>{if(!leaving)return;const timer=window.setTimeout(()=>setLeaving(false),460);return()=>clearTimeout(timer)},[leaving])
 const point=FOX_SCENE_ANCHORS[theme],size=Math.max(34,Math.min(82,point.size*viewport.scale))
 const summon=async()=>{
  if(busy)return
  setBusy(true);setError('')
  try{
   await invoke('summon_companion')
   setLeaving(true)
   await useCompanionStore.getState().refresh()
  }catch(e){setError('没能叫出伙伴：'+String(e))}
  finally{setBusy(false)}
 }
 return <div ref={root} className={'xm-scene-companion theme-'+theme} data-phase={phase}>
  {enabled&&(closed||leaving)&&viewport.scale>0&&<div className={'xm-scene-fox-home'+(leaving?' is-leaving':'')} style={{left:point.x*viewport.scale,top:point.y*viewport.scale+viewport.offsetY,width:size,height:size}}>
   <button type="button" disabled={busy||leaving} aria-label={'点一下风景里的'+(preferences?.name??'伙伴')+'，让它来桌面陪伴'} title={busy?'伙伴正在走出来…':'点点我，让我到桌面陪你'} onClick={()=>void summon()}>
    <CompanionSprite theme={theme} action="idle" direction="front" size={size} animated={false}/>
    <span className="xm-scene-fox-hint">{busy?'来啦…':'来陪我'}</span>
   </button>
  </div>}
  {error&&<button className="xm-scene-fox-error" onClick={()=>setError('')} role="alert">{error}　×</button>}
 </div>
}

