"""Нарезка листа иконок.

Генератор раскладывает предметы ровным рядом, поэтому лист делится на равные
колонки по числу предметов. В каждой колонке берётся самый крупный ЧЁТКИЙ кусок:
размытые двойники, которые генератор рисует над предметами, отбрасываются по
отсутствию чёрного контура. Затем с иконки снимается светлая карточка-подложка.
"""
import numpy as np
from PIL import Image
from scipy import ndimage


def _outline_ratio(rgb, mask):
    dark = (rgb.sum(axis=2) < 270) & mask
    return float(dark.sum()) / max(1.0, float(mask.sum()))


def _strip_card(im):
    a = np.array(im)
    if a.shape[0] < 8 or a.shape[1] < 8:
        return im
    rgb = a[:, :, :3].astype(int)
    alpha = a[:, :, 3] > 0
    h, w = alpha.shape
    seeds = [(0, 0), (0, w - 1), (h - 1, 0), (h - 1, w - 1)]
    bgc = np.median(np.array([rgb[y, x] for y, x in seeds]), axis=0).astype(int)
    close = (np.abs(rgb - bgc).sum(axis=2) <= 55) & alpha
    lab, n = ndimage.label(close, np.ones((3, 3)))
    ids = set(int(lab[y, x]) for y, x in seeds)
    ids.discard(0)
    if not ids:
        return im
    keep = alpha & ~np.isin(lab, list(ids))
    if keep.sum() < alpha.sum() * 0.10:
        return im
    ys, xs = np.where(keep)
    out = a[ys.min():ys.max() + 1, xs.min():xs.max() + 1].copy()
    out[:, :, 3] = np.where(keep[ys.min():ys.max() + 1, xs.min():xs.max() + 1], 255, 0)
    return Image.fromarray(out)


def split(path, names, target=170):
    a = np.array(Image.open(path).convert("RGBA"))
    rgb = a[:, :, :3].astype(int)
    H, W = rgb.shape[:2]
    edge = np.vstack([rgb[0, :], rgb[-1, :], rgb[:, 0], rgb[:, -1]])
    bgc = np.median(edge, axis=0).astype(int)

    n_items = len(names)
    out = []
    for i in range(n_items):
        x0 = int(W * i / n_items)
        x1 = int(W * (i + 1) / n_items) - 1
        col = rgb[:, x0:x1 + 1]
        m = np.abs(col - bgc).sum(axis=2) > 34
        m = ndimage.binary_closing(m, np.ones((5, 5)))
        lab, n = ndimage.label(m, np.ones((3, 3)))
        if n == 0:
            continue
        sz = ndimage.sum(m, lab, range(1, n + 1))
        # кандидаты по убыванию площади, берём первый с настоящим контуром
        best = None
        for k in [int(j) + 1 for j in np.argsort(sz)[::-1]]:
            mm = lab == k
            if mm.sum() < 1500:
                break
            if _outline_ratio(col, mm) >= 0.05:
                best = mm
                break
        if best is None:
            continue
        ys, xs = np.where(best)
        sub = np.zeros((ys.max() - ys.min() + 1, xs.max() - xs.min() + 1, 4), np.uint8)
        sub[:, :, :3] = a[ys.min():ys.max() + 1, x0 + xs.min():x0 + xs.max() + 1, :3]
        sub[:, :, 3] = np.where(best[ys.min():ys.max() + 1, xs.min():xs.max() + 1], 255, 0)
        im = _strip_card(Image.fromarray(sub))
        s = target / max(im.width, im.height)
        out.append((names[i], im.resize((max(1, int(im.width * s)), max(1, int(im.height * s))), Image.LANCZOS)))
    return out
