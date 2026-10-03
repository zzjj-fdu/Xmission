import { Fragment, useCallback, useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import type { CSSProperties, ChangeEvent } from 'react';
import { activeTheme as pixelJrpg } from '../themes';
import { SectionHeader } from '../components/SectionHeader';
import { QuestPanel } from '../components/QuestPanel';
import { PixelIcon } from '../components/PixelIcon';
import { JrpgButton } from '../components/JrpgButton';
import { PixelInput } from '../components/PixelInput';
import { PixelSelect } from '../components/PixelSelect';
import { CourseDraftTable } from '../components/CourseDraftTable';
import { getSetting, setSetting } from '../api/settings';
import {
  clearOverride,
  deleteCourse,
  getWeekSchedule,
  listCourses,
  onCoursesChanged,
  overrideSlot,
  parseCoursesFile,
  saveCourse,
  saveCoursesBatch,
} from '../api/courses';
import type {
  Course,
  CourseDraft,
  CourseDraftSlot,
  CourseSlot,
  SaveCourseInput,
  WeekParity,
} from '../api/courses';
import { aiFindSchoolPeriods, aiParseScheduleImage, fileToBase64 } from '../api/llm';
import {
  COURSE_COLORS,
  PARITY_OPTIONS,
  WEEKDAY_LABELS,
  isValidWeeksMask,
  parsePeriods,
} from '../components/courseShared';
import type { CoursePeriod } from '../components/courseShared';

const { colors, font } = pixelJrpg;

const DAY_MS = 24 * 60 * 60 * 1000;

const labelStyle: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 4,
  fontSize: 12,
  color: colors.textMuted,
  fontFamily: font.body,
  letterSpacing: '0.1em',
};

/** 伪装成 JrpgButton（primary）的文件选择 label */
const fileButtonStyle: CSSProperties = {
  display: 'inline-block',
  backgroundColor: colors.accent,
  color: colors.xpTrack,
  border: `2px solid ${colors.goldDark}`,
  boxShadow:
    'inset 0 -2px 0 rgba(0, 0, 0, 0.25), inset 0 2px 0 rgba(255, 255, 255, 0.3)',
  fontFamily: font.display,
  fontSize: 12,
  padding: '7px 16px',
  cursor: 'pointer',
  flexShrink: 0,
};

/** 课程块上的迷你操作按钮（调课/恢复），着色块上用深色描边保证可读 */
function miniButtonStyle(onColoredBlock: boolean): CSSProperties {
  return {
    fontSize: 12,
    fontFamily: font.body,
    cursor: 'pointer',
    background: 'transparent',
    border: `1px solid ${onColoredBlock ? colors.xpTrack : colors.goldDark}`,
    color: onColoredBlock ? colors.xpTrack : colors.accent,
    padding: '0 4px',
    flexShrink: 0,
  };
}

function md(d: Date): string {
  return `${d.getMonth() + 1}.${d.getDate()}`;
}

function todayMidnight(): Date {
  const n = new Date();
  return new Date(n.getFullYear(), n.getMonth(), n.getDate());
}

function mondayOf(date: Date): Date {
  const monday = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  monday.setDate(monday.getDate() - ((monday.getDay() + 6) % 7));
  return monday;
}

/** 以自然周周一为边界，计算当前教学周。日期差必须除以 7。 */
function weekOf(semesterStart: string, today: Date): number {
  const start = new Date(`${semesterStart}T00:00:00`);
  if (Number.isNaN(start.getTime())) return NaN;
  const a = mondayOf(start);
  const b = mondayOf(today);
  const utcA = Date.UTC(a.getFullYear(), a.getMonth(), a.getDate());
  const utcB = Date.UTC(b.getFullYear(), b.getMonth(), b.getDate());
  return Math.round((utcB - utcA) / (7 * DAY_MS)) + 1;
}


/* ------------------------------------------------------------------ */
/* 课程表单（添加/编辑共用弹层）                                        */
/* ------------------------------------------------------------------ */

function CourseFormOverlay({
  course,
  periods,
  onClose,
}: {
  /** null = 新建 */
  course: Course | null;
  periods: CoursePeriod[];
  onClose: () => void;
}) {
  const [name, setName] = useState(course?.name ?? '');
  const [teacher, setTeacher] = useState(course?.teacher ?? '');
  const [location, setLocation] = useState(course?.location ?? '');
  const [color, setColor] = useState<string | null>(course?.color ?? null);
  const [weeksMask, setWeeksMask] = useState(course?.weeksMask ?? '1-16');
  const [parity, setParity] = useState<WeekParity>(course?.weekParity ?? 'all');
  // 编辑时只带常规模板槽：override 槽是单周调课产物，saveCourse 会全量替换常规槽
  const [slots, setSlots] = useState<CourseDraftSlot[]>(
    (course?.slots ?? [])
      .filter((s) => s.overrideWeek == null)
      .map((s) => ({ weekday: s.weekday, startTime: s.startTime, endTime: s.endTime })),
  );
  const [quickWd, setQuickWd] = useState<number[]>([]);
  const [quickPd, setQuickPd] = useState<number[]>([]);
  const [maskError, setMaskError] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const toggleNum = (list: number[], n: number): number[] =>
    list.includes(n) ? list.filter((x) => x !== n) : [...list, n];

  /** 快捷添加：weekday 多选 × 节次多选，换算成起止时间（去重） */
  const addQuickSlots = () => {
    const next = [...slots];
    for (const wd of quickWd) {
      for (const pi of quickPd) {
        const p = periods[pi];
        if (!p) continue;
        if (!next.some((s) => s.weekday === wd && s.startTime === p.start)) {
          next.push({ weekday: wd, startTime: p.start, endTime: p.end });
        }
      }
    }
    setSlots(next);
  };

  const updateSlot = (i: number, patch: Partial<CourseDraftSlot>) => {
    setSlots((prev) => prev.map((s, idx) => (idx === i ? { ...s, ...patch } : s)));
  };

  const handleSave = async () => {
    const trimmed = name.trim();
    if (!trimmed) {
      setError('课程名必填');
      return;
    }
    if (!isValidWeeksMask(weeksMask)) {
      setMaskError(true);
      setError('周次范围格式不正确（示例：1-16 或 1-8,10-16）');
      return;
    }
    const input: SaveCourseInput = {
      id: course?.id ?? null,
      name: trimmed,
      teacher: teacher.trim() || null,
      location: location.trim() || null,
      color,
      weeksMask: weeksMask.trim() || '1-16',
      weekParity: parity,
      slots,
    };
    setBusy(true);
    setError(null);
    try {
      await saveCourse(input);
      onClose();
    } catch (err) {
      console.error('[schedule] 保存课程失败', err);
      setError(typeof err === 'string' ? err : '保存失败，请稍后再试');
    } finally {
      setBusy(false);
    }
  };

  const handleDelete = async () => {
    if (!course) return;
    if (!window.confirm(`确定删除课程「${course.name}」吗？`)) return;
    setBusy(true);
    setError(null);
    try {
      await deleteCourse(course.id);
      onClose();
    } catch (err) {
      console.error('[schedule] 删除课程失败', err);
      setError(typeof err === 'string' ? err : '删除失败，请稍后再试');
    } finally {
      setBusy(false);
    }
  };

  return createPortal(
    <div role="dialog" aria-modal="true" aria-label={course ? `编辑课程：${course.name}` : '添加课程'}
      onClick={onClose}
      style={{
        position: 'fixed',
        inset: 0,
        backgroundColor: 'rgba(0, 0, 0, 0.6)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 1000,
        padding: 24,
        boxSizing: 'border-box',
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          backgroundColor: colors.panel,
          border: `2px solid ${colors.accent}`,
          boxShadow: `inset 0 0 0 1px ${colors.goldDark}`,
          padding: 16,
          width: '100%',
          maxWidth: 720,
          maxHeight: '90vh',
          overflowY: 'auto',
          boxSizing: 'border-box',
          fontFamily: font.body,
          fontSize: 12,
          color: colors.text,
        }}
      >
        <div
          style={{
            color: colors.accent,
            fontFamily: font.display,
            fontSize: 12,
            marginBottom: 12,
          }}
        >
          {course ? `编辑课程：${course.name}` : '添加课程'}
        </div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12 }}>
          <label style={{ ...labelStyle, flex: '1 1 180px' }}>
            课程名（必填）
            <PixelInput value={name} onChange={(e) => setName(e.target.value)} required />
          </label>
          <label style={{ ...labelStyle, flex: '1 1 120px' }}>
            教师
            <PixelInput value={teacher} onChange={(e) => setTeacher(e.target.value)} />
          </label>
          <label style={{ ...labelStyle, flex: '1 1 140px' }}>
            地点
            <PixelInput value={location} onChange={(e) => setLocation(e.target.value)} />
          </label>
          <label style={labelStyle}>
            周次范围
            <PixelInput
              style={{ width: 120, borderColor: maskError ? colors.danger : undefined }}
              value={weeksMask}
              placeholder="1-16"
              onChange={(e) => {
                setWeeksMask(e.target.value);
                setMaskError(false);
              }}
              onBlur={() => setMaskError(!isValidWeeksMask(weeksMask))}
            />
          </label>
          <label style={labelStyle}>
            单双周
            <PixelSelect
              value={parity}
              onChange={(e) => setParity(e.target.value as WeekParity)}
            >
              {PARITY_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </PixelSelect>
          </label>
          <label style={labelStyle}>
            颜色
            <span style={{ display: 'flex', gap: 4, flexWrap: 'wrap', alignItems: 'center' }}>
              {COURSE_COLORS.map((c) => (
                <button
                  key={c}
                  type="button"
                  title={c}
                  onClick={() => setColor(c)}
                  style={{
                    width: 16,
                    height: 16,
                    padding: 0,
                    backgroundColor: c,
                    border:
                      color === c
                        ? `2px solid ${colors.text}`
                        : `2px solid ${colors.goldDark}`,
                    cursor: 'pointer',
                  }}
                />
              ))}
              <button
                type="button"
                onClick={() => setColor(null)}
                style={{
                  ...miniButtonStyle(false),
                  padding: '2px 6px',
                  border: `1px solid ${color === null ? colors.text : colors.goldDark}`,
                }}
              >
                默认色
              </button>
            </span>
          </label>
        </div>
        {maskError && (
          <p style={{ color: colors.danger, fontSize: 12, margin: '4px 0 0' }}>
            周次范围格式不正确（示例：1-16 或 1-8,10-16）
          </p>
        )}

        {/* 快捷添加时段：weekday 多选 × 节次多选（按节次模板换算起止时间） */}
        <div style={{ marginTop: 12 }}>
          <div style={{ ...labelStyle, marginBottom: 6 }}>快捷添加时段（星期 × 节次）</div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'center' }}>
            {WEEKDAY_LABELS.map((l, idx) => (
              <button
                key={idx + 1}
                type="button"
                onClick={() => setQuickWd((prev) => toggleNum(prev, idx + 1))}
                style={{
                  ...miniButtonStyle(false),
                  padding: '2px 8px',
                  backgroundColor: quickWd.includes(idx + 1) ? colors.panelLight : 'transparent',
                  color: quickWd.includes(idx + 1) ? colors.accent : colors.textMuted,
                }}
              >
                {l}
              </button>
            ))}
            <span style={{ color: colors.textMuted }}>×</span>
            {periods.map((_, idx) => (
              <button
                key={idx}
                type="button"
                onClick={() => setQuickPd((prev) => toggleNum(prev, idx))}
                style={{
                  ...miniButtonStyle(false),
                  padding: '2px 8px',
                  backgroundColor: quickPd.includes(idx) ? colors.panelLight : 'transparent',
                  color: quickPd.includes(idx) ? colors.accent : colors.textMuted,
                }}
              >
                第{idx + 1}节
              </button>
            ))}
            <JrpgButton
              variant="ghost"
              onClick={addQuickSlots}
              disabled={quickWd.length === 0 || quickPd.length === 0}
            >
              添加所选时段
            </JrpgButton>
          </div>
        </div>

        {/* 时段列表：可直接改时间（等价于不选节次手填） */}
        <div style={{ marginTop: 12, display: 'flex', flexDirection: 'column', gap: 6 }}>
          <div style={{ ...labelStyle }}>上课时段（{slots.length}）</div>
          {slots.length === 0 && (
            <p style={{ color: colors.textMuted, fontSize: 12, margin: 0 }}>
              暂无时段；用上方快捷添加，或手动新增一行
            </p>
          )}
          {slots.map((s, i) => (
            <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
              <PixelSelect
                value={s.weekday}
                onChange={(e) => updateSlot(i, { weekday: Number(e.target.value) })}
              >
                {WEEKDAY_LABELS.map((l, idx) => (
                  <option key={idx + 1} value={idx + 1}>
                    {l}
                  </option>
                ))}
              </PixelSelect>
              <PixelInput
                type="time"
                value={s.startTime}
                onChange={(e) => updateSlot(i, { startTime: e.target.value })}
              />
              <span style={{ color: colors.textMuted, fontSize: 12 }}>~</span>
              <PixelInput
                type="time"
                value={s.endTime}
                onChange={(e) => updateSlot(i, { endTime: e.target.value })}
              />
              <JrpgButton
                variant="danger"
                onClick={() => setSlots((prev) => prev.filter((_, idx) => idx !== i))}
              >
                删除
              </JrpgButton>
            </div>
          ))}
          <div>
            <JrpgButton
              variant="ghost"
              onClick={() =>
                setSlots((prev) => [
                  ...prev,
                  { weekday: 1, startTime: '08:00', endTime: '08:45' },
                ])
              }
            >
              + 手动添加一行
            </JrpgButton>
          </div>
        </div>

        {error && (
          <p style={{ color: colors.danger, fontSize: 12, margin: '12px 0 0' }}>{error}</p>
        )}
        <div style={{ display: 'flex', gap: 8, marginTop: 16 }}>
          <JrpgButton onClick={() => void handleSave()} disabled={busy}>
            {busy ? '保存中…' : '保存'}
          </JrpgButton>
          <JrpgButton variant="ghost" onClick={onClose} disabled={busy}>
            取消
          </JrpgButton>
          {course && (
            <JrpgButton variant="danger" onClick={() => void handleDelete()} disabled={busy}>
              删除课程
            </JrpgButton>
          )}
        </div>
      </div>
    </div>, document.body
  );
}

/* ------------------------------------------------------------------ */
/* 课表页                                                              */
/* ------------------------------------------------------------------ */

export default function SchedulePage() {
  const [loaded, setLoaded] = useState(false);
  const [semesterStart, setSemesterStart] = useState<string | null>(null);
  const [weekOffset, setWeekOffset] = useState(0);
  const [mode, setMode] = useState<'week' | 'template'>('week');
  const [courses, setCourses] = useState<Course[]>([]);
  const [hasAnyCourses, setHasAnyCourses] = useState(false);
  const [allCourses, setAllCourses] = useState<Course[]>([]);
  const [periods, setPeriods] = useState<CoursePeriod[]>([]);
  const [periodsOpen, setPeriodsOpen] = useState(false);
  const [editing, setEditing] = useState<Course | 'new' | null>(null);
  const [overrideTarget, setOverrideTarget] = useState<{
    course: Course;
    slot: CourseSlot;
  } | null>(null);
  const [ovWeekday, setOvWeekday] = useState(1);
  const [ovStart, setOvStart] = useState('08:00');
  const [ovEnd, setOvEnd] = useState('08:45');
  const [ovBusy, setOvBusy] = useState(false);

  // 导入区
  const [importPreview, setImportPreview] = useState<CourseDraft[] | null>(null);
  const [importBusy, setImportBusy] = useState(false);
  const [importError, setImportError] = useState<string | null>(null);
  const [importMsg, setImportMsg] = useState<string | null>(null);
  const [aiBusy, setAiBusy] = useState(false);
  const [aiError, setAiError] = useState<string | null>(null);
  const [aiNeedConfig, setAiNeedConfig] = useState(false);
  const [schoolName, setSchoolName] = useState('');
  const [campusName, setCampusName] = useState('');
  const [schoolConfirmed, setSchoolConfirmed] = useState(false);
  const [schoolBusy, setSchoolBusy] = useState(false);
  const [schoolSearchBusy, setSchoolSearchBusy] = useState(false);
  const [schoolSearchError, setSchoolSearchError] = useState<string | null>(null);
  const [schoolSource, setSchoolSource] = useState<{ title: string; url: string } | null>(null);

  // 进页面读设置：semester_start / course_periods（缺省值由前端兜底）
  useEffect(() => {
    Promise.all([getSetting('semester_start'), getSetting('course_periods'), getSetting('school_name'), getSetting('campus_name'), listCourses()])
      .then(([start, periodsRaw, school, campus, allCourses]) => {
        setSemesterStart(start && start.trim() ? start.trim() : null);
        setPeriods(parsePeriods(periodsRaw));
        setSchoolName(school ?? '');
        setCampusName(campus ?? '');
        setSchoolConfirmed(Boolean(school?.trim()));
        setHasAnyCourses(allCourses.length > 0);
        setAllCourses(allCourses);
        setLoaded(true);
      })
      .catch((err: unknown) => {
        console.error('[schedule] 读取设置失败', err);
        setPeriods(parsePeriods(null));
        setLoaded(true);
      });
  }, []);

  const today = todayMidnight();
  const rawWeek = semesterStart ? weekOf(semesterStart, today) : null;
  const staleSemester = rawWeek != null && (!Number.isFinite(rawWeek) || rawWeek < 1 || rawWeek > 26);
  const currentWeek = !staleSemester && rawWeek != null ? rawWeek : null;
  const viewingWeek = currentWeek != null ? Math.max(1, currentWeek + weekOffset) : 1;
  const weekMonday = useMemo(() => {
    if (currentWeek != null && semesterStart) {
      const start = mondayOf(new Date(`${semesterStart}T00:00:00`));
      return new Date(start.getTime() + (viewingWeek - 1) * 7 * DAY_MS);
    }
    const monday = new Date(today);
    monday.setDate(today.getDate() - ((today.getDay() + 6) % 7) + weekOffset * 7);
    return monday;
  }, [semesterStart, currentWeek, viewingWeek, weekOffset, today.getTime()]);
  const weekSunday = new Date(weekMonday.getTime() + 6 * DAY_MS);
  const todayWeekday = ((today.getDay() + 6) % 7) + 1; // JS 周日=0 → 1~7（周一~周日）
  const isCurrentWeek = weekOffset === 0;

  const reload = useCallback(async () => {
    try {
      const all = await listCourses();
      setAllCourses(all);
      setHasAnyCourses(all.length > 0);
      if (mode === 'week' && currentWeek != null) {
        setCourses(await getWeekSchedule(viewingWeek));
      } else {
        setCourses(all);
      }
    } catch (err) {
      console.error('[schedule] 拉取课程失败', err);
    }
  }, [mode, viewingWeek, currentWeek]);

  useEffect(() => {
    void reload();
  }, [reload]);

  // courses-changed：保存/删除/导入/调课后由后端广播，订阅刷新
  useEffect(() => {
    let unlisten: (() => void) | null = null;
    onCoursesChanged(() => {
      void reload();
    })
      .then((u) => {
        unlisten = u;
      })
      .catch((err: unknown) => {
        console.error('[schedule] 订阅 courses-changed 失败', err);
      });
    return () => {
      unlisten?.();
    };
  }, [reload]);

  /** 节次模板编辑：改动即存 */
  const savePeriods = (next: CoursePeriod[]) => {
    setPeriods(next);
    setImportPreview((drafts) => drafts?.map((draft) => ({
      ...draft,
      slots: draft.slots.map((slot) => {
        if (slot.startPeriod == null || slot.endPeriod == null) return slot;
        const start = next[slot.startPeriod - 1]?.start ?? '';
        const end = next[slot.endPeriod - 1]?.end ?? '';
        return { ...slot, startTime: start < end ? start : '', endTime: start < end ? end : '' };
      }),
    })) ?? null);
    setSetting('course_periods', JSON.stringify(next)).catch((err: unknown) => {
      console.error('[schedule] 保存节次模板失败', err);
    });
  };

  /* ---------- 导入 ---------- */

  const confirmSchool = async () => {
    if (!schoolName.trim()) {
      setImportError('请先填写学校全称，再导入课表');
      return;
    }
    setSchoolBusy(true);
    setImportError(null);
    try {
      await Promise.all([
        setSetting('school_name', schoolName.trim()),
        setSetting('campus_name', campusName.trim()),
      ]);
      setSchoolConfirmed(true);
      setPeriodsOpen(true);
    } catch (err) {
      setImportError(typeof err === 'string' ? err : '保存学校信息失败');
    } finally {
      setSchoolBusy(false);
    }
  };

  const searchSchoolPeriods = async () => {
    if (!schoolConfirmed) {
      setSchoolSearchError('请先在导入区确认学校和校区');
      return;
    }
    setSchoolSearchBusy(true);
    setSchoolSearchError(null);
    try {
      const result = await aiFindSchoolPeriods(schoolName.trim(), campusName.trim());
      await setSetting('course_periods', JSON.stringify(result.periods));
      savePeriods(result.periods);
      if (result.semesterStart) {
        await setSetting('semester_start', result.semesterStart);
        setSemesterStart(result.semesterStart);
        setWeekOffset(0);
      }
      setSchoolSource({ title: result.sourceTitle, url: result.sourceUrl });
    } catch (err) {
      setSchoolSearchError(typeof err === 'string' ? err : '搜索作息表失败，请手动调整');
    } finally {
      setSchoolSearchBusy(false);
    }
  };

  const handleImportFile = (e: ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    e.target.value = '';
    if (!f) return;
    if (!schoolConfirmed) { setImportError('请先确认学校，再导入课表'); return; }
    setImportError(null);
    setImportMsg(null);
    setAiError(null);
    setImportBusy(true);
    void (async () => {
      try {
        const bytes = Array.from(new Uint8Array(await f.arrayBuffer()));
        const drafts = await parseCoursesFile(f.name, bytes);
        if (drafts.length === 0) {
          setImportError('未能从文件中解析出课程，请核对模板列后再试');
          return;
        }
        setImportPreview(drafts);
      } catch (err) {
        console.error('[schedule] 解析课表文件失败', err);
        setImportError(typeof err === 'string' ? err : '解析失败，请检查文件格式');
      } finally {
        setImportBusy(false);
      }
    })();
  };

  const handleAiFile = (e: ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    e.target.value = '';
    if (!f) return;
    if (!schoolConfirmed) { setAiError('请先确认学校，再识别课表'); return; }
    setAiError(null);
    setAiNeedConfig(false);
    setImportError(null);
    setImportMsg(null);
    setAiBusy(true);
    void (async () => {
      try {
        const base64 = await fileToBase64(f);
        const drafts = await aiParseScheduleImage(f.name, base64);
        if (drafts.length === 0) {
          setAiError('未识别到课程，请换一张更清晰的课表截图');
          return;
        }
        setImportPreview(drafts);
      } catch (err) {
        console.error('[schedule] AI 截图识别失败', err);
        const msg = typeof err === 'string' ? err : '识别失败，请稍后再试';
        setAiError(msg);
        if (msg.includes('未配置')) setAiNeedConfig(true);
      } finally {
        setAiBusy(false);
      }
    })();
  };

  const downloadTemplate = () => {
    const csv =
      '﻿课程名,教师,地点,星期,开始时间,结束时间,周次,单双周,颜色\n' +
      '高等数学,张三,一教101,周一,08:00,09:40,1-16,每周,#e05c5c\n' +
      '大学英语,李四,二教202,周三,10:00,11:40,1-16,单周,#4ade80\n';
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = '课表模板.csv';
    a.click();
    URL.revokeObjectURL(url);
  };

  const confirmImport = () => {
    if (!importPreview) return;
    setImportBusy(true);
    setImportError(null);
    void (async () => {
      try {
        const signature = (c: Pick<CourseDraft, 'name' | 'teacher' | 'location' | 'weeksMask' | 'weekParity' | 'slots'>) =>
          `${c.name.trim().toLowerCase()}|${c.teacher?.trim() ?? ''}|${c.location?.trim() ?? ''}|${c.weeksMask ?? '1-16'}|${c.weekParity ?? 'all'}|${c.slots.map((s) => `${s.weekday}:${s.startTime}-${s.endTime}`).sort().join(',')}`;
        const existing = new Set(allCourses.map((c) => signature({ ...c, slots: c.slots.filter((s) => s.overrideWeek == null) })));
        const novel = importPreview.filter((d) => !existing.has(signature(d)));
        const skipped = importPreview.length - novel.length;
        if (novel.length === 0) {
          setImportError('这些课程已经在课表里，没有重复写入。');
          return;
        }
        const n = await saveCoursesBatch(novel);
        setImportPreview(null);
        setImportMsg(`成功导入 ${n} 门课${skipped > 0 ? `，跳过 ${skipped} 门重复课程` : ''}`);
      } catch (err) {
        console.error('[schedule] 批量导入失败', err);
        setImportError(typeof err === 'string' ? err : '导入失败，请稍后再试');
      } finally {
        setImportBusy(false);
      }
    })();
  };

  /* ---------- 调课 ---------- */

  const openOverride = (course: Course, slot: CourseSlot) => {
    setOverrideTarget({ course, slot });
    setOvWeekday(slot.weekday);
    setOvStart(slot.startTime);
    setOvEnd(slot.endTime);
  };

  const submitOverride = () => {
    if (!overrideTarget) return;
    setOvBusy(true);
    void (async () => {
      try {
        await overrideSlot({
          courseId: overrideTarget.course.id,
          week: viewingWeek,
          weekday: ovWeekday,
          startTime: ovStart,
          endTime: ovEnd,
        });
        setOverrideTarget(null);
      } catch (err) {
        console.error('[schedule] 调课失败', err);
        window.alert(typeof err === 'string' ? err : '调课失败，请稍后再试');
      } finally {
        setOvBusy(false);
      }
    })();
  };

  const restoreOverride = (courseId: string) => {
    void clearOverride(courseId, viewingWeek).catch((err: unknown) => {
      console.error('[schedule] 恢复原时间失败', err);
    });
  };

  /* ---------- 周视图网格数据 ---------- */

  interface Placed {
    course: Course;
    slot: CourseSlot;
  }

  // 按 startTime 匹配节次行；匹配不到的进「其他时段」
  const { grid, others } = useMemo(() => {
    const grid: Placed[][][] = periods.map(() =>
      Array.from({ length: 7 }, () => [] as Placed[]),
    );
    const others: Placed[] = [];
    for (const c of courses) {
      for (const s of c.slots) {
        const pi = periods.findIndex((p) => p.start === s.startTime);
        if (pi >= 0 && s.weekday >= 1 && s.weekday <= 7) {
          grid[pi]?.[s.weekday - 1]?.push({ course: c, slot: s });
        } else {
          others.push({ course: c, slot: s });
        }
      }
    }
    // 连续节次属于同一门课时合成一张跨行卡片，保留首节作为编辑和调课入口。
    for (let wd = 0; wd < 7; wd++) {
      for (let pi = 0; pi < periods.length; pi++) {
        for (const item of grid[pi][wd]) {
          let end = periods.findIndex((period) => period.end === item.slot.endTime);
          while (end >= pi && end + 1 < periods.length) {
            const nextRow = grid[end + 1][wd];
            const nextIndex = nextRow.findIndex((next) => next.course.id === item.course.id && next.slot.overrideWeek === item.slot.overrideWeek);
            if (nextIndex < 0) break;
            const [next] = nextRow.splice(nextIndex, 1);
            item.slot = { ...item.slot, endTime: next.slot.endTime };
            end = periods.findIndex((period) => period.end === next.slot.endTime);
          }
        }
      }
    }
    return { grid, others };
  }, [courses, periods]);

  const occupiedRows = periods.map((_, pi) => grid.some((row, start) => start <= pi && row.some((day) => day.some(({ slot }) => {
    const end = periods.findIndex((period) => period.end === slot.endTime);
    return end >= pi;
  }))));

  const renderBlock = ({ course, slot }: Placed, key: string) => {
    const colored = course.color != null;
    const textColor = colored ? colors.xpTrack : colors.text;
    const isOverride = slot.overrideWeek != null;
    return (
      <div
        key={key}
        className="xm-course-block"
        onClick={() => setEditing(course)}
        title={`${course.name}${course.teacher ? ` · ${course.teacher}` : ''}`}
        style={{
          backgroundColor: course.color ?? 'var(--xm-course-surface)',
          border: `1px solid ${colors.goldDark}`,
          padding: 4,
          cursor: 'pointer',
          color: textColor,
          fontSize: 12,
          fontFamily: font.body,
          minWidth: 0,
          overflow: 'hidden',
        }}
      >
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 4,
            minWidth: 0,
          }}
        >
          <PixelIcon name="book" size={16} />
          <span
            style={{
              flex: 1,
              minWidth: 0,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            {course.name}
          </span>
          {isOverride && (
            <span
              style={{
                flexShrink: 0,
                border: `1px solid ${colored ? colors.xpTrack : colors.accent}`,
                color: colored ? colors.xpTrack : colors.accent,
                padding: '0 2px',
                fontSize: 12,
                lineHeight: 1.2,
              }}
            >
              已调
            </span>
          )}
        </div>
        {course.location && (
          <div
            style={{
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
              opacity: 0.85,
            }}
          >
            {course.location}
          </div>
        )}
        {/* 调课操作：仅本周视图（模板编辑态是全局模板，不提供单周调课） */}
        {mode === 'week' && (
          <div style={{ display: 'flex', gap: 4, marginTop: 2 }}>
            {isOverride ? (
              <button
                type="button"
                style={miniButtonStyle(colored)}
                onClick={(e) => {
                  e.stopPropagation();
                  restoreOverride(course.id);
                }}
              >
                恢复原时间
              </button>
            ) : (
              <button
                type="button"
                style={miniButtonStyle(colored)}
                onClick={(e) => {
                  e.stopPropagation();
                  openOverride(course, slot);
                }}
              >
                调课
              </button>
            )}
          </div>
        )}
      </div>
    );
  };

  const cellBorder = (isToday: boolean): string =>
    isToday ? `2px solid ${colors.accent}` : `1px solid ${colors.goldDark}`;

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
        <PixelIcon name="book" size={24} />
        课表
      </h1>

      <div style={{ display: 'flex', flexDirection: 'column' }}>
      {/* 导入区：Excel/CSV、AI 截图识别、模板下载 */}
      <div style={{ order: hasAnyCourses ? 2 : 0, marginTop: hasAnyCourses ? 16 : 0 }}>
      <QuestPanel>
        <SectionHeader>{hasAnyCourses ? '添加或重新导入课表' : '先确认学校，再导入课表'}</SectionHeader>
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'flex-end', marginBottom: 14 }}>
          <label style={{ ...labelStyle, flex: '1 1 210px' }}>学校全称
            <PixelInput value={schoolName} placeholder="例如：XX 大学" onChange={(e) => { setSchoolName(e.target.value); setSchoolConfirmed(false); }} />
          </label>
          <label style={{ ...labelStyle, flex: '1 1 140px' }}>校区 / 特殊作息（可选）
            <PixelInput value={campusName} placeholder="例如：南校区" onChange={(e) => { setCampusName(e.target.value); setSchoolConfirmed(false); }} />
          </label>
          <JrpgButton onClick={() => void confirmSchool()} disabled={schoolBusy || !schoolName.trim()}>
            {schoolBusy ? '确认中…' : schoolConfirmed ? '✓ 已确认学校' : '确认学校'}
          </JrpgButton>
        </div>
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'center' }}>
          <label style={{ ...fileButtonStyle, opacity: schoolConfirmed ? 1 : .45, cursor: schoolConfirmed ? 'pointer' : 'not-allowed' }}>
            导入 Excel/CSV
            <input
              type="file"
              accept=".xlsx,.xls,.csv"
              disabled={!schoolConfirmed}
              onChange={handleImportFile}
              style={{ display: 'none' }}
            />
          </label>
          <label style={{ ...fileButtonStyle, opacity: schoolConfirmed ? 1 : .45, cursor: schoolConfirmed ? 'pointer' : 'not-allowed' }}>
            AI 截图识别
            <input
              type="file"
              accept="image/*"
              disabled={!schoolConfirmed}
              onChange={handleAiFile}
              style={{ display: 'none' }}
            />
          </label>
          <JrpgButton variant="ghost" onClick={downloadTemplate}>
            下载模板
          </JrpgButton>
          {importBusy && (
            <span style={{ color: colors.textMuted, fontSize: 12 }}>解析中…</span>
          )}
          {aiBusy && <span style={{ color: colors.textMuted, fontSize: 12 }}>识别中…</span>}
        </div>
        <p style={{ color: colors.textMuted, fontSize: 12, margin: '8px 0 0', lineHeight: 1.8 }}>
          Excel/CSV 需按模板列（课程名,教师,地点,星期,开始时间,结束时间,周次,单双周,颜色）；
          AI 识别支持课表截图，两种来源都会先进入校对表格，确认后才写入。
        </p>
        {importError && (
          <p style={{ color: colors.danger, fontSize: 12, margin: '8px 0 0' }}>{importError}</p>
        )}
        {aiError && (
          <p style={{ color: colors.danger, fontSize: 12, margin: '8px 0 0' }}>
            {aiError}
            {aiNeedConfig && '（请先到「设置」页配置 LLM 后再试）'}
          </p>
        )}
        {importMsg && (
          <p style={{ color: colors.accentAlt, fontSize: 12, margin: '8px 0 0' }}>{importMsg}</p>
        )}
        {importPreview && (
          <CourseDraftTable
            drafts={importPreview}
            periods={periods}
            onChange={setImportPreview}
            onConfirm={confirmImport}
            onAdjustPeriods={() => {
              setPeriodsOpen(true);
              requestAnimationFrame(() => document.getElementById('xm-period-settings')?.scrollIntoView({ behavior: 'smooth', block: 'start' }));
            }}
            onCancel={() => setImportPreview(null)}
            busy={importBusy}
          />
        )}
      </QuestPanel>
      </div>

      {/* 周视图 */}
      <div style={{ order: 1 }}>
      <QuestPanel>
        {/* 周切换条 + 模式切换 */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            flexWrap: 'wrap',
            marginBottom: 12,
          }}
        >
          {mode === 'week' && (
            <>
              <JrpgButton
                variant="ghost"
                onClick={() => setWeekOffset((v) => v - 1)}
                title="上一周"
              >
                ◀ 上一周
              </JrpgButton>
              <span
                style={{
                  color: colors.accent,
                  fontFamily: font.display,
                  fontSize: 12,
                  whiteSpace: 'nowrap',
                }}
              >
                {currentWeek != null ? `第 ${viewingWeek} 周` : weekOffset === 0 ? '本周' : `相差 ${weekOffset > 0 ? '+' : ''}${weekOffset} 周`}
                {`（${md(weekMonday)}~${md(weekSunday)}）`}
              </span>
              <JrpgButton
                variant="ghost"
                onClick={() => setWeekOffset((v) => v + 1)}
                title="下一周"
              >
                下一周 ▶
              </JrpgButton>
              <JrpgButton
                variant="ghost"
                onClick={() => setWeekOffset(0)}
                disabled={weekOffset === 0}
              >
                回到本周
              </JrpgButton>
            </>
          )}
          {mode === 'week' && currentWeek == null && loaded && (
            <span
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                flexWrap: 'wrap',
                color: colors.textMuted,
                fontSize: 12,
              }}
            >
              {staleSemester ? '旧开学日期已超出本学期，当前按今天所在周显示全部课程。请确认本学期开学日期：' : '设置本学期开学日期后，即可按教学周筛选课程：'}
              <PixelInput
                type="date"
                value={staleSemester ? '' : semesterStart ?? ''}
                onChange={(e) => {
                  const v = e.target.value;
                  setSemesterStart(v || null);
                  setWeekOffset(0);
                  setSetting('semester_start', v).catch((err: unknown) => {
                    console.error('[schedule] 保存开学日期失败', err);
                  });
                }}
              />
            </span>
          )}
          {mode === 'template' && (
            <span style={{ color: colors.textMuted, fontSize: 12 }}>
              模板编辑：这里修改的是每周重复的常规模板，不受周次/单双周/调课影响
            </span>
          )}
          <span style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
            <JrpgButton
              variant={mode === 'week' ? 'primary' : 'ghost'}
              onClick={() => setMode('week')}
            >
              本周视图
            </JrpgButton>
            <JrpgButton
              variant={mode === 'template' ? 'primary' : 'ghost'}
              onClick={() => setMode('template')}
            >
              模板编辑
            </JrpgButton>
            <JrpgButton onClick={() => setEditing('new')}>添加课程</JrpgButton>
          </span>
        </div>

        {/* 节次模板编辑（可折叠，改动即存） */}
        <div id="xm-period-settings" style={{ marginBottom: 12 }}>
          <JrpgButton variant="ghost" onClick={() => setPeriodsOpen((v) => !v)}>
            {periodsOpen ? '调整时间 ▾' : '调整时间 ▸'}
          </JrpgButton>
          {periodsOpen && (
            <div
              style={{
                marginTop: 8,
                border: `1px solid ${colors.goldDark}`,
                padding: 8,
                display: 'flex',
                flexDirection: 'column',
                gap: 6,
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 8 }}>
                <PixelIcon name="calendar" size={22} />
                <label style={{ ...labelStyle, flex: '1 1 170px' }}>学校全称
                  <PixelInput value={schoolName} placeholder="填写学校全称" onChange={(e) => { setSchoolName(e.target.value); setSchoolConfirmed(false); }} />
                </label>
                <label style={{ ...labelStyle, flex: '1 1 120px' }}>校区（可选）
                  <PixelInput value={campusName} placeholder="校区" onChange={(e) => { setCampusName(e.target.value); setSchoolConfirmed(false); }} />
                </label>
                <JrpgButton variant="ghost" onClick={() => void confirmSchool()} disabled={schoolBusy || !schoolName.trim()}>
                  {schoolConfirmed ? '✓ 已确认' : '确认学校'}
                </JrpgButton>
                <JrpgButton onClick={() => void searchSchoolPeriods()} disabled={schoolSearchBusy || !schoolConfirmed}>
                  {schoolSearchBusy ? '正在查找学校作息…' : '查找学校官网作息并自动应用'}
                </JrpgButton>
              </div>
              {schoolSource && <p style={{ color: colors.accentAlt, fontSize: 12, margin: '0 0 8px' }}>
                已应用 {periods.length} 节 · 来源：<a href={schoolSource.url} target="_blank" rel="noreferrer" style={{ color: colors.accentAlt }}>{schoolSource.title || schoolSource.url}</a>
              </p>}
              {schoolSearchError && <p style={{ color: colors.danger, fontSize: 12, margin: '0 0 8px' }}>{schoolSearchError}</p>}
              <p style={{ color: colors.textMuted, fontSize: 12, margin: '0 0 8px' }}>也可以直接修改下方每一节的起止时间，改动会自动保存。</p>
              {periods.map((p, i) => (
                <div
                  key={i}
                  style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}
                >
                  <span
                    style={{
                      color: colors.textMuted,
                      fontSize: 12,
                      width: 48,
                      flexShrink: 0,
                    }}
                  >
                    第{i + 1}节
                  </span>
                  <PixelInput
                    type="time"
                    value={p.start}
                    onChange={(e) =>
                      savePeriods(
                        periods.map((x, idx) =>
                          idx === i ? { ...x, start: e.target.value } : x,
                        ),
                      )
                    }
                  />
                  <span style={{ color: colors.textMuted, fontSize: 12 }}>~</span>
                  <PixelInput
                    type="time"
                    value={p.end}
                    onChange={(e) =>
                      savePeriods(
                        periods.map((x, idx) => (idx === i ? { ...x, end: e.target.value } : x)),
                      )
                    }
                  />
                  <JrpgButton
                    variant="danger"
                    onClick={() => savePeriods(periods.filter((_, idx) => idx !== i))}
                  >
                    删除
                  </JrpgButton>
                </div>
              ))}
              <div>
                <JrpgButton
                  variant="ghost"
                  onClick={() => {
                    const last = periods[periods.length - 1];
                    const start = last ? last.end : '08:00';
                    savePeriods([...periods, { start, end: last ? last.end : '08:45' }]);
                  }}
                >
                  + 添加节次
                </JrpgButton>
              </div>
            </div>
          )}
        </div>

        {/* 网格：左列节次，顶部周一~周日（当天列金色高亮边） */}
        {!loaded ? (
          <p style={{ color: colors.textMuted, margin: 0, fontSize: 12 }}>加载中…</p>
        ) : (
          <div
            className="xm-schedule-grid"
            style={{
              display: 'grid',
              gridTemplateColumns: `72px repeat(7, minmax(0, 1fr))`,
              gridTemplateRows: `auto ${occupiedRows.map((occupied) => `minmax(${occupied ? 56 : 32}px, auto)`).join(' ')}`,
              overflowX: 'auto',
            }}
          >
            <div
              className="xm-schedule-head"
              style={{
                border: `1px solid ${colors.goldDark}`,
                padding: 4,
                color: colors.textMuted,
                fontSize: 12,
                fontFamily: font.display,
                gridColumn: 1,
                gridRow: 1,
              }}
            >
              节次
            </div>
            {WEEKDAY_LABELS.map((l, idx) => {
              const isToday = mode === 'week' && isCurrentWeek && todayWeekday === idx + 1;
              const d = weekMonday
                ? new Date(weekMonday.getTime() + idx * DAY_MS)
                : null;
              return (
                <div
                  key={l}
                  className="xm-schedule-head"
                  style={{
                    border: cellBorder(isToday),
                    padding: 4,
                    display: 'flex',
                    justifyContent: 'center',
                    alignItems: 'center',
                    gap: 3,
                    color: isToday ? colors.accent : colors.textMuted,
                    fontSize: 12,
                    fontFamily: font.display,
                    textAlign: 'center',
                    whiteSpace: 'nowrap',
                    gridColumn: idx + 2,
                    gridRow: 1,
                  }}
                >
                  {isToday && <PixelIcon name="star" size={14} />}
                  {l}
                  {mode === 'week' && d && (
                    <span style={{ marginLeft: 4, color: colors.textMuted }}>{md(d)}</span>
                  )}
                </div>
              );
            })}
            {periods.map((p, pi) => (
              <Fragment key={`row-${pi}`}>
                <div
                  className="xm-schedule-period"
                  title={`第${pi + 1}节 ${p.start}-${p.end}`}
                  style={{
                    border: `1px solid ${colors.goldDark}`,
                    padding: occupiedRows[pi] ? 4 : 2,
                    color: colors.textMuted,
                    fontSize: occupiedRows[pi] ? 12 : 10,
                    fontFamily: font.body,
                    whiteSpace: 'nowrap',
                    gridColumn: 1,
                    gridRow: pi + 2,
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: 3 }}><PixelIcon name="hourglass" size={14} />第{pi + 1}节</div>
                  {occupiedRows[pi] && <div style={{ fontSize: 12 }}>{p.start}-{p.end}</div>}
                </div>
                {Array.from({ length: 7 }, (_, wd) => {
                  const isToday = mode === 'week' && isCurrentWeek && todayWeekday === wd + 1;
                  const items = grid[pi]?.[wd] ?? [];
                  return (
                    <div
                      key={`c-${pi}-${wd}`}
                      className="xm-schedule-slot"
                      style={{
                        border: cellBorder(isToday),
                        padding: 2,
                        display: 'flex',
                        flexDirection: 'column',
                        gap: 2,
                        minWidth: 0,
                        minHeight: occupiedRows[pi] ? 40 : 24,
                        backgroundColor:
                          isToday && mode === 'week' ? colors.panel : 'var(--xm-grid-cell)',
                        gridColumn: wd + 2,
                        gridRow: pi + 2,
                      }}
                    >
                      {items.length > 0 && <span className="xm-schedule-slot-mark" aria-hidden="true" />}
                    </div>
                  );
                })}
              </Fragment>
            ))}
            {grid.flatMap((row, pi) => row.flatMap((items, wd) => {
              if (items.length === 0) return [];
              const endRow = Math.max(pi, ...items.map(({ slot }) => {
                const index = periods.findIndex((p) => p.end === slot.endTime);
                return index >= pi ? index : pi;
              }));
              return [<div
                key={`block-${pi}-${wd}`}
                className="xm-schedule-overlay"
                style={{ gridColumn: wd + 2, gridRow: `${pi + 2} / span ${endRow - pi + 1}` }}
              >
                {items.map((it) => renderBlock(it, `${it.course.id}:${it.slot.id}`))}
              </div>];
            }))}
          </div>
        )}

        {/* 匹配不到节次的课程时段 */}
        {loaded && others.length > 0 && (
          <div style={{ marginTop: 12 }}>
            <SectionHeader muted>其他时段（未匹配节次模板）</SectionHeader>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
              {others.map((it) => (
                <div key={`${it.course.id}:${it.slot.id}`} style={{ minWidth: 0 }}>
                  <div style={{ color: colors.textMuted, fontSize: 12, marginBottom: 2 }}>
                    {WEEKDAY_LABELS[it.slot.weekday - 1] ?? `周${it.slot.weekday}`}{' '}
                    {it.slot.startTime}-{it.slot.endTime}
                  </div>
                  {renderBlock(it, `o-${it.course.id}:${it.slot.id}`)}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* 调课表单（仅当前查看周生效） */}
        {overrideTarget && (
          <div
            style={{
              marginTop: 12,
              border: `1px solid ${colors.accent}`,
              padding: 12,
              display: 'flex',
              flexWrap: 'wrap',
              gap: 12,
              alignItems: 'flex-end',
            }}
          >
            <span style={{ ...labelStyle, flexDirection: 'row', alignItems: 'center' }}>
              调课：{overrideTarget.course.name}（原{' '}
              {WEEKDAY_LABELS[overrideTarget.slot.weekday - 1] ?? ''}{' '}
              {overrideTarget.slot.startTime}-{overrideTarget.slot.endTime}，仅第 {viewingWeek}{' '}
              周生效）
            </span>
            <label style={labelStyle}>
              新星期
              <PixelSelect
                value={ovWeekday}
                onChange={(e) => setOvWeekday(Number(e.target.value))}
              >
                {WEEKDAY_LABELS.map((l, idx) => (
                  <option key={idx + 1} value={idx + 1}>
                    {l}
                  </option>
                ))}
              </PixelSelect>
            </label>
            <label style={labelStyle}>
              开始
              <PixelInput
                type="time"
                value={ovStart}
                onChange={(e) => setOvStart(e.target.value)}
              />
            </label>
            <label style={labelStyle}>
              结束
              <PixelInput
                type="time"
                value={ovEnd}
                onChange={(e) => setOvEnd(e.target.value)}
              />
            </label>
            <JrpgButton onClick={submitOverride} disabled={ovBusy}>
              {ovBusy ? '提交中…' : '确认调课'}
            </JrpgButton>
            <JrpgButton variant="ghost" onClick={() => setOverrideTarget(null)} disabled={ovBusy}>
              取消
            </JrpgButton>
          </div>
        )}
      </QuestPanel>
      </div>
      </div>

      {editing != null && (
        <CourseFormOverlay
          course={editing === 'new' ? null : editing}
          periods={periods}
          onClose={() => setEditing(null)}
        />
      )}
    </div>
  );
}
