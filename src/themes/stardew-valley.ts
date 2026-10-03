import type { ThemeTokens } from './types';
import woodTileUrl from '../assets/themes/sv_wood_tile_clean.png';
import parchmentTileUrl from '../assets/themes/sv_parchment_tile_clean.png';

/**
 * V5 星露谷物语 —— 深木色底（木板平铺 + 深色叠加）+ 羊皮纸面板的强对比结构，
 * 像素字体 + 直角 crispEdges，游戏内菜单的感觉。
 * 面板为「木框 + 羊皮纸芯」：3px 深木棕外描边 + 内圈浅木色 + 羊皮纸底，四角小方钉。
 */
export const stardewValley: ThemeTokens = {
  colors: {
    bg: '#3A2415', // 深木（配木板平铺+深色叠加）
    panel: '#F4D8A8', // 羊皮纸（配 parchment 平铺）
    panelLight: '#F8E4BC',
    text: '#5A3222', // 深棕正文
    textMuted: '#9A7B4F',
    accent: '#DDA033', // 金
    accentAlt: '#4E8C3A', // 牧草绿
    border: '#8B5A2B', // 木棕描边
    goldDark: '#5A3A22', // 深木棕（描边暗部）
    xpTrack: '#C89B5F',
    danger: '#B53A2A',
    info: '#4A7C9C',
    highlight: '#FFE8B0',
  },
  font: {
    display: '"Ark Pixel CN", "Ark Pixel Latin", "Fusion Pixel", monospace',
    body: '"Ark Pixel CN", "Ark Pixel Latin", "Fusion Pixel", monospace',
  },
  iconSet: 'pixel',
  radius: 0,
  panelStyle: 'wood-frame',
  barStyle: 'pixel',
  // 木板平铺 + 深色叠加（保证文字可读性），256px repeat
  appBg: `linear-gradient(rgba(46,28,16,0.78), rgba(46,28,16,0.78)) 0 0 / 512px 512px repeat, #3A2415 url("${woodTileUrl}") 0 0 / 512px 512px repeat`,
  // 羊皮纸平铺作面板底
  panelBg: `#F4D8A8 url("${parchmentTileUrl}") repeat 0 0 / 512px 512px`,
};
