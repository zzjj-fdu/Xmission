"""A frame rectangle must not render pixels belonging to a neighbouring pet."""
import ast,json
from pathlib import Path
import numpy as np
from PIL import Image
root=Path(__file__).resolve().parents[1]/'public/pets/red-panda'
tree=ast.parse((Path(__file__).parent/'index-panda-bases.py').read_text())
node=next(n for n in tree.body if isinstance(n,ast.FunctionDef) and n.name=='components')
exec(compile(ast.Module(body=[node],type_ignores=[]),'<components>','exec'))
for skin in ['island','jrpg','journal','farm']:
 data=json.loads((root/f'{skin}-hybrid-v3.json').read_text())
 for gait in ['walk','run']:
  alpha=np.array(Image.open(root/data[gait]['image']).convert('RGBA'))[:,:,3]
  for i,f in enumerate(data[gait]['frames']):
   x,y,w,h=f['rect'];crop=alpha[y:y+h,x:x+w]
   regions=components(crop>8)
   if len(regions)>1 and regions[1][4]>10:
    assert f.get('mask'),(skin,gait,i,'Needs silhouette mask to exclude neighbouring tail')
    keep=np.zeros((h,w),dtype=bool)
    for row,*runs in f['mask']:
     for a,n in zip(runs[::2],runs[1::2]):keep[row,a:a+n]=True
    visible=components((crop>8)&keep)
    assert all(g[4]<=10 for g in visible[1:]),(skin,gait,i,'Still renders a foreign silhouette')
    assert visible[0][4]==regions[0][4],(skin,gait,i,'Lost own outline')
print('PASS all four themes: every crop preserves its own alpha and excludes neighbouring figures')
