import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import ts from 'typescript';
import {JSDOM} from 'jsdom';
const url = async file => {
  let code=ts.transpileModule(await readFile(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText;
  if(code.includes("'./journeyFrames'"))code=code.replace("'./journeyFrames'",JSON.stringify(await url('src/onboarding/journeyFrames.ts')));
  return 'data:text/javascript;base64,'+Buffer.from(code).toString('base64');
};
const {createJourneyPlayer}=await import(await url('src/onboarding/journeyPlayer.ts'));
const {journeyFrames}=await import(await url('src/onboarding/journeyFrames.ts'));
assert.equal(journeyFrames.length,27);
for(const frame of journeyFrames){const png=await readFile('public'+frame.src);assert.equal(png.subarray(0,8).toString('hex'),'89504e470d0a1a0a','Packaged frame exists: '+frame.src);}
const flush=async()=>{for(let i=0;i<20;i++)await Promise.resolve();};
function fixture({initialFrame=0,motion=true,fail,hold,audio}={}){
  const dom=new JSDOM('<img id="a"><img id="b">');globalThis.window=dom.window;
  const timers=new Map(),animations=[],requests=[],states=[],seen=[];let sequence=0,finished=0,release;
  dom.window.setTimeout=(callback,ms)=>{const id=++sequence;timers.set(id,{callback,ms});return id;};dom.window.clearTimeout=id=>timers.delete(id);
  globalThis.Image=class{set src(src){this._src=src;requests.push(src);Promise.resolve().then(()=>src===fail?this.onerror(Error('unavailable')):this.onload());}get src(){return this._src;}decode(){return this.src===hold?new Promise(resolve=>release=resolve):Promise.resolve();}};
  const layers=[dom.window.document.getElementById('a'),dom.window.document.getElementById('b')];
  for(const layer of layers)layer.animate=(keyframes,options)=>{let finish,reject;const animation={options,keyframes,finished:new Promise((r,j)=>{finish=r;reject=j;}),cancelled:false,cancel(){this.cancelled=true;reject(Error('cancelled'));},finish(){finish();}};animations.push(animation);return animation;};
  const player=createJourneyPlayer({layers,initialFrame,motion,audio,onState:s=>states.push(s),onFrame:i=>seen.push(i),onComplete:()=>finished++});
  return {dom,player,layers,timers,animations,requests,seen,state:()=>states.at(-1),finished:()=>finished,allow:()=>{fail=undefined;},release:()=>release?.(),tick(ms){const item=[...timers].find(([,t])=>t.ms===ms);assert.ok(item,'Expected timer '+ms);timers.delete(item[0]);item[1].callback();},close(){player.dispose();dom.window.close();}};
}
// A wrong timer branch would skip a frame, finish early, or run twice.
const full=fixture();await flush();assert.deepEqual(full.seen,[0]);assert.ok(full.requests.some(s=>s.endsWith('/02-spring-1.png')),'decode ahead into next scene');
full.player.pause();assert.equal(full.timers.size,0);full.player.play();
for(let i=1;i<27;i++){full.tick(journeyFrames[i-1].duration);await flush();assert.equal(full.state().frame,i);assert.equal(full.animations.at(-1).options.duration,i%3===0?420:100);full.animations.at(-1).finish();await flush();}
assert.equal(full.finished(),0,'last ledger remains visible before handoff');full.tick(journeyFrames[26].duration);await flush();assert.equal(full.finished(),1);assert.equal(full.state().playing,false);full.player.play();assert.equal(full.timers.size,0,'handoff is emitted only once');full.close();
// A dropped checkpoint or unwanted autoplay would break resumed/reduced-motion viewing.
const resumed=fixture({initialFrame:15,motion:false});await flush();assert.equal(resumed.state().frame,15);assert.equal(resumed.timers.size,0);assert.equal(resumed.layers[0].src.endsWith('/06-glass-sea-1.png'),true);resumed.player.play();resumed.tick(650);await flush();assert.equal(resumed.state().frame,16);assert.equal(resumed.animations.length,0);resumed.close();
// A decode race must never display or checkpoint a frame after leaving.
const slow=fixture({hold:'/onboarding/journey-comic/nine/01-door-1.png'});await flush();assert.equal(slow.state().loading,false);slow.tick(180);assert.equal(slow.state().loading,true);slow.player.dispose();slow.release();await flush();assert.equal(slow.seen.length,0);assert.equal(slow.finished(),0);slow.dom.window.close();
// Retry must target the failed successor, not redisplay the prior frame.
const failure=fixture({fail:'/onboarding/journey-comic/nine/01-door-2.png'});await flush();failure.tick(650);await flush();assert.ok(failure.state().error);assert.equal(failure.state().frame,0);assert.equal(failure.layers[0].src.endsWith('/01-door-1.png'),true);failure.allow();failure.player.retry();await flush();assert.equal(failure.state().frame,1,'retry loads the failed next frame');failure.close();
const soundtrack={currentTime:0,paused:true,ended:false,async play(){this.paused=false;},pause(){this.paused=true;}};
const scored=fixture({audio:soundtrack});await flush();soundtrack.currentTime=2.6;scored.tick(650);await flush();assert.equal(scored.state().frame,3,'image selection catches up to the soundtrack clock instead of drifting');scored.player.pause();assert.equal(soundtrack.paused,true);scored.close();
let blocked=true;const restricted={currentTime:0,paused:true,ended:false,async play(){if(blocked)throw Error('NotAllowedError');this.paused=false;},pause(){this.paused=true;}};
const gated=fixture({audio:restricted});await flush();assert.equal(gated.state().playing,false,'blocked audio must also pause pictures');assert.equal(gated.state().audioBlocked,true);assert.equal(gated.timers.size,0);blocked=false;gated.player.play();await flush();assert.equal(gated.state().playing,true);gated.close();assert.equal(restricted.paused,true,'exit stops the soundtrack');
console.log('Comic journey: all packaged images, full playback, final hold, pause, resume, reduced motion, decode cleanup and failure retry passed.');
