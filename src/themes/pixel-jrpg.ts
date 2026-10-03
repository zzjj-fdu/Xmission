import type { ThemeTokens } from './types';

/** V2 像素 JRPG —— 一期默认皮肤：深海军蓝面板 + 金色像素描边 + 绿 XP 条 */
export const pixelJrpg: ThemeTokens = {
  colors: {
    bg: '#12132b',
    panel: '#1a1c3b',
    panelLight: '#252852',
    text: '#f4f1de',
    textMuted: '#9c9bb8',
    accent: '#f5c542',
    accentAlt: '#4ade80',
    border: '#f5c542',
    goldDark: '#8a5a19',
    xpTrack: '#0d0f24',
    danger: '#e05c5c',
    info: '#63d6e8',
    highlight: '#ffedba',
  },
  font: {
    display: '"Fusion Pixel", "Zpix", "Cubic 11", monospace',
    body: '"Fusion Pixel", "Zpix", "Cubic 11", monospace',
  },
  panelStyle: 'pixel-step',
  barStyle: 'pixel',
  iconSet: 'pixel',
};
