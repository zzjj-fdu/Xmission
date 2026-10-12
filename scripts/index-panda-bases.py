"""Index complete anatomy and binding landmarks. Reads pixels, writes metadata only."""
from pathlib import Path
import json
import numpy as np
from PIL import Image

root=Path(__file__).resolve().parents[1]/'public/pets/red-panda'
names=['stand-right','stand-left','walk-right','walk-left','sleep','read','hug','hang']

def components(mask):
    parent=[];runs=[];previous=[]
    def find(n):
        while parent[n]!=n:
            parent[n]=parent[parent[n]];n=parent[n]
        return n
    for y,row in enumerate(mask):
        edge=np.diff(np.pad(row.astype(np.int8),(1,1)))
        starts=np.flatnonzero(edge==1);ends=np.flatnonzero(edge==-1)
        current=[];j=0
        for a,b in zip(starts,ends):
            label=len(parent);parent.append(label)
            while j<len(previous) and previous[j][1]<a-1:j+=1
            k=j
            while k<len(previous) and previous[k][0]<=b:
                pa,pb,pl=previous[k]
                if pb>=a-1:parent[find(pl)]=find(label)
                k+=1
            current.append((int(a),int(b),label));runs.append((int(a),int(b),y,label))
        previous=current
    found={}
    for a,b,y,label in runs:
        key=find(label)
        if key not in found:found[key]=[a,y,b,y+1,0]
        v=found[key];v[0]=min(v[0],a);v[1]=min(v[1],y);v[2]=max(v[2],b);v[3]=max(v[3],y+1);v[4]+=b-a
    return sorted(found.values(),key=lambda b:b[4],reverse=True)

for skin in ['island','journal','jrpg','farm','island-bare','journal-bare','jrpg-bare','farm-bare']:
    path=root/f'{skin}-bases.png'
    if not path.exists():continue
    im=Image.open(path).convert('RGBA');data=np.array(im)
    groups=components(data[:,:,3]>=96)
    separated=[]
    for a,b,c,d,count in groups:
        if count<5000:continue
        if c-a>im.width*.4:
            # Some generated fur tips touch across adjacent cells. Locate their
            # narrow connection; this only indexes source regions, no PNG editing.
            projection=(data[b:d,a:c,3]>=96).sum(axis=0)
            lo,hi=int((c-a)*.38),int((c-a)*.62)
            cut=a+lo+int(projection[lo:hi].argmin())
            for x0,x1 in [(a,cut),(cut,c)]:
                local=Image.fromarray((data[b:d,x0:x1,3]>=96).astype('uint8')*255).getbbox()
                if local:separated.append([x0+local[0],b+local[1],x0+local[2],b+local[3],count//2])
        else:separated.append([a,b,c,d,count])
    groups=sorted(separated,key=lambda b:b[4],reverse=True)[:8]
    assert len(groups)==8
    groups=sorted(groups,key=lambda b:(b[1]+b[3])/2)
    groups=sorted(groups[:4],key=lambda b:b[0])+sorted(groups[4:],key=lambda b:b[0])
    frames={}
    for i,(a,b,c,d,count) in enumerate(groups):
        a,b,c,d=max(0,a-5),max(0,b-5),min(im.width,c+5),min(im.height,d+5)
        rgba=data[b:d,a:c];h,w=rgba.shape[:2]
        r,g,blue=[rgba[:,:,k].astype(np.int16) for k in range(3)]
        orange=(r>175)&(g>55)&(r-g>35)&(g-blue>25)&(rgba[:,:,3]>100)
        orange[int(h*.7):]=False
        faces=components(orange)
        assert faces,(skin,names[i],'No complete face in indexed source region')
        face=faces[0];head_width=min(w*.78,max(w*.38,(face[2]-face[0])*1.12))
        head=[(face[0]+face[2])/2,(face[1]+face[3])/2,round(head_width,2)]
        if skin=='journal-bare' and names[i]=='sleep':
            # The curled orange tail joins the face in this source. An authored
            # head landmark keeps the ruler anatomical, rather than tail-sized.
            head=[310,135,235]
        marker=(g>100)&(blue>100)&(r<g*.68)&(blue>g*.97)&(rgba[:,:,3]>96)
        marker_bounds=None;mask=[]
        if names[i]=='hug':
            blobs=components(marker)
            assert blobs,'Hug needs the separate chroma prop for binding'
            ma,mb,mc,md,_=blobs[0];marker_bounds=[ma,mb,mc,md]
            # Preserve real fur; only keyed prop pixels are absent in the runtime alpha.
            keep=(rgba[:,:,3]>2)&~marker
            for y,row in enumerate(keep):
                e=np.diff(np.pad(row.astype(np.int8),(1,1)));s=np.flatnonzero(e==1);end=np.flatnonzero(e==-1)
                if len(s):mask.append([int(y)]+[v for x,z in zip(s,end) for v in (int(x),int(z-x))])
        frames[names[i]]={'rect':[a,b,c-a,d-b],'head':head,'marker':marker_bounds,'mask':mask}
    output={'version':2,'image':path.name,'ruler':100,'headWidth':56,'bases':frames}
    (root/f'{skin}-skin.json').write_text(json.dumps(output,ensure_ascii=False,indent=2),encoding='utf-8')
    print(f'PASS {skin}: eight complete silhouettes, head rulers and chroma prop binding')
