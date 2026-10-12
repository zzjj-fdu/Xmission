import { normalizeJourneyFrame } from './journeyFrames';
export const stages = ['arrival', 'letter', 'atlas', 'api', 'claw', 'qq', 'journey', 'task', 'tutorial', 'done'] as const;
export type Stage = typeof stages[number];
export interface Progress { version: 2; sessionId: string; stage: Stage; taskId?: string; tutorial?: number; journeyFrame?: number; }
export const initialProgress = (): Progress => ({ version: 2, sessionId: crypto.randomUUID(), stage: 'arrival' });
export function readProgress(raw?: string | null): Progress {
  try {
    const p = JSON.parse(raw ?? 'null');
    if (p?.version !== 2 || !stages.includes(p.stage)) return initialProgress();
    return { version: 2, sessionId: typeof p.sessionId==='string'&&/^[a-zA-Z0-9-]{4,64}$/.test(p.sessionId)?p.sessionId:crypto.randomUUID(),stage: p.stage, taskId: typeof p.taskId === 'string' ? p.taskId : undefined,
      tutorial: Number.isInteger(p.tutorial) && p.tutorial >= 0 && p.tutorial < 5 ? p.tutorial : 0, journeyFrame: normalizeJourneyFrame(p.journeyFrame) };
  } catch { return initialProgress(); }
}
export function shouldOpen(settings: Record<string, string>) {
  return settings.first_experience_eligible === 'true' && readProgress(settings.first_experience_v2).stage !== 'done';
}
export function nextStage(stage: Stage): Stage { return stages[Math.min(stages.indexOf(stage) + 1, stages.length - 1)]; }
/** One in-flight create request; failures are retryable, success stays memoized. */
export function createOnce<T>() {
  let pending: Promise<T> | undefined;
  return (create: () => Promise<T>): Promise<T> => {
    if (!pending) pending = create().catch(error => { pending = undefined; throw error; });
    return pending;
  };
}
