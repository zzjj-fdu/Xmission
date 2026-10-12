const fs=require('node:fs'),assert=require('node:assert/strict'),ts=require('typescript')
const React=require('react'),{JSDOM}=require('jsdom')
const dom=new JSDOM('<div id="test"></div>',{pretendToBeVisual:true,url:'http://localhost/'})
global.window=dom.window;global.document=dom.window.document;global.navigator=dom.window.navigator
global.IS_REACT_ACT_ENVIRONMENT=true
const {createRoot}=require('react-dom/client'),{act}=React
let now=1000000,serial=0;const timers=new Map(),calls=[],actions=[]
const timeout=(fn,ms)=>{const id=++serial;timers.set(id,{fn,at:now+ms});return id}
window.setTimeout=timeout;window.clearTimeout=id=>timers.delete(id);global.requestAnimationFrame=fn=>timeout(()=>fn(now),16);global.cancelAnimationFrame=id=>timers.delete(id)
window.setInterval=(fn,ms)=>{const id=++serial;timers.set(id,{fn,at:now+ms,repeat:ms});return id}
window.clearInterval=window.clearTimeout;global.clearTimeout=window.clearTimeout;global.clearInterval=window.clearInterval
Date.now=()=>now
function advance(ms){const end=now+ms;let turns=0;while(true){const due=[...timers].filter(([,v])=>v.at<=end).sort((a,b)=>a[1].at-b[1].at)[0];if(!due)break;assert(++turns<2000);now=due[1].at;if(due[1].repeat)due[1].at+=due[1].repeat;else timers.delete(due[0]);due[1].fn()}now=end}
function load(path,dependencies){const src=fs.readFileSync(path,'utf8'),code=ts.transpileModule(src,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020,jsx:ts.JsxEmit.ReactJSX}}).outputText,module={exports:{}};new Function('require','module','exports',code)(id=>dependencies[id]??require(id),module,module.exports);return module.exports}
const behavior=load('src/companions/behavior.ts',{}),policy=load('src/companions/petPolicy.ts',{}),morphMotion=load('src/companions/petMorphMotion.ts',{})
for(let gap=0;gap<=288;gap+=12){assert(policy.facingRightChance(gap,1000,96)>=.5);assert(policy.facingRightChance(1000,gap,96)<=.5)}
assert(policy.facingRightChance(0,1000,96)>policy.facingRightChance(100,1000,96));assert.equal(policy.facingRightChance(1000,1000,96),.5)
const context={leftRoom:0,rightRoom:1000,cursorX:-30,cursorY:48,size:96,blocked:false}
assert.equal(policy.cursorFacing(context),null);assert.equal(policy.cursorFacing({...context,leftRoom:100}), 'left')
assert.equal(policy.cursorFacing({...context,cursorX:48,cursorY:20}),null)
const clock=policy.createLifeClock(now,()=>.5),idleAt=clock.idleAt
assert.equal(policy.nextLifeAction(clock,now,'snow:noon','snow',['sit'],()=>.5),null)
assert.equal(policy.nextLifeAction(clock,now+1000,'rain:noon','rain',['sit'],()=>.5),null);assert.equal(clock.idleAt,idleAt)
const snow=policy.createLifeClock(now,()=>0)
assert.equal(policy.nextLifeAction(snow,now+30000,'snow:noon','snow',['sit'],()=>0),'snow')
assert.equal(policy.nextLifeAction(snow,now+31000,'rain:noon','rain',['sit'],()=>0),null)
assert(snow.weatherAt>=snow.weatherLast+180000)
console.log('PASS edge-distance bias, neighbour-monitor exclusion, weather changes without timer resets, shared rest interval')
const preferences={enabled:true,desktopEnabled:true,displayMode:'normal',quietStart:'00:00',quietEnd:'00:00',name:'test',size:100,followEnvironment:false}
const state={home:{preferences,focus:false,trip:null,journal:{unlocks:[]}},gesture:null,hovering:false,dragging:false,tool:null,act(action){actions.push(action);this.gesture=action;timeout(()=>{if(this.gesture===action)this.gesture=null},behavior.FOX_ACTIONS[action].duration||4500)}}
const store={getState:()=>state,setState:patch=>Object.assign(state,typeof patch==='function'?patch(state):patch)}
const deps={'./touchPolicy':load('src/companions/touchPolicy.ts',{}),'../store/companion':{useCompanionStore:store},'./behavior':behavior,'./petPolicy':policy,'@tauri-apps/api/core':{invoke:async(name,args)=>{calls.push({name,args});return null}}}
const {usePetAttention}=load('src/companions/usePetAttention.ts',deps)
let attention
function Attention(){attention=usePetAttention(true,false);return null}
const root=createRoot(document.getElementById('test'))
;(async()=>{
 await act(async()=>root.render(React.createElement(Attention)))
 await act(async()=>attention.glance('left'))
 await act(async()=>{advance(350);state.hovering=true;advance(400)})
 assert.equal(attention.direction,'right','Care must cancel the delayed turn')
 state.hovering=false;state.gesture=null
 await act(async()=>{advance(25000);attention.glance('left');advance(721)})
 assert.equal(attention.direction,'left')
 await act(async()=>{advance(25000);state.gesture=null;attention.glance('right');attention.setDirection('left');advance(1000)})
 assert.equal(attention.direction,'left','Movement direction must cancel an older glance')
 await act(async()=>root.unmount());timers.clear();state.gesture=null
 console.log('PASS delayed glance yields to care, stable turn, walking cancels stale turn, unmount cancels timers')
 window.HTMLCanvasElement.prototype.getContext=()=>({getImageData:()=>({data:new Uint8ClampedArray([0,0,0,255])})})
 window.HTMLElement.prototype.getBoundingClientRect=()=>({left:0,top:0,width:100,height:100,right:100,bottom:100})
 let spriteProps
 const {PetSurface}=load('src/companions/PetSurface.tsx',{...deps,'@tauri-apps/api/event':{emit:async()=>{},listen:async()=>()=>{}},'./FoxSprite':{FoxSprite:p=>{spriteProps=p;return React.createElement('canvas',{width:100,height:100})},FoxAccessory:()=>null,FoxPortrait:()=>null},'./PetBall':{PetBall:()=>React.createElement('canvas',{width:43,height:43}),PetMorphCanvas:()=>null},'./petMorphMotion':morphMotion,'./petGeometry':load('src/companions/petGeometry.ts',{}),'./usePetLife':{usePetLife:()=>{}},'./PetEnvironment':{PetEnvironment:()=>null},'./petHitMask':{postPetHitMask:async()=>{}},'./gesture':load('src/companions/gesture.ts',{})})
 const pet={preferences,home:state.home,animated:true,action:'idle',theme:'animal-crossing',weather:'clear',phase:'noon',tool:null,gesture:null,refresh:async()=>{},act:action=>state.act(action),activityElapsed:{idle:0,focus:0,sleep:0}}
 const surfaceRoot=createRoot(document.getElementById('test'))
 for(const mode of ['top','icon','icon-left']){
  await act(async()=>surfaceRoot.render(React.createElement(PetSurface,{pet:{...pet,perched:true,attachment:mode,action:'walk',gesture:'walk'},direction:'right',glance:()=>{},onMenu:()=>{},native:false,size:100})))
  assert.equal(spriteProps.attachment,mode,'Confirmed grip must outrank a leftover walking gesture')
 }
 await act(async()=>surfaceRoot.render(React.createElement(PetSurface,{pet:{...pet,exploring:true,action:'walk',gesture:'walk'},direction:'right',glance:()=>{},onMenu:()=>{},native:false,size:100})))
 await act(async()=>document.querySelector('button').dispatchEvent(new window.MouseEvent('pointermove',{bubbles:true,clientX:75,clientY:30,screenX:75,screenY:30})))
 assert.equal(state.hovering,false,'A pointer crossed during approach must not turn into care or cancel movement')
 await act(async()=>surfaceRoot.render(React.createElement(PetSurface,{pet,direction:'right',glance:()=>{},onMenu:()=>{},native:false,size:100})))
 const button=document.querySelector('button')
 const point=(name,x=75,y=30)=>button.dispatchEvent(new window.MouseEvent(name,{bubbles:true,clientX:x,clientY:y,screenX:x,screenY:y,relatedTarget:document.body}))
 const before=calls.filter(c=>c.name==='interact_companion').length
 await act(async()=>{point('pointermove');advance(500);point('pointerout');advance(1500)})
 assert.equal(state.hovering,false,'Leaving the fox must release the native hover state')
 assert.equal(calls.filter(c=>c.name==='interact_companion').length,before,'Leaving must cancel unfinished care')
 await act(async()=>{point('pointermove');advance(1451);await Promise.resolve()})
 assert.equal(calls.filter(c=>c.name==='interact_companion').length,before+1)
 assert.equal(calls.filter(c=>c.name==='interact_companion').at(-1).args.animate,false,'Saving local care must not broadcast a second animation')
 assert.equal(calls.filter(c=>c.name==='show_companion_bubble').length,0,'Stroking must not open a speech card')
 assert.equal(button.hasAttribute('title'),false,'Routine hovering must not produce a browser tooltip')
 
 await act(async()=>{point('pointerout');advance(1900);point('pointermove',35,65);advance(1000)})
 assert.equal(calls.filter(c=>c.name==='interact_companion').length,before+1,'Body hovering alone is not grooming')
 await act(async()=>{point('pointermove',50,65);point('pointermove',35,65);await Promise.resolve()})
 assert.equal(actions.at(-1),'groom','Body sweep without a selected tool starts grooming')
 assert.equal(calls.filter(c=>c.name==='show_companion_bubble').length,0)
 await act(async()=>surfaceRoot.unmount());assert.equal(state.hovering,false)

 console.log('PASS real pointer handlers: leaving cancels care, one completed care, no speech / tooltip, clean hover shutdown')
 Object.defineProperty(navigator,'userAgent',{value:'Windows',configurable:true})
 const nativeDeps={...deps,'@tauri-apps/api/core':{invoke:async(name,args)=>{calls.push({name,args});if(name==='drag_companion')return{moved:false};if(name==='companion_double_click_ms')return 480;return null}},'@tauri-apps/api/event':{emit:async()=>{},listen:async()=>()=>{}},'./FoxSprite':{FoxSprite:()=>React.createElement('canvas',{width:150,height:150}),FoxAccessory:()=>null},'./PetBall':{PetBall:()=>React.createElement('canvas',{width:43,height:43}),PetMorphCanvas:()=>null},'./petMorphMotion':morphMotion,'./petGeometry':load('src/companions/petGeometry.ts',{}),'./usePetLife':{usePetLife:()=>{}},'./PetEnvironment':{PetEnvironment:()=>null},'./petHitMask':{postPetHitMask:async()=>{}},'./gesture':load('src/companions/gesture.ts',{})}
 const NativeSurface=load('src/companions/PetSurface.tsx',nativeDeps).PetSurface
 const next=createRoot(document.getElementById('test'))
 let dockState
 const draw=async morph=>act(async()=>next.render(React.createElement(NativeSurface,{pet,direction:'right',glance:()=>{},onMenu:()=>{},native:true,size:100,morph,dock:dockState})))
 await draw()
 const contextMenu=()=>document.querySelector('button').dispatchEvent(new window.MouseEvent('contextmenu',{bubbles:true,button:2}))
 await act(async()=>contextMenu())
 assert.equal(calls.at(-1).name,'show_companion_menu','Right click must open the menu, without converting the fox');assert.equal(calls.filter(c=>c.name==='set_companion_mode').length,0)
 dockState={side:'right',hidden:true,folded:true,transitioning:false};pet.gesture='celebrate';await draw()
 const reveals=calls.filter(c=>c.name==='reveal_companion').length
 await act(async()=>document.querySelector('button').dispatchEvent(new window.MouseEvent('pointerover',{bubbles:true,clientX:95,clientY:70,screenX:95,screenY:70,relatedTarget:document.body})))
 assert.equal(calls.filter(c=>c.name==='reveal_companion').length,reveals,'Native region pointer-entry must not instantly reveal a tucked pet')
 assert.equal(calls.filter(c=>c.name==='companion_activity').at(-1).args.active,false,'Queued gestures must not force the hidden body out')
 dockState=undefined;pet.gesture=null
 console.log('PASS folded pointer entry and queued gesture do not unfold the pet')
 preferences.displayMode='mini';await draw()
 const click=async()=>act(async()=>{document.querySelector('button').dispatchEvent(new window.MouseEvent('pointerdown',{bubbles:true,button:0,clientX:20,clientY:20,screenX:20,screenY:20}));await Promise.resolve()})
 const taskBefore=calls.filter(c=>c.name==='open_companion_tasks').length
 await click();await click();await act(async()=>advance(600))
 assert.equal(calls.filter(c=>c.name==='open_companion_tasks').length,taskBefore,'Double click must not accidentally open tasks')
 assert.equal(calls.filter(c=>c.name==='set_companion_mode').at(-1).args.mode,'normal')
 await click();await act(async()=>advance(600))
 assert.equal(calls.filter(c=>c.name==='open_companion_tasks').length,taskBefore+1,'Single click still opens tasks')
 await draw({id:1,from:'mini',to:'normal',size:100,startedAt:now,durationMs:1150,stage:'start'})
 const beforeMorph=calls.filter(c=>c.name==='set_companion_mode').length
 await click();await act(async()=>contextMenu());await act(async()=>advance(600))
 assert.equal(calls.filter(c=>c.name==='set_companion_mode').length,beforeMorph,'Transition ignores repeated pointer input')
 await act(async()=>next.unmount())
 console.log('PASS real mini handlers: compass ball, fox right-click menu, ball double click, delayed single click, transition input lock')

})().catch(e=>{console.error(e);process.exitCode=1})
