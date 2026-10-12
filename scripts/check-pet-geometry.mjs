import fs from 'node:fs'
import assert from 'node:assert/strict'
import ts from 'typescript'
const output=ts.transpileModule(fs.readFileSync('src/companions/petGeometry.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS}}).outputText
const module={exports:{}};new Function('module','exports',output)(module,module.exports)
const {posePlacement,petViewport,petMovementMargin,PET_PEEK_RATIO}=module.exports
let count=0
for(const theme of ['jrpg','journal','island','farm']){
 const atlas=JSON.parse(fs.readFileSync(`public/pets/fox/${theme}.json`,'utf8'))
 const width=f=>(f.alphaBounds[2]-f.alphaBounds[0])/f.basis*(f.drawScale??1)
 const down=width(atlas.actions['sleep-down'].at(-1)),sleep=width(atlas.actions.sleep[0]),wake=width(atlas.actions.wake[0])
 assert(Math.abs(sleep/down-1)<.06,`${theme}: lying down must not suddenly shrink into sleep`)
 assert(Math.abs(wake/sleep-1)<.06,`${theme}: waking up must keep the curled body size`)
 for(const side of ['left','right']){
  const edge=atlas.actions['edge-'+side],dock=atlas.actions['dock-'+side],returned=atlas.actions['undock-'+side]
  assert.equal(edge.length,1,`${theme}: tucked idle must not cycle through incompatible silhouettes`)
  assert.deepEqual(dock.at(-1),{...edge[0],durationMs:70},`${theme}: tuck must end at the held pose`)
  assert.deepEqual(returned[0],dock.at(-1),`${theme}: reveal must begin at the held pose`)
 }
 for(const nominal of [64,96,128]){
  const viewport=petViewport(nominal)
  for(const [name,sequence] of [...Object.entries(atlas.actions),...['left','leftIdle','frontIdle'].filter(k=>atlas[k]).map(k=>[k,atlas[k]])]){
   for(const frame of sequence){
    const {x,y,w,scale}=posePlacement(frame,nominal),[left,top,right,bottom]=frame.alphaBounds
    const shift=frame.gripSide?(frame.gripSide==='left'?-1:1)*viewport*(1-PET_PEEK_RATIO):0
    const lo=x+(frame.flipX?w-right*scale:left*scale)+shift,hi=x+(frame.flipX?w-left*scale:right*scale)+shift
    assert(lo>=-1&&hi<=viewport+1&&y+top*scale>=-1&&y+bottom*scale<=viewport+1,`${theme} ${name} ${nominal}: clipped character`)
    if(frame.gripSide){
     const margin=petMovementMargin(nominal)
     assert(frame.gripSide==='left'?lo>=margin+1:hi<=viewport-margin-1,`${theme}: tucked head crosses the screen edge`)
     assert(y+bottom*scale<=viewport-Math.min(6,margin)-1,`${theme}: tucked chin crosses the bottom corner`)
     const edge=atlas.actions['edge-'+frame.gripSide][0]
     assert.equal(frame.drawScale,edge.drawScale,`${theme}: blink / return changes head size`)
    }
    count++
   }
  }
 }
 console.log(`PASS ${theme}: all poses fit at 64 / 96 / 128; tucked pose and return keep their ruler`)
}
console.log(`PASS ${count} painted frame placements`)
