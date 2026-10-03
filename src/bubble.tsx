import { StrictMode, useEffect, useRef } from 'react'
import { createRoot } from 'react-dom/client'
import { emit, listen } from '@tauri-apps/api/event'
import { invoke } from '@tauri-apps/api/core'
import { activeTheme } from './themes'
import xmissionIcon from './assets/xmission-icon.png'

function Bubble() {
  const dragging = useRef(false)
  const pointerStart = useRef<{ x: number; y: number } | null>(null)
  useEffect(() => {
    void invoke('prepare_bubble_window').catch(console.error)
    let disposed = false
    let unlisten: (() => void) | undefined
    void listen<{ key: string }>('settings-changed', ({ payload }) => {
      if (payload.key === 'theme') window.location.reload()
    }).then((fn) => { if (disposed) fn(); else unlisten = fn }).catch(console.error)
    return () => { disposed = true; unlisten?.() }
  }, [])

  return <button type="button" aria-label="展开 Xmission 任务栏" title="点击展开 · 拖动移动 · 右键关闭"
    onPointerDown={(event) => {
      if (event.button !== 0 || dragging.current) return
      event.preventDefault()
      pointerStart.current = { x: event.screenX, y: event.screenY }
      dragging.current = true
      void invoke<{ moved: boolean; x: number; y: number }>('drag_bubble').then((result) => {
        if (result.moved) localStorage.setItem('xmission-bubble-position', JSON.stringify({ x: result.x, y: result.y }))
      }).catch(console.error).finally(() => { dragging.current = false })
    }}
    onClick={(event) => {
      const start = pointerStart.current
      pointerStart.current = null
      if (!start || Math.hypot(event.screenX - start.x, event.screenY - start.y) >= 4) return
      void emit('widget:show').catch(console.error)
    }}
    onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') void emit('widget:show').catch(console.error) }}
    onContextMenu={(event) => { event.preventDefault(); pointerStart.current = null; void invoke('show_widget_context_menu').catch(console.error) }}
    style={{ width: 43, height: 43, minWidth: 0, minHeight: 0, borderRadius: '50%', padding: 2, margin: 0, border: `2px solid ${activeTheme.colors.accent}`,
      background: activeTheme.colors.panel, display: 'grid', placeItems: 'center', overflow: 'hidden', cursor: 'grab', touchAction: 'none', boxSizing: 'border-box' }}>
    <img src={xmissionIcon} width={35} height={35} alt="" draggable={false} style={{ width: 35, height: 35, minWidth: 0, objectFit: 'contain', borderRadius: '50%', pointerEvents: 'none' }} />
  </button>
}

createRoot(document.getElementById('root')!).render(<StrictMode><Bubble /></StrictMode>)
