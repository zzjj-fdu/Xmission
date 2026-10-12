"""The slot mask must never turn opaque character fur into a rectangular hole."""
from pathlib import Path
from PIL import Image
import json,numpy as np
root=Path(__file__).resolve().parent.parent
checked=0;failures=[]
for skin in ('jrpg','journal','island','farm'):
    a=json.loads((root/'public/pets/fox'/f'{skin}.json').read_text())
    for phase,frames in a['perches']['icon'].items():
        for index,f in enumerate(frames):
            x,y,w,h=f['rect'];p=np.array(Image.open(root/'public/pets/fox'/f['source']).convert('RGBA'))[y:y+h,x:x+w]
            mask=np.zeros((h,w),bool)
            for row,*runs in f['mask']:
                for start,n in zip(runs[::2],runs[1::2]):mask[row,start:start+n]=True
            r,g,b=p[:,:,:3].astype(float).transpose(2,0,1);yy,xx=np.indices((h,w));l,t,right,bottom=f['objectBox']
            around=(xx>=l-20)&(xx<right+20)&(yy>=t-20)&(yy<bottom+20)
            # Warm fur and cream fur crossing the tile boundary are fox pixels,
            # whereas the cyan reference prop cannot satisfy either condition.
            fur=(p[:,:,3]>200)&(((r>140)&(r>g*1.4)&(r>b*1.5))|((r>200)&(g>195)&(b>180)))
            missing=int((fur&around&~mask).sum())
            if missing:failures.append((skin,phase,index,missing))
            marker=(p[:,:,3]>32)&(r<95)&(g>180)&(b>180)
            assert not (marker&mask).any(),f'{skin}: the cyan prop must not leak into the actor'
            checked+=1
if failures:raise AssertionError(f'Actual opaque fox fur erased at the slot: {failures}')
print(f'PASS {checked} hugs: original fur preserved at slot corners, cyan prop absent')
