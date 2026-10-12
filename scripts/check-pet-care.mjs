import fs from 'node:fs'
import assert from 'node:assert/strict'
import ts from 'typescript'
function read(path){const m={exports:{}};new Function('module','exports',ts.transpileModule(fs.readFileSync(path,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS}}).outputText)(m,m.exports);return m.exports}
const t=read('src/companions/touchPolicy.ts'),p=read('src/companions/petPolicy.ts')
assert.equal(t.directCare('head',true,false),'stroke')
for(const part of ['body','tail','bag'])assert.equal(t.directCare(part,true,false),'brush')
assert.equal(t.directCare('body',false,false),null);assert.equal(t.directCare('head',true,true),null)
assert(!t.careReady('brush',2000,0,96));assert(t.careReady('brush',550,22,96));assert(!t.careReady('stroke',699,100,96));assert(t.careReady('stroke',700,0,96))
for(const a of ['lift','lifted','walk','book-open','rain','snow','wake'])assert(!t.careMayInterrupt(a))
assert(t.careMayInterrupt(null))
for(let left=0;left<=288;left++){assert(p.facingRightChance(left,288,96)>=.5);if(left)assert(p.facingRightChance(left,288,96)<=p.facingRightChance(left-1,288,96))}
assert(p.facingRightChance(0,288,96)>.9);assert(p.facingRightChance(288,0,96)<.1)
assert.equal(p.cursorFacing({leftRoom:0,rightRoom:500,size:96,cursorX:-20,cursorY:48,blocked:false}),null)
const c=p.createLifeClock(0,()=>0);c.weatherAt=0
assert.equal(p.nextLifeAction(c,1,'snow:noon','snow',[],()=>0),'snow')
assert.equal(p.nextLifeAction(c,1000,'snow:noon','snow',[],()=>0),null)
console.log('PASS direct care, drag separation, slow-body motion, action ownership, edge probability and weather cooldown')
