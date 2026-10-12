import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
import {createServer} from 'vite';
import React,{act} from 'react';
const dom=new JSDOM('<div id="root"></div>',{url:'http://localhost/'});
for(const key of ['window','document','HTMLElement','Event'])globalThis[key]=dom.window[key];
globalThis.IS_REACT_ACT_ENVIRONMENT=true;
const {createRoot}=await import('react-dom/client');
let status={phase:'idle',message:'尚未连接',mcpConnected:false,qqConnected:false,qqBound:false};
let releasePoll,releaseCancel,failCancel=false;
const pollTimers=[];window.setInterval=fn=>{pollTimers.push(fn);return pollTimers.length;};window.clearInterval=()=>{};
window.__TAURI_INTERNALS__={async invoke(name,{action}={}){
  if(name==='claw_status')return releasePoll?await new Promise(r=>releasePoll.resolve=r):{...status};
  if(name==='claw_action'){
    if(action==='cancel'){
      if(failCancel)throw Error('暂时无法取消');
      await new Promise(r=>releaseCancel=r);
      status={...status,phase:'cancelled',message:'配置已取消',progress:null};return {...status};
    }
    status={...status,phase:'preparing',message:'正在下载组件',progress:40};return {...status};
  }
  throw Error(name);
}};
const server=await createServer({configFile:false,esbuild:{jsx:'automatic'},optimizeDeps:{noDiscovery:true,include:[],entries:[]},server:{middlewareMode:true,hmr:false,watch:{ignored:['**/src-tauri/target/**','**/.release-tools/**','**/releases/**']}},appType:'custom'});
const root=createRoot(document.getElementById('root'));let continued=0;
const button=label=>[...document.querySelectorAll('button')].find(b=>b.textContent.includes(label));
try{
  const {ClawSetup}=await server.ssrLoadModule('/src/onboarding/ClawSetup.tsx');
  await act(async()=>root.render(React.createElement(ClawSetup,{qq:false,onContinue:()=>continued++})));
  await act(async()=>button('一键准备').click());
  assert.equal(document.querySelector('[role=progressbar]')?.getAttribute('aria-valuenow'),'40','render actual backend stage progress');
  assert.ok(button('取消配置'));assert.equal(button('取消配置').disabled,false);
  releasePoll={};await act(async()=>pollTimers.at(-1)());
  const stale={...status};
  await act(async()=>button('取消配置').click());
  assert.equal(button('稍后连接').disabled,true,'cannot leave while cancellation is pending');
  await act(async()=>releaseCancel());
  await act(async()=>releasePoll.resolve(stale));releasePoll=undefined;
  assert.ok(document.body.textContent.includes('配置已取消'),'late status poll cannot undo cancellation');
  assert.equal(document.querySelector('[role=progressbar]'),null);
  assert.equal(button('一键准备').disabled,false,'can retry after cancellation');
  await act(async()=>button('一键准备').click());
  failCancel=true;await act(async()=>button('取消配置').click());
  assert.ok(document.querySelector('[role=alert]'));assert.equal(button('取消配置').disabled,false,'failed cancellation can be retried');
  failCancel=false;
  await act(async()=>button('稍后连接').click());
  assert.equal(continued,0,'leaving waits for real cancellation');
  await act(async()=>releaseCancel());assert.equal(continued,1);
  console.log('OpenClaw stage progress, cancel/retry, stale polls and safe departure passed.');
}finally{await act(async()=>root.unmount());await server.close();dom.window.close();}
