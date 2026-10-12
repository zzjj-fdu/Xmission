import { useEffect, useRef, useState } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { createTask, completeTask, isTaskDoneToday, listTasks, onTasksChanged, reopenTask, taskDayNow, updateTask, type Task } from '../api/tasks'
import { getSetting, setSetting } from '../api/settings'
import { listPreparations } from '../api/preparation'
import { localDateTime } from '../components/PreparationPanel'
import { recognizeQuickSchedule } from '../utils/quickSchedule'
export function PetQuickTasks({ focused, proactive }: { focused: boolean; proactive: boolean }) {
  const [tasks, setTasks] = useState<Task[]>([]), [title, setTitle] = useState(''), [date, setDate] = useState(''), [search, setSearch] = useState('')
  const [editing, setEditing] = useState<string | null>(null), [editDate, setEditDate] = useState(''), [help, setHelp] = useState<Task | null>(null)
  const [error, setError] = useState(''), [busy, setBusy] = useState(false), gate = useRef(false)
  const [dateTouched, setDateTouched] = useState(false)
  const recognized = recognizeQuickSchedule(title)
  const refresh = async () => setTasks(await listTasks())
  useEffect(() => {
    let disposed = false
    const load = () => { void listTasks().then(t => { if (!disposed) setTasks(t) }).catch(e => { if (!disposed) setError(String(e)) }) }
    load(); const subscription = onTasksChanged(load)
    return () => { disposed = true; void subscription.then(fn => fn()).catch(() => {}) }
  }, [])
  useEffect(() => {
    if (focused || !proactive || !tasks.length) return
    let disposed = false
    void Promise.all([getSetting('preparation_help_cooldown'), listPreparations()]).then(async ([cooldown, home]) => {
      if (disposed || Number(cooldown ?? 0) > Date.now()) return
      const candidate = tasks.find(t => !isTaskDoneToday(t) && !['shelved', 'done'].includes(t.status) && !home.rules.some(r => r.taskId === t.id))
      if (!candidate) return
      await setSetting('preparation_help_cooldown', String(Date.now() + 7 * 86400000))
      if (!disposed) setHelp(candidate)
    }).catch(() => {})
    return () => { disposed = true }
  }, [tasks[0]?.id, focused, proactive])
  const act = async (job: () => Promise<unknown>) => {
    if (gate.current) return
    gate.current = true; setBusy(true); setError('')
    try { await job(); await refresh() } catch (e) { setError(String(e)) } finally { gate.current = false; setBusy(false) }
  }
  const visible = tasks.filter(t => search.trim() ? t.title.includes(search.trim()) : t.plannedDate === taskDayNow() || !t.plannedDate || t.deadline?.slice(0, 10) === taskDayNow()).slice(0, 15)
  return <div className="xm-pet-quick-tasks">
    <p className="xm-pet-menu-help">这里和主程序使用同一份安排。完成会按现有规则结算，准备约定到原任务中管理。</p>
    {help && !focused && <div className="xm-pet-help-offer"><p>「{help.title}」要不要提前准备资料？</p><button disabled={busy} onClick={() => void act(async () => { await invoke('open_preparation_task', { taskId: help.id }); setHelp(null) })}>到这项任务看看</button><button onClick={() => setHelp(null)}>稍后</button></div>}
    <form onSubmit={e => { e.preventDefault(); void act(async () => { await createTask({ title: title.trim(), form: 'encounter', deadline: date ? new Date(date).toISOString() : null, recurrence: recognized?.recurrence ?? 'none', recurDays: recognized?.recurDays ?? null }); setTitle(''); setDate(''); setDateTouched(false) }) }}>
      <label>随手记一件事<input required maxLength={400} value={title} onChange={e => { setTitle(e.target.value); if (!dateTouched) setDate(recognizeQuickSchedule(e.target.value)?.localTime ?? '') }} placeholder="例如：明晚七点复习第三章" /></label>
      <label>什么时候<input type="datetime-local" value={date} onChange={e => { setDate(e.target.value); setDateTouched(true) }} /></label>
      {recognized && <small>识别到 {recognized.localTime.replace('T', ' ')}{recognized.recurrence === 'daily' ? '，每天重复' : recognized.recurrence === 'weekly' ? '，每周重复' : ''}。上面的时间可以直接修改。</small>}
      <button className="xm-pet-menu-primary" disabled={busy || !title.trim()}>记进任务</button>
    </form>
    <input type="search" aria-label="查找已有安排" value={search} onChange={e => setSearch(e.target.value)} placeholder="查找已有安排" />
    <ul className="xm-pet-task-list">{visible.map(task => <li key={task.id}>
      <button disabled={busy} aria-label={(isTaskDoneToday(task) ? '撤销完成 ' : '完成 ') + task.title} onClick={() => void act(() => isTaskDoneToday(task) ? reopenTask(task.id) : completeTask(task.id))}>{isTaskDoneToday(task) ? '✓' : '○'}</button>
      <div><button className="xm-pet-task-title" onClick={() => void act(() => invoke('open_preparation_task', { taskId: task.id }))}>{task.title}</button><small>{task.deadline ? new Date(task.deadline).toLocaleString('zh-CN') : '时间未定'}{task.importance === 5 ? ' · 重点' : ''}</small>
        {editing === task.id && <input type="datetime-local" aria-label={task.title + '的新时间'} value={editDate} onChange={e => setEditDate(e.target.value)} />}
      </div>
      {editing === task.id ? <button disabled={busy} onClick={() => void act(async () => { await updateTask(task.id, { deadline: editDate ? new Date(editDate).toISOString() : null }); setEditing(null); setEditDate('') })}>保存时间</button> : <button disabled={busy} onClick={() => { setEditing(task.id); setEditDate(task.deadline ? localDateTime(task.deadline) : '') }}>改时间</button>}
      {!isTaskDoneToday(task) && <button disabled={busy} onClick={() => void act(() => updateTask(task.id, { importance: 5, plannedDate: taskDayNow() }))}>今日重点</button>}
    </li>)}</ul>
    {!visible.length && <p>今天的小纸条还空着，记下一件事就好。</p>}
    {error && <p role="alert" className="xm-pet-menu-error">{error}</p>}
  </div>
}
