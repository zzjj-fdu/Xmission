import { useEffect, useRef, useState } from 'react'
import { activeTheme as theme, currentThemeKey } from '../themes'
import { useProfileStore } from '../store/profile'
import { getLotteryConfig, saveLotteryConfig, listLotteryDraws, drawLottery } from '../api/lottery'
import type { LotteryConfig, LotteryPrize, LotteryDraw } from '../api/lottery'
import { QuestPanel } from './QuestPanel'
import { JrpgButton } from './JrpgButton'
import { PixelInput } from './PixelInput'
import { PixelSelect } from './PixelSelect'
import { PixelIcon } from './PixelIcon'
import type { PixelIconName } from './PixelIcon'

const palette = [theme.colors.accent, theme.colors.goldDark, theme.colors.accentAlt, theme.colors.border, theme.colors.highlight, theme.colors.panelLight]
const defaults: LotteryConfig = { minLevel: 3, costCoins: 30, prizes: [
  { title: '金币小袋', kind: 'coins', amount: 10, weight: 28 },
  { title: '经验萤火', kind: 'xp', amount: 12, weight: 25 },
  { title: '金币宝箱', kind: 'coins', amount: 40, weight: 15 },
  { title: '经验星芒', kind: 'xp', amount: 40, weight: 15 },
  { title: '休息券', kind: 'custom', amount: 0, weight: 12 },
  { title: '心愿奖励', kind: 'custom', amount: 0, weight: 5 },
] }
const kindLabel = { coins: '金币', xp: '经验', custom: '自定义奖品' }
const themeKey = currentThemeKey()
const wheelCopy = {
  'pixel-jrpg': ['星辉宝箱机', '✦', '星辉落定'],
  'parchment-journal': ['冒险罗盘', '✧', '命运写下新一页'],
  'animal-crossing': ['小岛幸运花', '✿', '好运在岛上开花'],
  'stardew-valley': ['丰收节兑奖机', '✺', '今天有一份收获'],
}[themeKey]
const spinDuration = { 'pixel-jrpg': 2900, 'parchment-journal': 4300, 'animal-crossing': 3600, 'stardew-valley': 4800 }[themeKey]

export function LotteryPanel() {
  const wallet = useProfileStore((s) => s.wallet)
  const [config, setConfig] = useState<LotteryConfig>(defaults)
  const [draft, setDraft] = useState<LotteryConfig>(defaults)
  const [draws, setDraws] = useState<LotteryDraw[]>([])
  const [editing, setEditing] = useState(false)
  const [busy, setBusy] = useState(false)
  const [needleRotation, setNeedleRotation] = useState(0)
  const [winningIndex, setWinningIndex] = useState<number | null>(null)
  const [settledReels, setSettledReels] = useState(0)
  const [result, setResult] = useState<LotteryDraw | null>(null)
  const [message, setMessage] = useState('')
  const mounted = useRef(true)
  const timers = useRef<number[]>([])

  useEffect(() => {
    mounted.current = true
    return () => { mounted.current = false; timers.current.forEach(window.clearTimeout); timers.current = [] }
  }, [])

  useEffect(() => {
    void Promise.all([getLotteryConfig(), listLotteryDraws()]).then(([cfg, history]) => {
      if (!mounted.current) return
      setConfig(cfg); setDraft(structuredClone(cfg)); setDraws(history)
    }).catch(() => { if (mounted.current) setMessage('抽奖记录将在桌面应用中加载') })
  }, [])

  const updatePrize = (index: number, patch: Partial<LotteryPrize>) => {
    setDraft((prev) => ({ ...prev, prizes: prev.prizes.map((prize, i) => i === index ? { ...prize, ...patch } : prize) }))
  }
  const save = async () => {
    setBusy(true); setMessage('')
    try { await saveLotteryConfig(draft); setConfig(structuredClone(draft)); setEditing(false); setResult(null); setMessage('奖品设置已保存') }
    catch (error) { setMessage(String(error)) }
    finally { setBusy(false) }
  }
  const spin = async () => {
    if (busy) return
    setBusy(true); setMessage(''); setResult(null); setWinningIndex(null); setSettledReels(0)
    try {
      const draw = await drawLottery()
      if (!mounted.current) return
      const index = draw.prizeIndex
      const totalWeight = config.prizes.reduce((sum, prize) => sum + prize.weight, 0)
      const before = config.prizes.slice(0, index).reduce((sum, prize) => sum + prize.weight, 0)
      const prize = config.prizes[index]
      const angle = !prize || totalWeight <= 0 ? 0 : (before + prize.weight / 2) * 360 / totalWeight
      if (themeKey === 'parchment-journal') {
        setNeedleRotation((prev) => prev + 1080 + ((angle - prev % 360 + 360) % 360))
      }
      setWinningIndex(index)
      setDraws((prev) => [draw, ...prev].slice(0, 30))
      const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches
      if (themeKey === 'pixel-jrpg' || themeKey === 'stardew-valley') {
        for (let reel = 1; reel <= 3; reel++) timers.current.push(window.setTimeout(() => setSettledReels(reel), reducedMotion ? 0 : 650 + reel * 650))
      }
      timers.current.push(window.setTimeout(() => { setResult(draw); setBusy(false); timers.current = [] }, reducedMotion ? 100 : spinDuration + 180))
    } catch (error) { if (mounted.current) { setMessage(String(error)); setBusy(false) } }
  }
  const levelLocked = !!wallet && wallet.level < config.minLevel
  const coinLocked = !!wallet && wallet.coins < config.costCoins
  const segments = config.prizes.length
  const totalWeight = config.prizes.reduce((sum, prize) => sum + prize.weight, 0)
  let runningWeight = 0
  const gradient = segments ? `conic-gradient(${config.prizes.map((prize, i) => {
    const start = runningWeight * 100 / totalWeight
    runningWeight += prize.weight
    return `${palette[i % palette.length]} ${start}% ${runningWeight * 100 / totalWeight}%`
  }).join(',')})` : theme.colors.panelLight
  const inputStyle = { width: 88, maxWidth: '100%' }
  const slotTheme = themeKey === 'pixel-jrpg' || themeKey === 'stardew-valley'
  const prizeSymbol = (prize: LotteryPrize) => prize.kind === 'coins' ? '✦' : prize.kind === 'xp' ? '✧' : '★'
  const slotIcon = (prize: LotteryPrize): PixelIconName => prize.kind === 'coins' ? 'coin' : prize.kind === 'xp' ? themeKey === 'stardew-valley' ? 'star' : 'gem' : 'chest'

  return <QuestPanel className="xm-lottery-panel">
    <div className="xm-lottery-heading">
      <div><span style={{ fontFamily: theme.font.display, color: theme.colors.accent, fontSize: 18 }}>{wheelCopy[1]} {wheelCopy[0]}</span>
        <p style={{ margin: '7px 0 0', color: theme.colors.textMuted }}>累计 {50 * config.minLevel * (config.minLevel - 1)} XP 达到 Lv.{config.minLevel} 后，每次消耗 {config.costCoins} 金币。奖品可自行修改。</p></div>
      <JrpgButton variant="ghost" onClick={() => { setDraft(structuredClone(config)); setEditing((v) => !v) }}> {editing ? '收起设置' : '编辑奖池'} </JrpgButton>
    </div>
    <div className="xm-lottery-layout">
      <div className={`xm-lottery-wheel-wrap xm-lottery-${themeKey}${busy ? ' is-spinning' : ''}${result ? ' has-result' : ''}`} style={{ '--spin-duration': `${spinDuration}ms` } as React.CSSProperties}>
        {slotTheme ? <div className="xm-slot-machine" aria-label={busy ? '正在抽奖' : result ? `抽中${result.prizeTitle}` : '待抽奖'}>
          <div className="xm-slot-marquee"><span>{themeKey === 'pixel-jrpg' ? '✦ TREASURE ✦' : '✿ HARVEST FAIR ✿'}</span></div>
          <div className="xm-slot-reels">
            {[0, 1, 2].map((reel) => {
              const selected = winningIndex === null ? null : config.prizes[winningIndex]
              const settled = selected && settledReels > reel
              const items = busy && !settled ? [...config.prizes, ...config.prizes, ...config.prizes] : [selected ?? config.prizes[(reel + 1) % config.prizes.length]]
              return <div className={`xm-slot-reel${busy && !settled ? ' is-rolling' : ''}${settled ? ' is-settled' : ''}`} key={reel}>
                <div className="xm-slot-track" style={{ '--reel-number': reel } as React.CSSProperties}>
                  {items.map((prize, i) => <span className="xm-slot-symbol" key={`${reel}-${i}`} title={prize.title}><PixelIcon name={slotIcon(prize)} size={30} /><small>{prize.title}</small></span>)}
                </div>
              </div>
            })}
          </div>
          <div className="xm-slot-payline" aria-hidden="true" />
          <div className="xm-slot-foot"><span>{themeKey === 'pixel-jrpg' ? '★ 星辉奖品 ★' : '✿ 今日幸运 ✿'}</span><span>{busy ? '•••' : '01 / 03'}</span></div>
        </div> : <><div className="xm-lottery-topper" aria-hidden="true">{wheelCopy[1]}</div>
        <div className="xm-lottery-pointer" aria-hidden="true" />
        <div className="xm-lottery-motif" aria-hidden="true"><i /><i /><i /><i /></div>
        <div className="xm-lottery-rim">
          {Array.from({ length: 20 }, (_, i) => <i key={i} className="xm-lottery-light" style={{ transform: `rotate(${i * 18}deg) translateY(var(--light-offset))` }} />)}
          <div className="xm-lottery-wheel" style={{ background: gradient }}>
            {config.prizes.map((prize, i) => {
              const before = config.prizes.slice(0, i).reduce((sum, p) => sum + p.weight, 0)
              const angle = (before + prize.weight / 2) * 360 / totalWeight
              const compact = prize.weight / totalWeight < .1
              return <span key={`${i}-${prize.title}`} className={`xm-lottery-segment-label${compact ? ' is-compact' : ''}${result && winningIndex === i ? ' is-selected' : ''}`} style={{ transform: `rotate(${angle}deg) translateY(var(--label-offset)) rotate(${-angle}deg)`, '--petal-delay': `${i * .32}s` } as React.CSSProperties} title={prize.title}>
                <b>{prizeSymbol(prize)}</b>{!compact && <small>{prize.title}</small>}
              </span>
            })}
          </div>
          {themeKey === 'parchment-journal' && <div className="xm-lottery-compass-needle" style={{ transform: `rotate(${needleRotation}deg)` }} aria-hidden="true" />}
          <div className="xm-lottery-hub"><span>{wheelCopy[1]}</span></div>
        </div></>}
        <span className="xm-lottery-wheel-caption">{busy ? '命运正在转动…' : result ? wheelCopy[2] : '今天会遇见什么好运？'}</span>
      </div>
      <div className="xm-lottery-info">
        <div className="xm-lottery-prizes">{config.prizes.map((prize, i) => <div key={`${i}-${prize.title}`} className="xm-lottery-prize">
          <span style={{ background: palette[i % palette.length] }} />
          <strong>{prize.title}</strong><small>{prize.kind === 'custom' ? '实物 / 心愿' : `${prize.amount} ${kindLabel[prize.kind]}`} · {Math.round(prize.weight * 100 / totalWeight)}%</small>
        </div>)}</div>
        <JrpgButton disabled={busy || !wallet || levelLocked || coinLocked || segments < 2} onClick={() => { void spin() }}>
          {busy ? slotTheme ? '奖品揭晓中…' : '幸运轮旋转中…' : levelLocked ? `达到 Lv.${config.minLevel} 解锁` : coinLocked ? '金币不足' : `消耗 ${config.costCoins} 金币抽一次`}
        </JrpgButton>
        {result && <div role="status" className="xm-lottery-result">✦ 抽中了「{result.prizeTitle}」{result.prizeKind === 'custom' && ' · 已记入抽奖记录'}</div>}
        {message && <div role="status" style={{ color: theme.colors.textMuted }}>{message}</div>}
      </div>
    </div>
    {editing && <div className="xm-lottery-editor">
      <div className="xm-lottery-rules"><label>解锁等级 <PixelInput type="number" min={1} max={100} style={inputStyle} value={draft.minLevel} onChange={(e) => setDraft({ ...draft, minLevel: Number(e.target.value) })} /></label>
        <label>每次金币 <PixelInput type="number" min={1} style={inputStyle} value={draft.costCoins} onChange={(e) => setDraft({ ...draft, costCoins: Number(e.target.value) })} /></label></div>
      <p style={{ color: theme.colors.textMuted, fontSize: 12 }}>权重越大越容易抽中。自定义奖品会记录在下方，可自行兑现。</p>
      {draft.prizes.map((prize, i) => <div key={i} className="xm-lottery-edit-row">
        <PixelInput aria-label={`奖品 ${i + 1} 名称`} value={prize.title} onChange={(e) => updatePrize(i, { title: e.target.value })} />
        <PixelSelect aria-label={`奖品 ${i + 1} 类型`} value={prize.kind} onChange={(e) => updatePrize(i, { kind: e.target.value as LotteryPrize['kind'] })}>
          <option value="coins">金币</option><option value="xp">经验</option><option value="custom">自定义</option>
        </PixelSelect>
        {prize.kind !== 'custom' && <PixelInput type="number" min={1} aria-label="数量" style={inputStyle} value={prize.amount} onChange={(e) => updatePrize(i, { amount: Number(e.target.value) })} />}
        <PixelInput type="number" min={1} aria-label="权重" title="抽中权重" style={inputStyle} value={prize.weight} onChange={(e) => updatePrize(i, { weight: Number(e.target.value) })} />
        <JrpgButton variant="danger" disabled={draft.prizes.length <= 2} onClick={() => setDraft({ ...draft, prizes: draft.prizes.filter((_, n) => n !== i) })}>移除</JrpgButton>
      </div>)}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 10 }}>
        <JrpgButton variant="ghost" disabled={draft.prizes.length >= 12} onClick={() => setDraft({ ...draft, prizes: [...draft.prizes, { title: '新奖品', kind: 'custom', amount: 0, weight: 10 }] })}>添加奖品</JrpgButton>
        <JrpgButton disabled={busy} onClick={() => { void save() }}>保存奖池</JrpgButton>
      </div>
    </div>}
    {draws.length > 0 && <details className="xm-lottery-history"><summary>抽奖记录（{draws.length}）</summary>
      {draws.map((draw) => <div key={draw.id}>{new Date(draw.createdAt).toLocaleString('zh-CN')}　{draw.prizeTitle}　·　花费 {draw.costPaid} 金币</div>)}
    </details>}
  </QuestPanel>
}
