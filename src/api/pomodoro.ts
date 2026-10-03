import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import type { UnlistenFn } from '@tauri-apps/api/event';

/** 与 Rust 侧 PomodoroSession serde camelCase 一一对应（M2 契约 §2.2） */
export interface PomodoroSession {
  id: string;
  taskId: string | null;
  taskTitle: string | null;
  startedAt: string;
  durationMin: number;
  state: string; // running | paused | done | abandoned
  remainingSecs: number;
  updatedAt: string;
}

export async function pomodoroStart(taskId?: string | null): Promise<PomodoroSession> {
  return invoke<PomodoroSession>('pomodoro_start', { taskId: taskId ?? null });
}

export async function pomodoroPause(): Promise<PomodoroSession> {
  return invoke<PomodoroSession>('pomodoro_pause');
}

export async function pomodoroResume(): Promise<PomodoroSession> {
  return invoke<PomodoroSession>('pomodoro_resume');
}

/** completed=true 结算 XP/金币；false 记为放弃 */
export async function pomodoroFinish(completed: boolean): Promise<void> {
  return invoke<void>('pomodoro_finish', { completed });
}

/** 启动时恢复：只返回 running/paused 会话 */
export async function pomodoroCurrent(): Promise<PomodoroSession | null> {
  return invoke<PomodoroSession | null>('pomodoro_current');
}

export function onPomodoroChanged(
  cb: (session: PomodoroSession | null) => void,
): Promise<UnlistenFn> {
  return listen<PomodoroSession | null>('pomodoro-changed', (e) => cb(e.payload));
}

/**
 * 前端倒计时推导（M2 契约 §2.2）：
 * running → remaining_secs 减去 updated_at 至今的流逝；paused → 冻结值
 */
export function remainingSecsNow(s: PomodoroSession): number {
  if (s.state !== 'running') return Math.max(0, s.remainingSecs);
  const elapsed = Math.floor((Date.now() - new Date(s.updatedAt).getTime()) / 1000);
  return Math.max(0, s.remainingSecs - elapsed);
}
