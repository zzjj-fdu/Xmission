const fs=require('node:fs'),assert=require('node:assert/strict'),ts=require('typescript')
let now=1000000,serial=0;const timers=new Map()
const timeout=(fn,ms)=>{const id=++serial;timers.set(id,{fn,at:now+ms});return id}
global.window={setTimeout:timeout,clearTimeout:id=>timers.delete(id)}
global.clearTimeout=window.clearTimeout;Date.now=()=>now
function advance(ms){const end=now+ms;let turns=0;while(true){const due=[...timers].filter(([,v])=>v.at<=end).sort((a,b)=>a[1].at-b[1].at)[0];if(!due)break;assert(++turns<2000);now=due[1].at;timers.delete(due[0]);due[1].fn()}now=end}
function load(path,dependencies){const src=fs.readFileSync(path,'utf8'),code=ts.transpileModule(src,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020}}).outputText,module={exports:{}};new Function('require','module','exports',code)(id=>dependencies[id]??require(id),module,module.exports);return module.exports}
const behavior=load('src/companions/behavior.ts',{})
const {useCompanionStore:s}=load('src/store/companion.ts',{'@tauri-apps/api/event':{listen:async()=>()=>{}},'../api/companion':{getCompanionHome:async()=>({}),updateCompanionPreferences:async()=>({})},'../companions/behavior':behavior,'../companions/types':load('src/companions/types.ts',{})})
const preferences={enabled:true,desktopEnabled:true,displayMode:'normal',proactive:true,reducedMotion:false};s.setState({home:{preferences,focus:false,trip:null}})
s.getState().setActivity('focus');assert.equal(s.getState().gesture,'book-open');advance(1200);assert.equal(s.getState().pose,'focus')
advance(1000);s.getState().act('pet');assert.equal(s.getState().gesture,'book-close');advance(650);assert.equal(s.getState().gesture,'pet');advance(1600);assert.equal(s.getState().gesture,'book-open');advance(1200);assert.equal(s.getState().pose,'focus');assert.equal(s.getState().activityElapsed.focus,1000)
s.getState().act('lifted');advance(650+640);assert.equal(s.getState().gesture,'lifted');s.getState().act('land');advance(800+1200+1200);assert.equal(s.getState().pose,'focus');assert.equal(s.getState().gesture,null)
s.getState().setActivity('sleep');advance(1000+1800);assert.equal(s.getState().pose,'sleep');s.getState().setActivity('idle');advance(1400);assert.equal(s.getState().pose,'idle')
s.getState().act('pet');s.getState().act('groom');advance(1800);assert.equal(s.getState().gesture,null);assert.equal(s.getState().pose,'idle')
s.getState().act('pet');s.getState().acceptFeedback({batchId:'dedupe-test',kind:'completed',count:3});s.getState().acceptFeedback({batchId:'dedupe-test',kind:'completed',count:3});assert.equal(s.getState().pending.length,1);advance(1600);assert.equal(s.getState().gesture,'daily');advance(3500);s.getState().acceptFeedback({batchId:'dedupe-test',kind:'completed',count:3});assert.equal(s.getState().gesture,null)
console.log('PASS: focus restoration, preserved reading phase, drag/drop restoration, sleep/wake, stale timer cancellation, queued batch deduplication.')
s.getState().playPaper();assert.equal(s.getState().paperPlaying,false,'Paper habit requires a learned skill')
s.setState({home:{preferences,focus:false,trip:null,growth:{paperSkill:true}}})
s.getState().playPaper();assert.equal(s.getState().gesture,'game-turn');assert.equal(s.getState().paperPlaying,true)
advance(650);assert.equal(s.getState().gesture,'game-wait');advance(1000+650);assert.equal(s.getState().gesture,'game-match');advance(1200);assert.equal(s.getState().paperPlaying,false)
s.getState().playPaper();s.getState().act('lifted');assert.equal(s.getState().paperPlaying,false);advance(640);assert.equal(s.getState().gesture,'lifted','Drag cancels the whole paper habit')
s.getState().reset();s.setState({perched:true});s.getState().playPaper();assert.equal(s.getState().gesture,null)
console.log('PASS: learned paper habit, full idle chain, drag cancellation, window perch remains quiet.')
s.getState().reset();s.setState({perched:false,exploring:false,home:{preferences:{...preferences,displayMode:'mini'},focus:false,trip:null,growth:{paperSkill:true}}});s.getState().playPaper();assert.equal(s.getState().paperPlaying,false,'The mini task ball cannot start a fox game')
s.setState({home:{preferences,focus:false,trip:null,growth:{paperSkill:true}},exploring:true});s.getState().playPaper();assert.equal(s.getState().paperPlaying,false,'Automatic approach and a local game must not run together')
s.setState({exploring:false,fetchPhase:'run'});s.getState().playPaper();assert.equal(s.getState().paperPlaying,false,'A desktop toy chase must not start a second card game')
