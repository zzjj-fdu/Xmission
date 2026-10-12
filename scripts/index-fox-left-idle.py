"""Index original three-quarter left idle artwork; only atlas metadata is written."""
from pathlib import Path
import importlib.util,json
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
        if len(starts):result.append([row,*[int(n) for l,r in zip(starts,ends) for n in (l,r-l)]])
    return result
for skin in ('jrpg','journal','island','farm'):
    path=root/'public/pets/fox'/f'{skin}.json';atlas=json.loads(path.read_text());source=f'v15/{skin}-idle-left.png'
    pixels=np.array(Image.open(root/'public/pets/fox'/source).convert('RGBA'))
    assert pixels[0,0,3]==0 and pixels[-1,-1,3]==0,'Actual transparent corners required'
    alpha=pixels[:,:,3];parts=scope['boxes'](np.where(alpha>96,alpha,0));frames=[]
    for n,(l,t,r,b,_) in enumerate(parts):
        x,y=max(0,l-2),max(0,t-2);w,h=min(pixels.shape[1],r+2)-x,min(pixels.shape[0],b+2)-y
        keep=alpha[y:y+h,x:x+w]>96;ys,xs=np.where(keep)
        f={'source':source,'rect':[x,y,w,h],'basis':192,'anchorY':int(ys.max()+1),'mask':runs(keep),'alphaBounds':[int(xs.min()),int(ys.min()),int(xs.max()+1),int(ys.max()+1)],'durationMs':[2400,1600,180,1800][n]}
        frames.append(f)
    ref=atlas['actions']['idle'][0];_,ref_span=measure.head(ref)
    factor=float(np.median([(ref_span/ref['basis']*ref.get('drawScale',1))/(measure.head(frames[i])[1]/192) for i in (0,1,3)]))
    for f in frames:f['drawScale']=round(factor,6)
    atlas['leftIdle']=frames;path.write_text(json.dumps(atlas,separators=(',',':')),encoding='utf-8')
    print(skin,'4 three-quarter poses; ordinary head ruler',round(factor,4))
