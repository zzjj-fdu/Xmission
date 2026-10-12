const fs=require('node:fs'),assert=require('node:assert/strict'),ts=require('typescript'),mods={}
function load(n){if(mods[n])return mods[n].exports;const m={exports:{}};mods[n]=m;assert(fs.existsSync(`src/companions/rig/${n}.ts`),'Missing hybrid motion module');const code=ts.transpileModule(fs.readFileSync(`src/companions/rig/${n}.ts`,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS}}).outputText;new Function('require','module','exports',code)(s=>load(s.replace('./','')),m,m.exports);return m.exports}
const{hybridFrame,scarfChain,scarfVertices}=load('hybrid')
for(const skin of ['island','jrpg','journal','farm']){
const data=JSON.parse(fs.readFileSync(`public/pets/red-panda/${skin}-hybrid-v3.json`))
for(const image of [data.walk.image,data.run.image,data.scarf.image])assert(fs.existsSync(`public/pets/red-panda/${image}`),`Missing ${skin} art`)
assert.notEqual(data.walk.image,data.run.image,'Running must be separately drawn')
for(const gait of ['walk','run']){assert.equal(data[gait].frames.length,8);assert(data[gait].frames.every(f=>f.rect[2]>0&&f.rect[3]>0));const seen=new Set();for(let ms=0;ms<1600;ms+=25){const p=hybridFrame(data,{action:gait,timeMs:ms,direction:'right'});seen.add(p.index);assert.equal(p.scale,56/data[gait].basis);const l=hybridFrame(data,{action:gait,timeMs:ms,direction:'left'});assert.equal(l.frame,p.frame);assert.equal(l.flip,true);assert(Number.isFinite(p.frame.chinY),'Need actual muzzle-bottom landmark to place the collar');const collarTop=p.neck.y+4-23*data.scarf.parts.collar[3]/data.scarf.parts.collar[2]/2;assert(collarTop>=p.y+p.frame.chinY*p.scale-1,'Collar must sit below the muzzle, not across the face')}assert.equal(seen.size,8)}
assert(data.run.frames.some(f=>f.flight>0),'Airborne running frames must not have the paws stuck to the floor')
assert.equal(hybridFrame(data,{action:'run-stop',timeMs:900,durationMs:500}).index,7)
console.log(`PASS ${skin}: eight walk/run phases, fixed scale, mirrored collar below muzzle`)
}
for(const timeMs of [0,150,450,800,1600])for(const direction of ['left','right']){
 const root={x:95,y:88},chain=scarfChain(root,{action:'run',direction,timeMs},32);assert.deepEqual(chain[0],root,'Collar anchor must never drift')
 for(let i=1;i<chain.length;i++)assert(Math.abs(Math.hypot(chain[i].x-chain[i-1].x,chain[i].y-chain[i-1].y)-32/3)<1e-6,'Cloth bones retain their length')
 assert(Array.from(scarfVertices(chain,8)).every(Number.isFinite))
}
assert.notDeepEqual(scarfChain({x:95,y:88},{action:'run',timeMs:0},32),scarfChain({x:95,y:88},{action:'run',timeMs:300},32),'Scarf has independent delayed motion')
console.log('PASS separate eight-frame gaits, flight, stable scale, mirror, braking, fixed scarf root and continuous cloth chain')
