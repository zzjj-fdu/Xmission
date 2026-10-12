const fs=require('node:fs'),assert=require('node:assert/strict'),ts=require('typescript')
function load(path){if(!fs.existsSync(path))return{};const code=ts.transpileModule(fs.readFileSync(path,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020}}).outputText,module={exports:{}};new Function('module','exports',code)(module,module.exports);return module.exports}
const {FOX_ACTIONS}=load('src/companions/behavior.ts')
assert(FOX_ACTIONS.run,'Toy chase needs a dedicated run, not a walk')
const {createToyChase}=load('src/companions/toyChase.ts')
assert.equal(typeof createToyChase,'function','Chase controller must handle cancellation and phases')
;(async()=>{
 let state={dragging:false,home:{focus:false,preferences:{enabled:true,desktopEnabled:true,displayMode:'normal',appearance:'parchment-journal'}},gesture:null}
 const actions=[],preloads=[],phases=[],ready=[],directions=[]
 state.act=(action,duration)=>{state.gesture=action;actions.push({action,duration})}
 let release;const blocked=new Promise(r=>release=r)
 const chase=createToyChase({getState:()=>state,getTheme:()=> 'animal-crossing',preload:async(theme,action,direction)=>{preloads.push({theme,action,direction})},face:d=>directions.push(d),setPhase:p=>phases.push(p),ready:async id=>ready.push(id),onError:()=>{}})
 await chase.handle({phase:'prepare',id:1,direction:'left',durationMs:320})
 assert.equal(preloads.length,4);assert(preloads.every(p=>p.theme==='parchment-journal'&&p.direction==='left'))
 assert.deepEqual(preloads.map(p=>p.action),['run-start','run','run-stop','toy-catch'])
 assert.equal(actions.at(-1).action,'run-start');assert.deepEqual(ready,[1]);assert.equal(directions.at(-1),'left')
 await chase.handle({phase:'run',id:1,direction:'left',durationMs:1300});assert.equal(actions.at(-1).action,'run')
 await chase.handle({phase:'brake',id:1,durationMs:240});assert.equal(actions.at(-1).action,'run-stop')
 await chase.handle({phase:'catch',id:1,durationMs:1100});assert.equal(actions.at(-1).action,'toy-catch')
 await chase.handle({phase:'end',id:1});assert.equal(actions.at(-1).action,'idle');assert.equal(phases.at(-1),null)
 const count=actions.length;await chase.handle({phase:'run',id:1,durationMs:900});assert.equal(actions.length,count,'Ended ticket must not restart')
 const staleReady=[]
 const stale=createToyChase({getState:()=>state,getTheme:()=> 'animal-crossing',preload:()=>blocked,face:()=>{},setPhase:()=>{},ready:async id=>staleReady.push(id),onError:()=>{}})
 const pending=stale.handle({phase:'prepare',id:2,direction:'right',durationMs:320})
 await stale.handle({phase:'end',id:2});release();await pending;assert.deepEqual(staleReady,[],'Late preload after end cannot start movement')
 state.dragging=true;await chase.handle({phase:'prepare',id:3,direction:'right',durationMs:320});assert.deepEqual(ready,[1],'Dragging cannot acknowledge a new chase')
 state.dragging=false;state.home.focus=true;await chase.handle({phase:'prepare',id:4,direction:'right',durationMs:320});assert.deepEqual(ready,[1],'Focus suppresses chase')
 state.home.focus=false;state.home.preferences.appearance='follow';await chase.handle({phase:'prepare',id:5,direction:'right',durationMs:320});assert(preloads.slice(-4).every(p=>p.theme==='animal-crossing'))
 chase.cancel();await chase.handle({phase:'run',id:5,durationMs:900});assert.equal(actions.at(-1).action,'run-start','Unmount cancels later events')
 for(const skin of ['jrpg','journal','island','farm']){const atlas=JSON.parse(fs.readFileSync(`public/pets/fox/${skin}.json`));assert.equal(atlas.actions.run.length,8);assert.equal(atlas.actions['run-start'].length,2);assert.equal(atlas.actions['run-stop'].length,2);assert(atlas.actions.run.every(f=>f.source===`v9/${skin}-run.png`))}
 console.log('PASS dedicated run, selected appearance, preparation/run/brake/catch, cancellation, drag/focus suppression and all four atlases')
})().catch(e=>{console.error(e);process.exitCode=1})
