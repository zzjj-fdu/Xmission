import { useCallback, useEffect, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import { availableMonitors, currentMonitor, primaryMonitor, getCurrentWindow, Window } from '@tauri-apps/api/window';
import type { Window as TauriWindow } from '@tauri-apps/api/window';
import { LogicalSize, PhysicalPosition } from '@tauri-apps/api/dpi';
import { listen } from '@tauri-apps/api/event';
import { invoke } from '@tauri-apps/api/core';
import { useTasksStore } from '../store/tasks';
import { useProfileStore } from '../store/profile';
import { LevelBadge } from '../components/LevelBadge';
import { PixelIcon } from '../components/PixelIcon';
import { QuestLog } from './QuestLog';
import { PomodoroChip } from './PomodoroChip';
import { RewardFloats } from './RewardFloats';
import { Scanlines } from '../components/Scanlines';
import { activeTheme as pixelJrpg } from '../themes';
import { getSetting } from '../api/settings';

const t = pixelJrpg;
const panelStyle = t.panelStyle ?? 'pixel-step';
const widgetTitle = panelStyle === 'soft' ? '岛上的小目标'
  : panelStyle === 'wood-frame' ? '农场手记'
  : panelStyle === 'parchment' ? '冒险者日志'
  : 'QUEST LOG · 任务日志';
const widgetMotto = panelStyle === 'soft' ? '✿　慢慢来，今天也会有收获。'
  : panelStyle === 'wood-frame' ? '小小一步，也是一份收成。'
  : panelStyle === 'parchment' ? '每一页，都是旅程的一部分。'
  : '✦　每一步都算数。';

/** 悬浮窗主面板样式：与 QuestPanel 同套三分支（像素金框 / 动森纸感圆角 / 星露谷木框羊皮纸） */
const widgetPanelCss: CSSProperties =
  panelStyle === 'soft'
    ? {
        background: t.panelBg ?? t.colors.panel,
        border: `2px solid ${t.colors.border}`,
        borderRadius: t.radius ?? 12,
        boxShadow:
          'inset 0 2px 0 rgba(255, 255, 255, 0.65), inset 0 -3px 6px rgba(120, 100, 70, 0.10)',
      }
    : panelStyle === 'wood-frame'
      ? {
          background: t.panelBg ?? t.colors.panel,
          border: `3px solid ${t.colors.goldDark}`,
          boxShadow: `inset 0 0 0 2px ${t.colors.border}`,
        }
      : panelStyle === 'parchment'
        ? {
            background: t.panelBg ?? t.colors.panel,
            border: `2px solid ${t.colors.border}`,
            borderRadius: t.radius ?? 3,
            boxShadow: `inset 0 0 0 4px ${t.colors.panel}, inset 0 0 0 5px ${t.colors.goldDark}, 2px 4px 12px rgba(32,27,21,.35)`,
          }
      : {
          backgroundColor: t.colors.panel,
          border: `2px solid ${t.colors.accent}`,
          boxShadow: `inset 0 0 0 1px ${t.colors.goldDark}, inset 0 2px 6px rgba(0, 0, 0, 0.45)`,
        };

/** 纯浏览器 dev 下 getCurrentWindow() 会同步抛错，统一兜底并记录 */
function appWindow(): TauriWindow | null {
  try {
    return getCurrentWindow();
  } catch (err) {
    console.error('[widget] 获取当前窗口失败（非 Tauri 环境？）', err);
    return null;
  }
}

function runWindowOp(name: string, op: (win: TauriWindow) => Promise<void>): void {
  const win = appWindow();
  if (!win) return;
  void op(win).catch((err: unknown) => console.error(`[widget] ${name} 失败`, err));
}

function savedExpandedSize(): { width: number; height: number } {
  const maxWidth = Math.max(280, window.screen.availWidth - 40);
  const maxHeight = Math.max(160, window.screen.availHeight - 40);
  const fallback = { width: 520, height: Math.min(700, maxHeight) };
  try {
    const raw = localStorage.getItem('xmission-widget-size');
    if (!raw) return fallback;
    const parsed = JSON.parse(raw) as { width: number; height: number };
    if (!Number.isFinite(parsed.width) || !Number.isFinite(parsed.height)) return fallback;
    return { width: Math.min(maxWidth, Math.max(280, parsed.width)), height: Math.min(Math.max(160, parsed.height), maxHeight) };
  } catch { return fallback; }
}

/** 标题栏窗口控制按钮：onMouseDown 阻止冒泡，避免触发标题栏拖拽 */
function TitleButton({
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
      onMouseDown={(e) => e.stopPropagation()}
      onClick={onClick}
      style={{
        border: 'none',
        background: 'transparent',
        color: t.colors.textMuted,
        fontSize: 12,
        fontFamily: t.font.display,
        width: 20,
        height: 20,
        lineHeight: '20px',
        textAlign: 'center',
        padding: 0,
        marginLeft: 4,
        cursor: 'pointer',
        flexShrink: 0,
      }}
    >
      {label}
    </button>
  );
}

/**
 * 悬浮任务栏：一整个不透明 JRPG 面板（金色像素边框 + 四角角花），
 * 仅面板外圈 4px 边距透明（无边框窗口需要），不再有窗内透明区域——
 * 透明像素在 Windows WebView2 下会点击穿透且透出桌面图标，既不美观也拖不动。
 *
 * - 拖拽：标题栏为不透明拖拽区（data-tauri-drag-region 原生处理）
 * - 缩放：右下角 16×16 手柄 startResizeDragging('SouthEast')
 * - 唤回：监听主窗口广播的 widget:show 事件自行 show + 聚焦
 */
export default function WidgetApp() {
  // 置顶状态：默认跟随配置 alwaysOnTop:true，可点「置顶」按钮切换
  const [pinned, setPinned] = useState(true);
  const [opacity, setOpacity] = useState(100);
  const [edgeHide, setEdgeHide] = useState(false);
  const dockedEdge = useRef<'left' | 'right' | null>(null);
  const hiddenAtEdge = useRef(false);
  const tasks = useTasksStore((s) => s.tasks);
  const wallet = useProfileStore((s) => s.wallet);
  const listRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const headerRef = useRef<HTMLDivElement>(null);
  const sizeReady = useRef(false);
  const manuallySized = useRef(false);

  useEffect(() => {
    const win = appWindow();
    if (!win) return;
    let unlisten: (() => void) | undefined;
    let cancelled = false;
    const saved = localStorage.getItem('xmission-widget-size');
    const restore = async () => {
      if (saved) {
        try {
          const { width, height } = savedExpandedSize();
          await win.setSize(new LogicalSize(width, height));
          manuallySized.current = true;
        } catch (error) { console.error('[widget] 恢复窗口尺寸失败', error); }
      }
      await win.setMinSize(new LogicalSize(280, 160));
      if (cancelled) return;
      unlisten = await win.onResized(async (size) => {
        if (!manuallySized.current) return;
        const scale = await win.scaleFactor();
        const logical = size.payload.toLogical(scale);
        if (logical.width < 280 || logical.height < 160) return;
        localStorage.setItem('xmission-widget-size', JSON.stringify({ width: Math.round(logical.width), height: Math.round(logical.height) }));
      });
      sizeReady.current = true;
      if (!manuallySized.current) requestAnimationFrame(measureAndResize);
    };
    void restore().catch((error: unknown) => console.error('[widget] 监听窗口尺寸失败', error));
    return () => { cancelled = true; unlisten?.(); };
  }, []);

  useEffect(() => {
    const apply = (key: string, value: string) => {
      if (key === 'widget_opacity') setOpacity(Math.min(100, Math.max(40, Number(value) || 100)));
      if (key === 'widget_edge_hide') setEdgeHide(value === 'true');
    };
    void Promise.all([getSetting('widget_opacity'), getSetting('widget_edge_hide')])
      .then(([alpha, hide]) => {
        if (alpha != null) apply('widget_opacity', alpha);
        if (hide != null) apply('widget_edge_hide', hide);
      })
      .catch((err: unknown) => console.error('[widget] 读取外观设置失败', err));
    let unlisten: (() => void) | undefined;
    void listen<{ key: string; value: string }>('settings-changed', ({ payload }) => {
      if (payload.key === 'theme') {
        localStorage.setItem('xmission-theme', payload.value);
        window.location.reload();
        return;
      }
      apply(payload.key, payload.value);
    }).then((fn) => { unlisten = fn; })
      .catch((err: unknown) => console.error('[widget] 订阅外观设置失败', err));
    return () => unlisten?.();
  }, []);

  const dockAtEdge = async () => {
    if (!edgeHide || hiddenAtEdge.current) return;
    const win = appWindow();
    if (!win) return;
    const [position, size, monitor, scale] = await Promise.all([
      win.outerPosition(), win.outerSize(), currentMonitor(), win.scaleFactor(),
    ]);
    if (!monitor) return;
    const left = monitor.position.x;
    const right = left + monitor.size.width;
    const edge = Math.round(24 * scale);
    if (Math.abs(position.x - left) <= edge) {
      dockedEdge.current = 'left';
      hiddenAtEdge.current = true;
      await win.setPosition(new PhysicalPosition(left - size.width + Math.round(12 * scale), position.y));
    } else if (Math.abs(position.x + size.width - right) <= edge) {
      dockedEdge.current = 'right';
      hiddenAtEdge.current = true;
      await win.setPosition(new PhysicalPosition(right - Math.round(12 * scale), position.y));
    } else {
      dockedEdge.current = null;
    }
  };

  const revealFromEdge = async () => {
    if (!hiddenAtEdge.current || !dockedEdge.current) return;
    const win = appWindow();
    if (!win) return;
    const [position, size, monitor] = await Promise.all([
      win.outerPosition(), win.outerSize(), currentMonitor(),
    ]);
    if (!monitor) return;
    const left = monitor.position.x;
    const right = left + monitor.size.width;
    await win.setPosition(new PhysicalPosition(
      dockedEdge.current === 'left' ? left : right - size.width, position.y,
    ));
    hiddenAtEdge.current = false;
  };

  useEffect(() => {
    if (!edgeHide && hiddenAtEdge.current) {
      void revealFromEdge().catch((err: unknown) => console.error('[widget] 关闭贴边隐藏后展开失败', err));
    }
  }, [edgeHide]);

  /**
   * 自适应窗口尺寸：任务少则小巧、任务多则长高（封顶后内部滚动）。
   * 宽度是当前渲染内容的纯函数：用离屏 canvas 量每个任务标题的文字宽度
   * （不读 DOM scrollWidth——flex 拉伸后的 scrollWidth = max(clientWidth, 内容宽)，
   * 会把历史最大窗口宽固化进测量值，导致只增不减），展开/收起走同一条重算路径。
   */
  const measureAndResize = useCallback(() => {
    if (!sizeReady.current || manuallySized.current) return;
    const list = listRef.current;
    const content = contentRef.current;
    const win = appWindow();
    if (!list || !content || !win) return;
    // 取行内标题的真实排版字体（像素字体加载后 measureText 才准）
    const probe = list.querySelector('.quest-title');
    const cs = probe ? window.getComputedStyle(probe) : null;
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    let maxTitle = 0;
    if (ctx) {
      ctx.font = cs ? `${cs.fontSize} ${cs.fontFamily}` : '12px monospace';
      list.querySelectorAll('.quest-title').forEach((el) => {
        maxTitle = Math.max(maxTitle, ctx.measureText(el.textContent ?? '').width);
      });
    }
    // 图标、主题牌面和勾选框放大后，为标题留足真实空间。
    const width = Math.round(Math.min(530, Math.max(340, maxTitle + 245)));
    // 头部区（番茄钟 chip + 等级条 + 钱包条）实测高度：chip/钱包条出现或消失时高度会变化
    const headerH = headerRef.current?.scrollHeight ?? 0;
    // 标题栏、页脚、清单留白与边框。
    const contentH = content.scrollHeight;
    const maxH = Math.floor(window.screen.availHeight * 0.8);
    const height = Math.round(Math.min(maxH, Math.max(230, contentH + headerH + 128)));
    void win
      .setSize(new LogicalSize(width, height))
      .catch((err: unknown) => console.error('[widget] 自适应尺寸失败', err));
  }, []);

  const scheduleMeasure = useCallback(() => {
    requestAnimationFrame(measureAndResize);
  }, [measureAndResize]);

  // 任务增删改（含详情展开引起的内容变化由 onContentChanged 触发）后重新量尺寸
  useEffect(() => {
    scheduleMeasure();
  }, [tasks, scheduleMeasure]);

  // 钱包加载/变动会改变头部区高度（钱包条出现、数值变长），重新量尺寸
  useEffect(() => {
    scheduleMeasure();
  }, [wallet, scheduleMeasure]);

  useEffect(() => {
    let disposed = false;
    let unlisten: (() => void) | undefined;
    listen('widget:show', () => {
      void expandWidget();
    })
      .then((fn) => {
        if (disposed) fn();
        else unlisten = fn;
      })
      .catch((err: unknown) => console.error('[widget] 订阅 widget:show 事件失败', err));
    return () => {
      disposed = true;
      unlisten?.();
    };
  }, []);

  const collapseWidget = async () => {
    const win = appWindow();
    if (!win) return;
    if (hiddenAtEdge.current) await revealFromEdge();
    const bubble = await Window.getByLabel('bubble');
    if (!bubble) throw new Error('找不到任务球窗口');
    await invoke('prepare_bubble_window');
    const [position, size, bubbleSize, current, monitors] = await Promise.all([
      win.outerPosition(), win.outerSize(), bubble.outerSize(), currentMonitor(), availableMonitors(),
    ]);
    localStorage.setItem('xmission-widget-position', JSON.stringify({ x: position.x, y: position.y }));
    const savedBubble = localStorage.getItem('xmission-bubble-position');
    let candidate = { x: position.x + size.width - bubbleSize.width, y: position.y + size.height - bubbleSize.height };
    if (savedBubble) {
      try { const parsed = JSON.parse(savedBubble) as { x: number; y: number }; if (Number.isFinite(parsed.x) && Number.isFinite(parsed.y)) candidate = parsed; }
      catch { /* old position cannot be restored */ }
    }
    const half = Math.floor(bubbleSize.width / 2);
    const monitor = monitors.find((item) =>
      candidate.x + half >= item.position.x && candidate.x + half <= item.position.x + item.size.width &&
      candidate.y + bubbleSize.height / 2 >= item.position.y && candidate.y + bubbleSize.height / 2 <= item.position.y + item.size.height,
    ) ?? current ?? await primaryMonitor();
    if (monitor) {
      candidate.x = Math.min(monitor.position.x + monitor.size.width - half, Math.max(monitor.position.x - half, candidate.x));
      candidate.y = Math.min(monitor.position.y + monitor.size.height - bubbleSize.height, Math.max(monitor.position.y, candidate.y));
    }
    await bubble.setPosition(new PhysicalPosition(
      candidate.x,
      candidate.y,
    ));
    await bubble.show();
    await win.hide();
  };

  const expandWidget = async () => {
    const win = appWindow();
    if (!win) return;
    const bubble = await Window.getByLabel('bubble');
    const position = localStorage.getItem('xmission-widget-position');
    if (position) {
      try { const parsed = JSON.parse(position) as { x: number; y: number }; await win.setPosition(new PhysicalPosition(parsed.x, parsed.y)); }
      catch (error) { console.error('[widget] 恢复窗口位置失败', error); }
    }
    await win.show();
    if (bubble) await bubble.hide();
    await win.setFocus();
  };

  useEffect(() => {
    const win = appWindow();
    if (!win) return;
    let unlisten: (() => void) | undefined;
    void win.onCloseRequested((event) => {
      event.preventDefault();
      void collapseWidget().catch((error) => console.error('[widget] 收起失败', error));
    }).then((fn) => { unlisten = fn; }).catch((error) => console.error('[widget] 关闭拦截失败', error));
    return () => unlisten?.();
  }, []);

  const togglePin = () => {
    runWindowOp('setAlwaysOnTop', async (win) => {
      await win.setAlwaysOnTop(!pinned);
      setPinned(!pinned);
    });
  };

  return (
    <div
      onMouseEnter={() => { void revealFromEdge().catch((err) => console.error('[widget] 贴边展开失败', err)); }}
      onMouseLeave={() => { void dockAtEdge().catch((err) => console.error('[widget] 贴边隐藏失败', err)); }}
      style={{
        width: '100%',
        height: '100vh',
        padding: 4, // 给角花和外框留出透明边距
        background: 'transparent',
        boxSizing: 'border-box',
        overflow: 'hidden',
        fontFamily: t.font.body,
        color: t.colors.text,
        userSelect: 'none',
      }}
    >
      {/* 单实体面板：样式按皮肤分支（像素金框 / 动森纸感 / 星露谷木框羊皮纸） */}
      <div
        className="xm-widget-frame"
        style={{
          position: 'relative',
          width: '100%',
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          boxSizing: 'border-box',
          overflow: 'hidden',
          opacity: opacity / 100,
          ...widgetPanelCss,
        }}
      >
        {/* 标题栏：不透明拖拽区（data-tauri-drag-region 由 Tauri 原生处理拖动） */}
        <div
          className="xm-widget-titlebar"
          data-tauri-drag-region=""
          style={{
            height: 56,
            flexShrink: 0,
            display: 'flex',
            alignItems: 'center',
            padding: '0 14px',
            cursor: 'move',
            background: panelStyle === 'wood-frame' ? t.appBg : t.colors.panelLight,
            borderBottom: `2px solid ${t.colors.goldDark}`,
            color: panelStyle === 'wood-frame' ? t.colors.highlight : t.colors.accent,
            fontSize: 18,
            fontFamily: t.font.display,
          }}
        >
          <span aria-hidden="true" style={{ pointerEvents: 'none', marginRight: 8 }}><PixelIcon name="star" size={30} /></span>
          <span
            data-tauri-drag-region=""
            style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
          >
            {widgetTitle}
          </span>
          {/* 置顶开关：点亮=总是浮在最上层；点灭=普通窗口层级，可被别的窗口盖住 */}
          <button
            type="button"
            title={pinned ? '取消置顶（允许被其他窗口覆盖）' : '置顶（浮在所有窗口之上）'}
            onMouseDown={(e) => e.stopPropagation()}
            onClick={togglePin}
            style={{
              border: 'none',
              background: 'transparent',
              color: pinned ? t.colors.accent : t.colors.textMuted,
              fontSize: 12,
              fontFamily: t.font.display,
              letterSpacing: '0.1em',
              height: 20,
              lineHeight: '20px',
              padding: '0 2px',
              marginLeft: 4,
              cursor: 'pointer',
              flexShrink: 0,
            }}
          >
            置顶
          </button>
          <TitleButton
            label="✕"
            title="收起成小悬浮球"
            onClick={() => { void collapseWidget().catch((error) => console.error('[widget] 收起失败', error)); }}
          />
        </div>

        {/* 头部区：番茄钟 chip（有活跃会话时，位于等级条上方）+ 真实等级/XP 条 + 钱包条。
            高度由 headerRef 实测计入自适应量高 */}
        <div ref={headerRef} className="xm-widget-header" style={{ padding: '8px 10px 6px', flexShrink: 0 }}>
          <PomodoroChip onPhaseChanged={scheduleMeasure} />
          <div className="xm-widget-xp"><LevelBadge
            level={wallet?.level ?? 1}
            xp={wallet?.xpIntoLevel ?? 0}
            xpMax={wallet?.xpToNext ?? 100}
          /></div>
          {/* 钱包条：金币 + 连击天数（钱包未加载时不渲染） */}
          {wallet && (
            <div className="xm-widget-wallet"
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 14,
                marginTop: 6,
                fontFamily: t.font.display,
                fontSize: 12,
                color: t.colors.textMuted,
              }}
            >
              <span
                title="金币"
                style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}
              >
                <PixelIcon name="coin" size={22} />
                <span
                  style={{
                    color: t.colors.accent,
                    fontWeight: 700,
                    fontSize: 12,
                    letterSpacing: '0.1em',
                  }}
                >
                  {wallet.coins}
                </span>
              </span>
              <span
                title="连续打卡天数"
                style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}
              >
                <PixelIcon name="zap" size={22} />
                <span
                  style={{
                    color: t.colors.accent,
                    fontWeight: 700,
                    fontSize: 12,
                    letterSpacing: '0.1em',
                  }}
                >
                  {wallet.streak}
                </span>
                <span>天</span>
              </span>
            </div>
          )}
        </div>

        {/* XP/金币结算飘落动效层（绝对定位，不影响布局） */}
        <RewardFloats />

        {/* 任务清单：占满剩余高度，垂直滚动（皮肤化），禁止横向溢出。
            内层 height:auto 的内容 div 用于自适应量高（外层滚动容器窗高时 scrollHeight 会虚胖） */}
        <div
          ref={listRef}
          className="xm-widget-list"
          style={{
            flex: 1,
            minHeight: 0,
            overflowY: 'auto',
            overflowX: 'hidden',
            padding: '0 10px 20px',
          }}
        >
          <div ref={contentRef}>
            <QuestLog onContentChanged={scheduleMeasure} />
          </div>
        </div>

        <div className="xm-widget-footer" style={{
          minHeight: 40, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center',
          gap: 7, padding: '6px 10px',
          background: panelStyle === 'wood-frame' ? t.appBg : t.colors.panelLight,
          borderTop: `2px solid ${t.colors.goldDark}`,
          color: panelStyle === 'wood-frame' ? t.colors.highlight : t.colors.textMuted,
          fontFamily: t.font.display, fontSize: 12, textAlign: 'center',
        }}><PixelIcon name="star" size={22} />{widgetMotto}<PixelIcon name="star" size={22} /></div>

        {/* CRT 扫描线材质：仅像素皮肤保留。铺在面板边框内侧（inset 2px 不盖边框），
            透明度降到 0.08 保证文字可读；pointerEvents:none + 低 zIndex，
            不影响拖拽/点击，也不遮结算飘字与缩放手柄 */}
        {panelStyle === 'pixel-step' && (
          <div
            aria-hidden="true"
            style={{
              position: 'absolute',
              top: 2,
              right: 2,
              bottom: 2,
              left: 2,
              overflow: 'hidden',
              pointerEvents: 'none',
              zIndex: 5,
            }}
          >
            <Scanlines opacity={0.08} />
          </div>
        )}

        {/* 右下角 16×16 缩放手柄：无边框窗口没有原生缩放边框，需手动触发 */}
        <div
          title="拖拽调整大小"
          onMouseDown={(e) => {
            if (e.button !== 0) return;
            e.stopPropagation();
            manuallySized.current = true;
            runWindowOp('startResizeDragging', (win) => win.startResizeDragging('SouthEast'));
          }}
          style={{
            position: 'absolute',
            right: 0,
            bottom: 0,
            width: 16,
            height: 16,
            cursor: 'nwse-resize',
            zIndex: 10,
            background: `linear-gradient(135deg, transparent 50%, ${t.colors.accent} 50%)`,
            opacity: 0.8,
          }}
        />
      </div>
    </div>
  );
}
