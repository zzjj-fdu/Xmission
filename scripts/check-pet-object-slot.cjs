const fs=require('node:fs'),assert=require('node:assert/strict'),ts=require('typescript')
const code=ts.transpileModule(fs.readFileSync('src/companions/perchGeometry.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS}}).outputText,m={exports:{}}
new Function('module','exports',code)(m,m.exports)
const{perchPlacement}=m.exports
let cases=0
for(const skin of ['jrpg','journal','island','farm']){
 const a=JSON.parse(fs.readFileSync(`public/pets/fox/${skin}.json`)),frames=Object.values(a.perches.icon).flat(),side=frames[0].objectBox[2]-frames[0].objectBox[0]
 for(const f of frames){assert(f.objectBox);assert.equal(f.objectBox[2]-f.objectBox[0],side,'A blink must not change the character scale')
  for(const mode of ['icon','icon-left'])for(const actualSide of [20,24,28]){
   const box=[60,70,60+actualSide,70+actualSide],flip=mode==='icon',p=perchPlacement(f,160,mode,flip,box),o=f.objectBox
   const left=p.x+(flip?p.w-o[2]*p.scale:o[0]*p.scale),right=p.x+(flip?p.w-o[0]*p.scale:o[2]*p.scale)
   const press=Math.min(3,160*.02,actualSide*.045),dx=flip?-press:press
   assert(Math.abs(left-box[0]-dx)<1e-6&&Math.abs(right-box[2]-dx)<1e-6&&Math.abs(p.y+o[1]*p.scale-box[1]-press)<1e-6&&Math.abs(p.y+o[3]*p.scale-box[3]-press)<1e-6,'The embrace translates inward without shrinking or stretching its slot')
   let top=0,front=0
   for(const[y,...runs]of f.foregroundMask)for(let i=0;i<runs.length;i+=2)for(let x=runs[i];x<runs[i]+runs[i+1];x++){
    if(y<o[1]+side*.18&&x>o[0]+side*.25)top++
    if(y>o[1]+side*.22&&y<o[1]+side*.68&&x<o[0]+side*.25)front++
   }
   assert(top>25&&front>25,`${skin}: needs both a top grip and a separate front grip`);cases++
  }
 }
}
console.log(`PASS ${cases} whole-object bindings: both sides, four themes, two separated paw grips and stable blink scale`)
