import type { CSSProperties, ReactNode } from 'react';
import { activeTheme } from '../themes';
import { Scanlines } from './Scanlines';

const t = activeTheme;
const style = t.panelStyle ?? 'pixel-step';

export interface QuestPanelProps {
  children: ReactNode;
  className?: string;
}

/** 四套面板只共享布局，材质和收边各自设计。 */
export function QuestPanel({ children, className }: QuestPanelProps) {
  const surfaces: Record<string, CSSProperties> = {
    'pixel-step': {
      background: t.colors.panel,
      border: `2px solid ${t.colors.accent}`,
      boxShadow: `inset 0 0 0 2px ${t.colors.goldDark}, inset 0 4px 0 rgba(255,255,255,.05), 3px 4px 0 rgba(0,0,0,.28)`,
    },
    parchment: {
      background: t.panelBg ?? t.colors.panel,
      border: `1px solid ${t.colors.border}`,
      borderRadius: 3,
      boxShadow: `inset 0 0 0 4px ${t.colors.panel}, inset 0 0 0 5px ${t.colors.goldDark}, 2px 4px 12px rgba(37,30,19,.22)`,
    },
    soft: {
      background: t.panelBg ?? t.colors.panel,
      border: `2px solid ${t.colors.border}`,
      borderRadius: t.radius ?? 12,
      boxShadow: 'inset 0 3px 0 rgba(255,255,255,.85), 0 5px 13px rgba(102,96,67,.13)',
    },
    'wood-frame': {
      background: t.panelBg ?? t.colors.panel,
      border: `3px solid ${t.colors.goldDark}`,
      boxShadow: `inset 0 0 0 2px ${t.colors.border}, 3px 4px 0 rgba(32,20,11,.34)`,
    },
  };
  return <div className={className} data-texture={style} style={{
    position: 'relative', margin: 8, padding: 14, boxSizing: 'border-box',
    color: t.colors.text, fontFamily: t.font.body,
    ...surfaces[style],
  }}>
    {children}
    {style === 'pixel-step' && <Scanlines />}
    {style === 'pixel-step' && <>
      <span aria-hidden="true" style={{ position: 'absolute', top: -4, left: -4, width: 9, height: 9, border: `2px solid ${t.colors.accent}`, background: t.colors.goldDark }} />
      <span aria-hidden="true" style={{ position: 'absolute', top: -4, right: -4, width: 9, height: 9, border: `2px solid ${t.colors.accent}`, background: t.colors.goldDark }} />
      <span aria-hidden="true" style={{ position: 'absolute', bottom: -4, left: -4, width: 9, height: 9, border: `2px solid ${t.colors.accent}`, background: t.colors.goldDark }} />
      <span aria-hidden="true" style={{ position: 'absolute', bottom: -4, right: -4, width: 9, height: 9, border: `2px solid ${t.colors.accent}`, background: t.colors.goldDark }} />
    </>}
  </div>;
}
