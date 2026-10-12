// Owned supervisor. Credentials arrive over inherited stdin, never argv or UI.
import http from 'node:http';
import net from 'node:net';
import { spawn } from 'node:child_process';
import { randomBytes, generateKeyPairSync, createHash, createPublicKey, sign } from 'node:crypto';
import { mkdir, readFile, writeFile, rename } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { versions, buildConfig, channelReady, publicStatus, acceptRequest,probeMcp } from './claw-core.mjs';

const root = dirname(fileURLToPath(import.meta.url));
const prefix = join(root, 'packages'); const stateDir = join(root, 'state'); const workspace = join(root, 'workspace');
const configFile = join(stateDir, 'openclaw.json');
let input, gateway, client, disposer, job, gatewayToken, stopping = false, activeQr = 0;
let connectionEpoch=0;
const operations=new Set();
let state = publicStatus({phase:'idle',message:'尚未连接'});
const wait = ms => new Promise(r => setTimeout(r, ms));
const env = () => ({ ...Object.fromEntries(Object.entries(process.env).filter(([name])=>!name.startsWith('OPENCLAW_'))), OPENCLAW_STATE_DIR:stateDir, OPENCLAW_CONFIG_PATH:configFile, OPENCLAW_NO_RESPAWN:'1', ...(gatewayToken?{OPENCLAW_GATEWAY_TOKEN:gatewayToken}:{}), DISABLE_BONJOUR:'1', EXEC_SHELL_SNAPSHOT:'0', XMISSION_MODEL_KEY:input.apiKey, XMISSION_MCP_TOKEN:input.mcp.mcp.servers.xmission.headers.Authorization.replace(/^Bearer /,''), PATH:dirname(process.execPath)+(process.platform==='win32'?';':':')+process.env.PATH });
const readJson = async path => { try { return JSON.parse(await readFile(path,'utf8')); } catch(e) { if(e.code==='ENOENT') return {}; throw e; } };
async function atomicJson(path, value) { const temp = `${path}.pending`; await writeFile(temp, JSON.stringify(value,null,2), {mode:0o600}); await rename(temp,path); }
async function unusedPort() { const s = net.createServer(); await new Promise((resolve,reject)=>{s.once('error',reject);s.listen(0,'127.0.0.1',resolve);}); const port=s.address().port; await new Promise(r=>s.close(r)); return port; }
async function run(args, {npm=false, timeout=600000}={}) {
  const executable = npm ? join(dirname(process.execPath),process.platform==='win32'?'node_modules/npm/bin/npm-cli.js':'../lib/node_modules/npm/bin/npm-cli.js') : join(prefix,'node_modules/openclaw/openclaw.mjs');
  return await new Promise((resolve,reject) => {
    const child=spawn(process.execPath,[executable,...args],{cwd:root,env:env(),windowsHide:true,stdio:['ignore','pipe','pipe']});
    operations.add(child);child.once('exit',()=>operations.delete(child));
    let output=''; child.stdout.on('data',d=>{if(output.length<1000000)output+=d.toString();}); child.stderr.resume();
    const timer=setTimeout(()=>{child.kill();reject(Error('operation timed out'));},timeout);
    child.once('error',()=>{clearTimeout(timer);reject(Error('cannot start component'));});
    child.once('exit',code=>{clearTimeout(timer);code===0?resolve(output):reject(Error(`component exited ${code}`));});
  });
}
async function install() {
  state={...state,phase:'preparing',progress:40,message:'正在下载 OpenClaw 与 QQ 组件…',error:null,mcpConnected:false,qqConnected:false};
  await mkdir(prefix,{recursive:true});
  const installed=await readJson(join(prefix,'node_modules/openclaw/package.json'));
  if(installed.version!==versions.openclaw || (await readJson(join(prefix,'node_modules/@tencent-connect/openclaw-qqbot/package.json'))).version!==versions.qqbot || (await readJson(join(prefix,'node_modules/@openclaw/gateway-client/package.json'))).version!==versions.client || (await readJson(join(prefix,'node_modules/@tencent-connect/qqbot-connector/package.json'))).version!==versions.connector || (await readJson(join(prefix,'node_modules/qrcode/package.json'))).version!==versions.qr) {
    await run(['install','--prefix',prefix,'--no-audit','--no-fund','--registry=https://registry.npmjs.org',`openclaw@${versions.openclaw}`,`@openclaw/gateway-client@${versions.client}`,`@tencent-connect/openclaw-qqbot@${versions.qqbot}`,`@tencent-connect/qqbot-connector@${versions.connector}`,`qrcode@${versions.qr}`],{npm:true});
  }
}
async function loadPackage(name) { return import(pathToFileURL(join(prefix,'node_modules',name, name==='@openclaw/gateway-client'?'dist/index.mjs':name==='@tencent-connect/qqbot-connector'?'dist/esm/index.js':'lib/index.js')).href); }
async function deviceIdentity() {
  const path=join(stateDir,'xmission-device.json'); const saved=await readJson(path); if(saved.privateKeyPem) return saved;
  const {privateKey,publicKey}=generateKeyPairSync('ed25519'); const publicKeyPem=publicKey.export({type:'spki',format:'pem'}).toString();
  const raw=createPublicKey(publicKeyPem).export({type:'spki',format:'der'}).subarray(-32);
  const identity={deviceId:createHash('sha256').update(raw).digest('hex'),privateKeyPem:privateKey.export({type:'pkcs8',format:'pem'}).toString(),publicKeyPem};
  await atomicJson(path,identity); return identity;
}
async function connect(token,port) {
  const { GatewayClient }=await loadPackage('@openclaw/gateway-client'); const identity=await deviceIdentity();
  return new Promise((resolve,reject)=>{
    // First-run plugin loading can exceed 90 seconds before websocket handshakes become available.
    // The owned supervisor remains cancellable throughout this readiness wait.
    const timer=setTimeout(()=>reject(Error('gateway readiness timeout')),180000);
    client=new GatewayClient({url:`ws://127.0.0.1:${port}`,token,clientName:'cli',clientDisplayName:'Xmission',clientVersion:'0.67.0',mode:'cli',role:'operator',scopes:['operator.admin'],deviceIdentity:identity,
      hostDeps:{signDevicePayload:(pem,payload)=>sign(null,Buffer.from(payload),pem).toString('base64url'),publicKeyRawBase64UrlFromPem:pem=>createPublicKey(pem).export({type:'spki',format:'der'}).subarray(-32).toString('base64url')},
      onHelloOk:()=>{connectionEpoch++;clearTimeout(timer);resolve();if(!job&&state.phase==='ready')void probe().catch(()=>{state.mcpConnected=false;state.error='连接恢复后检查暂未通过，可以重新检查连接。';});},onConnectError:()=>{},onClose:()=>{connectionEpoch++;state.mcpConnected=false;state.qqConnected=false;if(!stopping)state.message='书记连接暂时中断，正在尝试恢复…';}});
    client.start();
  });
}
async function stopGateway() {
  stopping=true; disposer?.();disposer=undefined;activeQr++;state.qrDataUrl=null;
  if(client){await client.stopAndWait({timeoutMs:3000});client=undefined;}
  if(gateway && gateway.exitCode===null){const child=gateway;child.kill();await Promise.race([new Promise(r=>child.once('exit',r)),wait(5000)]);if(child.exitCode===null)child.kill('SIGKILL');}
  gateway=undefined;state={...state,phase:'stopped',mcpConnected:false,qqConnected:false,message:'书记已停止值班'};stopping=false;
}
async function probe() {
  const epoch=connectionEpoch;
  try {
  if(!client || !gateway || gateway.exitCode!==null){state.mcpConnected=false;state.qqConnected=false;return;}
  await client.request('health',{});
  // An actual OpenClaw MCP client discovery, rather than a saved-config assertion.
  const diagnosis=await run(['mcp','probe','xmission','--json'],{timeout:45000});
  const raw=JSON.parse(diagnosis.slice(diagnosis.indexOf('{')));
  state.mcpConnected=raw.servers?.xmission?.tools>0 && raw.diagnostics?.length===0;
  if(!state.mcpConnected) throw Error('MCP probe did not verify');
  const channels=await client.request('channels.status',{probe:true}); state.qqConnected=channelReady(channels);
  if(epoch!==connectionEpoch||!client.connected)throw Error('connection changed during probe');
  state.phase='ready';state.progress=100;state.error=null;state.message=state.qqConnected?'书记、任务账簿与 QQ 都已连接':'书记已接通，Xmission 任务工具已验证';
  }catch(e){state.mcpConnected=false;state.message='任务账簿的连接检查未通过';state.error='请检查 Xmission 的本地连接，或重新连接书记。';throw e;}
}
async function start(prepare) {
  await stopGateway(); if(prepare)await install();
  state={...state,phase:'starting',progress:70,error:null,message:'正在保存 AI 与任务工具配置…'};
  await mkdir(stateDir,{recursive:true});await mkdir(workspace,{recursive:true});
  // Fix first-start canonical-path identity on native Windows without changing upstream code.
  await mkdir(join(stateDir,'state'),{recursive:true});
  try{await writeFile(join(stateDir,'state','openclaw.sqlite'),'',{flag:'wx',mode:0o600});}catch(e){if(e.code!=='EEXIST')throw e;}
  const previous=await readJson(configFile); const token=previous.gateway?.auth?.token ?? randomBytes(32).toString('hex'); const port=await unusedPort();
  gatewayToken=token;
  const config=buildConfig(input,previous,token,workspace,port);
  config.plugins.load={paths:[join(prefix,'node_modules/@tencent-connect/openclaw-qqbot')]};
  await atomicJson(configFile,config);state.qqBound=Object.values(config.channels?.qqbot?.accounts??{}).some(a=>a.appId&&a.clientSecret);
  await writeFile(join(workspace,'AGENTS.md'),'你是 Xmission 的书记，帮助当前用户记录、查询与整理个人任务。使用 xmission MCP 工具获取真实数据，执行成功后才报告完成。用户没要求时不要主动删除任务，也不要杜撰完成或奖励。用简洁中文交流。不要把角色故事当成用户的真实任务。\n',{flag:'w'});
  state={...state,progress:85,message:'正在启动 OpenClaw 服务…'};
  gateway=spawn(process.execPath,[join(prefix,'node_modules/openclaw/openclaw.mjs'),'gateway','run','--port',String(port),'--bind','loopback'],{cwd:root,env:env(),windowsHide:true,stdio:['ignore','pipe','pipe']});
  gateway.stdout.resume();gateway.stderr.resume();gateway.once('error',()=>{state={...state,phase:'error',message:'无法启动书记',error:'请重新准备运行环境',mcpConnected:false};});
  gateway.once('exit',code=>{if(!stopping){state={...state,phase:'error',message:'书记已离线',error:`后台运行结束（${code ?? '已终止'}），可重新连接`,mcpConnected:false,qqConnected:false};}});
  await connect(token,port);state={...state,progress:92,message:'正在验证 Xmission 任务工具连接…'};await probe();
}
function launch(prepare) {
  if(job)return;job=start(prepare).catch(async()=>{await stopGateway();state={...state,phase:'error',message:'配置没有完成',error:'下载、配置校验或连接检查失败。请检查网络与 AI 配置后重试。'};}).finally(()=>{job=undefined;});
  state={...state,phase:prepare?'preparing':'starting',progress:prepare?40:70,error:null,message:prepare?'正在下载 OpenClaw 与 QQ 组件…':'正在同步配置并连接…'};
}
async function qr() {
  if(!state.mcpConnected)throw Error('connect first');disposer?.();const generation=++activeQr;
  const {startQrConnect}=await loadPackage('@tencent-connect/qqbot-connector');const qrcode=(await loadPackage('qrcode')).default;
  state.error=null;state.message='正在获取 QQ 二维码…';
  disposer=startQrConnect({
    onQrDisplayed:url=>{void qrcode.toDataURL(url,{width:300,margin:2,errorCorrectionLevel:'M'}).then(data=>{if(generation===activeQr){state.qrDataUrl=data;state.message='请用手机 QQ 扫码并确认';}});},
    onQrExpired:()=>{if(generation===activeQr){state.qrDataUrl=null;state.message='二维码已过期，正在更新…';}},
    onFailure:()=>{if(generation===activeQr){state.qrDataUrl=null;state.error='QQ 授权没有完成，可以重新获取二维码。';}},
    onSuccess:credentials=>{if(generation!==activeQr)return;state.qrDataUrl=null;void bind(credentials).catch(()=>{state.error='QQ 凭据已返回，但写入或通道检查未完成，请重试连接。';});},
  },{displayQrCodeToConsole:false,source:'openclaw'});
}
async function bind(credentials) {
  if(!Array.isArray(credentials)||!credentials.length)throw Error('empty credentials');
  const accounts={};for(const c of credentials){if(!c.appId||!c.appSecret||!c.userOpenid)throw Error('missing scan identity');accounts[c.appId]={enabled:true,appId:c.appId,clientSecret:c.appSecret,dmPolicy:'allowlist',allowFrom:[c.userOpenid]};}
  const current=await client.request('config.get',{});
  await client.request('config.patch',{baseHash:current.hash,raw:JSON.stringify({channels:{qqbot:{enabled:true,accounts}}})});
  state.qqBound=true;state.message='账号已绑定，正在检查 QQ 通道…';
  for(let n=0;n<30;n++){await wait(2000);try{const raw=await client.request('channels.status',{probe:true});if(channelReady(raw)){state.qqConnected=true;state.error=null;state.message='QQ 机器人已在线，可以在 QQ 发一句话试试';return;}}catch{}}
  state.error='账号已绑定，但 QQ 通道尚未在线。请检查机器人平台授权和网络，再检查连接。';
}
process.stdin.setEncoding('utf8');let buffer='';
process.stdin.on('data',data=>{buffer+=data;if(input)return;const split=buffer.indexOf('\n');if(split<0)return;input=JSON.parse(buffer.slice(0,split));void boot();});
function shutdown(){for(const child of operations)child.kill();void stopGateway().finally(()=>process.exit(0));}
process.stdin.on('end',shutdown);
process.on('SIGTERM',shutdown);
let monitoring=false;
const healthTimer=setInterval(()=>{
  if(job||monitoring||state.phase!=='ready'||!client)return;monitoring=true;const owner=client,epoch=connectionEpoch;
  void Promise.allSettled([owner.request('health',{}),probeMcp(input.mcp.mcp.servers.xmission),owner.request('channels.status',{probe:false})]).then(([health,mcp,qq])=>{
    if(owner!==client||epoch!==connectionEpoch||!owner.connected||job||state.phase!=='ready')return;
    state.mcpConnected=health.status==='fulfilled'&&mcp.status==='fulfilled'&&mcp.value;
    state.qqConnected=qq.status==='fulfilled'&&channelReady(qq.value);
    if(!state.mcpConnected){state.message='任务账簿暂时离线';state.error='可以重新连接书记，恢复 Xmission 的任务工具。';}
    else{state.error=null;state.message=state.qqConnected?'书记、任务账簿与 QQ 都已连接':'书记已接通，Xmission 任务工具已验证';}
  }).finally(()=>{monitoring=false;});
},15000);healthTimer.unref();
async function boot(){
  const server=http.createServer(async(req,res)=>{
    const port=server.address().port;
    if(!acceptRequest(req,input.controlToken,port)){res.writeHead(403);res.end();return;}
    try{
      if(req.method==='GET' && req.url==='/status'){res.setHeader('Content-Type','application/json');res.end(JSON.stringify(publicStatus(state)));return;}
      if(req.method!=='POST'||req.url!=='/action'){res.writeHead(404);res.end();return;}
      let body='';for await(const piece of req){body+=piece;if(body.length>200000)throw Error('body too large');}const payload=JSON.parse(body);
      if(payload.input){input={...input,...payload.input};}
      switch(payload.action){case'prepare':launch(true);break;case'start':launch(false);break;case'stop':if(job)throw Error('preparing');await stopGateway();break;case'qr':await qr();break;case'cancelQr':activeQr++;disposer?.();disposer=undefined;state.qrDataUrl=null;break;case'check':await probe();break;default:throw Error('unknown action');}
      res.setHeader('Content-Type','application/json');res.end(JSON.stringify(publicStatus(state)));
    }catch{res.writeHead(400,{'Content-Type':'application/json'});res.end(JSON.stringify({error:'操作未完成，请检查连接状态后重试。'}));}
  });
  server.listen(0,'127.0.0.1',()=>{process.stdout.write(JSON.stringify({port:server.address().port})+'\n');});
}
