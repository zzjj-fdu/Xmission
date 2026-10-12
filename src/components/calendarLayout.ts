import type { CalendarCourseItem, DayCell } from '../api/calendar';
import type { Task } from '../api/tasks';

export type CalendarView = 'day' | 'week' | 'month';
export type CalendarPreference = 'auto' | CalendarView;
export function automaticCalendarView(width: number, previous?: CalendarView): CalendarView {
  // A small dead band prevents scrollbar rounding and divider jitter switching views.
  if (previous === 'day' && width < 624) return 'day';
  if (previous === 'week' && width >= 576 && width < 1074) return 'week';
  if (previous === 'month' && width >= 1026) return 'month';
  return width < 600 ? 'day' : width < 1050 ? 'week' : 'month';
}
export type CalendarDensity = 'full' | 'titles' | 'icons' | 'markers';
export function calendarDensity(width: number, height: number, view: CalendarView): CalendarDensity {
  if (view === 'day') return width > 0 && (width < 280 || height < 170) ? 'icons' : 'full';
  const cellWidth = view === 'month' ? width / 7 : width / Math.max(1, Math.floor((width + 10) / 220));
  return cellWidth >= 184 ? 'full' : cellWidth >= 86 ? 'titles' : cellWidth >= 52 ? 'icons' : 'markers';
}
export function calendarDate(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}
export function moveCalendarDate(value: string, delta: number): string {
  const date = new Date(`${value}T12:00:00`);
  date.setDate(date.getDate() + delta);
  return calendarDate(date);
}
export function moveCalendarMonth(value: string, delta: number): string {
  const date = new Date(`${value}T12:00:00`);
  const day = date.getDate();
  date.setDate(1);
  date.setMonth(date.getMonth() + delta);
  date.setDate(Math.min(day, new Date(date.getFullYear(), date.getMonth() + 1, 0).getDate()));
  return calendarDate(date);
}
export function calendarWeek(value: string): string[] {
  const weekday = new Date(`${value}T12:00:00`).getDay();
  const monday = moveCalendarDate(value, -((weekday + 6) % 7));
  return Array.from({ length: 7 }, (_, i) => moveCalendarDate(monday, i));
}
export function calendarMonth(value: string): string[] {
  const first = `${value.slice(0, 7)}-01`;
  const start = calendarWeek(first)[0];
  const date = new Date(`${first}T12:00:00`);
  const count = new Date(date.getFullYear(), date.getMonth() + 1, 0).getDate();
  const lead = (date.getDay() + 6) % 7;
  return Array.from({ length: Math.ceil((lead + count) / 7) * 7 }, (_, i) => moveCalendarDate(start, i));
}

export interface CalendarEntry {
  key: string;
  kind: 'course' | 'task';
  title: string;
  time: string;
  endTime?: string;
  location?: string | null;
  color?: string | null;
  label: string;
  done: boolean;
  taskId?: string;
  recurring?: boolean;
  importance?: number;
  urgency?: number;
  category?: string;
}

const clockMinutes = (clock: string) => {
  const match = /^(\d{1,2}):(\d{2})$/.exec(clock);
  if (!match || Number(match[1]) > 23 || Number(match[2]) > 59) return NaN;
  return Number(match[1]) * 60 + Number(match[2]);
};

/** Display-only blocks: one course in one room, allowing a short inter-period break.
 * Separate course IDs and morning/afternoon sessions remain distinct. */
export function mergeCalendarCourses(courses: CalendarCourseItem[]): (CalendarCourseItem & { periodCount: number })[] {
  const groups = new Map<string, CalendarCourseItem[]>();
  for (const course of courses) {
    const identity = JSON.stringify([course.id, course.name.trim(), course.location?.trim() ?? '']);
    const group = groups.get(identity) ?? [];
    if (!group.some(item => item.startTime === course.startTime && item.endTime === course.endTime)) group.push(course);
    groups.set(identity, group);
  }
  const blocks: (CalendarCourseItem & { periodCount: number })[] = [];
  for (const group of groups.values()) {
    group.sort((a, b) => clockMinutes(a.startTime) - clockMinutes(b.startTime));
    let current: (CalendarCourseItem & { periodCount: number }) | undefined;
    for (const course of group) {
      const start = clockMinutes(course.startTime), end = clockMinutes(course.endTime);
      const previousEnd = current ? clockMinutes(current.endTime) : NaN;
      if (current && Number.isFinite(start + end + previousEnd) && end > start
          && clockMinutes(current.endTime) > clockMinutes(current.startTime) && start <= previousEnd + 25) {
        if (end > previousEnd) current.endTime = course.endTime;
        current.periodCount++;
      } else {
        current = { ...course, periodCount: 1 };
        blocks.push(current);
      }
    }
  }
  return blocks.sort((a, b) => a.startTime.localeCompare(b.startTime));
}

function deadlineDate(value: string | null): string | null {
  if (!value) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value.slice(0, 10) : calendarDate(date);
}
function deadlineTime(value: string | null): string {
  if (!value || value.length <= 10) return '';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '' : `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
}

/** Course titles plus deadline, adopted plans and upcoming/current routines.
 * Historical routines only show a recorded completion; never invent history. */
export function calendarEntries(day: DayCell, tasks: Task[], today: string): CalendarEntry[] {
  const source = new Map(tasks.map(task => [task.id, task]));
  const entries: CalendarEntry[] = mergeCalendarCourses(day.courses).map((course, index) => ({
    key: `course:${course.id}:${course.startTime}:${index}`, kind: 'course',
    title: course.name, time: course.startTime, endTime: course.endTime,
    color: course.color, location: course.location, done: false, label: course.periodCount > 1 ? '课程 · 连堂' : '课程',
  }));
  // Preserve API results while the task store loads; live store takes precedence.
  for (const task of day.tasksDue) {
    if (!source.has(task.id)) entries.push({ key: `task:${task.id}`, kind: 'task',
      title: task.title, time: '', done: task.status === 'done', label: '截止', taskId: task.id });
  }
  for (const task of tasks) {
    const due = deadlineDate(task.deadline) === day.date;
    const planned = task.plannedDate === day.date;
    const weekdays = (task.recurDays ?? '').split(',').map(Number);
    const recurring = task.recurrence !== 'none';
    const repeats = recurring && task.status !== 'shelved' && task.status !== 'done'
      && (deadlineDate(task.createdAt) ?? '') <= day.date
      && (day.date >= today || task.lastDoneDate === day.date)
      && (task.recurrence === 'daily' || task.recurrence === 'weekly' && weekdays.includes(day.weekday));
    if (!due && !planned && !repeats) continue;
    entries.push({ key: `task:${task.id}`, kind: 'task', title: task.title,
      time: due ? deadlineTime(task.deadline) : '',
      label: [due ? '截止' : '', planned ? '计划' : '', repeats ? task.recurrence === 'weekly' ? '每周目标' : '每日目标' : ''].filter(Boolean).join(' · '),
      done: task.status === 'done' || (recurring && (task.lastDoneDate === day.date || day.date === today && task.doneToday)),
      taskId: task.id, recurring, importance: task.importance, urgency: task.urgency, category: task.icon });
  }
  const priority = (entry: CalendarEntry) => entry.done ? 4
    : entry.label.includes('截止') ? 0 : entry.kind === 'course' ? 1
    : entry.label.includes('计划') ? 2 : 3;
  return entries.sort((a, b) => priority(a) - priority(b)
    || (a.time || '23:59').localeCompare(b.time || '23:59')
    || (b.importance ?? 0) - (a.importance ?? 0) || (b.urgency ?? 0) - (a.urgency ?? 0)
    || a.title.localeCompare(b.title, 'zh-CN'));
}
