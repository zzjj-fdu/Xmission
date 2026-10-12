import { useEffect, useRef, useState } from 'react'
import { listen } from '@tauri-apps/api/event'
import { usePomodoroStore } from '../store/pomodoro'
import { remainingSecsNow } from '../api/pomodoro'
import { activeTheme } from '../themes'

/** Only the main window owns this AudioContext. No global media controls. */
export function FocusEnvironment() {
  const session = usePomodoroStore(s => s.session)
  const error = usePomodoroStore(s => s.environmentError)
  const audio = useRef<{ context: AudioContext; source: AudioBufferSourceNode; id: string } | null>(null)
  const [soundError, setSoundError] = useState(''), [soundOn, setSoundOn] = useState(false)
  const stop = () => {
    const owned = audio.current
    audio.current = null
    if (owned) { owned.source.stop(); void owned.context.close().catch(() => {}) }
    setSoundOn(false)
  }
  useEffect(() => {
    let disposed = false, unlisten: (() => void) | undefined
    void listen<{ sessionId: string; sound: string }>('focus-environment', async ({ payload }) => {
      const current = usePomodoroStore.getState().session
      if (!current || current.id !== payload.sessionId || current.state !== 'running' || remainingSecsNow(current) <= 0) return
      stop(); setSoundError('')
      if (payload.sound === 'none') return
      let context: AudioContext | null = null
      try {
        context = new AudioContext()
        const buffer = context.createBuffer(1, context.sampleRate * 4, context.sampleRate)
        const samples = buffer.getChannelData(0)
        let previous = 0
        for (let i = 0; i < samples.length; i++) {
          const noise = Math.random() * 2 - 1
          previous = (previous + .025 * noise) / 1.025
          samples[i] = payload.sound === 'brown' ? previous * 4 : noise * .2 + previous
        }
        const source = context.createBufferSource(), gain = context.createGain()
        source.buffer = buffer; source.loop = true; gain.gain.value = .12
        source.connect(gain); gain.connect(context.destination)
        audio.current = { context, source, id: payload.sessionId }; source.start()
        await context.resume()
        if (audio.current?.context !== context) { if (context.state !== 'closed') void context.close().catch(() => {}); return }
        if (disposed || usePomodoroStore.getState().session?.id !== payload.sessionId) { stop(); return }
        if (context.state !== 'running') setSoundError('环境声尚未播放，点击下方按钮开启')
        setSoundOn(true)
      } catch (e) {
        if (context && audio.current?.context !== context) { void context.close().catch(() => {}); return }
        stop(); setSoundError(`环境声无法播放：${String(e)}`)
      }
    }).then(fn => { if (disposed) fn(); else unlisten = fn }).catch(() => {})
    return () => { disposed = true; unlisten?.(); stop() }
  }, [])
  useEffect(() => {
    const check = () => {
      const owned = audio.current
      if (!owned) return
      if (!session || owned.id !== session.id || remainingSecsNow(session) <= 0) { stop(); return }
      if (session.state === 'paused') void owned.context.suspend().catch(() => {})
      else void owned.context.resume().catch(() => {})
    }
    check(); const timer = window.setInterval(check, 1000)
    return () => window.clearInterval(timer)
  }, [session?.id, session?.state, session?.updatedAt])
  if (!error && !soundOn && !soundError) return null
  return <div className="xm-focus-environment" style={{ position: 'fixed', bottom: 12, right: 16, zIndex: 70, maxWidth: 360, padding: 10, background: activeTheme.colors.panel, color: activeTheme.colors.text, border: `1px solid ${activeTheme.colors.goldDark}`, borderRadius: 8, fontSize: 12 }}>
    {error && <p role="alert">{error}</p>}{soundError && <p role="status">{soundError}</p>}
    {soundOn && <><button onClick={stop}>关闭本次环境声</button>{soundError && <button onClick={() => void audio.current?.context.resume().then(() => setSoundError('')).catch(e => setSoundError(String(e)))}>播放环境声</button>}</>}
  </div>
}
