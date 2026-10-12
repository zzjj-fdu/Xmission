import { create } from 'zustand'
import { scenePhaseAt } from '../scenes'
import type { ScenePhase } from '../scenes'

interface SceneSession {
  phase: ScenePhase
  openedAt: Date
  visible: boolean
  reopen: () => void
  hide: () => void
  refresh: (now?: Date) => void
}

const openedAt = new Date()
export const useSceneSession = create<SceneSession>((set, get) => ({
  phase: scenePhaseAt(openedAt), openedAt, visible: true,
  reopen: () => {
    set({ visible: true })
  },
  hide: () => set({ visible: false }),
  refresh: (now = new Date()) => {
    const phase = scenePhaseAt(now)
    const state = get()
    if (phase !== state.phase || now.toDateString() !== state.openedAt.toDateString()) {
      set({ phase, openedAt: now })
    }
  },
}))
