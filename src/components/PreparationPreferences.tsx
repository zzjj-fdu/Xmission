import { useState } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { usePreparationStore } from '../store/preparation'
import { useTasksStore } from '../store/tasks'
import { QuestPanel } from './QuestPanel'
import { JrpgButton } from './JrpgButton'
import { openPreparationArtifact, preparationLabels, readPreparationResult } from '../api/preparation'
import './preparation.css'
export function PreparationPreferences() {
  const home = usePreparationStore(), tasks = useTasksStore(s => s.tasks)
  const [error, setError] = useState(''), [busy, setBusy] = useState(false)
  return <QuestPanel><h3>安静准备</h3>
    <div className="xm-preparation"><p>在原任务详情中建立准备约定，资料会直接附在任务上。写作、学习与专注各有明确范围，关闭宠物不会停止准备。</p>
      <p>{home.boundary || '主程序进程或托盘运行时准备；完全退出或设备休眠时停止，恢复后补做有效安排。'}</p>
      <JrpgButton variant="ghost" disabled={busy} onClick={() => { setBusy(true); setError(''); void invoke('pause_all_preparations', { paused: !home.paused }).then(home.refresh).catch(e => setError(String(e))).finally(() => setBusy(false)) }}>{home.paused ? '恢复所有准备' : '全部暂停'}</JrpgButton>
      {home.rules.length ? home.rules.map(rule => {
        const latest = home.runs.find(r => r.ruleId === rule.id && r.version === rule.version)
        return <div key={rule.id} className="xm-preparation-output"><button onClick={() => window.dispatchEvent(new CustomEvent('preparation:task', { detail: rule.taskId }))}>{tasks.find(t => t.id === rule.taskId)?.title ?? '打开关联任务'}</button><small> · {rule.enabled ? latest ? preparationLabels[latest.state] : '等待准备' : '已暂停'}</small></div>
      }) : <p>还没有准备约定。打开一项任务，从“行动之前，先备好”开始。</p>}
      {home.runs.some(r => r.resultJson) && <details><summary>历史准备结果</summary>{home.runs.filter(r => r.resultJson).slice(0, 20).map(r => <div className="xm-preparation-output" key={r.id}><strong>{readPreparationResult(r)?.summary ?? '历史产物'}</strong><small> · {preparationLabels[r.state]} · 第 {r.version} 版</small><button disabled={busy} onClick={() => { setBusy(true); setError(''); void openPreparationArtifact(r.id).catch(e => setError(String(e))).finally(() => setBusy(false)) }}>打开保留的目录</button></div>)}</details>}
      {(home.error || error) && <p role="alert" className="xm-preparation-error">{error || home.error}</p>}
      <details><summary>运行与接入范围</summary><p>本机模板可以独立运行，无需 Claw 或付费模型。Claw 保持已授权的任务增改删权限，并可查看、暂停、恢复和重试现有准备。新的文件或资料范围通过原任务授权。</p><p>联网参考检索使用 Crossref；当前保存来源与候选索引，不自动下载论文全文。学习的 PDF / 网页目前保留资料入口。环境声由主窗口生成，外部音乐软件联动另行验证。</p></details>
    </div>
  </QuestPanel>
}
