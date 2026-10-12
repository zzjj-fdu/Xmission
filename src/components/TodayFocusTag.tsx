import { useEffect, useRef, useState } from 'react'
import { listen } from '@tauri-apps/api/event'
import { getSetting, setSetting } from '../api/settings'
import { taskDayNow } from '../api/tasks'

// A detail-only tag. It never changes importance, a deadline or the AI's planned date.
export function TodayFocusTag({ taskId }: { taskId: string }) {
  const key = `task_today_focus:${taskId}`
  const [date, setDate] = useState<string | null>(null), [busy, setBusy] = useState(false), [error, setError] = useState('')
  const gate = useRef(false)
  useEffect(() => {
    let alive = true
    void getSetting(key).then(value => { if (alive) setDate(value) }).catch(e => { if (alive) setError(String(e)) })
    const sub = listen<{ key: string; value: string } | null>('settings-changed', ({ payload }) => {
      if (!alive) return
      if (payload?.key === key) setDate(payload.value)
      else if (!payload) void getSetting(key).then(value => { if (alive) setDate(value) }).catch(e => { if (alive) setError(String(e)) })
    })
    return () => { alive = false; void sub.then(fn => fn()).catch(() => {}) }
  }, [key])
  return <span style={{ alignSelf: 'center', fontSize: 12 }}>
    <label style={{ display: 'inline-flex', alignItems: 'center', gap: 5, cursor: 'pointer' }}>
      <input type="checkbox" checked={date === taskDayNow()} disabled={busy} onChange={e => {
        if (gate.current) return
        gate.current = true; setBusy(true); setError('')
        const value = e.target.checked ? taskDayNow() : ''
        void setSetting(key, value).then(() => setDate(value)).catch(e => setError(String(e))).finally(() => { gate.current = false; setBusy(false) })
      }} />今日重点
    </label>
    {error && <small role="alert" style={{ display: 'block' }}>{error}</small>}
  </span>
}
