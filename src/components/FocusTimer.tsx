import { useEffect, useState } from 'react'
import { remainingSecsNow } from '../api/pomodoro'
import type { PomodoroSession } from '../api/pomodoro'

export function FocusTimer({ session, minutes }: { session: PomodoroSession | null; minutes: string }) {
  const [, tick] = useState(0)
  useEffect(() => {
    if (session?.state !== 'running') return
    const timer = window.setInterval(() => tick((value) => value + 1), 1000)
    return () => window.clearInterval(timer)
  }, [session?.state])
  const seconds = session ? remainingSecsNow(session) : Math.min(180, Math.max(1, Math.round(Number(minutes) || 25))) * 60
  return <strong>{String(Math.floor(seconds / 60)).padStart(2, '0')}:{String(seconds % 60).padStart(2, '0')}</strong>
}
