import { useEffect, useState } from 'react';
import { getLlmConfig, setLlmConfig, testLlmConnection, listLlmModels } from '../api/llm';
export function ApiSetup({ onContinue }: { onContinue: () => void }) {
  const [base, setBase] = useState(''); const [model, setModel] = useState(''); const [key, setKey] = useState('');
  const [hasKey, setHasKey] = useState(false); const [busy, setBusy] = useState(false); const [error, setError] = useState('');
  const [verified, setVerified] = useState(''); const [models, setModels] = useState<string[]>([]);
  useEffect(() => { let alive = true; void getLlmConfig().then(c => { if (alive) { setBase(c.baseUrl); setModel(c.model); setHasKey(c.hasKey); } }).catch(e => { if (alive) setError(String(e)); }); return () => { alive = false; }; }, []);
  const changed = () => { setVerified(''); setError(''); };
  async function saveAndCheck(scan = false) {
    if (busy) return; setBusy(true); setError(''); setVerified('');
    try {
      await setLlmConfig(base.trim(), model.trim(), key.trim()); setKey(''); setHasKey(true);
      if (scan) { const items = await listLlmModels(); setModels(items.map(v => v.id)); if (!items.length) throw Error('服务没有返回模型列表，可填写模型名称后测试。'); }
      else setVerified(await testLlmConnection());
    } catch (e) { setError(String(e)); } finally { setBusy(false); }
  }
  return <div className="inn-setup-card"><small>柜台 · 书记的墨水</small><h2>先让它听懂你。</h2><p>写下一句话，书记会把事情整理进账簿。连接你已有的 AI 服务，就能开始。</p>
    <form onSubmit={e => { e.preventDefault(); void saveAndCheck(); }}>
      <label>API 地址<input required type="url" value={base} onChange={e => { setBase(e.target.value); changed(); }} placeholder="https://你的服务地址/v1" /></label>
      <label>API Key<input type="password" autoComplete="off" value={key} onChange={e => { setKey(e.target.value); changed(); }} placeholder={hasKey ? '已保存，留空保留原密钥' : '粘贴服务商提供的密钥'} required={!hasKey} /></label>
      <label>模型<input required list="inn-models" value={model} onChange={e => { setModel(e.target.value); changed(); }} placeholder="服务商的模型名称" /><datalist id="inn-models">{models.map(m => <option key={m} value={m} />)}</datalist></label>
      <div className="inn-row"><button type="button" disabled={busy || !base || (!key && !hasKey)} onClick={() => void saveAndCheck(true)}>读取模型列表</button><button className="inn-primary" disabled={busy} type="submit">{busy ? '正在连接…' : '保存并测试'}</button></div>
    </form>
    {error && <p role="alert" className="inn-error">{error}</p>}{verified && <p role="status" className="inn-success">连接已验证 · {verified}</p>}
    <p className="inn-note">密钥保存在系统钥匙串。没有 API Key 也可以先手动记录任务，之后到设置补上。</p>
    <div className="inn-row"><button onClick={onContinue} disabled={busy}>稍后配置</button>{verified && <button className="inn-primary" onClick={onContinue}>继续</button>}</div>
  </div>;
}
