// Рисование карточек ветвей на Canvas 2D: хвойные лапы (ель, пихта, лиственница), сухие веточки, берёзовые прутья,
// травинки и папоротник. Каждый атлас — сетка ячеек 2:1; фон прозрачный (альфа-тест), цвет под прозрачными
// пикселями «растекается», чтобы на краях не было тёмной каймы.

import { RNG } from '../../core/util';

export interface Atlas {
  canvas: HTMLCanvasElement;
  cols: number;
  rows: number;
  /** uv-прямоугольник ячейки [u0,v0,u1,v1] (v снизу вверх, как в three). */
  cell(i: number): [number, number, number, number];
}

type RGB = [number, number, number];

function make(w: number, h: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const ctx = c.getContext('2d', { willReadFrequently: true })!;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  return [c, ctx];
}

const rgb = (c: RGB, k = 1, a = 1) =>
  `rgba(${Math.max(0, Math.min(255, c[0] * k)) | 0},${Math.max(0, Math.min(255, c[1] * k)) | 0},${Math.max(0, Math.min(255, c[2] * k)) | 0},${a})`;

/** Заполняет RGB прозрачных пикселей средним цветом соседей (без изменения альфы): убирает тёмную кайму. */
function bleed(canvas: HTMLCanvasElement, fill: RGB) {
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
  const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const d = img.data;
  const W = canvas.width, H = canvas.height;
  // два прохода «растекания» цвета в прозрачные пиксели
  const src = new Uint8ClampedArray(d);
  for (let pass = 0; pass < 3; pass++) {
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const i = (y * W + x) * 4;
        if (src[i + 3] > 10) continue;
        let r = 0, g = 0, b = 0, n = 0;
        for (let dy = -2; dy <= 2; dy++) {
          for (let dx = -2; dx <= 2; dx++) {
            const xx = x + dx, yy = y + dy;
            if (xx < 0 || yy < 0 || xx >= W || yy >= H) continue;
            const j = (yy * W + xx) * 4;
            if (src[j + 3] > 10) { r += src[j]; g += src[j + 1]; b += src[j + 2]; n++; }
          }
        }
        if (n) { d[i] = r / n; d[i + 1] = g / n; d[i + 2] = b / n; src[i] = d[i]; src[i + 1] = d[i + 1]; src[i + 2] = d[i + 2]; src[i + 3] = 11; }
        else if (pass === 2) { d[i] = fill[0]; d[i + 1] = fill[1]; d[i + 2] = fill[2]; }
      }
    }
  }
  ctx.putImageData(img, 0, 0);
}

function atlas(canvas: HTMLCanvasElement, cols: number, rows: number): Atlas {
  return {
    canvas, cols, rows,
    cell(i) {
      const cx = i % cols, cy = Math.floor(i / cols);
      return [cx / cols, 1 - (cy + 1) / rows, (cx + 1) / cols, 1 - cy / rows];
    },
  };
}

// ---------------------------------------------------------------- хвойная лапа

interface SprayStyle {
  /** палитра хвои (sRGB 0..255) */
  needle: RGB[];
  twig: RGB;
  /** доля «осенней» хвои (жёлто-бурой) */
  dead: number;
  /** длина иглы в долях ширины ячейки */
  nLen: number;
  nWid: number;
  /** угол иглы относительно побега, рад */
  nAng: number;
  /** густота хвои вдоль побега (иголок на пиксель побега) */
  density: number;
  /** число боковых побегов */
  twigs: number;
  /** угол боковых побегов к стержню */
  twigAng: number;
  /** длина боковых побегов в долях высоты ячейки */
  twigLen: number;
  /** двухрядная «гребёнка» (пихта) */
  comb?: boolean;
  /** хвоя пучками (лиственница) */
  tufts?: boolean;
  /** висячие вторичные веточки */
  droop?: number;
}

function curve(ctx: CanvasRenderingContext2D, x0: number, y0: number, x1: number, y1: number, bend: number, wid: number, col: string) {
  const mx = (x0 + x1) / 2 + (y1 - y0) * bend, my = (y0 + y1) / 2 - (x1 - x0) * bend;
  ctx.strokeStyle = col;
  ctx.lineWidth = wid;
  ctx.beginPath();
  ctx.moveTo(x0, y0);
  ctx.quadraticCurveTo(mx, my, x1, y1);
  ctx.stroke();
}

function quad(t: number, p0: number, pc: number, p1: number) {
  const u = 1 - t;
  return u * u * p0 + 2 * u * t * pc + t * t * p1;
}

function paintNeedles(
  ctx: CanvasRenderingContext2D, rng: RNG, st: SprayStyle,
  x0: number, y0: number, x1: number, y1: number, bend: number, cw: number, dirAng: number,
) {
  const mx = (x0 + x1) / 2 + (y1 - y0) * bend, my = (y0 + y1) / 2 - (x1 - x0) * bend;
  const len = Math.hypot(x1 - x0, y1 - y0);
  const n = Math.max(3, Math.floor(len * st.density));
  // два прохода: тёмный «подслой» (глубина) и основная хвоя
  for (let pass = 0; pass < 2; pass++) {
    for (let k = 0; k < n; k++) {
      const t = 0.04 + 0.96 * (k / n) + rng.range(-0.008, 0.008);
      const px = quad(t, x0, mx, x1), py = quad(t, y0, my, y1);
      const tx = 2 * (1 - t) * (mx - x0) + 2 * t * (x1 - mx), ty = 2 * (1 - t) * (my - y0) + 2 * t * (y1 - my);
      const ang = Math.atan2(ty, tx);
      const fade = 1 - 0.4 * Math.abs(t - 0.45); // у кончика и у основания иголки короче
      for (const side of [-1, 1]) {
        if (pass === 1 && rng.chance(0.12)) continue; // редкие «просветы»
        const spread = st.comb ? 0.12 : 0.34;
        const a = ang + side * (st.nAng + rng.range(-spread, spread)) * (pass === 0 ? 1.12 : 1);
        const L = cw * st.nLen * rng.range(0.62, 1.3) * fade * (pass === 0 ? 1.1 : 1);
        let col: RGB;
        if (pass === 1 && rng.chance(st.dead)) col = [120 + rng.range(-12, 18), 88 + rng.range(-10, 12), 46 + rng.range(-8, 10)];
        else col = rng.pick(st.needle);
        const shade = pass === 0 ? rng.range(0.38, 0.6) : rng.range(0.72, 1.3) * (0.82 + 0.3 * t);
        ctx.strokeStyle = rgb(col, shade, rng.range(0.88, 1));
        ctx.lineWidth = cw * st.nWid * rng.range(0.85, 1.25);
        ctx.beginPath();
        ctx.moveTo(px, py);
        // лёгкий изгиб иглы
        const cx2 = px + Math.cos(a + side * 0.12) * L * 0.55, cy2 = py + Math.sin(a + side * 0.12) * L * 0.55;
        ctx.quadraticCurveTo(cx2, cy2, px + Math.cos(a) * L, py + Math.sin(a) * L);
        ctx.stroke();
      }
      // короткая «верхняя» иголка (смотрит из плоскости лапы)
      if (pass === 1 && !st.comb && rng.chance(0.35)) {
        const a = ang + rng.range(-0.35, 0.35);
        const L = cw * st.nLen * rng.range(0.35, 0.6);
        ctx.strokeStyle = rgb(rng.pick(st.needle), rng.range(0.95, 1.4));
        ctx.lineWidth = cw * st.nWid * 1.1;
        ctx.beginPath(); ctx.moveTo(px, py); ctx.lineTo(px + Math.cos(a) * L, py + Math.sin(a) * L); ctx.stroke();
      }
    }
  }
  void dirAng;
}

/** Лапа ели/пихты/лиственницы в ячейке (cx,cy,cw,ch): основание слева по центру, кончик справа. */
export function paintSpray(ctx: CanvasRenderingContext2D, rng: RNG, st: SprayStyle, cx: number, cy: number, cw: number, ch: number, variant = 0) {
  ctx.save();
  ctx.beginPath();
  ctx.rect(cx, cy, cw, ch);
  ctx.clip();
  const yMid = cy + ch / 2;
  const margin = ch * 0.04;
  // стержень лапы
  const sx0 = cx + cw * 0.015, sx1 = cx + cw * (0.97 - 0.05 * variant);
  const bendS = rng.range(-0.05, 0.05);
  const spineN = 40;
  const pts: Array<[number, number]> = [];
  for (let i = 0; i <= spineN; i++) {
    const t = i / spineN;
    pts.push([sx0 + (sx1 - sx0) * t, yMid + Math.sin(t * 3.0 + variant) * ch * 0.02 + bendS * ch * (t - 0.5) * (t - 0.5) * 4]);
  }
  ctx.strokeStyle = rgb(st.twig, 0.9);
  ctx.lineWidth = Math.max(2, cw * 0.007);
  ctx.beginPath();
  pts.forEach((p, i) => (i ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1])));
  ctx.stroke();

  // боковые побеги (перо): длиннее посередине, короче к кончику
  const n = st.twigs;
  for (let j = 0; j < n; j++) {
    const t = 0.08 + 0.88 * (j / n) + rng.range(-0.01, 0.01);
    const pi = Math.min(spineN, Math.floor(t * spineN));
    const [px, py] = pts[pi];
    const shape = Math.pow(Math.sin(Math.PI * Math.min(1, (0.12 + 0.88 * t))), 0.8);
    for (const side of [-1, 1]) {
      const L = (ch / 2 - margin) * st.twigLen * shape * rng.range(0.72, 1.05) * (variant === 1 ? 0.8 : 1);
      if (L < 6) continue;
      const a = side * (st.twigAng + rng.range(-0.18, 0.18)) * (1 - 0.25 * t);
      const ex = px + Math.cos(a) * L * 0.9, ey = py + Math.sin(a) * L;
      const bend = side * (st.droop ?? 0.08);
      curve(ctx, px, py, ex, ey, bend, Math.max(1.3, cw * 0.0045), rgb(st.twig, 0.85));
      paintNeedles(ctx, rng, st, px, py, ex, ey, bend, cw, a);
      // вторичная веточка
      if (L > 30 && rng.chance(0.55)) {
        const t2 = rng.range(0.4, 0.7);
        const sx = quad(t2, px, (px + ex) / 2 + (ey - py) * bend, ex), sy = quad(t2, py, (py + ey) / 2 - (ex - px) * bend, ey);
        const a2 = a + side * rng.range(0.5, 0.9);
        const L2 = L * rng.range(0.28, 0.45);
        const ex2 = sx + Math.cos(a2) * L2, ey2 = sy + Math.sin(a2) * L2;
        curve(ctx, sx, sy, ex2, ey2, 0, Math.max(1.1, cw * 0.0035), rgb(st.twig, 0.85));
        paintNeedles(ctx, rng, st, sx, sy, ex2, ey2, 0, cw, a2);
      }
    }
  }
  // иглы на самом стержне и верхушечная почка
  for (let i = 0; i < spineN; i += 1) {
    const [px, py] = pts[i];
    const nx = pts[Math.min(spineN, i + 1)];
    const ang = Math.atan2(nx[1] - py, nx[0] - px);
    for (const side of [-1, 1]) {
      const a = ang + side * (st.nAng + rng.range(-0.3, 0.3));
      const L = cw * st.nLen * rng.range(0.7, 1.1);
      ctx.strokeStyle = rgb(rng.pick(st.needle), rng.range(0.8, 1.15));
      ctx.lineWidth = cw * st.nWid;
      ctx.beginPath();
      ctx.moveTo(px, py);
      ctx.lineTo(px + Math.cos(a) * L, py + Math.sin(a) * L);
      ctx.stroke();
    }
  }
  ctx.restore();
}

/** Лиственница: тонкие веточки с пучками хвои на укороченных побегах (поздней осенью — охристо-золотая). */
export function paintLarch(ctx: CanvasRenderingContext2D, rng: RNG, cx: number, cy: number, cw: number, ch: number, bare = 0, variant = 0) {
  ctx.save();
  ctx.beginPath();
  ctx.rect(cx, cy, cw, ch);
  ctx.clip();
  const yMid = cy + ch / 2;
  const pal: RGB[] = [[196, 150, 52], [214, 168, 66], [176, 118, 42], [222, 186, 92], [160, 124, 56], [188, 98, 36]];
  const tuft = (x: number, y: number, ang: number, size: number) => {
    const n = rng.int(14, 26);
    const col = rng.pick(pal);
    for (let i = 0; i < n; i++) {
      const a = ang + rng.range(-1.25, 1.25);
      const L = size * rng.range(0.6, 1.1);
      ctx.strokeStyle = rgb(col, rng.range(0.82, 1.18));
      ctx.lineWidth = Math.max(1.3, cw * 0.0042);
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x + Math.cos(a) * L, y + Math.sin(a) * L);
      ctx.stroke();
    }
  };
  const twigCol: RGB = [96, 66, 44];
  // стержень
  const sx0 = cx + cw * 0.015, sx1 = cx + cw * 0.97;
  ctx.strokeStyle = rgb(twigCol);
  ctx.lineWidth = cw * 0.008;
  ctx.beginPath();
  ctx.moveTo(sx0, yMid);
  ctx.bezierCurveTo(cx + cw * 0.35, yMid + ch * 0.03, cx + cw * 0.65, yMid - ch * 0.04, sx1, yMid + ch * 0.01);
  ctx.stroke();
  const spine = (t: number): [number, number] => {
    const u = 1 - t;
    const x = u * u * u * sx0 + 3 * u * u * t * (cx + cw * 0.35) + 3 * u * t * t * (cx + cw * 0.65) + t * t * t * sx1;
    const y = u * u * u * yMid + 3 * u * u * t * (yMid + ch * 0.03) + 3 * u * t * t * (yMid - ch * 0.04) + t * t * t * (yMid + ch * 0.01);
    return [x, y];
  };
  const nTw = 15 + variant * 2;
  for (let j = 0; j < nTw; j++) {
    const t = 0.07 + 0.9 * (j / nTw);
    const [px, py] = spine(t);
    const shape = Math.sin(Math.PI * (0.1 + 0.9 * t)) ** 0.8;
    for (const side of [-1, 1]) {
      const L = (ch / 2 - 6) * shape * rng.range(0.55, 1.0);
      const a = side * rng.range(0.7, 1.05);
      const ex = px + Math.cos(a) * L * 0.85, ey = py + Math.sin(a) * L;
      curve(ctx, px, py, ex, ey, side * 0.1, Math.max(1.3, cw * 0.0042), rgb(twigCol, 0.9));
      // пучки по веточке
      const m = Math.max(2, Math.floor(L / 11));
      for (let k = 1; k <= m; k++) {
        if (rng.chance(bare)) continue;
        const tt = k / m;
        const tx = px + (ex - px) * tt, ty = py + (ey - py) * tt;
        tuft(tx, ty, a - side * 0.25, cw * 0.034);
      }
      // верхушечный пучок
      if (!rng.chance(bare)) tuft(ex, ey, a, cw * 0.04);
    }
  }
  ctx.restore();
}

/** Сухие веточки с лишайником (для нижней части ствола и сухостоя). */
export function paintDeadTwigs(ctx: CanvasRenderingContext2D, rng: RNG, cx: number, cy: number, cw: number, ch: number) {
  ctx.save();
  ctx.beginPath();
  ctx.rect(cx, cy, cw, ch);
  ctx.clip();
  const yMid = cy + ch / 2;
  const cols: RGB[] = [[88, 70, 56], [70, 58, 48], [104, 86, 70], [60, 50, 44]];
  const grow = (x: number, y: number, ang: number, L: number, w: number, depth: number) => {
    const ex = x + Math.cos(ang) * L, ey = y + Math.sin(ang) * L;
    curve(ctx, x, y, ex, ey, rng.range(-0.08, 0.08), w, rgb(rng.pick(cols), rng.range(0.85, 1.15)));
    if (depth < 3 && L > 12) {
      const n = rng.int(2, 4);
      for (let i = 0; i < n; i++) {
        const t = rng.range(0.25, 0.95);
        const sx = x + (ex - x) * t, sy = y + (ey - y) * t;
        grow(sx, sy, ang + (rng.chance(0.5) ? 1 : -1) * rng.range(0.4, 0.95), L * rng.range(0.3, 0.55), Math.max(1, w * 0.7), depth + 1);
      }
    }
    // лишайник — светло-зелёные пятнышки
    if (rng.chance(0.5)) {
      ctx.fillStyle = rgb([150, 160, 112], rng.range(0.8, 1.1), 0.85);
      const t = rng.range(0.2, 0.9);
      ctx.beginPath();
      ctx.arc(x + (ex - x) * t, y + (ey - y) * t, rng.range(1.2, 2.6), 0, 7);
      ctx.fill();
    }
  };
  grow(cx + cw * 0.02, yMid, rng.range(-0.08, 0.08), cw * 0.95, Math.max(2.6, cw * 0.011), 0);
  for (let i = 0; i < 7; i++) {
    const t = rng.range(0.1, 0.85);
    grow(cx + cw * t, yMid, rng.chance(0.5) ? rng.range(0.45, 0.9) : rng.range(-0.9, -0.45), cw * rng.range(0.2, 0.42), Math.max(1.6, cw * 0.006), 1);
  }
  ctx.restore();
}

// ---------------------------------------------------------------- атласы видов

export interface ConiferStyle { kind: 'spruce' | 'fir' | 'larch' | 'pine' }

/** Атлас кроны: ячейки 0,1,2 — лапы (широкая, узкая, верхушечная), 3 — сухие веточки. 2 колонки × 2 ряда. */
export function buildConiferAtlas(kind: 'spruce' | 'fir' | 'larch', cellW: number, seed: number): Atlas {
  const cellH = cellW / 2;
  const [canvas, ctx] = make(cellW * 2, cellH * 2);
  const rng = new RNG(seed);
  const cell = (i: number): [number, number] => [(i % 2) * cellW, Math.floor(i / 2) * cellH];
  if (kind === 'larch') {
    paintLarch(ctx, rng, ...cell(0), cellW, cellH, 0.22, 0);
    paintLarch(ctx, rng, ...cell(1), cellW, cellH, 0.35, 1);
    paintLarch(ctx, rng, ...cell(2), cellW, cellH, 0.1, 2);
    paintDeadTwigs(ctx, rng, ...cell(3), cellW, cellH);
    bleed(canvas, [176, 130, 52]);
  } else {
    const spruce: SprayStyle = {
      needle: [[30, 52, 36], [38, 62, 42], [26, 44, 34], [46, 72, 48], [34, 58, 50]],
      twig: [78, 58, 42], dead: 0.06, nLen: 0.036, nWid: 0.0026, nAng: 0.78, density: 0.42,
      twigs: 19, twigAng: 1.0, twigLen: 0.98, droop: 0.14,
    };
    const fir: SprayStyle = {
      needle: [[34, 62, 46], [42, 74, 52], [30, 56, 46], [52, 84, 58], [40, 70, 62]],
      twig: [86, 70, 56], dead: 0.03, nLen: 0.034, nWid: 0.0026, nAng: 1.2, density: 0.4,
      twigs: 22, twigAng: 1.1, twigLen: 0.95, comb: true, droop: 0.06,
    };
    const st = kind === 'spruce' ? spruce : fir;
    const sc = cellW / 512;
    void sc;
    paintSpray(ctx, rng, st, ...cell(0), cellW, cellH, 0);
    paintSpray(ctx, rng, { ...st, twigs: st.twigs - 4, twigLen: st.twigLen * 0.85 }, ...cell(1), cellW, cellH, 1);
    paintSpray(ctx, rng, { ...st, twigs: st.twigs - 7, twigLen: st.twigLen * 0.62, twigAng: st.twigAng * 0.7 }, ...cell(2), cellW, cellH, 2);
    paintDeadTwigs(ctx, rng, ...cell(3), cellW, cellH);
    bleed(canvas, [34, 58, 40]);
  }
  return atlas(canvas, 2, 2);
}

/** Берёза: тонкие тёмные свисающие прутья с редкими жёлтыми листьями (поздняя осень). Ячейки: 0,1 — с листьями, 2 — голые, 3 — густые. */
export function buildBirchAtlas(cellW: number, seed: number): Atlas {
  const cellH = cellW / 2;
  const [canvas, ctx] = make(cellW * 2, cellH * 2);
  const rng = new RNG(seed);
  const leafCols: RGB[] = [[222, 184, 58], [232, 200, 84], [204, 150, 42], [178, 126, 44], [238, 214, 128]];
  const twigCols: RGB[] = [[50, 38, 38], [62, 48, 44], [42, 32, 32], [74, 58, 50]];
  const paintCell = (cx: number, cy: number, leaves: number, nTw: number) => {
    ctx.save();
    ctx.beginPath(); ctx.rect(cx, cy, cellW, cellH); ctx.clip();
    const yMid = cy + cellH / 2;
    const leaf = (x: number, y: number, a: number) => {
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(a);
      ctx.fillStyle = rgb(rng.pick(leafCols), rng.range(0.85, 1.1));
      const s = cellW * rng.range(0.011, 0.019);
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.bezierCurveTo(s * 0.5, -s * 0.75, s * 1.5, -s * 0.55, s * 2.1, 0);
      ctx.bezierCurveTo(s * 1.5, s * 0.55, s * 0.5, s * 0.75, 0, 0);
      ctx.fill();
      ctx.restore();
    };
    const twig = (x: number, y: number, ang: number, L: number, w: number, depth: number) => {
      const droop = 0.18 + 0.06 * depth;
      const ex = x + Math.cos(ang) * L, ey = y + Math.sin(ang) * L + L * droop;
      curve(ctx, x, y, ex, ey, rng.range(-0.1, 0.1) + 0.12, w, rgb(rng.pick(twigCols), rng.range(0.9, 1.25)));
      if (depth < 3) {
        const n = rng.int(2, 4);
        for (let i = 0; i < n; i++) {
          const t = rng.range(0.2, 0.95);
          const sx = x + (ex - x) * t, sy = y + (ey - y) * t;
          twig(sx, sy, ang + (rng.chance(0.5) ? 1 : -1) * rng.range(0.35, 0.8), L * rng.range(0.28, 0.5), Math.max(0.8, w * 0.7), depth + 1);
        }
      }
      if (depth >= 1) {
        const n = Math.floor(rng.range(0, leaves * 3));
        for (let i = 0; i < n; i++) {
          const t = rng.range(0.35, 1.0);
          leaf(x + (ex - x) * t, y + (ey - y) * t, rng.range(0, 6.28));
        }
      }
    };
    // стержень ветки
    const sx0 = cx + cellW * 0.02, sx1 = cx + cellW * 0.96;
    curve(ctx, sx0, yMid, sx1, yMid + cellH * 0.05, 0.03, Math.max(2, cellW * 0.006), rgb([48, 38, 36]));
    for (let j = 0; j < nTw; j++) {
      const t = 0.08 + 0.86 * (j / nTw) + rng.range(-0.02, 0.02);
      const px = sx0 + (sx1 - sx0) * t, py = yMid + cellH * 0.05 * t;
      for (const side of [-1, 1]) {
        if (rng.chance(0.15)) continue;
        const shape = Math.sin(Math.PI * (0.1 + 0.9 * t)) ** 0.7;
        twig(px, py, side * rng.range(0.7, 1.15) + (side > 0 ? 0.05 : -0.05), (cellH / 2 - 8) * shape * rng.range(0.65, 1.0), Math.max(1.2, cellW * 0.0036), 1);
      }
    }
    ctx.restore();
  };
  paintCell(0, 0, 1.0, 11);
  paintCell(cellW, 0, 0.6, 10);
  paintCell(0, cellH, 0, 11);
  paintCell(cellW, cellH, 1.6, 12);
  bleed(canvas, [60, 48, 44]);
  return atlas(canvas, 2, 2);
}

/** Пучок сухой травы: пучок изогнутых травинок (ячейка 1:2 по вертикали). Атлас 4 колонки × 1: разные пучки. */
export function buildGrassAtlas(cellW: number, seed: number): Atlas {
  const cellH = cellW * 1.5;
  const cols = 4;
  const [canvas, ctx] = make(cellW * cols, cellH);
  const rng = new RNG(seed);
  const pal: RGB[] = [[176, 150, 92], [158, 126, 70], [190, 168, 112], [140, 108, 60], [120, 96, 62], [168, 138, 84], [100, 110, 70]];
  for (let c = 0; c < cols; c++) {
    const x0 = c * cellW;
    const nBlades = 26 + c * 4;
    for (let i = 0; i < nBlades; i++) {
      const bx = x0 + cellW * (0.5 + rng.range(-0.1, 0.1) * (1 + c * 0.2));
      const by = cellH * 0.99;
      const h = cellH * rng.range(0.4, 0.97);
      const lean = rng.range(-0.55, 0.55) * (0.5 + 0.5 * (h / cellH));
      const wid = Math.max(1.3, cellW * rng.range(0.012, 0.024));
      const col = rng.pick(pal);
      const k = rng.range(0.75, 1.15);
      // травинка: сужающаяся изогнутая полоска из нескольких сегментов
      const segs = 8;
      let px = bx, py = by;
      for (let s = 0; s < segs; s++) {
        const t0 = s / segs, t1 = (s + 1) / segs;
        const curveX = lean * cellW * 0.5 * t1 * t1 * (1 + 0.2 * Math.sin(i));
        const nx = bx + curveX, ny = by - h * t1;
        ctx.strokeStyle = rgb(col, k * (0.7 + 0.4 * t1));
        ctx.lineWidth = wid * (1 - 0.82 * t0);
        ctx.beginPath(); ctx.moveTo(px, py); ctx.lineTo(nx, ny); ctx.stroke();
        px = nx; py = ny;
      }
      // метёлка на части стеблей
      if (rng.chance(0.25) && h > cellH * 0.6) {
        ctx.strokeStyle = rgb([200, 180, 130], rng.range(0.85, 1.1));
        ctx.lineWidth = wid * 0.9;
        for (let q = 0; q < 6; q++) {
          ctx.beginPath(); ctx.moveTo(px, py + q * 2.2); ctx.lineTo(px + rng.range(-3, 3) + lean * 4, py - 5 + q * 2.2); ctx.stroke();
        }
      }
    }
  }
  bleed(canvas, [150, 124, 80]);
  return atlas(canvas, cols, 1);
}

/** Папоротник: вайи-перья (поздняя осень — бурые/охристые). Атлас 2×1. */
export function buildFernAtlas(cellW: number, seed: number): Atlas {
  const cellH = cellW;
  const [canvas, ctx] = make(cellW * 2, cellH);
  const rng = new RNG(seed);
  const pal: RGB[] = [[132, 90, 44], [150, 108, 52], [112, 76, 40], [168, 128, 66], [96, 84, 46], [110, 100, 56]];
  for (let c = 0; c < 2; c++) {
    const x0 = c * cellW;
    const fronds = c === 0 ? 7 : 9;
    for (let f = 0; f < fronds; f++) {
      const a = -Math.PI / 2 + (f / (fronds - 1) - 0.5) * 2.0 * 0.82 + rng.range(-0.08, 0.08);
      const L = cellH * rng.range(0.5, 0.93);
      const bx = x0 + cellW / 2, by = cellH * 0.98;
      const col = rng.pick(pal);
      const bend = rng.range(-0.28, 0.28);
      const steps = 22;
      let prev: [number, number] = [bx, by];
      for (let s = 1; s <= steps; s++) {
        const t = s / steps;
        const ang = a + bend * t * t;
        const x = prev[0] + Math.cos(ang) * L / steps, y = prev[1] + Math.sin(ang) * L / steps;
        ctx.strokeStyle = rgb([70, 52, 36], 1);
        ctx.lineWidth = Math.max(1.4, 3.2 * (1 - t));
        ctx.beginPath(); ctx.moveTo(prev[0], prev[1]); ctx.lineTo(x, y); ctx.stroke();
        // листочки-перышки
        const pl = L * 0.2 * Math.sin(Math.PI * (0.08 + 0.92 * t)) ** 0.7 * (1 - 0.3 * t);
        if (pl > 3 && s > 2) {
          for (const side of [-1, 1]) {
            const pa = ang + side * rng.range(1.05, 1.35);
            ctx.strokeStyle = rgb(col, rng.range(0.8, 1.2));
            ctx.lineWidth = Math.max(2.4, pl * 0.32);
            ctx.beginPath();
            ctx.moveTo(x, y);
            ctx.lineTo(x + Math.cos(pa) * pl, y + Math.sin(pa) * pl);
            ctx.stroke();
          }
        }
        prev = [x, y];
      }
    }
  }
  bleed(canvas, [120, 88, 46]);
  return atlas(canvas, 2, 1);
}

/** Низкий кустарник (голубика/багульник/карликовая берёза): тёмные прутья с рыже-красными листьями. Атлас 2×1. */
export function buildShrubAtlas(cellW: number, seed: number): Atlas {
  const cellH = cellW;
  const [canvas, ctx] = make(cellW * 2, cellH);
  const rng = new RNG(seed);
  const leafCols: RGB[][] = [
    [[150, 52, 36], [172, 70, 42], [128, 44, 34], [190, 96, 50], [96, 70, 40]],
    [[74, 86, 46], [60, 72, 40], [96, 98, 52], [120, 90, 48], [86, 64, 40]],
  ];
  for (let c = 0; c < 2; c++) {
    const x0 = c * cellW;
    const grow = (x: number, y: number, ang: number, L: number, w: number, depth: number) => {
      const ex = x + Math.cos(ang) * L, ey = y + Math.sin(ang) * L;
      curve(ctx, x, y, ex, ey, rng.range(-0.12, 0.12), w, rgb([54, 40, 32], rng.range(0.9, 1.3)));
      const nLeaf = Math.floor(L / 6);
      for (let i = 0; i < nLeaf; i++) {
        const t = rng.range(0.15, 1);
        const lx = x + (ex - x) * t, ly = y + (ey - y) * t;
        ctx.save();
        ctx.translate(lx, ly);
        ctx.rotate(ang + rng.range(-1.4, 1.4));
        ctx.fillStyle = rgb(rng.pick(leafCols[c]), rng.range(0.85, 1.15));
        const s = cellW * rng.range(0.016, 0.03);
        ctx.beginPath();
        ctx.ellipse(s, 0, s, s * 0.55, 0, 0, 7);
        ctx.fill();
        ctx.restore();
      }
      if (depth < 3) {
        const n = rng.int(2, 4);
        for (let i = 0; i < n; i++) {
          const t = rng.range(0.25, 0.95);
          grow(x + (ex - x) * t, y + (ey - y) * t, ang + (rng.chance(0.5) ? 1 : -1) * rng.range(0.4, 0.9), L * rng.range(0.4, 0.62), Math.max(1.1, w * 0.72), depth + 1);
        }
      }
    };
    for (let k = 0; k < 6; k++) {
      grow(x0 + cellW * rng.range(0.4, 0.6), cellH * 0.98, -Math.PI / 2 + rng.range(-0.8, 0.8), cellH * rng.range(0.4, 0.62), 3, 0);
    }
  }
  bleed(canvas, [100, 62, 38]);
  return atlas(canvas, 2, 1);
}
