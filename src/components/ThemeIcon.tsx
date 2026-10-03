import type { ReactNode } from 'react';
import { activeTheme, currentThemeKey } from '../themes';
import type { PixelIconName } from './PixelIcon';
import farmAtlas from '../assets/icon-atlases/farm-items.png';
import islandAtlas from '../assets/icon-atlases/island-items.png';
import journalAtlas from '../assets/icon-atlases/journal-items.png';
import journalCode from '../assets/icon-atlases/journal-code.png';
import islandCode from '../assets/icon-atlases/island-code.png';
import journalScrollClean from '../assets/icon-atlases/journal-scroll-clean.png';
import journalMapClean from '../assets/icon-atlases/journal-map-clean.png';
import farmCalendarClean from '../assets/icon-atlases/farm-calendar-clean.png';

type Atlas = { src: string; width: number; height: number; xCuts: number[]; yCuts: number[]; rects?: [number, number, number, number][]; slots: Partial<Record<PixelIconName, number>> };
const atlases: Record<string, Atlas> = {
  'stardew-valley': { src: farmAtlas, width: 1312, height: 1199, xCuts: [0, 350, 660, 985, 1312], yCuts: [0, 310, 622, 886, 1199],
    rects: [
      [62, 23, 276, 271], [360, 28, 284, 269], [704, 29, 255, 268], [996, 28, 301, 269],
      [38, 324, 291, 291], [375, 327, 270, 282], [704, 319, 259, 294], [993, 341, 306, 269],
      [27, 637, 317, 244], [359, 635, 297, 247], [677, 635, 301, 247], [993, 635, 305, 248],
      [44, 900, 300, 286], [360, 897, 293, 286], [666, 894, 308, 292], [990, 899, 308, 292],
    ], slots: {
    sword: 0, scroll: 2, potion: 13, zap: 6, star: 6, coin: 5, hourglass: 7, shield: 4, gem: 13, chest: 3,
    bow: 1, staff: 7, heart: 13, trophy: 6, flame: 6, book: 10, bag: 3, medal: 5, calendar: 8,
    cat_study: 8, cat_code: 9, cat_read: 10, cat_write: 11, cat_sport: 12, cat_health: 13,
    cat_chore: 7, cat_finance: 5, cat_shopping: 3, cat_meeting: 15, cat_art: 14,
    cat_social: 15, cat_food: 0,
  } },
  'animal-crossing': { src: islandAtlas, width: 1322, height: 1190, xCuts: [0, 345, 675, 982, 1322], yCuts: [0, 340, 620, 886, 1190],
    rects: [
      [72, 68, 256, 263], [370, 78, 286, 252], [687, 67, 275, 268], [1000, 66, 291, 269],
      [68, 345, 266, 273], [373, 346, 274, 272], [699, 346, 255, 269], [995, 346, 295, 272],
      [55, 627, 286, 253], [363, 628, 294, 253], [675, 639, 285, 242], [995, 635, 300, 246],
      [54, 891, 287, 286], [356, 889, 308, 290], [675, 891, 290, 286], [995, 891, 308, 286],
    ], slots: {
    sword: 6, scroll: 0, potion: 2, zap: 0, star: 0, coin: 5, hourglass: 9, shield: 11,
    gem: 1, chest: 4, bow: 3, staff: 6, heart: 11, trophy: 15, flame: 11,
    book: 7, bag: 12, medal: 0, calendar: 8,
    cat_study: 7, cat_read: 7, cat_write: 9, cat_sport: 10, cat_health: 11,
    cat_chore: 6, cat_finance: 5, cat_shopping: 12, cat_meeting: 13,
    cat_art: 9, cat_social: 13, cat_food: 14,
  } },
  'parchment-journal': { src: journalAtlas, width: 1451, height: 1084, xCuts: [0, 375, 740, 1090, 1451], yCuts: [0, 285, 560, 820, 1084],
    // Artwork crosses the nominal grid lines. Each rectangle isolates one object,
    // so neighbouring ornaments cannot appear above or below a rendered icon.
    rects: [
      [58, 3, 300, 282], [397, 4, 333, 274], [760, 8, 285, 273], [1098, 14, 330, 260],
      [35, 298, 345, 258], [445, 284, 242, 270], [777, 296, 275, 263], [1166, 287, 216, 277],
      [20, 568, 410, 242], [430, 570, 305, 240], [771, 576, 296, 239], [1097, 578, 344, 240],
      [65, 822, 293, 239], [397, 822, 339, 252], [748, 830, 342, 238], [1136, 823, 272, 249],
    ], slots: {
    sword: 0, scroll: 1, potion: 5, zap: 2, star: 2, coin: 6, hourglass: 7,
    shield: 2, gem: 2, chest: 3, key: 4, bow: 0, staff: 9,
    trophy: 2, flame: 6, book: 10, bag: 3, medal: 2, calendar: 11,
    cat_study: 8, cat_read: 10, cat_write: 9, cat_sport: 12, cat_health: 13,
    cat_chore: 11, cat_finance: 6, cat_shopping: 3, cat_meeting: 15,
    cat_art: 14, cat_social: 15, cat_food: 5,
  } },
};

function AtlasIcon({ atlas, slot, size, pixel, className }: { atlas: Atlas; slot: number; size: number; pixel: boolean; className?: string }) {
  const column = slot % 4;
  const row = Math.floor(slot / 4);
  const cell = atlas.rects?.[slot];
  const x = cell?.[0] ?? atlas.xCuts[column] + 8;
  const y = cell?.[1] ?? atlas.yCuts[row] + 8;
  const cellWidth = cell?.[2] ?? atlas.xCuts[column + 1] - atlas.xCuts[column] - 16;
  const cellHeight = cell?.[3] ?? atlas.yCuts[row + 1] - atlas.yCuts[row] - 16;
  const scale = Math.min(size / cellWidth, size / cellHeight) * 1.05;
  return <span className={className} aria-hidden="true" style={{
    display: 'inline-block', position: 'relative', overflow: 'hidden',
    width: size, height: size, flexShrink: 0, verticalAlign: 'middle',
  }}><img src={atlas.src} alt="" draggable={false} style={{
    position: 'absolute', maxWidth: 'none', width: atlas.width * scale,
    height: atlas.height * scale,
    left: (size - cellWidth * scale) / 2 - x * scale,
    top: (size - cellHeight * scale) / 2 - y * scale,
    imageRendering: pixel ? 'pixelated' : 'auto',
    pointerEvents: 'none',
  }} /></span>;
}

type Motif = 'compass' | 'page' | 'vial' | 'spark' | 'seal' | 'coin' | 'clock' | 'crest' | 'gem' | 'satchel' | 'key' | 'leaf' | 'pen' | 'heart' | 'award' | 'sun' | 'book' | 'basket' | 'calendar' | 'sprout' | 'flower' | 'shell' | 'gift' | 'bell' | 'crop' | 'seed' | 'crate' | 'berry' | 'watering' | 'chicken' | 'study' | 'code' | 'sport' | 'health' | 'chore' | 'finance' | 'shopping' | 'meeting' | 'art' | 'social' | 'food';

const journal: Partial<Record<PixelIconName, Motif>> = {
  sword: 'compass', scroll: 'page', potion: 'vial', zap: 'spark', star: 'seal', coin: 'coin', hourglass: 'clock', shield: 'crest', gem: 'seal', chest: 'satchel', key: 'key', bow: 'compass', staff: 'pen', heart: 'heart', trophy: 'award', flame: 'sun', book: 'book', bag: 'satchel', medal: 'seal', calendar: 'calendar',
  cat_finance: 'coin', cat_shopping: 'satchel', cat_food: 'basket',
};
const island: Partial<Record<PixelIconName, Motif>> = {
  sword: 'sprout', scroll: 'leaf', potion: 'flower', zap: 'spark', star: 'flower', coin: 'bell', hourglass: 'sun', shield: 'leaf', gem: 'shell', chest: 'gift', key: 'key', bow: 'leaf', staff: 'sprout', heart: 'heart', trophy: 'flower', flame: 'sun', book: 'book', bag: 'basket', medal: 'flower', calendar: 'calendar',
  cat_chore: 'sprout', cat_finance: 'bell', cat_shopping: 'basket', cat_art: 'flower',
};
const farm: Partial<Record<PixelIconName, Motif>> = {
  sword: 'crop', scroll: 'seed', potion: 'berry', zap: 'spark', star: 'sun', coin: 'coin', hourglass: 'clock', shield: 'chicken', gem: 'berry', chest: 'crate', key: 'key', bow: 'sprout', staff: 'watering', heart: 'heart', trophy: 'award', flame: 'sun', book: 'book', bag: 'basket', medal: 'flower', calendar: 'calendar',
  cat_study: 'page', cat_code: 'code', cat_read: 'book', cat_write: 'pen', cat_sport: 'sport', cat_health: 'berry', cat_chore: 'watering', cat_finance: 'coin', cat_shopping: 'crate', cat_meeting: 'chicken', cat_art: 'flower', cat_social: 'heart', cat_food: 'crop',
};
const categories: Record<string, Motif> = {
  cat_study: 'study', cat_code: 'code', cat_read: 'book', cat_write: 'pen', cat_sport: 'sport', cat_health: 'health', cat_chore: 'chore', cat_finance: 'finance', cat_shopping: 'shopping', cat_meeting: 'meeting', cat_art: 'art', cat_social: 'social', cat_food: 'food',
};

function drawing(m: Motif, fill: string): ReactNode {
  switch (m) {
    case 'compass': return <><circle cx="12" cy="12" r="8.5"/><path d="m15.6 8.4-2.1 5.1-5.1 2.1 2.1-5.1z" fill={fill}/><path d="M12 2v2m0 16v2M2 12h2m16 0h2"/></>;
    case 'page': return <><path d="M5 3h10l4 4v14H5z" fill={fill}/><path d="M15 3v4h4M8 11h8M8 14h8M8 17h5"/></>;
    case 'vial': return <><path d="M9 3h6M10 3v7l-4 7a3 3 0 0 0 2.6 4h6.8a3 3 0 0 0 2.6-4l-4-7V3"/><path d="M8 16h8l1 2-1 2H8l-1-2z" fill={fill}/></>;
    case 'spark': return <path d="m13 2-8 11h6l-1 9 9-12h-6z" fill={fill}/>;
    case 'seal': return <><circle cx="12" cy="11" r="8" fill={fill}/><circle cx="12" cy="11" r="5"/><path d="m9 17-1 5 4-2 4 2-1-5M12 8v6m-3-3h6"/></>;
    case 'coin': case 'bell': return <><circle cx="12" cy="12" r="9" fill={fill}/><circle cx="12" cy="12" r="6"/><path d={m === 'bell' ? 'M9 10c0-2 6-2 6 0v4H9zm1 6h4M12 7v2' : 'M12 7v10m3-8c-4-2-6 0-6 2s6 0 6 3-3 3-6 1'}/></>;
    case 'clock': return <><circle cx="12" cy="12" r="9" fill={fill}/><path d="M12 6v6l4 2"/></>;
    case 'crest': return <><path d="M12 2 4 5v6c0 6 4 9 8 11 4-2 8-5 8-11V5z" fill={fill}/><path d="M12 6v11m-4-6h8"/></>;
    case 'gem': case 'shell': return <><path d={m === 'shell' ? 'M3 15c0-7 4-11 9-11s9 4 9 11l-9 6z' : 'M7 4h10l5 7-10 10L2 11z'} fill={fill}/><path d={m === 'shell' ? 'M12 5v13M6 8l6 10m6-10-6 10M4 14h16' : 'M2 11h20M7 4l5 17L17 4'}/></>;
    case 'satchel': case 'basket': case 'shopping': return <><path d="M4 9h16l-1 12H5z" fill={fill}/><path d="M8 9V7a4 4 0 0 1 8 0v2M4 13h16m-10 2h4"/></>;
    case 'key': return <><circle cx="8" cy="9" r="4" fill={fill}/><path d="m11 12 9 9m-3-3 2-2m-5-1 2-2"/></>;
    case 'leaf': return <><path d="M20 4C10 4 4 8 4 15a5 5 0 0 0 5 5c7 0 11-6 11-16Z" fill={fill}/><path d="M5 19c4-5 7-8 13-11"/></>;
    case 'pen': return <><path d="m4 20 5-1L20 8l-4-4L5 15z" fill={fill}/><path d="m13 7 4 4M4 20h15"/></>;
    case 'heart': case 'health': return <path d="M12 21 4.2 13C-1 7.6 6 1.7 12 7c6-5.3 13 0.6 7.8 6z" fill={fill}/>;
    case 'award': return <><path d="M8 3h8l2 6-6 5-6-5z" fill={fill}/><path d="m8 13-2 9 6-3 6 3-2-9"/></>;
    case 'sun': return <><circle cx="12" cy="12" r="4.5" fill={fill}/><path d="M12 1v4m0 14v4M1 12h4m14 0h4M4 4l3 3m10 10 3 3M20 4l-3 3M7 17l-3 3"/></>;
    case 'book': case 'study': return <><path d="M3 5c4-2 7-1 9 1 2-2 5-3 9-1v15c-4-2-7-1-9 1-2-2-5-3-9-1z" fill={fill}/><path d="M12 6v15M6 9h3m6 0h3"/></>;
    case 'calendar': return <><rect x="3" y="5" width="18" height="16" rx="1" fill={fill}/><path d="M7 2v6m10-6v6M3 10h18M8 14h3m3 0h3m-9 4h3"/></>;
    case 'sprout': return <><path d="M12 21V10M12 13C5 14 3 9 3 5c5 0 9 1 9 8Zm0-3c0-6 4-7 9-7 0 5-3 8-9 7Z" fill={fill}/></>;
    case 'flower': return <><circle cx="12" cy="12" r="3" fill={fill}/><path d="M12 9C6 2 2 9 9 12c-7 3-3 10 3 3 6 7 10 0 3-3 7-3 3-10-3-3Z"/><path d="M12 16v6m0-2 4-2"/></>;
    case 'gift': return <><path d="M3 9h18v12H3z" fill={fill}/><path d="M2 9h20v4H2zM12 9v12M12 9C3 8 6 2 10 5l2 4Zm0 0c9-1 6-7 2-4l-2 4Z"/></>;
    case 'crate': return <><path d="M5 10h14v11H5z" fill="#BD7B3D"/><path d="M5 10h14v11H5zM3 10h18M3 14h18M3 20h18M7 14l10 6m0-6L7 20"/><circle cx="8" cy="7" r="2.5" fill="#C95335"/><circle cx="15" cy="7" r="2.7" fill="#D8A93F"/><path d="M10 5c0-2 2-3 4-2m-1 1 2-2" stroke="#4D883A"/></>;
    case 'crop': return <><path d="M13 7c-2-4-6-4-7-3 0 4 3 6 7 6m0-2c1-4 5-5 7-4 0 4-3 7-7 7" fill={fill}/><path d="M13 9c-1 6-3 9-4 12h6c-1-3-2-7-2-12Z" fill={fill}/><path d="M8 21h8"/></>;
    case 'seed': return <><path d="M5 4h14l-1 17H6z" fill={fill}/><path d="M5 8h14M12 18v-7m0 4c-3 0-4-2-4-3m4 3c3 0 4-2 4-3"/></>;
    case 'berry': return <><path d="M7 10c-5 6 0 12 5 11 5 1 10-5 5-11-3-3-7-3-10 0Z" fill={fill}/><path d="M12 9c-4-5-6-3-7-1 4 0 5 2 7 1Zm0 0c4-5 6-3 7-1-4 0-5 2-7 1Z"/><path d="M9 14h.1m5 3h.1"/></>;
    case 'watering': return <><path d="M5 10h12v10H7z" fill={fill}/><path d="M17 11c5-4 6 1 2 4l-2 1M5 11C0 9 1 17 6 16M11 10V6h5M17 2v3m4 0v3"/></>;
    case 'chicken': return <><path d="M6 9c-4 7 0 12 7 12 6 0 9-5 5-10l-3-4-3 3z" fill={fill}/><path d="M16 7c0-4-4-3-4 0m6 2 4 2-4 2M15 12h.1M9 21v2m5-2v2"/></>;
    case 'code': return <><rect x="2" y="4" width="20" height="16" rx="2" fill={fill}/><path d="m9 9-3 3 3 3m6-6 3 3-3 3m-2-8-2 10"/></>;
    case 'sport': return <><path d="M3 16c4 0 5-2 7-7l3 2 2 4 6 2v4H3z" fill={fill}/><path d="M3 17h18M11 11l3-4m-4 6 3 2"/></>;
    case 'chore': return <><path d="M10 2h4v8h-4zm-5 8h14l-2 11H7z" fill={fill}/><path d="M8 15h8M12 2v8"/></>;
    case 'finance': return <><circle cx="12" cy="12" r="9" fill={fill}/><path d="M12 5v14m4-11c-6-2-8 0-8 3 0 4 8 0 8 4 0 3-4 4-8 2"/></>;
    case 'meeting': case 'social': return <><circle cx="8" cy="8" r="3" fill={fill}/><circle cx="17" cy="9" r="2.5" fill={fill}/><path d="M2 21v-3a6 6 0 0 1 12 0v3zm13 0v-3a5 5 0 0 0-1-3 5 5 0 0 1 8 4v2z"/></>;
    case 'art': return <><path d="M12 2a10 10 0 1 0 0 20h2c3 0 3-3 1-4-2-2 0-4 3-4h3C22 7 18 2 12 2Z" fill={fill}/><circle cx="7" cy="10" r="1"/><circle cx="12" cy="6" r="1"/><circle cx="17" cy="9" r="1"/><circle cx="8" cy="16" r="1"/></>;
    case 'food': return <><path d="M3 12h18c0 6-4 9-9 9s-9-3-9-9Z" fill={fill}/><path d="M3 12h18M8 3v6m5-6v6m5-6v6"/></>;
  }
}

export function ThemeIcon({ name, size, className }: { name: PixelIconName; size: number; className?: string }) {
  const theme = currentThemeKey();
  const cleanIcon = theme === 'parchment-journal'
    ? name === 'scroll' ? journalScrollClean : (name === 'calendar' || name === 'cat_chore') ? journalMapClean : null
    : theme === 'stardew-valley' && name === 'calendar' ? farmCalendarClean : null;
  if (cleanIcon) return <img className={className} src={cleanIcon} alt="" aria-hidden="true" draggable={false}
    width={size} height={size} style={{ display: 'block', flexShrink: 0, objectFit: 'contain', transform: `scale(${theme === 'stardew-valley' ? 1.4 : 1.3})`, imageRendering: theme === 'stardew-valley' ? 'pixelated' : 'auto' }} />;
  if (name === 'cat_code' && (theme === 'parchment-journal' || theme === 'animal-crossing')) {
    return <img className={className} src={theme === 'parchment-journal' ? journalCode : islandCode}
      alt="" aria-hidden="true" draggable={false} width={size} height={size}
      style={{ display: 'block', flexShrink: 0, objectFit: 'contain', clipPath: 'inset(5%)' }} />;
  }
  const atlas = atlases[theme];
  const slot = atlas?.slots[name];
  if (atlas && slot !== undefined) return <AtlasIcon atlas={atlas} slot={slot} size={size} pixel={theme === 'stardew-valley'} className={className} />;
  const motif = (theme === 'stardew-valley' ? farm[name] : theme === 'animal-crossing' ? island[name] : journal[name]) ?? categories[name] ?? 'spark';
  const c = activeTheme.colors;
  const pixel = theme === 'stardew-valley';
  const fill = theme === 'animal-crossing' ? '#D6EDBA' : pixel ? '#E8B961' : '#E8CF9A';
  return <svg className={className} width={size} height={size} viewBox="0 0 24 24" aria-hidden="true"
    shapeRendering={pixel ? 'crispEdges' : 'geometricPrecision'}
    style={{ display: 'block', flexShrink: 0, overflow: 'visible' }}
    fill="none" stroke={pixel ? c.goldDark : theme === 'animal-crossing' ? '#488B50' : c.accentAlt}
    strokeWidth={pixel ? 1.8 : 1.55} strokeLinecap={pixel ? 'square' : 'round'} strokeLinejoin={pixel ? 'miter' : 'round'}>
    {drawing(motif, fill)}
  </svg>;
}
