import { invoke } from '@tauri-apps/api/core';
import type {Task,CreateTaskInput} from '../api/tasks';
export const getFirstTask=(sessionId:string)=>invoke<Task|null>('get_first_task',{sessionId});
export const createFirstTask=(sessionId:string,input:CreateTaskInput)=>invoke<Task>('create_first_task',{sessionId,input});
export interface ClawStatus {
  phase: 'idle' | 'preparing' | 'starting' | 'ready' | 'error' | 'stopped' | 'cancelling' | 'cancelled';
  message: string; mcpConnected: boolean; qqConnected: boolean; qqBound: boolean;
  qrDataUrl?: string | null; error?: string | null;
  progress?: number | null;
}
export const clawStatus = () => invoke<ClawStatus>('claw_status');
export const clawAction = (action: 'prepare' | 'start' | 'stop' | 'cancel' | 'qr' | 'cancelQr' | 'check') => invoke<ClawStatus>('claw_action', { action });
