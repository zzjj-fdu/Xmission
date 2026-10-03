import { invoke } from '@tauri-apps/api/core';
import type { Task } from './tasks';

/** 与 Rust 侧 RankedTask serde camelCase 一一对应（M2 契约 §2.5） */
export interface RankedTask {
  task: Task;
  score: number;
  reasons: string[];
}

/** 规则引擎排序后的今日任务（open/doing，score 降序，逾期置顶） */
export async function getRankedToday(): Promise<RankedTask[]> {
  return invoke<RankedTask[]>('get_ranked_today');
}
