const fs=require('node:fs'),assert=require('node:assert/strict'),ts=require('typescript')
function load(path,deps={}){if(!fs.existsSync(path))return{};const code=ts.transpileModule(fs.readFileSync(path,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020}}).outputText,m={exports:{}};new Function('require','module','exports',code)(id=>deps[id]??require(id),m,m.exports);return m.exports}
const {perchKind,perchPin,perchPlacement}=load('src/companions/perchGeometry.ts')
const {clearIconPicture}=load('src/companions/petGeometry.ts')
const holes=[];clearIconPicture({clearRect:(...box)=>holes.push(box)},[72,33,120,81]);assert.deepEqual(holes,[[72,33,48,48]])
clearIconPicture({clearRect:()=>assert.fail('Invalid metrics must not cut out the whole fox')},[0,0,NaN,81])
let count=0
for(const skin of ['jrpg','journal','island','farm']){
 const atlas=JSON.parse(fs.readFileSync(`public/pets/fox/${skin}.json`));assert(atlas.perches)
 for(const f of atlas.perches.icon.hold)assert(f.foregroundMask?.length>2,`${skin}: icon grip needs a separate foreground paw layer`)
 for(const size of [64,96,128])for(const mode of ['top','top-hang','left','right','bottom','icon','icon-left'])for(const phase of ['enter','hold','leave']){
  const frames=atlas.perches[perchKind(mode)][phase];assert(frames.length>=2)
  for(const frame of frames){const flipped=mode==='right'||mode==='icon',p=perchPlacement(frame,size,mode,flipped),pin=perchPin(mode,size)
   const cx=p.x+(flipped?p.w-frame.contact[0]*p.scale:frame.contact[0]*p.scale),cy=p.y+frame.contact[1]*p.scale
   assert(Math.abs(cx-pin.x)<.001&&Math.abs(cy-pin.y)<.001,'Paw anchor drift')
   const [l,t,r,b]=frame.alphaBounds,left=p.x+(flipped?p.w-r*p.scale:l*p.scale),right=p.x+(flipped?p.w-l*p.scale:r*p.scale)
   assert(left>=-1&&right<=size*1.5+1&&p.y+t*p.scale>=-1&&p.y+b*p.scale<=size*1.5+1,`${skin} ${mode} ${phase}: clipped attachment`)
   assert(frame.source===(mode.startsWith('icon')?`v14/${skin}-icon-hug.png`:`v10/${skin}-perch.png`));count++
  }
 }
}
const {createPerchMotion}=load('src/companions/perchMotion.ts');assert.equal(typeof createPerchMotion,'function','Need interruptible attachment motion controller')
;(async()=>{
 let state={dragging:false,home:{focus:false,preferences:{enabled:true,desktopEnabled:true,displayMode:'normal',appearance:'follow'}},gesture:null};const actions=[],changes=[],ready=[]
 state.act=(action)=>{state.gesture=action;actions.push(action)}
 const host={getState:()=>state,getTheme:()=> 'animal-crossing',preload:async()=>{},face:()=>{},update:p=>changes.push(p),ready:async id=>ready.push(id),error:()=>{}}
 const motion=createPerchMotion(host)
 await motion.handle({phase:'prepare',id:1,mode:'left',direction:'right'});assert.deepEqual(ready,[1]);assert.equal(actions.at(-1),'attention')
 await motion.handle({phase:'walk',id:1,mode:'left',durationMs:1000});assert.equal(actions.at(-1),'walk')
 await motion.handle({phase:'enter',id:1,mode:'left',durationMs:440});assert.equal(changes.at(-1).attachment,'left');assert.equal(changes.at(-1).attachmentMotion.phase,'enter')
 await motion.handle({phase:'walk',id:1,mode:'left',durationMs:500});assert.equal(changes.at(-1).attachment,null,'Leaving a grip must clear it in the same locomotion update');assert.equal(changes.at(-1).perched,false)
 await motion.handle({phase:'hold',id:1,mode:'left'});assert.equal(changes.at(-1).exploring,false)
 await motion.handle({phase:'leave',id:1,mode:'left',durationMs:400});assert.equal(changes.at(-1).attachmentMotion.phase,'leave')
 await motion.handle({phase:'settle',id:1,mode:'left'});assert.equal(actions.at(-1),'land','Detach must settle locally instead of walking back');assert.equal(changes.at(-1).attachment,null)
 await motion.handle({phase:'end',id:1});assert.equal(changes.at(-1).attachmentMotion,null)
 assert.equal(changes.at(-1).attachment,null,'A cancelled phase cannot leave the old hold pose alive')
 let release;const wait=new Promise(r=>release=r),late=[]
 const stale=createPerchMotion({...host,preload:()=>wait,ready:async id=>late.push(id)})
 const pending=stale.handle({phase:'prepare',id:2,mode:'right'});await stale.handle({phase:'end',id:2});release();await pending;assert.equal(late.length,0)
 motion.cancel();await motion.handle({phase:'enter',id:5,mode:'right'});assert.equal(changes.at(-1).attachmentMotion,null)
 console.log(`PASS ${count} attachment frames: paw anchors, all-theme clipping, left/right, phase chain and late-preload cancellation`)
})().catch(e=>{console.error(e);process.exitCode=1})
