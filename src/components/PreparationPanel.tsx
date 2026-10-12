import { useEffect, useRef, useState } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { documentDir } from '@tauri-apps/api/path'
import type { Task } from '../api/tasks'
import { openPreparationArtifact, pausePreparation, preparationLabels, readPreparationResult, retryPreparation, savePreparation } from '../api/preparation'
import type { PreparationConfig, PreparationKind, PreparationRun } from '../api/preparation'
import { usePreparationStore } from '../store/preparation'
import { usePomodoroStore } from '../store/pomodoro'
import { JrpgButton } from './JrpgButton'
import { PixelInput } from './PixelInput'
import { PixelSelect } from './PixelSelect'
import './preparation.css'

export function localDateTime(value: string): string {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  return new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 16)
}
export function PreparationBadge({ taskId }: { taskId: string }) {
  const ready = usePreparationStore(s => s.runs.some(r => r.taskId === taskId && r.state === 'ready' && s.rules.some(rule => rule.id === r.ruleId && rule.version === r.version)))
  return ready ? <small className="xm-preparation-badge">资料已备好</small> : null
}
const kindNames = { writing: '写作目录与参考索引', study: '当天学习包', focus: '专注环境' }
export function PreparationPanel({ task }: { task: Task }) {
  const [kind, setKind] = useState<PreparationKind>(() => usePreparationStore.getState().rules.find(r => r.taskId === task.id)?.kind ?? 'writing')
  const rules = usePreparationStore(s => s.rules), runs = usePreparationStore(s => s.runs)
  const refresh = usePreparationStore(s => s.refresh), globallyPaused = usePreparationStore(s => s.paused)
  const rule = rules.find(r => r.taskId === task.id && r.kind === kind)
  const taskRuns = runs.filter(r => r.taskId === task.id)
  const latest = taskRuns.find(r => r.ruleId === rule?.id && r.version === rule?.version)
  const [editing, setEditing] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState('')
  const [startAt, setStartAt] = useState(''), [lead, setLead] = useState('60')
  const [sources, setSources] = useState(''), gate = useRef(false)
  const [config, setConfig] = useState<PreparationConfig>({ topic: task.title, outputRoot: '', sources: [], reading: '', mistakes: '', search: false, referenceLimit: 8, focusMin: 25, sound: 'none', openSources: false, notify: false })
  useEffect(() => {
    let active = true
    if (rule) {
      try {
        const saved = JSON.parse(rule.configJson) as PreparationConfig
        setConfig(saved); setSources(saved.sources.join('\n')); setKind(rule.kind); setLead(String(rule.leadMin)); setStartAt(localDateTime(rule.startAt))
      } catch { setError('准备要求无法读取，请重新填写') }
    } else {
      const base = task.plannedDate ?? task.deadline?.slice(0, 10)
      const date = base ? new Date(`${base}T19:00`) : new Date(Date.now() + 86400000)
      setStartAt(localDateTime(date.toISOString()))
      void documentDir().then(outputRoot => { if (active) setConfig(c => c.outputRoot ? c : { ...c, outputRoot }) }).catch(() => {})
    }
    return () => { active = false }
  }, [rule?.id, rule?.version, rule?.enabled, task.id])
  const run = async (job: () => Promise<unknown>) => {
    if (gate.current) return
    gate.current = true; setBusy(true); setError('')
    try { await job(); await refresh() } catch (e) { setError(String(e)) }
    finally { gate.current = false; setBusy(false) }
  }
  const field = <K extends keyof PreparationConfig>(key: K, value: PreparationConfig[K]) => setConfig(c => ({ ...c, [key]: value }))
  const save = () => run(async () => {
    if (!startAt || !Number.isFinite(new Date(startAt).getTime())) throw new Error('请填写行动时间')
    await savePreparation({ taskId: task.id, kind, startAt: new Date(startAt).toISOString(), leadMin: Number(lead), config: { ...config, sources: sources.split('\n').map(s => s.trim()).filter(Boolean) } })
    setEditing(false)
  })
  const startFocus = () => run(async () => {
    await usePomodoroStore.getState().start(task.id)
    window.dispatchEvent(new CustomEvent('preparation:focus'))
  })
  return <section className="xm-preparation" aria-label="提前准备">
    <div className="xm-preparation-heading"><strong>行动之前，先备好</strong>{latest && <small>{preparationLabels[latest.state]}</small>}</div>
    <div className="xm-preparation-actions" aria-label="这项任务的准备模板">{Object.entries(kindNames).map(([key, label]) => <JrpgButton key={key} variant={kind === key ? undefined : 'ghost'} disabled={busy} onClick={() => { setKind(key as PreparationKind); setEditing(false) }}>{label}{rules.some(r => r.taskId === task.id && r.kind === key) ? ' · 已配置' : ''}</JrpgButton>)}</div>
    {rule ? <p>{kindNames[rule.kind]} · {rule.enabled ? '已授权' : '已暂停'} · {task.recurrence === 'none' ? '本次行动' : '跟随任务重复安排'}</p> : <p>建立一次约定，相关资料会安静放在这里。准备完成后，你的目标仍由你来推进。</p>}
    {globallyPaused && <p>所有准备已暂停，可在设置中恢复。</p>}
    {!editing && <div className="xm-preparation-actions">
      <JrpgButton variant="ghost" onClick={() => setEditing(true)} disabled={busy || ['done', 'shelved'].includes(task.status)}>{rule ? '调整准备要求' : '建立准备约定'}</JrpgButton>
      {rule && !rule.needsAuthorization && <JrpgButton variant="ghost" disabled={busy} onClick={() => void run(() => pausePreparation(rule.id, rule.enabled))}>{rule.enabled ? '暂停这条准备' : '恢复准备'}</JrpgButton>}
      {rule && !rule.needsAuthorization && <JrpgButton variant="ghost" disabled={busy} onClick={() => void run(() => invoke('revoke_preparation', { id: rule.id }))}>撤销这条授权</JrpgButton>}
      {rule?.kind === 'focus' && <JrpgButton disabled={busy} onClick={() => void startFocus()}>开始专注</JrpgButton>}
    </div>}
    {editing && <form onSubmit={e => { e.preventDefault(); void save() }}>
      <div className="xm-preparation-fields">
        <label>准备什么<PixelSelect value={kind} onChange={e => setKind(e.target.value as PreparationKind)}>{Object.entries(kindNames).map(([key, name]) => <option key={key} value={key}>{name}</option>)}</PixelSelect></label>
        <label>行动时间<PixelInput type="datetime-local" required value={startAt} onChange={e => setStartAt(e.target.value)} /></label>
        <label>提前几分钟<PixelInput type="number" min={0} max={10080} required value={lead} onChange={e => setLead(e.target.value)} /></label>
        <label>主题 / 学习目标<PixelInput required maxLength={400} value={config.topic} onChange={e => field('topic', e.target.value)} /></label>
        <label className="xm-preparation-wide">保存到已有目录<PixelInput required value={config.outputRoot} onChange={e => field('outputRoot', e.target.value)} placeholder="完整目录路径；每次在其中新建独立目录" /></label>
        <label className="xm-preparation-wide">已有资料{kind === 'study' ? '（至少一项）' : '（可选）'}<textarea aria-label="已有资料，每行一项" rows={3} value={sources} onChange={e => setSources(e.target.value)} placeholder="每行一个文件完整路径或网页链接" /></label>
      </div>
      {kind === 'writing' && <><label className="xm-preparation-check"><input type="checkbox" checked={config.search} onChange={e => field('search', e.target.checked)} />允许把主题发给 Crossref，检索候选参考文献</label><label>最多几篇<PixelInput type="number" min={1} max={20} value={config.referenceLimit} onChange={e => field('referenceLimit', Number(e.target.value))} /></label><small>只整理可核对的元数据与来源，全文许可另行检查；一次最多 20 篇，不调用付费模型。</small></>}
      {kind === 'study' && <><label>页码 / 章节<PixelInput value={config.reading} onChange={e => field('reading', e.target.value)} placeholder="指定当天的范围，不猜测教材" /></label><label>已有错题与反馈<textarea rows={3} maxLength={16000} value={config.mistakes} onChange={e => field('mistakes', e.target.value)} /></label><small>UTF-8 文本可生成原句核对练习；PDF 和网页保存材料入口与自查练习。</small></>}
      {kind === 'focus' && <div className="xm-preparation-fields"><label>专注分钟<PixelInput type="number" min={1} max={180} value={config.focusMin} onChange={e => field('focusMin', Number(e.target.value))} /></label><label>环境声<PixelSelect value={config.sound} onChange={e => field('sound', e.target.value as PreparationConfig['sound'])}><option value="none">安静</option><option value="rain">柔和雨声</option><option value="brown">低频环境声</option></PixelSelect></label><label className="xm-preparation-check"><input type="checkbox" checked={config.openSources} onChange={e => field('openSources', e.target.checked)} />我开始专注时打开指定本地资料</label><small>环境声在主窗口播放，只在你开始时启动；结束只停止本次声音，资料保留打开。网页入口请从原任务手动打开。</small></div>}
      <label className="xm-preparation-check"><input type="checkbox" checked={config.notify} onChange={e => field('notify', e.target.checked)} />准备完成时在主程序提醒我</label>
      <p className="xm-preparation-scope">授权范围：在上述目录下的新目录写准备文件、读取你指定的材料{kind === 'writing' && config.search ? '、进行候选文献检索' : ''}。只在本机应用运行时执行，完全退出后停止。覆盖原稿、删除、发送与提交需另外决定。</p>
      <div className="xm-preparation-actions"><JrpgButton type="submit" disabled={busy}>{busy ? '保存中…' : '授权，以后按这个准备'}</JrpgButton><JrpgButton variant="ghost" disabled={busy} onClick={() => setEditing(false)}>返回任务</JrpgButton></div>
    </form>}
    {latest && <PreparationOutput key={latest.id} run={latest} busy={busy} perform={run} />}
    {taskRuns.some(r => r.id !== latest?.id) && <details><summary>以前的准备与变更</summary>{taskRuns.filter(r => r.id !== latest?.id).slice(0, 12).map(r => <PreparationOutput key={r.id} run={r} busy={busy} perform={run} />)}</details>}
    {error && <p role="alert" className="xm-preparation-error">{error}</p>}
  </section>
}
function PreparationOutput({ run, busy, perform }: { run: PreparationRun; busy: boolean; perform: (job: () => Promise<unknown>) => Promise<void> }) {
  const result = readPreparationResult(run)
  const [history, setHistory] = useState<{ at: string; detail: string }[] | null>(null)
  const [preview, setPreview] = useState<{ name: string; text: string } | null>(null)
  return <article className="xm-preparation-output">
    <strong>{preparationLabels[run.state]}</strong> <small>{new Date(run.actionAt).toLocaleString('zh-CN')} · 第 {run.version} 版</small>
    {run.error && <p>{run.error}</p>}
    {result && <><p>{result.summary}</p><div className="xm-preparation-actions"><JrpgButton variant="ghost" disabled={busy} onClick={() => void perform(() => openPreparationArtifact(run.id))}>打开项目目录</JrpgButton>{result.artifacts.filter(a => a.name.endsWith('.md') || a.name.endsWith('.txt')).map(a => <button key={a.name} disabled={busy} onClick={() => void perform(async () => { const text = await invoke<string>('read_preparation_artifact', { id: run.id, name: a.name }); setPreview({ name: a.name, text }) })}>{({ 'START-HERE.md': '从这里开始', 'references/index.md': '候选文献', 'reading.md': '今日材料', 'exercises.md': '练习', 'mistakes.md': '错题', 'notes/questions.md': '待解决问题', 'materials/README.md': '已有资料', 'drafts/README.md': '草稿分区', 'goal-context.txt': '原任务反馈' } as Record<string, string>)[a.name] ?? a.name}</button>)}</div>
      {preview && <section aria-label="准备资料正文" className="xm-preparation-reader"><button onClick={() => setPreview(null)}>收起正文</button><button disabled={busy} onClick={() => void perform(() => openPreparationArtifact(run.id, preview.name))}>用其他程序打开</button><pre>{preview.text}</pre></section>}
      <details><summary>资料入口、来源与处理范围</summary><p>{result.scope}</p>{result.sources.map((s, i) => <p key={i}>{s.title ?? s.location ?? s.url} · {s.access === 'metadata' ? '仅元数据，未阅读全文' : s.access === 'link-only' ? '仅保存入口，未读取网页' : '指定本地文件'}{s.note ? ` · ${s.note}` : ''}{(s.url || s.location) && <button disabled={busy} onClick={() => void perform(() => invoke('open_preparation_source', { id: run.id, source: s.url ?? s.location }))}>打开资料来源</button>}</p>)}</details></>}
    {run.state === 'failed' && <JrpgButton variant="ghost" disabled={busy} onClick={() => void perform(() => retryPreparation(run.id))}>重试这次准备</JrpgButton>}
    <details onToggle={e => { if (e.currentTarget.open && !history) void invoke<{ at: string; detail: string }[]>('preparation_history', { id: run.id }).then(setHistory).catch(() => setHistory([{ at: '', detail: '执行记录暂时无法读取' }])) }}><summary>查看执行记录</summary><small>编号 {run.id} · 已尝试 {run.attempt} 次</small>{history?.map((h, i) => <p key={i}>{h.at ? new Date(h.at).toLocaleString('zh-CN') : ''} {h.detail}</p>)}</details>
  </article>
}
