"""Read-only pixel analysis; writes JSON coordinates, never changes raster assets."""
from pathlib import Path
import json
from PIL import Image

root = Path(__file__).resolve().parents[1] / 'public/pets/red-panda'
names = ['head-open','head-blink','head-happy','head-sleep','head-front','head-left',
         'body','body-quad','tail-base','tail-middle','tail-tip','fore-upper',
         'fore-lower','fore-paw','hind-upper','hind-lower','hind-paw','rump',
         'vest','vest-quad','satchel','pendant','scarf','book']
for skin in ['island','journal','jrpg','farm']:
    image = Image.open(root / f'{skin}.png').convert('RGBA')
    assert image.size == (1536,1024), (skin, image.size)
    alpha = image.getchannel('A')
    assert alpha.getextrema()[0] == 0, f'{skin}: needs real transparency'
    parts = {}
    for i, name in enumerate(names):
        x, y = i % 6 * 256, i // 6 * 256
        # A threshold locates the component; padded bounds retain its soft fur edge.
        cell = alpha.crop((x,y,x+256,y+256))
        bounds = cell.point(lambda a: 255 if a >= 32 else 0).getbbox()
        assert bounds, (skin,name,'empty component')
        a,b,c,d = bounds
        a,b,c,d = max(0,a-4),max(0,b-4),min(256,c+4),min(256,d+4)
        parts[name] = [x+a,y+b,c-a,d-b]
    manifest = {'version':1,'image':f'{skin}.png','columns':6,'rows':4,'ruler':100,'parts':parts}
    (root / f'{skin}.json').write_text(json.dumps(manifest,ensure_ascii=False,indent=2),encoding='utf-8')
    print(f'PASS {skin}: 24 transparent skeletal components; source PNG unchanged')
