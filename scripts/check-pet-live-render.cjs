// Actual store -> useFox -> PetSurface -> FoxSprite -> painted canvas pipeline.
const fs=require('node:fs'),assert=require('node:assert/strict'),ts=require('typescript'),React=require('react'),{JSDOM}=require('jsdom')
const dom=new JSDOM('<div id="test"></div>',{pretendToBeVisual:true,url:'http://localhost/'})
Object.assign(global,{window:dom.window,document:dom.window.document,IS_REACT_ACT_ENVIRONMENT:true})
Object.defineProperty(global,'navigator',{value:dom.window.navigator,configurable:true})
global.matchMedia=()=>({matches:false,addEventListener(){},removeEventListener(){}})
global.requestAnimationFrame=fn=>setTimeout(()=>fn(performance.now()),16);global.cancelAnimationFrame=clearTimeout
const {createRoot}=require('react-dom/client'),{act}=React,listeners=new Map(),paints=[],holes=[],canvasCalls=[]
window.HTMLCanvasElement.prototype.getContext=function(){const canvas=this;return{
 scale(){},save(){},restore(){},translate(){},fillRect(){},getImageData:()=>({data:new Uint8ClampedArray([0,0,0,255])}),
 drawImage(source,...args){if(source.asset)canvas.asset=source.asset;if(args.length===4&&source.asset){paints.push({asset:source.asset,box:args});canvasCalls.push({kind:'draw',canvas,box:args})}},
 clearRect(...box){if(canvas.asset){holes.push(box);canvasCalls.push({kind:'clear',canvas,box})}},
}}
global.Image=class{set src(value){this.asset=value;queueMicrotask(()=>this.onload())}}
global.fetch=async url=>({ok:true,json:async()=>JSON.parse(fs.readFileSync('public'+url.split('?')[0]))})
function load(path,deps={}){let code=fs.readFileSync(path,'utf8').replaceAll('import.meta.env.BASE_URL',"'/'");code=ts.transpileModule(code,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020,jsx:ts.JsxEmit.ReactJSX}}).outputText;const m={exports:{}};new Function('require','module','exports',code)(id=>deps[id]??require(id),m,m.exports);return m.exports}
const behavior=load('src/companions/behavior.ts'),geometry=load('src/companions/petGeometry.ts'),assets=load('src/companions/assets.ts'),perches=load('src/companions/perchGeometry.ts')
const preferences={enabled:true,desktopEnabled:true,displayMode:'normal',quietStart:'00:00',quietEnd:'00:00',name:'test',size:96,appearance:'animal-crossing',reducedMotion:false}
let initial
const api={invoke:async name=>name==='get_companion_attachment_mode'?new Promise(r=>initial=r):null},events={listen:async(name,fn)=>{listeners.set(name,fn);return()=>listeners.delete(name)},emit:async()=>{}}
const {useCompanionStore:store,startCompanionStore}=load('src/store/companion.ts',{'@tauri-apps/api/core':api,'@tauri-apps/api/event':events,'../api/companion':{getCompanionHome:async()=>({preferences,focus:false,trip:null}),updateCompanionPreferences:async()=>preferences},'../companions/behavior':behavior,'../companions/types':load('src/companions/types.ts',{})})
const {useFox}=load('src/companions/useFox.ts',{'../store/companion':{useCompanionStore:store,startCompanionStore},'./types':load('src/companions/types.ts'),'../themes':{currentThemeKey:()=> 'animal-crossing'},'./behavior':behavior,'../store/sceneWeather':{currentSceneWeather:()=> 'clear',useSceneWeatherStore:selector=>selector({motion:'full'})},'../store/sceneSession':{useSceneSession:selector=>selector({phase:'noon'})}})
const sprite=load('src/companions/FoxSprite.tsx',{'./types':{},'./assets':assets,'./behavior':behavior,'./petGeometry':geometry,'./perchGeometry':perches,'./companion.css':{}})
const {PetSurface}=load('src/companions/PetSurface.tsx',{'@tauri-apps/api/core':api,'@tauri-apps/api/event':events,'../store/companion':{useCompanionStore:store},'./FoxSprite':sprite,'./CompanionSprite':{CompanionSprite:sprite.FoxSprite,preloadCompanionAction:sprite.preloadFoxAction},'./PetBall':{PetBall:()=>null,PetMorphCanvas:()=>null},'./petGeometry':geometry,'./petMorphMotion':load('src/companions/petMorphMotion.ts'),'./gesture':load('src/companions/gesture.ts'),'./touchPolicy':load('src/companions/touchPolicy.ts'),'./usePetLife':{usePetLife(){}},'./PetEnvironment':{PetEnvironment:()=>null},'./petHitMask':{postPetHitMask:async()=>{}}})
function App(){const pet=useFox();return React.createElement(PetSurface,{pet,direction:'right',glance(){},onMenu(){},native:false})}
const root=createRoot(document.getElementById('test')),settle=async()=>{for(let i=0;i<8;i++)await Promise.resolve()}
;(async()=>{
 await act(async()=>{root.render(React.createElement(App));await settle()})
 for(const [theme,skin]of [['pixel-jrpg','jrpg'],['parchment-journal','journal'],['animal-crossing','island'],['stardew-valley','farm']]){
  await act(async()=>{store.setState({home:{preferences:{...preferences,appearance:theme},focus:false,trip:null}});store.getState().act('walk',5000);listeners.get('companion-attachment')({payload:{mode:'top',cutout:null}});await settle()})
  assert(paints.at(-1).asset.includes(`v10/${skin}-perch.png`),`${theme}: actual painted top pose must not be a walking fox`)
  for(const mode of ['icon','icon-left']){
   const callStart=canvasCalls.length
   await act(async()=>{listeners.get('companion-attachment')({payload:{mode,cutout:[72,33,120,81]}});await settle()})
   assert(paints.at(-1).asset.includes(`v14/${skin}-icon-hug.png`))
   assert(!holes.some(b=>JSON.stringify(b)===JSON.stringify([72,33,48,48])),`${theme}: a full rectangle wipe must not cut into the bounded fox; its atlas already has an open slot`)
   assert.equal(canvasCalls.at(-1).kind,'draw',`${theme}: foreground paws must remain visible`)
   const target=canvasCalls.at(-1).canvas,draws=canvasCalls.slice(callStart).filter(c=>c.canvas===target&&c.kind==='draw')
   assert.equal(draws.length,1,`${theme}: an already complete embrace must not be repainted with a guessed paw mask`)
  }
 }
 await act(async()=>{initial({mode:null,cutout:null});await settle()})
 assert.equal(store.getState().attachment,'icon-left','Late initial read cannot clear the painted grip')
 await act(async()=>root.unmount());dom.window.close()
 console.log('PASS real store/hook/surface/sprite paint: four themes, top and both icon sides, picture cutout, old walking gesture and delayed snapshot')
})().catch(async e=>{console.error(e);await act(async()=>root.unmount());dom.window.close();process.exitCode=1})
