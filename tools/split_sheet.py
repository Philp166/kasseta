"""Нарезка листа иконок на отдельные предметы.

Порядок:
1. Находим предметы как крупные связные области на листе.
2. Внутри каждого куска снимаем подложку — только ту, что примыкает к краям
   куска. Внутренние светлые части (лезвие, стекло) не трогаем.
3. Делим кусок дальше, только если внутри оказалось несколько предметов
   сопоставимого размера (генератор иногда кладёт три ствола на одну карточку).
"""
import numpy as np
from PIL import Image
from scipy import ndimage


def _strip_border_bg(rgb, mask):
    corners = np.array([rgb[0, 0], rgb[0, -1], rgb[-1, 0], rgb[-1, -1]])
    bgc = np.median(corners, axis=0).astype(int)
    close = np.abs(rgb - bgc).sum(axis=2) <= 45
    lab, n = ndimage.label(close, np.ones((3, 3)))
    border = set(lab[0, :]) | set(lab[-1, :]) | set(lab[:, 0]) | set(lab[:, -1])
    border.discard(0)
    return mask & ~np.isin(lab, list(border))


def split(path, names, target=170):
    a = np.array(Image.open(path).convert("RGBA"))
    rgb = a[:, :, :3].astype(int)
    edge = np.vstack([rgb[0, :], rgb[-1, :], rgb[:, 0], rgb[:, -1]])
    bgc = np.median(edge, axis=0).astype(int)
    fig = np.abs(rgb - bgc).sum(axis=2) > 34
    fig = ndimage.binary_closing(fig, np.ones((7, 7)))
    lab, n = ndimage.label(fig, np.ones((3, 3)))
    sz = ndimage.sum(fig, lab, range(1, n + 1))
    blobs = [int(i) + 1 for i in np.argsort(sz)[::-1][:len(names)] if sz[i] > sz.max() * 0.05]

    pieces = []
    for l in blobs:
        ys, xs = np.where(lab == l)
        y0, y1, x0, x1 = ys.min(), ys.max(), xs.min(), xs.max()
        crop = rgb[y0:y1 + 1, x0:x1 + 1]
        m = _strip_border_bg(crop, (lab == l)[y0:y1 + 1, x0:x1 + 1])
        l2, n2 = ndimage.label(m, np.ones((3, 3)))
        if n2 == 0:
            continue
        s2 = ndimage.sum(m, l2, range(1, n2 + 1))
        keep = [int(i) + 1 for i in range(n2) if s2[i] > s2.max() * 0.55]   # только сопоставимые
        if len(keep) < 2:
            keep = [int(np.argmax(s2)) + 1]
            rest = m
        for k in keep:
            mm = (l2 == k) if len(keep) > 1 else m
            yy, xx = np.where(mm)
            sub = np.zeros((yy.max() - yy.min() + 1, xx.max() - xx.min() + 1, 4), np.uint8)
            sub[:, :, :3] = a[y0 + yy.min():y0 + yy.max() + 1, x0 + xx.min():x0 + xx.max() + 1, :3]
            sub[:, :, 3] = np.where(mm[yy.min():yy.max() + 1, xx.min():xx.max() + 1], 255, 0)
            pieces.append((x0 + int(xx.min()), Image.fromarray(sub)))

    pieces.sort(key=lambda p: p[0])
    out = []
    for i, (_, im) in enumerate(pieces[:len(names)]):
        s = target / max(im.width, im.height)
        out.append((names[i], im.resize((max(1, int(im.width * s)), max(1, int(im.height * s))), Image.LANCZOS)))
    return out
