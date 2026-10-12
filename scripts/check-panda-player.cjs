// Exercise the real React player lifecycle, with the GPU boundary stubbed.
const fs=require('node:fs'),assert=require('node:assert/strict'),ts=require('typescript'),React=require('react'),{JSDOM}=require('jsdom')
const dom=new JSDOM('<div id="test"></div>',{pretendToBeVisual:true,url:'http://localhost/'})
Object.assign(global,{window:dom.window,document:dom.window.document,IS_REACT_ACT_ENVIRONMENT:true})
Object.defineProperty(global,'navigator',{value:dom.window.navigator,configurable:true})
const frames=new Map(),draws=[];let serial=0,created=0,destroyed=0,painted=0
global.requestAnimationFrame=fn=>{frames.set(++serial,fn);return serial};global.cancelAnimationFrame=id=>frames.delete(id)
window.HTMLCanvasElement.prototype.getContext=()=>({clearRect(){},drawImage(){}})
const renderer={canvas:document.createElement('canvas'),render(){}}
class Drawing{constructor(){created++;this.stage={}}draw(input){draws.push(input)}destroy(){destroyed++}}
let code=ts.transpileModule(fs.readFileSync('src/companions/PandaSprite.tsx','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020,jsx:ts.JsxEmit.ReactJSX}}).outputText
const mod={exports:{}},deps={'react':React,'./petGeometry':{petViewport:n=>n*1.5},'./rig/renderer':{loadPandaAtlas:async theme=>({pixel:theme==='pixel-jrpg'}),pandaRenderer:async()=>renderer,PandaDrawing:Drawing},'./companion.css':{}}
new Function('require','module','exports',code)(id=>deps[id]??require(id),mod,mod.exports)
const{createRoot}=require('react-dom/client'),{act}=React,root=createRoot(document.getElementById('test'))
const props={theme:'animal-crossing',size:96,reserve:true,animated:false,onPaint:()=>painted++}
async function show(next){await act(async()=>{root.render(React.createElement(mod.exports.PandaSprite,{...props,...next}));for(let i=0;i<6;i++)await Promise.resolve()})}
;(async()=>{
 await show({action:'idle'});assert.equal(draws.at(-1).action,'idle');assert.equal(frames.size,0)
 await show({action:'sleep',direction:'left'});assert.equal(draws.at(-1).action,'sleep');assert.equal(draws.at(-1).direction,'left');assert.equal(created,1,'Action changes preserve the drawing and its crossfade')
 await show({action:'idle',attachment:'icon',cutout:[48,40,86,78]});assert.equal(draws.at(-1).attachment,'icon');assert.deepEqual(draws.at(-1).cutout,[50,40/96*100,86/96*100,78/96*100]);assert(painted>=3,'Reduced motion must repaint changed props')
 await show({animated:true,action:'walk'});assert.equal(frames.size,1)
 const count=draws.length;Object.defineProperty(document,'hidden',{value:true,configurable:true});await act(async()=>document.dispatchEvent(new window.Event('visibilitychange')));assert.equal(frames.size,0)
 Object.defineProperty(document,'hidden',{value:false,configurable:true});await act(async()=>document.dispatchEvent(new window.Event('visibilitychange')));assert.equal(frames.size,1);assert(draws.length>count)
 await show({theme:'pixel-jrpg',animated:true,action:'run'});const start=performance.now(),before=draws.length
 for(let i=1;i<=36;i++){const callbacks=[...frames.values()];frames.clear();for(const fn of callbacks)fn(start+i*1000/60)}
 const phases=new Set(draws.slice(before).map(p=>Math.floor(p.timeMs/75)%8));assert.equal(phases.size,8,'Pixel run playback must paint all eight authored phases within a loop')
 await act(async()=>root.unmount());assert.equal(frames.size,0);assert.equal(created,destroyed)
 dom.window.close();console.log('PASS real panda player: static action/attachment updates, persistent drawing, visibility resume and cleanup')
})().catch(async e=>{console.error(e);await act(async()=>root.unmount());dom.window.close();process.exitCode=1})
