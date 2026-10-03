import { useEffect, useMemo, useState } from 'react';
import { listen } from '@tauri-apps/api/event';
import type { ReactNode } from 'react';
import { useTasksStore } from '../store/tasks';
import { usePomodoroStore } from '../store/pomodoro';
import { QuestCheckbox } from '../components/QuestCheckbox';
import { PixelIcon, taskIcon } from '../components/PixelIcon';
import { activeTheme as pixelJrpg, currentThemeKey, themeMarker } from '../themes';
import { SectionHeader } from '../components/SectionHeader';
import { FormBadge, formLabel } from '../components/FormBadge';
import { getRankedToday } from '../api/scheduler';
import type { RankedTask } from '../api/scheduler';
import { listSteps, completeStep, reopenStep, onStepsChanged } from '../api/steps';
import type { Step } from '../api/steps';
import type { Task } from '../api/tasks';
import { isRecurring, recurringDueToday } from '../api/tasks';
import { getLlmConfig, summarizeTaskForWidget } from '../api/llm';
import { getSetting } from '../api/settings';
import { safeNotesHtml } from '../utils/safeNotes';

const t = pixelJrpg;
const summaryCache = new Map<string, string>();
const summaryFailures = new Set<string>();

/** 重要度徽记数量：≥4 → 3 枚，=3 → 2 枚，≤2 → 1 枚 */
function badgeCount(importance: number): number {
  if (importance >= 4) return 3;
  if (importance === 3) return 2;
  return 1;
}

/** 已逾期：有 deadline 且早于当前时刻、且未完成（与规则引擎 score_task 的逾期判定一致） */
function isOverdue(task: Task): boolean {
  if (!task.deadline || task.status === 'done') return false;
  const ts = new Date(task.deadline).getTime();
  return Number.isFinite(ts) && ts < Date.now();
}


/** 截止时间格式化：YYYY-MM-DD，带非零时分时追加 HH:mm；解析失败返回 null */
function fmtDeadline(iso: string): string | null {
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return null;
  const p = (n: number) => String(n).padStart(2, '0');
  const date = `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
  const hasTime = d.getHours() !== 0 || d.getMinutes() !== 0;
  return hasTime ? `${date} ${p(d.getHours())}:${p(d.getMinutes())}` : date;
}

/** 预估耗时格式化：<60 → N 分钟；否则 X 小时[Y 分] */
function fmtMinutes(min: number): string {
  if (min < 60) return `${min} 分钟`;
  const h = Math.floor(min / 60);
  const m = min % 60;
  return m === 0 ? `${h} 小时` : `${h} 小时 ${m} 分`;
}

/** 步骤是否完成（与 MainQuestProgress 原判定一致） */
function stepDone(s: Step): boolean {
  return s.status === 'done' || s.completedAt !== null;
}

/** 重要度徽记：像素星（替代 ◆ 字符） */
function ImportanceBadges({ importance }: { importance: number }) {
  return (
    <span
      style={{ display: 'inline-flex', gap: 2, alignItems: 'center', whiteSpace: 'nowrap' }}
      title={`重要度 ${importance}`}
    >
      {Array.from({ length: badgeCount(importance) }, (_, i) => (
        <PixelIcon key={i} name="star" size={16} />
      ))}
    </span>
  );
}

/** 行右侧展开/收起小箭头：所有进行中任务行都有（详情含元信息行，无备注也可展开） */
function ExpandArrow({ expanded, onClick }: { expanded: boolean; onClick: () => void }) {
  return (
    <button
      className="xm-widget-expand"
      type="button"
      title={expanded ? '收起详情' : '展开任务详情（只读）'}
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
      style={{
        border: 'none',
        background: 'transparent',
        color: expanded ? t.colors.accent : t.colors.textMuted,
        fontSize: 12,
        fontFamily: t.font.display,
        width: 16,
        height: 16,
        lineHeight: '16px',
        textAlign: 'center',
        padding: 0,
        cursor: 'pointer',
        flexShrink: 0,
      }}
    >
      {expanded ? '▴' : '▾'}
    </button>
  );
}

/** 主线/支线进度条分段数（复用 LevelBadge 的分段思路，10 段 chunky 像素块） */
const PROGRESS_SEGMENTS = 10;

/**
 * 拉取并订阅某个任务的步骤列表（主线/支线行始终开启：行内 x/y 计数与迷你进度条都要用）。
 * 初次挂载拉一次，steps-changed 事件与任务列表变化都会触发刷新。
 * steps 变化时回调 onLoaded（进度条/步骤清单出现或高度变化，外层重新量尺寸）。
 */
function useTaskSteps(taskId: string, onLoaded?: () => void): Step[] | null {
  const tasks = useTasksStore((s) => s.tasks);
  const [steps, setSteps] = useState<Step[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    let unlisten: (() => void) | undefined;
    const load = () => {
      listSteps(taskId)
        .then((list) => {
          if (!cancelled) setSteps(list);
        })
        .catch((err: unknown) => console.error('[widget] 拉取任务步骤失败', err));
    };
    load();
    onStepsChanged(load)
      .then((fn) => {
        if (cancelled) fn();
        else unlisten = fn;
      })
      .catch((err: unknown) => console.error('[widget] 订阅 steps-changed 事件失败', err));
    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, [taskId, tasks]);

  useEffect(() => {
    if (steps) onLoaded?.();
  }, [steps, onLoaded]);

  return steps;
}

/** 主线/支线迷你进度条：完成步骤数/总步骤数，高 6px；无步骤时不渲染 */
function StepProgressBar({ steps }: { steps: Step[] }) {
  if (steps.length === 0) return null;
  const doneCount = steps.filter(stepDone).length;
  const filled = Math.round((doneCount / steps.length) * PROGRESS_SEGMENTS);

  return (
    <div style={{ padding: '0 4px 4px 56px' }} title={`步骤进度 ${doneCount}/${steps.length}`}>
      <div
        role="progressbar"
        aria-valuenow={doneCount}
        aria-valuemin={0}
        aria-valuemax={steps.length}
        style={{ display: 'flex', gap: 1, height: 6 }}
      >
        {Array.from({ length: PROGRESS_SEGMENTS }, (_, i) => (
          <div
            key={i}
            style={{
              flex: 1,
              backgroundColor: i < filled ? t.colors.accentAlt : t.colors.panelLight,
              // 与 LevelBadge 一致的像素块明暗分界：顶部高光、底部阴影
              boxShadow:
                i < filled
                  ? 'inset 0 1px 0 rgba(255, 255, 255, 0.28), inset 0 -1px 0 rgba(0, 0, 0, 0.3)'
                  : 'inset 0 1px 0 rgba(255, 255, 255, 0.06)',
              transition: 'background-color 0.2s ease-out',
            }}
          />
        ))}
      </div>
    </div>
  );
}

/**
 * 展开的步骤清单：QuestCheckbox 勾选 completeStep/reopenStep，按 orderIndex 排序，
 * 整体缩进 20px；勾选后 XP 飘字由 wallet-updated 链路自动触发。
 */
function StepChecklist({ steps }: { steps: Step[] }) {
  const sorted = [...steps].sort((a, b) => a.orderIndex - b.orderIndex);

  const toggle = (s: Step) => {
    void (stepDone(s) ? reopenStep(s.id) : completeStep(s.id)).catch((err: unknown) =>
      console.error('[widget] 步骤勾选/取消失败', err),
    );
  };

  return (
    <div style={{ marginLeft: 20, padding: '2px 4px 4px 0' }}>
      {sorted.map((s) => {
        const done = stepDone(s);
        return (
          <div
            key={s.id}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              padding: '3px 0',
              minHeight: 28,
              boxSizing: 'border-box',
            }}
          >
            <QuestCheckbox checked={done} onToggle={() => toggle(s)} />
            <span
              title={s.title}
              style={{
                flex: 1,
                minWidth: 0,
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
                fontSize: 12,
                fontFamily: t.font.body,
                color: done ? t.colors.textMuted : t.colors.text,
                textDecoration: done ? 'line-through' : 'none',
                opacity: done ? 0.7 : 1,
              }}
            >
              {s.title}
            </span>
          </div>
        );
      })}
    </div>
  );
}

function OpenRow({
  task,
  summary,
  expanded,
  onToggleExpand,
  onContentChanged,
}: {
  task: Task;
  summary?: string;
  expanded: boolean;
  onToggleExpand: () => void;
  onContentChanged?: () => void;
}) {
  const complete = useTasksStore((s) => s.complete);
  const reopen = useTasksStore((s) => s.reopen);
  const startPomodoro = usePomodoroStore((s) => s.start);
  const [hover, setHover] = useState(false);
  const hasNotes = !!(task.notes && task.notes.trim());
  const notesHtml = useMemo(() => expanded ? safeNotesHtml(task.notes) : '', [expanded, task.notes]);
  const overdue = isOverdue(task);
  const hasSteps = task.form === 'main_quest' || task.form === 'side_quest';
  // 循环任务：完成 = 今日已打卡（任务永不进入永久 done）
  const recurring = isRecurring(task);
  const doneToday = recurring && task.doneToday;

  // 主线/支线：行内 x/y 计数、迷你进度条、展开步骤清单共用这份步骤数据
  const steps = useTaskSteps(task.id, onContentChanged);
  // Hook 必须无条件调用；非主线/支线任务忽略即可
  const questSteps = hasSteps ? steps : null;
  const doneCount = questSteps ? questSteps.filter(stepDone).length : 0;

  // 详情元信息行：形态必有，截止/预估/紧迫度有什么显示什么
  const metaParts: string[] = [formLabel(task.form)];
  if (recurring) {
    metaParts.push(task.recurrence === 'daily' ? '每天重复' : '每周重复');
  }
  if (task.deadline) {
    const dl = fmtDeadline(task.deadline);
    if (dl) metaParts.push(`截止 ${dl}`);
  }
  if (task.estimatedMin != null) metaParts.push(`预估 ${fmtMinutes(task.estimatedMin)}`);
  metaParts.push(`紧迫度 ${task.urgency}`);

  return (
    <div>
      <div
        className="xm-widget-row"
        onMouseEnter={() => setHover(true)}
        onMouseLeave={() => setHover(false)}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          padding: '6px 4px',
          minHeight: 32,
          boxSizing: 'border-box',
          backgroundColor: hover ? t.colors.panelLight : 'transparent',
          transition: 'background-color 0.12s ease-out',
        }}
      >
        {/* 逾期红条：行左缘 2px danger 竖条（负 margin 顶到行缘，不占排版宽度） */}
        {overdue && (
          <div
            className="xm-widget-overdue"
            style={{
              width: 2,
              alignSelf: 'stretch',
              marginLeft: -4,
              marginRight: -2,
              backgroundColor: t.colors.danger,
              flexShrink: 0,
            }}
          />
        )}
        {/* JRPG 选中光标：hover 时行最左浮出金色 ▶；14px 固定占位避免整行抖动 */}
        <span
          className="xm-widget-cursor"
          aria-hidden="true"
          style={{
            width: 14,
            flexShrink: 0,
            textAlign: 'center',
            color: hover ? t.colors.accent : 'transparent',
            fontSize: 12,
            fontFamily: t.font.display,
            transition: 'color 0.12s ease-out',
          }}
        >
          {themeMarker()}
        </span>
        {/* 语义分类图标（M4）：无分类用默认卷轴；形态改由彩色文字徽章标识 */}
        <PixelIcon name={taskIcon(task.icon)} size={28} className="xm-widget-category" />
        <span className="xm-widget-form"><FormBadge form={task.form} compact /></span>
        <span className="xm-widget-check"><QuestCheckbox
          checked={doneToday}
          onToggle={() =>
            void (doneToday ? reopen(task.id) : complete(task.id)).catch((err: unknown) =>
              console.error('[widget] 任务打卡/撤销失败', err),
            )
          }
        /></span>
        <span
          className="quest-title"
          style={{
            flex: 1,
            minWidth: 0, /* flex 子项默认 min-content 宽度会撑爆容器，必须允许收缩 */
            color: overdue && !doneToday ? t.colors.danger : t.colors.text,
            fontSize: 12,
            fontFamily: t.font.body,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
            textDecoration: doneToday ? 'line-through' : 'none',
            opacity: doneToday ? 0.6 : 1,
          }}
          title={overdue && !doneToday ? `${task.title}（已逾期）` : task.title}
        >
          {summary ?? task.title}
        </span>
        {/* 循环任务连击：streak >= 2 时显示火焰 + 天数 */}
        {recurring && task.streak >= 2 && (
          <span
            className="xm-widget-streak"
            title={`连续打卡 ${task.streak} 天`}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 2,
              color: t.colors.accent,
              fontSize: 12,
              fontFamily: t.font.display,
              whiteSpace: 'nowrap',
              flexShrink: 0,
            }}
          >
            <PixelIcon name="flame" size={16} />
            {task.streak}
          </span>
        )}
        {/* 主线/支线未展开时的右对齐 x/y 步骤计数（金色小字；无步骤 0/0 灰显） */}
        {hasSteps && !expanded && questSteps && (
          <span
            className="xm-widget-progress"
            title={`步骤进度 ${doneCount}/${questSteps.length}`}
            style={{
              color: questSteps.length > 0 ? t.colors.accent : t.colors.textMuted,
              fontSize: 12,
              fontFamily: t.font.display,
              letterSpacing: '0.1em',
              whiteSpace: 'nowrap',
              flexShrink: 0,
            }}
          >
            {doneCount}/{questSteps.length}
          </span>
        )}
        {/* 番茄钟：hover 时出现的 hourglass 小按钮；平时保留占位（visibility），避免行宽抖动 */}
        <button
          className="xm-widget-pomodoro"
          type="button"
          title="开始番茄钟"
          onClick={(e) => {
            e.stopPropagation();
            void startPomodoro(task.id).catch((err: unknown) =>
              console.error('[widget] 开始番茄钟失败', err),
            );
          }}
          style={{
            visibility: hover ? 'visible' : 'hidden',
            border: 'none',
            background: 'transparent',
            padding: 1,
            width: 18,
            height: 18,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            cursor: 'pointer',
            flexShrink: 0,
          }}
        >
          <PixelIcon name="hourglass" size={16} />
        </button>
        <span className="xm-widget-importance"><ImportanceBadges importance={task.importance} /></span>
        <ExpandArrow expanded={expanded} onClick={onToggleExpand} />
      </div>
      {/* 主线/支线：标题下的 10 段迷你进度条（完成步骤/总步骤） */}
      {hasSteps && questSteps && <StepProgressBar steps={questSteps} />}
      {/* 展开的只读详情：元信息行（必有）+ 备注（如有）+ 步骤清单（主线/支线） */}
      {expanded && (
        <div style={{ paddingBottom: 2 }}>
          <div
            style={{
              padding: '0 4px 4px 32px',
              color: t.colors.info,
              fontSize: 12,
              fontFamily: t.font.body,
              letterSpacing: '0.1em',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
            title={metaParts.join(' · ')}
          >
            {metaParts.join(' · ')}
          </div>
          {hasNotes && (
            <div
              className="notes-editor-content notes-view"
              // Stored and imported notes pass the same formatting allowlist.
              dangerouslySetInnerHTML={{ __html: notesHtml }}
            />
          )}
          {hasSteps && questSteps && questSteps.length > 0 && (
            <StepChecklist steps={questSteps} />
          )}
        </div>
      )}
    </div>
  );
}

function DoneRow({ task }: { task: Task }) {
  const reopen = useTasksStore((s) => s.reopen);
  const [hover, setHover] = useState(false);

  return (
    <button
      className="xm-widget-done-row"
      type="button"
      onClick={() => void reopen(task.id)}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      title="点击重新打开"
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        width: '100%',
        textAlign: 'left',
        padding: '5px 4px 5px 28px',
        minHeight: 28,
        boxSizing: 'border-box',
        border: 'none',
        cursor: 'pointer',
        opacity: 0.5,
        backgroundColor: hover ? t.colors.panelLight : 'transparent',
        color: t.colors.text,
        fontSize: 12,
        fontFamily: t.font.body,
        textDecoration: 'line-through',
        overflow: 'hidden',
        whiteSpace: 'nowrap',
      }}
    >
      <span className="quest-title" style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>
        {task.title}
      </span>
    </button>
  );
}


/** 有 parentId 的支线作为子行：缩进 20px + 左侧 1px goldDark 竖线 */
function ChildRowWrap({ children }: { children: ReactNode }) {
  return (
    <div
      style={{
        marginLeft: 4,
        paddingLeft: 15,
        borderLeft: `1px solid ${t.colors.goldDark}`,
      }}
    >
      {children}
    </div>
  );
}

/**
 * 悬浮栏任务清单：进行中任务按规则引擎 getRankedToday() 排序（失败回退重要度降序），
 * 逾期任务标题标红；已完成淡显可点击恢复。
 * 有 parentId 的支线紧跟其母主线行渲染（缩进 20px），游离任务排在主线组之后。
 * onContentChanged：展开/收起详情、步骤加载后通知外层重新量尺寸（悬浮窗自适应）。
 */
export function QuestLog({ onContentChanged }: { onContentChanged?: () => void }) {
  const tasks = useTasksStore((s) => s.tasks);
  const loading = useTasksStore((s) => s.loading);
  const [compact, setCompact] = useState(() => window.innerWidth <= 520);
  const [autoSummaryReady, setAutoSummaryReady] = useState(false);
  const [, setSummaryVersion] = useState(0);
  const [expandedIds, setExpandedIds] = useState<ReadonlySet<string>>(new Set());
  const [ranked, setRanked] = useState<RankedTask[] | null>(null);

  useEffect(() => {
    const onResize = () => setCompact(window.innerWidth <= 520);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  useEffect(() => {
    let disposed = false;
    const unlisten: (() => void)[] = [];
    const refresh = () => {
      void Promise.all([getLlmConfig(), getSetting('widget_ai_summary')])
        .then(([cfg, enabled]) => { if (!disposed) setAutoSummaryReady(cfg.hasKey && enabled !== 'false'); })
        .catch(() => { if (!disposed) setAutoSummaryReady(false); });
    };
    refresh();
    void listen('llm-config-changed', refresh).then((fn) => { if (disposed) fn(); else unlisten.push(fn); });
    void listen<{ key: string }>('settings-changed', ({ payload }) => {
      if (payload.key === 'widget_ai_summary') refresh();
    }).then((fn) => { if (disposed) fn(); else unlisten.push(fn); });
    return () => { disposed = true; unlisten.forEach((fn) => fn()); };
  }, []);

  useEffect(() => {
    if (!compact || !autoSummaryReady) return;
    let cancelled = false;
    void (async () => {
      for (const task of tasks.filter((x) => x.status !== 'done').slice(0, 10)) {
        if (cancelled) return;
        if (task.title.length <= 16) continue;
        const key = JSON.stringify([task.id, task.title, task.notes]);
        if (summaryCache.has(key) || summaryFailures.has(key)) continue;
        try {
          const short = await summarizeTaskForWidget(task.title, task.notes ?? '');
          if (cancelled) return;
          summaryCache.set(key, short);
          setSummaryVersion((v) => v + 1);
        } catch {
          summaryFailures.add(key);
        }
      }
    })();
    return () => { cancelled = true; };
  }, [compact, autoSummaryReady, tasks]);

  // 规则引擎排序：任务列表变化时重新拉取；invoke 失败回退重要度排序且错误可见
  useEffect(() => {
    let cancelled = false;
    getRankedToday()
      .then((list) => {
        if (!cancelled) setRanked(list);
      })
      .catch((err: unknown) => {
        console.error('[widget] getRankedToday 排序失败，回退重要度排序', err);
        if (!cancelled) setRanked(null);
      });
    return () => {
      cancelled = true;
    };
  }, [tasks]);

  const toggleExpand = (id: string) => {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
    onContentChanged?.();
  };

  // 进行中任务：先按 ranked 顺序排出一维列表，再组装「主线 → 其子支线」分组，
  // 游离任务（遭遇、无父或母任务不在进行中列表的支线）排在所有主线组之后。
  // 循环任务只在应做日进入今日列表（与后端 get_ranked_today 过滤口径一致）
  const { groups, orphans } = useMemo(() => {
    const open = tasks.filter(
      (task) => task.status !== 'done' && (!isRecurring(task) || recurringDueToday(task)),
    );
    let ordered: Task[];
    if (!ranked) {
      ordered = open.sort((a, b) => b.importance - a.importance);
    } else {
      // 按 ranked 顺序排；ranked 里缺的新任务（事件尚未同步）追加在后
      const byId = new Map(open.map((task) => [task.id, task]));
      ordered = [];
      for (const r of ranked) {
        const local = byId.get(r.task.id);
        if (local) {
          ordered.push(local);
          byId.delete(r.task.id);
        } else if (r.task.status !== 'done') {
          ordered.push(r.task);
        }
      }
      const rest = [...byId.values()].sort((a, b) => b.importance - a.importance);
      ordered = [...ordered, ...rest];
    }

    const openById = new Map(ordered.map((task) => [task.id, task]));
    const childrenByParent = new Map<string, Task[]>();
    const orphanList: Task[] = [];
    const mainList: Task[] = [];
    for (const task of ordered) {
      if (task.form === 'main_quest') {
        mainList.push(task);
        continue;
      }
      const parent =
        task.form === 'side_quest' && task.parentId ? openById.get(task.parentId) : undefined;
      if (parent && parent.form === 'main_quest') {
        // 按 ordered 遍历顺序入组，组内即规则排序
        const list = childrenByParent.get(parent.id) ?? [];
        list.push(task);
        childrenByParent.set(parent.id, list);
      } else {
        orphanList.push(task);
      }
    }
    return {
      groups: mainList.map((main) => ({
        main,
        children: childrenByParent.get(main.id) ?? [],
      })),
      orphans: orphanList,
    };
  }, [tasks, ranked]);

  const doneTasks = tasks.filter((task) => task.status === 'done');

  if (groups.length === 0 && orphans.length === 0 && doneTasks.length === 0) {
    const theme = currentThemeKey();
    const copy = theme === 'stardew-valley'
      ? ['今天的农场，等你播下第一粒种子。', '回到主窗口，写下第一件要完成的事。']
      : theme === 'animal-crossing'
        ? ['今天的小岛，等你写下新计划。', '从一件轻松的小事开始吧。']
        : theme === 'parchment-journal'
          ? ['旅程新页，正等待第一笔。', '回到主窗口，记录今天的目标。']
          : ['冒险日志，正等待第一个任务。', '回到主窗口，领取今天的任务。'];
    return (
      <div className="xm-widget-empty" style={{ padding: '16px 8px', minHeight: 280, display: 'flex', flexDirection: 'column' }}>
        <SectionHeader label={theme === 'stardew-valley' ? '今日农场' : theme === 'animal-crossing' ? '今日小岛' : theme === 'parchment-journal' ? '今日手账' : '今日冒险'} />
        <div className="xm-widget-empty-body" style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 11, textAlign: 'center' }}>
          <span className="xm-widget-empty-art"><PixelIcon name="chest" size={118} /></span>
          <strong style={{ color: theme === 'stardew-valley' ? t.colors.goldDark : t.colors.accent, fontFamily: t.font.display, fontSize: 16, lineHeight: 1.45 }}>
            {loading ? '正在整理任务…' : copy[0]}
          </strong>
          <span style={{ color: t.colors.textMuted, fontFamily: t.font.body, fontSize: 13, lineHeight: 1.5 }}>{copy[1]}</span>
        </div>
      </div>
    );
  }

  const renderRow = (task: Task) => (
    <OpenRow
      key={task.id}
      task={task}
      summary={compact && autoSummaryReady ? summaryCache.get(JSON.stringify([task.id, task.title, task.notes])) : undefined}
      expanded={expandedIds.has(task.id)}
      onToggleExpand={() => toggleExpand(task.id)}
      onContentChanged={onContentChanged}
    />
  );

  return (
    <div>
      {groups.map(({ main, children }) => (
        <div key={main.id}>
          {renderRow(main)}
          {children.map((child) => (
            <ChildRowWrap key={child.id}>{renderRow(child)}</ChildRowWrap>
          ))}
        </div>
      ))}
      {orphans.map((task) => renderRow(task))}
      {doneTasks.length > 0 && (
        <div>
          <SectionHeader label="已完成" etched={false} />
          {doneTasks.map((task) => (
            <DoneRow key={task.id} task={task} />
          ))}
        </div>
      )}
    </div>
  );
}
