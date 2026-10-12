const fs=require('node:fs'),assert=require('node:assert/strict'),ts=require('typescript')
const files=['math','pose'],modules={}
function load(name){if(modules[name])return modules[name].exports;const m={exports:{}};modules[name]=m;const file=`src/companions/rig/${name}.ts`;assert(fs.existsSync(file),`Missing actual skeleton implementation: ${name}`);const code=ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS}}).outputText;new Function('require','module','exports',code)(id=>load(id.replace('./','')),m,m.exports);return m.exports}
const {twoBone,worldBones,tailMesh}=load('math'),{samplePandaPose,PANDA_ACTIONS}=load('pose')
assert.equal(typeof tailMesh,'function','The ring tail needs one continuous skinned surface, not three disconnected furry blobs')
const mesh=tailMesh([{x:0,y:0},{x:0,y:-20},{x:-5,y:-40},{x:-10,y:-60}],30);assert.equal(mesh.length,90);assert(Array.from(mesh).every(Number.isFinite))
for(const target of [{x:24,y:10},{x:0,y:0},{x:100,y:100},{x:-20,y:12}])for(const bend of [-1,1]){
 const s=twoBone({x:0,y:0},target,20,18,bend);assert(Object.values(s).every(Number.isFinite));const ex=20*Math.cos(s.upper)+18*Math.cos(s.lower),ey=20*Math.sin(s.upper)+18*Math.sin(s.lower);assert(Math.hypot(ex,ey)<=38.001);if(Math.hypot(target.x,target.y)<38&&Math.hypot(target.x,target.y)>2)assert(Math.hypot(ex-target.x,ey-target.y)<.001,'IK must actually land on its reachable target')
}
const hierarchy=worldBones([{name:'root',x:10,y:20,rotation:Math.PI/2},{name:'child',parent:'root',x:5,y:0,rotation:0}]);assert(Math.abs(hierarchy.child.x-10)<1e-8&&Math.abs(hierarchy.child.y-25)<1e-8,'Child must inherit parent rotation')
assert.throws(()=>worldBones([{name:'a',parent:'b',x:0,y:0,rotation:0},{name:'b',parent:'a',x:0,y:0,rotation:0}]),/cycle/i)
let cases=0;const heads=new Set()
for(const action of PANDA_ACTIONS)for(const direction of ['left','right','front'])for(const time of [0,90,370,900,2100,7000]){
 const p=samplePandaPose({action,direction,timeMs:time});assert(p.parts.length>=12);assert(p.bones.length>=24);for(const part of p.parts){assert(['x','y','width','height','rotation','alpha'].every(k=>Number.isFinite(part[k])));assert(part.width>0&&part.height>0);if(part.id==='head')heads.add(part.width)}cases++
}
assert.equal(heads.size,1,'Sleeping and action changes must preserve the head ruler')
assert.equal(samplePandaPose({action:'idle',direction:'left',timeMs:100}).parts.find(p=>p.id==='head').asset,'head-left','Left view has dedicated artwork')
for(const mode of ['icon','icon-left']){
 const box=[35,62,70,97],p=samplePandaPose({action:'idle',direction:'right',timeMs:2200,attachment:mode,cutout:box});assert(p.contacts.length===2);for(const c of p.contacts){assert(c.x>=box[0]-2&&c.x<=box[2]+2);assert(c.y>=box[1]-2&&c.y<=box[3]+2);const hand=p.parts.find(p=>p.id===c.hand);assert(Math.hypot(hand.x-c.x,hand.y-c.y)<.001,'Drawn paw must match contact target')}
}
const a=samplePandaPose({action:'walk',direction:'right',timeMs:100}),b=samplePandaPose({action:'walk',direction:'right',timeMs:420});assert.notEqual(a.parts.find(p=>p.id==='paw-near').x,b.parts.find(p=>p.id==='paw-near').x,'Walking needs actual articulated feet')
for(const width of [24,48,96])for(const mode of ['icon','icon-left']){
 const box=[25,55,25+width,55+width],p=samplePandaPose({action:'idle',timeMs:100,attachment:mode,cutout:box}),top=p.contacts.find(c=>c.hand==='paw-far'),press=Math.min(3,2,width*.045)
 const expectedX=mode==='icon'?box[2]-Math.min(12,width*.3):box[0]+Math.min(12,width*.3)
 assert(Math.hypot(top.x-expectedX,top.y-(box[1]+press))<.01,'Top hand must hit requested real contact; unreachable IK must not silently invent a contact')
}
const left=samplePandaPose({action:'edge-left',timeMs:100}),right=samplePandaPose({action:'edge-right',timeMs:100});assert(Math.abs(left.parts.find(p=>p.id==='head').x+right.parts.find(p=>p.id==='head').x-150)<.01,'The two edge poses must occupy opposite sides')
const idle=samplePandaPose({action:'idle',timeMs:100}),frontPaw=idle.parts.find(p=>p.id==='paw-near'),foot=idle.parts.find(p=>p.id==='hind-near');assert(frontPaw.y<foot.y-15,'Upright panda rests forepaws beside its belly, not as a second pair of long legs')
for(const action of ['sleep-down','book-open','book-close','dock-left','undock-right']){
 const start=samplePandaPose({action,timeMs:0,durationMs:1000}),end=samplePandaPose({action,timeMs:1000,durationMs:1000});assert(Math.hypot(start.parts.find(p=>p.id==='head').x-end.parts.find(p=>p.id==='head').x,start.parts.find(p=>p.id==='head').y-end.parts.find(p=>p.id==='head').y)>2,action+' needs a real transition, not one endpoint pose')
}
const entering=samplePandaPose({action:'idle',timeMs:0,durationMs:440,attachment:'icon',attachmentPhase:'enter',cutout:[35,62,70,97]}),heldPose=samplePandaPose({action:'idle',timeMs:440,durationMs:440,attachment:'icon',attachmentPhase:'enter',cutout:[35,62,70,97]});assert(Math.abs(entering.parts.find(p=>p.id==='head').y-heldPose.parts.find(p=>p.id==='head').y)>10,'Enter phase must lower into the grip')
console.log(`PASS ${cases} skeleton poses, hierarchy, two-link IK, fixed head ruler, dedicated left view and actual hand contacts`)
