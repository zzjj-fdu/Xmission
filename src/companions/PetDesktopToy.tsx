import {useRef,useState} from 'react'
import {invoke} from '@tauri-apps/api/core'
import type {ThemeKey} from '../themes'
import './desktop-life.css'
export function PetToyArt({theme,className=''}:{theme:ThemeKey;className?:string}){
 const pixel=theme==='pixel-jrpg'||theme==='stardew-valley'
 return <svg className={'xm-toy-art '+className} viewBox="0 0 64 64" aria-hidden="true" shapeRendering={pixel?'crispEdges':undefined}>
  <ellipse cx="32" cy="55" rx="19" ry="4" fill="#152031" opacity=".16"/>
  {theme==='pixel-jrpg'?<><path d="M28 8h8v12h12v8h8v8H44v12h-8v8h-8V44H16v-8H8v-8h12V16h8Z" fill="#c6a553" stroke="#62472b" strokeWidth="2"/><path d="M28 16h8v12h12v8H36v12h-8V36H16v-8h12Z" fill="#f5da82"/><path d="M25 29h3v4h-3Zm11 0h3v4h-3Z" fill="#3f4051"/><path d="M29 37h6" stroke="#836846" strokeWidth="2"/></>:
   theme==='parchment-journal'?<><path d="M13 19 25 9l17 4 10 14-5 18-17 9-17-8-5-14Z" fill="#faf1d9" stroke="#ac9874" strokeWidth="1.6"/><path d="m25 9 4 17-16-7m16 7 13-13m-13 13 8 13 15-12m-23-1-6 16 7 12m7-15 10 6M13 46l10-4" fill="none" stroke="#c4b699" strokeWidth="1.2"/><path d="m16 24 10 5 7-4m-9 13 13 5" fill="none" stroke="#fffaf0" strokeWidth="2"/></>:
   theme==='animal-crossing'?<><path d="M29 9C11 11 9 27 14 40c4 11 22 16 33 3 10-12 1-23-7-20 7-11 0-15-11-14Z" fill="#b9d58d" stroke="#657b43" strokeWidth="1.7"/><path d="M29 17c-8 12-8 23 0 30m-3-17-7-3m8 12 11-7" fill="none" stroke="#e8efc8" strokeWidth="2" strokeDasharray="2 2"/><ellipse cx="23" cy="29" rx="2" ry="2.7" fill="#586a3e"/><ellipse cx="37" cy="29" rx="2" ry="2.7" fill="#586a3e"/><path d="M27 35q4 4 8 0" fill="none" stroke="#586a3e" strokeWidth="1.4"/></>:
   <><path d="M23 11h7v9h8v-9h7v15h-9v8h-9v-8h-9V16h5Z" fill="#769347" stroke="#4c5f35" strokeWidth="2"/><path d="M19 28h27v8h-5v8h-7v9h-8v-8h-7Z" fill="#df9645" stroke="#8a5c2c" strokeWidth="2"/><path d="M23 32h14m-13 7h9m-5 7h4" stroke="#f5c879" strokeWidth="2"/><path d="M22 29h20" stroke="#ba7532" strokeWidth="2" strokeDasharray="2 2"/></>}
 </svg>
}
export function PetDesktopToy({theme,name='伙伴'}:{theme:ThemeKey;name?:string}){
 const gate=useRef(false),[error,setError]=useState('')
 const down=async()=>{if(gate.current)return;gate.current=true;setError('');try{await invoke('drag_toy')}catch(e){setError(String(e))}finally{gate.current=false}}
 return <button className="xm-desktop-toy" aria-label={'拖动玩具丢给'+name+'，点击让它接住，右键收起'} title={error||undefined} onPointerDown={e=>{if(e.button===0){e.preventDefault();void down()}}} onContextMenu={e=>{e.preventDefault();void invoke('dismiss_toy')}} onKeyDown={e=>{if(e.key==='Escape')void invoke('dismiss_toy');else if(e.key==='Enter'||e.key===' ')void invoke('fetch_toy')}}><PetToyArt theme={theme}/></button>
}
