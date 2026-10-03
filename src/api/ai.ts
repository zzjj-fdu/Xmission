import { invoke } from '@tauri-apps/api/core';

/** 与 Rust 侧 serde camelCase 模型一一对应（M4 AI 参谋） */

/** 自然语言录入解析出的任务草稿（所有字段在前端确认卡中可改） */
export interface TaskDraft {
  title: string;
  details: string | null;
  importance: number;
  urgency: number;
  deadline: string | null;
  estimatedMin: number | null;
  /** 13 分类 key 之一或 '' */
  icon: string;
  /** none | daily | weekly */
  recurrence: string;
  recurDays: string | null;
}

/** 主线分解出的支线步骤草稿 */
export interface StepDraft {
  title: string;
  estimatedMin: number | null;
  orderHint: number;
}

export interface WeekPlanItem {
  taskId: string;
  startTime: string;
  endTime: string;
  note: string | null;
}

export interface WeekPlanDay {
  date: string;
  items: WeekPlanItem[];
  restAdvice: string | null;
}

export interface WeekPlan {
  /** ai_suggestions 记录 id，采纳/忽略时回写状态 */
  suggestionId: string;
  days: WeekPlanDay[];
}

export interface SlotSuggestion {
  date: string;
  startTime: string;
  endTime: string;
  reason: string;
}

/** 后端「LLM 未配置」错误的前缀（ai.rs ERR_NOT_CONFIGURED） */
export const LLM_NOT_CONFIGURED_PREFIX = 'LLM 未配置';

export function isLlmNotConfigured(err: unknown): boolean {
  return typeof err === 'string' && err.startsWith(LLM_NOT_CONFIGURED_PREFIX);
}

/** 自然语言 → 任务草稿。LLM 未配置/失败抛中文错误 */
export async function aiParseTask(text: string): Promise<TaskDraft> {
  return invoke<TaskDraft>('ai_parse_task', { text });
}

/** 主线任务 → AI 分解步骤草稿（3-8 个）。未配置/失败抛中文错误 */
export async function aiDecomposeTask(taskId: string): Promise<StepDraft[]> {
  return invoke<StepDraft[]>('ai_decompose_task', { taskId });
}

/** 轻量图标归类：永远成功返回，未配置/失败回退 ''（不阻塞任何流程） */
export async function aiClassifyIcon(title: string, details: string): Promise<string> {
  return invoke<string>('ai_classify_icon', { title, details });
}

/** 生成周计划（weekOffset 0=本周）。未配置/失败抛中文错误 */
export async function aiPlanWeek(weekOffset: number): Promise<WeekPlan> {
  return invoke<WeekPlan>('ai_plan_week', { weekOffset });
}

/** 单任务时段推荐。未配置/失败抛中文错误 */
export async function aiSuggestSlot(taskId: string): Promise<SlotSuggestion> {
  return invoke<SlotSuggestion>('ai_suggest_slot', { taskId });
}

/** 回写建议状态：adopted | dismissed */
export async function updateSuggestionStatus(
  id: string,
  status: 'adopted' | 'dismissed',
): Promise<void> {
  return invoke<void>('update_suggestion_status', { id, status });
}
