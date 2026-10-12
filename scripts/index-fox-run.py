"""Index original transparent chase drawings without modifying image pixels."""
from pathlib import Path
import importlib.util,json
import numpy as np
from PIL import Image
root=Path(__file__).resolve().parent.parent
spec=importlib.util.spec_from_file_location('measure',root/'scripts/pet-scale-metrics.py')
measure=importlib.util.module_from_spec(spec);spec.loader.exec_module(measure)

def boxes(alpha):
    parents=[];bands=[];previous=[]
    def find(i):
        while parents[i]!=i:parents[i]=parents[parents[i]];i=parents[i]
        return i
    for y,row in enumerate(alpha>32):
        ends=np.diff(np.r_[False,row,False].astype(np.int8))
        current=[];first=0
        for left,right in zip(np.where(ends==1)[0],np.where(ends==-1)[0]):
            ident=len(parents);parents.append(ident);bands.append((int(left),y,int(right),y+1));current.append((left,right,ident))
            while first<len(previous) and previous[first][1]<left:first+=1
            j=first
            while j<len(previous) and previous[j][0]<=right:
                parents[find(ident)]=find(previous[j][2]);j+=1
        previous=current
    groups={}
    for i,(l,t,r,b) in enumerate(bands):
        g=groups.setdefault(find(i),[l,t,r,b,0]);g[0]=min(g[0],l);g[1]=min(g[1],t);g[2]=max(g[2],r);g[3]=max(g[3],b);g[4]+=r-l
    chosen=sorted(groups.values(),key=lambda b:b[4],reverse=True)[:12]
    assert len(chosen)==12 and min(b[4] for b in chosen)>3000,'Twelve separate full foxes required'
    chosen.sort(key=lambda b:(b[1]+b[3])/2)
    return sum((sorted(chosen[i:i+4],key=lambda b:b[0]) for i in (0,4,8)),[])

for skin in ('jrpg','journal','island','farm'):
    atlas_path=root/'public/pets/fox'/f'{skin}.json';atlas=json.loads(atlas_path.read_text())
    source=f'v9/{skin}-run.png';image=Image.open(root/'public/pets/fox'/source).convert('RGBA')
    alpha=np.array(image)[:,:,3];width,height=image.size
    assert alpha[0,0]==0 and alpha[-1,-1]==0,'Transparent background required'
    parts=boxes(alpha);ref=atlas['actions']['idle'][0]
    _,span=measure.head(ref);ruler=span/ref['basis']*ref.get('drawScale',1)
    frames=[]
    for n,(l,t,r,b,_) in enumerate(parts):
        x=max(0,l-2);y=max(0,t-2);w=min(width,r+2)-x;h=min(height,b+2)-y
        frame={'source':source,'rect':[x,y,w,h],'basis':192,'anchorY':h,'mask':[[i,0,w] for i in range(h)],'alphaBounds':[l-x,t-y,r-x,b-y]}
        _,span=measure.head(frame);frame['drawScale']=round(ruler/(span/192),6)
        # Actual airborne poses lift gently; calibration uses head size, not whole-body box.
        if n in (2,6):frame['offsetY']=-12
        frame['durationMs']=([65,70,80,65,55,65,70,60] if skin in ('jrpg','journal') else [70,70,90,65,65,75,85,60])[n] if n<8 else 160 if n<10 else 120
        frames.append(frame)
    atlas['actions'].update({'run':frames[:8],'run-start':frames[8:10],'run-stop':frames[10:]})
    # A single ruler per sheet avoids orange-component segmentation changing
    # scale when an ear joins the torso or a straw hat masks the forehead.
    factor=round(float(np.median([f['drawScale'] for f in frames[:8]])),6)
    for frame in frames:frame['drawScale']=factor
    atlas_path.write_text(json.dumps(atlas,separators=(',',':')),encoding='utf-8')
    print(skin,'12 poses; head scales',[round(f['drawScale'],3) for f in frames])
