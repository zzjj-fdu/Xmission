import { invoke } from '@tauri-apps/api/core';

/** 与 Rust 侧 serde camelCase 模型一一对应（M3 契约） */

export interface CalendarCourseItem {
  id: string;
  name: string;
  color: string | null;
  startTime: string;
  endTime: string;
  location: string | null;
}

export interface CalendarTaskItem {
  id: string;
  title: string;
  form: string;
  status: string;
}

export interface DayCell {
  /** YYYY-MM-DD */
  date: string;
  /** 1~7（周一~周日） */
  weekday: number;
  /** 节假日/调休名称；非节假日条目为 null */
  holidayName: string | null;
  /** 1=放假 0=调休上班；非节假日条目为 null */
  isOff: boolean | null;
  /** 截止日在当天的任务（含已完成） */
  tasksDue: CalendarTaskItem[];
  /** 当天课程（已应用周次/单双周/调课过滤；semester_start 未设置时全量返回） */
  courses: CalendarCourseItem[];
}

/** 月视图：返回当月每一天的聚合（month 1~12） */
export async function getMonthView(year: number, month: number): Promise<DayCell[]> {
  return invoke<DayCell[]>('get_month_view', { year, month });
}

/** 单日详情 */
export async function getDayDetail(date: string): Promise<DayCell> {
  return invoke<DayCell>('get_day_detail', { date });
}
