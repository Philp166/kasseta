#!/usr/bin/env python3
"""Кадры из видео -> прозрачные спрайты одинакового размера.
usage: anim_process.py video.mp4 outdir frame_count loop|once [target_h]
Ключует маджентовый фон, берёт общий bbox, режет все кадры одинаково.
"""
import sys, os, subprocess, glob, numpy as np
from PIL import Image
from scipy import ndimage

video, outdir, count, mode = sys.argv[1], sys.argv[2], int(sys.argv[3]), sys.argv[4]
target_h = int(sys.argv[5]) if len(sys.argv) > 5 else 420
tmp = outdir + "_raw"; os.makedirs(tmp, exist_ok=True); os.makedirs(outdir, exist_ok=True)
subprocess.run(["ffmpeg", "-loglevel", "error", "-y", "-i", video, "-vsync", "0", f"{tmp}/f%04d.png"], check=True)
fs = sorted(glob.glob(f"{tmp}/f*.png"))
if mode == "loop":
    # для цикла берём первые ~2/3 видео (дальше модель начинает импровизировать)
    fs = fs[: int(len(fs) * 0.7)]
idx = np.unique(np.round(np.linspace(0, len(fs) - 1, count)).astype(int))
frames = [np.array(Image.open(fs[i]).convert("RGB")).astype(int) for i in idx]

def key(a):
    r, g, b = a[..., 0], a[..., 1], a[..., 2]
    # мадженто-розовый фон: R и B высокие, G заметно ниже; плюс светло-розовые карточки
    bg = (r > 150) & (b > 150) & (g < r - 60) & (g < b - 60)
    bg |= (r > 200) & (b > 200) & (g > 150) & (g < r - 25)
    fg = ~bg
    fg = ndimage.binary_opening(fg, iterations=2)
    lab, n = ndimage.label(fg)
    if n > 1:
        sizes = ndimage.sum(fg, lab, range(1, n + 1))
        keep = [i + 1 for i, s in enumerate(sizes) if s > sizes.max() * 0.02]
        fg = np.isin(lab, keep)
    fg = ndimage.binary_fill_holes(fg)
    return fg

masks = [key(a) for a in frames]
ys, xs = np.where(np.any(masks, axis=0))
y0, y1, x0, x1 = ys.min(), ys.max() + 1, xs.min(), xs.max() + 1
pad = 6
y0 = max(0, y0 - pad); x0 = max(0, x0 - pad); y1 = min(frames[0].shape[0], y1 + pad); x1 = min(frames[0].shape[1], x1 + pad)
k = min(1.0, target_h / float(y1 - y0))
for i, (a, m) in enumerate(zip(frames, masks)):
    # убираем розовую кайму: чуть сжимаем маску и снимаем розовый оттенок на границе
    alpha = ndimage.binary_erosion(m, iterations=1)
    edge = m & ~alpha
    rgb = a.astype(np.uint8).copy()
    rgb[edge] = (rgb[edge] * 0.5 + np.array([60, 60, 60]) * 0.5).astype(np.uint8)
    out = np.dstack([rgb, (m * 255).astype(np.uint8)])[y0:y1, x0:x1]
    im = Image.fromarray(out, "RGBA")
    if k < 1.0:
        im = im.resize((int(im.width * k), int(im.height * k)), Image.LANCZOS)
    im.save(f"{outdir}/{i:02d}.png")
print(outdir, len(frames), "frames", im.size)
