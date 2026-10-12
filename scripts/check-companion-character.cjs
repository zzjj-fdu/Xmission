const fs=require('node:fs'),assert=require('node:assert/strict'),ts=require('typescript')
function load(path,deps={}){const m={exports:{}};const code=ts.transpileModule(fs.readFileSync(path,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020,jsx:ts.JsxEmit.ReactJSX}}).outputText;new Function('require','module','exports',code)(id=>deps[id]??require(id),m,m.exports);return m.exports}
const types=load('src/companions/types.ts'),behavior=load('src/companions/behavior.ts')
assert.equal(types.normalizePetPreferences({name:'旧伙伴'}).character,'fox')
assert.equal(types.normalizePetPreferences({}).outfit,'theme')
assert.equal(types.normalizePetPreferences({character:'red-panda'}).name,'小熊猫')
assert.equal(types.normalizePetPreferences({character:'invalid',outfit:'invalid'}).character,'fox')
let now=1000,serial=0;const timers=new Map()
global.window={setTimeout:(fn,ms)=>{const id=++serial;timers.set(id,{fn,at:now+ms});return id}}
global.clearTimeout=id=>timers.delete(id)
const advance=ms=>{now+=ms;for(const[id,t]of [...timers])if(t.at<=now){timers.delete(id);t.fn()}}
let preferences=types.normalizePetPreferences({name:'狐狸名字'})
const api={getCompanionHome:async()=>({preferences,trip:null,focus:false,collection:[{id:preferences.character}]}),updateCompanionPreferences:async patch=>{preferences=types.normalizePetPreferences({...preferences,...patch});return preferences}}
const {useCompanionStore:store}=load('src/store/companion.ts',{'../companions/types':types,'../companions/behavior':behavior,'../api/companion':api,'@tauri-apps/api/core':{invoke:async()=>null},'@tauri-apps/api/event':{listen:async()=>()=>{}}})
const warm=[]
function FoxSprite(){};function FoxPortrait(){};function PandaSprite(){}
const useStore=selector=>selector(store.getState());useStore.getState=store.getState
const adapter=load('src/companions/CompanionSprite.tsx',{'react':{memo:fn=>fn},'../store/companion':{useCompanionStore:useStore},'./FoxSprite':{FoxSprite,FoxPortrait,preloadFoxAction:async(...args)=>warm.push(['fox-action',...args]),preloadFoxPerch:async(...args)=>warm.push(['fox-perch',...args])},'./PandaSprite':{PandaSprite,preloadPanda:async theme=>warm.push(['panda',theme])}})
;(async()=>{
 await store.getState().refresh()
 const stop=store.subscribe(s=>{if(s.home)assert.equal(s.home.collection[0].id,s.home.preferences.character,'A new character must never publish the previous species collection')})
 const onPaint=()=>{},spriteProps={theme:'animal-crossing',action:'toy-catch',direction:'left',attachment:'icon-left',cutout:[1,2,3,4],attachmentPhase:'enter',reserve:true,onPaint,animated:false}
 assert.equal(adapter.CompanionSprite(spriteProps).type,FoxSprite)
 store.getState().act('depart')
 store.setState({perched:true,attachment:'left',attachmentCutout:[1,2,3,4],fetchPhase:'run',notice:{items:[],createdAt:1},returnedTrip:'old',activityElapsed:{idle:0,focus:800,sleep:900}})
 await store.getState().save({character:'red-panda',name:'熊猫名字',outfit:'scarf'})
 for(const key of ['gesture','attachment','attachmentCutout','notice','returnedTrip','fetchPhase'])assert.equal(store.getState()[key],null,`${key} must clear when changing species`)
 assert.equal(store.getState().perched,false);assert.equal(store.getState().activityElapsed.focus,0)
 advance(30000);assert.equal(store.getState().gesture,null,'Old action timer cannot affect the new partner')
 const panda=adapter.CompanionSprite(spriteProps)
 assert.equal(panda.type,PandaSprite);assert.equal(panda.props.outfit,'scarf')
 for(const[key,value]of Object.entries(spriteProps))assert.deepEqual(panda.props[key],value,`Panda must preserve ${key}`)
 assert.equal(adapter.CompanionSprite({...spriteProps,character:'fox'}).type,FoxSprite)
 const portrait=adapter.CompanionPortrait({theme:'animal-crossing',emotion:'sleepy',onPaint})
 assert.equal(portrait.type,adapter.CompanionSprite);assert.equal(portrait.props.character,'red-panda');assert.equal(portrait.props.action,'sleep');assert.equal(portrait.props.animated,false)
 await adapter.preloadCompanionAction('animal-crossing','run','left')
 await adapter.preloadCompanionPerch('animal-crossing','left')
 await adapter.preloadCompanionAction('pixel-jrpg','walk','left','fox')
 assert.deepEqual(warm,[['panda','animal-crossing'],['panda','animal-crossing'],['fox-action','pixel-jrpg','walk','left']])
 preferences=types.normalizePetPreferences({character:'fox',name:'回来的狐狸'})
 store.getState().act('lifted');await store.getState().refresh();assert.equal(store.getState().gesture,null,'External preference changes also cancel the old partner')
 stop()
 console.log('PASS: legacy fox defaults; species sprite/portrait/preload dispatch; prop and paint forwarding; species switching cancels gestures, attachments and notices.')
})().catch(error=>{console.error(error);process.exitCode=1})
