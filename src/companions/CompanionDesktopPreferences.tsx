import {useRef,useState} from 'react'
import {invoke} from '@tauri-apps/api/core'
export function CompanionDesktopPreferences(){
 const [choices,setChoices]=useState<Array<{id:string;title:string}>>([]),[chosen,setChosen]=useState(''),[kind,setKind]=useState<'window'|'icon'>('window'),[mode,setMode]=useState('top'),[error,setError]=useState(''),[busy,setBusy]=useState(false),[line,setLine]=useState('')
 const gate=useRef(false)
 const run=async(job:()=>Promise<void>)=>{if(gate.current)return;gate.current=true;setBusy(true);setError('');try{await job()}catch(e){setError(String(e))}finally{gate.current=false;setBusy(false)}}
 const list=(next:'window'|'icon')=>run(async()=>{setChoices(await invoke(next==='window'?'list_companion_windows':'list_companion_icons'));setKind(next);setChosen('');setLine('')})
 return <details className="xm-pet-desktop-choices"><summary>窗沿和桌面图标</summary>
  <p>伙伴会自己找附近有空位的窗沿或图标。你也可以指定一个位置：探出上沿、抱住左右外沿、挂在下沿。</p>
  <div className="xm-perch-picker"><button disabled={busy} onClick={()=>void list('window')}>选一个窗口</button><button disabled={busy} onClick={()=>void list('icon')}>选一个桌面图标</button></div>
  {choices.length>0&&<><select aria-label="选择依附目标" value={chosen} onChange={e=>setChosen(e.target.value)}><option value="">请选择…</option>{choices.map(w=><option key={w.id} value={w.id}>{w.title}</option>)}</select>
   {kind==='window'&&<select aria-label="依附姿势" value={mode} onChange={e=>setMode(e.target.value)}><option value="top">躲在上沿探头</option><option value="left">抱住左边外沿</option><option value="right">抱住右边外沿</option><option value="bottom">挂在下沿</option><option value="sit">坐在上沿</option></select>}
   <button disabled={!chosen||busy} onClick={()=>void run(async()=>{await invoke('attach_companion_window',{id:chosen,mode:kind==='icon'?'icon':mode});setLine('已找到位置，收起手册就能看见；拖离即可解除。')})}>{kind==='icon'?'抱住这个图标':'过去陪你'}</button>
  </>}
  <button disabled={busy} onClick={()=>void run(async()=>{await invoke('release_companion_window');setLine('已经离开依附的位置')})}>回到桌面</button>
  <small>只在本机读取名称和位置，不打开软件、不移动图标。目标遮住、收起或关闭会离开；所选外沿需有空位。图标先支持 Windows 系统桌面，附着最多两小时。</small>
  {line&&<small role="status">{line}</small>}{error&&<p role="alert">{error}</p>}
 </details>
}
