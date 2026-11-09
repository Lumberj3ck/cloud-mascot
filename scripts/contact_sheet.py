"""Contact sheet of browser shots: .venv/bin/python scripts/contact_sheet.py <dir> <out.png> [names...]"""
import os
import sys

from PIL import Image, ImageDraw, ImageFont

d, out = sys.argv[1], sys.argv[2]
names = sys.argv[3:] or ["hero", "front", "side", "back", "top", "threequarter"]
T, cols = 420, 3
font = ImageFont.load_default(size=20)
rows = (len(names) + cols - 1) // cols
sheet = Image.new("RGB", (cols * T, rows * (T + 30)), "white")
for i, n in enumerate(names):
    im = Image.open(os.path.join(d, n + ".png")).convert("RGB")
    w = min(im.size)
    im = im.crop(((im.width - w) // 2, (im.height - w) // 2, (im.width + w) // 2, (im.height + w) // 2)).resize((T, T), Image.LANCZOS)
    x, y = (i % cols) * T, (i // cols) * (T + 30)
    sheet.paste(im, (x, y + 30))
    ImageDraw.Draw(sheet).text((x + 8, y + 4), n, fill=(80, 80, 80), font=font)
sheet.save(out)
