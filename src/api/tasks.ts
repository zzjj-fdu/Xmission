import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import type { UnlistenFn } from '@tauri-apps/api/event';

/** 与 Rust 侧 serde camelCase 模型一一对应（见计划「接口契约」） */
export interface Task {
  id: string;
  title: string;
  notes: string | null;
  form: string;
  importance: number;
  urgency: number;
  deadline: string | null;
  estimatedMin: number | null;
  status: string;
  parentId: string | null;
  xpValue: number;
  createdAt: string;
  completedAt: string | null;
  /** none | daily | weekly（M4 循环任务） */
  recurrence: string;
  /** weekly 用：逗号分隔星期 1-7（如 "1,3,5"） */
  recurDays: string | null;
  /** 最近打卡日 YYYY-MM-DD（任务日，4:00 分界） */
  lastDoneDate: string | null;
  /** 连续应做日完成数 */
  streak: number;
  /** 语义分类图标 key（'' = 默认卷轴） */
  icon: string;
  /** AI 周计划/时段推荐采纳后回写的计划日 YYYY-MM-DD */
  plannedDate: string | null;
  /** 计算字段：今天（任务日）是否已打卡 */
  doneToday: boolean;
}

export interface CreateTaskInput {
  title: string;
  notes?: string | null;
  form: string;
  importance?: number | null;
  urgency?: number | null;
  deadline?: string | null;
  estimatedMin?: number | null;
  parentId?: string | null;
  recurrence?: string | null;
  recurDays?: string | null;
  icon?: string | null;
}

export interface UpdateTaskPatch {
  title?: string | null;
  notes?: string | null;
  importance?: number | null;
  urgency?: number | null;
  deadline?: string | null;
  estimatedMin?: number | null;
  status?: string | null;
  recurrence?: string | null;
  recurDays?: string | null;
  icon?: string | null;
  plannedDate?: string | null;
}

/** 全部字段为空 = 查询全部任务 */
export interface TaskFilter {
  status?: string | null;
  form?: string | null;
}

/** 任务日（与 Rust gamification::task_day 一致）：本地时间减 4 小时后的日期 YYYY-MM-DD */
export function taskDayNow(): string {
  const d = new Date(Date.now() - 4 * 3600 * 1000);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

export function isRecurring(task: Task): boolean {
  return task.recurrence !== 'none';
}

/** 今天（任务日，4:00 分界）是否为该循环任务的应做日；非循环任务恒 false */
export function recurringDueToday(task: Task): boolean {
  if (task.recurrence === 'daily') return true;
  if (task.recurrence === 'weekly') {
    // 与 taskDayNow 同基准：now-4h 后的星期（周一=1 … 周日=7）
    const d = new Date(Date.now() - 4 * 3600 * 1000);
    const wd = d.getDay() === 0 ? 7 : d.getDay();
    return (task.recurDays ?? '')
      .split(',')
      .map((s) => Number(s.trim()))
      .includes(wd);
  }
  return false;
}

export async function createTask(input: CreateTaskInput): Promise<Task> {
  return invoke<Task>('create_task', { input });
}

export async function updateTask(id: string, patch: UpdateTaskPatch): Promise<Task> {
  return invoke<Task>('update_task', { id, patch });
}

export async function completeTask(id: string): Promise<Task> {
  return invoke<Task>('complete_task', { id });
}

export async function reopenTask(id: string): Promise<Task> {
  return invoke<Task>('reopen_task', { id });
}

export async function deleteTask(id: string): Promise<void> {
  return invoke<void>('delete_task', { id });
}

export async function listTasks(filter: TaskFilter = {}): Promise<Task[]> {
  return invoke<Task[]>('list_tasks', { filter });
}

/** 订阅 Rust 侧写操作后发出的 tasks-changed 事件 */
export function onTasksChanged(cb: () => void): Promise<UnlistenFn> {
  return listen('tasks-changed', cb);
}
