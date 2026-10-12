// Use the actual drawing logic; stub only Pixi's GPU objects.
const fs=require('node:fs'),assert=require('node:assert/strict'),ts=require('typescript'),mods={}
class Container{children=[];scale={set(){}};addChild(n){this.children.push(n)}setChildIndex(n,i){this.children.splice(this.children.indexOf(n),1);this.children.splice(i,0,n)}destroy(){}}
class Plane{constructor(opts){this.texture=opts.texture;this.buffer={data:new Float32Array(opts.verticesX*opts.verticesY*2),update(){}};this.geometry={getAttribute:()=>({buffer:this.buffer})}}}
class Sprite{anchor={set(){}};position={set:(x,y)=>{this.x=x;this.y=y}};scale={set:(x,y)=>{this.sx=x;this.sy=y}};constructor(texture){this.texture=texture}}
const pixi={Container,MeshPlane:Plane,Sprite}
function load(n){if(mods[n])return mods[n].exports;const m={exports:{}};mods[n]=m;const code=ts.transpileModule(fs.readFileSync(`src/companions/rig/${n}.ts`,'utf8').replaceAll('import.meta.env.BASE_URL',"'/'"),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020}}).outputText;new Function('require','module','exports',code)(s=>s==='pixi.js'?pixi:s==='pixi.js/unsafe-eval'?{}:load(s.replace('./','')),m,m.exports);return m.exports}
const{PandaDrawing}=load('renderer'),data=JSON.parse(fs.readFileSync('public/pets/red-panda/island-bare-skin.json'))
const drawing=new PandaDrawing({data,textures:{},pixel:false,scarf:{}})
drawing.draw({action:'idle',timeMs:0,outfit:'scarf'},1,false)
drawing.draw({action:'sleep',timeMs:0,outfit:'scarf'},1,false)
const children=drawing.stage.children,planes=children.filter(p=>p instanceof Plane)
assert.equal(planes.at(-1).alpha,1,'Reduced motion must show the new complete pose immediately')
assert.equal(planes[0].visible,false,'Reduced motion must remove the old standing pose')
assert.equal(children.filter(c=>c instanceof Sprite).length,0,'Legacy scarf preference must not restore a disabled overlay')
console.log('PASS actual panda drawing: reduced-motion final pose and no legacy scarf overlay')
for(const skin of ['island','jrpg','journal','farm']){
const h=JSON.parse(fs.readFileSync(`public/pets/red-panda/${skin}-hybrid-v3.json`)),loaded={data:h,walk:h.walk.frames.map((_,i)=>'walk-'+i),run:h.run.frames.map((_,i)=>'run-'+i),collar:'collar',long:'long',short:'short'}
const hybrid=new PandaDrawing({data:JSON.parse(fs.readFileSync(`public/pets/red-panda/${skin}-skin.json`)),textures:{},pixel:skin==='jrpg'||skin==='farm',hybrid:loaded})
hybrid.draw({action:'walk',direction:'right',outfit:'theme',timeMs:0},1,true)
const body=hybrid.stage.children.find(c=>c instanceof Sprite);assert.equal(body.texture,'walk-0');assert.equal(hybrid.stage.children.filter(c=>c instanceof Plane).length,0,'Walking must not create floating cloth meshes')
assert.equal(hybrid.stage.children.filter(c=>c instanceof Sprite).length,1,'Only the complete body is displayed; no overlay collar')
hybrid.draw({action:'walk',direction:'left',outfit:'theme',timeMs:125},1,true);assert.equal(body.texture,'walk-1');assert(body.sx<0,'Full sequence mirrors cleanly for left facing')
hybrid.draw({action:'run',direction:'right',outfit:'theme',timeMs:150},1,true);assert.equal(body.texture,'run-2','Running uses its separately drawn airborne sequence')
assert(Math.abs(body.y+h.run.frames[2].rect[3]*body.sy-(142-h.run.frames[2].flight))<.001,'Flight remains above the floor')
hybrid.draw({action:'walk',direction:'right',outfit:'theme',timeMs:375},1,false);assert.equal(body.texture,'walk-3','Paused frame stepping paints the requested complete frame')
hybrid.draw({action:'walk',direction:'right',outfit:'theme',timeMs:375,scarfOnly:true},1,false);assert.equal(body.visible,true,'Obsolete cloth-only flag cannot hide the pet')
hybrid.draw({action:'idle',direction:'right',outfit:'theme',timeMs:0,scarfMotion:false},1,false);assert.equal(body.visible,false)
hybrid.draw({action:'run',direction:'right',outfit:'theme',timeMs:0,scarfMotion:false},1,true);assert.equal(body.visible,true);assert(hybrid.stage.children.filter(c=>c instanceof Plane).every(c=>c.visible===false))
hybrid.draw({action:'idle',direction:'left',outfit:'theme',timeMs:0},1,false)
assert.equal(hybrid.stage.children.filter(c=>c instanceof Sprite&&c.visible).length,0,'Idle cannot bring back an overlay collar')
hybrid.draw({action:'sleep',direction:'left',outfit:'theme',timeMs:0},1,false)
hybrid.draw({action:'walk',direction:'left',outfit:'theme',timeMs:250},1,false);assert(body.visible&&body.sx<0)
hybrid.destroy()
console.log(`PASS ${skin} drawing transitions`)
}
console.log('PASS actual hybrid renderer: body-only gaits, mirror, flight, stepping, idle/sleep return and disabled accessory compatibility')
