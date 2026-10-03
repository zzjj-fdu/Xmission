import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import type { UnlistenFn } from '@tauri-apps/api/event';

/** 与 Rust 侧 serde camelCase 模型一一对应（M3 契约） */

export type WeekParity = 'all' | 'odd' | 'even';

export interface CourseSlot {
  id: string;
  courseId: string;
  weekday: number; // 1~7（周一~周日）
  startTime: string; // "HH:MM"
  endTime: string;
  /** 调课覆盖：仅该周生效；null = 常规模板槽 */
  overrideWeek: number | null;
}

export interface Course {
  id: string;
  name: string;
  teacher: string | null;
  location: string | null;
  color: string | null;
  /** 周次范围，如 "1-16"、"1-8,10-16" */
  weeksMask: string;
  weekParity: WeekParity;
  slots: CourseSlot[];
}

/** 新增/编辑/导入共用草稿槽（无 id） */
export interface CourseDraftSlot {
  weekday: number;
  startTime: string;
  endTime: string;
  /** OCR 网格位置；时间未知时仍可在预览里保留课程。 */
  startPeriod?: number;
  endPeriod?: number;
}

/** 新增/编辑/导入共用草稿 */
export interface CourseDraft {
  name: string;
  teacher?: string | null;
  location?: string | null;
  color?: string | null;
  /** 周次范围，如 "1-16"、"1-8,10-16"；缺省 '1-16' */
  weeksMask?: string;
  weekParity?: WeekParity;
  slots: CourseDraftSlot[];
}

export interface SaveCourseInput extends CourseDraft {
  /** null/缺省 = 新建；否则编辑该课程（slots 全量替换常规模板槽） */
  id?: string | null;
}

/** 调课：为某课程在某周新增覆盖槽（该 weekday 的常规槽在该周被覆盖槽替代） */
export interface OverrideSlotInput {
  courseId: string;
  week: number;
  weekday: number;
  startTime: string;
  endTime: string;
}

export async function saveCourse(input: SaveCourseInput): Promise<Course> {
  return invoke<Course>('save_course', { input });
}

export async function deleteCourse(id: string): Promise<void> {
  return invoke<void>('delete_course', { id });
}

export async function listCourses(): Promise<Course[]> {
  return invoke<Course[]>('list_courses');
}

/**
 * 某教学周的实际课表：应用 weeksMask / weekParity 过滤，
 * 并应用调课覆盖（override_week = 该周的槽替代同 weekday 常规槽）。
 * 未设置 semester_start 时后端忽略 mask/parity 全部返回。
 */
export async function getWeekSchedule(week: number): Promise<Course[]> {
  return invoke<Course[]>('get_week_schedule', { week });
}

/** 调课覆盖：创建一条 override 槽 */
export async function overrideSlot(input: OverrideSlotInput): Promise<void> {
  return invoke<void>('override_slot', { input });
}

/** 删除某周某课程的调课覆盖槽 */
export async function clearOverride(courseId: string, week: number): Promise<void> {
  return invoke<void>('clear_override', { courseId, week });
}

/**
 * 解析 Excel(.xlsx/.xls)/CSV 课表文件为草稿（不落库，供预览/校对界面编辑）。
 * bytes 由前端 <input type="file"> 读 ArrayBuffer 后转 number[] 传入。
 * 模板列（首行表头，固定顺序）：课程名,教师,地点,星期,开始时间,结束时间,周次,单双周,颜色
 * 同一课程的多个时间段 = 多行（课程名+教师+地点+周次+单双周 相同的行合并为一个课程）。
 */
export async function parseCoursesFile(
  fileName: string,
  bytes: number[],
): Promise<CourseDraft[]> {
  return invoke<CourseDraft[]>('parse_courses_file', { fileName, bytes });
}

/** 批量落库（导入/AI 校对确认用），返回写入课程数 */
export async function saveCoursesBatch(drafts: CourseDraft[]): Promise<number> {
  return invoke<number>('save_courses_batch', { drafts });
}

/** 订阅 Rust 侧课程写操作后发出的 courses-changed 事件 */
export function onCoursesChanged(cb: () => void): Promise<UnlistenFn> {
  return listen('courses-changed', cb);
}
