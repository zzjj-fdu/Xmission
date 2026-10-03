import { create } from 'zustand';
import {
  addReward,
  deleteReward,
  listRedemptions,
  listRewards,
  redeemReward,
} from '../api/shop';
import type { Redemption, Reward } from '../api/shop';

interface ShopState {
  rewards: Reward[];
  redemptions: Redemption[];
  fetchAll: () => Promise<void>;
  add: (title: string, price: number, stock?: number | null) => Promise<void>;
  remove: (id: string) => Promise<void>;
  /** 兑换成功后会通过 wallet-updated 事件刷新钱包；失败时抛错给 UI 展示 */
  redeem: (id: string) => Promise<void>;
}

export const useShopStore = create<ShopState>((set, get) => ({
  rewards: [],
  redemptions: [],

  fetchAll: async () => {
    const [rewards, redemptions] = await Promise.all([listRewards(), listRedemptions()]);
    set({ rewards, redemptions });
  },

  add: async (title, price, stock) => {
    await addReward(title, price, stock ?? null);
    await get().fetchAll();
  },

  remove: async (id) => {
    await deleteReward(id);
    await get().fetchAll();
  },

  redeem: async (id) => {
    await redeemReward(id);
    await get().fetchAll();
  },
}));
