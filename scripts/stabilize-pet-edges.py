"""Keep one coherent tucked pose; do not loop independently drawn head silhouettes."""
from pathlib import Path
from copy import deepcopy
import json

root = Path(__file__).resolve().parent.parent
for theme in ('jrpg', 'journal', 'island', 'farm'):
    path = root / 'public/pets/fox' / (theme + '.json')
    atlas = json.loads(path.read_text(encoding='utf-8'))
    for side in ('left', 'right'):
        pose = deepcopy(atlas['actions']['edge-' + side][0])
        pose.pop('durationMs', None)
        atlas['actions']['edge-' + side] = [pose]
        tucked = dict(pose, durationMs=70)
        # Tuck and reveal meet the very same pose, without a blink or alignment jump.
        chain = atlas['actions']['dock-' + side][:2] + [deepcopy(tucked), deepcopy(tucked)]
        atlas['actions']['dock-' + side] = chain
        atlas['actions']['undock-' + side] = list(reversed(deepcopy(chain)))
    atlas['edgePoseRevision'] = 4
    path.write_text(json.dumps(atlas, separators=(',', ':')), encoding='utf-8')
    print(theme + ': stable tucked pose and matching transition endpoints')
