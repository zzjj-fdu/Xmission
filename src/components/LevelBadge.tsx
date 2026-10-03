import { activeTheme as pixelJrpg } from '../themes';
import { PixelIcon } from './PixelIcon';

const t = pixelJrpg;
const pillBar = t.barStyle === 'pill';

export interface LevelBadgeProps {
  level: number;
  xp: number;
  xpMax: number;
}

/** XP 条分段数：chunky 绿色像素块 */
const SEGMENTS = 10;

export interface SegmentedXpBarProps {
  xp: number;
  xpMax: number;
  /** 分段弹性拉伸占满整行。 */
  fill?: boolean;
}

/** chunky 分段式 XP 条（非平滑渐变）：金框 + 深金内圈 + 分段像素块 */
export function SegmentedXpBar({ xp, xpMax, fill = true }: SegmentedXpBarProps) {
  const pct = xpMax > 0 ? Math.min(1, Math.max(0, xp / xpMax)) : 0;
  const filled = Math.round(pct * SEGMENTS);

  return (
    <div
      role="progressbar"
      aria-valuenow={xp}
      aria-valuemin={0}
      aria-valuemax={xpMax}
      style={{
        flex: 1,
        minWidth: 48,
        display: 'flex',
        alignItems: 'center',
        gap: 2,
        padding: 3,
        border: `2px solid ${t.colors.accent}`,
        boxShadow: `inset 0 0 0 1px ${t.colors.goldDark}`,
        backgroundColor: t.colors.xpTrack,
        boxSizing: 'border-box',
        // pill 皮肤：整条轨道药丸圆角
        borderRadius: pillBar ? 999 : 0,
        overflow: pillBar ? 'hidden' : 'visible',
      }}
    >
      {Array.from({ length: SEGMENTS }, (_, i) => (
        <div
          key={i}
          style={{
            width: fill ? undefined : 8,
            flex: fill ? '1 1 0' : undefined,
            height: 14,
            flexShrink: fill ? 1 : 0,
            backgroundColor: i < filled ? t.colors.accentAlt : t.colors.panelLight,
            // 像素块的明暗分界：顶部高光、底部阴影
            boxShadow:
              i < filled
                ? 'inset 0 2px 0 rgba(255, 255, 255, 0.28), inset 0 -2px 0 rgba(0, 0, 0, 0.3)'
                : 'inset 0 2px 0 rgba(255, 255, 255, 0.06)',
            // pill 皮肤：分段块同样圆润
            borderRadius: pillBar ? 999 : 0,
            transition: 'background-color 0.2s ease-out',
          }}
        />
      ))}
    </div>
  );
}

/**
 * 像素等级徽章：金色像素边框方形纹章（内嵌像素星）+ Lv.{level}
 * + chunky 分段式 XP 条（非平滑渐变）
 */
export function LevelBadge({ level, xp, xpMax }: LevelBadgeProps) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontFamily: t.font.display }}>
      {/* 方形纹章：金色像素边框 + 深金内圈 + 像素星 */}
      <div
        style={{
          width: 48,
          height: 48,
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
        <PixelIcon name="star" size={40} />
      </div>
      <span style={{ color: t.panelStyle === 'wood-frame' ? t.colors.goldDark : t.colors.accent, fontSize: 14, whiteSpace: 'nowrap' }}>
        Lv.{level}
      </span>
      <SegmentedXpBar xp={xp} xpMax={xpMax} />
      <span style={{ color: t.colors.textMuted, fontSize: 12, whiteSpace: 'nowrap' }}>
        {xp} / {xpMax}
      </span>
    </div>
  );
}
