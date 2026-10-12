import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
import {createServer} from 'vite';
import React,{act} from 'react';
const dom=new JSDOM('<div class="xm-shell">Real task page</div><div id="root"></div>',{url:'http://localhost/'});
for(const key of ['window','document','HTMLElement','Event','CustomEvent','Image','localStorage'])globalThis[key]=dom.window[key];
globalThis.IS_REACT_ACT_ENVIRONMENT=true;dom.window.matchMedia=()=>({matches:true,addEventListener(){},removeEventListener(){}});
// Image loading is the browser boundary; render the real React journey and native img elements.
let delayedImageSrc,releaseDecode,holdTargetSave=false,releaseTargetSave,failTargetSave=false;
globalThis.Image=class{set src(src){this._src=src;queueMicrotask(()=>this.onload?.());}get src(){return this._src;}decode(){return this.src===delayedImageSrc?new Promise(resolve=>releaseDecode=resolve):Promise.resolve();}};
dom.window.HTMLMediaElement.prototype.pause=function(){Object.defineProperty(this,'paused',{value:true,configurable:true});};
dom.window.HTMLMediaElement.prototype.play=function(){Object.defineProperty(this,'paused',{value:false,configurable:true});return Promise.resolve();};
const {createRoot}=await import('react-dom/client');
const settings={first_experience_eligible:'true'};const calls=[];let id=0;const tasks=[];
let failTest=true;
dom.window.__TAURI_EVENT_PLUGIN_INTERNALS__={unregisterListener(){}};
dom.window.__TAURI_INTERNALS__={metadata:{currentWindow:{label:'main'},currentWebview:{label:'main'}},transformCallback(){return ++id;},async invoke(name,args={}){
  calls.push({name,args});if(name==='plugin:event|listen')return ++id;if(name==='plugin:event|unlisten')return;
  if(name==='onboarding_scene')return;
  if(name==='get_settings')return {...settings};if(name==='set_setting'){
    if(failTargetSave&&args.key==='first_experience_v2'&&JSON.parse(args.value).stage==='task'){failTargetSave=false;throw 'fixture save rejected';}
    if(holdTargetSave&&args.key==='first_experience_v2'&&JSON.parse(args.value).stage==='task'){holdTargetSave=false;await new Promise(resolve=>releaseTargetSave=resolve);}
    settings[args.key]=args.value;return;
  }
  if(name==='get_llm_config')return {baseUrl:'https://example.invalid/v1',model:'test-model',hasKey:true};
  if(name==='set_llm_config')return;if(name==='test_llm_connection'){if(failTest)throw '真实连接失败';return 'verified-model';}
  if(name==='claw_status')return {phase:'idle',message:'尚未连接',mcpConnected:false,qqConnected:false,qqBound:false};
  if(name==='claw_action')return {phase:'idle',message:'尚未连接',mcpConnected:false,qqConnected:false,qqBound:false};
  if(name==='list_tasks')return tasks;
  if(name==='get_first_task')return tasks.find(t=>t.sessionId===args.sessionId)??null;
  if(name==='create_first_task'){const prior=tasks.find(t=>t.sessionId===args.sessionId);if(prior)return prior;const task={...args.input,sessionId:args.sessionId,id:'first-task',status:'open',recurrence:'none'};tasks.push(task);settings.first_experience_v2=JSON.stringify({version:2,sessionId:args.sessionId,taskId:task.id,stage:'tutorial',tutorial:0});return task;}
  throw Error('Unexpected fixture command: '+name);
}};
const server=await createServer({configFile:'./vite.config.ts',configLoader:'runner',optimizeDeps:{noDiscovery:true,include:[],entries:[]},server:{middlewareMode:true,hmr:false,watch:{ignored:['**/src-tauri/target/**','**/.release-tools/**','**/releases/**']}},appType:'custom'});
const root=createRoot(document.getElementById('root'));const navigations=[];
const warnings=[];const originalError=console.error;console.error=(...args)=>{warnings.push(args.join(' '));originalError(...args);};
const click=async label=>{const button=[...document.querySelectorAll('button')].find(b=>b.textContent.includes(label));assert.ok(button,'Button exists: '+label);assert.equal(button.disabled,false);await act(async()=>{button.click();});};
try{
  const {FirstExperience}=await server.ssrLoadModule('/src/onboarding/FirstExperience.tsx');
  await act(async()=>root.render(React.createElement(FirstExperience,{navigate:(...args)=>navigations.push(args)})));
  assert.ok(document.querySelector('[role=dialog]'));assert.equal(document.querySelector('.xm-shell').inert,true);
  assert.ok(!document.body.textContent.includes('归途驿站'));assert.ok(!document.querySelector('.inn-motion'));
  await click('推开门');await click('看看信上的地址');assert.equal(document.querySelectorAll('.inn-map-pin').length,4);
  await click('灰钟高地');assert.ok(document.body.textContent.includes('第十三声钟'));
  await click('合上航图');await click('保存并测试');assert.ok(document.body.textContent.includes('真实连接失败'));
  assert.equal([...document.querySelectorAll('button')].some(b=>b.textContent==='继续'),false,'failed API cannot be marked connected');
  failTest=false;await click('保存并测试');assert.ok(document.body.textContent.includes('连接已验证'));await click('继续');
  assert.equal(document.querySelector('.inn-success'),null,'idle Claw is not ready');await click('稍后连接');
  const qr=[...document.querySelectorAll('button')].find(b=>b.textContent.includes('显示 QQ'));assert.equal(qr.disabled,true);
  await click('稍后连接');
  assert.ok(document.querySelector('.inn-journey'),'configuration opens the picture journey');
  assert.equal(document.querySelector('textarea'),null,'first task waits until the journey finishes or is skipped');
  await click('跳过旅行');
  const textarea=document.querySelector('textarea');await act(async()=>{const setter=Object.getOwnPropertyDescriptor(dom.window.HTMLTextAreaElement.prototype,'value').set;setter.call(textarea,'归还图书');textarea.dispatchEvent(new Event('input',{bubbles:true}));});
  await click('先手动记一行');await click('确认，记进账簿');
  assert.equal(tasks.length,1);assert.equal(document.querySelector('.xm-shell').inert,false);
  assert.ok(document.querySelector('.inn-tutorial'));assert.ok(navigations.some(n=>n[0]==='tasks'&&n[1]==='first-task'));
  await click('−');assert.ok(document.querySelector('.inn-tutorial-folded'));await click('继续交接');
  assert.equal(calls.some(c=>c.name==='complete_task'),false,'tutorial never auto-completes');
  await click('下一项');await click('下一项');await click('下一项');await click('下一项');await click('交接完成');await click('回到 Xmission');
  assert.equal(JSON.parse(settings.first_experience_v2).stage,'done');assert.equal(document.querySelector('[role=dialog]'),null);
  await act(async()=>window.dispatchEvent(new CustomEvent('onboarding:open',{detail:'claw'})));
  assert.ok(document.body.textContent.includes('让书记在这里值班'));assert.equal(tasks.length,1,'reopen preserves tasks');
  await click('暂时离开');assert.equal(JSON.parse(settings.first_experience_v2).stage,'claw');
  const {setSetting}=await server.ssrLoadModule('/src/api/settings.ts');
  await setSetting('first_experience_v2',JSON.stringify({version:2,sessionId:'resumed-journey',stage:'journey',journeyFrame:15}));
  await act(async()=>root.render(React.createElement(FirstExperience,{key:'journey-resume',navigate:(...args)=>navigations.push(args)})));
  assert.ok(document.querySelector('.inn-journey'));assert.ok(document.querySelector('.inn-journey img').src.endsWith('/06-glass-sea-1.png'),'restart resumes the saved scene');
  await click('暂时离开');assert.equal(JSON.parse(settings.first_experience_v2).journeyFrame,15,'leaving preserves the displayed frame');assert.equal(document.querySelector('.xm-shell').inert,false);
  // A late image checkpoint must not overwrite the queued task-stage save.
  delayedImageSrc='/onboarding/journey-comic/nine/06-glass-sea-1.png';
  await act(async()=>root.render(React.createElement(FirstExperience,{key:'pending-skip',navigate:(...args)=>navigations.push(args)})));
  holdTargetSave=true;await click('跳过旅行');assert.ok(releaseTargetSave);
  await act(async()=>{delayedImageSrc=undefined;releaseDecode();});
  await act(async()=>releaseTargetSave());
  assert.equal(JSON.parse(settings.first_experience_v2).stage,'task','late decoding cannot regress saved progress after skip');
  assert.ok(document.querySelector('textarea'));await click('暂时离开');
  await setSetting('first_experience_v2',JSON.stringify({version:2,sessionId:'retry-journey',stage:'journey',journeyFrame:5}));
  await act(async()=>root.render(React.createElement(FirstExperience,{key:'retry-departure',navigate:(...args)=>navigations.push(args)})));
  failTargetSave=true;await click('跳过旅行');assert.ok(document.querySelector('.inn-journey'));assert.ok(document.body.textContent.includes('fixture save rejected'));
  await click('跳过旅行');assert.equal(JSON.parse(settings.first_experience_v2).stage,'task','failed save releases the departure guard for retry');
  await click('暂时离开');
  assert.equal(warnings.length,0,'No React key errors during scene changes');
  console.log('Actual React flow: map, API retry, truthful service status, journey skip/resume, real task confirmation and teaching passed.');
}finally{await act(async()=>root.unmount());await server.close();dom.window.close();console.error=originalError;}
