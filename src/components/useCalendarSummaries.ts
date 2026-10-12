import { useEffect, useState } from 'react';
import { listen } from '@tauri-apps/api/event';
import { getLlmConfig, summarizeCalendarEvent } from '../api/llm';
import { getSetting } from '../api/settings';
import type { CalendarEntry } from './calendarLayout';

const cache = new Map<string, string>();
const pending = new Map<string, Promise<string>>();
const failures = new Map<string, number>();
const keyFor = (scope: string, entry: CalendarEntry) => JSON.stringify([scope, entry.kind, entry.title]);

function request(key: string, entry: CalendarEntry): Promise<string> {
  const existing = pending.get(key);
  if (existing) return existing;
  const promise = summarizeCalendarEvent(entry.title, entry.kind).then(title => {
    if (cache.size >= 240) cache.delete(cache.keys().next().value!);
    cache.set(key, title);
    return title;
  }).catch(reason => { failures.set(key, Date.now()); throw reason; })
    .finally(() => pending.delete(key));
  pending.set(key, promise);
  return promise;
}

/** Summarize only visible long titles. Never write AI text back to tasks/courses. */
export function useCalendarSummaries(entries: CalendarEntry[], enabled: boolean) {
  const [scope, setScope] = useState<string | null>(null);
  const [, refreshTitles] = useState(0);
  useEffect(() => {
    let disposed = false;
    let revision = 0;
    const releases: (() => void)[] = [];
    const refresh = () => {
      const current = ++revision;
      setScope(null);
      void Promise.all([getLlmConfig(), getSetting('calendar_ai_summary')]).then(([cfg, setting]) => {
        if (!disposed && current === revision) setScope(cfg.hasKey && setting !== 'false'
          ? JSON.stringify([cfg.baseUrl, cfg.model, current]) : null);
      }).catch(() => { if (!disposed && current === revision) setScope(null); });
    };
    refresh();
    void listen('llm-config-changed', refresh).then(fn => disposed ? fn() : releases.push(fn)).catch(console.error);
    void listen<{ key: string }>('settings-changed', ({ payload }) => {
      if (payload.key === 'calendar_ai_summary') refresh();
    }).then(fn => disposed ? fn() : releases.push(fn)).catch(console.error);
    return () => { disposed = true; releases.forEach(fn => fn()); };
  }, []);
  useEffect(() => {
    if (!scope || !enabled) return;
    let cancelled = false;
    void (async () => {
      const unique = new Map(entries.filter(entry => Array.from(entry.title).length > 12)
        .map(entry => [keyFor(scope, entry), entry]));
      // Bounded, sequential calls; repeated course occurrences share one result.
      for (const [key, entry] of [...unique].slice(0, 24)) {
        if (cancelled) return;
        if (cache.has(key) || Date.now() - (failures.get(key) ?? 0) < 60_000) continue;
        try { await request(key, entry); if (!cancelled) refreshTitles(value => value + 1); }
        catch { /* Keep the original title when AI is unavailable. */ }
      }
    })();
    return () => { cancelled = true; };
  }, [entries, enabled, scope]);
  return (entry: CalendarEntry) => enabled && scope ? cache.get(keyFor(scope, entry)) ?? entry.title : entry.title;
}
