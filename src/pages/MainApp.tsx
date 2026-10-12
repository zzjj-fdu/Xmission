import { useEffect, useRef, useState } from 'react'
import { getCurrentWindow } from '@tauri-apps/api/window'
import { listen } from '@tauri-apps/api/event'
import { activeTheme as pixelJrpg, currentThemeKey, themeMarker } from '../themes'
import xmissionIcon from '../assets/xmission-icon.png'
import { PixelIcon } from '../components/PixelIcon'
import type { PixelIconName } from '../components/PixelIcon'
import { WalletCard } from '../components/WalletCard'
import { useProfileStore } from '../store/profile'
import { emitShowWidget } from '../api/window'
import { SceneVisual } from '../components/SceneVisual'
import { usePomodoroStore } from '../store/pomodoro'
import { FocusTimer } from '../components/FocusTimer'
import { getSetting, setSetting } from '../api/settings'
import { currentSceneWeather, useSceneWeatherStore } from '../store/sceneWeather'
import { useSceneSession } from '../store/sceneSession'
import { sceneUrl } from '../scenes'
import { useSceneClock } from '../hooks/useSceneClock'
import { useScenePassageController } from '../hooks/useScenePassage'
import { useSceneEnvironment } from '../hooks/useSceneEnvironment'
import { useScenePassage } from '../store/scenePassage'
import type { ScenePassage } from '../store/scenePassage'
import TasksPage from './TasksPage'
import SchedulePage from './SchedulePage'
import CalendarPage from './CalendarPage'
import ShopPage from './ShopPage'
import SettingsPage from './SettingsPage'
import {SceneCompanionSticker} from '../companions/SceneCompanionSticker'
import { FirstExperience } from '../onboarding/FirstExperience'

type PageKey = 'tasks' | 'schedule' | 'calendar' | 'shop' | 'settings'

const NAV_ITEMS: { key: PageKey; label: string; icon: PixelIconName }[] = [
  { key: 'tasks', label: '任务', icon: 'scroll' },
  { key: 'schedule', label: '课表', icon: 'book' },
  { key: 'calendar', label: '日历', icon: 'calendar' },
  { key: 'shop', label: '商店', icon: 'coin' },
  { key: 'settings', label: '设置', icon: 'hourglass' },
]

const SCENE_COPY = {
  'pixel-jrpg': ['把今天，写成冒险。', '勇气会在行动里慢慢长大。', '每完成一步，故事就向前一页。'],
  'parchment-journal': ['把今日写进手账。', '在平凡的一页发现新的路。', '每一页，都留下一点前行的足迹。'],
  'animal-crossing': ['今天也有小小快乐。', '慢慢来，岛上的风会等你。', '照顾好眼前的小事。'],
  'stardew-valley': ['播下今天的第一粒种子。', '把日子种成喜欢的样子。', '收获从认真过好今天开始。'],
} as const

const PASSAGE_COPY = {
  'pixel-jrpg': { name:'YOUR NEXT ADVENTURE', sunrise:'山巅亮起，新的旅程就要开始。', sunset:'让最后一束光，照亮归途。', lamps:'城堡的灯火，为旅人守夜。' },
  'parchment-journal': { name:'FIELD NOTES', sunrise:'薄雾散开，翻到新的一页。', sunset:'把山谷的余晖，写进今天。', lamps:'远方灯火亮了，故事还在继续。' },
  'animal-crossing': { name:'ISLAND DAYS', sunrise:'岛上的一天，慢慢醒来。', sunset:'把最后一束阳光，留给今天。', lamps:'一盏一盏，是回家的光。' },
  'stardew-valley': { name:'THE FARM TODAY', sunrise:'田野醒了，今天的种子等着你。', sunset:'晚风收起阳光，也收起一天的辛劳。', lamps:'木屋灯亮了，萤火虫陪你回家。' },
} as const

export default function MainApp() {
  useSceneClock()
  const [page, setPage] = useState<PageKey>('tasks')
  const [selectedTaskId, setSelectedTaskId] = useState<string>()
  const [selectionVersion, setSelectionVersion] = useState(0)
  const selectTask = (id: string) => { setPage('tasks'); setSelectedTaskId(id); setSelectionVersion(v => v + 1) }
  useEffect(() => {
    const task = (e: Event) => selectTask((e as CustomEvent<string>).detail)
    window.addEventListener('preparation:task', task)
    return () => window.removeEventListener('preparation:task', task)
  }, [])
  const [sceneWidth, setSceneWidth] = useState(() => {
    const raw = localStorage.getItem('xmission-scene-width')
    const saved = raw == null ? 300 : Number(raw)
    return Number.isFinite(saved) && saved >= 0 ? Math.min(saved, Math.max(0, window.innerWidth - 196)) : 300
  })
  const [draggingScene, setDraggingScene] = useState(false)
  const [focusMode, setFocusMode] = useState(false)
  useScenePassageController(draggingScene || focusMode)
  const passage = useScenePassage(s => s.active)
  const [lastPassage, setLastPassage] = useState<ScenePassage | null>(null)
  const visiblePassage = passage ?? lastPassage
  const [focusMinutes, setFocusMinutes] = useState('25')
  const [focusError, setFocusError] = useState('')
  const sceneBeforeFocus = useRef(300)
  const pomodoro = usePomodoroStore((s) => s.session)
  const startPomodoro = usePomodoroStore((s) => s.start)
  const pausePomodoro = usePomodoroStore((s) => s.pause)
  const resumePomodoro = usePomodoroStore((s) => s.resume)
  const finishPomodoro = usePomodoroStore((s) => s.finish)
  const wallet = useProfileStore((s) => s.wallet)
  const { colors, font } = pixelJrpg
  const themeKey = currentThemeKey()
  const displayedWeather = useSceneWeatherStore(currentSceneWeather)
  const environment = useSceneEnvironment(displayedWeather)
  const sceneMotion = useSceneWeatherStore((state) => state.motion)
  const sceneSession = useSceneSession()
  const background = sceneUrl(themeKey, sceneSession.phase)
  const focusThreshold = window.innerWidth * .67
  const focusPreview = draggingScene && sceneWidth + (window.innerWidth <= 740 ? 62 : 188) >= focusThreshold
  const today = sceneSession.openedAt
  const dailyCopy = SCENE_COPY[themeKey][Math.floor(Date.UTC(today.getFullYear(), today.getMonth(), today.getDate()) / 86400000) % SCENE_COPY[themeKey].length]

  useEffect(() => {
    void useSceneWeatherStore.getState().hydrate()
    document.documentElement.setAttribute('data-xm-main','')
    return () => { document.documentElement.removeAttribute('data-xm-main'); useScenePassage.setState({ pending:null,active:null }) }
  }, [])

  useEffect(() => {
    document.documentElement.dataset.xmMotion = sceneMotion
  }, [sceneMotion])
  useEffect(() => {
    const update = () => { document.documentElement.dataset.xmSceneVisible = String(sceneSession.visible && !document.hidden) }
    update(); document.addEventListener('visibilitychange',update)
    return () => document.removeEventListener('visibilitychange',update)
  }, [sceneSession.visible])

  useEffect(() => {
    if (!passage) {
      const timer = window.setTimeout(() => setLastPassage(null),600)
      return () => window.clearTimeout(timer)
    }
    setLastPassage(passage)
    const before = document.activeElement instanceof HTMLElement ? document.activeElement : null
    const shell = document.querySelector<HTMLElement>('.xm-shell')
    if (shell) shell.inert = true
    document.querySelector<HTMLButtonElement>('.xm-passage-skip')?.focus({preventScroll:true})
    const escape = (event: KeyboardEvent) => { if (event.key==='Escape') { event.preventDefault(); useScenePassage.getState().finish() } }
    document.addEventListener('keydown',escape)
    return () => {
      if (shell) shell.inert = false
      if (before?.isConnected) before.focus({preventScroll:true})
      document.removeEventListener('keydown',escape)
    }
  }, [passage])

  useEffect(() => {
    if (!sceneSession.visible) return
    void useSceneWeatherStore.getState().refresh()
    const timer = window.setInterval(() => { void useSceneWeatherStore.getState().refresh() }, 30 * 60_000)
    return () => window.clearInterval(timer)
  }, [sceneSession.visible])

  useEffect(() => {
    let disposed = false
    let unlisten: (() => void) | undefined
    void listen('main:opened', () => useSceneSession.getState().reopen()).then((fn) => {
      if (disposed) fn()
      else unlisten = fn
    }).catch(() => { /* Browser preview has no native window events. */ })
    return () => { disposed = true; unlisten?.() }
  }, [])

  useEffect(() => {
    void getSetting('pomodoro_work_min').then((value) => {
      const minutes = Number(value)
      if (Number.isInteger(minutes) && minutes >= 1 && minutes <= 180) setFocusMinutes(String(minutes))
    }).catch(() => { /* browser preview uses the default */ })
  }, [])

  useEffect(() => {
    let disposed=false,stop:(()=>void)|undefined
    const navigate=(value:unknown)=>{if(NAV_ITEMS.some(item=>item.key===value))setPage(value as PageKey)}
    const local=(event:Event)=>navigate((event as CustomEvent).detail)
    window.addEventListener('companion:navigate',local)
    void listen<{page:string;taskId?:string}>('main:navigate',event=>{navigate(event.payload?.page);if(event.payload.taskId)selectTask(event.payload.taskId)}).then(fn=>{if(disposed)fn();else stop=fn}).catch(()=>{})
    return()=>{disposed=true;stop?.();window.removeEventListener('companion:navigate',local)}
  }, [])

  const enterFocus = () => {
    setFocusError('')
    setFocusMode(true)
    if (!pomodoro) void getSetting('pomodoro_work_min').then((value) => {
      const minutes = Number(value)
      if (Number.isInteger(minutes) && minutes >= 1 && minutes <= 180) setFocusMinutes(String(minutes))
    }).catch(() => { /* Keep the current input when settings are unavailable. */ })
    try { void getCurrentWindow().setFullscreen(true).catch(console.error) } catch { /* browser preview */ }
  }
  const leaveFocusView = () => {
    setFocusMode(false)
    setSceneWidth(sceneBeforeFocus.current)
    try { void getCurrentWindow().setFullscreen(false).catch(console.error) } catch { /* browser preview */ }
  }
  const exitFocus = async () => {
    if (pomodoro) {
      try { await finishPomodoro(false) }
      catch (error) { setFocusError(`重置计时失败：${String(error)}`); return }
    }
    leaveFocusView()
  }
  const returnToTasks = () => { leaveFocusView(); setPage('tasks') }
  const startFocusTimer = async () => {
    const minutes = Math.min(180, Math.max(1, Math.round(Number(focusMinutes) || 25)))
    setFocusMinutes(String(minutes))
    setFocusError('')
    try {
      await setSetting('pomodoro_work_min', String(minutes))
      await startPomodoro()
    } catch (error) { setFocusError(`启动计时失败：${String(error)}`) }
  }

  useEffect(() => {
    if (!focusMode) return
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') void exitFocus() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [focusMode, pomodoro])

  useEffect(() => {
    if (!draggingScene) return
    const move = (event: PointerEvent) => {
      const navWidth = window.innerWidth <= 740 ? 62 : 188
      const maxWidth = Math.max(0, window.innerWidth - navWidth - 8)
      setSceneWidth(Math.min(maxWidth, Math.max(0, event.clientX - navWidth)))
    }
    const stop = (event?: PointerEvent) => {
      if (event && event.clientX >= window.innerWidth * .67) enterFocus()
      setDraggingScene(false)
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
    }
    document.body.style.cursor = 'col-resize'
    document.body.style.userSelect = 'none'
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', stop)
    return () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', stop)
      stop()
    }
  }, [draggingScene])

  useEffect(() => {
    const timer = window.setTimeout(() => localStorage.setItem('xmission-scene-width', String(sceneWidth)), 160)
    return () => window.clearTimeout(timer)
  }, [sceneWidth])

  useEffect(() => {
    const resize = () => setSceneWidth((width) => Math.min(width, Math.max(0, window.innerWidth - (window.innerWidth <= 740 ? 62 : 188) - 8)))
    window.addEventListener('resize', resize)
    return () => window.removeEventListener('resize', resize)
  }, [])

  useEffect(() => {
    let disposed = false
    let unlisten: (() => void) | undefined
    try {
      void getCurrentWindow().onCloseRequested((event) => {
        event.preventDefault()
        void getCurrentWindow().hide().then(() => useSceneSession.getState().hide()).catch(console.error)
      }).then((fn) => { if (disposed) fn(); else unlisten = fn }).catch((error) => console.error('[main] 关闭拦截失败', error))
    } catch { /* browser preview */ }
    return () => { disposed = true; unlisten?.() }
  }, [])

  const windowOp = (action: 'minimize' | 'toggleMaximize' | 'hide') => {
    try {
      void getCurrentWindow()[action]().then(() => {
        if (action === 'hide') useSceneSession.getState().hide()
      }).catch((error: unknown) => console.error('[main] 窗口操作失败', error))
    } catch { /* Browser preview has no native window. */ }
  }

  return (
    <div className={`xm-window${passage ? ' is-scene-passage' : ''}`} style={{ color: colors.text, fontFamily: font.body, background: colors.bg }}>
      <header className="xm-window-titlebar" data-tauri-drag-region="" style={{ fontFamily: font.display }} onDoubleClick={() => windowOp('toggleMaximize')}>
        <span data-tauri-drag-region="" className="xm-window-title"><img src={xmissionIcon} width={20} height={20} alt="" /> XMISSION <span className="xm-window-title-sub">{NAV_ITEMS.find((item) => item.key === page)?.label}</span></span>
        <div className="xm-window-controls">
          <button type="button" title="最小化" onDoubleClick={(event) => event.stopPropagation()} onClick={() => windowOp('minimize')}>─</button>
          <button type="button" title="最大化或还原" onDoubleClick={(event) => event.stopPropagation()} onClick={() => windowOp('toggleMaximize')}>□</button>
          <button type="button" title="收起到系统托盘" onDoubleClick={(event) => event.stopPropagation()} onClick={() => windowOp('hide')}>×</button>
        </div>
      </header>
      <div className="xm-shell" style={{ display: 'flex', backgroundColor: colors.bg }}>
      {/* JRPG 菜单列：深底金边竖排项，激活项前置 ▶ 像素光标 + 金色描边 */}
      <nav
        className="xm-nav"
        style={{
          width: 188,
          flexShrink: 0,
          background: pixelJrpg.panelBg ?? colors.panel,
          borderRight: `2px solid ${colors.border}`,
          boxShadow: `inset -1px 0 0 0 ${colors.goldDark}`,
          padding: '20px 12px',
          display: 'flex',
          flexDirection: 'column',
          gap: 8,
          boxSizing: 'border-box',
          overflowY: 'auto',
        }}
      >
        <div
          className="xm-brand"
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 6,
            fontFamily: font.display,
            color: colors.accent,
            fontSize: 14,
            letterSpacing: '0.1em',
            padding: '0 0 16px',
            borderBottom: `1px solid ${colors.goldDark}`,
            marginBottom: 8,
          }}
        >
          <PixelIcon name="star" size={28} />
          XMISSION
          <PixelIcon name="star" size={28} />
        </div>
        {NAV_ITEMS.map((item) => {
          const active = page === item.key
          return (
            <button
              className={`xm-nav-item${active ? ' is-active' : ''}`}
              key={item.key}
              onClick={() => setPage(item.key)}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 6,
                background: active ? colors.panelLight : 'transparent',
                border: active
                  ? `2px solid ${colors.accent}`
                  : '2px solid transparent',
                boxShadow: active ? `inset 0 0 0 1px ${colors.goldDark}` : 'none',
                color: active ? colors.accent : colors.textMuted,
                fontFamily: font.display,
                fontSize: 14,
                textAlign: 'left',
                padding: '10px 12px',
                cursor: 'pointer',
              }}
            >
              {/* 激活项前置像素光标 */}
              <span
                style={{
                  width: 14,
                  flexShrink: 0,
                  color: colors.accent,
                  visibility: active ? 'visible' : 'hidden',
                  fontSize: 14,
                  lineHeight: 1,
                }}
              >
                {themeMarker()}
              </span>
              <PixelIcon name={item.icon} size={32} />
              {item.label}
            </button>
          )
        })}
        {/* 钱包区：竖排紧凑钱包卡（纹章+Lv / 满行 XP 条 / 连击+xp计数），数据来自 useProfileStore */}
        {wallet && (
          <div style={{ marginTop: 'auto' }}>
            <WalletCard
              level={wallet.level}
              xp={wallet.xpIntoLevel}
              xpMax={wallet.xpToNext}
              coins={wallet.coins}
              streak={wallet.streak}
            />
          </div>
        )}
        {/* 唤回悬浮窗：广播 widget:show 事件，由悬浮窗自行 show + 聚焦 */}
        <button
          onClick={() => {
            emitShowWidget().catch((err: unknown) =>
              console.error('[main] 唤回悬浮窗失败', err),
            )
          }}
          title="显示桌面悬浮任务栏"
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 6,
            marginTop: wallet ? 0 : 'auto',
            background: 'transparent',
            border: `2px dashed ${colors.goldDark}`,
            color: colors.textMuted,
            fontFamily: font.display,
            fontSize: 13,
            textAlign: 'left',
            padding: '10px 12px',
            cursor: 'pointer',
          }}
        >
          <PixelIcon name="scroll" size={28} />
          显示悬浮窗
        </button>
      </nav>
      <div className="xm-scene" style={{ width: sceneWidth, backgroundImage: `linear-gradient(180deg, transparent 60%, rgba(0,0,0,.38)), url("${background}")` }}>
        {sceneWidth > 0 && !focusMode && !passage && <SceneVisual theme={themeKey} phase={sceneSession.phase} weather={displayedWeather} motion={sceneMotion} active={sceneSession.visible} environment={environment} />}
        <SceneCompanionSticker theme={themeKey} phase={sceneSession.phase} enabled={sceneWidth>0&&!focusMode&&!passage}/>
        <div className="xm-scene-caption" aria-hidden="true">
          <span>{themeKey === 'animal-crossing' ? 'ISLAND DAYS' : themeKey === 'stardew-valley' ? 'THE FARM TODAY' : themeKey === 'parchment-journal' ? 'FIELD NOTES' : 'YOUR NEXT ADVENTURE'}</span>
          <strong>{dailyCopy}</strong>
        </div>
      </div>
      <div className="xm-scene-divider" role="separator" aria-label="调整风景与主页面宽度，拖到页面三分之二进入专注模式" aria-orientation="vertical" aria-valuemin={0} aria-valuemax={Math.max(0, window.innerWidth - (window.innerWidth <= 740 ? 62 : 188) - 8)} aria-valuenow={sceneWidth} tabIndex={0}
        onPointerDown={(event) => { event.preventDefault(); event.currentTarget.setPointerCapture(event.pointerId); sceneBeforeFocus.current = sceneWidth; setDraggingScene(true) }}
        onKeyDown={(event) => {
          if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return
          event.preventDefault()
          const maxWidth = Math.max(0, window.innerWidth - (window.innerWidth <= 740 ? 62 : 188) - 8)
          setSceneWidth((width) => Math.min(maxWidth, Math.max(0, width + (event.key === 'ArrowRight' ? 20 : -20))))
        }}
        onDoubleClick={() => setSceneWidth(300)} />
      <main className="xm-main" style={{
        flex: '1 1 0', padding: 24, overflowY: 'auto', containerType: 'inline-size', containerName: 'xm-main-content',
        ...(themeKey === 'stardew-valley' ? { background: pixelJrpg.appBg } : {}),
      }}>
        <div className="xm-page-kicker">
          <span>✦ XMISSION / {NAV_ITEMS.find((item) => item.key === page)?.label}</span>
          <span>{new Intl.DateTimeFormat('zh-CN', { year: 'numeric', month: 'long', day: 'numeric', weekday: 'long' }).format(new Date())}</span>
        </div>
        {page === 'tasks' ? (
          <TasksPage selectedTaskId={selectedTaskId} selectionVersion={selectionVersion} />
        ) : page === 'schedule' ? (
          <SchedulePage />
        ) : page === 'calendar' ? (
          <CalendarPage />
        ) : page === 'shop' ? (
          <ShopPage />
        ) : (
          <SettingsPage />
        )}
      </main>
      {focusPreview && <div className={`xm-focus-preview xm-focus-preview-${themeKey}`} style={{ left: sceneWidth + (window.innerWidth <= 740 ? 62 : 188) + 8 }} aria-hidden="true">
        <div className="xm-focus-preview-card"><span>✦ XMISSION · FOCUS</span><strong>松开进入专注模式</strong><small>风景铺满屏幕，任务暂时退到身后</small></div>
      </div>}
      </div>
      {focusMode && <div className="xm-focus-mode" style={{ backgroundImage: `linear-gradient(180deg,#0004,#0001 45%,#0006),url("${background}")` }}>
        <SceneVisual theme={themeKey} phase={sceneSession.phase} weather={displayedWeather} motion={sceneMotion} active={sceneSession.visible} environment={environment} />
        <button type="button" className="xm-focus-exit" onClick={() => { void exitFocus() }}>退出专注　×</button>
        <div className={`xm-focus-content ${pomodoro ? 'is-running' : 'is-setup'}`}
          style={pomodoro ? { background: 'none', backdropFilter: 'none', WebkitBackdropFilter: 'none', border: 0, boxShadow: 'none' } : undefined}>
          <span>XMISSION · 专注时刻</span>
          <h1>{dailyCopy}</h1>
          <FocusTimer session={pomodoro} minutes={focusMinutes} />
          {!pomodoro && <label className="xm-focus-duration">专注时长 <input aria-label="专注时长（分钟）" type="number" min="1" max="180" value={focusMinutes} onChange={(event) => setFocusMinutes(event.target.value)} /> 分钟</label>}
          <div className="xm-focus-actions">
            {!pomodoro ? <button onClick={() => { void startFocusTimer() }}>开始专注</button>
              : <button onClick={() => void (pomodoro.state === 'running' ? pausePomodoro() : resumePomodoro()).catch(console.error)}>{pomodoro.state === 'running' ? '暂停' : '继续'}</button>}
            <button onClick={returnToTasks}>返回任务</button>
          </div>
          {focusError && <p role="alert" className="xm-focus-error">{focusError}</p>}
        </div>
      </div>}
      <FirstExperience navigate={(target, id) => { if (NAV_ITEMS.some(item => item.key === target)) setPage(target as PageKey); if (id) selectTask(id) }} />
      {visiblePassage && <div className={`xm-passage-overlay${passage ? '' : ' is-leaving'}`} role="dialog" aria-modal="true" aria-label="风景时间过场">
        <SceneVisual theme={themeKey} phase={visiblePassage.from} atmospherePhase={visiblePassage.to} weather={displayedWeather} motion={sceneMotion} active={sceneSession.visible} environment={environment} passage={visiblePassage} cinematic />
        <div className="xm-passage-caption"><small>{PASSAGE_COPY[themeKey].name} · {displayedWeather === 'rain' ? 'AFTER THE RAIN' : 'A LITTLE CHANGE OF LIGHT'}</small>{PASSAGE_COPY[themeKey][visiblePassage.kind]}</div>
        <button className="xm-passage-skip" disabled={!passage} onClick={() => useScenePassage.getState().finish()}>跳过过场</button>
      </div>}
    </div>
  )
}
