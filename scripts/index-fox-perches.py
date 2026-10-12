"""Index B attachment sheets and paw anchors; original image pixels stay intact."""
from pathlib import Path
import json,importlib.util
import numpy as np
from PIL import Image
root=Path(__file__).resolve().parent.parent
spec=importlib.util.spec_from_file_location('measure',root/'scripts/pet-scale-metrics.py')
measure=importlib.util.module_from_spec(spec);spec.loader.exec_module(measure)
# Share the proven connected-band algorithm, with sixteen instead of twelve poses.
# Loading only definitions avoids the run script's atlas-writing entry point.
source=(root/'scripts/index-fox-run.py').read_text();scope={'__file__':str(root/'scripts/index-fox-run.py')}
definitions=source[:source.index("for skin in ('jrpg'")].replace('[:12]','[:16]').replace('len(chosen)==12','len(chosen)==16').replace('(0,4,8)','(0,4,8,12)')
exec(definitions,scope)
def boxes(alpha):return [b[:4] for b in scope['boxes'](alpha)]
for skin in ('jrpg','journal','island','farm'):
    path=root/'public/pets/fox'/f'{skin}.json';atlas=json.loads(path.read_text());source=f'v10/{skin}-perch.png'
    image=Image.open(root/'public/pets/fox'/source).convert('RGBA');alpha=np.array(image)[:,:,3];width,height=image.size
    assert alpha[0,0]==0 and alpha[-1,-1]==0
    parts=boxes(alpha);reference=atlas['actions']['idle'][0];_,old_head=measure.head(reference)
    target=old_head/reference['basis']*reference.get('drawScale',1);perches={}
    for row,mode in enumerate(('top','side','bottom','icon')):
        frames=[];scales=[]
        for n in range(4):
            l,t,r,b=parts[row*4+n];x=max(0,l-1);y=max(0,t-1);w=min(width,r+1)-x;h=min(height,b+1)-y
            f={'source':source,'rect':[x,y,w,h],'basis':192,'anchorY':h,'alphaBounds':[l-x,t-y,r-x,b-y],'mask':[[i,0,w] for i in range(h)]}
            f['contact']=[w*.5,h-4] if mode=='top' else [w*.90,h*.32] if mode=='side' else [w*.50,h*.07] if mode=='bottom' else [w*.90,h*.28]
            _,span=measure.head(f);scales.append(target/(span/192));frames.append(f)
        ruler=round(float(np.median(scales[:3])),6)
        for f in frames:f['drawScale']=ruler
        perches[mode]={'enter':[{**frames[0],'durationMs':220},{**frames[1],'durationMs':220}],
                       'hold':[{**frames[1],'durationMs':3700},{**frames[2],'durationMs':120},{**frames[1],'durationMs':4500}],
                       'leave':[{**frames[3],'durationMs':220},{**frames[0],'durationMs':180}]}
        print(skin,mode,'ruler',ruler)
    atlas['perches']=perches;path.write_text(json.dumps(atlas,separators=(',',':')),encoding='utf-8')
