import { create } from 'zustand'
import { passageBetween } from '../scenes/environment'
import type { PassageKind } from '../scenes/environment'
import type { ScenePhase } from '../scenes'

export interface ScenePassage { from: ScenePhase; to: ScenePhase; kind: PassageKind; commit: () => void; startedAt: number; previewProgress?: number }
interface PassageState { pending: ScenePassage | null; active: ScenePassage | null; start: () => void; finish: () => void }
export const useScenePassage = create<PassageState>((set, get) => ({
  pending: null, active: null,
  start: () => { const pending = get().pending; if (pending) set({ pending: null, active: { ...pending, startedAt: performance.now() } }) },
  finish: () => { const passage = get().pending ?? get().active; set({ pending: null, active: null }); passage?.commit() },
}))
export function requestScenePassage(from: ScenePhase, to: ScenePhase, commit: () => void): boolean {
  const kind = passageBetween(from, to)
  if (!kind || !document.documentElement.hasAttribute('data-xm-main') || document.hidden) return false
  const current = useScenePassage.getState()
  if (current.active) return current.active.to === to
  useScenePassage.setState({ pending: { from, to, kind, commit, startedAt: 0 } })
  return true
}
