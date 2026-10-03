import { useEffect, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import { useProfileStore } from '../store/profile';
import { activeTheme as pixelJrpg } from '../themes';

const t = pixelJrpg;

interface FloatItem {
  id: number;
  text: string;
}

/** 动效时长 1.2s，之后多留 100ms 余量再移除 DOM */
const FLOAT_MS = 1300;

/**
 * XP/金币结算正反馈：订阅 useProfileStore 的 wallet 变化（模块级已监听
 * wallet-updated 事件），xpTotal 增加时面板顶部飘落 `+N XP` 金色文字，
 * coins 增加同理 `+N G`；framer-motion 1.2s 上浮淡出。
 * 绝对定位浮层，不影响布局与自适应量高。
 */
export function RewardFloats() {
  const [floats, setFloats] = useState<FloatItem[]>([]);
  const idRef = useRef(0);
  const prevRef = useRef<{ xpTotal: number; coins: number } | null>(null);
  const timers = useRef(new Set<number>());

  useEffect(() => {
    // 以当前钱包为基准，首次加载不飘字
    const initial = useProfileStore.getState().wallet;
    prevRef.current = initial ? { xpTotal: initial.xpTotal, coins: initial.coins } : null;

    const unsubscribe = useProfileStore.subscribe((state) => {
      const wallet = state.wallet;
      const prev = prevRef.current;
      prevRef.current = wallet ? { xpTotal: wallet.xpTotal, coins: wallet.coins } : null;
      if (!wallet || !prev) return;

      const items: FloatItem[] = [];
      const dxp = wallet.xpTotal - prev.xpTotal;
      const dcoins = wallet.coins - prev.coins;
      if (dxp > 0) items.push({ id: ++idRef.current, text: `+${dxp} XP` });
      if (dcoins > 0) items.push({ id: ++idRef.current, text: `+${dcoins} G` });
      if (items.length === 0) return;

      setFloats((cur) => [...cur, ...items]);
      const timer = window.setTimeout(() => {
        timers.current.delete(timer);
        setFloats((cur) => cur.filter((f) => !items.some((it) => it.id === f.id)));
      }, FLOAT_MS);
      timers.current.add(timer);
    });
    return () => { unsubscribe(); timers.current.forEach(window.clearTimeout); timers.current.clear(); };
  }, []);

  if (floats.length === 0) return null;

  return (
    <div
      aria-hidden="true"
      style={{
        position: 'absolute',
        top: 34, // 标题栏 30px 之下、面板顶部
        left: 0,
        right: 0,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: 2,
        pointerEvents: 'none',
        zIndex: 30,
      }}
    >
      {floats.map((f) => (
        <motion.span
          key={f.id}
          initial={{ opacity: 1, y: 0 }}
          animate={{ opacity: 0, y: -32 }}
          transition={{ duration: 1.2, ease: 'easeOut' }}
          style={{
            color: t.colors.accent,
            fontSize: 12,
            fontFamily: t.font.display,
            whiteSpace: 'nowrap',
            textShadow: '0 1px 0 rgba(0, 0, 0, 0.6)',
          }}
        >
          {f.text}
        </motion.span>
      ))}
    </div>
  );
}
