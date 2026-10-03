import { create } from 'zustand';
import {
  onPomodoroChanged,
  pomodoroCurrent,
  pomodoroFinish,
  pomodoroPause,
  pomodoroResume,
  pomodoroStart,
} from '../api/pomodoro';
import type { PomodoroSession } from '../api/pomodoro';

interface PomodoroState {
  session: PomodoroSession | null;
  refresh: () => Promise<void>;
  start: (taskId?: string | null) => Promise<void>;
  pause: () => Promise<void>;
  resume: () => Promise<void>;
  finish: (completed: boolean) => Promise<void>;
}

export const usePomodoroStore = create<PomodoroState>((set) => ({
  session: null,

  refresh: async () => {
    const session = await pomodoroCurrent();
    set({ session });
  },

  start: async (taskId) => {
    const session = await pomodoroStart(taskId ?? null);
    set({ session });
  },

  pause: async () => {
    const session = await pomodoroPause();
    set({ session });
  },

  resume: async () => {
    const session = await pomodoroResume();
    set({ session });
  },

  finish: async (completed) => {
    await pomodoroFinish(completed);
    set({ session: null });
  },
}));

// 模块加载时：订阅番茄钟状态推送（双窗口同步），并立即恢复一次。
void onPomodoroChanged((session) => {
  usePomodoroStore.setState({ session });
}).catch((err: unknown) => {
  console.error('[pomodoro] 订阅 pomodoro-changed 事件失败（非 Tauri 环境或 IPC 异常）', err);
});

void usePomodoroStore
  .getState()
  .refresh()
  .catch((err: unknown) => {
    console.error('[pomodoro] 恢复番茄钟会话失败（非 Tauri 环境或 IPC 异常）', err);
  });
