import type { ThemeTokens } from './types';
import parchmentTileUrl from '../assets/themes/sv_parchment_tile_clean.png';

/** 冒险者手账：纸张、墨蓝和琥珀。 */
export const parchmentJournal: ThemeTokens = {
  colors: {
    bg: '#c7b899',
    panel: '#ead8b5',
    panelLight: '#f3e6ca',
    text: '#302b27',
    textMuted: '#786d5f',
    accent: '#9a6119',
    accentAlt: '#26375e',
    border: '#775d3c',
    goldDark: '#4e493b',
    xpTrack: '#c9b490',
    danger: '#a34732',
    info: '#26375e',
    highlight: '#ffda83',
  },
  font: {
    display: '"Journal Serif", "KaiTi", serif',
    body: '"Microsoft YaHei UI", "Noto Sans CJK SC", sans-serif',
  },
  iconSet: 'pixel',
  radius: 3,
  panelStyle: 'parchment',
  barStyle: 'pill',
  panelBg: `#ead8b5 url("${parchmentTileUrl}") repeat 0 0 / 512px 512px`,
};
