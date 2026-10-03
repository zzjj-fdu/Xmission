import { useCallback, useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { activeTheme as pixelJrpg } from '../themes';
import { SectionHeader } from '../components/SectionHeader';
import { QuestPanel } from '../components/QuestPanel';
import { PixelIcon, formIcon } from '../components/PixelIcon';
import { JrpgButton } from '../components/JrpgButton';
import { getMonthView } from '../api/calendar';
import type { DayCell } from '../api/calendar';
import { onCoursesChanged } from '../api/courses';
import { onTasksChanged } from '../api/tasks';
import { useTasksStore } from '../store/tasks';
import { getLlmConfig } from '../api/llm';
import { aiPlanWeek, updateSuggestionStatus } from '../api/ai';
import type { WeekPlan } from '../api/ai';
import { WEEKDAY_LABELS } from '../components/courseShared';

const { colors, font } = pixelJrpg;

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

function ymd(d: Date): string {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}


/** 月网格单元格：真实日期格 / 前后月补位灰显格 */
type GridCell = { kind: 'day'; day: DayCell } | { kind: 'ghost'; dayNum: number };

export default function CalendarPage() {
  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth() + 1); // 1~12
  const [days, setDays] = useState<DayCell[]>([]);
  const [loading, setLoading] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const complete = useTasksStore((s) => s.complete);
  const update = useTasksStore((s) => s.update);
  const allTasks = useTasksStore((s) => s.tasks);
  // AI 周计划（M4）
  const [llmReady, setLlmReady] = useState(false);
  const [plan, setPlan] = useState<WeekPlan | null>(null);
  const [planLoading, setPlanLoading] = useState(false);
  const [planError, setPlanError] = useState<string | null>(null);
  const [adoptedDates, setAdoptedDates] = useState<ReadonlySet<string>>(new Set());
  const [ignoredDates, setIgnoredDates] = useState<ReadonlySet<string>>(new Set());

  // LLM 配置探测：未配置 → 按钮置灰 + 提示（优雅降级）
  useEffect(() => {
    getLlmConfig()
      .then((cfg) => setLlmReady(cfg.hasKey))
      .catch((err: unknown) => {
        console.error('[calendar] 读取 LLM 配置失败，AI 功能按未配置处理', err);
        setLlmReady(false);
      });
  }, []);

  const taskTitle = useMemo(() => {
    const m = new Map(allTasks.map((t) => [t.id, t.title]));
    return (id: string) => m.get(id) ?? '（任务已删除）';
  }, [allTasks]);

  const runPlanWeek = () => {
    setPlanLoading(true);
    setPlanError(null);
    aiPlanWeek(0)
      .then((p) => {
        setPlan(p);
        setAdoptedDates(new Set());
        setIgnoredDates(new Set());
      })
      .catch((err: unknown) => {
        console.error('[calendar] AI 周计划生成失败', err);
        setPlanError(typeof err === 'string' ? err : '生成失败，请稍后再试');
      })
      .finally(() => setPlanLoading(false));
  };

  /** 采纳某天：把该日各任务的 planned_date 写为对应日期，建议整体置 adopted */
  const adoptDay = (date: string) => {
    if (!plan) return;
    const day = plan.days.find((d) => d.date === date);
    if (!day) return;
    Promise.all(day.items.map((it) => update(it.taskId, { plannedDate: date })))
      .then(() => {
        setAdoptedDates((prev) => new Set(prev).add(date));
        return updateSuggestionStatus(plan.suggestionId, 'adopted');
      })
      .catch((err: unknown) => console.error('[calendar] 采纳周计划失败', err));
  };

  const ignoreDay = (date: string) => {
    setIgnoredDates((prev) => new Set(prev).add(date));
  };

  const dismissPlan = () => {
    if (!plan) return;
    updateSuggestionStatus(plan.suggestionId, 'dismissed').catch((err: unknown) =>
      console.error('[calendar] 忽略周计划失败', err),
    );
    setPlan(null);
  };

  const todayStr = ymd(new Date());

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      setDays(await getMonthView(year, month));
    } catch (err) {
      console.error('[calendar] 拉取月视图失败', err);
    } finally {
      setLoading(false);
    }
  }, [year, month]);

  useEffect(() => {
    void reload();
  }, [reload]);

  // tasks / courses 任一侧变化都刷新月视图（节假日由后端聚合在 DayCell 内）
  useEffect(() => {
    let un1: (() => void) | null = null;
    let un2: (() => void) | null = null;
    onTasksChanged(() => {
      void reload();
    })
      .then((u) => {
        un1 = u;
      })
      .catch((err: unknown) => {
        console.error('[calendar] 订阅 tasks-changed 失败', err);
      });
    onCoursesChanged(() => {
      void reload();
    })
      .then((u) => {
        un2 = u;
      })
      .catch((err: unknown) => {
        console.error('[calendar] 订阅 courses-changed 失败', err);
      });
    return () => {
      un1?.();
      un2?.();
    };
  }, [reload]);

  // 月网格：周一开头，前后月补位（灰显，无数据）
  const cells = useMemo<GridCell[]>(() => {
    const out: GridCell[] = [];
    if (days.length === 0) return out;
    const first = days[0];
    const lead = (first?.weekday ?? 1) - 1;
    const prevMonthDayCount = new Date(year, month - 1, 0).getDate();
    for (let i = 0; i < lead; i++) {
      out.push({ kind: 'ghost', dayNum: prevMonthDayCount - lead + 1 + i });
    }
    for (const d of days) out.push({ kind: 'day', day: d });
    const rem = out.length % 7;
    if (rem !== 0) {
      for (let i = 1; i <= 7 - rem; i++) out.push({ kind: 'ghost', dayNum: i });
    }
    return out;
  }, [days, year, month]);

  const selectedCell =
    selected != null ? days.find((d) => d.date === selected) ?? null : null;

  const shiftMonth = (delta: number) => {
    const m0 = month - 1 + delta;
    setYear(year + Math.floor(m0 / 12));
    setMonth(((m0 % 12) + 12) % 12 + 1);
  };

  const backToToday = () => {
    const n = new Date();
    setYear(n.getFullYear());
    setMonth(n.getMonth() + 1);
    setSelected(ymd(n));
  };

  const shiftSelectedDay = (delta: number) => {
    if (!selected) return;
    const next = new Date(`${selected}T12:00:00`);
    next.setDate(next.getDate() + delta);
    setSelected(ymd(next));
    setYear(next.getFullYear());
    setMonth(next.getMonth() + 1);
  };

  useEffect(() => {
    if (!selected) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setSelected(null);
      if (event.key === 'ArrowLeft') shiftSelectedDay(-1);
      if (event.key === 'ArrowRight') shiftSelectedDay(1);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [selected]);

  const isViewingToday =
    year === now.getFullYear() && month === now.getMonth() + 1;

  return (
    <div style={{ width: '100%' }}>
      <h1
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          fontFamily: font.display,
          color: colors.accent,
          fontSize: 24,
          margin: '0 0 20px',
        }}
      >
        <PixelIcon name="calendar" size={24} />
        日历
      </h1>

      <QuestPanel>
        {/* 月切换条 */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            flexWrap: 'wrap',
            marginBottom: 12,
          }}
        >
          <JrpgButton variant="ghost" onClick={() => shiftMonth(-1)} title="上一月">
            ◀
          </JrpgButton>
          <span
            style={{
              color: colors.accent,
              fontFamily: font.display,
              fontSize: 12,
              whiteSpace: 'nowrap',
            }}
          >
            {year}年{month}月
          </span>
          <JrpgButton variant="ghost" onClick={() => shiftMonth(1)} title="下一月">
            ▶
          </JrpgButton>
          <JrpgButton variant="ghost" onClick={backToToday} disabled={isViewingToday}>
            回到今天
          </JrpgButton>
          {/* ✨ AI 周计划：LLM 未配置时置灰（优雅降级，不弹错误） */}
          <JrpgButton
            onClick={runPlanWeek}
            disabled={!llmReady || planLoading}
            title={llmReady ? '让 AI 按课表空档排布本周任务' : '先在「设置 → LLM 设置」配置 API Key'}
          >
            {planLoading ? '生成中…' : '✨ AI 周计划'}
          </JrpgButton>
          {!llmReady && (
            <span style={{ color: colors.textMuted, fontSize: 12, fontFamily: font.body }}>
              配置 LLM 后可用 AI 周计划
            </span>
          )}
          {loading && (
            <span style={{ color: colors.textMuted, fontSize: 12 }}>加载中…</span>
          )}
        </div>

        {/* 月网格 */}
        <div
          className="xm-calendar-grid"
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(7, minmax(0, 1fr))',
            overflowX: 'auto',
          }}
        >
          {WEEKDAY_LABELS.map((l) => (
            <div
              key={l}
              className="xm-calendar-weekday"
              style={{
                border: `1px solid ${colors.goldDark}`,
                padding: 4,
                color: colors.textMuted,
                fontSize: 12,
                fontFamily: font.display,
                textAlign: 'center',
                whiteSpace: 'nowrap',
              }}
            >
              {l}
            </div>
          ))}
          {cells.map((c, i) => {
            if (c.kind === 'ghost') {
              return (
                <div
                  key={`g-${i}`}
                  style={{
                    border: `1px solid ${colors.goldDark}`,
                    padding: 4,
                    minHeight: 86,
                    color: colors.textMuted,
                    opacity: 0.4,
                    fontSize: 12,
                    fontFamily: font.body,
                    backgroundColor: 'var(--xm-grid-ghost)',
                  }}
                >
                  {c.dayNum}
                </div>
              );
            }
            const d = c.day;
            const isToday = d.date === todayStr;
            const isSelected = d.date === selected;
            return (
              <div
                key={d.date}
                className="xm-calendar-day"
                onClick={() => setSelected(d.date)}
                style={{
                  border: isToday
                    ? `2px solid ${colors.accent}`
                    : `1px solid ${colors.goldDark}`,
                  padding: 4,
                  minHeight: 86,
                  minWidth: 0,
                  cursor: 'pointer',
                  backgroundColor: isSelected ? colors.panelLight : 'var(--xm-grid-cell)',
                  fontSize: 12,
                  fontFamily: font.body,
                  color: colors.text,
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 2,
                  overflow: 'hidden',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                  <span style={{ color: isToday ? colors.accent : colors.text }}>
                    {Number(d.date.slice(8))}
                  </span>
                  {isToday && <PixelIcon name="star" size={14} />}
                  {/* 节假日标签：isOff=1 红字节日名；isOff=0 金色「调休」 */}
                  {d.holidayName != null &&
                    (d.isOff ? (
                      <span
                        style={{
                          color: colors.danger,
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          whiteSpace: 'nowrap',
                        }}
                      >
                        {d.holidayName}
                      </span>
                    ) : (
                      <span
                        style={{
                          color: colors.accent,
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          whiteSpace: 'nowrap',
                        }}
                      >
                        调休
                      </span>
                    ))}
                </div>
                {/* 课程由当前主题的书本图案标记，保留课程色作为底线。 */}
                {d.courses.length > 0 && (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 3 }}>
                    {d.courses.slice(0, 4).map((c2) => (
                      <span
                        key={c2.id + c2.startTime}
                        title={c2.name}
                        style={{
                          display: 'inline-flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          width: 20,
                          height: 20,
                          flexShrink: 0,
                          borderBottom: `2px solid ${c2.color ?? colors.accent}`,
                        }}
                      ><PixelIcon name="book" size={16} /></span>
                    ))}
                    {d.courses.length > 4 && (
                      <span style={{ color: colors.textMuted }}>
                        +{d.courses.length - 4}
                      </span>
                    )}
                  </div>
                )}
                {/* 任务截止标记：红色 ⚑ + 数量 */}
                {d.tasksDue.length > 0 && (
                  <span style={{ color: colors.danger, whiteSpace: 'nowrap' }}>
                    ⚑ {d.tasksDue.length}
                  </span>
                )}
              </div>
            );
          })}
        </div>
      </QuestPanel>

      {/* AI 周计划结果：逐日计划卡，采纳写 planned_date / 忽略隐藏 */}
      {planError && (
        <QuestPanel>
          <p style={{ color: colors.danger, fontSize: 12, margin: 0 }}>{planError}</p>
        </QuestPanel>
      )}
      {plan && (
        <QuestPanel>
          <SectionHeader>
            ✨ AI 周计划
            <JrpgButton variant="ghost" onClick={dismissPlan} title="忽略整个计划">
              忽略全部
            </JrpgButton>
          </SectionHeader>
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))',
              gap: 10,
            }}
          >
            {plan.days
              .filter((d) => !ignoredDates.has(d.date))
              .map((d) => {
                const wd = WEEKDAY_LABELS[
                  (new Date(`${d.date}T00:00:00`).getDay() + 6) % 7
                ];
                const adopted = adoptedDates.has(d.date);
                return (
                  <div
                    key={d.date}
                    style={{
                      border: `1px solid ${adopted ? colors.accentAlt : colors.goldDark}`,
                      backgroundColor: colors.xpTrack,
                      padding: 10,
                      display: 'flex',
                      flexDirection: 'column',
                      gap: 6,
                      fontSize: 12,
                      fontFamily: font.body,
                      opacity: adopted ? 0.7 : 1,
                    }}
                  >
                    <div
                      style={{
                        color: colors.accent,
                        fontFamily: font.display,
                        display: 'flex',
                        justifyContent: 'space-between',
                      }}
                    >
                      <span>
                        {d.date} {wd}
                      </span>
                      {adopted && <span style={{ color: colors.accentAlt }}>已采纳</span>}
                    </div>
                    {d.items.length === 0 && !d.restAdvice && (
                      <span style={{ color: colors.textMuted }}>当天不安排任务</span>
                    )}
                    {d.items.map((it, i) => (
                      <div key={i} style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                        <span style={{ color: colors.text }}>
                          {it.startTime}-{it.endTime} {taskTitle(it.taskId)}
                        </span>
                        {it.note && (
                          <span style={{ color: colors.textMuted }}>{it.note}</span>
                        )}
                      </div>
                    ))}
                    {d.restAdvice && (
                      <span style={{ color: colors.info }}>☾ {d.restAdvice}</span>
                    )}
                    {!adopted && (
                      <div style={{ display: 'flex', gap: 6, marginTop: 2 }}>
                        <JrpgButton onClick={() => adoptDay(d.date)} disabled={d.items.length === 0}>
                          采纳
                        </JrpgButton>
                        <JrpgButton variant="ghost" onClick={() => ignoreDay(d.date)}>
                          忽略
                        </JrpgButton>
                      </div>
                    )}
                  </div>
                );
              })}
          </div>
        </QuestPanel>
      )}

      {/* 日期详情在独立浮层中展示，并可逐日翻页。 */}
      {selected && createPortal(
        <div className="xm-calendar-detail-backdrop" role="presentation" onClick={() => setSelected(null)}>
          <div className="xm-calendar-detail-modal" role="dialog" aria-modal="true" aria-label={`${selected} 详情`} onClick={(event) => event.stopPropagation()}>
            <div className="xm-calendar-detail-controls">
              <JrpgButton variant="ghost" onClick={() => shiftSelectedDay(-1)}>◀ 前一天</JrpgButton>
              <strong style={{ color: colors.accent, fontFamily: font.display }}>{selected}</strong>
              <JrpgButton variant="ghost" onClick={() => shiftSelectedDay(1)}>后一天 ▶</JrpgButton>
              <JrpgButton variant="ghost" onClick={() => setSelected(null)}>关闭 ×</JrpgButton>
            </div>
            {selectedCell ? <QuestPanel>
          <SectionHeader>
            {selectedCell.date} 详情
            {selectedCell.holidayName != null && (
              <span
                style={{ color: selectedCell.isOff ? colors.danger : colors.accent }}
              >
                {selectedCell.isOff
                  ? selectedCell.holidayName
                  : `调休·${selectedCell.holidayName}`}
              </span>
            )}
          </SectionHeader>

          <SectionHeader muted>当天课程（{selectedCell.courses.length}）</SectionHeader>
          {selectedCell.courses.length === 0 ? (
            <p style={{ color: colors.textMuted, fontSize: 12, margin: '0 0 8px' }}>
              当天没有课
            </p>
          ) : (
            selectedCell.courses.map((c) => (
              <div
                key={c.id + c.startTime}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                  padding: '4px 0',
                  borderBottom: `1px solid ${colors.goldDark}`,
                  fontSize: 12,
                  fontFamily: font.body,
                  minWidth: 0,
                }}
              >
                <span style={{ display: 'inline-flex', flexShrink: 0, borderBottom: `2px solid ${c.color ?? colors.accent}` }}>
                  <PixelIcon name="book" size={20} />
                </span>
                <span style={{ color: colors.textMuted, flexShrink: 0 }}>
                  {c.startTime}-{c.endTime}
                </span>
                <span
                  style={{
                    flex: 1,
                    minWidth: 0,
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {c.name}
                </span>
                {c.location && (
                  <span
                    style={{
                      color: colors.textMuted,
                      flexShrink: 0,
                      maxWidth: '40%',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {c.location}
                  </span>
                )}
              </div>
            ))
          )}

          <div style={{ height: 12 }} />
          <SectionHeader muted>
            当天截止任务（{selectedCell.tasksDue.length}）
          </SectionHeader>
          {selectedCell.tasksDue.length === 0 ? (
            <p style={{ color: colors.textMuted, fontSize: 12, margin: 0 }}>
              当天没有截止任务
            </p>
          ) : (
            selectedCell.tasksDue.map((t) => (
              <div
                key={t.id}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                  padding: '4px 0',
                  borderBottom: `1px solid ${colors.goldDark}`,
                  fontSize: 12,
                  fontFamily: font.body,
                  minWidth: 0,
                }}
              >
                <PixelIcon name={formIcon(t.form)} size={16} />
                <span
                  style={{
                    flex: 1,
                    minWidth: 0,
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                    textDecoration: t.status === 'done' ? 'line-through' : 'none',
                    opacity: t.status === 'done' ? 0.55 : 1,
                  }}
                  title={t.title}
                >
                  {t.title}
                </span>
                <span style={{ color: colors.textMuted, flexShrink: 0 }}>
                  {t.status === 'done' ? '已完成' : '进行中'}
                </span>
                {t.status !== 'done' && (
                  <JrpgButton
                    onClick={() => {
                      complete(t.id).catch((err: unknown) => {
                        console.error('[calendar] 完成任务失败', err);
                      });
                    }}
                  >
                    ✓ 完成
                  </JrpgButton>
                )}
              </div>
            ))
          )}
            </QuestPanel> : <QuestPanel><p style={{ margin: 0, color: colors.textMuted }}>正在读取这一天…</p></QuestPanel>}
          </div>
        </div>, document.body
      )}
    </div>
  );
}
