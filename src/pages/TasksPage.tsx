import { FormEvent, useCallback, useEffect, useMemo, useState } from 'react'
import type { CSSProperties } from 'react'
import { useTasksStore } from '../store/tasks'
import type { CreateTaskInput, Task } from '../api/tasks'
import { isRecurring, recurringDueToday } from '../api/tasks'
import { getRankedToday } from '../api/scheduler'
import type { RankedTask } from '../api/scheduler'
import { getSetting } from '../api/settings'
import { listSteps, onStepsChanged, addStep } from '../api/steps'
import { getLlmConfig } from '../api/llm'
import {
  aiParseTask,
  aiClassifyIcon,
  aiDecomposeTask,
  isLlmNotConfigured,
} from '../api/ai'
import type { StepDraft, TaskDraft } from '../api/ai'
import { QuestPanel } from '../components/QuestPanel'
import { NotesEditor } from '../components/NotesEditor'
import { PixelIcon, taskIcon, TASK_CATEGORIES } from '../components/PixelIcon'
import type { PixelIconName } from '../components/PixelIcon'
import { JrpgButton } from '../components/JrpgButton'
import { PixelInput } from '../components/PixelInput'
import { PixelSelect } from '../components/PixelSelect'
import { StepsPanel } from '../components/StepsPanel'
import { activeTheme as pixelJrpg, themeMarker } from '../themes'
import { SectionHeader } from '../components/SectionHeader'
import { FormBadge, formLabel } from '../components/FormBadge'

const { colors, font } = pixelJrpg

const FORM_OPTIONS = ['encounter', 'side_quest', 'main_quest'] as const

const RECURRENCE_LABELS: Record<string, string> = {
  none: '不重复',
  daily: '每天',
  weekly: '每周',
}

/** AI 草稿确认卡：所有字段可改，确认后才真正创建任务 */
function TaskDraftCard({
  draft,
  onConfirm,
  onCancel,
}: {
  draft: TaskDraft
  onConfirm: (input: CreateTaskInput) => Promise<void>
  onCancel: () => void
}) {
  const [title, setTitle] = useState(draft.title)
  const [details, setDetails] = useState(draft.details ?? '')
  const [importance, setImportance] = useState(draft.importance)
  const [urgency, setUrgency] = useState(draft.urgency)
  // date 输入框只接受 YYYY-MM-DD（草稿可能带时间部分，截断展示）
  const [deadline, setDeadline] = useState((draft.deadline ?? '').slice(0, 10))
  const [estimatedMin, setEstimatedMin] = useState(
    draft.estimatedMin != null ? String(draft.estimatedMin) : '',
  )
  const [recurrence, setRecurrence] = useState(draft.recurrence)
  const [recurDays, setRecurDays] = useState<number[]>(
    (draft.recurDays ?? '')
      .split(',')
      .map((s) => Number(s.trim()))
      .filter((n) => n >= 1 && n <= 7),
  )
  const [icon, setIcon] = useState(draft.icon)
  const [saving, setSaving] = useState(false)

  const confirm = () => {
    if (!title.trim()) return
    if (recurrence === 'weekly' && recurDays.length === 0) {
      window.alert('每周重复请至少选择一天')
      return
    }
    setSaving(true)
    onConfirm({
      title: title.trim(),
      notes: details.trim() || null,
      form: 'encounter',
      importance,
      urgency,
      deadline: deadline || null,
      estimatedMin: estimatedMin ? Number(estimatedMin) : null,
      recurrence,
      recurDays: recurrence === 'weekly' ? recurDays.join(',') : null,
      icon,
    })
      .catch((err: unknown) => {
        console.error('[tasks] AI 草稿创建任务失败', err)
        window.alert(`创建任务失败：${err instanceof Error ? err.message : String(err)}`)
      })
      .finally(() => setSaving(false))
  }

  return (
    <div
      style={{
        border: `2px solid ${colors.accent}`,
        backgroundColor: colors.xpTrack,
        padding: 12,
        marginTop: 12,
        display: 'flex',
        flexDirection: 'column',
        gap: 10,
      }}
    >
      <div style={{ color: colors.accent, fontFamily: font.display, fontSize: 12 }}>
        ✨ AI 解析草稿（确认后才会创建）
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, alignItems: 'flex-end' }}>
        <label style={{ ...labelStyle, flex: '1 1 220px' }}>
          标题
          <PixelInput value={title} onChange={(e) => setTitle(e.target.value)} />
        </label>
        <label style={{ ...labelStyle, flex: '1 1 220px' }}>
          详情
          <PixelInput
            value={details}
            placeholder="可选"
            onChange={(e) => setDetails(e.target.value)}
          />
        </label>
        <label style={labelStyle}>
          重要度
          <PixelSelect
            value={importance}
            onChange={(e) => setImportance(Number(e.target.value))}
          >
            {[1, 2, 3, 4, 5].map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </PixelSelect>
        </label>
        <label style={labelStyle}>
          紧迫度
          <PixelSelect value={urgency} onChange={(e) => setUrgency(Number(e.target.value))}>
            {[1, 2, 3, 4, 5].map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </PixelSelect>
        </label>
        <label style={labelStyle}>
          截止日期
          <PixelInput
            type="date"
            value={deadline}
            onChange={(e) => setDeadline(e.target.value)}
          />
        </label>
        <label style={labelStyle}>
          预估耗时（分钟）
          <PixelInput
            type="number"
            min={1}
            style={{ width: 110 }}
            value={estimatedMin}
            placeholder="可选"
            onChange={(e) => setEstimatedMin(e.target.value)}
          />
        </label>
        <label style={labelStyle}>
          重复
          <PixelSelect value={recurrence} onChange={(e) => setRecurrence(e.target.value)}>
            {Object.entries(RECURRENCE_LABELS).map(([k, label]) => (
              <option key={k} value={k}>
                {label}
              </option>
            ))}
          </PixelSelect>
        </label>
        {recurrence === 'weekly' && (
          <label style={labelStyle}>
            每周哪几天
            <WeekdayPicker value={recurDays} onChange={setRecurDays} />
          </label>
        )}
      </div>
      <div style={labelStyle}>
        分类图标
        <IconPicker value={icon} onChange={setIcon} />
      </div>
      <div style={{ display: 'flex', gap: 8 }}>
        <JrpgButton onClick={confirm} disabled={saving}>
          {saving ? '创建中…' : '✓ 确认创建'}
        </JrpgButton>
        <JrpgButton variant="ghost" onClick={onCancel} disabled={saving}>
          取消
        </JrpgButton>
      </div>
    </div>
  )
}

const WEEKDAY_LABELS = ['一', '二', '三', '四', '五', '六', '日'] as const

/** 每周重复的星期复选框组（1-7，周一=1） */
function WeekdayPicker({
  value,
  onChange,
}: {
  value: number[]
  onChange: (days: number[]) => void
}) {
  const toggle = (d: number) => {
    onChange(
      value.includes(d)
        ? value.filter((x) => x !== d)
        : [...value, d].sort((a, b) => a - b),
    )
  }
  return (
    <div style={{ display: 'flex', gap: 4 }}>
      {WEEKDAY_LABELS.map((label, i) => {
        const d = i + 1
        const on = value.includes(d)
        return (
          <button
            key={d}
            type="button"
            onClick={() => toggle(d)}
            style={{
              width: 32,
              height: 32,
              border: `1px solid ${on ? colors.accent : colors.goldDark}`,
              backgroundColor: on ? colors.panelLight : colors.xpTrack,
              color: on ? colors.accent : colors.textMuted,
              fontSize: 12,
              fontFamily: font.body,
              cursor: 'pointer',
              padding: 0,
            }}
          >
            {label}
          </button>
        )
      })}
    </div>
  )
}

/** 语义分类图标选择器：13 类 + 默认卷轴，网格排列，选中项 JRPG 光标高亮 */
function IconPicker({
  value,
  onChange,
}: {
  value: string
  onChange: (icon: string) => void
}) {
  // 默认收起：只显示当前选中项的一行摘要条，点击展开网格
  const [open, setOpen] = useState(false)
  const current = TASK_CATEGORIES.find((c) => c.key === value)
  const cell = (key: string, label: string, icon: PixelIconName) => {
    const selected = value === key
    return (
      <button
        key={key || 'default'}
        type="button"
        title={label}
        onClick={() => {
          onChange(key)
          setOpen(false)
        }}
        style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          gap: 2,
          padding: '4px 0',
          border: `1px solid ${selected ? colors.accent : colors.goldDark}`,
          backgroundColor: selected ? colors.panelLight : 'transparent',
          color: selected ? colors.accent : colors.textMuted,
          fontSize: 12,
          fontFamily: font.body,
          cursor: 'pointer',
        }}
      >
        <PixelIcon name={icon} size={36} />
        <span style={{ lineHeight: '12px' }}>
          {selected ? themeMarker() : ''}
          {label}
        </span>
      </button>
    )
  }
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          padding: '4px 8px',
          border: `1px solid ${colors.goldDark}`,
          backgroundColor: 'transparent',
          color: colors.textMuted,
          fontSize: 12,
          fontFamily: font.body,
          cursor: 'pointer',
          alignSelf: 'flex-start',
        }}
      >
        <PixelIcon name={current ? current.icon : 'scroll'} size={28} />
        <span style={{ color: current ? colors.text : colors.textMuted }}>
          {current ? current.label : '默认'}
        </span>
        <span>{open ? '▾ 收起' : '▸ 选择图标'}</span>
      </button>
      {open && (
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(7, minmax(0, 1fr))',
            gap: 4,
          }}
        >
          {cell('', '默认', 'scroll')}
          {TASK_CATEGORIES.map((c) => cell(c.key, c.label, c.icon))}
        </div>
      )}
    </div>
  )
}

function formatDeadline(deadline: string | null): string | null {
  if (!deadline) return null
  const d = new Date(deadline)
  if (Number.isNaN(d.getTime())) return deadline
  return d.toLocaleDateString('zh-CN')
}

const labelStyle: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 4,
  fontSize: 13,
  color: colors.textMuted,
  fontFamily: font.body,
  letterSpacing: '0.1em',
}

/** 重要度徽记：像素星（与 QuestLog 一致） */
function ImportanceStars({ importance }: { importance: number }) {
  const count = Math.max(1, Math.min(3, Math.ceil(importance / 2)))
  return (
    <span
      style={{ display: 'inline-flex', gap: 2, alignItems: 'center', flexShrink: 0 }}
      title={`重要度 ${importance}`}
    >
      {Array.from({ length: count }, (_, i) => (
        <PixelIcon key={i} name="star" size={16} />
      ))}
    </span>
  )
}

/** 支持步骤树展开的任务形态 */
const STEP_FORMS = new Set(['main_quest', 'side_quest'])

/** 步骤进度计数（done/total），由 TasksPage 统一拉取缓存后下发 */
interface StepCount {
  done: number
  total: number
}

function TaskRow({
  task,
  ranked,
  stepCount,
  indent,
  llmReady,
}: {
  task: Task
  ranked?: RankedTask
  stepCount?: StepCount
  indent?: boolean
  llmReady: boolean
}) {
  const complete = useTasksStore((s) => s.complete)
  const reopen = useTasksStore((s) => s.reopen)
  const remove = useTasksStore((s) => s.remove)
  const update = useTasksStore((s) => s.update)
  const recurring = isRecurring(task)
  // 循环任务的"完成"= 今日已打卡（永不进入永久 done）
  const done = task.status === 'done' || (recurring && task.doneToday)
  const deadline = formatDeadline(task.deadline)
  const [hover, setHover] = useState(false)
  const [expanded, setExpanded] = useState(false)
  const [stepsOpen, setStepsOpen] = useState(false)
  const [detailsOpen, setDetailsOpen] = useState(false)
  const [activeTab, setActiveTab] = useState<'steps' | 'task'>('task')
  const [editRecurrence, setEditRecurrence] = useState(task.recurrence)
  const [editDays, setEditDays] = useState<number[]>([])
  const [editIcon, setEditIcon] = useState(task.icon)
  // AI 分解：草稿步骤（可勾选/改标题/改时长）
  const [aiSteps, setAiSteps] = useState<(StepDraft & { selected: boolean })[] | null>(null)
  const [aiLoading, setAiLoading] = useState(false)
  const [aiError, setAiError] = useState<string | null>(null)
  const [aiSaving, setAiSaving] = useState(false)
  const hasNotes = !!(task.notes && task.notes.trim())
  const isStepForm = STEP_FORMS.has(task.form)
  // 长期任务：主线，或截止日距今超过 7 天
  const isLongTerm =
    task.form === 'main_quest' ||
    (task.deadline != null &&
      new Date(task.deadline).getTime() - Date.now() > 7 * 86400_000)
  // 逾期判定：优先用规则引擎的 reasons（与 Rust 口径一致），无排序数据时本地比较兜底
  const overdue = ranked
    ? ranked.reasons.includes('已逾期')
    : !done && task.deadline != null && new Date(task.deadline).getTime() < Date.now()
  const tooltip =
    ranked && ranked.reasons.length > 0
      ? `${task.title}\n排序依据：${ranked.reasons.join('、')}`
      : task.title

  // 青色副标题（概念图风格）：主线/支线「步骤 x/y · 截止 xxx」，遭遇「预估 xx 分钟 · 截止 xxx」
  const subtitleParts: string[] = []
  if (recurring) {
    subtitleParts.push(
      task.recurrence === 'daily'
        ? '日常 · 每天'
        : `周常 · 周${(task.recurDays ?? '')
            .split(',')
            .filter(Boolean)
            .map((d) => WEEKDAY_LABELS[Number(d) - 1])
            .join('、')}`,
    )
  }
  if (isStepForm) {
    if (stepCount && stepCount.total > 0) {
      subtitleParts.push(`步骤 ${stepCount.done}/${stepCount.total}`)
    }
  } else if (task.estimatedMin != null) {
    subtitleParts.push(`预估 ${task.estimatedMin} 分钟`)
  }
  if (deadline) subtitleParts.push(`截止 ${deadline}`)
  if (task.plannedDate) subtitleParts.push(`计划 ${task.plannedDate.slice(5)} 执行`)
  const subtitle = subtitleParts.join(' · ')

  /** AI 分解：拉草稿步骤进预览面板 */
  const runAiDecompose = () => {
    setAiLoading(true)
    setAiError(null)
    aiDecomposeTask(task.id)
      .then((drafts) => setAiSteps(drafts.map((d) => ({ ...d, selected: true }))))
      .catch((err: unknown) => {
        console.error('[tasks] AI 分解失败', err)
        setAiError(typeof err === 'string' ? err : 'AI 分解失败，请稍后再试')
      })
      .finally(() => setAiLoading(false))
  }

  /** 确认分解结果：按勾选顺序逐个 addStep */
  const adoptAiSteps = async () => {
    if (!aiSteps) return
    const chosen = aiSteps.filter((s) => s.selected && s.title.trim())
    if (chosen.length === 0) return
    setAiSaving(true)
    try {
      for (const s of chosen) {
        await addStep(task.id, s.title.trim(), null, null, s.estimatedMin)
      }
      setAiSteps(null)
      setStepsOpen(true)
      setDetailsOpen(true)
      setActiveTab('steps')
    } catch (err) {
      console.error('[tasks] 批量添加分解步骤失败', err)
      setAiError(`部分步骤写入失败：${err instanceof Error ? err.message : String(err)}`)
    } finally {
      setAiSaving(false)
    }
  }

  return (
    <div
      style={{
        position: 'relative', // 逾期红条竖条的锚点
        borderBottom: `1px solid ${colors.goldDark}`,
        // 支线缩进：挂在母主线紧下方，左侧 1px 深金竖线
        marginLeft: indent ? 24 : 0,
        borderLeft: indent ? `1px solid ${colors.goldDark}` : undefined,
        backgroundColor: hover ? colors.panelLight : 'transparent',
        transition: 'background-color 0.12s ease-out',
        opacity: done ? 0.55 : 1,
      }}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
    >
      {/* 逾期红条：左缘 2px danger 竖条，与 hover 底色/缩进竖线共存 */}
      {overdue && !done && (
        <span
          aria-hidden="true"
          style={{
            position: 'absolute',
            left: 0,
            top: 0,
            bottom: 0,
            width: 2,
            backgroundColor: colors.danger,
            pointerEvents: 'none',
          }}
        />
      )}
      <div
        className="xm-task-summary"
        title="双击打开任务详情"
        tabIndex={0}
        onDoubleClick={() => {
          if (!detailsOpen) {
            setEditRecurrence(task.recurrence)
            setEditDays((task.recurDays ?? '').split(',').map(Number).filter((n) => n >= 1 && n <= 7))
            setEditIcon(task.icon)
          }
          setDetailsOpen((v) => !v)
        }}
        onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); setDetailsOpen((v) => !v) } }}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 10,
          padding: '8px 6px',
          minHeight: 44,
          boxSizing: 'border-box',
        }}
      >
        {/* JRPG 手型光标：hover 时行首浮出金色 ▶，预留 14px 占位避免内容抖动 */}
        <span
          aria-hidden="true"
          style={{
            width: 14,
            flexShrink: 0,
            color: colors.accent,
            fontSize: 12,
            lineHeight: 1,
            textAlign: 'center',
            visibility: hover ? 'visible' : 'hidden',
          }}
        >
          {themeMarker()}
        </span>
        {/* 语义分类图标（M4）：无分类用默认卷轴；形态改由彩色文字徽章标识 */}
        <PixelIcon name={taskIcon(task.icon)} size={42} />
        <span className="xm-task-row-form"><FormBadge form={task.form} /></span>
        <span className="xm-task-row-stars" title={`重要度 ${task.importance}`}><ImportanceStars importance={task.importance} /></span>
        <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 2 }}>
          <span
            style={{
              minWidth: 0, /* 允许收缩，长标题省略号而不是撑出横向滚动条 */
              textDecoration: done ? 'line-through' : 'none',
              fontSize: 14,
              fontFamily: font.body,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
              color: overdue && !done ? colors.danger : undefined,
            }}
            title={tooltip}
          >
            {task.title}
          </span>
          {subtitle && (
            <span
              style={{
                fontSize: 12,
                fontFamily: font.body,
                color: colors.info,
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}
            >
              {subtitle}
            </span>
          )}
        </div>
        {/* 常用操作留在摘要行；双击其他区域打开步骤 / 任务双页卡。 */}
        <div
          style={{
            display: 'flex',
            gap: 8,
            flexShrink: 0,
            flexWrap: 'nowrap',
            alignItems: 'center',
          }}
        >
          {/* 循环任务连击：streak >= 2 时显示火焰 + 天数 */}
          {recurring && task.streak >= 2 && (
            <span
              title={`连续打卡 ${task.streak} 天`}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 2,
                color: colors.accent,
                fontSize: 12,
                fontFamily: font.display,
                whiteSpace: 'nowrap',
              }}
            >
              <PixelIcon name="flame" size={16} />
              {task.streak}
            </span>
          )}
          {hasNotes && !expanded && (
            <span title="该任务有备注">
              <PixelIcon name="scroll" size={16} />
            </span>
          )}
          <button type="button" className="xm-task-quick-action" title={done ? '取消完成' : recurring ? '今日打卡' : '完成任务'}
            onClick={(event) => {
              event.stopPropagation()
              void (done ? reopen(task.id) : complete(task.id)).catch((err: unknown) => console.error('[tasks] 切换完成状态失败', err))
            }}
            onDoubleClick={(event) => event.stopPropagation()}>
            {done ? '↶' : '✓'}<span>{done ? '撤销' : recurring ? '打卡' : '完成'}</span>
          </button>
          <button type="button" className="xm-task-quick-action is-danger" title="删除任务"
            onClick={(event) => {
              event.stopPropagation()
              if (window.confirm(`确定删除任务「${task.title}」吗？`)) {
                void remove(task.id).catch((err: unknown) => console.error('[tasks] 删除任务失败', err))
              }
            }}
            onDoubleClick={(event) => event.stopPropagation()}>
            ×<span>删除</span>
          </button>
        </div>
      </div>
      {detailsOpen && <div className="xm-task-detail-card" style={{ border: `1px solid ${colors.goldDark}`, background: colors.panelLight, padding: 12, margin: '0 6px 12px 42px' }}>
        <div className="xm-task-detail-tabs" style={{ display: 'flex', gap: 8, borderBottom: `1px solid ${colors.goldDark}`, paddingBottom: 8, marginBottom: 10 }}>
          <JrpgButton variant={activeTab === 'steps' ? undefined : 'ghost'} onClick={() => { setActiveTab('steps'); setStepsOpen(true) }}>步骤</JrpgButton>
          <JrpgButton variant={activeTab === 'task' ? undefined : 'ghost'} onClick={() => { setActiveTab('task'); setExpanded(true) }}>任务</JrpgButton>
          <span style={{ flex: 1 }} />
          <JrpgButton variant="ghost" onClick={() => setDetailsOpen(false)}>收起</JrpgButton>
        </div>
        {activeTab === 'task' && <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginBottom: 10 }}>
          <JrpgButton
            onClick={() => {
              const action = done ? reopen(task.id) : complete(task.id)
              action.catch((err: unknown) => {
                console.error('[tasks] 切换任务完成状态失败', err)
              })
            }}
          >
            {done
              ? recurring
                ? '撤销打卡'
                : '取消完成'
              : recurring
                ? '✓ 打卡'
                : '✓ 完成'}
          </JrpgButton>
          <JrpgButton
            variant="danger"
            onClick={() => {
              if (window.confirm(`确定删除任务「${task.title}」吗？`)) {
                remove(task.id).catch((err: unknown) => {
                  console.error('[tasks] 删除任务失败', err)
                })
              }
            }}
          >
            删除
          </JrpgButton>
        </div>}
      {activeTab === 'steps' && stepsOpen && (
        <div style={{ padding: '0 6px 10px 42px' }}>
          {/* AI 分解内置在步骤栏：长期任务（主线/截止超过 7 天）；未配置 LLM 时置灰 */}
          {isLongTerm && !done && (
            <div style={{ marginBottom: 8 }}>
              <JrpgButton
                variant="ghost"
                disabled={!llmReady || aiLoading}
                title={llmReady ? 'AI 分解为支线步骤' : '先在「设置 → LLM 设置」配置 API Key'}
                onClick={runAiDecompose}
              >
                {aiLoading ? '分解中…' : '✨ AI 分解'}
              </JrpgButton>
            </div>
          )}
          {/* AI 分解预览：每步可勾选/改标题/改时长，确认后批量 addStep */}
          {aiSteps && (
            <div
              style={{
                display: 'flex',
                flexDirection: 'column',
                gap: 6,
                marginBottom: 8,
              }}
            >
              <div style={{ color: colors.accent, fontFamily: font.display, fontSize: 12 }}>
                ✨ AI 分解预览（勾选要纳入的步骤）
              </div>
              {aiSteps.map((s, i) => (
                <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <button
                    type="button"
                    onClick={() =>
                      setAiSteps((prev) =>
                        prev
                          ? prev.map((x, j) => (j === i ? { ...x, selected: !x.selected } : x))
                          : prev,
                      )
                    }
                    style={{
                      width: 16,
                      height: 16,
                      flexShrink: 0,
                      border: `1px solid ${colors.accent}`,
                      backgroundColor: s.selected ? colors.accent : 'transparent',
                      color: colors.panel,
                      fontSize: 12,
                      lineHeight: '14px',
                      padding: 0,
                      cursor: 'pointer',
                    }}
                  >
                    {s.selected ? '✓' : ''}
                  </button>
                  <PixelInput
                    value={s.title}
                    style={{ flex: 1, minWidth: 0 }}
                    onChange={(e) =>
                      setAiSteps((prev) =>
                        prev
                          ? prev.map((x, j) => (j === i ? { ...x, title: e.target.value } : x))
                          : prev,
                      )
                    }
                  />
                  <PixelInput
                    type="number"
                    min={1}
                    placeholder="分钟"
                    style={{ width: 80 }}
                    value={s.estimatedMin != null ? String(s.estimatedMin) : ''}
                    onChange={(e) =>
                      setAiSteps((prev) =>
                        prev
                          ? prev.map((x, j) =>
                              j === i
                                ? { ...x, estimatedMin: e.target.value ? Number(e.target.value) : null }
                                : x,
                            )
                          : prev,
                      )
                    }
                  />
                </div>
              ))}
              {aiError && (
                <p style={{ color: colors.danger, fontSize: 12, margin: 0 }}>{aiError}</p>
              )}
              <div style={{ display: 'flex', gap: 8 }}>
                <JrpgButton onClick={() => void adoptAiSteps()} disabled={aiSaving}>
                  {aiSaving ? '写入中…' : '✓ 纳入步骤树'}
                </JrpgButton>
                <JrpgButton variant="ghost" onClick={() => setAiSteps(null)} disabled={aiSaving}>
                  放弃
                </JrpgButton>
              </div>
            </div>
          )}
          {aiError && !aiSteps && (
            <p style={{ color: colors.danger, fontSize: 12, margin: '0 0 8px' }}>{aiError}</p>
          )}
          <StepsPanel taskId={task.id} />
        </div>
      )}
      {/* 任务设置（重复/图标）面板：已与备注面板合并，同一「备注 ▸」入口 */}
      {activeTab === 'task' && (
        <div
          style={{
            padding: '0 6px 10px 42px',
            display: 'flex',
            flexDirection: 'column',
            gap: 10,
          }}
        >
          <label style={labelStyle}>
            重复
            <PixelSelect
              value={editRecurrence}
              onChange={(e) => setEditRecurrence(e.target.value)}
              style={{ width: 140 }}
            >
              {Object.entries(RECURRENCE_LABELS).map(([k, label]) => (
                <option key={k} value={k}>
                  {label}
                </option>
              ))}
            </PixelSelect>
          </label>
          {editRecurrence === 'weekly' && (
            <label style={labelStyle}>
              每周哪几天
              <WeekdayPicker value={editDays} onChange={setEditDays} />
            </label>
          )}
          <label style={labelStyle}>
            分类图标
            <IconPicker value={editIcon} onChange={setEditIcon} />
          </label>
          <div style={{ display: 'flex', gap: 8 }}>
            <JrpgButton
              onClick={() => {
                if (editRecurrence === 'weekly' && editDays.length === 0) {
                  window.alert('每周重复请至少选择一天')
                  return
                }
                update(task.id, {
                  recurrence: editRecurrence,
                  recurDays: editRecurrence === 'weekly' ? editDays.join(',') : null,
                  icon: editIcon,
                })
                  .catch((err: unknown) => {
                    console.error('[tasks] 保存任务编辑失败', err)
                    window.alert(`保存失败：${err instanceof Error ? err.message : String(err)}`)
                  })
              }}
            >
              保存设置
            </JrpgButton>
          </div>
        </div>
      )}
      {activeTab === 'task' && (
        <div style={{ padding: '0 6px 10px 42px' }}>
          <NotesEditor
            initialHTML={task.notes}
            onCancel={() => setDetailsOpen(false)}
            onSave={async (html) => {
              try {
                await update(task.id, { notes: html })
                setDetailsOpen(false)
              } catch (err) {
                console.error('[tasks] 保存备注失败', err)
              }
            }}
          />
        </div>
      )}
      </div>}
    </div>
  )
}


export default function TasksPage() {
  const tasks = useTasksStore((s) => s.tasks)
  const loading = useTasksStore((s) => s.loading)
  const fetchAll = useTasksStore((s) => s.fetchAll)
  const create = useTasksStore((s) => s.create)
  const update = useTasksStore((s) => s.update)

  const [title, setTitle] = useState('')
  const [form, setForm] = useState<string>('encounter')
  const [importance, setImportance] = useState(3)
  const [urgency, setUrgency] = useState(3)
  const [deadline, setDeadline] = useState('')
  const [estimatedMin, setEstimatedMin] = useState('')
  const [parentId, setParentId] = useState('')
  const [recurrence, setRecurrence] = useState<string>('none')
  const [recurDays, setRecurDays] = useState<number[]>([])
  const [icon, setIcon] = useState('')
  const [ranked, setRanked] = useState<RankedTask[] | null>(null)
  // AI 参谋：LLM 是否已配置（hasKey）；一句话录入状态
  const [llmReady, setLlmReady] = useState(false)
  const [quickText, setQuickText] = useState('')
  const [quickLoading, setQuickLoading] = useState(false)
  const [quickError, setQuickError] = useState<string | null>(null)
  const [draft, setDraft] = useState<TaskDraft | null>(null)
  const [stepCounts, setStepCounts] = useState<Record<string, StepCount>>({})
  const [manualFormOpen, setManualFormOpen] = useState(false)

  useEffect(() => {
    fetchAll().catch((err: unknown) => {
      console.error('[tasks] 初始拉取任务失败', err)
    })
  }, [fetchAll])

  // LLM 配置探测：决定 AI 按钮可用性（未配置 → 置灰 + 提示，不弹错误）
  useEffect(() => {
    getLlmConfig()
      .then((cfg) => setLlmReady(cfg.hasKey))
      .catch((err: unknown) => {
        console.error('[tasks] 读取 LLM 配置失败，AI 功能按未配置处理', err)
        setLlmReady(false)
      })
  }, [])

  /** 一句话发布任务：调 aiParseTask → 草稿确认卡 */
  const runQuickAdd = () => {
    const text = quickText.trim()
    if (!text) return
    setQuickLoading(true)
    setQuickError(null)
    aiParseTask(text)
      .then((d) => setDraft(d))
      .catch((err: unknown) => {
        console.error('[tasks] AI 解析任务失败', err)
        setQuickError(typeof err === 'string' ? err : 'AI 解析失败，请稍后再试或手动创建')
      })
      .finally(() => setQuickLoading(false))
  }

  // 规则引擎排序：任务变化后重取；失败（非 Tauri 环境等）回落到原有顺序
  const refreshRanked = useCallback(async () => {
    try {
      setRanked(await getRankedToday())
    } catch (err) {
      console.error('[tasks] 获取规则排序失败，回落到默认顺序', err)
      setRanked(null)
    }
  }, [])

  useEffect(() => {
    void refreshRanked()
  }, [refreshRanked, tasks])

  // 步骤计数：对进行中的主线/支线统一拉一次 listSteps 缓存；
  // 任务变化或 steps-changed 事件（步骤增删/勾选）时刷新
  useEffect(() => {
    let cancelled = false
    const load = async () => {
      const targets = tasks.filter(
        (t) => STEP_FORMS.has(t.form) && t.status !== 'done',
      )
      const entries = await Promise.all(
        targets.map(async (t): Promise<[string, StepCount]> => {
          try {
            const steps = await listSteps(t.id)
            return [
              t.id,
              {
                done: steps.filter((s) => s.status === 'done').length,
                total: steps.length,
              },
            ]
          } catch (err) {
            console.error(`[tasks] 拉取任务「${t.title}」步骤计数失败`, err)
            return [t.id, { done: 0, total: 0 }]
          }
        }),
      )
      if (!cancelled) setStepCounts(Object.fromEntries(entries))
    }
    void load()
    let unlisten: (() => void) | null = null
    onStepsChanged(() => {
      void load()
    })
      .then((u) => {
        unlisten = u
      })
      .catch((err: unknown) => {
        console.error('[tasks] 订阅 steps-changed 事件失败', err)
      })
    return () => {
      cancelled = true
      unlisten?.()
    }
  }, [tasks])

  // 支线「所属主线」候选：进行中（未 done）的主线任务
  const mainOptions = useMemo(
    () => tasks.filter((t) => t.form === 'main_quest' && t.status !== 'done'),
    [tasks],
  )

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault()
    const trimmed = title.trim()
    if (!trimmed) return
    // 支线必须挂在一条进行中的主线下（后端也会校验父任务形态）
    if (form === 'side_quest' && !parentId) {
      window.alert('支线任务必须选择所属主线（需有一条进行中的主线任务）')
      return
    }
    // 主线软上限：进行中主线数 ≥ cap 时先弹精力摊薄警告
    if (form === 'main_quest') {
      let cap = 3
      try {
        const v = await getSetting('main_quest_soft_cap')
        const n = v ? Number(v) : NaN
        if (Number.isFinite(n) && n >= 1) cap = Math.floor(n)
      } catch (err) {
        console.error('[tasks] 读取主线软上限设置失败，使用缺省 3', err)
      }
      const doingMain = tasks.filter(
        (t) => t.form === 'main_quest' && t.status !== 'done',
      ).length
      if (doingMain >= cap) {
        const ok = window.confirm(
          `精力摊薄警告：已有 ${doingMain} 条进行中主线（建议 ≤${cap}）。确定再开一条吗？`,
        )
        if (!ok) return
      }
    }
    if (recurrence === 'weekly' && recurDays.length === 0) {
      window.alert('每周重复请至少选择一天')
      return
    }
    try {
      const created = await create({
        title: trimmed,
        form,
        importance,
        urgency,
        deadline: deadline || null,
        estimatedMin: estimatedMin ? Number(estimatedMin) : null,
        parentId: form === 'side_quest' ? parentId : null,
        recurrence,
        recurDays: recurrence === 'weekly' ? recurDays.join(',') : null,
        icon,
      })
      // 图标自动归类：用户没选图标且有 LLM 配置时后台补分类，失败静默
      if (!icon && llmReady) {
        void aiClassifyIcon(trimmed, '')
          .then((k) => {
            if (k) {
              return update(created.id, { icon: k })
            }
          })
          .catch((err: unknown) => console.error('[tasks] 自动归类图标失败（已忽略）', err))
      }
    } catch (err) {
      console.error('[tasks] 创建任务失败', err)
      window.alert(`创建任务失败：${err instanceof Error ? err.message : String(err)}`)
      return
    }
    setTitle('')
    setForm('encounter')
    setImportance(3)
    setUrgency(3)
    setDeadline('')
    setEstimatedMin('')
    setParentId('')
    setRecurrence('none')
    setRecurDays([])
    setIcon('')
  }

  // 进行中列表：按 getRankedToday() 顺序；ranked 缺失的任务按原顺序补尾
  // 循环任务只在应做日进入今日列表（与后端 get_ranked_today 过滤口径一致）
  const doing = useMemo<{ task: Task; ranked?: RankedTask }[]>(() => {
    const visible = (t: Task) =>
      t.status !== 'done' && (!isRecurring(t) || recurringDueToday(t))
    if (!ranked) {
      return tasks.filter(visible).map((t) => ({ task: t }))
    }
    const byId = new Map(tasks.map((t) => [t.id, t]))
    const seen = new Set<string>()
    const out: { task: Task; ranked?: RankedTask }[] = []
    for (const r of ranked) {
      const t = byId.get(r.task.id) ?? r.task
      if (!visible(t)) continue
      seen.add(t.id)
      out.push({ task: t, ranked: r })
    }
    for (const t of tasks) {
      if (visible(t) && !seen.has(t.id)) out.push({ task: t })
    }
    return out
  }, [tasks, ranked])

  // 分组：主线组（主线 + 紧下方的其子支线）→ 游离任务（遭遇/无父或父不在列表的支线）
  // doing 已按规则排序，各桶按取出顺序保持规则排序
  const grouped = useMemo(() => {
    type Item = { task: Task; ranked?: RankedTask }
    const isRootMain = (t: Task) => t.form === 'main_quest' && !t.parentId
    const byId = new Map(doing.map((d) => [d.task.id, d.task]))
    const roots: Item[] = []
    const childrenByParent = new Map<string, Item[]>()
    const loose: Item[] = []
    for (const item of doing) {
      const t = item.task
      if (isRootMain(t)) {
        roots.push(item)
        continue
      }
      const parent = t.parentId ? byId.get(t.parentId) : undefined
      if (t.form === 'side_quest' && parent && isRootMain(parent)) {
        const arr = childrenByParent.get(parent.id) ?? []
        arr.push(item)
        childrenByParent.set(parent.id, arr)
        continue
      }
      loose.push(item)
    }
    return { roots, childrenByParent, loose }
  }, [doing])

  const doneList = tasks.filter((t) => t.status === 'done')

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
        <PixelIcon name="scroll" size={24} />
        任务
      </h1>

      <QuestPanel className="task-form-panel">
        {/* ✨ 一句话发布任务：LLM 未配置时输入条置灰并提示去设置页 */}
        <div
          style={{
            display: 'flex',
            gap: 8,
            alignItems: 'center',
            marginBottom: 12,
            flexWrap: 'wrap',
          }}
        >
          <PixelIcon name="staff" size={16} />
          <PixelInput
            style={{ flex: '1 1 280px' }}
            value={quickText}
            placeholder={
              llmReady
                ? '✨ 一句话发布任务，如：周五下午5点前交实验报告，很重要，大概2小时'
                : '✨ 一句话发布任务（需先在「设置 → LLM 设置」配置 API Key）'
            }
            disabled={!llmReady || quickLoading}
            onChange={(e) => setQuickText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault()
                runQuickAdd()
              }
            }}
          />
          <JrpgButton
            onClick={runQuickAdd}
            disabled={!llmReady || quickLoading || !quickText.trim()}
          >
            {quickLoading ? '解析中…' : '✨ 解析'}
          </JrpgButton>
          {!llmReady && (
            <span style={{ color: colors.textMuted, fontSize: 12, fontFamily: font.body }}>
              去「设置 → LLM 设置」保存 API Key 后可用
            </span>
          )}
        </div>
        {quickError && (
          <p
            style={{
              color: isLlmNotConfigured(quickError) ? colors.textMuted : colors.danger,
              fontSize: 12,
              margin: '0 0 8px',
            }}
          >
            {quickError}
          </p>
        )}
        {draft && (
          <TaskDraftCard
            draft={draft}
            onCancel={() => setDraft(null)}
            onConfirm={async (input) => {
              await create(input)
              setDraft(null)
              setQuickText('')
            }}
          />
        )}
        <JrpgButton variant="ghost" onClick={() => setManualFormOpen((open) => !open)}>
          {manualFormOpen ? '收起手动任务设置 ▴' : '展开手动任务设置 ▾'}
        </JrpgButton>
        {manualFormOpen && <form
          onSubmit={handleSubmit}
          style={{ display: 'flex', flexWrap: 'wrap', gap: 12, alignItems: 'flex-end' }}
        >
          <label style={{ ...labelStyle, flex: '1 1 220px' }}>
            标题（必填）
            <PixelInput
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="要做点什么？"
              required
            />
          </label>
          <label style={labelStyle}>
            形态
            <PixelSelect
              value={form}
              onChange={(e) => {
                const v = e.target.value
                setForm(v)
                if (v !== 'side_quest') setParentId('')
              }}
            >
              {FORM_OPTIONS.map((f) => (
                <option key={f} value={f}>
                  {formLabel(f)}
                </option>
              ))}
            </PixelSelect>
          </label>
          {form === 'side_quest' && (
            <label style={labelStyle}>
              所属主线（必选）
              <PixelSelect
                value={parentId}
                onChange={(e) => setParentId(e.target.value)}
                required
              >
                <option value="" disabled>
                  {mainOptions.length > 0 ? '选择所属主线…' : '暂无进行中的主线'}
                </option>
                {mainOptions.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.title}
                  </option>
                ))}
              </PixelSelect>
            </label>
          )}
          <label style={labelStyle}>
            重要度
            <PixelSelect
              value={importance}
              onChange={(e) => setImportance(Number(e.target.value))}
            >
              {[1, 2, 3, 4, 5].map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </PixelSelect>
          </label>
          <label style={labelStyle}>
            紧迫度
            <PixelSelect
              value={urgency}
              onChange={(e) => setUrgency(Number(e.target.value))}
            >
              {[1, 2, 3, 4, 5].map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </PixelSelect>
          </label>
          <label style={labelStyle}>
            截止日期
            <PixelInput
              type="date"
              value={deadline}
              onChange={(e) => setDeadline(e.target.value)}
            />
          </label>
          <label style={labelStyle}>
            预估耗时（分钟）
            <PixelInput
              type="number"
              min={1}
              style={{ width: 110 }}
              value={estimatedMin}
              onChange={(e) => setEstimatedMin(e.target.value)}
              placeholder="可选"
            />
          </label>
          <label style={labelStyle}>
            重复
            <PixelSelect
              value={recurrence}
              onChange={(e) => setRecurrence(e.target.value)}
            >
              {Object.entries(RECURRENCE_LABELS).map(([k, label]) => (
                <option key={k} value={k}>
                  {label}
                </option>
              ))}
            </PixelSelect>
          </label>
          {recurrence === 'weekly' && (
            <label style={labelStyle}>
              每周哪几天
              <WeekdayPicker value={recurDays} onChange={setRecurDays} />
            </label>
          )}
          <div style={{ ...labelStyle, flex: '1 1 100%' }}>
            分类图标（可选，默认主题图案）
            <IconPicker value={icon} onChange={setIcon} />
          </div>
          <JrpgButton type="submit">添加任务</JrpgButton>
        </form>}
      </QuestPanel>

      <div style={{ height: 20 }} />

      <QuestPanel className="task-list-panel">
        {loading && tasks.length === 0 ? (
          <p style={{ color: colors.textMuted, margin: 0, fontSize: 12 }}>加载中…</p>
        ) : tasks.length === 0 ? (
          <div style={{ display: 'flex', alignItems: 'center', gap: 16, minHeight: 76, padding: '4px 8px' }}>
            <PixelIcon name="chest" size={68} />
            <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
              <strong style={{ color: pixelJrpg.panelStyle === 'wood-frame' ? colors.goldDark : colors.accent, fontFamily: font.display, fontSize: 16 }}>
                {pixelJrpg.panelStyle === 'wood-frame' ? '农场还没有待办' : pixelJrpg.panelStyle === 'soft' ? '今天的小计划还空着' : pixelJrpg.panelStyle === 'parchment' ? '新的一页，等待落笔' : '任务日志尚未开启'}
              </strong>
              <span style={{ color: colors.textMuted, fontSize: 13 }}>在上方写下第一件要完成的事。</span>
            </div>
          </div>
        ) : (
          <>
            <SectionHeader>进行中（{doing.length}）</SectionHeader>
            {doing.length === 0 ? (
              <p style={{ color: colors.textMuted, fontSize: 12, margin: '0 0 8px' }}>
                暂无进行中的任务
              </p>
            ) : (
              <>
                {/* 主线组：主线行 + 紧下方缩进的子支线 */}
                {grouped.roots.map(({ task: t, ranked: r }) => (
                  <div key={t.id}>
                    <TaskRow task={t} ranked={r} stepCount={stepCounts[t.id]} llmReady={llmReady} />
                    {(grouped.childrenByParent.get(t.id) ?? []).map(
                      ({ task: c, ranked: cr }) => (
                        <TaskRow
                          key={c.id}
                          task={c}
                          ranked={cr}
                          stepCount={stepCounts[c.id]}
                          llmReady={llmReady}
                          indent
                        />
                      ),
                    )}
                  </div>
                ))}
                {/* 游离任务：遭遇 / 无父或母主线不在进行中列表的支线 */}
                {grouped.loose.map(({ task: t, ranked: r }) => (
                  <TaskRow key={t.id} task={t} ranked={r} stepCount={stepCounts[t.id]} llmReady={llmReady} />
                ))}
              </>
            )}
            {doneList.length > 0 && (
              <>
                <div style={{ height: 16 }} />
                <SectionHeader muted>已完成（{doneList.length}）</SectionHeader>
                {doneList.map((t) => <TaskRow key={t.id} task={t} llmReady={llmReady} />)}
              </>
            )}
          </>
        )}
      </QuestPanel>
    </div>
  )
}
