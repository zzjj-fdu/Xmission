import { useEffect, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { activeTheme as pixelJrpg } from '../themes';
import { PixelIcon } from './PixelIcon';

const t = pixelJrpg;

export interface QuestCheckboxProps {
  checked: boolean;
  onToggle: () => void;
}

/**
 * 24px 像素方框 checkbox：金色 2px 边框 + 内圈深金层次，
 * checked 时金色填充 + 深色像素对勾（PixelIcon），保留勾选瞬间金色流光扫过（0.4s）
 */
export function QuestCheckbox({ checked, onToggle }: QuestCheckboxProps) {
  const [flash, setFlash] = useState(false);

  useEffect(() => {
    if (!checked) return;
    setFlash(true);
    const timer = window.setTimeout(() => setFlash(false), 450);
    return () => window.clearTimeout(timer);
  }, [checked]);

  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={checked}
      onClick={onToggle}
      style={{
        width: 28,
        height: 28,
        flexShrink: 0,
        padding: 0,
        cursor: 'pointer',
        position: 'relative',
        overflow: 'hidden',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        border: `2px solid ${t.colors.accent}`,
        boxShadow: `inset 0 0 0 1px ${t.colors.goldDark}`,
        backgroundColor: checked ? t.colors.accent : t.colors.xpTrack,
        // 动森皮肤圆角化
        borderRadius: t.radius ? 6 : 0,
      }}
    >
      {checked && <PixelIcon name="check" size={20} color={t.colors.panel} />}
      <AnimatePresence>
        {flash && (
          <motion.div
            initial={{ x: '-100%' }}
            animate={{ x: '180%' }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.4, ease: 'linear' }}
            style={{
              position: 'absolute',
              top: 0,
              bottom: 0,
              left: 0,
              width: '60%',
              pointerEvents: 'none',
              background: `linear-gradient(90deg, ${t.colors.accent}00, ${t.colors.text}, ${t.colors.accent}00)`,
            }}
          />
        )}
      </AnimatePresence>
    </button>
  );
}
