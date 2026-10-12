import { useRef, useState } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { JrpgButton } from './JrpgButton'
export function BackupRestore() {
  const selection = useRef(0)
  const [backup, setBackup] = useState<{ format: string; tables: Record<string, unknown[]> } | null>(null)
  const [busy, setBusy] = useState(false), [message, setMessage] = useState('')
  return <div className="xm-preparation"><h3>恢复本地备份</h3><p>先选择备份查看内容，再决定恢复。恢复会替换本地记录；程序会先保存当前数据，准备与 Claw 接管恢复后保持暂停，文件范围需要重新授权。项目资料文件本身不包含在 JSON 备份中。</p>
    <input type="file" accept=".json,application/json" aria-label="选择 Xmission JSON 备份" disabled={busy} onChange={e => {
      const version = ++selection.current
      const file = e.target.files?.[0]; setBackup(null); setMessage('')
      if (!file) return
      if (file.size > 32 * 1024 * 1024) { setMessage('备份超过 32 MB'); return }
      void file.text().then(text => {
        const value = JSON.parse(text) as { format: string; tables: Record<string, unknown[]> }
        if (value.format !== 'xmission-backup-v1' || !Array.isArray(value.tables?.tasks) || !Array.isArray(value.tables?.settings)) throw new Error('不是支持的 Xmission 备份')
        if (version === selection.current) setBackup(value)
      }).catch(error => { if (version === selection.current) setMessage(String(error)) })
    }} />
    {backup && <><p>任务 {backup.tables.tasks.length} 项 · 课程 {backup.tables.courses?.length ?? 0} 项 · 准备约定 {backup.tables.preparation_rules?.length ?? 0} 条</p><JrpgButton variant="danger" disabled={busy} onClick={() => { setBusy(true); setMessage(''); void invoke<string>('restore_json_backup', { document: backup }).then(result => { setMessage(result); setBackup(null) }).catch(e => setMessage(String(e))).finally(() => setBusy(false)) }}>{busy ? '正在恢复…' : '保存当前备份，并用这份记录恢复'}</JrpgButton><JrpgButton variant="ghost" disabled={busy} onClick={() => setBackup(null)}>取消</JrpgButton></>}
    {message && <p role="status" style={{ overflowWrap: 'anywhere' }}>{message}</p>}
  </div>
}
