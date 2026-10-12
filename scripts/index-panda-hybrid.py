"""Read original generated PNGs; write animation metadata, never edit pixels."""
import ast,json
from pathlib import Path
import numpy as np
from PIL import Image
root=Path(__file__).resolve().parents[1]/'public/pets/red-panda'
# Reuse the same alpha connected-component algorithm, without executing the
# original indexer's top-level asset writes.
tree=ast.parse((Path(__file__).parent/'index-panda-bases.py').read_text())
node=next(n for n in tree.body if isinstance(n,ast.FunctionDef) and n.name=='components')
exec(compile(ast.Module(body=[node],type_ignores=[]),'<alpha-components>','exec'))
# Retain run membership as well as bounds for runtime sprite masks. Original
# PNG pixels are never rewritten; a bounding box can overlap a neighbouring tail.
mask_node=ast.parse(ast.unparse(node));fn=mask_node.body[0];fn.name='component_runs'
fn.body[-1:]=ast.parse('''
labelled={}
for a,b,y,label in runs:
 key=find(label)
 labelled.setdefault(key,[]).append((y,a,b-a))
return sorted(labelled.values(),key=lambda rs:sum(r[2] for r in rs),reverse=True)
''').body
exec(compile(ast.fix_missing_locations(mask_node),'<silhouette-runs>','exec'))
def index_gait(skin,gait):
 image=f'{skin}-{gait}-v3.png';rgba=np.array(Image.open(root/image).convert('RGBA'))
 groups=[g for g in components(rgba[:,:,3]>96) if g[4]>6000][:8]
 assert len(groups)==8,(gait,'Need eight complete separate characters',len(groups))
 groups=sorted(groups,key=lambda g:(g[1]+g[3])/2);groups=sorted(groups[:4])+sorted(groups[4:])
 frames=[];spans=[]
 for i,(a,b,c,d,_) in enumerate(groups):
  a,b,c,d=max(0,a-4),max(0,b-4),min(rgba.shape[1],c+4),min(rgba.shape[0],d+4)
  local=rgba[b:d,a:c];h,w=local.shape[:2];r,g,blue=[local[:,:,k].astype(np.int16) for k in range(3)]
  face=(r>180)&(g>75)&(r-g>35)&(g-blue>25)&(local[:,:,3]>128)
  face[:,:int(w*.5)]=False;face[int(h*.65):]=False
  blobs=components(face);assert blobs
  x0,y0,x1,y1,_=blobs[0];span=(x1-x0)*1.18;spans.append(span)
  head=[(x0+x1)/2,(y0+y1)/2]
  # Cream muzzle is separated from the cream belly by the green vest. Keep
  # the collar below its actual painted bottom, rather than the orange crown.
  muzzle=(r>180)&(g>170)&(blue>145)&(local[:,:,3]>128)
  muzzle[:,:int(w*.60)]=False;muzzle[:int(head[1])]=False;muzzle[int(head[1]+span*.65):]=False
  cheeks=[v for v in components(muzzle) if v[4]>300]
  chin=cheeks[0][3] if cheeks else head[1]+span*.46
  neck=[head[0]-span*.28,chin+span*.07]
  groups=component_runs(local[:,:,3]>8);mask=[]
  if len(groups)>1 and sum(r[2] for r in groups[1])>10:
   # A two-pixel margin keeps the painted soft fringe while cutting distant
   # neighbouring silhouettes. Very faint alpha can bridge otherwise separate pets.
   keep=np.zeros((h,w),dtype=bool)
   for row,x,n in groups[0]:keep[max(0,row-2):min(h,row+3),max(0,x-2):min(w,x+n+2)]=True
   for row,line in enumerate(keep):
    edge=np.diff(np.pad(line.astype(np.int8),(1,1)));starts=np.flatnonzero(edge==1);ends=np.flatnonzero(edge==-1)
    if len(starts):mask.append([row,*[v for x,z in zip(starts,ends) for v in (int(x),int(z-x))]])
  frames.append({'rect':[a,b,c-a,d-b],'head':head,'chinY':chin,'neck':neck,'mask':mask,'flight':(5.5 if i==2 else 8.5 if i==5 else 0) if gait=='run' else 0})
 basis=round(float(np.median(spans)),2)
 assert max(spans)/min(spans)<1.30,(gait,'Face proportion drift')
 print(f'PASS {skin} {gait}: 8 complete frames, shared ruler {basis}')
 return {'image':image,'basis':basis,'frameMs':125 if gait=='walk' else 75,'frames':frames}

for skin in ['island','jrpg','journal','farm']:
 result={'version':3,'walk':index_gait(skin,'walk'),'run':index_gait(skin,'run')}
 scarf_image=f'{skin}-scarf-v3'+('b' if skin=='island' else '')+'.png'
 rgba=np.array(Image.open(root/scarf_image).convert('RGBA'))
 parts=sorted([g for g in components(rgba[:,:,3]>96) if g[4]>3000][:3])
 assert len(parts)==3,(skin,'Need three independent cloth pieces')
 result['scarf']={'image':scarf_image,'parts':{name:[a,b,c-a,d-b] for name,(a,b,c,d,_) in zip(['collar','long','short'],parts)}}
 (root/f'{skin}-hybrid-v3.json').write_text(json.dumps(result,ensure_ascii=False,indent=2),encoding='utf8')
print('PASS all four themes: original alpha, independent eight-frame gaits, collar and scarf ends')
