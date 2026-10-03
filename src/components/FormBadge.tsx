import { activeTheme, currentThemeKey } from '../themes';
import { PixelIcon, formIcon } from './PixelIcon';
import farmRibbon from '../assets/badges/farm-ribbon.png';
import islandTag from '../assets/badges/island-tag.png';
import journalRibbon from '../assets/badges/journal-ribbon.png';

const labels: Record<string, Record<string, string>> = {
  'pixel-jrpg': { main_quest: '主线', side_quest: '支线', encounter: '遭遇' },
  'parchment-journal': { main_quest: '主章', side_quest: '支章', encounter: '见闻' },
  'animal-crossing': { main_quest: '今日目标', side_quest: '小计划', encounter: '新发现' },
  'stardew-valley': { main_quest: '农场目标', side_quest: '村民委托', encounter: '今日采集' },
};
const compactLabels: Record<string, Record<string, string>> = {
  'pixel-jrpg': labels['pixel-jrpg'],
  'parchment-journal': labels['parchment-journal'],
  'animal-crossing': { main_quest: '目标', side_quest: '计划', encounter: '发现' },
  'stardew-valley': { main_quest: '农场', side_quest: '委托', encounter: '采集' },
};

type BadgeArt = { src: string; imageWidth: number; imageHeight: number; x: number; y: number; width: number; height: number };
const art: Record<string, BadgeArt> = {
  'stardew-valley': { src: farmRibbon, imageWidth: 2172, imageHeight: 724, x: 76, y: 186, width: 2020, height: 348 },
  'animal-crossing': { src: islandTag, imageWidth: 2089, imageHeight: 753, x: 100, y: 162, width: 1896, height: 402 },
  'parchment-journal': { src: journalRibbon, imageWidth: 2072, imageHeight: 759, x: 102, y: 176, width: 1874, height: 382 },
};

export function formLabel(form: string): string {
  return labels[currentThemeKey()]?.[form] ?? form;
}

export function FormBadge({ form, compact = false }: { form: string; compact?: boolean }) {
  const theme = currentThemeKey();
  const t = activeTheme;
  const caption = compact ? compactLabels[theme]?.[form] ?? form : formLabel(form);
  const badge = art[theme];
  if (badge) {
    const width = compact ? (theme === 'stardew-valley' ? 112 : 104) : (theme === 'stardew-valley' ? 136 : 126);
    const height = compact ? 26 : 30;
    const scaleX = width / badge.width;
    const scaleY = height / badge.height;
    return <span style={{
      display: 'inline-flex', position: 'relative', alignItems: 'center', justifyContent: 'center',
      flexShrink: 0, width, height, overflow: 'hidden', verticalAlign: 'middle',
      color: theme === 'animal-crossing' ? '#4A3F35' : '#FFF1CA',
      fontFamily: t.font.display, fontSize: compact ? 12 : 13,
      fontWeight: theme === 'animal-crossing' ? 700 : 600,
      letterSpacing: theme === 'parchment-journal' ? '.05em' : 0,
      textShadow: theme === 'animal-crossing' ? '0 1px 0 #fff' : '0 1px 1px rgba(23,18,10,.7)',
      whiteSpace: 'nowrap',
    }}>
      <img src={badge.src} alt="" draggable={false} aria-hidden="true" style={{
        position: 'absolute', maxWidth: 'none', pointerEvents: 'none',
        width: badge.imageWidth * scaleX, height: badge.imageHeight * scaleY,
        left: -badge.x * scaleX, top: -badge.y * scaleY,
        imageRendering: theme === 'stardew-valley' ? 'pixelated' : 'auto',
      }} />
      <span style={{ position: 'relative', zIndex: 1, display: 'inline-flex', alignItems: 'center', gap: 3,
        paddingLeft: theme === 'parchment-journal' ? 13 : theme === 'animal-crossing' ? 10 : 0 }}>
        <PixelIcon name={formIcon(form)} size={compact ? 18 : 19} />
        {caption}
      </span>
    </span>;
  }
  const color = form === 'main_quest' ? t.colors.accent : form === 'side_quest' ? t.colors.info : t.colors.accentAlt;
  return <span style={{
    display: 'inline-flex', alignItems: 'center', gap: 3, flexShrink: 0,
    padding: compact ? '2px 5px' : '3px 7px', minHeight: compact ? 22 : 30,
    whiteSpace: 'nowrap', color, background: t.colors.panelLight,
    border: `2px solid ${color}`, boxShadow: `inset 0 0 0 1px ${t.colors.goldDark}, 2px 2px 0 ${t.colors.goldDark}`,
    fontFamily: t.font.display, fontSize: compact ? 11 : 13, lineHeight: 1.1,
  }}><PixelIcon name={formIcon(form)} size={compact ? 16 : 20} />{caption}</span>;
}
