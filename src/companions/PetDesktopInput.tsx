import {useEffect,useRef,useState} from 'react'
import {invoke} from '@tauri-apps/api/core'
import {listen} from '@tauri-apps/api/event'
import type {ThemeKey} from '../themes'
import './pet-menu.css'
import './desktop-life.css'

export function PetDesktopInput({theme,name='伙伴',character='fox'}:{theme:ThemeKey;name?:string;character?:string}){
 const [message,setMessage]=useState(''),[busy,setBusy]=useState(false),[error,setError]=useState(''),[options,setOptions]=useState(false),[share,setShare]=useState(false)
 const [scenario,setScenario]=useState('chat')
 const field=useRef<HTMLTextAreaElement>(null),gate=useRef(false),alive=useRef(true),revision=useRef(0)
 useEffect(()=>{alive.current=true;let disposed=false,stop:(()=>void)|undefined
  const open=()=>{revision.current++;gate.current=false;setBusy(false);setOptions(false);setShare(false);setScenario('chat');setError('');setTimeout(()=>field.current?.focus(),30)}
  void listen('companion-input-open',open).then(fn=>{if(disposed)fn();else stop=fn}).catch(()=>{})
  open();return()=>{alive.current=false;disposed=true;stop?.()}
 },[])
 useEffect(()=>{revision.current++;gate.current=false;setMessage('');setBusy(false);setShare(false);setError('')},[character])
 const close=()=>{revision.current++;gate.current=false;setBusy(false);void invoke('dismiss_companion_input')}
 const submit=async()=>{
  if(gate.current||!message.trim())return
  gate.current=true;setBusy(true);setError('');const issued=revision.current
  try{await invoke('send_companion_message',{message:scenario==='chat'?message.trim():'请帮我理解这次分享的题目。',includeToday:share,scenario,sharedText:scenario==='chat'?null:message.trim()});if(alive.current&&issued===revision.current)setMessage('')}
  catch(e){if(alive.current&&issued===revision.current){setError(String(e));void invoke('resize_companion_input',{height:options?184:104}).catch(()=>{})}}
  finally{if(issued===revision.current){gate.current=false;if(alive.current)setBusy(false)}}
 }
 const toggle=async()=>{const next=!options;setOptions(next);try{await invoke('resize_companion_input',{height:next?(error?184:144):(error?104:64)})}catch(e){setError(String(e))}}
 return <form className={'xm-desktop-input theme-'+theme} onSubmit={e=>{e.preventDefault();void submit()}}>
  <textarea ref={field} autoFocus aria-label={'对'+name+'说句话'} disabled={busy} maxLength={scenario==='chat'?1200:12000} rows={1} placeholder={busy?name+'想一想…':'对'+name+'说句话…'} value={message} onChange={e=>setMessage(e.target.value)} onKeyDown={e=>{if(e.key==='Escape'){e.preventDefault();close()}else if(e.key==='Enter'&&!e.shiftKey&&!e.nativeEvent.isComposing){e.preventDefault();void submit()}}}/>
  <button type="submit" aria-label="发送" title="发送 · Enter" disabled={busy||!message.trim()}><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m4 11 16-7-7 16-2-7Z M11 13l9-9"/></svg></button>
  <button type="button" className="xm-input-more" aria-label="分享和帮助选项" title="分享与题目帮助" aria-expanded={options} onClick={()=>void toggle()}>···</button>
  <button type="button" className="xm-input-close" aria-label="收起输入框" title="收起 · Esc" onClick={close}>×</button>
  {options&&<div className="xm-input-options"><select aria-label="帮助方式" value={scenario} disabled={busy} onChange={e=>setScenario(e.target.value)}><option value="chat">说句话</option><option value="hint">题目 · 小提示</option><option value="example">题目 · 小例子</option><option value="tutorial">题目 · 讲清楚</option></select><label><input type="checkbox" checked={share} onChange={e=>setShare(e.target.checked)}/>分享今天的安排</label><button type="button" disabled={busy} onClick={()=>void invoke('show_companion_last_reply').catch(e=>setError(String(e)))}>上一张回应</button></div>}
  {error&&<small role="alert">{error}</small>}
 </form>
}
