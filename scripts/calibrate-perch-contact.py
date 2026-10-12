"""Locate icon-clasp paw pixels in original sprites; update metadata only."""
from pathlib import Path
import json
import numpy as np
from PIL import Image
root=Path(__file__).resolve().parent.parent
for skin in ('jrpg','journal','island','farm'):
    path=root/'public/pets/fox'/f'{skin}.json';atlas=json.loads(path.read_text());poses=atlas['perches']['icon'];contacts={}
    for seq in poses.values():
        for frame in seq:
            key=tuple(frame['rect'])
            if key in contacts:
                frame['contact'],frame['foregroundMask']=contacts[key]
                continue
            x,y,w,h=key;pixels=np.array(Image.open(root/'public/pets/fox'/frame['source']).convert('RGBA'))[y:y+h,x:x+w]
            r,g,b=pixels[:,:,:3].astype(float).transpose(2,0,1);yy,xx=np.indices((h,w))
            paw=(pixels[:,:,3]>100)&(r>55)&(r<175)&(g>25)&(g<115)&(b<85)&(r>g*1.35)&(r<g*2.55)&(g>b*1.2)&(xx>w*.75)&(yy>h*.23)&(yy<h*.50)
            ys,xs=np.where(paw);assert len(xs)>12,(skin,key,'No clear paw pixels')
            # Contact is the outward edge of the upper forepaw, not the cheek,
            # whole sprite box, lower hind paw or satchel.
            edge=np.percentile(xs,92);selected=ys[xs>=edge-3]
            point=[round(float(edge),2),round(float(np.median(selected)),2)]
            # Preserve the original glove pixels as a foreground layer over the
            # icon; body/cheek pixels remain behind its actual rectangle.
            gloves=(pixels[:,:,3]>60)&(r>35)&(r<180)&(g>15)&(g<120)&(b<90)&(r>g*1.3)&(r<g*3.1)&(xx>w*.72)&(yy>h*.16)&(yy<h*.53)
            expanded=gloves.copy()
            for dy in range(-2,3):
                for dx in range(-2,3):
                    if dx*dx+dy*dy>4:continue
                    padded=np.pad(gloves,2)
                    expanded|=padded[2+dy:2+dy+h,2+dx:2+dx+w]
            expanded&=pixels[:,:,3]>32
            mask=[]
            for row in range(h):
                line=expanded[row];edges=np.diff(np.r_[False,line,False].astype(int))
                starts=np.where(edges==1)[0];ends=np.where(edges==-1)[0]
                if len(starts):mask.append([row,*[int(n) for start,end in zip(starts,ends) for n in (start,end-start)]])
            assert len(mask)>2,(skin,key,'No foreground gloves')
            contacts[key]=(point,mask);frame['contact']=point;frame['foregroundMask']=mask
    path.write_text(json.dumps(atlas,separators=(',',':')),encoding='utf-8')
    print(skin,'original forepaw contacts',[v[0] for v in contacts.values()])
