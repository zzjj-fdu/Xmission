import { FormEvent, useEffect, useState } from 'react'
import { useShopStore } from '../store/shop'
import { useProfileStore } from '../store/profile'
import type { Reward } from '../api/shop'
import { QuestPanel } from '../components/QuestPanel'
import { PixelIcon } from '../components/PixelIcon'
import type { PixelIconName } from '../components/PixelIcon'
import { LevelBadge } from '../components/LevelBadge'
import { JrpgButton } from '../components/JrpgButton'
import { PixelInput } from '../components/PixelInput'
import { LotteryPanel } from '../components/LotteryPanel'
import { activeTheme as pixelJrpg } from '../themes'

const { colors, font } = pixelJrpg

/** 表单项微标签样式：12px + 字距 + muted */
const formLabelStyle = {
  display: 'flex',
  flexDirection: 'column',
  gap: 4,
  fontSize: 12,
  color: colors.textMuted,
  fontFamily: font.body,
  letterSpacing: '0.1em',
} as const

function formatTime(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  return d.toLocaleString('zh-CN', { hour12: false })
}

/** 按奖励标题关键词映射像素道具图标；无语义命中时 gem 兜底 */
function rewardIcon(title: string): PixelIconName {
  const s = title.toLowerCase()
  if (/奶茶|咖啡|茶|饮料|可乐|果汁|酒/.test(s)) return 'potion'
  if (/书|课|学习|read|book/.test(s)) return 'book'
  if (/游戏|皮肤|装备|抽卡|game/.test(s)) return 'sword'
  if (/电影|视频|会员|剧|番/.test(s)) return 'scroll'
  if (/盲盒|礼物|盒|箱/.test(s)) return 'chest'
  if (/衣|购|买|shopping/.test(s)) return 'bag'
  if (/运动|健身|跑步|球/.test(s)) return 'medal'
  if (/休息|躺|睡|假期/.test(s)) return 'heart'
  if (/吃|餐|零食|蛋糕|甜|火锅|烧烤|炸鸡/.test(s)) return 'flame'
  return 'gem'
}

/** 单个奖励卡片：标题、价格（coin 图标）、库存、兑换（金币不足置灰）、删除 */
function RewardCard({ reward }: { reward: Reward }) {
  const wallet = useProfileStore((s) => s.wallet)
  const redeem = useShopStore((s) => s.redeem)
  const remove = useShopStore((s) => s.remove)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const coins = wallet?.coins ?? 0
  const outOfStock = reward.stock != null && reward.stock <= 0
  const cantAfford = wallet != null && coins < reward.price
  const disabled = busy || outOfStock || cantAfford

  const handleRedeem = () => {
    setBusy(true)
    setError(null)
    redeem(reward.id)
      .catch((err: unknown) => {
        console.error('[shop] 兑换奖励失败', err)
        setError(typeof err === 'string' ? err : '兑换失败，请稍后再试')
      })
      .finally(() => setBusy(false))
  }

  return (
    <div
      className="xm-reward-card"
      style={{
        minWidth: 0,
        border: `2px solid ${colors.goldDark}`,
        boxShadow: `inset 0 0 0 1px ${colors.panelLight}`,
        backgroundColor: colors.xpTrack,
        padding: 12,
        display: 'flex',
        flexDirection: 'column',
        gap: 8,
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 10,
        }}
      >
        {/* 道具图标：按标题关键词映射，32px 像素道具 */}
        <span
          style={{
            width: 62,
            height: 62,
            flexShrink: 0,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            border: `2px solid ${colors.goldDark}`,
            backgroundColor: colors.panel,
            borderRadius: pixelJrpg.radius ? 10 : 0,
          }}
        >
          <PixelIcon name={rewardIcon(reward.title)} size={56} />
        </span>
        <div
          style={{
            fontFamily: font.body,
            fontSize: 14,
            color: colors.text,
            wordBreak: 'break-all',
            flex: 1,
            minWidth: 0,
          }}
          title={reward.title}
        >
          {reward.title}
        </div>
      </div>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          color: colors.accent,
          fontFamily: font.display,
          fontSize: 12,
        }}
      >
        <PixelIcon name="coin" size={24} />
        {reward.price}
        <span style={{ marginLeft: 'auto', color: colors.textMuted, fontSize: 12 }}>
          {reward.stock == null ? '不限量' : outOfStock ? '已售罄' : `库存 ${reward.stock}`}
        </span>
      </div>
      <div style={{ display: 'flex', gap: 6, marginTop: 'auto' }}>
        <JrpgButton
          disabled={disabled}
          onClick={handleRedeem}
          title={cantAfford ? '金币不足' : outOfStock ? '库存不足' : undefined}
          style={{ flex: 1 }}
        >
          {busy ? '兑换中…' : '兑换'}
        </JrpgButton>
        <JrpgButton
          variant="danger"
          onClick={() => {
            if (window.confirm(`确定删除奖励「${reward.title}」吗？`)) {
              remove(reward.id).catch((err: unknown) => {
                console.error('[shop] 删除奖励失败', err)
              })
            }
          }}
        >
          删除
        </JrpgButton>
      </div>
      {error && (
        <div style={{ color: colors.danger, fontSize: 12, fontFamily: font.body }}>
          {error}
        </div>
      )}
    </div>
  )
}

export default function ShopPage() {
  const rewards = useShopStore((s) => s.rewards)
  const redemptions = useShopStore((s) => s.redemptions)
  const fetchAll = useShopStore((s) => s.fetchAll)
  const add = useShopStore((s) => s.add)
  const wallet = useProfileStore((s) => s.wallet)

  const [title, setTitle] = useState('')
  const [price, setPrice] = useState('')
  const [stock, setStock] = useState('')
  const [formError, setFormError] = useState<string | null>(null)

  useEffect(() => {
    fetchAll().catch((err: unknown) => {
      console.error('[shop] 拉取商店数据失败', err)
    })
  }, [fetchAll])

  const handleAdd = async (e: FormEvent) => {
    e.preventDefault()
    const trimmed = title.trim()
    const priceNum = Number(price)
    if (!trimmed) return
    if (!Number.isFinite(priceNum) || priceNum < 1) {
      setFormError('价格必须是 ≥1 的整数')
      return
    }
    const stockNum = stock.trim() === '' ? null : Number(stock)
    if (stockNum != null && (!Number.isFinite(stockNum) || stockNum < 0)) {
      setFormError('库存必须是 ≥0 的整数，或留空表示不限量')
      return
    }
    try {
      await add(trimmed, Math.floor(priceNum), stockNum == null ? null : Math.floor(stockNum))
    } catch (err) {
      console.error('[shop] 添加奖励失败', err)
      setFormError('添加奖励失败，请稍后再试')
      return
    }
    setFormError(null)
    setTitle('')
    setPrice('')
    setStock('')
  }

  return (
    <div style={{ width: '100%' }}>
      <h1
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          fontFamily: font.display,
          color: colors.accent,
          fontSize: 24,
          margin: '0 0 20px',
        }}
      >
        <PixelIcon name="coin" size={24} />
        商店
      </h1>

      {/* 顶部钱包卡：金币大数字 + LevelBadge */}
      <QuestPanel>
        <div style={{ display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap' }}>
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              fontFamily: font.display,
              color: colors.accent,
              fontSize: 24,
            }}
          >
            <PixelIcon name="coin" size={24} />
            {wallet ? wallet.coins : '…'}
          </div>
          {wallet ? (
            <div style={{ flex: 1, minWidth: 220 }}>
              <LevelBadge level={wallet.level} xp={wallet.xpIntoLevel} xpMax={wallet.xpToNext} />
            </div>
          ) : (
            <span style={{ color: colors.textMuted, fontSize: 12 }}>钱包加载中…</span>
          )}
          {wallet && (
            <span
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 4,
                color: colors.textMuted,
                fontSize: 12,
                fontFamily: font.body,
              }}
            >
              <PixelIcon name="flame" size={16} />
              连击 {wallet.streak} 天
            </span>
          )}
        </div>
      </QuestPanel>

      <div style={{ height: 20 }} />

      {/* 添加奖励表单 */}
      <QuestPanel>
        <form
          onSubmit={handleAdd}
          style={{ display: 'flex', flexWrap: 'wrap', gap: 12, alignItems: 'flex-end' }}
        >
          <label style={{ ...formLabelStyle, flex: '1 1 200px' }}>
            奖励标题（必填）
            <PixelInput
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="比如：一杯奶茶"
              required
            />
          </label>
          <label style={formLabelStyle}>
            价格（金币）
            <PixelInput
              type="number"
              min={1}
              style={{ width: 110 }}
              value={price}
              onChange={(e) => setPrice(e.target.value)}
              placeholder="必填"
              required
            />
          </label>
          <label style={formLabelStyle}>
            库存（留空=不限）
            <PixelInput
              type="number"
              min={0}
              style={{ width: 110 }}
              value={stock}
              onChange={(e) => setStock(e.target.value)}
              placeholder="可选"
            />
          </label>
          <JrpgButton type="submit">添加奖励</JrpgButton>
        </form>
        {formError && (
          <p style={{ color: colors.danger, fontSize: 12, margin: '8px 0 0' }}>{formError}</p>
        )}
      </QuestPanel>

      <div style={{ height: 20 }} />

      {/* 奖励网格 */}
      <QuestPanel>
        {rewards.length === 0 ? (
          <p style={{ color: colors.textMuted, margin: 0, fontSize: 12 }}>
            还没有奖励，先在上方添加一个吧
          </p>
        ) : (
          <div
            className="xm-rewards-grid"
            style={{
              display: 'grid',
              // Fit the available panel width, including when the scenery divider moves.
              gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 192px), 1fr))',
              gap: 12,
            }}
          >
            {rewards.map((r) => (
              <RewardCard key={r.id} reward={r} />
            ))}
          </div>
        )}
      </QuestPanel>

      <div style={{ height: 20 }} />

      {/* 兑换记录 */}
      <LotteryPanel />
      <div style={{ height: 20 }} />
      <QuestPanel>
        <div
          style={{
            color: colors.accent,
            fontFamily: font.display,
            fontSize: 12,
            marginBottom: 8,
          }}
        >
          兑换记录（{redemptions.length}）
        </div>
        {redemptions.length === 0 ? (
          <p style={{ color: colors.textMuted, margin: 0, fontSize: 12 }}>暂无兑换记录</p>
        ) : (
          redemptions.map((r) => (
            <div
              key={r.id}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 10,
                padding: '6px 0',
                borderBottom: `1px solid ${colors.goldDark}`,
                fontSize: 12,
                fontFamily: font.body,
              }}
            >
              <span style={{ color: colors.textMuted, flexShrink: 0 }}>
                {formatTime(r.createdAt)}
              </span>
              <span style={{ flex: 1, minWidth: 0, color: colors.text }}>{r.rewardTitle}</span>
              <span
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 4,
                  color: colors.accent,
                  flexShrink: 0,
                }}
              >
                <PixelIcon name="coin" size={16} />-{r.pricePaid}
              </span>
            </div>
          ))
        )}
      </QuestPanel>
    </div>
  )
}
