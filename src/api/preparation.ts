import { invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'
export type PreparationKind = 'writing' | 'study' | 'focus'
export interface PreparationConfig {
  topic: string; outputRoot: string; sources: string[]; reading: string; mistakes: string
  search: boolean; referenceLimit: number; focusMin: number; sound: 'none' | 'rain' | 'brown'
  openSources: boolean; notify: boolean
}
export interface PreparationRule {
  id: string; taskId: string; kind: PreparationKind; configJson: string; startAt: string
  leadMin: number; enabled: boolean; needsAuthorization: boolean; version: number; createdAt: string; updatedAt: string
}
export interface PreparationRun {
  id: string; ruleId: string; taskId: string; version: number; actionAt: string; dueAt: string
  state: 'queued' | 'running' | 'ready' | 'failed' | 'cancelled' | 'skipped' | 'stale'
  attempt: number; outputDir: string | null; resultJson: string | null; error: string | null
  createdAt: string; updatedAt: string
}
export interface PreparationResult {
  summary: string; artifacts: { name: string; path: string; bytes: number }[]
  sources: { title?: string; url?: string; location?: string; access?: string; note?: string }[]
  scope: string; version: number; runId: string
}
export interface PreparationHome { rules: PreparationRule[]; runs: PreparationRun[]; paused: boolean; boundary: string }
export const listPreparations = (taskId: string | null = null) => invoke<PreparationHome>('list_preparations', { taskId })
export const savePreparation = (input: { taskId: string; kind: PreparationKind; startAt: string; leadMin: number; config: PreparationConfig }) => invoke<PreparationRule>('save_preparation', { input })
export const pausePreparation = (id: string, paused: boolean) => invoke('pause_preparation', { id, paused })
export const retryPreparation = (id: string) => invoke('retry_preparation', { id })
export const openPreparationArtifact = (id: string, name: string | null = null) => invoke('open_preparation_artifact', { id, name })
export const onPreparationsChanged = (refresh: () => void) => listen('preparations-changed', refresh)
export const preparationLabels: Record<PreparationRun['state'], string> = {
  queued: '等待准备', running: '后台准备中', ready: '资料已备好', failed: '尚未准备好',
  cancelled: '已停止', skipped: '已跳过过期安排', stale: '旧版本资料',
}
export function readPreparationResult(run: PreparationRun): PreparationResult | null {
  try { return run.resultJson ? JSON.parse(run.resultJson) as PreparationResult : null } catch { return null }
}
