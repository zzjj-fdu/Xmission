import { useEffect, useMemo, useState } from 'react';
import { activeTheme } from '../themes';
import { SectionHeader } from '../components/SectionHeader';
import { QuestPanel } from '../components/QuestPanel';
import { PixelIcon } from '../components/PixelIcon';
import { JrpgButton } from '../components/JrpgButton';
import { AdaptiveCalendar } from '../components/AdaptiveCalendar';
import { useTasksStore } from '../store/tasks';
import { getLlmConfig } from '../api/llm';
import { aiPlanWeek, updateSuggestionStatus } from '../api/ai';
import type { WeekPlan } from '../api/ai';
import { WEEKDAY_LABELS } from '../components/courseShared';

const { colors, font } = activeTheme;

export default function CalendarPage() {
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


  return (
    <div className="xm-calendar-page" style={{ width: '100%', minWidth: 0 }}>
      <h1 style={{ display: 'flex', alignItems: 'center', gap: 8, fontFamily: font.display, color: colors.accent, fontSize: 24, margin: '0 0 16px' }}>
        <PixelIcon name="calendar" size={24} />日历
      </h1>
      <AdaptiveCalendar actions={<JrpgButton onClick={runPlanWeek} disabled={!llmReady || planLoading}
        title={llmReady ? '让 AI 按课表空档排布本周任务' : '先在设置中配置 API Key'}>
        {planLoading ? '生成中…' : '✨ AI 周计划'}
      </JrpgButton>} />
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
              gridTemplateColumns: 'repeat(auto-fill, minmax(min(100%, 240px), 1fr))',
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

    </div>
  );
}
