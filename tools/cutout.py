"""Вырезание персонажа с ровного фона. Общий инструмент для всех ассетов.

Фоном считается пятно, которое похоже на цвет фона по краям И при этом
однотонное (низкий разброс цвета). Так снимаются и внешний фон, и карманы
между ног или внутри ручки инструмента, но не задеваются светлые детали
персонажа — борода, седина, — у которых есть контур и тени.
"""
import numpy as np
from PIL import Image
from scipy import ndimage


def cutout(path, target_h=None, tol=30, flat_std=7.0, min_pocket=120):
    a = np.array(Image.open(path).convert("RGBA"))
    rgb = a[:, :, :3].astype(int)
    edge = np.vstack([rgb[0, :], rgb[-1, :], rgb[:, 0], rgb[:, -1]])
    bgc = np.median(edge, axis=0).astype(int)

    close = np.abs(rgb - bgc).sum(axis=2) <= tol
    lab, n = ndimage.label(close, np.ones((3, 3)))

    border = set(lab[0, :]) | set(lab[-1, :]) | set(lab[:, 0]) | set(lab[:, -1])
    border.discard(0)

    bg = np.zeros_like(close)
    for i in range(1, n + 1):
        m = lab == i
        cnt = int(m.sum())
        if cnt == 0:
            continue
        if i in border:                       # внешний фон
            bg |= m
            continue
        if cnt < min_pocket:                  # мелкие крапины не трогаем
            continue
        std = float(rgb[m].std())             # карман считается фоном, только если он ровный
        if std < flat_std:
            bg |= m

    fig = ~bg
    fig = ndimage.binary_opening(fig, np.ones((3, 3)))
    l2, n2 = ndimage.label(fig, np.ones((3, 3)))
    if n2 > 1:
        sz = ndimage.sum(fig, l2, range(1, n2 + 1))
        fig = l2 == (int(np.argmax(sz)) + 1)

    ys, xs = np.where(fig)
    y0, y1, x0, x1 = ys.min(), ys.max(), xs.min(), xs.max()
    sub = np.zeros((y1 - y0 + 1, x1 - x0 + 1, 4), np.uint8)
    sub[:, :, :3] = a[y0:y1 + 1, x0:x1 + 1, :3]
    sub[:, :, 3] = np.where(fig[y0:y1 + 1, x0:x1 + 1], 255, 0)
    im = Image.fromarray(sub)
    if target_h:
        im = im.resize((max(1, int(im.width * target_h / im.height)), target_h), Image.LANCZOS)
    return im
