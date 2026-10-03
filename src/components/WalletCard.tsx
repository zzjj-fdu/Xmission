import { activeTheme as pixelJrpg, fieldBg } from '../themes';
import { PixelIcon } from './PixelIcon';
import { SegmentedXpBar } from './LevelBadge';

const t = pixelJrpg;

export interface WalletCardProps {
  level: number;
  xp: number;
  xpMax: number;
  coins: number;
  streak: number;
}

/** 交易卡式统计格：小标签（12px + 字距 + muted）压大号数字（24px display 金色） */
function StatCell({
  label,
  value,
  icon,
  title,
  align = 'flex-start',
}: {
  label: string;
  value: string;
  icon?: 'coin' | 'flame';
  title?: string;
  align?: 'flex-start' | 'flex-end';
}) {
  return (
    <div
      title={title}
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: align,
        gap: 2,
        minWidth: 0,
      }}
    >
      <span
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 4,
          fontSize: 12,
          color: t.colors.textMuted,
          letterSpacing: '0.1em',
          whiteSpace: 'nowrap',
        }}
      >
        {icon && <PixelIcon name={icon} size={24} />}
        {label}
      </span>
      <span
        style={{
          fontSize: 24,
          fontFamily: t.font.display,
          color: t.panelStyle === 'wood-frame' ? t.colors.goldDark : t.colors.accent,
          lineHeight: 1.1,
          whiteSpace: 'nowrap',
        }}
      >
        {value}
      </span>
    </div>
  );
}

/**
 * 竖排紧凑钱包卡（180px 导航列专用，对齐概念图左下信息区），交易卡式：
 * 第 1 行：纹章 + LV. 小标签 + 大号等级数字
 * 第 2 行：分段 XP 条占满整行 + 右侧 xp/xpMax 小字
 * 第 3 行：金币 / 连击 两组「小标签 + 24px 金色大数字」统计格
 */
export function WalletCard({ level, xp, xpMax, coins, streak }: WalletCardProps) {
  return (
    <div
      style={{
        border: `1px solid ${t.colors.goldDark}`,
        background: fieldBg(t),
        padding: 10,
        display: 'flex',
        flexDirection: 'column',
        gap: 8,
        boxSizing: 'border-box',
        fontFamily: t.font.display,
        borderRadius: t.radius ? 10 : 0,
      }}
    >
      {/* 第 1 行：纹章 + LV. 标签 + 大号等级数字 */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 }}>
        <div
          style={{
            width: 36,
            height: 36,
            flexShrink: 0,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            border: `2px solid ${t.colors.accent}`,
            boxShadow: `inset 0 0 0 1px ${t.colors.goldDark}, inset 0 2px 3px rgba(0, 0, 0, 0.5)`,
            backgroundColor: t.colors.xpTrack,
            borderRadius: t.radius ? 8 : 0,
          }}
        >
          <PixelIcon name="star" size={26} />
        </div>
        <span
          style={{
            fontSize: 12,
            color: t.colors.textMuted,
            letterSpacing: '0.1em',
            whiteSpace: 'nowrap',
          }}
        >
          LV.
        </span>
        <span
          style={{
            fontSize: 24,
            color: t.colors.accent,
            lineHeight: 1.1,
            whiteSpace: 'nowrap',
          }}
        >
          {level}
        </span>
      </div>
      {/* 第 2 行：分段 XP 条占满整行 + 右侧 xp/xpMax 小字 */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <SegmentedXpBar xp={xp} xpMax={xpMax} fill />
        <span
          style={{
            fontSize: 12,
            color: t.colors.textMuted,
            fontFamily: t.font.body,
            whiteSpace: 'nowrap',
            flexShrink: 0,
          }}
        >
          {xp}/{xpMax}
        </span>
      </div>
      {/* 第 3 行：金币 / 连击 交易卡式统计格（小标签 + 24px 金色大数字） */}
      <div
        style={{
          display: 'flex',
          alignItems: 'flex-end',
          justifyContent: 'space-between',
          gap: 8,
        }}
      >
        <StatCell label="金币" value={String(coins)} icon="coin" title={`金币 ${coins}`} />
        <StatCell
          label="连击"
          value={`${streak}天`}
          icon="flame"
          title={`连击 ${streak} 天`}
          align="flex-end"
        />
      </div>
    </div>
  );
}
