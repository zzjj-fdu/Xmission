import { useEffect, useRef, useState } from 'react';
import { remainingSecsNow } from '../api/pomodoro';
import { usePomodoroStore } from '../store/pomodoro';
import { PixelIcon } from '../components/PixelIcon';
import { activeTheme as pixelJrpg, fieldBg } from '../themes';

const t = pixelJrpg;

/** 秒 → mm:ss */
function fmt(secs: number): string {
  const mm = Math.floor(secs / 60);
  const ss = secs % 60;
  return `${String(mm).padStart(2, '0')}:${String(ss).padStart(2, '0')}`;
}

/** chip 右侧小按钮：暂停/继续、完成、放弃（字符 glyph，非 emoji） */
function ChipButton({
  label,
  title,
  onClick,
}: {
  label: string;
  title: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      title={title}
      onClick={onClick}
      style={{
        border: `1px solid ${t.colors.goldDark}`,
        background: t.colors.panelLight,
        color: t.colors.text,
        fontSize: 12,
        fontFamily: t.font.display,
        width: 20,
        height: 20,
        lineHeight: '18px',
        textAlign: 'center',
        padding: 0,
        cursor: 'pointer',
        flexShrink: 0,
      }}
    >
      {label}
    </button>
  );
}

/**
 * 番茄钟状态条：有活跃会话（running/paused）时显示在 LevelBadge 上方。
 * - 任务标题（无关联任务显示「自由专注」）+ mm:ss 倒计时（1s 定时器 + remainingSecsNow 推导）
 * - 暂停/继续 + 完成/放弃
 * - 倒计时归零自动 finish(true)，并停留显示「完成！」3 秒后消失
 * onPhaseChanged：出现/消失后通知外层重新量尺寸（悬浮窗自适应）。
 */
export function PomodoroChip({ onPhaseChanged }: { onPhaseChanged?: () => void }) {
  const session = usePomodoroStore((s) => s.session);
  const pause = usePomodoroStore((s) => s.pause);
  const resume = usePomodoroStore((s) => s.resume);
  const finish = usePomodoroStore((s) => s.finish);

  const [done, setDone] = useState(false);
  const [, setTick] = useState(0);
  // 冒号闪烁：0.8s 周期（400ms 亮 / 400ms 灭）；paused 时常亮不闪
  const [colonOn, setColonOn] = useState(true);
  const finishingRef = useRef(false);

  const sessionId = session?.id ?? null;
  const running = session?.state === 'running';
  const remaining = session ? remainingSecsNow(session) : 0;

  // 新会话到来时复位「完成！」停留态与自动完成守卫
  useEffect(() => {
    if (sessionId) {
      setDone(false);
      finishingRef.current = false;
    }
  }, [sessionId]);

  // 1s 定时器驱动倒计时重渲染（paused 时冻结，不需要 tick）
  useEffect(() => {
    if (!sessionId || !running) return;
    const id = window.setInterval(() => setTick((n) => n + 1), 1000);
    return () => window.clearInterval(id);
  }, [sessionId, running]);

  // 冒号 0.8s 周期闪烁：running 时 400ms 翻转一次 visibility；paused 时复位常亮
  useEffect(() => {
    if (!sessionId || !running) {
      setColonOn(true);
      return;
    }
    const id = window.setInterval(() => setColonOn((on) => !on), 400);
    return () => window.clearInterval(id);
  }, [sessionId, running]);

  // 归零自动完成：只触发一次，停留显示「完成！」
  useEffect(() => {
    if (!session || !running || done || finishingRef.current) return;
    if (remainingSecsNow(session) > 0) return;
    finishingRef.current = true;
    void finish(true).catch((err: unknown) => console.error('[widget] 番茄钟自动完成失败', err));
    setDone(true);
    // remaining 每次 tick 重算，作为依赖保证归零当拍就能触发
  }, [session, running, done, finish, remaining]);

  // 「完成！」3 秒后消失
  useEffect(() => {
    if (!done) return;
    const id = window.setTimeout(() => setDone(false), 3000);
    return () => window.clearTimeout(id);
  }, [done]);

  const visible = !!session || done;

  // chip 出现/消失会改变头部区高度，通知外层重新量尺寸
  useEffect(() => {
    onPhaseChanged?.();
  }, [visible, onPhaseChanged]);

  if (!visible) return null;

  // 完成停留态：finish 后 session 已清空，只显示「完成！」
  if (done && !session) {
    return (
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          padding: '4px 6px',
          marginBottom: 6,
          border: `2px solid ${t.colors.goldDark}`,
          background: fieldBg(t),
          borderRadius: t.radius ?? 0,
          boxSizing: 'border-box',
        }}
      >
        <PixelIcon name="check" size={16} color={t.colors.accentAlt} />
        <span style={{ color: t.colors.accentAlt, fontSize: 12, fontFamily: t.font.display }}>
          完成！
        </span>
      </div>
    );
  }

  if (!session) return null;

  const title = session.taskTitle ?? '自由专注';

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        padding: '4px 6px',
        marginBottom: 6,
        border: `2px solid ${t.colors.goldDark}`,
        background: fieldBg(t),
        borderRadius: t.radius ?? 0,
        boxSizing: 'border-box',
      }}
    >
      <PixelIcon name="hourglass" size={16} />
      <span
        title={title}
        style={{
          flex: 1,
          minWidth: 0,
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
          color: t.colors.text,
          fontSize: 12,
          fontFamily: t.font.body,
        }}
      >
        {title}
      </span>
      <span
        style={{
          color: running ? t.colors.accent : t.colors.textMuted,
          fontSize: 24,
          lineHeight: 1,
          fontFamily: t.font.display,
          letterSpacing: '0.1em',
          whiteSpace: 'nowrap',
        }}
        title={running ? '专注进行中' : '已暂停'}
      >
        {fmt(remaining).split(':')[0]}
        <span style={{ visibility: colonOn ? 'visible' : 'hidden' }}>:</span>
        {fmt(remaining).split(':')[1]}
      </span>
      <ChipButton
        label={running ? '⏸' : '▶'}
        title={running ? '暂停' : '继续'}
        onClick={() => {
          void (running ? pause() : resume()).catch((err: unknown) =>
            console.error('[widget] 番茄钟暂停/继续失败', err),
          );
        }}
      />
      <ChipButton
        label="✓"
        title="完成（结算 XP/金币）"
        onClick={() => {
          void finish(true).catch((err: unknown) => console.error('[widget] 番茄钟完成失败', err));
        }}
      />
      <ChipButton
        label="✕"
        title="放弃本次番茄钟"
        onClick={() => {
          void finish(false).catch((err: unknown) => console.error('[widget] 番茄钟放弃失败', err));
        }}
      />
    </div>
  );
}
