import { create } from 'zustand';
import { isTauri } from '@tauri-apps/api/core';
import { getWallet, onWalletUpdated } from '../api/profile';
import type { Wallet } from '../api/profile';

interface ProfileState {
  wallet: Wallet | null;
  fetch: () => Promise<void>;
}

const CACHE_KEY = 'xmission-wallet-snapshot';
const fields = ['xpTotal', 'coins', 'level', 'xpIntoLevel', 'xpToNext', 'streak'] as const;
function restoredWallet(): Wallet | null {
  try {
    const value = JSON.parse(sessionStorage.getItem(CACHE_KEY) ?? 'null') as Wallet | null;
    return value && fields.every((key) => Number.isSafeInteger(value[key])) ? value : null;
  } catch { return null; }
}
let pending: Promise<void> | undefined;
let revision = 0;
function applyWallet(wallet: Wallet) {
  useProfileStore.setState({ wallet });
  try { sessionStorage.setItem(CACHE_KEY, JSON.stringify(wallet)); } catch { /* optional refresh cache */ }
}

export const useProfileStore = create<ProfileState>(() => ({
  wallet: restoredWallet(),
  fetch: () => {
    if (pending) return pending;
    const started = revision;
    const request = getWallet().then((wallet) => {
      if (revision === started) applyWallet(wallet);
    }).finally(() => { if (pending === request) pending = undefined; });
    pending = request;
    return request;
  },
}));

if (isTauri()) {
  let disposed = false;
  const subscription = onWalletUpdated((wallet) => { revision++; applyWallet(wallet); });
  void subscription.then(() => {
    if (!disposed) return useProfileStore.getState().fetch();
  }).catch((error: unknown) => console.error('[profile] 钱包初始化失败', error));
  import.meta.hot?.dispose(() => {
    disposed = true;
    void subscription.then((unlisten) => unlisten());
  });
}
