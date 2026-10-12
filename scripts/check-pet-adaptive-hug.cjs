const fs=require('node:fs'),assert=require('node:assert/strict'),ts=require('typescript')
const code=ts.transpileModule(fs.readFileSync('src/companions/perchGeometry.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS}}).outputText,m={exports:{}}
new Function('module','exports',code)(m,m.exports)
let count=0
for(const skin of ['jrpg','journal','island','farm'])for(const f of Object.values(JSON.parse(fs.readFileSync(`public/pets/fox/${skin}.json`)).perches.icon).flat()){
 for(const size of [64,96,128])for(const side of [24,48,64,96,128])for(const mode of ['icon','icon-left']){
  const box=[70,60,70+side,60+side],flip=mode==='icon',p=m.exports.perchPlacement(f,size,mode,flip,box),o=f.objectBox
  assert(p.scale<=size/f.basis*f.drawScale*1.08+1e-8,'A large icon must not inflate the fox beyond its ordinary ruler')
  const edge=p.x+(flip?p.w-o[0]*p.scale:o[0]*p.scale)
  const press=Math.min(3,size*.02,side*.045)
  assert(Math.abs(edge-(flip?box[2]-press:box[0]+press))<1e-8,'Front paw must overlap the visible icon slightly on either side')
  assert(Math.abs(p.y+o[1]*p.scale-box[1]-press)<1e-8,'Top paw must settle slightly inside the rounded icon edge')
  assert(Math.abs(p.scale-Math.min(side/(o[2]-o[0]),size/f.basis*f.drawScale*1.08))<1e-8,'Contact correction must not change fox scale')
  count++
 }
}
console.log(`PASS ${count} adaptive embraces: stable maximum fox size, both icon edges and top grip`)
