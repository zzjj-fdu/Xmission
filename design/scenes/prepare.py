"""Compress generated source images and create a review sheet. No creative edits."""
from pathlib import Path
import json
from PIL import Image, ImageDraw, ImageFont

root = Path(__file__).resolve().parents[2]
themes = ['pixel-jrpg', 'parchment-journal', 'animal-crossing', 'stardew-valley']
phases = ['dawn', 'morning', 'noon', 'sunset', 'night', 'predawn']
sheet = Image.new('RGB', (1800, 1120), '#18232b')
draw = ImageDraw.Draw(sheet)
font = ImageFont.truetype('C:/Windows/Fonts/arial.ttf', 17)
manifest = []
for row, theme in enumerate(themes):
    draw.text((12, row * 280 + 8), theme, fill='#f3e8cb', font=font)
    for col, phase in enumerate(phases):
        source = root / 'design/scenes/source' / f'{theme}-{phase}.png'
        image = Image.open(source).convert('RGB')
        image.thumbnail((1920, 1920), Image.Resampling.LANCZOS)
        output = root / 'public/scenes' / theme / f'{phase}.webp'
        output.parent.mkdir(parents=True, exist_ok=True)
        image.save(output, 'WEBP', quality=84, method=6)
        manifest.append(dict(theme=theme, phase=phase, width=image.width, height=image.height,
                             sourceBytes=source.stat().st_size, bytes=output.stat().st_size,
                             path=output.relative_to(root).as_posix()))
        thumbnail = image.copy()
        thumbnail.thumbnail((294, 220), Image.Resampling.LANCZOS)
        sheet.paste(thumbnail, (col * 300 + 3, row * 280 + 42))
        draw.text((col * 300 + 6, row * 280 + 256), phase, fill='#e3d7b8', font=font)
sheet.save(root / 'design/scenes/overview.jpg', quality=90)
(root / 'design/scenes/manifest.json').write_text(json.dumps(manifest, indent=2), encoding='utf-8')
print(json.dumps(dict(images=len(manifest), sourceBytes=sum(x['sourceBytes'] for x in manifest),
                      runtimeBytes=sum(x['bytes'] for x in manifest), largest=max(x['bytes'] for x in manifest))))
