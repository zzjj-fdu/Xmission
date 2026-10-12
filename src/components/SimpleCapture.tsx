import { useRef, useState } from 'react'
import { recognizeQuickSchedule } from '../utils/quickSchedule'
import { taskDayNow } from '../api/tasks'
import { useTasksStore } from '../store/tasks'
import { PixelInput } from './PixelInput'
import { JrpgButton } from './JrpgButton'
import { openOriginalTask } from '../api/planning'
import './goal-workbench.css'

export function SimpleCapture() {
  const [title, setTitle] = useState(''), [date, setDate] = useState(''), [dateTouched, setDateTouched] = useState(false)
  const [today, setToday] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState('')
  const lock = useRef(false), pending = useRef<string | null>(null)
  const schedule = recognizeQuickSchedule(title)
  const create = useTasksStore(s => s.create), update = useTasksStore(s => s.update)
  return <form className="xm-simple-capture" onSubmit={e => { e.preventDefault(); if (lock.current || !title.trim()) return; lock.current = true; setBusy(true); setError(''); void (async () => {
    if (!pending.current) { const task = await create({ title: title.trim(), form: 'encounter', deadline: date ? new Date(date).toISOString() : null, recurrence: schedule?.recurrence ?? 'none', recurDays: schedule?.recurDays ?? null }); pending.current = task.id }
    if (today) await update(pending.current, { plannedDate: taskDayNow(), importance: 5 })
    openOriginalTask(pending.current); pending.current = null; setTitle(''); setDate(''); setDateTouched(false); setToday(false)
  })().catch(e => setError(String(e))).finally(() => { lock.current = false; setBusy(false) }) }}>
    <label className="xm-capture-title">记下一件事<PixelInput aria-label="快速记录事情" required maxLength={400} disabled={busy || !!pending.current} value={title} placeholder="例如：明晚七点复习第三章" onChange={e => { setTitle(e.target.value); if (!dateTouched) setDate(recognizeQuickSchedule(e.target.value)?.localTime ?? '') }} /></label>
    <label>时间（可留空）<PixelInput aria-label="快速记录时间" type="datetime-local" disabled={busy || !!pending.current} value={date} onChange={e => { setDate(e.target.value); setDateTouched(true) }} /></label>
    <label className="xm-inline-check"><input type="checkbox" checked={today} disabled={busy} onChange={e => setToday(e.target.checked)} />设为今日重点</label>
    <JrpgButton disabled={busy || !title.trim()} type="submit">{busy ? '记录中…' : pending.current ? '重试保存重点' : '记下来'}</JrpgButton>
    <small>{schedule ? `识别为 ${schedule.localTime.replace('T', ' ')}${schedule.recurrence === 'none' ? '' : ' · 重复安排'}，请核对时间。` : '直接保存，不需要配置 AI；时间不明确时请手动填写。'}</small>
    {error && <p role="alert">{error}</p>}
  </form>
}
