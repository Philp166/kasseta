#!/usr/bin/env python3
"""art/anim/<name>/NN.png -> out/<name>.png (горизонтальная полоса) + out/sheets.json"""
import sys, os, glob, json
from PIL import Image
src, out = sys.argv[1], sys.argv[2]
os.makedirs(out, exist_ok=True)
meta = {}
for d in sorted(glob.glob(f"{src}/*/")):
    name = os.path.basename(d.rstrip("/"))
    fs = sorted(glob.glob(f"{d}/*.png"))
    if not fs:
        continue
    ims = [Image.open(f).convert("RGBA") for f in fs]
    w, h = ims[0].size
    sheet = Image.new("RGBA", (w * len(ims), h))
    for i, im in enumerate(ims):
        sheet.paste(im, (i * w, 0))
    sheet.save(f"{out}/{name}.png", optimize=True)
    meta[name] = {"w": w, "h": h, "n": len(ims)}
    print(name, w, h, len(ims))
json.dump(meta, open(f"{out}/sheets.json", "w"))
