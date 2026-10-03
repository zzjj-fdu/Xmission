import { activeTheme as pixelJrpg } from '../themes';
import { JrpgButton } from './JrpgButton';
import { PixelInput } from './PixelInput';
import { PixelSelect } from './PixelSelect';
import type { CourseDraft, WeekParity } from '../api/courses';
import type { CoursePeriod } from './courseShared';
import {
  COURSE_COLORS,
  PARITY_OPTIONS,
  WEEKDAY_LABELS,
  isValidWeeksMask,
} from './courseShared';

const { colors, font } = pixelJrpg;

const labelStyle = {
  display: 'flex',
  flexDirection: 'column',
  gap: 4,
  fontSize: 12,
  color: colors.textMuted,
  fontFamily: font.body,
  letterSpacing: '0.1em',
} as const;

export interface CourseDraftTableProps {
  drafts: CourseDraft[];
  onChange: (drafts: CourseDraft[]) => void;
  onConfirm: () => void;
  onCancel: () => void;
  busy?: boolean;
  periods?: CoursePeriod[];
  onAdjustPeriods?: () => void;
}

/**
 * 导入校对表格（Excel/CSV 解析与 AI 截图识别共用）：
 * 每行 = 一门课程草稿，单元格全部可编辑，行可删除，时段列表可增删改。
 * 确认前不落库；确认时由父组件调 saveCoursesBatch。
 */
export function CourseDraftTable({
  drafts,
  onChange,
  onConfirm,
  onCancel,
  busy = false,
  periods = [],
  onAdjustPeriods,
}: CourseDraftTableProps) {
  const update = (i: number, patch: Partial<CourseDraft>) => {
    onChange(drafts.map((d, idx) => (idx === i ? { ...d, ...patch } : d)));
  };
  const removeRow = (i: number) => {
    onChange(drafts.filter((_, idx) => idx !== i));
  };
  const updateSlot = (
    i: number,
    si: number,
    patch: Partial<CourseDraft['slots'][number]>,
  ) => {
    const d = drafts[i];
    if (!d) return;
    update(i, {
      slots: d.slots.map((s, idx) => (idx === si ? { ...s, ...patch } : s)),
    });
  };
  const removeSlot = (i: number, si: number) => {
    const d = drafts[i];
    if (!d) return;
    update(i, { slots: d.slots.filter((_, idx) => idx !== si) });
  };
  const addSlot = (i: number) => {
    const d = drafts[i];
    if (!d) return;
    const first = periods[0] ?? { start: '08:00', end: '08:45' };
    update(i, {
      slots: [...d.slots, { weekday: 1, startTime: first.start, endTime: first.end }],
    });
  };

  const problems = drafts.map((d) => {
    const issues: string[] = [];
    if (!d.name.trim()) issues.push('课程名为空');
    if (!isValidWeeksMask(d.weeksMask ?? '1-16')) issues.push('周次格式不正确');
    if (d.slots.length === 0) issues.push('没有上课时段');
    if (d.slots.some((s) => !s.startTime || !s.endTime || s.startTime >= s.endTime || s.weekday < 1 || s.weekday > 7)) issues.push('时段起止或星期有误');
    return issues;
  });
  const problemCount = problems.filter((x) => x.length > 0).length;
  const unresolvedPeriods = drafts.flatMap((d) => d.slots)
    .filter((s) => s.startPeriod != null && (!s.startTime || !s.endTime));
  const highestPeriod = Math.max(0, ...unresolvedPeriods.map((s) => s.endPeriod ?? 0));

  return (
    <div style={{ marginTop: 12, border: `1px solid ${colors.goldDark}`, padding: 8 }}>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          flexWrap: 'wrap',
          marginBottom: 8,
          color: colors.accent,
          fontFamily: font.display,
          fontSize: 12,
        }}
      >
        预览校对 · {drafts.length} 门课 · {drafts.reduce((n, d) => n + d.slots.length, 0)} 个时段
        {problemCount > 0 && <span style={{ color: colors.danger }}> · {problemCount} 门需要修正</span>}
      </div>
      {unresolvedPeriods.length > 0 && (
        <div className="xm-import-period-notice">
          <strong>识别到了 {unresolvedPeriods.length} 个还没有时间的上课格</strong>
          <span>截图包含第 {highestPeriod} 节，当前作息只设置了 {periods.length} 节。课程已保留；请先补齐学校作息，确认时间后再导入。</span>
          {onAdjustPeriods && <JrpgButton variant="ghost" onClick={onAdjustPeriods}>调整节次时间</JrpgButton>}
        </div>
      )}
      {drafts.length === 0 ? (
        <p style={{ color: colors.textMuted, fontSize: 12, margin: '0 0 8px' }}>
          所有行已删除，没有可导入的课程
        </p>
      ) : (
        drafts.map((d, i) => {
          const maskBad = !isValidWeeksMask(d.weeksMask ?? '');
          return (
            <div
              key={i}
              style={{
                borderTop: `1px solid ${colors.goldDark}`,
                padding: '8px 0',
              }}
            >
              {problems[i]?.length > 0 && <p style={{ color: colors.danger, fontSize: 12, margin: '0 0 8px' }}>
                第 {i + 1} 门：{problems[i].join('、')}
              </p>}
              <div
                style={{
                  display: 'flex',
                  flexWrap: 'wrap',
                  gap: 10,
                  alignItems: 'flex-end',
                }}
              >
                <label style={{ ...labelStyle, flex: '1 1 160px' }}>
                  课程名
                  <PixelInput
                    value={d.name}
                    onChange={(e) => update(i, { name: e.target.value })}
                  />
                </label>
                <label style={{ ...labelStyle, flex: '1 1 100px' }}>
                  教师
                  <PixelInput
                    value={d.teacher ?? ''}
                    onChange={(e) => update(i, { teacher: e.target.value || null })}
                  />
                </label>
                <label style={{ ...labelStyle, flex: '1 1 120px' }}>
                  地点
                  <PixelInput
                    value={d.location ?? ''}
                    onChange={(e) => update(i, { location: e.target.value || null })}
                  />
                </label>
                <label style={labelStyle}>
                  周次
                  <PixelInput
                    style={{
                      width: 100,
                      borderColor: maskBad ? colors.danger : undefined,
                    }}
                    value={d.weeksMask ?? '1-16'}
                    placeholder="1-16"
                    title={maskBad ? '格式示例：1-16 或 1-8,10-16' : undefined}
                    onChange={(e) => update(i, { weeksMask: e.target.value })}
                  />
                </label>
                <label style={labelStyle}>
                  单双周
                  <PixelSelect
                    value={d.weekParity ?? 'all'}
                    onChange={(e) =>
                      update(i, { weekParity: e.target.value as WeekParity })
                    }
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
                  <span style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                    {COURSE_COLORS.map((c) => (
                      <button
                        key={c}
                        type="button"
                        title={c}
                        onClick={() => update(i, { color: c })}
                        style={{
                          width: 16,
                          height: 16,
                          padding: 0,
                          backgroundColor: c,
                          border:
                            (d.color ?? null) === c
                              ? `2px solid ${colors.text}`
                              : `2px solid ${colors.goldDark}`,
                          cursor: 'pointer',
                        }}
                      />
                    ))}
                  </span>
                </label>
                <JrpgButton variant="danger" onClick={() => removeRow(i)}>
                  删除行
                </JrpgButton>
              </div>
              {maskBad && (
                <p style={{ color: colors.danger, fontSize: 12, margin: '4px 0 0' }}>
                  周次范围格式不正确（示例：1-16 或 1-8,10-16）
                </p>
              )}
              {/* 时段列表：weekday + 起止时间，可增删 */}
              <div
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 6,
                  marginTop: 8,
                }}
              >
                {d.slots.map((s, si) => (
                  <div
                    key={si}
                    style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}
                  >
                    {s.startPeriod != null && <span className="xm-import-period-tag">第 {s.startPeriod}{s.endPeriod !== s.startPeriod ? `–${s.endPeriod}` : ''} 节</span>}
                    <PixelSelect
                      value={s.weekday}
                      onChange={(e) =>
                        updateSlot(i, si, { weekday: Number(e.target.value) })
                      }
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
                      onChange={(e) => updateSlot(i, si, { startTime: e.target.value, startPeriod: undefined, endPeriod: undefined })}
                    />
                    <span style={{ color: colors.textMuted, fontSize: 12 }}>~</span>
                    <PixelInput
                      type="time"
                      value={s.endTime}
                      onChange={(e) => updateSlot(i, si, { endTime: e.target.value, startPeriod: undefined, endPeriod: undefined })}
                    />
                    <JrpgButton variant="danger" onClick={() => removeSlot(i, si)}>
                      删除
                    </JrpgButton>
                  </div>
                ))}
                <div>
                  <JrpgButton variant="ghost" onClick={() => addSlot(i)}>
                    + 添加时段
                  </JrpgButton>
                </div>
              </div>
            </div>
          );
        })
      )}
      <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
        <JrpgButton onClick={onConfirm} disabled={busy || drafts.length === 0 || problemCount > 0}>
          {busy ? '导入中…' : `确认导入 ${drafts.length} 门课`}
        </JrpgButton>
        <JrpgButton variant="ghost" onClick={onCancel} disabled={busy}>
          取消
        </JrpgButton>
      </div>
    </div>
  );
}
