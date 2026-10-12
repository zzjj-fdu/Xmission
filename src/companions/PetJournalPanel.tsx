import {useEffect,useState} from 'react'
import {invoke} from '@tauri-apps/api/core'
import type {PetGoal,PetJournal} from './types'
export function PetJournalPanel({journal,affection,onChange}:{journal:PetJournal;affection:number;onChange:()=>Promise<void>}){
 const[goals,setGoals]=useState<PetGoal[]>([]),[loading,setLoading]=useState(false),[error,setError]=useState(''),[busy,setBusy]=useState<string|null>(null),[limit,setLimit]=useState(12),[search,setSearch]=useState('')
 useEffect(()=>{let canceled=false;setLoading(true);void invoke<PetGoal[]>('list_companion_goals').then(items=>{if(!canceled)setGoals(items)}).catch(e=>{if(!canceled)setError(String(e))}).finally(()=>{if(!canceled)setLoading(false)});return()=>{canceled=true}},[])
 const category=async(goal:PetGoal,value:string)=>{
  if(busy)return;setBusy(goal.id);setError('')
  try{await invoke('set_companion_goal',{taskId:goal.id,category:value||null});setGoals(items=>items.map(g=>g.id===goal.id?{...g,category:value as PetGoal['category']||null}:g));await onChange()}catch(e){setError(String(e))}finally{setBusy(null)}
 }
 const forget=async(key:string)=>{
  if(busy)return;setBusy(key);setError('')
  try{await invoke('forget_companion_memory',{eventKey:key});await onChange()}catch(e){setError(String(e))}finally{setBusy(null)}
 }
 const visibleGoals=goals.filter(g=>g.title.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase()))
 return <div className="xm-pet-journal">
  <h3>{journal.relationship}</h3><p className="xm-pet-menu-help">一起留下 {journal.memoryTotal} 条经历，照顾过 {journal.careDays} 个不同的日子。忙碌和离线不会扣减熟悉度。</p>
  <details><summary>看看熟悉度</summary><div className="xm-pet-bond"><span>熟悉度</span><progress value={affection} max={100}/><small>{affection}/100</small></div></details>
  <h3>共同的小习惯</h3><div className="xm-pet-unlocks">{journal.unlocks.map(u=><article key={u.id} className={u.unlocked?'is-unlocked':''}><span aria-hidden="true">{u.unlocked?'✦':'◇'}</span><div><strong>{u.title}</strong><small>{u.rule}</small><small>{u.unlocked?'已经成为共同经历':Math.min(u.progress,u.target)+' / '+u.target}</small></div></article>)}</div>
  <h3>最近的共同经历</h3>{journal.memories.length?<ol className="xm-pet-memories">{journal.memories.map(m=><li key={m.eventKey}><small>{m.day}</small><strong>{m.title}</strong><p>{m.detail}</p><button disabled={!!busy} onClick={()=>void forget(m.eventKey)}>忘掉这条记忆</button></li>)}</ol>:<p className="xm-pet-dialogue">先一起度过今天，真实的小经历会慢慢留在这里。</p>}
  <details className="xm-pet-goal-permission"><summary>由我指定阅读 / 写作目标</summary><p className="xm-pet-menu-help">只在你选择类别后记录未来完成的目标，不分析标题来猜测习惯，也不会把这些记忆自动发送给 AI。取消类别会停止后续记录。</p>
   <input type="search" aria-label="查找要记录的目标" value={search} placeholder="查找目标" onChange={e=>{setSearch(e.target.value);setLimit(12)}}/>{loading?<p>正在翻看本机目标…</p>:visibleGoals.slice(0,limit).map(g=><label key={g.id}><span>{g.title}</span><select aria-label={g.title+'的记忆类别'} value={g.category??''} disabled={!!busy} onChange={e=>void category(g,e.target.value)}><option value="">不记录习惯</option><option value="reading">阅读目标</option><option value="writing">写作目标</option></select></label>)}
   {visibleGoals.length>limit&&<button onClick={()=>setLimit(n=>n+12)}>再翻一些目标</button>}
  </details>{error&&<p className="xm-pet-menu-error" role="alert">{error}</p>}
 </div>
}
