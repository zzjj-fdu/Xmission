"""Read existing character pixels and write drawing metadata; never resample art."""
from pathlib import Path
import importlib.util,json,math,statistics
from PIL import Image

root=Path(__file__).resolve().parent.parent
spec=importlib.util.spec_from_file_location('measure',root/'scripts/pet-scale-metrics.py')
measure=importlib.util.module_from_spec(spec);spec.loader.exec_module(measure)
for theme in ('jrpg','journal','island','farm'):
    path=root/'public/pets/fox'/(theme+'.json')
    atlas=json.loads(path.read_text(encoding='utf-8'))
    reference=atlas['actions']['idle'][0]
    reference_box,reference_span=measure.head(reference)
    target=reference_span/reference['basis']
    peek_top=(reference_box[1]-reference.get('anchorY',reference['rect'][3]))/reference['basis']
    cache={}
    def factor(frame):
        key=(frame['source'],tuple(frame['rect']))
        if key not in cache:
            pixels=measure.sprite(frame)
            bounds=Image.fromarray(pixels,'RGBA').getbbox()
            try:_,span=measure.head(frame);scale=target/(span/frame['basis'])
            except (ValueError,ZeroDivisionError):scale=1
            cache[key]=(bounds,max(.2 if frame['source'].startswith('v8/') else .65,min(2.15,scale)))
        return cache[key]
    sequences=list(atlas['actions'].items())+[(name,atlas[name]) for name in ('left','leftIdle','frontIdle','front','back') if name in atlas]
    for name,frames in sequences:
        # One ruler for a sequence preserves breath, blink, crouch and gait proportions.
        normal=[f for f in frames if not f.get('gripSide')]
        normal_scale=factor(normal[0])[1] if normal else 1
        peeks=[f for f in frames if f.get('gripSide')]
        peek_scale=factor(peeks[0])[1] if peeks else 1
        if name.startswith(('dock-','undock-','edge-')):
            side=name.rsplit('-',1)[1]
            normal_scale=factor(atlas['actions']['dock-'+side][0])[1]
            peek_scale=factor(atlas['actions']['edge-'+side][0])[1]
        for frame in frames:
            bounds,_=factor(frame);frame['alphaBounds']=list(bounds)
            value=peek_scale if frame.get('gripSide') else normal_scale
            if name=='idle':value=1
            if name in ('leftIdle','frontIdle'):value=max(.9,min(1.1,value))
            # Older painted weather scenes mix character and large props; retain their ruler.
            if not frame['source'].startswith(('v2/','v4/','v5/','v6/','v7/','v8/')):value=1
            frame['drawScale']=round(value,5)
            if frame.get('gripSide'):frame['peekTop']=round(peek_top,5)
    # A curled body is shorter, but it must not acquire a new character ruler
    # at the sleep/down and sleep/wake boundaries.
    def span(frame):
        box=frame['alphaBounds'];return (box[2]-box[0])/frame['basis']
    down=atlas['actions']['sleep-down'][-1]
    sleeping_width=span(down)*down['drawScale']
    for action in ('sleep','wake'):
        sequence=atlas['actions'][action]
        ruler=sleeping_width/span(sequence[0])
        for frame in sequence:frame['drawScale']=round(ruler,6)
    atlas['poseScaleRevision']=2
    path.write_text(json.dumps(atlas,separators=(',',':')),encoding='utf-8')
    print(theme+': calibrated action bodies and original-size edge heads; source images unchanged')

