// Real OpenClaw + Tencent packages, isolated MCP/provider fixtures; no personal configuration.
import assert from 'node:assert/strict';
import http from 'node:http';
import {spawn} from 'node:child_process';
import {copyFile,readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {createPublicKey,sign,randomUUID} from 'node:crypto';
const root=resolve('.release-tools/claw-test');
for(const name of ['claw-core.mjs','claw-host.mjs'])await copyFile('src-tauri/resources/'+name,root+'/'+name);
// Preserve gateway diagnostics at the fixture boundary; production keeps output hidden.
const {writeFile}=await import('node:fs/promises');
const supervisor=await readFile(root+'/claw-host.mjs','utf8');
await writeFile(root+'/claw-host.mjs',supervisor
  .replace('gateway.stdout.resume();gateway.stderr.resume();',"gateway.stdout.on('data',data=>process.stderr.write(data));gateway.stderr.on('data',data=>process.stderr.write(data));")
  .replace('onConnectError:()=>{}',"onConnectError:e=>process.stderr.write('[fixture-connect] '+String(e?.message??e)+'\\n')"));
let discoveries=0;let calls=0;let available=true;const key='isolated-fixture-key';
let modelCalls=0,offeredTool;const offeredNames=new Set();
const provider=http.createServer(async(req,res)=>{
  let body='';for await(const c of req)body+=c;const request=JSON.parse(body);modelCalls++;
  const latestTool=request.messages?.filter(m=>m.role==='tool').at(-1);
  const toolText=typeof latestTool?.content==='string'?latestTool.content:JSON.stringify(latestTool?.content??'');
  const found=toolText.match(/"(?:id|name)"\s*:\s*"([^"]*xmission_list_tasks[^"]*)"/);
  const completed=calls>0;
  for(const t of request.tools??[])offeredNames.add(t.function?.name??t.name);
  offeredTool=request.tools?.find(t=>t.function?.name.includes('xmission_list_tasks'))?.function?.name??offeredTool;
  if(modelCalls<=2)console.log('Fixture model offered tools:',[...offeredNames]);
  if(found)offeredTool=found[1];
  const functionName=found?'tool_call':offeredTool??'tool_search';
  const args=found?{id:found[1],args:{}}:offeredTool?{}:{query:'xmission_list_tasks'};
  const message=completed||modelCalls>5?{role:'assistant',content:'账簿查询结束。'}:{role:'assistant',content:null,tool_calls:[{id:'fixture-call-'+modelCalls,type:'function',function:{name:functionName,arguments:JSON.stringify(args)}}]};
  if(latestTool&&modelCalls<=3)console.log('Fixture tool reply:',toolText.slice(0,1100));
  if(request.stream){res.writeHead(200,{'Content-Type':'text/event-stream'});const delta={...message};if(delta.tool_calls)delta.tool_calls=delta.tool_calls.map((c,index)=>({...c,index}));res.write('data: '+JSON.stringify({id:'fixture-completion',object:'chat.completion.chunk',created:Math.floor(Date.now()/1000),model:request.model,choices:[{index:0,delta,finish_reason:null}]})+'\n\n');res.write('data: '+JSON.stringify({id:'fixture-completion',object:'chat.completion.chunk',created:Math.floor(Date.now()/1000),model:request.model,choices:[{index:0,delta:{},finish_reason:completed?'stop':'tool_calls'}],usage:{prompt_tokens:20,completion_tokens:10,total_tokens:30}})+'\n\ndata: [DONE]\n\n');res.end();}
  else{res.writeHead(200,{'Content-Type':'application/json'});res.end(JSON.stringify({id:'fixture-completion',object:'chat.completion',created:Math.floor(Date.now()/1000),model:request.model,choices:[{index:0,message,finish_reason:completed?'stop':'tool_calls'}],usage:{prompt_tokens:20,completion_tokens:10,total_tokens:30}}));}
});await new Promise(r=>provider.listen(0,'127.0.0.1',r));
const mcp=http.createServer(async(req,res)=>{
  if(!available){res.writeHead(503);res.end();return;}
  if(req.headers.authorization!=='Bearer fixture-mcp-token'){res.writeHead(401);res.end();return;}
  if(req.method==='DELETE'){res.writeHead(200);res.end();return;}
  if(req.method!=='POST'){res.writeHead(405);res.end();return;}
  let body='';for await(const c of req)body+=c;const input=JSON.parse(body);
  if(input.id==null){res.writeHead(202);res.end();return;}
  let result;
  if(input.method==='initialize')result={protocolVersion:input.params.protocolVersion,capabilities:{tools:{listChanged:false}},serverInfo:{name:'Xmission integration fixture',version:'1'}};
  else if(input.method==='tools/list'){discoveries++;result={tools:[{name:'xmission_list_tasks',description:'List isolated fixture tasks',inputSchema:{type:'object',properties:{}},annotations:{readOnlyHint:true,destructiveHint:false,idempotentHint:true}}]};}
  else if(input.method==='tools/call'){calls++;result={content:[{type:'text',text:'{"tasks":[]}'}]};}
  else result={};
  res.writeHead(200,{'Content-Type':'application/json'});res.end(JSON.stringify({jsonrpc:'2.0',id:input.id,result}));
});
await new Promise(r=>mcp.listen(0,'127.0.0.1',r));
const node=root+'/runtime/node-v24.16.0-win-x64/node.exe';const child=spawn(node,[root+'/claw-host.mjs'],{cwd:root,windowsHide:true,stdio:['pipe','pipe','pipe']});
let stderr='';child.stderr.on('data',d=>{stderr+=d;if(process.env.XMISSION_CLAW_DIAGNOSE==='1')console.log(d.toString().replaceAll(key,'[fixture]'));});
const port=await new Promise((resolve,reject)=>{let body='';child.stdout.on('data',d=>{body+=d;const newline=body.indexOf('\n');if(newline>=0)resolve(JSON.parse(body.slice(0,newline)).port);});child.once('exit',code=>reject(Error('Supervisor exited '+code)));child.stdin.write(JSON.stringify({controlToken:'fixture-control-token',baseUrl:`http://127.0.0.1:${provider.address().port}/v1`,model:'fixture-model',apiKey:key,mcp:{mcp:{servers:{xmission:{url:`http://127.0.0.1:${mcp.address().port}/mcp`,transport:'streamable-http',enabled:true,headers:{Authorization:'Bearer fixture-mcp-token'},toolFilter:{include:['xmission_*']}}}}}})+'\n');});
const api=async(action)=>{const r=await fetch(`http://127.0.0.1:${port}/${action?'action':'status'}`,{method:action?'POST':'GET',headers:{Authorization:'Bearer fixture-control-token','Content-Type':'application/json'},...(action?{body:JSON.stringify({action})}:{})});assert.equal(r.status,200);return r.json();};
try{
  const forbidden=await fetch(`http://127.0.0.1:${port}/status`);assert.equal(forbidden.status,403);
  await api('prepare');let status;
  for(let n=0;n<100;n++){await new Promise(r=>setTimeout(r,2000));status=await api();if(status.phase==='ready'||status.phase==='error')break;}
  if(status.phase!=='ready'){
    const cfg=await readFile(root+'/state/openclaw.json','utf8').catch(()=>'(not written)');
    console.log('Failed status:',status,'MCP discoveries:',discoveries,'config sections:',Object.keys(JSON.parse(cfg)));
    console.log('Gateway diagnostics:',stderr.replaceAll(key,'[fixture]'));
    const env={...process.env,PATH:root+'/runtime/node-v24.16.0-win-x64;'+process.env.PATH,OPENCLAW_STATE_DIR:root+'/state',OPENCLAW_CONFIG_PATH:root+'/state/openclaw.json',XMISSION_MODEL_KEY:key,XMISSION_MCP_TOKEN:'fixture-mcp-token'};
    for(const args of [['config','validate'],['mcp','doctor','xmission','--probe','--json']]){
      const diagnostic=spawn(node,[root+'/packages/node_modules/openclaw/openclaw.mjs',...args],{cwd:root,env,windowsHide:true,stdio:['ignore','pipe','pipe']});
      let out='';diagnostic.stdout.on('data',d=>out+=d);diagnostic.stderr.on('data',d=>out+=d);await new Promise(r=>diagnostic.once('exit',r));console.log(out.replaceAll(key,'[fixture]'));
    }
  }
  assert.equal(status.phase,'ready');assert.equal(status.mcpConnected,true);assert.ok(discoveries>0);
  assert.equal(status.qqConnected,false);assert.ok(!JSON.stringify(status).includes(key));
  const config=JSON.parse(await readFile(root+'/state/openclaw.json','utf8'));assert.equal(config.models.providers.xmission.apiKey,'${XMISSION_MODEL_KEY}');
  const {GatewayClient}=await import(pathToFileURL(root+'/packages/node_modules/@openclaw/gateway-client/dist/index.mjs').href);
  const device=JSON.parse(await readFile(root+'/state/xmission-device.json','utf8'));
  let agentClient;await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('Test operator could not connect')),15000);agentClient=new GatewayClient({url:`ws://127.0.0.1:${config.gateway.port}`,token:config.gateway.auth.token,clientName:'cli',mode:'cli',role:'operator',scopes:['operator.admin'],deviceIdentity:device,hostDeps:{signDevicePayload:(pem,payload)=>sign(null,Buffer.from(payload),pem).toString('base64url'),publicKeyRawBase64UrlFromPem:pem=>createPublicKey(pem).export({type:'spki',format:'der'}).subarray(-32).toString('base64url')},onHelloOk:()=>{clearTimeout(timer);resolve();}});agentClient.start();});
  try{await agentClient.request('agent',{message:'请使用 Xmission 工具查询我的任务，然后用中文告诉我结果。',sessionKey:'agent:main:onboarding-fixture-'+randomUUID(),idempotencyKey:randomUUID()},{expectFinal:true,timeoutMs:90000});}finally{await agentClient.stopAndWait({timeoutMs:3000});}
  assert.ok(modelCalls>0,'real Gateway invoked configured model');assert.ok(offeredTool,'Xmission tool exposed to model');assert.ok(calls>0,'real agent invoked Xmission MCP tool');
  await api('stop');assert.equal((await api()).phase,'stopped');assert.equal((await api()).mcpConnected,false);
  await api('start');for(let n=0;n<60;n++){await new Promise(r=>setTimeout(r,1500));status=await api();if(status.phase==='ready'||status.phase==='error')break;}assert.equal(status.phase,'ready','owned gateway restarts');
  available=false;for(let n=0;n<25;n++){await new Promise(r=>setTimeout(r,1000));status=await api();if(!status.mcpConnected)break;}assert.equal(status.mcpConnected,false,'service loss cannot keep a green connection badge');
  available=true;for(let n=0;n<25;n++){await new Promise(r=>setTimeout(r,1000));status=await api();if(status.mcpConnected)break;}assert.equal(status.mcpConnected,true,'reachability recovers after service returns');
  console.log('Real OpenClaw readiness, model→MCP task query, credential boundary, stop and restart passed; QQ requires human scan.');
}finally{child.stdin.end();await Promise.race([new Promise(r=>child.once('exit',r)),new Promise(r=>setTimeout(r,12000))]);if(child.exitCode===null)child.kill();await new Promise(r=>mcp.close(r));await new Promise(r=>provider.close(r));assert.ok(!stderr.includes(key));}
