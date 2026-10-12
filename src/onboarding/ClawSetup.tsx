import { useEffect, useRef, useState } from 'react';
import { clawAction, clawStatus, type ClawStatus } from './api';
export function ClawSetup({ qq, onContinue }: { qq: boolean; onContinue: () => void }) {
  const [status, setStatus] = useState<ClawStatus>(); const [error, setError] = useState(''); const [busy, setBusy] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const revision = useRef(0); const mounted = useRef(true); const actionPending = useRef(false);
  useEffect(() => {
    let active = true, polling = false; mounted.current = true;
    const poll = () => {
      if (polling || actionPending.current) return;
      polling = true; const version = revision.current;
      void clawStatus().then(s => { if (active && version === revision.current) setStatus(s); }).catch(e => { if (active && version === revision.current) setError(String(e)); }).finally(() => { polling = false; });
    };
    poll(); const timer = window.setInterval(poll, 800);
    return () => { active = false; mounted.current = false; revision.current++; window.clearInterval(timer); if (qq) void clawAction('cancelQr').catch(() => {}); };
  }, [qq]);
  async function act(action: Parameters<typeof clawAction>[0]) {
    if (actionPending.current) return; actionPending.current = true; const version = ++revision.current; setBusy(true); setError('');
    try { const s = await clawAction(action); if (mounted.current && version === revision.current) setStatus(s); } catch (e) { if (mounted.current && version === revision.current) setError(String(e)); } finally { actionPending.current = false; if (mounted.current) setBusy(false); }
  }
  const preparing = status?.phase === 'preparing' || status?.phase === 'starting';
  const stopping = cancelling || status?.phase === 'cancelling';
  async function cancel(leave = false) {
    if (actionPending.current || stopping) return;
    actionPending.current = true; const version = ++revision.current; setCancelling(true); setError('');
    try {
      const s = await clawAction('cancel');
      if (mounted.current && version === revision.current) { setStatus(s); if (leave && s.phase === 'cancelled' && !s.error) onContinue(); }
    } catch (e) { if (mounted.current && version === revision.current) setError(String(e)); }
    finally { actionPending.current = false; if (mounted.current) setCancelling(false); }
  }
  const progress = status?.progress;
  return <div className="inn-setup-card"><small>{qq ? '信箱 · QQ 联络' : '柜台 · 接通书记'}</small><h2>{qq ? '离开柜台，也能捎句话。' : '让书记在这里值班。'}</h2>
    <p>{qq ? '用手机 QQ 扫码，绑定你的机器人。之后可以在 QQ 上记录和查询 Xmission 任务。' : 'OpenClaw 会在后台运行，连接 Xmission 的任务工具，并使用刚才保存的 AI 配置。首次需要下载运行环境。'}</p>
    {!qq && <div className="inn-service-list"><span>AI 配置　→　OpenClaw</span><span>任务账簿　→　Xmission MCP</span><span>后台值班　→　随应用启动</span></div>}
    {qq && status?.qrDataUrl && <div className="inn-qr"><img src={status.qrDataUrl} alt="使用手机 QQ 扫描此二维码" /><span>请在手机 QQ 上完成确认</span></div>}
    <p role="status" className={status?.mcpConnected ? 'inn-success' : 'inn-note'}>{status?.message ?? '正在读取连接状态…'}</p>
    {!qq && (preparing || stopping || status?.mcpConnected) && <div className="inn-claw-progress">
      <div><span>{stopping ? '正在取消…' : '配置进度'}</span><span>{progress != null ? `${progress}%` : '准备中'}</span></div>
      <div className="inn-claw-progress-track" role="progressbar" aria-label="OpenClaw 配置进度" aria-valuemin={0} aria-valuemax={100} aria-valuenow={progress ?? undefined} aria-valuetext={status?.message}><span style={{ width: `${progress ?? 5}%` }} /></div>
    </div>}
    {(error || status?.error) && <p className="inn-error" role="alert">{error || status?.error}</p>}
    {status?.qqBound && !status.qqConnected && qq && <p className="inn-note">账号已绑定，正在检查机器人通道。绑定和实际在线是两个状态。</p>}
    <div className="inn-row">
      {!qq && <button className="inn-primary" disabled={busy || preparing || stopping} onClick={() => void act(status?.mcpConnected || status?.phase === 'stopped' ? 'start' : 'prepare')}>{preparing ? '正在准备…' : status?.mcpConnected ? '同步配置并重新连接' : '一键准备并连接'}</button>}
      {!qq && (preparing || stopping) && <button disabled={busy || stopping} onClick={() => void cancel()}>{stopping ? '正在取消…' : '取消配置'}</button>}
      {qq && <button className="inn-primary" disabled={busy || !status?.mcpConnected} onClick={() => void act('qr')}>{busy ? '正在获取…' : status?.qrDataUrl ? '刷新二维码' : '显示 QQ 二维码'}</button>}
      {qq && status?.qqBound && <button disabled={busy} onClick={()=>void act('check')}>检查连接</button>}
      {(qq ? status?.qqConnected : status?.mcpConnected) && <button className="inn-primary" onClick={onContinue}>继续</button>}
      <button disabled={busy || stopping} onClick={() => { if (!qq && preparing) void cancel(true); else onContinue(); }}>稍后连接</button>
    </div>
    {qq && !status?.mcpConnected && <p className="inn-note">需要先完成 OpenClaw 的后台连接，之后随时可以在设置里回来扫码。</p>}
    {!qq && <p className="inn-note">关闭主窗口后继续托盘值班，完整退出 Xmission 时结束。配置保存在应用专属目录。</p>}
  </div>;
}
