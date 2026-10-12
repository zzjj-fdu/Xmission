// Actual desktop components, deferred local services; no model or real window calls.
const fs=require('node:fs'),assert=require('node:assert/strict'),ts=require('typescript'),React=require('react'),{JSDOM}=require('jsdom')
const dom=new JSDOM('<div id="test"></div>',{url:'http://localhost/',pretendToBeVisual:true})
Object.assign(global,{window:dom.window,document:dom.window.document})
Object.defineProperty(global,'navigator',{value:dom.window.navigator,configurable:true})
global.IS_REACT_ACT_ENVIRONMENT=true
const {createRoot}=require('react-dom/client'),{act}=React
const calls=[],pending=[],listeners=new Map();let created=0,closed=0
const deferred=()=>{let resolve;const promise=new Promise(r=>resolve=r);return{promise,resolve}}
const task=deferred(),drag=deferred()
const deps={
 '@tauri-apps/api/core':{invoke:async(name,args)=>{calls.push({name,args});if(name==='send_companion_message'){const p=deferred();pending.push(p);return p.promise}if(name==='drag_toy')return drag.promise;return null}},
 '@tauri-apps/api/event':{listen:async(name,fn)=>{listeners.set(name,fn);return()=>listeners.delete(name)}},
 '@tauri-apps/api/window':{getCurrentWindow:()=>({setSize:async size=>calls.push({name:'size',args:size})})},
 '@tauri-apps/api/dpi':{LogicalSize:class{constructor(width,height){Object.assign(this,{width,height})}}},
 '../api/tasks':{createTask:()=>{created++;return task.promise}},
 './pet-menu.css':{},'./desktop-life.css':{},
}
function load(path){const code=ts.transpileModule(fs.readFileSync(path,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020,jsx:ts.JsxEmit.ReactJSX}}).outputText,module={exports:{}};new Function('require','module','exports',code)(id=>deps[id]??require(id),module,module.exports);return module.exports}
const {PetSpeechCard}=load('src/companions/PetSpeechCard.tsx'),{PetDesktopInput}=load('src/companions/PetDesktopInput.tsx'),{PetDesktopToy}=load('src/companions/PetDesktopToy.tsx')
let root=createRoot(document.getElementById('test'))
const button=text=>[...document.querySelectorAll('button')].find(el=>el.textContent===text)
const click=el=>act(async()=>el.click())
const input=(el,value)=>act(async()=>{const proto=el.tagName==='SELECT'?window.HTMLSelectElement.prototype:window.HTMLTextAreaElement.prototype;Object.getOwnPropertyDescriptor(proto,'value').set.call(el,value);el.dispatchEvent(new window.Event(el.tagName==='SELECT'?'change':'input',{bubbles:true}))})
const submit=()=>act(async()=>document.querySelector('form').dispatchEvent(new window.Event('submit',{bubbles:true,cancelable:true})))
let notice={createdAt:1,title:'狐狸',message:'要记下带伞吗？',tab:'reply',items:[],reply:{suggestedTask:'明天带伞'}}
const draw=()=>act(async()=>root.render(React.createElement(PetSpeechCard,{notice,name:'狐狸',theme:'animal-crossing',onClose:()=>closed++,onOpen:()=>{}})))
;(async()=>{
 await draw();assert.equal(document.querySelectorAll('form').length,0,'Bubble is not a second chat page')
 await click(button('回一句'));assert.equal(calls.at(-1).name,'open_companion_input');assert.equal(closed,1)
 await click(button('记下这个目标'));await click(button('记下这个目标'));assert.equal(created,1)
 await act(async()=>task.resolve({}));assert(button('已记入任务').disabled)
 notice={...notice,createdAt:2,message:'讲解'.repeat(300),reply:null};await draw();await click(button('展开'));assert(document.querySelector('.is-expanded'));assert.equal(document.querySelectorAll('form').length,0)
 notice={...notice,createdAt:3,tab:'paper',message:'拿出玩具'};await draw();await click(button('把玩具拿出来'));assert.equal(calls.at(-1).name,'start_toy');assert.equal(document.querySelector('.xm-paper-court'),null)
 await act(async()=>root.unmount())
 console.log('PASS separate speech bubble, long reply expansion, confirmed task only, desktop toy invitation')
 root=createRoot(document.getElementById('test'));await act(async()=>root.render(React.createElement(PetDesktopInput,{theme:'animal-crossing'})))
 assert.equal(document.querySelector('textarea').rows,1);assert.equal(document.querySelector('select'),null)
 await input(document.querySelector('textarea'),'今天先写一个小函数');await submit();await submit()
 assert.equal(pending.length,1);assert.equal(calls.filter(c=>c.name==='send_companion_message').at(-1).args.includeToday,false)
 await click(document.querySelector('[aria-label="收起输入框"]'));assert.equal(calls.at(-1).name,'dismiss_companion_input')
 await act(async()=>listeners.get('companion-input-open')())
 await input(document.querySelector('textarea'),'新的问题');await submit();assert.equal(pending.length,2)
 await act(async()=>pending[0].resolve());assert.equal(document.querySelector('textarea').value,'新的问题','Late cancellation cannot clear a new draft')
 await act(async()=>pending[1].resolve());assert.equal(document.querySelector('textarea').value,'')
 await click(document.querySelector('[aria-label="分享和帮助选项"]'));await input(document.querySelector('select'),'hint');await input(document.querySelector('textarea'),'Two Sum：为什么可以用哈希表？');await submit()
 const sent=calls.filter(c=>c.name==='send_companion_message').at(-1).args;assert.equal(sent.scenario,'hint');assert.match(sent.sharedText,/Two Sum/)
 await act(async()=>pending[2].resolve());await act(async()=>root.unmount())
 console.log('PASS minimal input, optional sharing, duplicate submit guard, cancel/reopen isolation, explicit hint input')
 root=createRoot(document.getElementById('test'));await act(async()=>root.render(React.createElement(PetDesktopToy,{theme:'stardew-valley'})))
 const toy=document.querySelector('button');assert.equal(document.querySelectorAll('svg').length,1)
 await act(async()=>{toy.dispatchEvent(new window.MouseEvent('pointerdown',{bubbles:true,button:0}));toy.dispatchEvent(new window.MouseEvent('pointerdown',{bubbles:true,button:0}))})
 assert.equal(calls.filter(c=>c.name==='drag_toy').length,1)
 await act(async()=>drag.resolve());await act(async()=>toy.dispatchEvent(new window.MouseEvent('contextmenu',{bubbles:true})));assert.equal(calls.at(-1).name,'dismiss_toy')
 await act(async()=>root.unmount())
 console.log('PASS independent desktop toy, one drag at a time, right-click disposal')
})().catch(e=>{console.error(e);process.exitCode=1})
