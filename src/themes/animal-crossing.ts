import type { ThemeTokens } from './types';
import leafTileUrl from '../assets/themes/ac_leaf_tile_clean.png';

/**
 * V4 动物森友会（动森小岛）—— 浅色皮肤：奶油底小叶平铺 + 纸白圆角面板 +
 * 叶绿主强调 + 暖橙次强调。气质：软、圆、奶油色、Nook 终端/护照的手工感。
 * 中文用圆体栈，加粗走 fontWeight，绝不出现斜体。
 */
export const animalCrossing: ThemeTokens = {
  colors: {
    bg: '#F5F0E1', // 奶油底（配叶子平铺）
    panel: '#FFFDF6', // 纸白面板
    panelLight: '#F3EAD3', // 米黄提亮
    text: '#4A3F35', // 暖棕正文
    textMuted: '#9A8B7A',
    accent: '#68B34A', // 动森叶绿（主强调）
    accentAlt: '#F4A261', // 暖橙（次强调/金币）
    border: '#E3D7C0', // 柔和描边
    goldDark: '#D8C9A8', // 此皮肤里作「更深的柔描边」用
    xpTrack: '#EDE4CE',
    danger: '#E0604E', // 柔珊瑚红
    info: '#6BA8C9', // 天空蓝
    highlight: '#FFF3C9',
  },
  font: {
    display: '"Island Round", "Microsoft YaHei UI", sans-serif',
    body: '"Island Round", "Microsoft YaHei UI", sans-serif',
  },
  iconSet: 'pixel',
  radius: 12,
  panelStyle: 'soft',
  barStyle: 'pill',
  // 奶油底 + 小叶平铺（256px repeat，低对比已调好）
  appBg: `#F5F0E1 url("${leafTileUrl}") repeat 0 0 / 512px 512px`,
};
