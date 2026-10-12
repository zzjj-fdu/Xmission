import { invoke } from '@tauri-apps/api/core'
export interface GoalPreference { taskId: string; focused: boolean; stageAck: string | null; manualOrder: number }
export interface Action { key: string; taskId: string; stepId: string | null; title: string; goalTitle: string; estimatedMin: number; deadline: string | null; reasons: string[]; focused: boolean }
export interface Stage { id: string; title: string; done: number; total: number; complete: boolean; deadline: string | null }
export interface Goal { taskId: string; title: string; paused: boolean; completed: boolean; focused: boolean; done: number; total: number; stages: Stage[]; activeStage: string | null; advanceFrom: string | null; pauseSuggested: boolean }
export interface Scheduled { entityKey: string; taskId: string; stepId: string | null; startsAt: string; endsAt: string }
export interface GoalOverview { today: string; actions: Action[]; goals: Goal[]; preferences: GoalPreference[]; schedule: Scheduled[]; overload: string | null; dailyBudget: number }
export interface Proposal { key: string; taskId: string; stepId: string | null; title: string; previous: string | null; startsAt: string | null; endsAt: string | null; minutes: number; warning: string | null; reasons: string[] }
export interface PlanPreview { id: string; rows: Proposal[]; notes: string[]; createdAt: string }
export interface ProgressReview { days: number; trend: { date: string; tasks: number; steps: number; checkins: number; focusMin: number }[]; comparisons: { id: string; title: string; estimatedMin: number | null; actualFocusMin: number | null; differenceMin: number | null }[]; goals: Goal[]; note: string }
export interface DeletedItem { id: string; kind: 'task' | 'step'; entityId: string; title: string; deletedAt: string }
export const goalOverview = () => invoke<GoalOverview>('get_goal_overview')
export const setGoalFocus = (taskId: string | null) => invoke<void>('set_goal_focus', { taskId })
export const advanceGoalStage = (taskId: string, stageId: string) => invoke<void>('advance_goal_stage', { taskId, stageId })
export const configureStepPlan = (id: string, deadline: string | null, estimatedMin: number | null, surfaceDays: number | null) => invoke<void>('configure_step_plan', { id, deadline, estimatedMin, surfaceDays })
export const reorderWork = (kind: 'task' | 'step', ids: string[]) => invoke<void>('reorder_work', { kind, ids })
export const previewReplan = () => invoke<PlanPreview>('preview_replan')
export const applyReplan = (id: string) => invoke<void>('apply_replan', { id })
export const progressReview = (days: 7 | 30) => invoke<ProgressReview>('get_progress_review', { days })
export const deletedItems = () => invoke<DeletedItem[]>('list_deleted_items')
export const restoreDeletedItem = (id: string) => invoke<string>('restore_deleted_item', { id })
export const openOriginalTask = (id: string) => window.dispatchEvent(new CustomEvent('preparation:task', { detail: id }))
