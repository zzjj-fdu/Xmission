/**
 * M3 课表/日历共享常量与工具（前端新增文件，不改冻结契约）。
 * 注意：COURSE_COLORS 是「课程数据」的候选值（存库），不是 UI 主题色；
 * UI 铬件颜色仍然只用 pixelJrpg.colors.*。
 */

/** 课程颜色 8 色板（任务书指定预设值；无 color 时调用方回退 panelLight） */
export const COURSE_COLORS = [
  '#e05c5c',
  '#f5c542',
  '#4ade80',
  '#63d6e8',
  '#9c9bb8',
  '#c084fc',
  '#fb923c',
  '#f472b6',
] as const;

export const WEEKDAY_LABELS = ['周一', '周二', '周三', '周四', '周五', '周六', '周日'] as const;

export const PARITY_OPTIONS = [
  { value: 'all', label: '每周' },
  { value: 'odd', label: '单周' },
  { value: 'even', label: '双周' },
] as const;

export interface CoursePeriod {
  start: string;
  end: string;
}

/** 缺省 8 节模板（setting 'course_periods' 缺失时由前端兜底） */
export const DEFAULT_PERIODS: CoursePeriod[] = [
  { start: '08:00', end: '08:45' },
  { start: '08:55', end: '09:40' },
  { start: '10:00', end: '10:45' },
  { start: '10:55', end: '11:40' },
  { start: '14:00', end: '14:45' },
  { start: '14:55', end: '15:40' },
  { start: '16:00', end: '16:45' },
  { start: '16:55', end: '17:40' },
];

/** 周次范围格式校验：如 "1-16"、"1-8,10-16"、"3"（允许逗号两侧空格） */
export function isValidWeeksMask(v: string): boolean {
  return /^\s*\d+(\s*-\s*\d+)?(\s*,\s*\d+(\s*-\s*\d+)?)*\s*$/.test(v);
}

/** 从 setting 字符串解析节次模板；缺失/损坏时回退缺省 8 节 */
export function parsePeriods(raw: string | null): CoursePeriod[] {
  if (!raw) return DEFAULT_PERIODS.map((p) => ({ ...p }));
  try {
    const data: unknown = JSON.parse(raw);
    if (!Array.isArray(data)) return DEFAULT_PERIODS.map((p) => ({ ...p }));
    const out: CoursePeriod[] = [];
    for (const item of data) {
      if (
        typeof item === 'object' &&
        item !== null &&
        typeof (item as { start?: unknown }).start === 'string' &&
        typeof (item as { end?: unknown }).end === 'string'
      ) {
        out.push({
          start: (item as { start: string }).start,
          end: (item as { end: string }).end,
        });
      }
    }
    return out.length > 0 ? out : DEFAULT_PERIODS.map((p) => ({ ...p }));
  } catch {
    return DEFAULT_PERIODS.map((p) => ({ ...p }));
  }
}
