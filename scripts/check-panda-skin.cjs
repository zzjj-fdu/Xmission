const fs=require('node:fs'),assert=require('node:assert/strict'),ts=require('typescript'),mods={}
function load(n){if(mods[n])return mods[n].exports;const m={exports:{}};mods[n]=m;assert(fs.existsSync(`src/companions/rig/${n}.ts`),'Missing complete-anatomy skinning: '+n);const code=ts.transpileModule(fs.readFileSync(`src/companions/rig/${n}.ts`,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS}}).outputText;new Function('require','module','exports',code)(s=>load(s.replace('./','')),m,m.exports);return m.exports}
const {skinPlan,skinVertices}=load('skin'),{PANDA_ACTIONS}=load('pose')
let count=0
for(const theme of ['jrpg','journal','island','farm'])for(const outfit of ['','-bare']){
 const atlas=JSON.parse(fs.readFileSync(`public/pets/red-panda/${theme}${outfit}-skin.json`))
 assert(atlas.bases.sleep.head[2]<atlas.bases['stand-right'].head[2]*1.25,'Sleeping face ruler must not include the orange tail: '+theme+outfit)
}
for(const theme of ['jrpg','journal','island','farm']){const atlas=JSON.parse(fs.readFileSync(`public/pets/red-panda/${theme}-skin.json`));assert.equal(Object.keys(atlas.bases).length,8)
 for(const action of PANDA_ACTIONS)for(const direction of ['left','right','front'])for(const timeMs of [0,220,1200]){
  const plan=skinPlan(atlas,{action,direction,timeMs}),vertices=skinVertices(plan);assert(Array.from(vertices).every(Number.isFinite));assert(plan.bones.length>=20);assert.equal(plan.headWidth,56);assert.equal(plan.scale,56/plan.frame.head[2]);assert.equal(vertices.length,41*49*2);count++
 }
 const p=skinPlan(atlas,{action:'run',direction:'front',timeMs:100});assert.equal(p.base,'walk-right','Locomotion must not stick a frontal face on a sideways body')
 for(const [action,first,last] of [['sleep-down','stand-right','sleep'],['wake','sleep','stand-right'],['book-open','stand-right','read'],['book-close','read','stand-right']]){
  assert.equal(skinPlan(atlas,{action,timeMs:0,durationMs:800}).base,first)
  assert.equal(skinPlan(atlas,{action,timeMs:800,durationMs:800}).base,last)
 }
 const a=skinVertices(skinPlan(atlas,{action:'walk',timeMs:0})),b=skinVertices(skinPlan(atlas,{action:'walk',timeMs:160}));assert(a.some((n,i)=>Math.abs(n-b[i])>.5),'Full surface must deform under limb bones, not only slide the whole sprite')
 for(const attachment of ['icon','icon-left']){
  const plan=skinPlan(atlas,{action:'idle',attachment,cutout:[62,62,102,102],timeMs:0}),v=skinVertices(plan)
  const xs=Array.from(v).filter((_,i)=>i%2===0),span=Math.max(...xs)-Math.min(...xs)
  assert(span>plan.frame.rect[2]*plan.scale*.8,'Grip correction must not collapse the torso and tail into the icon')
  const middle=24*41*2;assert(Math.abs(v[middle+80]-v[middle])>plan.frame.rect[2]*plan.scale*.8,'Grip must preserve the full middle silhouette width')
 }
}
console.log(`PASS ${count} complete anatomy skins, four themes, fixed head ruler and actual bone-deformed mesh`)
