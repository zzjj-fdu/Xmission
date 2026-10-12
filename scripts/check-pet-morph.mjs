import fs from 'node:fs'
import assert from 'node:assert/strict'
import ts from 'typescript'
const code=ts.transpileModule(fs.readFileSync('src/companions/petMorphMotion.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS}}).outputText
const module={exports:{}};new Function('module','exports',code)(module,module.exports)
const {petMorphMotion,PET_MORPH_OUT_MS,PET_MORPH_IN_MS}=module.exports
const cue=to=>({id:1,from:to==='mini'?'normal':'mini',to,size:96,startedAt:10000,durationMs:to==='mini'?PET_MORPH_OUT_MS:PET_MORPH_IN_MS,stage:'start'})
const out=cue('mini'),into=cue('normal'),at=(c,t)=>petMorphMotion(c,c.startedAt+t)
assert.equal(at(out,-100).action,'lift');assert.equal(at(out,0).rise,0)
assert(at(out,300).rise>0);assert.equal(at(out,300).light,0)
assert.equal(at(out,600).action,'lifted');assert.equal(at(out,600).foxAlpha,1)
assert(at(out,1200).light>.9);assert(at(out,1500).ballAlpha>.5)
assert.equal(at(out,PET_MORPH_OUT_MS).ballAlpha,1);assert.equal(at(out,PET_MORPH_OUT_MS).foxAlpha,0)
assert.equal(at(into,0).ballAlpha,1);assert.equal(at(into,0).foxAlpha,0)
assert.equal(at(into,1150).action,'lifted');assert.equal(at(into,1150).rise,1)
assert.equal(at(into,1150).foxAlpha,1);assert.equal(at(into,1150).ballAlpha,0)
assert(at(into,1550).rise<at(into,1350).rise)
assert.equal(at(into,1800).action,'land');assert.equal(at(into,1800).rise,0)
assert.equal(at(into,2000).startedAt,into.startedAt+1800)
assert.equal(at(into,2450).finished,true)
for(const c of [out,into]){
 for(let t=0;t<=c.durationMs;t+=10){const p=at(c,t);for(const n of ['rise','foxAlpha','ballAlpha','light'])assert(p[n]>=0&&p[n]<=1,`${c.to}: invalid ${n}`)}
 const reduced={...c,durationMs:160};assert.equal(at(reduced,80).action,'idle');assert.equal(at(reduced,80).rise,0);assert.equal(at(reduced,160).finished,true)
}
console.log('PASS fox → lift → suspend → light → ball; ball → light → suspended fox → fall → landing; reduced motion')
