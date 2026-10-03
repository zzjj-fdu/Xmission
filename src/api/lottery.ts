import { invoke } from '@tauri-apps/api/core'

export interface LotteryPrize { title: string; kind: 'coins' | 'xp' | 'custom'; amount: number; weight: number }
export interface LotteryConfig { minLevel: number; costCoins: number; prizes: LotteryPrize[] }
export interface LotteryDraw { id: string; prizeTitle: string; prizeKind: string; prizeAmount: number; prizeIndex: number; costPaid: number; createdAt: string }

export const getLotteryConfig = () => invoke<LotteryConfig>('get_lottery_config')
export const saveLotteryConfig = (config: LotteryConfig) => invoke<void>('save_lottery_config', { config })
export const listLotteryDraws = () => invoke<LotteryDraw[]>('list_lottery_draws')
export const drawLottery = () => invoke<LotteryDraw>('draw_lottery')
