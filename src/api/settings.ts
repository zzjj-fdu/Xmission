import { invoke, isTauri } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';

let snapshot: Record<string, string> | undefined;
let pending: Promise<Record<string, string>> | undefined;
let revision = 0;

export function getSettings(): Promise<Record<string, string>> {
  if (snapshot) return Promise.resolve(snapshot);
  if (pending) return pending;
  const started = revision;
  const request = invoke<Record<string, string>>('get_settings').then((values) => {
    if (revision === started) snapshot = values;
    return values;
  }).finally(() => { if (pending === request) pending = undefined; });
  pending = request;
  return request;
}

function updateCache(key: string, value: string) {
  revision++;
  pending = undefined;
  if (snapshot) snapshot = { ...snapshot, [key]: value };
}

/** 读取设置项；不存在返回 null。读取方负责缺省值（M2 契约 §2.6） */
export async function getSetting(key: string): Promise<string | null> {
  return (await getSettings())[key] ?? null;
}

export async function setSetting(key: string, value: string): Promise<void> {
  await invoke<void>('set_setting', { key, value });
  updateCache(key, value);
}

if (isTauri()) {
  const subscription = listen<{ key: string; value: string }>('settings-changed', ({ payload }) => updateCache(payload.key, payload.value));
  void subscription.catch(console.error);
  import.meta.hot?.dispose(() => { void subscription.then((unlisten) => unlisten()); });
}
