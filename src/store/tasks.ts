import { create } from 'zustand';
import { getCurrentWindow } from '@tauri-apps/api/window';
import {
  completeTask,
  createTask,
  deleteTask,
  listTasks,
  onTasksChanged,
  reopenTask,
  updateTask,
} from '../api/tasks';
import type { CreateTaskInput, Task, TaskFilter, UpdateTaskPatch } from '../api/tasks';

interface TasksState {
  tasks: Task[];
  loading: boolean;
  fetchAll: (filter?: TaskFilter) => Promise<void>;
  complete: (id: string) => Promise<void>;
  reopen: (id: string) => Promise<void>;
  create: (input: CreateTaskInput) => Promise<Task>;
  remove: (id: string) => Promise<void>;
  update: (id: string, patch: UpdateTaskPatch) => Promise<void>;
}

export const useTasksStore = create<TasksState>((set, get) => ({
  tasks: [],
  loading: false,

  fetchAll: async (filter?: TaskFilter) => {
    set({ loading: true });
    try {
      const tasks = await listTasks(filter ?? {});
      set({ tasks });
    } finally {
      set({ loading: false });
    }
  },

  complete: async (id: string) => {
    await completeTask(id);
    await get().fetchAll();
  },

  reopen: async (id: string) => {
    await reopenTask(id);
    await get().fetchAll();
  },

  create: async (input: CreateTaskInput) => {
    const task = await createTask(input);
    await get().fetchAll();
    return task;
  },

  remove: async (id: string) => {
    await deleteTask(id);
    await get().fetchAll();
  },

  update: async (id: string, patch: UpdateTaskPatch) => {
    await updateTask(id, patch);
    await get().fetchAll();
  },
}));

// 模块加载时：订阅 tasks-changed 事件自动刷新，并立即拉取一次。
// 失败必须可见（console.error），不再静默吞掉——真实错误被吞会导致跨窗口状态不同步且无法排查。
void onTasksChanged(() => {
  void useTasksStore.getState().fetchAll().catch((err: unknown) => {
    console.error('[tasks] tasks-changed 触发刷新失败', err);
  });
}).catch((err: unknown) => {
  console.error('[tasks] 订阅 tasks-changed 事件失败（非 Tauri 环境或 IPC 异常）', err);
});

// 双保险：窗口重新获得焦点时强制刷新一次。
// 即使事件订阅漏发，用户在主窗口与悬浮窗之间切换时也能同步状态。
try {
  void getCurrentWindow()
    .onFocusChanged(({ payload: focused }) => {
      if (focused) {
        void useTasksStore.getState().fetchAll().catch((err: unknown) => {
          console.error('[tasks] 焦点触发刷新失败', err);
        });
      }
    })
    .catch((err: unknown) => {
      console.error('[tasks] 订阅窗口焦点事件失败（非 Tauri 环境或 IPC 异常）', err);
    });
} catch (err) {
  // 纯浏览器 dev 下 getCurrentWindow() 会同步抛错
  console.error('[tasks] 订阅窗口焦点事件失败（非 Tauri 环境）', err);
}

void useTasksStore.getState().fetchAll().catch((err: unknown) => {
  console.error('[tasks] 初始拉取任务失败（非 Tauri 环境或 IPC 异常）', err);
});
