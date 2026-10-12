import { useEffect,useRef, useState } from 'react';
import { aiParseTask, type TaskDraft } from '../api/ai';
import { type Task } from '../api/tasks';
import {getFirstTask,createFirstTask} from './api';
import { createOnce } from './model';
export function FirstTask({sessionId,onCreated,onSkip}:{sessionId:string;onCreated:(id:string)=>Promise<void>;onSkip:()=>void}) {
  const [text, setText] = useState(''); const [draft, setDraft] = useState<TaskDraft>(); const [busy, setBusy] = useState(false); const [error, setError] = useState('');
  const once = useRef(createOnce<Task>());
  const [saved,setSaved]=useState<Task|null>(null);const [loading,setLoading]=useState(true);
  useEffect(()=>{let alive=true;void getFirstTask(sessionId).then(task=>{if(alive)setSaved(task);}).catch(e=>{if(alive)setError(String(e));}).finally(()=>{if(alive)setLoading(false);});return()=>{alive=false;};},[sessionId]);
  async function parse() { if (busy) return; setBusy(true); setError(''); try { setDraft(await aiParseTask(text)); } catch (e) { setError(String(e)); } finally { setBusy(false); } }
  async function confirm() {
    if (!draft || busy || !draft.title.trim()) return; setBusy(true); setError('');
    try {
      const task = await once.current(() => createFirstTask(sessionId,{ title: draft.title.trim(), notes: draft.details, form: 'encounter', importance: draft.importance, urgency: draft.urgency, deadline: draft.deadline, estimatedMin: draft.estimatedMin, recurrence: draft.recurrence, recurDays: draft.recurDays, icon: draft.icon }));
      await onCreated(task.id);
    } catch (e) { setError(String(e)); } finally { setBusy(false); }
  }
  if(loading)return <div className="inn-setup-card"><p role="status">正在翻到上次记下的那一页…</p></div>;
  if(saved)return <div className="inn-setup-card"><small>柜台 · 上次的记录</small><h2>这件事已经入账。</h2><p>{saved.title}</p><p className="inn-note">继续交接会打开原任务。</p>{error&&<p className="inn-error" role="alert">{error}</p>}<button className="inn-primary" disabled={busy} onClick={async()=>{setBusy(true);try{await onCreated(saved.id);}catch(e){setError(String(e));}finally{setBusy(false);}}}>看看这件事</button></div>;
  return <div className="inn-setup-card"><small>柜台 · 打开账簿</small><h2>今天有什么要办的？</h2><p>写你自己的一件小事。它会留在真正的任务列表里。</p>
    {!draft ? <><label>随便说说<textarea autoFocus value={text} onChange={e => setText(e.target.value)} placeholder="比如：明天下午把借来的书还回图书馆" rows={3} maxLength={4000} /></label><div className="inn-row"><button disabled={busy || !text.trim()} className="inn-primary" onClick={() => void parse()}>{busy ? '书记正在整理…' : '交给书记整理'}</button><button disabled={busy || !text.trim()} onClick={() => setDraft({ title: text.trim().slice(0, 200), details: null, importance: 3, urgency: 3, deadline: null, estimatedMin: null, icon: '', recurrence: 'none', recurDays: null })}>先手动记一行</button></div></>
      : <><label>确认任务<input value={draft.title} maxLength={200} onChange={e => setDraft({ ...draft, title: e.target.value })} /></label><p className="inn-note">{draft.deadline ? `截止：${new Date(draft.deadline).toLocaleString('zh-CN')}` : '没有截止日期'}{draft.estimatedMin ? ` · 预计 ${draft.estimatedMin} 分钟` : ''}</p><div className="inn-row"><button onClick={() => { setDraft(undefined); }} disabled={busy}>改一句话</button><button className="inn-primary" disabled={busy || !draft.title.trim()} onClick={() => void confirm()}>{busy ? '正在入账…' : '确认，记进账簿'}</button></div></>}
    {error && <p role="alert" className="inn-error">{error}</p>}<button className="inn-text-button" disabled={busy} onClick={onSkip}>之后再写，先看看怎么用</button>
  </div>;
}
