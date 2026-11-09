"""Side-by-side sheet: each expression in refs/emotions-expressions.png next to our browser render.
  .venv/bin/python scripts/expression_sheet.py <shots dir> <out.png>"""
import os
import sys

import numpy as np
from PIL import Image, ImageDraw, ImageFont
from scipy import ndimage as nd

NAMES = ["happy", "veryHappy", "proud", "sleepy", "sad", "surprised", "love", "worried", "determined"]
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def body_crop(im, pad=0.08, aspect=1.25):
    a = np.asarray(im).astype(np.float32)
    m = (a[..., 2] - a[..., 1]) > 10
    m = nd.binary_opening(m, iterations=2)
    lab, n = nd.label(m)
    m = lab == (1 + int(np.argmax(nd.sum(m, lab, range(1, n + 1)))))
    ys, xs = np.nonzero(m)
    x0, x1, y0, y1 = xs.min(), xs.max(), ys.min(), ys.max()
    w = (x1 - x0) * (1 + 2 * pad)
    h = w / aspect
    cx, cy = (x0 + x1) / 2, y1 - (y1 - y0) * 0.5 - (h - (y1 - y0)) * 0.1
    return im.crop((int(cx - w / 2), int(cy - h / 2), int(cx + w / 2), int(cy + h / 2)))


def main(shots, out):
    ref = Image.open(os.path.join(ROOT, "refs", "emotions-expressions.png")).convert("RGB")
    W, H = ref.size
    T = 380
    th = int(T / 1.25)
    f = ImageFont.load_default(size=20)
    sheet = Image.new("RGB", (3 * (2 * T + 30), 3 * (th + 36)), "white")
    for i, n in enumerate(NAMES):
        r, c = divmod(i, 3)
        tile = ref.crop((int(c * W / 3), int(r * H / 3), int((c + 1) * W / 3), int((r + 1) * H / 3)))
        tile = tile.crop((0, 0, tile.width, int(tile.height * 0.78)))  # drop the label
        a = body_crop(tile, pad=0.1).resize((T, th), Image.LANCZOS)
        b = body_crop(Image.open(os.path.join(shots, f"portrait_expr_{n}.png")).convert("RGB"), pad=0.1).resize((T, th), Image.LANCZOS)
        X, Y = c * (2 * T + 30), r * (th + 36)
        sheet.paste(a, (X, Y + 30))
        sheet.paste(b, (X + T + 4, Y + 30))
        ImageDraw.Draw(sheet).text((X + 6, Y + 5), f"{n}: reference | three.js", fill=(70, 70, 70), font=f)
    sheet.save(out)


if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2])
