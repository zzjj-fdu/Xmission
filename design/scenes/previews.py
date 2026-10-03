"""Generate small settings thumbnails, preserving the original art and composition."""
from pathlib import Path
from PIL import Image

root = Path(__file__).resolve().parents[2]
total = 0
for source in (root / 'public/scenes').glob('*/*.webp'):
    with Image.open(source) as image:
        image.thumbnail((640, 640), Image.Resampling.LANCZOS)
        output = source.parent / 'previews' / source.name
        output.parent.mkdir(exist_ok=True)
        image.save(output, 'WEBP', quality=78, method=6)
        total += output.stat().st_size
print(f'24 previews: {total:,} bytes; at most 640 pixels wide')
