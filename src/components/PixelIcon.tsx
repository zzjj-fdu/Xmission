import { activeTheme as pixelJrpg, currentThemeKey } from '../themes';
import { ThemeIcon } from './ThemeIcon';
import swordUrl from '../assets/icons/sword.png';
import scrollUrl from '../assets/icons/scroll.png';
import potionUrl from '../assets/icons/potion.png';
import zapUrl from '../assets/icons/zap.png';
import starUrl from '../assets/icons/star.png';
import coinUrl from '../assets/icons/coin.png';
import hourglassUrl from '../assets/icons/hourglass.png';
import shieldUrl from '../assets/icons/shield.png';
import gemUrl from '../assets/icons/gem.png';
import chestUrl from '../assets/icons/chest.png';
import keyUrl from '../assets/icons/key.png';
import bowUrl from '../assets/icons/bow.png';
import staffUrl from '../assets/icons/staff.png';
import heartUrl from '../assets/icons/heart.png';
import trophyUrl from '../assets/icons/trophy.png';
import flameUrl from '../assets/icons/flame.png';
import bookUrl from '../assets/icons/book.png';
import bagUrl from '../assets/icons/bag.png';
import medalUrl from '../assets/icons/medal.png';
import calendarUrl from '../assets/icons/calendar.png';
import catStudyUrl from '../assets/icons/cat_study.png';
import catCodeUrl from '../assets/icons/cat_code.png';
import catReadUrl from '../assets/icons/cat_read.png';
import catWriteUrl from '../assets/icons/cat_write.png';
import catSportUrl from '../assets/icons/cat_sport.png';
import catHealthUrl from '../assets/icons/cat_health.png';
import catChoreUrl from '../assets/icons/cat_chore.png';
import catFinanceUrl from '../assets/icons/cat_finance.png';
import catShoppingUrl from '../assets/icons/cat_shopping.png';
import catMeetingUrl from '../assets/icons/cat_meeting.png';
import catArtUrl from '../assets/icons/cat_art.png';
import catSocialUrl from '../assets/icons/cat_social.png';
import catFoodUrl from '../assets/icons/cat_food.png';

const t = pixelJrpg;

export type PixelIconName =
  | 'sword'
  | 'scroll'
  | 'potion'
  | 'zap'
  | 'star'
  | 'coin'
  | 'check'
  | 'hourglass'
  | 'shield'
  | 'gem'
  | 'chest'
  | 'key'
  | 'bow'
  | 'staff'
  | 'heart'
  | 'trophy'
  | 'flame'
  | 'book'
  | 'bag'
  | 'medal'
  | 'calendar'
  | CategoryIconName;

/** 任务语义分类图标（M4）：key 存 tasks.icon 列 */
export type CategoryIconName =
  | 'cat_study'
  | 'cat_code'
  | 'cat_read'
  | 'cat_write'
  | 'cat_sport'
  | 'cat_health'
  | 'cat_chore'
  | 'cat_finance'
  | 'cat_shopping'
  | 'cat_meeting'
  | 'cat_art'
  | 'cat_social'
  | 'cat_food';

/**
 * 道具图标：AI 生成的 JRPG 像素画 PNG（96×96，透明底，已限色量化），
 * 经 Vite 打包为静态资源；显示尺寸取 16 的整数倍（16/24/32/48），
 * imageRendering: pixelated 保持像素边缘锐利。
 */
const ICON_URLS: Record<Exclude<PixelIconName, 'check'>, string> = {
  sword: swordUrl,
  scroll: scrollUrl,
  potion: potionUrl,
  zap: zapUrl,
  star: starUrl,
  coin: coinUrl,
  hourglass: hourglassUrl,
  shield: shieldUrl,
  gem: gemUrl,
  chest: chestUrl,
  key: keyUrl,
  bow: bowUrl,
  staff: staffUrl,
  heart: heartUrl,
  trophy: trophyUrl,
  flame: flameUrl,
  book: bookUrl,
  bag: bagUrl,
  medal: medalUrl,
  calendar: calendarUrl,
  cat_study: catStudyUrl,
  cat_code: catCodeUrl,
  cat_read: catReadUrl,
  cat_write: catWriteUrl,
  cat_sport: catSportUrl,
  cat_health: catHealthUrl,
  cat_chore: catChoreUrl,
  cat_finance: catFinanceUrl,
  cat_shopping: catShoppingUrl,
  cat_meeting: catMeetingUrl,
  cat_art: catArtUrl,
  cat_social: catSocialUrl,
  cat_food: catFoodUrl,
};

/** 任务语义分类（M4）：key = tasks.icon 列存储值，label 为中文小标签 */
export const TASK_CATEGORIES: { key: string; label: string; icon: CategoryIconName }[] = [
  { key: 'study', label: '学习', icon: 'cat_study' },
  { key: 'code', label: '编程', icon: 'cat_code' },
  { key: 'read', label: '阅读', icon: 'cat_read' },
  { key: 'write', label: '写作', icon: 'cat_write' },
  { key: 'sport', label: '运动', icon: 'cat_sport' },
  { key: 'health', label: '健康', icon: 'cat_health' },
  { key: 'chore', label: '杂务', icon: 'cat_chore' },
  { key: 'finance', label: '财务', icon: 'cat_finance' },
  { key: 'shopping', label: '购物', icon: 'cat_shopping' },
  { key: 'meeting', label: '会议', icon: 'cat_meeting' },
  { key: 'art', label: '创作', icon: 'cat_art' },
  { key: 'social', label: '社交', icon: 'cat_social' },
  { key: 'food', label: '饮食', icon: 'cat_food' },
];

/** tasks.icon 分类 key → 像素图标；无分类/未知分类用默认卷轴 */
export function taskIcon(icon: string): PixelIconName {
  const hit = TASK_CATEGORIES.find((c) => c.key === icon);
  return hit ? hit.icon : 'scroll';
}

/**
 * 对勾保留矢量像素画：checkbox（深色勾压在金色上）与番茄钟（绿色勾）
 * 需要 color 覆盖，PNG 无法重着色。
 */
const CHECK_ROWS = [
  '................',
  '................',
  '................',
  '................',
  '............XX..',
  '...........XXX..',
  '.XX........XX...',
  '..XX......XX....',
  '...XX....XX.....',
  '....XX..XX......',
  '.....XXXX.......',
  '......XX........',
  '................',
  '................',
  '................',
  '................',
];

function CheckGlyph({ size, color }: { size: number; color: string }) {
  const rects: { x: number; y: number; w: number }[] = [];
  CHECK_ROWS.forEach((row, y) => {
    let x = 0;
    while (x < row.length) {
      const ch = row[x];
      if (ch === '.') {
        x += 1;
        continue;
      }
      let w = 1;
      while (x + w < row.length && row[x + w] === ch) w += 1;
      rects.push({ x, y, w });
      x += w;
    }
  });
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 16 16"
      shapeRendering="crispEdges"
      aria-hidden="true"
      style={{ display: 'block', flexShrink: 0 }}
    >
      {rects.map((r, i) => (
        <rect key={i} x={r.x} y={r.y} width={r.w} height={1} fill={color} />
      ))}
    </svg>
  );
}

export interface PixelIconProps {
  name: PixelIconName;
  /** 边长（px），默认 16；必须 16 的整数倍（16/24/32/48）保持整数缩放 */
  size?: number;
  /** 仅对 'check' 生效：覆盖勾的颜色 */
  color?: string;
  className?: string;
}

export function PixelIcon({ name, size = 16, color, className }: PixelIconProps) {
  if (name === 'check') {
    if (currentThemeKey() !== 'pixel-jrpg') {
      return <svg width={size} height={size} viewBox="0 0 20 20" aria-hidden="true"
        style={{ display: 'block', flexShrink: 0 }} fill="none" stroke={color ?? t.colors.panel}
        strokeWidth={currentThemeKey() === 'stardew-valley' ? 2.8 : 2.3}
        strokeLinecap={currentThemeKey() === 'stardew-valley' ? 'square' : 'round'}
        strokeLinejoin="round" shapeRendering={currentThemeKey() === 'stardew-valley' ? 'crispEdges' : 'geometricPrecision'}>
        <path d="m3 10 5 5 9-10" />
      </svg>;
    }
    return <CheckGlyph size={size} color={color ?? t.colors.panel} />;
  }
  if (currentThemeKey() !== 'pixel-jrpg') {
    return <ThemeIcon name={name} size={size} className={className} />;
  }
  return (
    <img
      src={ICON_URLS[name]}
      width={size}
      height={size}
      className={className}
      aria-hidden="true"
      draggable={false}
      style={{ display: 'block', flexShrink: 0, imageRendering: 'pixelated' }}
    />
  );
}

/** 任务形态 → 像素图标映射：主线→剑，支线→卷轴，遭遇→药水 */
export function formIcon(form: string): PixelIconName {
  switch (form) {
    case 'main_quest':
      return 'sword';
    case 'side_quest':
      return 'scroll';
    case 'encounter':
      return 'potion';
    default:
      return 'scroll';
  }
}
