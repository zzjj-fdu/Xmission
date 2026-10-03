import { useState } from 'react';
import type { CSSProperties, ReactNode } from 'react';
import { activeTheme as pixelJrpg } from '../themes';

const { colors, font } = pixelJrpg;
const panelStyle = pixelJrpg.panelStyle ?? 'pixel-step';

/** 主按钮上的文字色：动森纸白压叶绿 / 星露谷深木棕压金 / 像素皮深底压亮金 */
const primaryTextColor =
  panelStyle === 'soft' ? colors.panel : panelStyle === 'wood-frame' ? colors.goldDark
    : panelStyle === 'parchment' ? '#fff0d4' : colors.xpTrack;
const ghostTextColor = panelStyle === 'wood-frame' ? colors.goldDark
  : panelStyle === 'soft' ? '#397c32'
    : panelStyle === 'parchment' ? colors.accentAlt : colors.accent;

/**
 * JRPG 按钮（共享组件），按皮肤三分支：
 * - pixel-step：金底深字、2px 深色描边、hover 微下沉（像素直角）
 * - soft（动森）：叶绿底白字、药丸圆角、柔和内阴影、hover 轻提亮
 * - wood-frame（星露谷）：金底深木棕字、直角、木棕色描边
 */
export function JrpgButton({
  children,
  onClick,
  type,
  variant = 'primary',
  disabled = false,
  style,
  title,
}: {
  children: ReactNode;
  onClick?: () => void;
  type?: 'button' | 'submit';
  variant?: 'primary' | 'ghost' | 'danger';
  disabled?: boolean;
  style?: CSSProperties;
  title?: string;
}) {
  const [hover, setHover] = useState(false);
  const radius = panelStyle === 'soft' ? 999 : 0;
  const base: CSSProperties =
    variant === 'primary'
      ? {
          backgroundColor: panelStyle === 'soft' ? '#4b9138' : colors.accent,
          color: primaryTextColor,
          border: `2px solid ${panelStyle === 'soft' ? colors.accent : colors.goldDark}`,
          borderRadius: radius,
          boxShadow: hover
            ? 'inset 0 2px 0 rgba(0, 0, 0, 0.25)'
            : 'inset 0 -2px 0 rgba(0, 0, 0, 0.25), inset 0 2px 0 rgba(255, 255, 255, 0.3)',
        }
      : {
          backgroundColor: 'transparent',
          color: variant === 'danger' ? colors.danger : ghostTextColor,
          border: `2px solid ${variant === 'danger' ? colors.goldDark : panelStyle === 'wood-frame' ? colors.border : colors.accent}`,
          borderRadius: radius,
          boxShadow: 'none',
        };
  return (
    <button
      type={type ?? 'button'}
      title={title}
      disabled={disabled}
      onClick={disabled ? undefined : onClick}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        ...base,
        fontFamily: font.display,
        fontSize: 14,
        // 动森圆体用加粗代替像素描边感；像素皮肤保持原样
        fontWeight: panelStyle === 'soft' ? 700 : 400,
        padding: '8px 16px',
        cursor: disabled ? 'not-allowed' : 'pointer',
        opacity: disabled ? 0.45 : 1,
        // 动森 hover 轻提亮；其余皮肤保持微下沉
        filter: hover && !disabled && panelStyle === 'soft' ? 'brightness(1.08)' : 'none',
        transform: hover && !disabled && panelStyle !== 'soft' ? 'translateY(1px)' : 'none',
        transition: 'transform 0.08s ease-out, filter 0.12s ease-out',
        flexShrink: 0,
        ...style,
      }}
    >
      {children}
    </button>
  );
}
