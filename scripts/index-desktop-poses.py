"""Index generated alpha sprites and calibrate drawing metadata; do not alter PNGs."""
from pathlib import Path
import importlib.util,json
import numpy as np
from PIL import Image
root=Path(__file__).resolve().parent.parent
spec=importlib.util.spec_from_file_location('measure',root/'scripts/pet-scale-metrics.py')
measure=importlib.util.module_from_spec(spec);spec.loader.exec_module(measure)
def components(alpha):
    """Connected alpha bands, so tails are not cut at an approximate grid boundary."""
    parents=[];bands=[];previous=[]
    def find(i):
        while parents[i]!=i:parents[i]=parents[parents[i]];i=parents[i]
        return i
    for y,row in enumerate(alpha>32):
        ends=np.diff(np.r_[False,row,False].astype(np.int8));starts=np.where(ends==1)[0];stops=np.where(ends==-1)[0]
        current=[];first=0
        for left,right in zip(starts,stops):
            ident=len(parents);parents.append(ident);bands.append((int(left),y,int(right),y+1));current.append((left,right,ident))
            while first<len(previous) and previous[first][1]<left:first+=1
            j=first
            while j<len(previous) and previous[j][0]<=right:
                parents[find(ident)]=find(previous[j][2]);j+=1
        previous=current
    groups={}
    for i,(l,t,r,b) in enumerate(bands):
        key=find(i)
        if key not in groups:groups[key]=[l,t,r,b,0]
        g=groups[key];g[0]=min(g[0],l);g[1]=min(g[1],t);g[2]=max(g[2],r);g[3]=max(g[3],b);g[4]+=r-l
    chosen=sorted(groups.values(),key=lambda g:g[4],reverse=True)[:8]
    assert len(chosen)==8 and min(g[4] for g in chosen)>5000,'Eight separate characters required'
    rows=sorted(chosen,key=lambda g:(g[1]+g[3])/2)
    return [sorted(rows[:4],key=lambda g:g[0]),sorted(rows[4:],key=lambda g:g[0])]
for skin in ('jrpg','journal','island','farm'):
    path=root/'public/pets/fox'/f'{skin}.json'
    atlas=json.loads(path.read_text(encoding='utf-8'))
    source=f'v8/{skin}-desktop.png'
    image=Image.open(root/'public/pets/fox'/source).convert('RGBA')
    pixels=np.array(image);alpha=pixels[:,:,3]
    assert alpha[0,0]==0 and alpha[-1,-1]==0,'Generated background must be genuinely transparent'
    width,height=image.size
    boxes=components(alpha)
    sequences={}
    for row,action in enumerate(('window-hang','toy-catch')):
        seq=[]
        for col in range(4):
            l,t,r,b,_=boxes[row][col]
            x=max(0,l-2);y=max(0,t-2);w=min(width,r+2)-x;h=min(height,b+2)-y
            # Full metadata mask retains the image's original alpha, without resampling.
            frame={'source':source,'rect':[x,y,w,h],'mask':[[i,0,w] for i in range(h)],'basis':192,'anchorY':h,'alphaBounds':[0,0,w,h],
                   'durationMs':[1600,100,100,1700][col] if row==0 else [220,220,380,260][col]}
            if row==0:frame['contact']=[w*.62,h*(.10 if skin=='farm' else .035)]
            seq.append(frame)
        ref=atlas['actions']['idle'][0]
        _,span=measure.head(ref);target=span/ref['basis']
        _,new_span=measure.head(seq[0]);factor=target/(new_span/192)
        for frame in seq:frame['drawScale']=round(factor,6)
        sequences[action]=seq
        print(skin,action,'head ruler',round(factor,4),'body',seq[0]['rect'][2:])
    atlas['actions'].update(sequences)
    path.write_text(json.dumps(atlas,separators=(',',':')),encoding='utf-8')
