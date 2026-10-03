import type { CSSProperties } from 'react';
import { activeTheme as pixelJrpg, fieldBg } from '../themes';

const { colors, font } = pixelJrpg;

/**
 * 输入框基础样式：像素皮深底暗金边、focus 亮金描边；
 * 动森圆角奶油底；星露谷羊皮纸浅底木棕边。focus 时边框变主题强调色
 */
export function pixelFieldStyle(focus: boolean): CSSProperties {
  return {
    background: fieldBg(pixelJrpg),
    color: colors.text,
    border: `2px solid ${focus ? colors.accent : colors.goldDark}`,
    boxShadow: focus
      ? `inset 0 0 0 1px ${colors.goldDark}, 0 0 0 1px ${colors.accent}`
      : `inset 0 0 0 1px ${colors.panelLight}`,
    borderRadius: pixelJrpg.radius ?? 0,
    outline: 'none',
    padding: '8px 10px',
    fontFamily: font.body,
    fontSize: 14,
  };
}
