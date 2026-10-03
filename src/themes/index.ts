import type { ThemeTokens } from './types';
import { pixelJrpg } from './pixel-jrpg';
import { animalCrossing } from './animal-crossing';
import { stardewValley } from './stardew-valley';
import { parchmentJournal } from './parchment-journal';

export type ThemeKey = 'pixel-jrpg' | 'parchment-journal' | 'animal-crossing' | 'stardew-valley';

export interface ThemeMeta {
  /** 设置页显示名 */
  name: string;
  /** 一句气质描述 */
  blurb: string;
  tokens: ThemeTokens;
}

/** 主题注册表：key 即 localStorage('xmission-theme') / settings 表 theme 的存储值 */
export const THEMES: Record<ThemeKey, ThemeMeta> = {
  'pixel-jrpg': {
    name: 'V2 暮色JRPG',
    blurb: '深海军蓝 + 金色像素描边 + CRT 扫描线，复古掌机菜单感。',
    tokens: pixelJrpg,
  },
  'parchment-journal': {
    name: 'V3 羊皮纸手账',
    blurb: '冒险者手抄本：暖纸、墨蓝、琥珀和细致的书页纹理。',
    tokens: parchmentJournal,
  },
  'animal-crossing': {
    name: 'V4 动森小岛',
    blurb: '奶油色小岛：圆角纸感面板 + 小叶子角饰，软乎乎的手工护照风。',
    tokens: animalCrossing,
  },
  'stardew-valley': {
    name: 'V5 星露谷',
    blurb: '深木底 + 羊皮纸面板 + 四角木钉，游戏内菜单的像素质感。',
    tokens: stardewValley,
  },
};

export const DEFAULT_THEME_KEY: ThemeKey = 'pixel-jrpg';
export const THEME_STORAGE_KEY = 'xmission-theme';

export function themeMarker(): string {
  const key = currentThemeKey();
  return key === 'animal-crossing' ? '●'
    : key === 'parchment-journal' ? '❧'
    : key === 'stardew-valley' ? '▰' : '▶';
}

/** 当前主题 key：同步读 localStorage；?theme= 仅用于临时预览，不改动用户选择。 */
export function currentThemeKey(): ThemeKey {
  try {
    const q = new URLSearchParams(window.location.search).get('theme');
    if (q && q in THEMES) {
      return q as ThemeKey;
    }
    const k = localStorage.getItem(THEME_STORAGE_KEY);
    if (k && k in THEMES) return k as ThemeKey;
  } catch {
    // localStorage 不可用（极少数环境）时静默回退默认皮肤
  }
  return DEFAULT_THEME_KEY;
}

/**
 * 全局生效的主题 token。换肤不做运行时热切换：写 localStorage + settings 表后
 * location.reload()，模块初始化时同步选定（全项目模块顶层解构的既有模式保持不变）。
 */
export const activeTheme: ThemeTokens = THEMES[currentThemeKey()].tokens;

/** 输入框/备注区等内凹区域的底色：星露谷用浅羊皮纸，其余用 XP 轨道深色 */
export function fieldBg(t: ThemeTokens = activeTheme): string {
  return t.panelStyle === 'wood-frame' || t.panelStyle === 'parchment'
    ? t.colors.panelLight : t.colors.xpTrack;
}

/* ------------------------------------------------------------------ */
/* 全局副作用：把主题色写进 CSS 变量（滚动条 / TipTap 备注区等无法走     */
/* inline style 的位置），并按皮肤调整 body 基础字体与抗锯齿。           */
/* 模块在 main.tsx / widget.tsx 链路上于渲染前加载，无副作用时序问题。   */
/* ------------------------------------------------------------------ */
try {
  const root = document.documentElement.style;
  const c = activeTheme.colors;
  root.setProperty('--xm-scrollbar-track', fieldBg());
  root.setProperty('--xm-scrollbar-thumb', c.goldDark);
  root.setProperty('--xm-scrollbar-thumb-hover', c.accent);
  root.setProperty('--xm-notes-text', c.text);
  root.setProperty('--xm-notes-strong', c.accent);
  root.setProperty('--xm-notes-border', c.goldDark);
  root.setProperty('--xm-notes-bg', fieldBg());
  document.documentElement.dataset.xmTheme = currentThemeKey();

  // 像素皮肤关闭抗锯齿保持锐利；圆体皮肤开抗锯齿
  const isPixel = (activeTheme.panelStyle ?? 'pixel-step') !== 'soft';
  document.body.style.fontFamily = activeTheme.font.body;
  document.body.style.setProperty('-webkit-font-smoothing', isPixel ? 'none' : 'antialiased');
  document.body.style.fontStyle = 'normal'; // 中文禁用斜体
} catch {
  // 非 DOM 环境（测试/SSR）跳过
}
