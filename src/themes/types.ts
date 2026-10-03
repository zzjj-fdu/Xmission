export interface ThemeTokens {
  colors: {
    bg: string;
    panel: string;
    /** 面板提亮层：hover 态、内层卡片 */
    panelLight: string;
    text: string;
    textMuted: string;
    accent: string;
    accentAlt: string;
    border: string;
    /** 深金色：金色描边的暗部/按钮深色描边，制造像素立体层次 */
    goldDark: string;
    /** XP 条轨道底色 */
    xpTrack: string;
    /** 危险/删除 */
    danger: string;
    /** 信息青：章节标题、任务副标题/描述行（概念图 V2 的青色文字） */
    info: string;
    /** 浅金高光：像素图标的受光面/闪光像素 */
    highlight: string;
  };
  font: {
    display: string;
    body: string;
  };
  iconSet: 'pixel' | 'line';
  /** 面板/按钮/输入框圆角（px）；缺省 0 = 像素直角 */
  radius?: number;
  /** 根容器 CSS background 值（可含 url 贴图 + 叠加色）；缺省用 colors.bg 纯色 */
  appBg?: string;
  /** QuestPanel 等面板的 CSS background 值（贴图）；缺省用 colors.panel 纯色 */
  panelBg?: string;
  /** 面板描边风格：pixel-step = 像素阶梯金框（默认）；soft = 圆角纸感；wood-frame = 木框羊皮纸 */
  panelStyle?: 'pixel-step' | 'soft' | 'wood-frame' | 'parchment';
  /** 进度条风格：pixel = 分段像素块（默认）；pill = 圆角药丸 */
  barStyle?: 'pixel' | 'pill';
}
