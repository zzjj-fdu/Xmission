"""Index AI-drawn embraces; source pixels stay intact, the icon is a runtime slot."""
from pathlib import Path
import json,importlib.util,sys
import numpy as np
from PIL import Image
root=Path(__file__).resolve().parent.parent
spec=importlib.util.spec_from_file_location('measure',root/'scripts/pet-scale-metrics.py')
measure=importlib.util.module_from_spec(spec);spec.loader.exec_module(measure)
source=(root/'scripts/index-fox-run.py').read_text();scope={'__file__':str(root/'scripts/index-fox-run.py')}
definitions=source[:source.index("for skin in ('jrpg'")].replace('[:12]','[:4]').replace('len(chosen)==12','len(chosen)==4').replace('(0,4,8)','(0,2)').replace('i:i+4','i:i+2')
exec(definitions,scope)
def runs(mask):
    result=[]
    for row,line in enumerate(mask):
        d=np.diff(np.r_[False,line,False].astype(int));starts=np.where(d==1)[0];ends=np.where(d==-1)[0]
        if len(starts):result.append([row,*[int(n) for a,b in zip(starts,ends) for n in (a,b-a)]])
    return result
for skin in sys.argv[1:] or ('jrpg','journal','island','farm'):
    path=root/'public/pets/fox'/f'{skin}.json';atlas=json.loads(path.read_text());source=f'v14/{skin}-icon-hug.png'
    pixels=np.array(Image.open(root/'public/pets/fox'/source).convert('RGBA'));assert pixels[0,0,3]==0
    parts=scope['boxes'](pixels[:,:,3]);frames=[]
    for l,t,r,b,_ in parts:
        x,y=max(0,l-2),max(0,t-2);w,h=r+2-x,b+2-y;px=pixels[y:y+h,x:x+w]
        red,green,blue=px[:,:,:3].astype(float).transpose(2,0,1);a=px[:,:,3]>32
        cyan=a&(red<95)&(green>180)&(blue>180)
        rows=np.where(cyan.sum(axis=1)>cyan.sum(axis=1).max()*.35)[0];cols=np.where(cyan.sum(axis=0)>cyan.sum(axis=0).max()*.35)[0]
        assert len(rows)>30 and len(cols)>30,(skin,'No clear square icon slot')
        side=float(max(rows[-1]-rows[0]+1,cols[-1]-cols[0]+1)+4)
        cx,cy=(cols[0]+cols[-1]+1)/2,(rows[0]+rows[-1]+1)/2
        box=[cx-side/2,cy-side/2,cx+side/2,cy+side/2]
        yy,xx=np.indices((h,w));inside=(xx>=box[0]-2)&(xx<box[2]+2)&(yy>=box[1]-2)&(yy<box[3]+2)
        glove=a&inside&(red>28)&(red<195)&(green>10)&(green<140)&(blue<115)&(red>green*1.25)&(red<green*3.6)
        expanded=glove.copy();padded=np.pad(glove,2)
        for dy in range(-2,3):
            for dx in range(-2,3):
                if dx*dx+dy*dy<=4:expanded|=padded[2+dy:2+dy+h,2+dx:2+dx+w]
        expanded&=a
        top=glove&(yy<box[1]+side*.18)&(xx>box[0]+side*.25)
        front=glove&(yy>box[1]+side*.22)&(yy<box[1]+side*.68)&(xx<box[0]+side*.25)
        assert top.sum()>25 and front.sum()>25,(skin,'Two separate wrapping paws required',int(top.sum()),int(front.sum()))
        # The artist already drew fur and paws in front of the prop. Remove the
        # prop's color, never its whole bounding rectangle: fur that crosses a
        # corner belongs to the fox, not to the backdrop.
        slot_edge=cyan.copy();slot_pad=np.pad(cyan,2)
        for dy in range(-2,3):
            for dx in range(-2,3):
                if dx*dx+dy*dy<=4:slot_edge|=slot_pad[2+dy:2+dy+h,2+dx:2+dx+w]
        tint=slot_edge&(green>red*1.6)&(blue>red*1.6)
        keep=a&~cyan&~tint
        ys,xs=np.where(keep);bounds=[int(xs.min()),int(ys.min()),int(xs.max()+1),int(ys.max()+1)]
        f={'source':source,'rect':[x,y,w,h],'basis':192,'anchorY':h,'mask':runs(keep),'foregroundMask':runs(expanded),'alphaBounds':bounds,'objectBox':box,'contact':[cx,cy]}
        frames.append(f)
    side=float(np.median([f['objectBox'][2]-f['objectBox'][0] for f in frames]))
    for f in frames:
        box=f['objectBox'];cx,cy=(box[0]+box[2])/2,(box[1]+box[3])/2
        f['objectBox']=[cx-side/2,cy-side/2,cx+side/2,cy+side/2]
    # Preserve the ordinary character head ruler in fallback previews; the native
    # embrace binds the actual icon rectangle into objectBox, never an outside paw.
    ref=atlas['actions']['idle'][0];_,target=measure.head(ref)
    scales=[]
    for f in frames:
        _,head=measure.head(f);scales.append((target/ref['basis'])/(head/f['basis']))
    ruler=float(np.median(scales[:3]));
    for f in frames:f['drawScale']=round(ruler,6)
    atlas['perches']['icon']={'enter':[{**frames[0],'durationMs':260},{**frames[1],'durationMs':260}],
        'hold':[{**frames[2],'durationMs':3700},{**frames[1],'durationMs':1300},{**frames[2],'durationMs':4500}],
        'leave':[{**frames[3],'durationMs':250},{**frames[0],'durationMs':220}]}
    path.write_text(json.dumps(atlas,separators=(',',':')),encoding='utf-8')
    print(skin,'square slots',[round(f['objectBox'][2]-f['objectBox'][0],1) for f in frames],'head ruler',round(ruler,4))
