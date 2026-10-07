// Этнический орнамент: ромбы-«решётка», зигзаги, треугольники, меандр, плетёный жгут.
// Публичный API:
//   drawOrnament(ctx, w, h, style, opts?)       — нарисовать узор на canvas (прозрачный фон; цвет/альфа, как «наклейка»)
//   ornamentBandTexture(style, opts?)           — бесшовная по горизонтали лента { map, normalMap, roughnessMap, ... } для каймы кафтана
//   ornamentBandMaterial(style, opts?)          — то же, готовым MeshStandardMaterial
//   paintOrnament(pbr, rect, style, opts)       — нанести узор на часть любой PBR-текстуры (колчан, ножны, резное дерево)
//
// Пример для каймы кафтана (основной разработчик):
//   const band = ornamentBandTexture('mixed', { repeat: 8 });          // 2048×256
//   band.map.repeat.set(1, 1); // лента тайлится по u; по v — одна полоса
//   const mat = new THREE.MeshStandardMaterial({ map: band.map, normalMap: band.normalMap, roughnessMap: band.roughnessMap, roughness: 1 });
//   // UV кафтана: u вдоль подола (метры / bandWorldLength), v — поперёк полосы (0 — низ, 1 — верх ленты).
//   // На 1 м подола приходится ~ 1 м / (band.worldLength = 0.55 м) повторов: map.repeat.x = периметр / band.worldLength.

import * as THREE from 'three';
import { RNG, clamp } from '../../core/util';
import {
  PBR, PBRMaps, Fbm, RGB, hex, mixRGB, sstep, texSize, makeCanvas, ctxOf, blotchMask,
} from './texkit';

export type OrnamentStyle = 'diamonds' | 'zigzag' | 'triangles' | 'meander' | 'knot' | 'mixed';

export interface OrnamentOpts {
  /** Сколько раз узор повторяется по ширине (для ленты). */
  repeat?: number;
  /** 'beads' — выпуклые стежки бисера (кайма), 'carved' — вырезанные канавки (дерево, кожа). */
  relief?: 'beads' | 'carved';
  /** Основной «светлый» цвет нитей/бисера или цвет канавок. */
  accent?: number;
  /** Красные акценты. */
  red?: number;
  /** Тёмный цвет (контур/тень). */
  dark?: number;
  seed?: number;
  /** Рисовать ли границы-«окантовку» по краям (для ленты). */
  borders?: boolean;
  /** Масштаб толщины линий. */
  weight?: number;
}

const rngOf = (o: OrnamentOpts, k = 0) => new RNG((o.seed ?? 1) * 977 + k * 131 + 5);

// ---------- примитивы ----------

type P = [number, number];

/** Идёт вдоль ломаной с шагом step; cb получает позицию и угол касательной. */
function walk(pts: P[], step: number, cb: (x: number, y: number, ang: number, i: number) => void): void {
  let carry = 0, idx = 0;
  for (let s = 0; s < pts.length - 1; s++) {
    const [x0, y0] = pts[s], [x1, y1] = pts[s + 1];
    const L = Math.hypot(x1 - x0, y1 - y0);
    if (L < 1e-6) continue;
    const ang = Math.atan2(y1 - y0, x1 - x0);
    let d = carry === 0 ? 0 : step - carry;
    if (carry === 0) d = step * 0.5;
    for (; d <= L; d += step) cb(x0 + ((x1 - x0) * d) / L, y0 + ((y1 - y0) * d) / L, ang, idx++);
    carry = L - (d - step);
    if (carry >= step) carry = 0;
  }
}

interface Pen {
  ctx: CanvasRenderingContext2D;
  o: OrnamentOpts;
  rng: RNG;
  /** Масштаб в пикселях: 1 = ширина ленты 2048. */
  k: number;
  accent: string;
  red: string;
  dark: string;
  carved: boolean;
}

const css = (c: RGB, a = 1) => `rgba(${Math.round(c[0] * 255)},${Math.round(c[1] * 255)},${Math.round(c[2] * 255)},${a})`;

function makePen(ctx: CanvasRenderingContext2D, w: number, h: number, o: OrnamentOpts): Pen {
  return {
    ctx, o, rng: rngOf(o), k: Math.min(w / 2048, h / 256 * 1.0) > 0 ? h / 256 : 1,
    accent: css(hex(o.accent ?? (o.relief === 'carved' ? 0x140b06 : 0xe8dcc0))),
    red: css(hex(o.red ?? 0x9c3a22)),
    dark: css(hex(o.dark ?? 0x120a06)),
    carved: o.relief === 'carved',
  };
}

/** Стежок бисера/нити: овальная «капля» с тенью под ней. */
function stitch(pen: Pen, x: number, y: number, len: number, wid: number, ang: number, color: string): void {
  const g = pen.ctx;
  const j = pen.rng;
  // тень (ambient) снизу-справа
  g.fillStyle = css([0.03, 0.02, 0.015], 0.5);
  g.beginPath();
  g.ellipse(x + wid * 0.22, y + wid * 0.3, len * 0.62, wid * 0.72, ang, 0, Math.PI * 2);
  g.fill();
  const tone = 0.82 + j.next() * 0.28;
  g.fillStyle = color;
  g.globalAlpha = 0.92;
  g.beginPath();
  g.ellipse(x, y, len * 0.5 * (0.9 + j.next() * 0.2), wid * 0.5 * tone, ang, 0, Math.PI * 2);
  g.fill();
  g.globalAlpha = 1;
}

/** Линия из бисерных стежков или резной канавки. */
function line(pen: Pen, pts: P[], o: { color?: string; spacing?: number; len?: number; wid?: number; width?: number; rows?: number } = {}): void {
  const g = pen.ctx;
  const k = pen.k * (pen.o.weight ?? 1) * BOLD;
  if (pen.carved) {
    g.strokeStyle = o.color ?? pen.accent;
    g.lineWidth = (o.width ?? 5) * k;
    g.lineCap = 'round';
    g.lineJoin = 'round';
    g.beginPath();
    pts.forEach(([x, y], i) => (i ? g.lineTo(x, y) : g.moveTo(x, y)));
    g.stroke();
    return;
  }
  const sp = (o.spacing ?? 8.2) * k, len = (o.len ?? 7.6) * k, wid = (o.wid ?? 5.4) * k;
  const col = o.color ?? pen.accent;
  // двойной ряд стежков (как на референсе: нить в два бисера шириной)
  const rows = o.rows ?? 1;
  for (let r = 0; r < rows; r++) {
    const off = rows === 1 ? 0 : (r - (rows - 1) / 2) * wid * 0.82;
    const shifted: P[] = off === 0 ? pts : offsetPath(pts, off);
    walk(shifted, sp, (x, y, ang) => {
      if (pen.rng.next() < 0.03) return; // «пропуски» — потёртость нити
      stitch(pen, x + (pen.rng.next() - 0.5) * 0.6 * k, y + (pen.rng.next() - 0.5) * 0.6 * k, len, wid * 0.82, ang + (pen.rng.next() - 0.5) * 0.2, col);
    });
  }
}

/** Смещение ломаной по нормали (для двойных рядов). */
function offsetPath(pts: P[], d: number): P[] {
  return pts.map(([x, y], i) => {
    const a = pts[Math.max(0, i - 1)], b = pts[Math.min(pts.length - 1, i + 1)];
    const dx = b[0] - a[0], dy = b[1] - a[1];
    const L = Math.hypot(dx, dy) || 1;
    return [x - (dy / L) * d, y + (dx / L) * d] as P;
  });
}

const BOLD = 1.0;

function dot(pen: Pen, x: number, y: number, r: number, color: string): void {
  const k = pen.k * (pen.o.weight ?? 1);
  if (pen.carved) {
    pen.ctx.fillStyle = color;
    pen.ctx.beginPath();
    pen.ctx.arc(x, y, r * k * 0.9, 0, Math.PI * 2);
    pen.ctx.fill();
    return;
  }
  stitch(pen, x, y, r * 2 * k, r * 2 * k * 0.92, pen.rng.next() * 3, color);
}

// ---------- узоры (прямоугольник x,y,w,h; повторов n по горизонтали) ----------

function borders(pen: Pen, x: number, y: number, w: number, h: number, edge = 0.075): void {
  const yt = y + h * edge, yb = y + h * (1 - edge);
  line(pen, [[x, yt], [x + w, yt]], { rows: 2 });
  line(pen, [[x, yb], [x + w, yb]], { rows: 2 });
}

function diamonds(pen: Pen, x: number, y: number, w: number, h: number, n: number, withBorders: boolean): void {
  const top = y + h * 0.17, bot = y + h * 0.83, Hf = bot - top;
  const P = w / n, half = P / 2;
  if (withBorders) borders(pen, x, y, w, h);
  // решётка: два семейства диагоналей, шаг по горизонтали P/2
  for (let k = -1; k <= 2 * n; k++) {
    const x0 = x + k * half;
    line(pen, [[x0, top], [x0 + half, bot]], { rows: 2 });
    line(pen, [[x0 + half, top], [x0, bot]], { rows: 2 });
  }
  // в центре каждого ромба — пара точек (кресты решётки пропускают их)
  for (let k = 0; k < n; k++) {
    const cx = x + k * P;
    for (const [dx, dy] of [[0, 0], [P / 2, 0]] as P[]) {
      const px = cx + dx, py = (top + bot) / 2 + dy;
      void py;
    }
    // ромбы между крестами: центры на (cx, top), (cx, bot) и (cx + P/2, mid)
    const mid = (top + bot) / 2;
    const reds = pen.rng.next() < 0.5;
    dot(pen, cx + P / 2 - 7 * pen.k, mid, 3.6, reds ? pen.red : pen.accent);
    dot(pen, cx + P / 2 + 7 * pen.k, mid, 3.6, reds ? pen.red : pen.accent);
    dot(pen, cx, top + Hf * 0.12, 3.2, pen.accent);
    dot(pen, cx, bot - Hf * 0.12, 3.2, pen.accent);
  }
}

function zigzag(pen: Pen, x: number, y: number, w: number, h: number, n: number, withBorders: boolean): void {
  const top = y + h * 0.2, bot = y + h * 0.8;
  const P = w / n;
  if (withBorders) borders(pen, x, y, w, h);
  for (const [off, col] of [[0, pen.accent], [P / 2, pen.red]] as Array<[number, string]>) {
    const pts: P[] = [];
    for (let k = -1; k <= 2 * n + 1; k++) pts.push([x + off + (k * P) / 2 - (off ? P : 0), k % 2 ? bot : top]);
    line(pen, pts, { color: col, rows: 2 });
  }
  // точки в «лунках» между зигзагами
  for (let k = 0; k < n; k++) {
    dot(pen, x + k * P + P / 2, top + (bot - top) * 0.12, 3.2, pen.accent);
    dot(pen, x + k * P, bot - (bot - top) * 0.12, 3.2, pen.accent);
  }
}

function triangles(pen: Pen, x: number, y: number, w: number, h: number, n: number, withBorders: boolean): void {
  const top = y + h * 0.2, bot = y + h * 0.8;
  const P = w / n;
  if (withBorders) borders(pen, x, y, w, h);
  for (let k = 0; k < n; k++) {
    const x0 = x + k * P;
    // острие вверх
    line(pen, [[x0 + P * 0.06, bot], [x0 + P * 0.5, top], [x0 + P * 0.94, bot]], { rows: 2 });
    // вложенный меньший треугольник
    line(pen, [[x0 + P * 0.27, bot], [x0 + P * 0.5, top + (bot - top) * 0.45], [x0 + P * 0.73, bot]], { color: pen.rng.next() < 0.5 ? pen.red : pen.accent });
    dot(pen, x0 + P * 0.5, bot - (bot - top) * 0.2, 3, pen.accent);
    // перевёрнутый между ними (зуб)
    line(pen, [[x0 + P * 0.94, bot], [x0 + P * 1.0, bot - (bot - top) * 0.2]], { color: pen.accent });
  }
}

function meander(pen: Pen, x: number, y: number, w: number, h: number, n: number, withBorders: boolean): void {
  const top = y + h * 0.2, bot = y + h * 0.8, Hf = bot - top;
  const P = w / n, u = P / 6, v = Hf / 4;
  if (withBorders) borders(pen, x, y, w, h);
  for (let k = 0; k < n; k++) {
    const x0 = x + k * P;
    // база и «ключ»-спираль
    const key: P[] = [[0, 0], [0, 4], [4, 4], [4, 1], [1, 1], [1, 3], [3, 3], [3, 2], [2, 2]];
    line(pen, key.map(([a, b]) => [x0 + a * u, bot - b * v] as P));
    line(pen, [[x0 + 0, bot], [x0 + P, bot]]);
    dot(pen, x0 + 5 * u, bot - 3 * v, 3, pen.red);
  }
}

/** Плетёный жгут: две нити с чередованием «поверх/под» + поля с точками. */
function knot(pen: Pen, x: number, y: number, w: number, h: number, n: number, withBorders: boolean): void {
  const g = pen.ctx;
  const cy = y + h / 2, A = h * 0.27;
  const P = w / n;
  if (withBorders) borders(pen, x, y, w, h);
  const steps = 18;
  const wd = (pen.carved ? 6 : 7) * pen.k * (pen.o.weight ?? 1);
  for (let k = 0; k < n * 2; k++) {
    // k-й полупериод: нить A (поверх) и нить B (под)
    for (let pass = 0; pass < 2; pass++) {
      const sign = pass === 0 ? ((k % 2) ? 1 : -1) : ((k % 2) ? -1 : 1); // порядок: сначала нижняя
      const x0 = x + (k * P) / 2;
      const pts: P[] = [];
      for (let i = 0; i <= steps; i++) {
        const t = i / steps;
        pts.push([x0 + t * (P / 2), cy + sign * A * Math.sin((k * Math.PI) + t * Math.PI + Math.PI) * (k % 2 ? 1 : 1)]);
      }
      // контур
      g.lineCap = 'round';
      g.lineJoin = 'round';
      g.strokeStyle = pen.dark;
      g.lineWidth = wd + 3 * pen.k;
      g.beginPath();
      pts.forEach(([a, b], i) => (i ? g.lineTo(a, b) : g.moveTo(a, b)));
      g.stroke();
      g.strokeStyle = pass === 1 ? pen.accent : css(mixRGB(hex(pen.o.accent ?? 0xe8dcc0), [0.3, 0.25, 0.2], 0.35));
      g.lineWidth = wd;
      g.beginPath();
      pts.forEach(([a, b], i) => (i ? g.lineTo(a, b) : g.moveTo(a, b)));
      g.stroke();
    }
  }
}

function mixed(pen: Pen, x: number, y: number, w: number, h: number, n: number): void {
  // верхняя узкая полоса — зигзаг, нижняя широкая — ромбы (как на референсе каймы)
  const hh = h * 0.28;
  borders(pen, x, y, w, 0.04);
  zigzagBand(pen, x, y + h * 0.04, w, hh, n * 2);
  diamonds(pen, x, y + hh + h * 0.02, w, h - hh - h * 0.02, n, true);
}

function zigzagBand(pen: Pen, x: number, y: number, w: number, h: number, n: number): void {
  const top = y + h * 0.18, bot = y + h * 0.82;
  const P = w / n;
  const pts: P[] = [];
  for (let k = -1; k <= 2 * n + 1; k++) pts.push([x + (k * P) / 2, k % 2 ? bot : top]);
  line(pen, pts, { color: pen.accent });
  for (let k = 0; k < n; k++) dot(pen, x + k * P + P / 2, top + (bot - top) * 0.25, 2.6, pen.red);
}

// ---------- публичное ----------

/**
 * Нарисовать орнамент на всём canvas (прозрачный фон). Цвета «светлые нити/бисер» (relief 'beads')
 * или тёмные канавки ('carved'). Используйте как наклейку (PBR.decal) или поверх готовой текстуры.
 */
export function drawOrnament(ctx: CanvasRenderingContext2D, w: number, h: number, style: OrnamentStyle, opts: OrnamentOpts = {}): void {
  drawOrnamentRect(ctx, 0, 0, w, h, style, opts);
}

export function drawOrnamentRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, style: OrnamentStyle, opts: OrnamentOpts = {}): void {
  const pen = makePen(ctx, w, h, opts);
  pen.k = h / 256;
  const n = opts.repeat ?? defaultRepeat(style, w, h);
  const wb = opts.borders ?? true;
  ctx.save();
  switch (style) {
    case 'diamonds': diamonds(pen, x, y, w, h, n, wb); break;
    case 'zigzag': zigzag(pen, x, y, w, h, n, wb); break;
    case 'triangles': triangles(pen, x, y, w, h, n, wb); break;
    case 'meander': meander(pen, x, y, w, h, n, wb); break;
    case 'knot': knot(pen, x, y, w, h, n, wb); break;
    case 'mixed': mixed(pen, x, y, w, h, n); break;
  }
  ctx.restore();
}

function defaultRepeat(style: OrnamentStyle, w: number, h: number): number {
  const asp = w / h;
  const base = style === 'diamonds' || style === 'mixed' ? 0.62 : style === 'meander' ? 0.8 : style === 'knot' ? 0.5 : style === 'triangles' ? 0.95 : 0.7;
  return Math.max(1, Math.round(asp * base));
}

/** Нанести орнамент на часть PBR-текстуры (rect в пикселях). dh — рельеф: >0 выпуклый бисер, <0 канавки. */
export function paintOrnament(t: PBR, rect: { x: number; y: number; w: number; h: number }, style: OrnamentStyle, o: OrnamentOpts & { depth?: number; wear?: number; rough?: number; metal?: number } = {}): void {
  const carved = o.relief === 'carved';
  const depth = o.depth ?? (carved ? -0.28 : 0.3);
  const wearF = new Fbm(6, 4, (o.seed ?? 1) + 40, 0.6);
  const wear = o.wear ?? 0.4;
  t.decal((g) => drawOrnamentRect(g, rect.x, rect.y, rect.w, rect.h, style, o), {
    dh: depth,
    rough: o.rough,
    metal: o.metal,
    alphaMul: wear > 0 ? (u, v) => 1 - wear * sstep(0.52, 0.78, wearF.at(u, v)) * 0.85 : undefined,
  });
}

export interface BandOpts extends OrnamentOpts {
  width?: number;
  height?: number;
  /** Цвет ткани-основы. */
  base?: number;
  wear?: number;
  normalStrength?: number;
  /** false — текстура без flipY (v вниз, как в glTF). По умолчанию true: верх ленты = v=1. */
  flipY?: boolean;
  /** Рваная бахромчатая кромка снизу (как на подоле кафтана). */
  fringe?: boolean;
}

export interface OrnamentBand extends PBRMaps {
  roughnessMap: THREE.CanvasTexture;
  /** Соотношение сторон ленты (ширина/высота). */
  aspect: number;
}

/** Сколько метров подола соответствует одному повтору ленты при высоте полосы heightM. */
export function bandWorldLength(heightM: number, w = 2048, h = 256): number {
  return (heightM * w) / h;
}

/** Бесшовная по горизонтали лента орнамента: тёмная ткань + светлый бисер/нить + красные акценты, потёртости. */
export function ornamentBandTexture(style: OrnamentStyle = 'mixed', opts: BandOpts = {}): OrnamentBand {
  const w = opts.width ?? texSize(2048), h = opts.height ?? texSize(256);
  const seed = opts.seed ?? 1;
  const t = new PBR(w, h);
  const base = hex(opts.base ?? 0x2a1c13);
  const weaveU = new Fbm(8, 3, seed, 0.55, 1, 1);
  const fuzz = new Fbm(24, 3, seed + 1, 0.6);
  const low = new Fbm(3, 4, seed + 2, 0.55, 1, 1);
  const fringeY = opts.fringe ? 0.14 : 0;
  // ткань: переплетение нитей (тканая сетка) + ворс и пятна
  t.gen((u, v, p, x, y) => {
    const warp = 0.5 + 0.5 * Math.sin(x * 1.9 * 2048 / w + Math.sin(y * 0.15) * 0.4);
    const weft = 0.5 + 0.5 * Math.sin(y * 1.9 * 256 / h + Math.sin(x * 0.12) * 0.4);
    const weave = ((x + y) & 1) ? warp : weft;
    const f = fuzz.at(u, v), l = low.at(u, v), wn = weaveU.at(u, v);
    const k = 0.78 + 0.34 * f + 0.2 * (l - 0.5) + 0.12 * (weave - 0.5);
    p.r = base[0] * k * (0.95 + 0.1 * wn);
    p.g = base[1] * k * (0.95 + 0.1 * wn);
    p.b = base[2] * k * 0.95;
    p.h = 0.45 + 0.1 * (weave - 0.5) + 0.12 * (f - 0.5);
    p.rough = 0.88 + 0.1 * (0.5 - f);
    p.metal = 0;
    p.ao = 1;
  });
  // нижняя кромка: рыхлая мехо-кожаная бахрома
  if (fringeY > 0) {
    const fr = new Fbm(40, 3, seed + 3, 0.6, 1, 1);
    const frc = hex(0x4b3624);
    t.gen((u, v, p) => {
      const e = sstep(1 - fringeY * 1.2, 1 - fringeY * 0.2, v + (fr.at(u * 3, v) - 0.5) * 0.12);
      if (e <= 0) return;
      const f = fr.at(u, v * 2);
      p.r += (frc[0] * (0.7 + 0.6 * f) - p.r) * e;
      p.g += (frc[1] * (0.7 + 0.6 * f) - p.g) * e;
      p.b += (frc[2] * (0.7 + 0.6 * f) - p.b) * e;
      p.h += 0.12 * e * (f - 0.5);
      p.rough = 0.95;
    });
  }
  paintOrnament(t, { x: 0, y: 0, w, h }, style, { ...opts, relief: opts.relief ?? 'beads', wear: opts.wear ?? 0.45 });
  // общая грязь/старение
  const grime = blotchMask(t, Math.round(40 * (w * h) / (2048 * 256)), [20, 60], { seed: seed + 9, alpha: [0.2, 0.6] });
  t.paint(grime, { color: [0.05, 0.035, 0.025], k: 0.45, rough: 0.95 });
  t.blurHeight(1);
  t.cavity(0.6, 2, 0.35);
  const maps = t.textures({ normalStrength: opts.normalStrength ?? 3.5 });
  if (opts.flipY === false) {
    maps.map.flipY = false; maps.normalMap.flipY = false; maps.orm.flipY = false;
    maps.map.needsUpdate = maps.normalMap.needsUpdate = maps.orm.needsUpdate = true;
  }
  for (const tx of [maps.map, maps.normalMap, maps.orm]) {
    tx.wrapS = THREE.RepeatWrapping;
    tx.wrapT = THREE.ClampToEdgeWrapping;
  }
  return { ...maps, roughnessMap: maps.orm, aspect: w / h };
}

export function ornamentBandMaterial(style: OrnamentStyle = 'mixed', opts: BandOpts = {}): THREE.MeshStandardMaterial {
  const b = ornamentBandTexture(style, opts);
  return new THREE.MeshStandardMaterial({
    map: b.map, normalMap: b.normalMap, roughnessMap: b.orm, aoMap: b.orm, roughness: 1, metalness: 0,
  });
}

export { clamp as _clamp, makeCanvas as _mc, ctxOf as _cx };
