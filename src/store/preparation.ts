import { create } from 'zustand'
import { listPreparations, type PreparationHome } from '../api/preparation'
interface PreparationState extends PreparationHome { error: string; refresh: () => Promise<void> }
let fetching: Promise<void> | null = null
let requested = false
export const usePreparationStore = create<PreparationState>((set) => ({
  rules: [], runs: [], paused: false, boundary: '', error: '',
  refresh: () => {
    requested = true
    fetching ??= (async () => {
      do {
        requested = false
        const data = await listPreparations()
        if (!requested) set({ ...data, error: '' })
      } while (requested)
    })().catch(e => { set({ error: String(e) }); throw e }).finally(() => { fetching = null })
    return fetching
  },
}))
