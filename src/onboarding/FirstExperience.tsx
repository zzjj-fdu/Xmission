import { useCallback, useEffect, useRef, useState } from 'react';
import {invoke} from '@tauri-apps/api/core';
import { getSettings, setSetting } from '../api/settings';
import { listTasks, isTaskDoneToday } from '../api/tasks';
import { useTasksStore } from '../store/tasks';
import { initialProgress, nextStage, readProgress, shouldOpen, type Progress } from './model';
import { WorldMap } from './WorldMap';
import { ApiSetup } from './ApiSetup';
import { ClawSetup } from './ClawSetup';
import { FirstTask } from './FirstTask';
import { ComicJourney } from './ComicJourney';
import { lastJourneyImage } from './journeyFrames';
import './first-experience.css';

export const openFirstExperience = (stage?: Progress['stage']) => window.dispatchEvent(new CustomEvent('onboarding:open', { detail: stage }));
const lessons = [
  { title: '账簿在这里。', text: '临时的小事放在遭遇，具体的工作放在支线，长期的目标放在主线。重复打卡在详情设置循环。双击任务打开详情，截止日期、备注和今日重点也在那里。', page: 'tasks' },
  { title: '做完了，再盖章。', text: '列表左侧的完成按钮会记下真正的完成，发放经验与金币。不必为了教学提前做完。', page: 'tasks' },
  { title: '留出一段时间。', text: '从任务详情开始专注，或拖动风景与页面之间的分隔线进入专注模式。时长可以调整。', page: 'tasks' },
  { title: '先看看明天的船期。', text: '课表记录固定课程，日历放在同一天查看课程和任务。它们仍在左侧原来的位置。', page: 'calendar' },
  { title: '狐狸也会帮你记。', text: '桌面宠物和悬浮任务栏是主页面之外的入口。AI、OpenClaw 连接和这段开场，都能在设置里重新打开。', page: 'settings' },
] as const;
export function FirstExperience({ navigate }: { navigate: (page: string, taskId?: string) => void }) {
  const [progress, setProgress] = useState<Progress>(initialProgress); const [open, setOpen] = useState(false);
  const [error, setError] = useState(''); const [saving, setSaving] = useState(false); const [completed, setCompleted] = useState(false);
  const [folded,setFolded]=useState(false);
  const [quiet, setQuiet] = useState(true); const [motion, setMotion] = useState(() => !window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  const [musicMuted, setMusicMuted] = useState(false);
  const panel = useRef<HTMLDivElement>(null); const saveQueue = useRef(Promise.resolve());
  const journeyFrame = useRef(0);
  const departing = useRef(false); const currentStage = useRef(progress.stage); currentStage.current = progress.stage;
  const persist = useCallback(async (p: Progress) => { const next = saveQueue.current.catch(() => {}).then(() => setSetting('first_experience_v2', JSON.stringify(p))); saveQueue.current = next; await next; }, []);
  useEffect(() => {
    let alive = true;
    void getSettings().then(s => { if (alive && shouldOpen(s)) { setProgress(readProgress(s.first_experience_v2)); setOpen(true); } }).catch(console.error);
    const reopen = (e: Event) => { const p: Progress = { ...initialProgress(), stage: (e as CustomEvent<Progress['stage']>).detail ?? 'arrival' }; setProgress(p); setError(''); setOpen(true); void persist(p).catch(e => setError(String(e))); };
    window.addEventListener('onboarding:open', reopen); return () => { alive = false; window.removeEventListener('onboarding:open', reopen); };
  }, [persist]);
  const tutorial = progress.stage === 'tutorial';
  const journey = progress.stage === 'journey';
  useEffect(() => { journeyFrame.current = progress.journeyFrame ?? 0; departing.current = false; }, [open, progress.stage]);
  useEffect(()=>{if(open && !panel.current?.contains(document.activeElement))panel.current?.focus();},[open,progress.stage]);
  useEffect(() => {
    if (!open) return; const previous = document.activeElement as HTMLElement;
    document.documentElement.setAttribute('data-inn-experience','');
    void invoke('onboarding_scene',{active:!tutorial}).catch(console.error);
    const background = document.querySelector<HTMLElement>('.xm-shell'); if (background && !tutorial) background.inert = true;
    panel.current?.focus(); return () => { if (background) background.inert = false; previous?.focus?.(); document.documentElement.removeAttribute('data-inn-experience');void invoke('onboarding_scene',{active:false}).catch(console.error); };
  }, [open, tutorial]);
  useEffect(() => {
    if (!open || !tutorial) return;
    const lesson = lessons[progress.tutorial ?? 0]; navigate(lesson.page, lesson.page === 'tasks' ? progress.taskId : undefined);
    let active = true; const check = () => { if (progress.taskId) void listTasks().then(tasks => { if (active) setCompleted(tasks.some(t => t.id === progress.taskId && isTaskDoneToday(t))); }).catch(() => {}); };
    check(); const timer = window.setInterval(check, 2000); return () => { active = false; window.clearInterval(timer); };
  }, [open, tutorial, progress.tutorial, progress.taskId]);
  async function move(p: Progress) { if (saving || departing.current) return; if (journey && p.stage !== 'journey') departing.current = true; setSaving(true); setError(''); try { await persist(p); setProgress(p); } catch (e) { departing.current = false; setError(`进度没有保存：${String(e)}`); } finally { setSaving(false); } }
  const snapshot = () => journey ? { ...progress, journeyFrame: journeyFrame.current } : progress;
  const next = () => void move({ ...snapshot(), stage: nextStage(progress.stage) });
  async function leave(done = false) { if (saving || departing.current) return; if (journey) departing.current = true; setSaving(true); setError(''); try { await persist(done ? { ...snapshot(), stage: 'done' } : snapshot()); setOpen(false); navigate('tasks'); } catch (e) { departing.current = false; setError(String(e)); } finally { setSaving(false); } }
  useEffect(() => {
    if (!open) return;
    const key = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); void leave(); }
      if (event.key === 'Tab' && !tutorial) {
        const all = panel.current?.querySelectorAll<HTMLElement>('button:not(:disabled),input,textarea,select,[tabindex="0"]');
        if (!all?.length) return; const first = all[0], last = all[all.length - 1];
        if (event.shiftKey && (document.activeElement === first || document.activeElement === panel.current)) { event.preventDefault(); last.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
      }
    }; document.addEventListener('keydown', key); return () => document.removeEventListener('keydown', key);
  });
  useEffect(() => {
    if (!open || quiet || tutorial || journey) return;
    const context = new AudioContext(); const buffer = context.createBuffer(1, context.sampleRate * 2, context.sampleRate);
    const samples = buffer.getChannelData(0); for (let i = 0; i < samples.length; i++) samples[i] = (Math.random() * 2 - 1) * .025;
    const noise = context.createBufferSource(); noise.buffer = buffer; noise.loop = true; const filter = context.createBiquadFilter(); filter.type = 'lowpass'; filter.frequency.value = 850; noise.connect(filter); filter.connect(context.destination); noise.start();
    void context.resume().catch(() => {}); return () => { noise.stop(); void context.close(); };
  }, [open, quiet, tutorial, journey]);
  if (!open) return null;
  if (tutorial) {
    const index = progress.tutorial ?? 0; const lesson = lessons[index];
    if(folded)return <div className="inn-tutorial inn-tutorial-folded"><button onClick={()=>setFolded(false)}>继续交接 · {index+1}/{lessons.length}</button></div>;
    return <div className="inn-tutorial" ref={panel} tabIndex={-1} role="region" aria-label="基础操作教学"><div className="inn-tutorial-top"><small>Xmission · 柜台交接 {index + 1}/{lessons.length}</small><button aria-label="收起教学，先操作任务" onClick={()=>setFolded(true)}>−</button></div><h2>{lesson.title}</h2><p>{lesson.text}</p>{completed && <p className="inn-success">第一件事已经完成，记录已由原任务系统保存。</p>}{error && <p role="alert" className="inn-error">{error}</p>}<div className="inn-row"><button onClick={() => void leave(true)}>结束教学</button><button className="inn-primary" disabled={saving} onClick={() => void move(index === lessons.length - 1 ? { ...progress, stage: 'done' } : { ...progress, tutorial: index + 1 })}>{index === lessons.length - 1 ? '交接完成' : '下一项'}</button></div></div>;
  }
  const scene = progress.stage === 'arrival' ? 'arrival' : progress.stage === 'task' ? 'ledger' : 'letter';
  return <div className={`inn-experience ${motion ? 'inn-motion' : ''} ${journey ? 'inn-has-journey' : ''}`} ref={panel} tabIndex={-1} role="dialog" aria-modal="true" aria-label="Xmission 首次体验">
    <div className="inn-background" aria-hidden="true"><div key={`backdrop-${scene}`} className={`inn-backdrop inn-backdrop-${scene}`} style={{ backgroundImage: `url('${scene === 'ledger' ? lastJourneyImage : `/onboarding/${scene}.png`}')` }} /><div className="inn-vignette" /></div>
    <header className="inn-header" data-tauri-drag-region=""><span className="inn-wordmark" data-tauri-drag-region="">Xmission</span><div><button aria-pressed={journey ? !musicMuted : !quiet} onClick={() => journey ? setMusicMuted(v => !v) : setQuiet(v => !v)}>{journey ? musicMuted ? '音乐关' : '音乐开' : quiet ? '声音关' : '声音开'}</button><button aria-pressed={motion} onClick={() => setMotion(v => !v)}>{motion ? '动态开' : '动态关'}</button><button disabled={saving} onClick={() => void leave()}>暂时离开</button></div></header>
    {['arrival', 'letter'].includes(progress.stage) && <div className="inn-caption" key={progress.stage}><small>{progress.stage === 'arrival' ? '末班船离岸之后' : '狐狸把邮袋推到你面前'}</small><p>{progress.stage === 'arrival' ? '「进来吧。船明早才回。」' : '「这一袋是今天送来的。可这条航线……去年就停了。」'}</p><div className="inn-row"><button className="inn-primary" disabled={saving} onClick={next}>{progress.stage === 'arrival' ? '推开门' : '看看信上的地址'}</button><button onClick={() => void move({ ...progress, stage: 'api' })} disabled={saving}>跳过开场</button></div></div>}
    {progress.stage === 'atlas' && <WorldMap onContinue={next} />}{progress.stage === 'api' && <ApiSetup onContinue={next} />}{progress.stage === 'claw' && <ClawSetup onContinue={next} qq={false} />}{progress.stage === 'qq' && <ClawSetup onContinue={next} qq />}
    {journey && <ComicJourney initialFrame={progress.journeyFrame} motion={motion} muted={musicMuted} saving={saving} onContinue={next} onFrame={frame => { if (departing.current || currentStage.current !== 'journey') return; journeyFrame.current = frame; void persist({ ...progress, journeyFrame: frame }).catch(e => { if (!departing.current && currentStage.current === 'journey') setError(`进度没有保存：${String(e)}`); }); }} />}
    {progress.stage === 'task' && <FirstTask sessionId={progress.sessionId} onSkip={next} onCreated={async id => { const p: Progress = { ...progress, taskId: id, stage: 'tutorial', tutorial: 0 }; await persist(p); setProgress(p); void useTasksStore.getState().fetchAll(); }} />}
    {progress.stage === 'done' && <div className="inn-caption"><small>柜台的钥匙留在账簿旁</small><p>「明早开门前，记得把那封信带上。」</p><button className="inn-primary" onClick={() => void leave(true)}>回到 Xmission</button></div>}
    {error && <div className="inn-global-error" role="alert">{error}</div>}
    {!['arrival', 'done', 'tutorial'].includes(progress.stage) && <footer className="inn-footer"><button disabled={saving} onClick={() => void move({ ...snapshot(), stage: progress.stage === 'letter' ? 'arrival' : progress.stage === 'atlas' ? 'letter' : progress.stage === 'api' ? 'atlas' : progress.stage === 'claw' ? 'api' : progress.stage === 'qq' ? 'claw' : progress.stage === 'journey' ? 'qq' : 'journey' })}>← 返回</button><span>进度会保留</span></footer>}
  </div>;
}
