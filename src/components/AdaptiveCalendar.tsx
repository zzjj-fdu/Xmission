import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties, ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { activeTheme } from '../themes';
import { getDayDetail, getMonthView } from '../api/calendar';
import type { DayCell } from '../api/calendar';
import { onCoursesChanged } from '../api/courses';
import { onTasksChanged, taskDayNow } from '../api/tasks';
import { useTasksStore } from '../store/tasks';
import { QuestPanel } from './QuestPanel';
import { JrpgButton } from './JrpgButton';
import { PixelIcon, taskIcon } from './PixelIcon';
import { automaticCalendarView, calendarDensity, calendarDate, calendarEntries, calendarMonth, calendarWeek, moveCalendarDate, moveCalendarMonth } from './calendarLayout';
import type { CalendarEntry, CalendarPreference, CalendarView } from './calendarLayout';
import { useCalendarSummaries } from './useCalendarSummaries';
import './AdaptiveCalendar.css';

const { colors } = activeTheme;
const weekdays = ['周一', '周二', '周三', '周四', '周五', '周六', '周日'];
const viewNames = { day: '日程', week: '本周', month: '月历' };
const entryIcon = (entry: CalendarEntry) => entry.kind === 'course' ? 'book'
  : entry.category ? taskIcon(entry.category) : entry.label.includes('截止') ? 'hourglass' : 'scroll';

function Agenda({ day, entries, onComplete, pending, titleFor = entry => entry.title }: {
  day: DayCell; entries: CalendarEntry[]; onComplete: (id: string) => void; pending: string | null;
  titleFor?: (entry: CalendarEntry) => string;
}) {
  return <div className="xm-calendar-agenda">
    {day.holidayName && <div className="xm-calendar-holiday" style={{ color: day.isOff ? colors.danger : colors.accent }}>
      {day.isOff ? day.holidayName : `调休 · ${day.holidayName}`}
    </div>}
    {entries.length === 0 ? <div className="xm-calendar-empty"><PixelIcon name="calendar" size={32} /><strong>这一天留一点空闲</strong><span>没有课程、计划或截止任务</span></div>
      : entries.map(entry => <div key={entry.key} className={`xm-calendar-agenda-row ${entry.done ? 'is-done' : ''}`}>
        <div className="xm-calendar-agenda-symbol" style={{ color: entry.kind === 'course' ? entry.color ?? colors.info : colors.accent }}>
          <PixelIcon name={entryIcon(entry)} size={24} />
        </div>
        <div className="xm-calendar-agenda-copy">
          <span className="xm-calendar-agenda-label">{entry.label}{entry.time && ` · ${entry.time}${entry.endTime ? `–${entry.endTime}` : ''}`}</span>
          <strong title={entry.title}>{titleFor(entry)}</strong>
          {titleFor(entry) !== entry.title && <span className="xm-calendar-agenda-label">AI 概括</span>}
          {entry.location && <span className="xm-calendar-agenda-label">{entry.location}</span>}
          {entry.done && <span className="xm-calendar-agenda-label">已完成</span>}
        </div>
        {entry.taskId && !entry.done && (!entry.recurring || day.date === taskDayNow()) &&
          <JrpgButton variant="ghost" disabled={pending != null} onClick={() => onComplete(entry.taskId!)}>
            {pending === entry.taskId ? '保存中…' : '✓ 完成'}
          </JrpgButton>}
      </div>)}
  </div>;
}

export function AdaptiveCalendar({ actions }: { actions?: ReactNode }) {
  const today = calendarDate(new Date());
  const [anchor, setAnchor] = useState(today);
  const [preference, setPreference] = useState<CalendarPreference>(() => {
    try { const saved = localStorage.getItem('xmission-calendar-view'); return saved === 'day' || saved === 'week' || saved === 'month' ? saved : 'auto'; }
    catch { return 'auto'; }
  });
  const [size, setSize] = useState({ width: 0, height: 700, autoView: 'month' as CalendarView });
  const [days, setDays] = useState<DayCell[]>([]);
  const [extras, setExtras] = useState<Record<string, DayCell>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [selected, setSelected] = useState<string | null>(null);
  const [pending, setPending] = useState<string | null>(null);
  const area = useRef<HTMLDivElement>(null);
  const dialog = useRef<HTMLDivElement>(null);
  const generation = useRef(0);
  const tasks = useTasksStore(state => state.tasks);
  const complete = useTasksStore(state => state.complete);
  const year = Number(anchor.slice(0, 4));
  const month = Number(anchor.slice(5, 7));
  const view = preference === 'auto' ? size.autoView : preference;
  const density = calendarDensity(size.width, size.height, view);
  const compact = view === 'day' && density === 'icons';
  const cellHeight = Math.max(density === 'markers' ? 64 : density === 'icons' ? 88 : 120,
    Math.floor((size.height - 38) / (view === 'month' ? calendarMonth(anchor).length / 7 : 1)));
  const iconColumns = Math.max(1, Math.floor((size.width / 7 - 16) / 28));
  const eventLimit = Math.max(1, Math.min(8, density === 'icons' || density === 'markers'
    ? Math.floor((cellHeight - 55) / 28) * iconColumns : Math.floor((cellHeight - 65) / 27)));

  useEffect(() => {
    const element = area.current;
    if (!element) return;
    const main = element.closest('.xm-main') ?? element.parentElement;
    let frame = 0;
    const measure = () => {
      const width = Math.floor(element.getBoundingClientRect().width);
      const top = main ? element.getBoundingClientRect().top - main.getBoundingClientRect().top + main.scrollTop : 160;
      const height = Math.max(0, Math.floor((main?.clientHeight || window.innerHeight) - top - 28));
      setSize(prev => prev.width === width && prev.height === height ? prev
        : { width, height, autoView: automaticCalendarView(width, prev.width > 0 ? prev.autoView : undefined) });
    };
    measure();
    const observer = new ResizeObserver(() => {
      window.cancelAnimationFrame(frame);
      frame = window.requestAnimationFrame(measure);
    });
    observer.observe(element);
    if (main) observer.observe(main);
    return () => { observer.disconnect(); window.cancelAnimationFrame(frame); };
  }, []);

  const reload = useCallback(async () => {
    const current = ++generation.current;
    setLoading(true); setError(''); setExtras({});
    try {
      const result = await getMonthView(year, month);
      if (current === generation.current) setDays(result);
    } catch (reason) {
      if (current === generation.current) setError(`日历读取失败：${String(reason)}`);
    } finally { if (current === generation.current) setLoading(false); }
  }, [year, month]);

  useEffect(() => { void reload(); return () => { generation.current++; }; }, [reload]);
  useEffect(() => {
    let active = true;
    const releases: (() => void)[] = [];
    for (const subscribe of [onTasksChanged, onCoursesChanged]) {
      void subscribe(() => { void reload(); }).then(release => active ? releases.push(release) : release())
        .catch(reason => console.error('[calendar] 无法订阅日历更新', reason));
    }
    return () => { active = false; releases.forEach(release => release()); };
  }, [reload]);

  const visible = useMemo(() => view === 'day' ? [anchor] : view === 'week' ? calendarWeek(anchor) : calendarMonth(anchor), [view, anchor]);
  const byDate = useMemo(() => new Map([...days, ...Object.values(extras)].map(day => [day.date, day])), [days, extras]);
  const entriesByDate = useMemo(() => new Map([...byDate].map(([date, day]) => [date, calendarEntries(day, tasks, today)])), [byDate, tasks, today]);
  const visibleEntries = useMemo(() => [...new Set([anchor, ...visible])].flatMap(date => {
    const entries = entriesByDate.get(date) ?? [];
    return view === 'month' ? entries.slice(0, eventLimit) : entries;
  }), [visible, entriesByDate, anchor, view, eventLimit]);
  const titleFor = useCalendarSummaries(visibleEntries, (density === 'full' || density === 'titles') && !loading);
  useEffect(() => {
    if (loading || days.length === 0) return;
    const requested = [...new Set([...visible, ...(selected ? [selected] : [])])];
    const missing = requested.filter(date => !byDate.has(date));
    if (!missing.length) return;
    let active = true;
    void Promise.all(missing.map(getDayDetail)).then(result => {
      if (active) setExtras(previous => ({ ...previous, ...Object.fromEntries(result.map(day => [day.date, day])) }));
    }).catch(reason => { if (active) setError(`部分日期读取失败：${String(reason)}`); });
    return () => { active = false; };
  }, [visible, selected, loading, days, byDate]);

  const openDay = (date: string) => { setAnchor(date); setSelected(date); };
  const shift = (delta: number) => setAnchor(previous => view === 'month' ? moveCalendarMonth(previous, delta) : moveCalendarDate(previous, delta * (view === 'week' ? 7 : 1)));
  const shiftDetail = useCallback((delta: number) => {
    if (!selected) return;
    const next = moveCalendarDate(selected, delta);
    setSelected(next); setAnchor(next);
  }, [selected]);
  useEffect(() => {
    if (!selected) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); setSelected(null); }
      if (event.key === 'ArrowLeft') { event.preventDefault(); shiftDetail(-1); }
      if (event.key === 'ArrowRight') { event.preventDefault(); shiftDetail(1); }
      if (event.key === 'Tab') {
        const buttons = dialog.current?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)');
        if (!buttons?.length) return;
        const first = buttons[0]; const last = buttons[buttons.length - 1];
        if (event.shiftKey && (document.activeElement === first || document.activeElement === dialog.current)) { event.preventDefault(); last.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [selected, shiftDetail]);
  const dialogOpen = selected !== null;
  useEffect(() => {
    if (!dialogOpen) return;
    const previous = document.activeElement as HTMLElement | null;
    dialog.current?.focus({ preventScroll: true });
    return () => { if (previous?.isConnected) previous.focus({ preventScroll: true }); };
  }, [dialogOpen]);

  const finish = async (id: string) => {
    setPending(id); setError('');
    try { await complete(id); await reload(); }
    catch (reason) { setError(`未能完成任务：${String(reason)}`); }
    finally { setPending(null); }
  };
  const preferenceChange = (value: CalendarPreference) => {
    setPreference(value);
    try { localStorage.setItem('xmission-calendar-view', value); } catch { /* Optional preference persistence. */ }
  };
  const dateLabel = (date: string) => `${Number(date.slice(5, 7))}月${Number(date.slice(8))}日`;
  const title = view === 'month' ? `${year}年 ${month}月` : view === 'week'
    ? `${dateLabel(visible[0])} — ${dateLabel(visible[6])}` : `${dateLabel(anchor)} ${weekdays[(new Date(`${anchor}T12:00:00`).getDay() + 6) % 7]}`;
  const chosen = selected ? byDate.get(selected) : undefined;

  return <QuestPanel className={`xm-adaptive-calendar xm-calendar-density-${density}`}>
    <div className="xm-calendar-toolbar">
      <div className="xm-calendar-heading"><span className="xm-calendar-eyebrow">{preference === 'auto' ? `自动 · ${viewNames[view]}` : viewNames[view]}</span><h2>{title}</h2></div>
      <div className="xm-calendar-view-controls" role="group" aria-label="日历查看方式">
        {(['auto', 'day', 'week', 'month'] as const).map(value => <button key={value} type="button" aria-pressed={preference === value}
          onClick={() => preferenceChange(value)}>{value === 'auto' ? '自动' : value === 'day' ? '日' : value === 'week' ? '周' : '月'}</button>)}
      </div>
      <div className="xm-calendar-navigation">
        <button type="button" onClick={() => shift(-1)} aria-label={view === 'month' ? '上一月' : view === 'week' ? '上一周' : '前一天'}>‹</button>
        <button type="button" onClick={() => { setAnchor(today); setSelected(null); }}>今天</button>
        <button type="button" onClick={() => shift(1)} aria-label={view === 'month' ? '下一月' : view === 'week' ? '下一周' : '后一天'}>›</button>
        {view === 'day' && <button type="button" onClick={() => openDay(anchor)}>查看详情</button>}
      </div>
      <div className="xm-calendar-ai-action">{actions}</div>
    </div>
    <div className="xm-calendar-legend"><span><i style={{ background: colors.info }} />课程</span><span><i style={{ background: colors.accent }} />计划 / 目标</span><span><i style={{ background: colors.danger }} />截止任务</span><span className="xm-calendar-summary-status" role="status">{loading ? '更新中…' : visibleEntries.some(entry => titleFor(entry) !== entry.title) ? 'AI 概括' : ''}</span></div>
    {error && <div className="xm-calendar-error" role="alert">{error}<button type="button" onClick={() => void reload()}>重试</button></div>}
    <div ref={area} className={`xm-calendar-area xm-calendar-mode-${view}`} data-calendar-view={view} data-calendar-density={density}
      style={{ '--xm-calendar-cell-height': `${cellHeight}px` } as CSSProperties}>
      {compact && view === 'day' ? <button type="button" className="xm-calendar-compact-day" onClick={() => openDay(anchor)}>
        <PixelIcon name="calendar" size={24} /><strong>{dateLabel(anchor)}</strong>
        <span className="xm-calendar-mini-icons" aria-hidden="true">{(entriesByDate.get(anchor) ?? []).slice(0, 4).map(entry =>
          <PixelIcon key={entry.key} name={entryIcon(entry)} size={20} />)}</span>
        <span>{(entriesByDate.get(anchor) ?? []).length} 项安排 · 点击查看</span>
      </button> : view === 'day' ? byDate.get(anchor)
        ? <Agenda day={byDate.get(anchor)!} entries={entriesByDate.get(anchor)!} titleFor={titleFor} onComplete={id => void finish(id)} pending={pending} />
        : <p role="status">{error ? '暂时无法显示这一天' : '正在读取当天日程…'}</p>
        : <div className={view === 'month' ? 'xm-calendar-grid' : 'xm-calendar-week-grid'}>
          {view === 'month' && weekdays.map(label => <div className="xm-calendar-weekday" key={label}>{label}</div>)}
          {visible.map(date => {
            const day = byDate.get(date);
            const entries = entriesByDate.get(date) ?? [];
            const ghost = date.slice(0, 7) !== anchor.slice(0, 7);
            const shown = view === 'month' ? entries.slice(0, eventLimit) : entries;
            return <button type="button" key={date} className={`xm-calendar-day ${date === today ? 'is-today' : ''} ${ghost ? 'is-other-month' : ''}`}
              aria-label={`${date}，${entries.length}项日程，查看详情`} onClick={() => openDay(date)}>
              <div className="xm-calendar-date-line"><span className="xm-calendar-date">{view === 'week' ? dateLabel(date) : Number(date.slice(8))}</span>
                {view === 'week' && <span>{weekdays[(new Date(`${date}T12:00:00`).getDay() + 6) % 7]}</span>}
                {date === today && <span className="xm-calendar-today-label">今天</span>}
              </div>
              {day?.holidayName && <span className="xm-calendar-holiday" style={{ color: day.isOff ? colors.danger : colors.accent }}>
                {day.isOff ? day.holidayName : `调休 · ${day.holidayName}`}</span>}
              <div className="xm-calendar-entries">
                {shown.map(entry => <div key={entry.key} className={`xm-calendar-entry ${entry.done ? 'is-done' : ''}`}
                  title={`${entry.time}${entry.endTime ? `–${entry.endTime}` : ''} ${entry.title}${entry.location ? ` · ${entry.location}` : ''} · ${entry.label}`}>
                  <i className="xm-calendar-entry-marker" style={{ background: entry.kind === 'course' ? entry.color ?? colors.info : entry.label.includes('截止') ? colors.danger : colors.accent }} />
                  <span className="xm-calendar-entry-icon" aria-hidden="true"><PixelIcon name={entryIcon(entry)} size={18} /></span>
                  <span className="xm-calendar-entry-name">{entry.done && '✓ '}{titleFor(entry)}</span>
                  {entry.time && <time>{entry.time}</time>}
                </div>)}
                {day && !entries.length && view === 'week' && !compact && <span className="xm-calendar-rest">暂无安排</span>}
                {!day && <span className="xm-calendar-rest">{error ? '待重试' : '读取中…'}</span>}
              </div>
              {entries.length > shown.length && <span className="xm-calendar-more">{density === 'icons' || density === 'markers' ? `+${entries.length - shown.length}` : `另 ${entries.length - shown.length} 项 ›`}</span>}
            </button>;
          })}
        </div>}
    </div>
    {selected && createPortal(<div className="xm-calendar-detail-backdrop" role="presentation" onClick={() => setSelected(null)}>
      <div ref={dialog} className="xm-calendar-detail-modal" role="dialog" aria-modal="true" tabIndex={-1} aria-label={`${selected} 日程详情`} onClick={event => event.stopPropagation()}>
        <div className="xm-calendar-detail-controls">
          <button type="button" onClick={() => shiftDetail(-1)} aria-label="详情前一天">‹</button>
          <strong>{selected}</strong>
          <button type="button" onClick={() => shiftDetail(1)} aria-label="详情后一天">›</button>
          <button type="button" onClick={() => setSelected(null)} aria-label="关闭日期详情">×</button>
        </div>
        <QuestPanel>
          {error && <p role="alert" style={{ color: colors.danger }}>{error}</p>}
          {chosen ? <Agenda day={chosen} entries={calendarEntries(chosen, tasks, today)} onComplete={id => void finish(id)} pending={pending} />
            : <p role="status">{error ? '暂时无法显示这一天' : '正在读取这一天…'}</p>}
        </QuestPanel>
      </div>
    </div>, document.body)}
  </QuestPanel>;
}
