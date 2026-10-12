import { useEffect } from 'react'
import { flushSync } from 'react-dom'
import { currentThemeKey } from '../themes'
import { sceneUrl } from '../scenes'
import { useSceneSession } from '../store/sceneSession'
import { useSceneWeatherStore } from '../store/sceneWeather'
import { solarScenePhase } from '../scenes/environment'
import { requestScenePassage, useScenePassage } from '../store/scenePassage'

type SceneTransition = { finished: Promise<void>; skipTransition: () => void }
type TransitionDocument = Document & { startViewTransition?: (apply: () => void) => SceneTransition }

/** Each native window keeps its clock running, including while the main window is hidden. */
export function useSceneClock() {
  const visible = useSceneSession((state) => state.visible)
  const city = useSceneWeatherStore(s => s.city)
  const observation = useSceneWeatherStore(s => s.observation)
  const motion = useSceneWeatherStore(s => s.motion)
  useEffect(() => {
    if (document.documentElement.hasAttribute('data-xm-lighting-preview')) return
    let disposed = false
    let pendingPhase = ''
    let revision = 0
    let transition: SceneTransition | undefined
    let loadingImage: HTMLImageElement | undefined
    let initialized = false
    const phaseAt = (now: Date) => solarScenePhase(now, city, observation)
    const sync = () => {
      const now = new Date()
      const phase = phaseAt(now)
      const allowPassage = initialized
      initialized = true
      if (phase === useSceneSession.getState().phase) {
        if (now.toDateString() !== useSceneSession.getState().openedAt.toDateString()) useSceneSession.setState({ openedAt: now })
        return
      }
      if (pendingPhase === phase) return
      pendingPhase = phase
      const request = ++revision
      const apply = () => {
        if (disposed || request !== revision) return
        pendingPhase = ''
        // Loading can straddle a boundary or a clock adjustment: always use the current time.
        const current = new Date()
        if (phaseAt(current) !== phase) { sync(); return }
        transition?.skipTransition()
        const update = () => flushSync(() => {
          document.documentElement.dataset.xmLighting = phase === 'night' || phase === 'predawn' ? 'night' : 'day'
          useSceneSession.setState({ phase, openedAt: current })
        })
        if (allowPassage && visible && !document.hidden && document.hasFocus() && motion === 'full'
          && !window.matchMedia('(prefers-reduced-motion: reduce)').matches
          && requestScenePassage(useSceneSession.getState().phase, phase, update)) return
        useScenePassage.setState({ pending: null, active: null })
        const doc = document as TransitionDocument
        if (!document.hidden && motion === 'full' && !window.matchMedia('(prefers-reduced-motion: reduce)').matches && doc.startViewTransition) {
          transition = doc.startViewTransition(update)
          void transition.finished.catch(() => { /* A newer change can replace this transition. */ })
        } else update()
      }
      // Decode the next compressed image before fading to it, avoiding a blank landscape.
      loadingImage = new Image()
      loadingImage.onload = () => { void loadingImage?.decode().catch(() => {}).then(apply) }
      loadingImage.onerror = apply
      loadingImage.src = sceneUrl(currentThemeKey(), phase)
    }
    sync()
    const timer = window.setInterval(sync, 30_000)
    window.addEventListener('focus', sync)
    document.addEventListener('visibilitychange', sync)
    return () => {
      disposed = true
      ++revision
      if (loadingImage) { loadingImage.onload = null; loadingImage.onerror = null }
      transition?.skipTransition()
      window.clearInterval(timer)
      window.removeEventListener('focus', sync)
      document.removeEventListener('visibilitychange', sync)
    }
  }, [visible, city, observation, motion])
}
