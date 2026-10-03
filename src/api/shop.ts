import { invoke } from '@tauri-apps/api/core';
import type { Wallet } from './profile';

/** 与 Rust 侧 Reward/Redemption serde camelCase 一一对应（M2 契约 §2.4） */
export interface Reward {
  id: string;
  title: string;
  price: number;
  stock: number | null; // null = 不限量
  createdAt: string;
}

export interface Redemption {
  id: string;
  rewardId: string;
  rewardTitle: string;
  pricePaid: number;
  createdAt: string;
}

export async function addReward(
  title: string,
  price: number,
  stock?: number | null,
): Promise<Reward> {
  return invoke<Reward>('add_reward', { title, price, stock: stock ?? null });
}

export async function updateReward(
  id: string,
  patch: { title?: string | null; price?: number | null; stock?: number | null },
): Promise<Reward> {
  return invoke<Reward>('update_reward', { id, ...patch });
}

export async function deleteReward(id: string): Promise<void> {
  return invoke<void>('delete_reward', { id });
}

export async function listRewards(): Promise<Reward[]> {
  return invoke<Reward[]>('list_rewards');
}

export async function listRedemptions(limit?: number): Promise<Redemption[]> {
  return invoke<Redemption[]>('list_redemptions', { limit: limit ?? null });
}

/** 兑换奖励：成功返回最新钱包（余额不足/库存为空时 reject 错误信息） */
export async function redeemReward(rewardId: string): Promise<Wallet> {
  return invoke<Wallet>('redeem_reward', { rewardId });
}
