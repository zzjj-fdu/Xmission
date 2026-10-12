export const versions = Object.freeze({ openclaw: '2026.9.9', client: '2026.9.9', qqbot: '2.0.4', connector: '1.2.0', qr: '1.5.4' });
export function buildConfig(input, previous, token, workspace, port) {
  const next = structuredClone(previous ?? {});
  const endpoint=input.baseUrl.replace(/\/$/,'');const responses=endpoint.endsWith('/responses');
  next.gateway = { ...next.gateway, mode: 'local', bind: 'loopback', port, auth: { mode: 'token', token }, reload: { mode: 'hybrid' } };
  next.models = { ...next.models, mode: 'merge', providers: { ...next.models?.providers, xmission: { baseUrl: responses?endpoint.slice(0,-10):endpoint, apiKey: '${XMISSION_MODEL_KEY}', api: responses?'openai-responses':'openai-completions', models: [{ id: input.model, name: input.model, input: ['text'], contextWindow: 32768, maxTokens: 4096 }] } } };
  next.agents = { ...next.agents, defaults: { ...next.agents?.defaults, workspace, skipBootstrap: true, model: { primary: `xmission/${input.model}` } } };
  const servers=structuredClone(input.mcp.mcp.servers);
  servers.xmission.headers={...servers.xmission.headers,Authorization:'Bearer ${XMISSION_MCP_TOKEN}'};
  next.mcp = { ...next.mcp, servers: { ...next.mcp?.servers, ...servers } };
  next.plugins = { ...next.plugins, allow: [...new Set([...(next.plugins?.allow ?? []).filter(id=>id!=='qqbot'), 'openclaw-qqbot'])] };
  return next;
}
export function channelReady(raw) {
  const accounts = raw?.channelAccounts?.qqbot;
  return Array.isArray(accounts) && accounts.some(a => a.connected === true && a.running === true);
}
export function publicStatus(s) {
  return { phase: s.phase ?? 'idle', message: s.message ?? '尚未连接', mcpConnected: s.mcpConnected === true, qqConnected: s.qqConnected === true, qqBound: s.qqBound === true, qrDataUrl: s.qrDataUrl ?? null, error: s.error ?? null, progress: Number.isFinite(s.progress) ? Math.max(0,Math.min(100,s.progress)) : null };
}
export function acceptRequest(req, secret, port) {
  return !req.headers.origin && req.headers.host === `127.0.0.1:${port}` && req.headers.authorization === `Bearer ${secret}`;
}
export async function probeMcp(server,fetcher=fetch){
  try{
    const url=new URL(server.url);if(url.hostname!=='127.0.0.1')return false;
    const headers={'Content-Type':'application/json',Accept:'application/json, text/event-stream',...server.headers};
    const rpc=async(method,params,id)=>{const response=await fetcher(server.url,{method:'POST',headers,redirect:'error',signal:AbortSignal.timeout(6000),body:JSON.stringify({jsonrpc:'2.0',id,method,params})});if(!response.ok)throw Error('MCP unavailable');const raw=await response.json();if(raw.error||!raw.result)throw Error('Invalid MCP response');return raw.result;};
    const initialized=await rpc('initialize',{protocolVersion:'2025-11-25',capabilities:{},clientInfo:{name:'Xmission supervisor',version:'0.67.0'}},1);
    if(!initialized.protocolVersion)return false;headers['MCP-Protocol-Version']=initialized.protocolVersion;
    const result=await rpc('tools/list',{},2);return Array.isArray(result.tools)&&result.tools.some(t=>typeof t.name==='string'&&t.name.startsWith('xmission_'));
  }catch{return false;}
}
