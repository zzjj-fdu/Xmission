import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import type { UnlistenFn } from '@tauri-apps/api/event';

/** 与 Rust 侧 Wallet serde camelCase 一一对应（M2 契约 §2.3） */
export interface Wallet {
  xpTotal: number;
  coins: number;
  level: number;
  xpIntoLevel: number;
  xpToNext: number;
  streak: number;
}

export async function getWallet(): Promise<Wallet> {
  return invoke<Wallet>('get_wallet');
}

/** 订阅钱包变动（XP/金币/streak 结算后推送最新 Wallet） */
export function onWalletUpdated(cb: (wallet: Wallet) => void): Promise<UnlistenFn> {
  return listen<Wallet>('wallet-updated', (e) => cb(e.payload));
}
