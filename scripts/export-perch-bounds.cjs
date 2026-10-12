const fs=require('node:fs'),ts=require('typescript')
const code=ts.transpileModule(fs.readFileSync('src/companions/perchGeometry.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS}}).outputText,m={exports:{}}
new Function('module','exports',code)(m,m.exports)
const {perchKind,perchPin,perchPlacement}=m.exports
const modes=['top','top-hang','left','right','bottom','icon','icon-left'],lines=[]
for(const mode of modes){let box=[Infinity,Infinity,-Infinity,-Infinity]
 for(const skin of ['jrpg','journal','island','farm']){const a=JSON.parse(fs.readFileSync(`public/pets/fox/${skin}.json`));for(const f of Object.values(a.perches[perchKind(mode)]).flat()){
  const flip=mode==='right'||mode==='icon',p=perchPlacement(f,1,mode,flip),pin=perchPin(mode,1),[l,t,r,b]=f.alphaBounds
  const bounds=[p.x-pin.x+(flip?p.w-r*p.scale:l*p.scale),p.y-pin.y+t*p.scale,p.x-pin.x+(flip?p.w-l*p.scale:r*p.scale),p.y-pin.y+b*p.scale]
  box=[Math.min(box[0],bounds[0]),Math.min(box[1],bounds[1]),Math.max(box[2],bounds[2]),Math.max(box[3],bounds[3])]
 }}
 lines.push(` "${mode}"=>Some([${box.map(n=>n.toFixed(6)).join(',')}]),`)
 console.log(mode,box.map(n=>n.toFixed(3)).join(' '))
}
const icons=[];let iconSlotRatio=0
for(const mode of ['icon','icon-left']){let box=[Infinity,Infinity,-Infinity,-Infinity]
 for(const skin of ['jrpg','journal','island','farm']){const a=JSON.parse(fs.readFileSync(`public/pets/fox/${skin}.json`));for(const f of Object.values(a.perches.icon).flat()){
  if(!f.objectBox)continue
  iconSlotRatio=Math.max(iconSlotRatio,(f.objectBox[2]-f.objectBox[0])/f.basis*(f.drawScale??1)*1.08)
  const slot=f.objectBox,side=slot[2]-slot[0],cx=(slot[0]+slot[2])/2,cy=(slot[1]+slot[3])/2,[l,t,r,b]=f.alphaBounds,flip=mode==='icon'
  const bounds=[(flip?cx-r:l-cx)/side,(t-cy)/side,(flip?cx-l:r-cx)/side,(b-cy)/side]
  box=[Math.min(box[0],bounds[0]),Math.min(box[1],bounds[1]),Math.max(box[2],bounds[2]),Math.max(box[3],bounds[3])]
 }}icons.push(` "${mode}"=>Some([${box.map(n=>n.toFixed(6)).join(',')}]),`)
}
fs.writeFileSync('src-tauri/src/perch_bounds.rs','// Generated from original alpha bounds and paw anchors; scripts/export-perch-bounds.cjs.\npub const ICON_SLOT_RATIO:f64='+iconSlotRatio.toFixed(9)+';\npub fn visible(mode:&str)->Option<[f64;4]>{match mode{\n'+lines.join('\n')+'\n "sit"=>Some([-0.56,-0.97,0.56,0.0]),_=>None}}\n\npub fn icon(mode:&str)->Option<[f64;4]>{match mode{\n'+icons.join('\n')+'\n _=>None}}\n')
