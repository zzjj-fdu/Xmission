// Real settings picker UI with in-memory preferences. No app DB or GPU.
const fs=require('node:fs'),assert=require('node:assert/strict'),ts=require('typescript'),React=require('react'),{JSDOM}=require('jsdom'),{create}=require('zustand')
assert(fs.existsSync('src/companions/CompanionPicker.tsx'),'Missing visible pet picker in Xmission settings')
const dom=new JSDOM('<div id="test"></div>',{pretendToBeVisual:true,url:'http://localhost/'})
Object.assign(global,{window:dom.window,document:dom.window.document,IS_REACT_ACT_ENVIRONMENT:true})
Object.defineProperty(global,'navigator',{value:dom.window.navigator,configurable:true})
const calls=[];let resolveSwitch,fail=false
const preferences={character:'fox',name:'小狐狸',outfit:'theme',appearance:'follow',enabled:false,desktopEnabled:false,displayMode:'closed'}
const store=create(set=>({home:{preferences,trip:null},loading:false,error:'',save:async patch=>{calls.push(patch);if(fail)throw Error('切换失败');if(patch.character)await new Promise(resolve=>resolveSwitch=resolve);set(s=>({home:{...s.home,preferences:{...s.home.preferences,...patch}}}))}}))
const mods={exports:{}},code=ts.transpileModule(fs.readFileSync('src/companions/CompanionPicker.tsx','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020,jsx:ts.JsxEmit.ReactJSX}}).outputText
const deps={'../store/companion':{useCompanionStore:store,startCompanionStore:()=>()=>{}},'../themes':{currentThemeKey:()=> 'animal-crossing'},'./types':{COMPANION_NAMES:{fox:'小狐狸','red-panda':'小熊猫'},DEFAULT_PET_PREFERENCES:preferences},'./CompanionSprite':{CompanionSprite:p=>React.createElement('span',{'data-character':p.character})},'./companion-picker.css':{}}
new Function('require','module','exports',code)(id=>deps[id]??require(id),mods,mods.exports)
const{createRoot}=require('react-dom/client'),{act}=React,root=createRoot(document.getElementById('test'))
const button=name=>document.querySelector(`[aria-label="${name}"]`)
const flush=async()=>{for(let i=0;i<6;i++)await Promise.resolve()}
;(async()=>{
 await act(async()=>{root.render(React.createElement(mods.exports.CompanionPicker));await flush()})
 assert(button('选择小熊猫'));assert.equal(button('选择小狐狸').getAttribute('aria-pressed'),'true')
 await act(async()=>{button('选择小熊猫').click();await flush()})
 assert.deepEqual(calls[0],{character:'red-panda'},'Selecting a species must persist through the existing store')
 assert(button('选择小熊猫').disabled&&button('选择小狐狸').disabled,'Do not allow competing saves during a switch')
 await act(async()=>{resolveSwitch();await flush()})
 assert.equal(button('选择小熊猫').getAttribute('aria-pressed'),'true');assert.equal(button('选择小狐狸').getAttribute('aria-pressed'),'false')
 await act(async()=>{button('让小熊猫来桌面').click();await flush()})
 assert.deepEqual(calls[1],{enabled:true,desktopEnabled:true,displayMode:'normal'},'Explicit recall reopens a closed desktop companion')
 fail=true;await act(async()=>{button('选择小狐狸').click();await flush()})
 assert(document.querySelector('[role="alert"]').textContent.includes('切换失败'));assert.equal(button('选择小熊猫').getAttribute('aria-pressed'),'true','Failed saves must preserve the selected pet')
 await act(async()=>{store.setState(s=>({home:{...s.home,trip:{state:'away'}}}));await flush()})
 assert(button('选择小狐狸').disabled,'Travel state must respect the existing backend switch constraint')
 const settings=fs.readFileSync('src/pages/SettingsPage.tsx','utf8');assert(settings.includes('<CompanionPicker/>'));assert(settings.indexOf('<CompanionPicker/>')<settings.indexOf('风景与天气'),'Pet picker is visible near theme settings');assert(settings.includes('<CompanionPreferences compact showPicker={false}/>'),'General settings must not duplicate the picker')
 await act(async()=>root.unmount());dom.window.close();console.log('PASS settings pet picker: visible fox/panda choices, persistent switch, busy lock, failure state, recall and travel constraint')
})().catch(async e=>{console.error(e);await act(async()=>root.unmount());dom.window.close();process.exitCode=1})
