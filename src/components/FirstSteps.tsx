import { useEffect, useRef, useState } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { createTask, listTasks, taskDayNow, updateTask } from '../api/tasks'
import { getSetting, setSetting } from '../api/settings'
import { aiParseTask } from '../api/ai'
import { CompanionPortrait } from '../companions/CompanionSprite'
import { activeTheme, currentThemeKey, THEMES, THEME_STORAGE_KEY, type ThemeKey } from '../themes'
import { usePreparationStore } from '../store/preparation'
import { openPreparationArtifact } from '../api/preparation'
import { localDateTime } from './PreparationPanel'
import { recognizeQuickSchedule } from '../utils/quickSchedule'
import { JrpgButton } from './JrpgButton'
import { PixelInput } from './PixelInput'
import './first-steps.css'
interface Progress { step: number; taskId?: string; complete?: boolean }
const titles = ['认识伙伴', '记下一件真实的事', '今天最想推进哪件事', '让开始更轻松', '在原任务使用结果', '一起走一段旅程']
export function FirstSteps({ onTask, onSettings }: { onTask: (id: string) => void; onSettings: () => void }) {
  const [visible, setVisible] = useState(false), [progress, setProgress] = useState<Progress>({ step: 0 })
  const [title, setTitle] = useState(''), [date, setDate] = useState(''), [busy, setBusy] = useState(false), [error, setError] = useState('')
  const dialog = useRef<HTMLDialogElement>(null), gate = useRef(false)
  const [dateTouched, setDateTouched] = useState(false), pendingTask = useRef<string | null>(null)
  const recognized = recognizeQuickSchedule(title)
  const result = usePreparationStore(s => s.runs.find(r => r.taskId === progress.taskId && r.state === 'ready'))
  useEffect(() => {
    let disposed = false
    void getSetting('onboarding_state').then(async raw => {
      if (disposed) return
      if (raw) { try { const p = JSON.parse(raw) as Progress; if (p.step >= 0 && p.step < 6) { setProgress(p); setVisible(!p.complete) } } catch { /* Existing user's invalid state stays quiet. */ } }
      else if ((await listTasks()).length === 0 && !disposed) setVisible(true)
    }).catch(() => {})
    const reopen = () => { pendingTask.current = null; setTitle(''); setDate(''); setDateTouched(false); setProgress({ step: 0 }); setVisible(true); setError('') }
    window.addEventListener('onboarding:open', reopen)
    return () => { disposed = true; window.removeEventListener('onboarding:open', reopen) }
  }, [])
  useEffect(() => { if (visible) dialog.current?.showModal(); else dialog.current?.close() }, [visible])
  const persist = async (next: Progress) => { await setSetting('onboarding_state', JSON.stringify(next)); setProgress(next) }
  const act = async (job: () => Promise<void>) => {
    if (gate.current) return
    gate.current = true; setBusy(true); setError('')
    try { await job() } catch (e) { setError(String(e)) } finally { gate.current = false; setBusy(false) }
  }
  const next = () => act(() => persist({ ...progress, step: Math.min(5, progress.step + 1), complete: false }))
  const close = () => act(async () => { await persist({ ...progress, complete: true }); setVisible(false) })
  const openTask = () => act(async () => { if (!progress.taskId) return; await persist({ ...progress, step: 4, complete: true }); setVisible(false); onTask(progress.taskId) })
  if (!visible) return null
  return <dialog ref={dialog} className="xm-first-steps" style={{ color: activeTheme.colors.text, background: activeTheme.colors.panel, fontFamily: activeTheme.font.body }} aria-labelledby="xm-first-steps-title" onCancel={e => { e.preventDefault(); void close() }}>
    <header><CompanionPortrait theme={currentThemeKey()} emotion="curious" size={64} /><div><small>伙伴陪你开始 · {progress.step + 1}/6</small><h2 id="xm-first-steps-title">{titles[progress.step]}</h2></div><button aria-label="跳过使用引导" disabled={busy} onClick={() => void close()}>×</button></header>
    {progress.step === 0 && <><p>我会陪你记下安排、查看今天，也可以一起旅行。资料准备与授权在主程序的原任务里完成。</p><div className="xm-first-themes">{Object.entries(THEMES).map(([key, meta]) => <button aria-pressed={currentThemeKey() === key} disabled={busy} key={key} onClick={() => void act(async () => { await persist({ ...progress, step: 1 }); await setSetting('theme', key); localStorage.setItem(THEME_STORAGE_KEY, key as ThemeKey); window.location.reload() })}>{meta.name.replace(/^V\d\s*/, '')}</button>)}</div><JrpgButton disabled={busy} onClick={() => void next()}>就从现在的主题开始</JrpgButton></>}
    {progress.step === 1 && <form onSubmit={e => { e.preventDefault(); void act(async () => { if (!pendingTask.current) { const task = await createTask({ title: title.trim(), form: 'encounter', deadline: date ? new Date(date).toISOString() : null, recurrence: recognized?.recurrence ?? 'none', recurDays: recognized?.recurDays ?? null }); pendingTask.current = task.id } await persist({ step: 2, taskId: pendingTask.current }); }) }}><p>写下一件你真的想做的事。时间可以直接修正，空着也能开始。</p><label>事情<PixelInput autoFocus required maxLength={400} value={title} onChange={e => { setTitle(e.target.value); if (!dateTouched) setDate(recognizeQuickSchedule(e.target.value)?.localTime ?? '') }} placeholder="例如：明晚七点复习第三章" /></label><label>行动 / 截止时间<PixelInput type="datetime-local" value={date} onChange={e => { setDate(e.target.value); setDateTouched(true) }} /></label>{recognized && <small>识别到 {recognized.localTime.replace('T', ' ')}，请在上面核对和修改。</small>}<JrpgButton variant="ghost" type="button" disabled={busy || !title.trim()} onClick={() => void act(async () => { const draft = await aiParseTask(title.trim()); setTitle(draft.title); setDate(draft.deadline ? localDateTime(draft.deadline) : ''); setDateTouched(true); })}>用已配置的 AI 识别时间</JrpgButton><small>AI 识别后的标题和时间会显示在上面，修正后再保存；未接入 AI 时可手动填写。</small><JrpgButton type="submit" disabled={busy || !title.trim()}>记进任务</JrpgButton></form>}
    {progress.step === 2 && <><p>伙伴菜单里的“今天与记录”可以查看、完成和简单改时间，和主程序使用同一份任务。</p><p>把刚记下的事情设为今天的重点，或继续保持原安排。</p><JrpgButton disabled={busy || !progress.taskId} onClick={() => void act(async () => { await updateTask(progress.taskId!, { plannedDate: taskDayNow(), importance: 5 }); await persist({ ...progress, step: 3 }); })}>今天就先推进这件事</JrpgButton><JrpgButton variant="ghost" disabled={busy} onClick={() => void next()}>保持原安排</JrpgButton></>}
    {progress.step === 3 && <><p>这项任务要不要提前准备资料？打开它的详情，就能选择写作目录、学习材料或专注环境，并指定保存位置和范围。</p><JrpgButton disabled={busy || !progress.taskId} onClick={() => void openTask()}>到这项任务建立准备约定</JrpgButton><JrpgButton variant="ghost" disabled={busy} onClick={() => void next()}>稍后再做，先用手动任务</JrpgButton></>}
    {progress.step === 4 && <><p>{result ? '这项任务的资料已经就位。直接打开使用，也能在同一处修改要求与暂停。' : '配置后，真实产物会出现在原任务详情。当前没有准备结果，手动任务仍然可用。'}</p>{result && <JrpgButton disabled={busy} onClick={() => void act(async () => { await openPreparationArtifact(result.id); })}>打开已准备的项目</JrpgButton>}{progress.taskId && <JrpgButton variant="ghost" disabled={busy} onClick={() => void openTask()}>查看原任务</JrpgButton>}<JrpgButton disabled={busy} onClick={() => void next()}>继续</JrpgButton></>}
    {progress.step === 5 && <><p>完成一次实际行动后，可以主动开启五节点旅程：行囊、路线、发现、小委托、纪念物。随时暂停，忙碌不会失去成果。</p><JrpgButton disabled={busy} onClick={() => void act(async () => { await invoke('open_companion_home', { tab: 'chapter' }); await persist({ ...progress, complete: true }); setVisible(false); })}>看看伙伴的旅程</JrpgButton><JrpgButton variant="ghost" disabled={busy} onClick={() => void close()}>现在开始使用</JrpgButton></>}
    {error && <p role="alert" className="xm-preparation-error">{error}</p>}
    <footer><button disabled={busy} onClick={() => void close()}>跳过，之后可在设置重开</button><button disabled={busy} onClick={() => { void close().then(onSettings) }}>去设置</button></footer>
  </dialog>
}
