import {useEffect,useRef,useState} from 'react'
import {invoke} from '@tauri-apps/api/core'
import {createTask} from '../api/tasks'
import type {PetNotice} from './types'
import type {ThemeKey} from '../themes'
import './pet-menu.css'
import './desktop-life.css'

/** Replies stay beside the desktop fox. The input has its own compact window. */
export function PetSpeechCard({notice,name,theme,onClose,onOpen}:{notice:PetNotice;name:string;theme:ThemeKey;animated?:boolean;onClose:()=>void;onOpen:(tab:string)=>void}){
 const [expanded,setExpanded]=useState(false),[saved,setSaved]=useState(false),[error,setError]=useState(''),[busy,setBusy]=useState(false)
 const gate=useRef(false),revision=useRef(notice.createdAt);revision.current=notice.createdAt
 useEffect(()=>{setExpanded(false);setSaved(false);setError('')},[notice.createdAt])
 const long=(notice.message?.length??0)>64||(notice.message?.split('\n').length??0)>4
 const action=()=>{if(notice.tab==='paper')void invoke('start_toy').then(onClose).catch(e=>setError(String(e)));else void invoke('open_companion_input').then(onClose).catch(e=>setError(String(e)))}
 const save=async()=>{
  if(gate.current||saved||!notice.reply?.suggestedTask)return
  gate.current=true;setBusy(true);const issued=revision.current
  try{await createTask({title:notice.reply.suggestedTask,form:'encounter',importance:3,urgency:3});if(issued===revision.current)setSaved(true)}catch(e){if(issued===revision.current)setError(String(e))}finally{gate.current=false;setBusy(false)}
 }
 return <section className={'xm-pet-notice xm-desktop-speech theme-'+theme+(expanded?' is-expanded':'')} aria-label={name+'的回应'}>
  <button className="xm-pet-notice-close" aria-label="收起伙伴的对话" onClick={onClose}>×</button>
  <div className="xm-pet-notice-content">
   {notice.title&&<small className="xm-speech-name">{notice.title}</small>}
   {notice.message?<p className="xm-pet-speech-text">{notice.message}</p>:<ul>{notice.items.slice(0,3).map(item=><li key={item.key}>{item.title}<small>{item.detail}</small></li>)}</ul>}
   <div className="xm-speech-actions">
    {long&&!expanded&&<button onClick={()=>void invoke('expand_companion_note').then(()=>setExpanded(true)).catch(e=>setError(String(e)))}>展开</button>}
    {(notice.tab==='talk'||notice.tab==='reply'||notice.tab==='paper')&&<button onClick={action}>{notice.tab==='paper'?'把玩具拿出来':'回一句'}</button>}
    {notice.tab&&!['talk','reply','paper'].includes(notice.tab)&&<button onClick={()=>{onOpen(notice.tab!);onClose()}}>看看安排</button>}
    {notice.reply?.suggestedTask&&<button disabled={saved||busy} onClick={()=>void save()}>{saved?'已记入任务':'记下这个目标'}</button>}
   </div>
   {error&&<small role="alert">{error}</small>}
  </div>
 </section>
}
