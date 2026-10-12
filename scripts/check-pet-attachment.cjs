// A delayed initial native snapshot must not resurrect a released grip.
const fs=require('node:fs'),assert=require('node:assert/strict'),ts=require('typescript')
global.window={setTimeout:()=>1,clearTimeout:()=>{},setInterval:()=>1}
global.document={hidden:false,addEventListener:()=>{},removeEventListener:()=>{}}
global.clearInterval=()=>{};global.clearTimeout=()=>{}
const listeners=new Map();let resolve
let snapshot=new Promise(r=>resolve=r)
function load(path,deps){const code=ts.transpileModule(fs.readFileSync(path,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020}}).outputText,module={exports:{}};new Function('require','module','exports',code)(id=>deps[id]??require(id),module,module.exports);return module.exports}
const behavior=load('src/companions/behavior.ts',{})
const mod=load('src/store/companion.ts',{
 '@tauri-apps/api/core':{invoke:()=>snapshot},
 '@tauri-apps/api/event':{listen:async(name,fn)=>{listeners.set(name,fn);return()=>listeners.delete(name)}},
 '../api/companion':{getCompanionHome:async()=>({preferences:{enabled:true},trip:null,focus:false}),updateCompanionPreferences:async()=>({})},
 '../companions/behavior':behavior,'../companions/types':load('src/companions/types.ts',{}),
})
;(async()=>{
 const stop=mod.startCompanionStore(),s=mod.useCompanionStore
 await Promise.resolve();await Promise.resolve()
 listeners.get('companion-perch')({payload:true});listeners.get('companion-attachment')({payload:'left'})
 listeners.get('companion-perch-motion')?.({payload:{phase:'enter',mode:'left'}})
 resolve('right');await snapshot;await Promise.resolve()
 assert.equal(s.getState().attachment,'left','Old initial read cannot swap the selected side')
 listeners.get('companion-perch')({payload:false})
 listeners.get('companion-attachment')({payload:{mode:null,cutout:null}})
 assert.equal(s.getState().attachment,null,'The atomic placement release clears the render mode');assert.equal(s.getState().perched,false)
 stop();assert.equal(listeners.size,0)
 snapshot=new Promise(r=>resolve=r)
 const stopSecond=mod.startCompanionStore();await Promise.resolve();await Promise.resolve()
 s.setState({home:{preferences:{enabled:true,desktopEnabled:true,displayMode:'normal',appearance:'follow'},focus:false,trip:null}})
 const {createPerchMotion}=load('src/companions/perchMotion.ts',{})
 const motion=createPerchMotion({getState:s.getState,getTheme:()=> 'animal-crossing',preload:async()=>{},face:()=>{},update:patch=>s.setState(patch),ready:async()=>{},error:()=>{}})
 listeners.get('companion-perch-motion')?.({payload:{phase:'hold',mode:'bottom'}})
 await motion.handle({phase:'hold',mode:'bottom',id:4})
 resolve(null);await snapshot;await Promise.resolve()
 assert.equal(s.getState().attachment,'bottom','A late empty snapshot cannot erase an active exploration grip')
 assert.equal(s.getState().perched,true)
 listeners.get('companion-attachment')({payload:{mode:'icon-left',cutout:[120,30,168,78]}})
 assert.deepEqual(s.getState().attachmentCutout,[120,30,168,78]);assert.equal(s.getState().attachment,'icon-left')
 // A manual grip can replace the automatic one before its delayed end arrives.
 s.setState({attachment:'top',perched:true,attachmentMotion:null})
 await motion.handle({phase:'end',mode:'bottom',id:4})
 assert.equal(s.getState().attachment,'top','An old motion must not release a newer manual grip')
 assert.equal(s.getState().perched,true)
 stopSecond();motion.cancel();assert.equal(listeners.size,0)
 console.log('PASS delayed snapshot isolation, immediate release, side identity, listener cleanup')
})().catch(e=>{console.error(e);process.exitCode=1})
