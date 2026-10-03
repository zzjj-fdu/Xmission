import type { CSSProperties, ReactNode } from 'react';
import { activeTheme, currentThemeKey } from '../themes';
import { PixelIcon } from './PixelIcon';
import type { PixelIconName } from './PixelIcon';

const t = activeTheme;
const motifs: Record<string, PixelIconName> = {
  'pixel-jrpg': 'gem', 'parchment-journal': 'scroll',
  'animal-crossing': 'bow', 'stardew-valley': 'staff',
};

export interface SectionHeaderProps {
  children?: ReactNode;
  label?: string;
  muted?: boolean;
  etched?: boolean;
  style?: CSSProperties;
}

export function SectionHeader({ children, label, muted, etched = true, style }: SectionHeaderProps) {
  const theme = currentThemeKey();
  const soft = theme === 'animal-crossing';
  const farm = theme === 'stardew-valley';
  return <div style={{
    display: 'flex', alignItems: 'center', gap: 8,
    margin: etched ? '2px 0 10px' : '6px 0 2px',
    padding: etched ? '2px 0' : '1px 3px',
    color: muted ? t.colors.textMuted : farm ? t.colors.goldDark : t.colors.info,
    fontFamily: t.font.display, fontWeight: soft || farm ? 700 : 500,
    fontSize: 13, letterSpacing: soft ? '.02em' : '.08em',
    ...style,
  }}>
    <PixelIcon name={motifs[theme]} size={20} />
    <span style={{ whiteSpace: 'nowrap' }}>{children ?? label}</span>
    <span aria-hidden="true" style={{
      height: farm ? 3 : 1, flex: 1, minWidth: 10,
      marginLeft: 2,
      background: soft ? 'none' : t.colors.goldDark,
      borderTop: soft ? `2px dotted ${t.colors.accent}` : farm ? `1px solid ${t.colors.border}` : undefined,
      opacity: muted ? .4 : .65,
    }} />
  </div>;
}
