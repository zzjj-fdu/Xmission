import { useEffect, useState } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'
import { activeTheme } from '../themes'
import { QuestPanel } from './QuestPanel'
import { JrpgButton } from './JrpgButton'

interface AgentStatus {
  enabled: boolean
  running: boolean
  endpoint: string
  error: string | null
  toolCount: number
}
interface Activity { requestId: string; tool: string; at: string }
const labels: Record<string, string> = {
  xmission_create_task: '创建任务与子步骤', xmission_update_task: '编辑任务',
  xmission_complete_task: '完成任务', xmission_reopen_task: '撤销任务完成', xmission_delete_task: '删除任务',
  xmission_add_step: '添加子步骤', xmission_update_step: '编辑子步骤',
  xmission_complete_step: '完成子步骤', xmission_reopen_step: '撤销子步骤完成', xmission_delete_step: '删除子步骤',
  xmission_pause_preparation: '调整准备暂停状态', xmission_retry_preparation: '重试准备', xmission_prepare_due: '检查到期准备',
}
const { colors, font } = activeTheme

export function AgentConnectionPanel() {
  const [status, setStatus] = useState<AgentStatus | null>(null)
  const [port, setPort] = useState('43858')
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const [failed, setFailed] = useState(false)
  const [config, setConfig] = useState('')
  const [configKind, setConfigKind] = useState<'once' | 'mcp'>('once')
  const [activity, setActivity] = useState<Activity[]>([])

  useEffect(() => {
    let mounted = true
    const refresh = async () => {
      const [connection, recent] = await Promise.all([
        invoke<AgentStatus>('get_agent_status'), invoke<Activity[]>('get_agent_activity'),
      ])
      if (mounted) {
        setStatus(connection)
        setPort(new URL(connection.endpoint).port)
        setActivity(recent)
      }
    }
    void refresh().catch(e => { if (mounted) { setMessage(String(e)); setFailed(true) } })
    const subscribed = listen('agent-activity', () => {
      void invoke<Activity[]>('get_agent_activity').then(rows => { if (mounted) setActivity(rows) }).catch(() => {})
    })
    const restored = listen('backup-restored', () => { void refresh().catch(() => {}) })
    return () => { mounted = false; void subscribed.then(unlisten => unlisten()).catch(() => {}); void restored.then(unlisten => unlisten()).catch(() => {}) }
  }, [])

  const run = async (action: () => Promise<void>) => {
    setBusy(true); setMessage(''); setFailed(false)
    try { await action() }
    catch (e) {
      setMessage(String(e)); setFailed(true)
      const latest = await invoke<AgentStatus>('get_agent_status').catch(() => null)
      if (latest) setStatus(latest)
    }
    finally { setBusy(false) }
  }
  const connect = (enabled: boolean) => run(async () => {
    const number = enabled ? Number(port) : Number(new URL(status?.endpoint ?? 'http://127.0.0.1:43858/mcp').port)
    if (!Number.isInteger(number) || number < 1024 || number > 65535 || number === 43857) {
      throw new Error('请输入 1024–65535 的端口，43857 为应用保留端口')
    }
    setConfig('')
    setStatus(await invoke<AgentStatus>('set_agent_connection', { enabled, port: number }))
    setMessage(enabled ? '接管已开启。复制按需接管指引给 Claw，即使退出 Xmission 也能操作。' : '接管已关闭，按需调用与界面连接都无法继续操作任务。')
  })
  const getConfig = () => run(async () => {
    const value = await invoke<string>('get_agent_config')
    setConfigKind('mcp')
    setConfig(value)
    try { await navigator.clipboard.writeText(value); setMessage('连接配置已复制，合并到 Claw 的 MCP 设置即可。') }
    catch { setMessage('请从下面的配置框选择并复制。') }
  })
  const getOnceInstructions = () => run(async () => {
    const value = await invoke<string>('get_agent_once_instructions')
    setConfigKind('once'); setConfig(value)
    try { await navigator.clipboard.writeText(value); setMessage('按需接管指引已复制，贴给 Claw 后保存为长期指引即可。每次操作结束，后台进程自动退出。') }
    catch { setMessage('请从下面的指引框选择并复制给 Claw。') }
  })

  return <QuestPanel>
    <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginBottom: 12 }}>
      <h3 style={{ margin: 0, color: colors.accent, fontFamily: font.display, fontSize: 15 }}>本地 Claw 接管</h3>
      <span role="status" style={{ fontSize: 12, color: status?.running ? colors.accentAlt : colors.textMuted }}>
        {status?.enabled ? '● 按需接管已开启' : '○ 未开启'}
      </span>
    </div>
    <p style={{ color: colors.textMuted, lineHeight: 1.8, margin: '0 0 12px' }}>
      和你的 OpenClaw 对话，就能直接创建、编辑、完成、删除任务，或拆成多层子步骤。
      退出 Xmission 后也能按需操作；每次处理结束，后台进程自动退出。
      界面打开时同步更新，完成目标照常获得金币和经验。
    </p>
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
      <JrpgButton disabled={busy || !status} onClick={() => { void connect(true) }}>
        {status?.running ? '重新连接' : '开启任务接管'}
      </JrpgButton>
      <JrpgButton disabled={busy || !status?.enabled} onClick={() => { void getOnceInstructions() }}>复制按需接管指引</JrpgButton>
      <JrpgButton disabled={busy || !status?.running} variant="ghost" onClick={() => { void getConfig() }}>复制 MCP 连接配置</JrpgButton>
      <JrpgButton disabled={busy || !status?.running} variant="ghost" onClick={() => { void run(async () => setMessage(await invoke<string>('test_agent_connection'))) }}>检测本地连接</JrpgButton>
      {status?.enabled && <JrpgButton disabled={busy} variant="ghost" onClick={() => { void connect(false) }}>关闭接管</JrpgButton>}
    </div>
    {status?.error && <p role="alert" style={{ color: colors.danger, overflowWrap: 'anywhere' }}>{status.error}</p>}
    {message && <p role={failed ? 'alert' : 'status'} style={{ color: failed ? colors.danger : colors.accentAlt, overflowWrap: 'anywhere', fontSize: 12 }}>{message}</p>}
    {config && <div style={{ marginTop: 14 }}>
      <p style={{ color: colors.textMuted, fontSize: 12, lineHeight: 1.8 }}>
        {configKind === 'once'
          ? '把下面的指引贴给 Claw，并让它保存为 Xmission 技能或长期指引。先让它查看任务，再退出 Xmission 后创建一条测试任务。此方式需要 Claw 的本机执行能力。'
          : '在 OpenClaw 的设置 → MCP 中合并此配置，保留已有服务。配置含本机接管密钥；此连接在 Xmission 退出后停止。'}
      </p>
      <textarea aria-label={configKind === 'once' ? 'Claw 按需接管指引' : 'Claw 连接配置'} readOnly value={config} spellCheck={false}
        style={{ width: '100%', minHeight: 210, boxSizing: 'border-box', padding: 12, background: colors.panel, color: colors.text,
          border: `1px solid ${colors.border}`, fontFamily: 'monospace', fontSize: 12 }} />
      <JrpgButton variant="ghost" onClick={() => setConfig('')}>收起配置</JrpgButton>
    </div>}
    <details style={{ marginTop: 14, color: colors.textMuted, fontSize: 12 }}>
      <summary style={{ cursor: 'pointer' }}>连接选项与最近操作</summary>
      <p style={{ overflowWrap: 'anywhere' }}>{status?.endpoint}</p>
      <label style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 10 }}>
        本地连接端口
        <input aria-label="本地连接端口" type="number" min={1024} max={65535} value={port} disabled={busy}
          onChange={e => setPort(e.target.value)} style={{ width: 90, padding: 6, color: colors.text, background: colors.panel, border: `1px solid ${colors.border}` }} />
      </label>
      <p style={{ lineHeight: 1.8 }}>按需调用每次处理后自动退出，不保留后台进程。MCP 连接随界面程序运行，退出后停止。端口修改后点击重新连接，再复制新 MCP 配置。两种方式共用本机数据与接管开关。</p>
      <JrpgButton disabled={busy || !status} variant="ghost" onClick={() => { void run(async () => {
        setConfig('')
        setStatus(await invoke<AgentStatus>('reset_agent_token'))
        setMessage('密钥已重置，旧连接已失效。请复制新配置到 Claw。')
      }) }}>重置接管密钥</JrpgButton>
      <div style={{ marginTop: 16 }}>
        <strong>最近的任务操作</strong>
        {activity.length ? <ul style={{ paddingLeft: 18, lineHeight: 2 }}>
          {activity.map(item => <li key={item.requestId}>{labels[item.tool] ?? item.tool} · {new Date(item.at).toLocaleString()}</li>)}
        </ul> : <p>连接后，你在 Claw 中执行的任务操作会显示在这里。</p>}
      </div>
    </details>
  </QuestPanel>
}
