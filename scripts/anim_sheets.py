"""Turn captured animation frames into GIFs + filmstrip sheets.
  .venv/bin/python scripts/anim_sheets.py build/frames renders/anim
-> renders/anim/<kind>_<name>.gif, renders/09_clips.png, renders/10_moods.png"""
import glob
import os
import sys

from PIL import Image, ImageDraw, ImageFont

src, dst = sys.argv[1], sys.argv[2]
os.makedirs(dst, exist_ok=True)
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
font = ImageFont.load_default(size=18)
BG = (253, 246, 241)


def load(d):
    out = []
    for f in sorted(glob.glob(os.path.join(d, "f*.png"))):
        im = Image.open(f).convert("RGBA")
        bg = Image.new("RGBA", im.size, BG + (255,))
        out.append(Image.alpha_composite(bg, im).convert("RGB"))
    return out


def sheet(kind, out_png, n=7, T=200):
    dirs = sorted(glob.glob(os.path.join(src, f"{kind}_*")))
    rows = []
    for d in dirs:
        fr = load(d)
        name = os.path.basename(d)[len(kind) + 1:]
        fr[0].save(os.path.join(dst, f"{kind}_{name}.gif"), save_all=True, append_images=fr[1:],
                   duration=50, loop=0, optimize=True)
        idx = [round(i * (len(fr) - 1) / (n - 1)) for i in range(n)]
        row = Image.new("RGB", (n * T + 150, T), "white")
        ImageDraw.Draw(row).text((8, T // 2 - 10), name, fill=(70, 60, 80), font=font)
        for j, i in enumerate(idx):
            row.paste(fr[i].resize((T, T), Image.LANCZOS), (150 + j * T, 0))
        rows.append(row)
    s = Image.new("RGB", (rows[0].width, len(rows) * (T + 6)), "white")
    for i, r in enumerate(rows):
        s.paste(r, (0, i * (T + 6)))
    s.save(out_png)
    print(out_png, len(rows), "rows")


sheet("clip", os.path.join(ROOT, "renders", "09_clips.png"))
sheet("mood", os.path.join(ROOT, "renders", "10_moods.png"))
