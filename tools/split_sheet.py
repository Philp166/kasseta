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
    """Снимает светлую однотонную подложку.

    Заливка от углов не годится: предмет часто упирается прямо в угол
    карточки. Поэтому фоном считается любая крупная светлая область без
    цвета — карточка всегда серая, а сам предмет цветной или тёмный.
    """
    a = np.array(im)
    if a.shape[0] < 8 or a.shape[1] < 8:
        return im
    rgb = a[:, :, :3].astype(int)
    alpha = a[:, :, 3] > 0
    mx = rgb.max(axis=2); mn = rgb.min(axis=2)
    pale = (mx > 176) & ((mx - mn) < 30) & alpha        # светлое и бесцветное
    lab, n = ndimage.label(pale, np.ones((3, 3)))
    if n == 0:
        return im
    bg = np.zeros_like(pale)
    total = float(alpha.sum())
    h, w = pale.shape
    # 1) крупные светлые области — это карточка-подложка; запоминаем её цвет
    card_cols = []
    for i in range(1, n + 1):
        m = lab == i
        if m.sum() > total * 0.05:
            bg |= m
            card_cols.append(rgb[m].mean(axis=0))
    # 2) мелкие замкнутые кармашки убираем, только если они ТОГО ЖЕ цвета,
    #    что и подложка: иначе съедаются белая маска, крышка аптечки и т. п.
    if card_cols:
        card = np.mean(np.array(card_cols), axis=0)
        for i in range(1, n + 1):
            m = lab == i
            if m.sum() > total * 0.05 or m.sum() < 20:
                continue
            ys, xs = np.where(m)
            if ys.min() == 0 or xs.min() == 0 or ys.max() == h - 1 or xs.max() == w - 1:
                continue
            if np.abs(rgb[m].mean(axis=0) - card).sum() < 26:
                bg |= m
    keep = alpha & ~bg
    if keep.sum() < total * 0.10:
        return im
    lab2, n2 = ndimage.label(keep, np.ones((3, 3)))
    if n2 > 1:                                          # оставляем самый крупный кусок
        sz = ndimage.sum(keep, lab2, range(1, n2 + 1))
        big = int(np.argmax(sz)) + 1
        keep = (lab2 == big) | (keep & ndimage.binary_dilation(lab2 == big, np.ones((7, 7))))
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
