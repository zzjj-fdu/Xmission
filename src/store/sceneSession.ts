import { create } from 'zustand'
import { scenePhaseAt } from '../scenes'
import type { ScenePhase } from '../scenes'

interface SceneSession {
  phase: ScenePhase
  openedAt: Date
  visible: boolean
  reopen: () => void
  hide: () => void
}

function initialOpenedAt(): Date {
  const saved = sessionStorage.getItem('xmission-scene-theme-refresh')
  sessionStorage.removeItem('xmission-scene-theme-refresh')
  const date = saved ? new Date(saved) : new Date()
  return Number.isFinite(date.getTime()) ? date : new Date()
}

const openedAt = initialOpenedAt()
export const useSceneSession = create<SceneSession>((set) => ({
  phase: scenePhaseAt(openedAt), openedAt, visible: true,
  reopen: () => {
    const now = new Date()
    set({ phase: scenePhaseAt(now), openedAt: now, visible: true })
  },
  hide: () => set({ visible: false }),
}))
