import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import type { UnlistenFn } from '@tauri-apps/api/event';

/** 与 Rust 侧 Step serde camelCase 一一对应（M2 契约 §2.1） */
export interface Step {
  id: string;
  taskId: string;
  parentStepId: string | null;
  title: string;
  orderIndex: number;
  deadline: string | null;
  estimatedMin: number | null;
  surfaceDays: number | null;
  status: string;
  completedAt: string | null;
}

export async function addStep(
  taskId: string,
  title: string,
  parentStepId?: string | null,
  deadline?: string | null,
  estimatedMin?: number | null,
): Promise<Step> {
  return invoke<Step>('add_step', {
    taskId,
    title,
    parentStepId: parentStepId ?? null,
    deadline: deadline ?? null,
    estimatedMin: estimatedMin ?? null,
  });
}

export async function updateStep(
  id: string,
  patch: { title?: string | null; deadline?: string | null; estimatedMin?: number | null },
): Promise<Step> {
  return invoke<Step>('update_step', { id, ...patch });
}

export async function completeStep(id: string): Promise<Step> {
  return invoke<Step>('complete_step', { id });
}

export async function reopenStep(id: string): Promise<Step> {
  return invoke<Step>('reopen_step', { id });
}

export async function deleteStep(id: string): Promise<void> {
  return invoke<void>('delete_step', { id });
}

export async function listSteps(taskId: string): Promise<Step[]> {
  return invoke<Step[]>('list_steps', { taskId });
}

/** 订阅步骤写操作后的 steps-changed 事件 */
export function onStepsChanged(cb: () => void): Promise<UnlistenFn> {
  return listen('steps-changed', cb);
}
