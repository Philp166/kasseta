// Набор для процедурных PBR-текстур снаряжения (CPU + canvas).
// Идея: материал = несколько полей одинакового размера (альбедо, высота, шероховатость, металличность, окклюзия).
// Поля заполняются шумом/узорами/«наклейками» с canvas; затем из высоты считается карта нормалей,
// а R=AO, G=roughness, B=metalness пакуются в одну ORM-текстуру (roughnessMap = metalnessMap = aoMap).
// Соглашение по UV: обычные three-текстуры (flipY = true) — строка canvas y соответствует v = 1 - y/h.
// Все шумы бесшовные (период 1 по u и v), поэтому любую текстуру можно тайлить.

import * as THREE from 'three';
import { RNG, clamp, lerp } from '../../core/util';

// ---------- Качество ----------

export const gearQuality = { scale: 1, anisotropy: 8 };

/** Профилирование генерации текстур (мс по этапам): window.__gearProf = true. */
export const prof = (label: string, t0: number): number => {
  const t1 = performance.now();
  if ((globalThis as any).__gearProf) console.log(`[gear] ${label}: ${(t1 - t0).toFixed(0)} мс`);
  return t1;
};

/** Глобальная настройка: textureScale 0.5 — вдвое меньшие текстуры (слабые устройства), 2 — вдвое больше. */
export function configureGear(o: { textureScale?: number; anisotropy?: number }): void {
  if (o.textureScale !== undefined) gearQuality.scale = o.textureScale;
  if (o.anisotropy !== undefined) gearQuality.anisotropy = o.anisotropy;
}

/** Ближайшая степень двойки к n * scale в диапазоне 64..4096. */
export function texSize(n: number): number {
  const s = Math.max(64, Math.min(4096, n * gearQuality.scale));
  return 2 ** Math.round(Math.log2(s));
}

// ---------- Цвет ----------

export type RGB = [number, number, number];
/** 0xRRGGBB → [0..1]^3 (sRGB, как рисуют художники; перевод в линейное делает three при выборке). */
export const hex = (c: number): RGB => [((c >> 16) & 255) / 255, ((c >> 8) & 255) / 255, (c & 255) / 255];
export const mixRGB = (a: RGB, b: RGB, t: number): RGB => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
export const scaleRGB = (a: RGB, k: number): RGB => [a[0] * k, a[1] * k, a[2] * k];

export const sstep = (a: number, b: number, x: number): number => {
  const t = x <= a ? 0 : x >= b ? 1 : (x - a) / (b - a);
  return t * t * (3 - 2 * t);
};

// ---------- Бесшовные шумовые таблицы ----------

const quintic = (t: number) => t * t * t * (t * (t * 6 - 15) + 10);

/** Таблица шума Перлина nx×ny (решётка cu×cv ячеек), период 1. Выборка — билинейная (≈10 операций на шум). */
class Tab {
  readonly nx: number;
  readonly ny: number;
  readonly d: Float32Array;
  constructor(cu: number, cv: number, seed: number) {
    const p2 = (x: number) => Math.min(1024, Math.max(32, 2 ** Math.ceil(Math.log2(Math.max(1, x * 3)))));
    const nx = (this.nx = p2(cu)), ny = (this.ny = p2(cv));
    const rng = new RNG(seed * 1013 + cu * 7 + cv * 131 + 3);
    const gx = new Float32Array(cu * cv), gy = new Float32Array(cu * cv);
    for (let i = 0; i < cu * cv; i++) {
      const a = rng.next() * Math.PI * 2;
      gx[i] = Math.cos(a);
      gy[i] = Math.sin(a);
    }
    const d = (this.d = new Float32Array(nx * ny));
    const kx = cu / nx, ky = cv / ny;
    for (let y = 0; y < ny; y++) {
      const fy = y * ky, y0 = Math.floor(fy), ty = fy - y0, y1 = (y0 + 1) % cv, sy = quintic(ty);
      for (let x = 0; x < nx; x++) {
        const fx = x * kx, x0 = Math.floor(fx), tx = fx - x0, x1 = (x0 + 1) % cu, sx = quintic(tx);
        const a = y0 * cu + x0, b = y0 * cu + x1, c = y1 * cu + x0, e = y1 * cu + x1;
        const n00 = gx[a] * tx + gy[a] * ty;
        const n10 = gx[b] * (tx - 1) + gy[b] * ty;
        const n01 = gx[c] * tx + gy[c] * (ty - 1);
        const n11 = gx[e] * (tx - 1) + gy[e] * (ty - 1);
        const v = n00 + (n10 - n00) * sx + (n01 - n00) * sy + (n00 - n10 - n01 + n11) * sx * sy;
        d[y * nx + x] = clamp(0.5 + v * 1.05);
      }
    }
  }
  at(u: number, v: number): number {
    const nx = this.nx, ny = this.ny;
    const x = (u - Math.floor(u)) * nx, y = (v - Math.floor(v)) * ny;
    const x0 = x | 0, y0 = y | 0;
    const fx = x - x0, fy = y - y0;
    const x1 = (x0 + 1) & (nx - 1), y1 = (y0 + 1) & (ny - 1);
    const d = this.d;
    const a = d[y0 * nx + x0], b = d[y0 * nx + x1], c = d[y1 * nx + x0], e = d[y1 * nx + x1];
    return a + (b - a) * fx + (c - a) * fy + (a - b - c + e) * fx * fy;
  }
}

const TAB_CACHE = new Map<string, Tab>();
function tab(cu: number, cv: number, seed: number): Tab {
  const key = `${cu}:${cv}:${seed}`;
  let t = TAB_CACHE.get(key);
  if (!t) TAB_CACHE.set(key, (t = new Tab(cu, cv, seed)));
  return t;
}

/**
 * Фрактальный шум (fBm) из таблиц. fu, fv — целые множители числа ячеек по осям (анизотропия:
 * волокна дерева, строчка шлифовки). Бесшовный (период 1) и без видимых повторов внутри плитки.
 */
export class Fbm {
  private tabs: Tab[] = [];
  private amp: number[] = [];
  private ox: number[] = [];
  private oy: number[] = [];
  private norm = 0;
  constructor(public cells0: number, public oct: number, public seed = 0, gain = 0.5, public fu = 1, public fv = 1) {
    let a = 1;
    for (let k = 0; k < oct; k++) {
      this.tabs.push(tab((cells0 * fu) << k, (cells0 * fv) << k, seed * 5 + k));
      this.amp.push(a);
      this.norm += a;
      a *= gain;
      this.ox.push(0.371 * (k + 1) + seed * 0.173);
      this.oy.push(0.613 * (k + 1) + seed * 0.291);
    }
    this.norm = 1 / this.norm;
  }
  /** Значение в 0..1 (в среднем ~0.5). */
  at(u: number, v: number): number {
    let s = 0;
    for (let k = 0; k < this.oct; k++) s += this.amp[k] * this.tabs[k].at(u + this.ox[k], v + this.oy[k]);
    return s * this.norm;
  }
}

/** Бесшовный клеточный шум Вороного: расстояния до ближайшей и второй точки (в долях ячейки) и id ячейки. */
export class Voronoi {
  readonly n: number;
  private f1: Float32Array;
  private f2: Float32Array;
  private id: Float32Array;
  constructor(public cells: number, seed = 0, n = Math.min(512, cells * 8), jitter = 0.9) {
    this.n = n;
    const rng = new RNG(seed * 2713 + cells * 31 + 5);
    const px = new Float32Array(cells * cells), py = new Float32Array(cells * cells);
    for (let i = 0; i < cells * cells; i++) {
      px[i] = 0.5 + (rng.next() - 0.5) * jitter;
      py[i] = 0.5 + (rng.next() - 0.5) * jitter;
    }
    this.f1 = new Float32Array(n * n);
    this.f2 = new Float32Array(n * n);
    this.id = new Float32Array(n * n);
    const k = cells / n;
    for (let y = 0; y < n; y++) {
      const fy = (y + 0.5) * k, cy = Math.floor(fy);
      for (let x = 0; x < n; x++) {
        const fx = (x + 0.5) * k, cx = Math.floor(fx);
        let d1 = 9, d2 = 9, best = 0;
        for (let oy = -1; oy <= 1; oy++) {
          for (let ox = -1; ox <= 1; ox++) {
            const gx = cx + ox, gy = cy + oy;
            const wx = ((gx % cells) + cells) % cells, wy = ((gy % cells) + cells) % cells;
            const q = wy * cells + wx;
            const dx = gx + px[q] - fx, dy = gy + py[q] - fy;
            const dd = Math.sqrt(dx * dx + dy * dy);
            if (dd < d1) { d2 = d1; d1 = dd; best = q; } else if (dd < d2) d2 = dd;
          }
        }
        const i = y * n + x;
        this.f1[i] = d1;
        this.f2[i] = d2;
        this.id[i] = (best * 0.6180339887) % 1;
      }
    }
  }
  private bil(a: Float32Array, u: number, v: number): number {
    const n = this.n;
    const x = (u - Math.floor(u)) * n - 0.5, y = (v - Math.floor(v)) * n - 0.5;
    const xf = Math.floor(x), yf = Math.floor(y);
    const fx = x - xf, fy = y - yf;
    const x0 = xf & (n - 1), y0 = yf & (n - 1), x1 = (xf + 1) & (n - 1), y1 = (yf + 1) & (n - 1);
    const p = a[y0 * n + x0], q = a[y0 * n + x1], r = a[y1 * n + x0], s = a[y1 * n + x1];
    return p + (q - p) * fx + (r - p) * fy + (p - q - r + s) * fx * fy;
  }
  d1(u: number, v: number): number { return this.bil(this.f1, u, v); }
  d2(u: number, v: number): number { return this.bil(this.f2, u, v); }
  /** Расстояние до границы ячеек (0 на границе) — «трещинки» кожи, чешуя. */
  edge(u: number, v: number): number { return this.bil(this.f2, u, v) - this.bil(this.f1, u, v); }
  cell(u: number, v: number): number {
    const n = this.n;
    const x = Math.floor((u - Math.floor(u)) * n), y = Math.floor((v - Math.floor(v)) * n);
    return this.id[(y & (n - 1)) * n + (x & (n - 1))];
  }
}

// ---------- Canvas ----------

export function makeCanvas(w: number, h: number): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
}
export function ctxOf(c: HTMLCanvasElement): CanvasRenderingContext2D {
  return c.getContext('2d', { willReadFrequently: true })!;
}

/** Нарисовать с обёрткой по краям: shape вызывается с (dx, dy) для каждой копии, пересекающей границу. */
export function tiled(w: number, h: number, bbox: [number, number, number, number], draw: (dx: number, dy: number) => void): void {
  const [x0, y0, x1, y1] = bbox;
  const xs = [0];
  const ys = [0];
  if (x0 < 0) xs.push(w);
  if (x1 > w) xs.push(-w);
  if (y0 < 0) ys.push(h);
  if (y1 > h) ys.push(-h);
  for (const dx of xs) for (const dy of ys) draw(dx, dy);
}

// ---------- Поля и размытие ----------

/** Бесшовное размытие поля (два прохода коробчатого фильтра ~ гаусс). */
export function blurField(src: Float32Array, w: number, h: number, r: number): Float32Array {
  if (r <= 0) return src;
  let a = src;
  for (let pass = 0; pass < 2; pass++) {
    const tmp = new Float32Array(w * h);
    const k = 1 / (2 * r + 1);
    for (let y = 0; y < h; y++) {
      let s = 0;
      for (let i = -r; i <= r; i++) s += a[y * w + ((i + w) % w)];
      for (let x = 0; x < w; x++) {
        tmp[y * w + x] = s * k;
        s += a[y * w + ((x + r + 1) % w)] - a[y * w + ((x - r + w) % w)];
      }
    }
    const out = new Float32Array(w * h);
    for (let x = 0; x < w; x++) {
      let s = 0;
      for (let i = -r; i <= r; i++) s += tmp[((i + h) % h) * w + x];
      for (let y = 0; y < h; y++) {
        out[y * w + x] = s * k;
        s += tmp[((y + r + 1) % h) * w + x] - tmp[((y - r + h) % h) * w + x];
      }
    }
    a = out;
  }
  return a;
}

/** Нормали из высоты (Собель, с обёрткой). k — «сила»: наклон на пиксель на единицу высоты. */
export function normalFromHeight(hg: Float32Array, w: number, h: number, k: number): Uint8ClampedArray {
  const out = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) {
    const ym = ((y - 1 + h) % h) * w, y0 = y * w, yp = ((y + 1) % h) * w;
    for (let x = 0; x < w; x++) {
      const xm = (x - 1 + w) % w, xp = (x + 1) % w;
      const tl = hg[ym + xm], t = hg[ym + x], tr = hg[ym + xp];
      const l = hg[y0 + xm], r = hg[y0 + xp];
      const bl = hg[yp + xm], b = hg[yp + x], br = hg[yp + xp];
      const dx = (tr + 2 * r + br - tl - 2 * l - bl) * 0.125 * k;
      const dy = (bl + 2 * b + br - tl - 2 * t - tr) * 0.125 * k;
      // flipY=true: +Y нормали «вверх по изображению»; dy считаем вниз по строкам
      let nx = -dx, ny = dy, nz = 1;
      const inv = 1 / Math.sqrt(nx * nx + ny * ny + nz * nz);
      nx *= inv; ny *= inv; nz *= inv;
      const o = (y * w + x) * 4;
      out[o] = (nx * 0.5 + 0.5) * 255;
      out[o + 1] = (ny * 0.5 + 0.5) * 255;
      out[o + 2] = (nz * 0.5 + 0.5) * 255;
      out[o + 3] = 255;
    }
  }
  return out;
}

// ---------- PBR-набор ----------

export interface PBRMaps {
  map: THREE.CanvasTexture;
  normalMap: THREE.CanvasTexture;
  orm: THREE.CanvasTexture;
  /** Канвасы для отладки/выгрузки. */
  canvases: { map: HTMLCanvasElement; normal: HTMLCanvasElement; orm: HTMLCanvasElement };
}

export interface Px {
  r: number; g: number; b: number;
  h: number;
  rough: number;
  metal: number;
  ao: number;
}

export interface PaintOpts {
  color?: RGB;
  /** Прибавка к высоте (может быть отрицательной) в местах маски. */
  dh?: number;
  /** Подмешать цвет по маске с этой силой (по умолчанию 1). */
  k?: number;
  rough?: number;
  metal?: number;
  ao?: number;
}

export class PBR {
  readonly n: number;
  col: Float32Array;
  hgt: Float32Array;
  rgh: Float32Array;
  met: Float32Array;
  occ: Float32Array;

  constructor(readonly w: number, readonly h: number = w) {
    this.n = w * h;
    this.col = new Float32Array(this.n * 3).fill(0.5);
    this.hgt = new Float32Array(this.n).fill(0.5);
    this.rgh = new Float32Array(this.n).fill(0.7);
    this.met = new Float32Array(this.n);
    this.occ = new Float32Array(this.n).fill(1);
  }

  /** Попиксельный генератор. fn(u, v, px, x, y); px предзаполнен текущими значениями. */
  gen(fn: (u: number, v: number, p: Px, x: number, y: number) => void): this {
    const T0 = performance.now();
    const { w, h, col, hgt, rgh, met, occ } = this;
    const p: Px = { r: 0, g: 0, b: 0, h: 0, rough: 0, metal: 0, ao: 1 };
    for (let y = 0; y < h; y++) {
      const v = (y + 0.5) / h;
      for (let x = 0; x < w; x++) {
        const i = y * w + x;
        p.r = col[i * 3]; p.g = col[i * 3 + 1]; p.b = col[i * 3 + 2];
        p.h = hgt[i]; p.rough = rgh[i]; p.metal = met[i]; p.ao = occ[i];
        fn((x + 0.5) / w, v, p, x, y);
        col[i * 3] = p.r; col[i * 3 + 1] = p.g; col[i * 3 + 2] = p.b;
        hgt[i] = p.h; rgh[i] = p.rough; met[i] = p.metal; occ[i] = p.ao;
      }
    }
    prof('gen', T0);
    return this;
  }

  /** Маска (0..1) из рисунка на canvas: рисуем белым по чёрному. */
  mask(draw: (ctx: CanvasRenderingContext2D, w: number, h: number) => void, blur = 0): Float32Array {
    const T0 = performance.now();
    const c = makeCanvas(this.w, this.h);
    const g = ctxOf(c);
    g.fillStyle = '#000';
    g.fillRect(0, 0, this.w, this.h);
    g.fillStyle = '#fff';
    g.strokeStyle = '#fff';
    draw(g, this.w, this.h);
    const d = g.getImageData(0, 0, this.w, this.h).data;
    let m: Float32Array = new Float32Array(this.n);
    for (let i = 0; i < this.n; i++) m[i] = d[i * 4] / 255;
    if (blur > 0) m = blurField(m, this.w, this.h, blur);
    prof('mask', T0);
    return m;
  }

  /** Композиция по маске: цвет, прибавка к высоте, замена шероховатости/металла/AO. */
  paint(m: Float32Array, o: PaintOpts): this {
    const { col, hgt, rgh, met, occ } = this;
    const k0 = o.k ?? 1;
    for (let i = 0; i < this.n; i++) {
      const k = m[i] * k0;
      if (k <= 0.002) continue;
      if (o.color) {
        col[i * 3] += (o.color[0] - col[i * 3]) * k;
        col[i * 3 + 1] += (o.color[1] - col[i * 3 + 1]) * k;
        col[i * 3 + 2] += (o.color[2] - col[i * 3 + 2]) * k;
      }
      if (o.dh !== undefined) hgt[i] += o.dh * k;
      if (o.rough !== undefined) rgh[i] += (o.rough - rgh[i]) * k;
      if (o.metal !== undefined) met[i] += (o.metal - met[i]) * k;
      if (o.ao !== undefined) occ[i] += (o.ao - occ[i]) * k;
    }
    return this;
  }

  /**
   * «Наклейка» с цветом и альфой (рисуется как есть, например, нарисованный олень):
   * цвет смешивается по альфе, высота меняется на dhAlpha * альфа.
   */
  decal(draw: (ctx: CanvasRenderingContext2D, w: number, h: number) => void, o: { dh?: number; rough?: number; metal?: number; ao?: number; k?: number; alphaMul?: (u: number, v: number) => number } = {}): this {
    const c = makeCanvas(this.w, this.h);
    const g = ctxOf(c);
    draw(g, this.w, this.h);
    const d = g.getImageData(0, 0, this.w, this.h).data;
    const { col, hgt, rgh, met, occ } = this;
    const k0 = o.k ?? 1;
    const W = this.w, H = this.h;
    for (let i = 0; i < this.n; i++) {
      let a = (d[i * 4 + 3] / 255) * k0;
      if (a <= 0.002) continue;
      if (o.alphaMul) a *= o.alphaMul(((i % W) + 0.5) / W, (Math.floor(i / W) + 0.5) / H);
      if (a <= 0.002) continue;
      // canvas отдаёт цвет без предумножения
      col[i * 3] += (d[i * 4] / 255 - col[i * 3]) * a;
      col[i * 3 + 1] += (d[i * 4 + 1] / 255 - col[i * 3 + 1]) * a;
      col[i * 3 + 2] += (d[i * 4 + 2] / 255 - col[i * 3 + 2]) * a;
      if (o.dh !== undefined) hgt[i] += o.dh * a;
      if (o.rough !== undefined) rgh[i] += (o.rough - rgh[i]) * a;
      if (o.metal !== undefined) met[i] += (o.metal - met[i]) * a;
      if (o.ao !== undefined) occ[i] += (o.ao - occ[i]) * a;
    }
    return this;
  }

  /** Размыть высоту (мягче нормали). */
  blurHeight(r: number): this {
    this.hgt = blurField(this.hgt, this.w, this.h, r);
    return this;
  }

  /** Полоса «каверн»: AO из высоты (где ниже окрестности — темнее), с подмешиванием в альбедо. */
  cavity(strength = 1, radius = 3, bakeToAlbedo = 0.5): this {
    const T0 = performance.now();
    const blur = blurField(this.hgt, this.w, this.h, radius);
    const { col, hgt, occ } = this;
    for (let i = 0; i < this.n; i++) {
      const c = clamp(1 - strength * Math.max(0, blur[i] - hgt[i]) * 6, 0.25, 1);
      occ[i] *= c;
      const k = lerp(1, c, bakeToAlbedo);
      col[i * 3] *= k; col[i * 3 + 1] *= k; col[i * 3 + 2] *= k;
    }
    prof('cavity', T0);
    return this;
  }

  /** Сложить в текстуры three. */
  textures(o: { normalStrength?: number; dither?: boolean; repeat?: [number, number] } = {}): PBRMaps {
    const { w, h, n } = this;
    const T0 = performance.now();
    const k = o.normalStrength ?? 4;
    const nrm = normalFromHeight(this.hgt, w, h, k * (w / 512));
    const T1 = prof('normal', T0);
    const cm = makeCanvas(w, h), cn = makeCanvas(w, h), co = makeCanvas(w, h);
    const gm = ctxOf(cm), gn = ctxOf(cn), go = ctxOf(co);
    const im = gm.createImageData(w, h);
    const io = go.createImageData(w, h);
    const rng = new RNG(77);
    for (let i = 0; i < n; i++) {
      const dd = o.dither === false ? 0 : (rng.next() - 0.5) * 0.9;
      im.data[i * 4] = this.col[i * 3] * 255 + dd;
      im.data[i * 4 + 1] = this.col[i * 3 + 1] * 255 + dd;
      im.data[i * 4 + 2] = this.col[i * 3 + 2] * 255 + dd;
      im.data[i * 4 + 3] = 255;
      io.data[i * 4] = this.occ[i] * 255;
      io.data[i * 4 + 1] = this.rgh[i] * 255;
      io.data[i * 4 + 2] = this.met[i] * 255;
      io.data[i * 4 + 3] = 255;
    }
    const T2 = prof('pack', T1);
    gm.putImageData(im, 0, 0);
    go.putImageData(io, 0, 0);
    gn.putImageData(new ImageData(nrm as unknown as Uint8ClampedArray<ArrayBuffer>, w, h), 0, 0);
    prof('putImageData', T2);
    const mk = (c: HTMLCanvasElement, srgb: boolean) => {
      const t = new THREE.CanvasTexture(c);
      t.wrapS = t.wrapT = THREE.RepeatWrapping;
      t.anisotropy = gearQuality.anisotropy;
      t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
      t.generateMipmaps = true;
      t.minFilter = THREE.LinearMipmapLinearFilter;
      t.magFilter = THREE.LinearFilter;
      if (o.repeat) t.repeat.set(o.repeat[0], o.repeat[1]);
      t.needsUpdate = true;
      return t;
    };
    return { map: mk(cm, true), normalMap: mk(cn, false), orm: mk(co, false), canvases: { map: cm, normal: cn, orm: co } };
  }
}

// ---------- Мелочи для рецептов ----------

/** Случайные царапины: тонкие линии в основном вдоль угла angle (рад) с разбросом spread. */
export function scratchMask(p: PBR, count: number, o: { angle?: number; spread?: number; len?: [number, number]; width?: [number, number]; alpha?: [number, number]; seed?: number } = {}): Float32Array {
  const rng = new RNG(o.seed ?? 9);
  const angle = o.angle ?? 0, spread = o.spread ?? Math.PI;
  const [l0, l1] = o.len ?? [0.03, 0.2];
  const [w0, w1] = o.width ?? [0.6, 1.4];
  const [a0, a1] = o.alpha ?? [0.25, 0.9];
  return p.mask((g, W, H) => {
    g.lineCap = 'round';
    for (let i = 0; i < count; i++) {
      const x = rng.next() * W, y = rng.next() * H;
      const a = angle + (rng.next() - 0.5) * spread;
      const L = rng.range(l0, l1) * Math.max(W, H);
      const dx = Math.cos(a) * L, dy = Math.sin(a) * L;
      const bend = (rng.next() - 0.5) * L * 0.12;
      g.globalAlpha = rng.range(a0, a1);
      g.lineWidth = rng.range(w0, w1);
      const bb: [number, number, number, number] = [Math.min(x, x + dx) - 3, Math.min(y, y + dy) - 3, Math.max(x, x + dx) + 3, Math.max(y, y + dy) + 3];
      tiled(W, H, bb, (ox, oy) => {
        g.beginPath();
        g.moveTo(x + ox, y + oy);
        g.quadraticCurveTo(x + ox + dx / 2 - dy * bend / L, y + oy + dy / 2 + dx * bend / L, x + ox + dx, y + oy + dy);
        g.stroke();
      });
    }
    g.globalAlpha = 1;
  });
}

/** Пятна/кляксы: count точек радиуса из диапазона r (в пикселях при w=1024, масштабируется). */
export function blotchMask(p: PBR, count: number, r: [number, number], o: { seed?: number; soft?: number; alpha?: [number, number] } = {}): Float32Array {
  const rng = new RNG(o.seed ?? 5);
  const s = p.w / 1024;
  const [a0, a1] = o.alpha ?? [0.4, 1];
  return p.mask((g, W, H) => {
    for (let i = 0; i < count; i++) {
      const x = rng.next() * W, y = rng.next() * H;
      const rr = rng.range(r[0], r[1]) * s;
      const sx = rng.range(0.6, 1.4);
      tiled(W, H, [x - rr * 1.4, y - rr * 1.4, x + rr * 1.4, y + rr * 1.4], (ox, oy) => {
        const gr = g.createRadialGradient(x + ox, y + oy, 0, x + ox, y + oy, rr);
        const a = rng.range(a0, a1);
        gr.addColorStop(0, `rgba(255,255,255,${a})`);
        gr.addColorStop(clamp(o.soft ?? 0.55, 0.05, 0.95), `rgba(255,255,255,${a * 0.5})`);
        gr.addColorStop(1, 'rgba(255,255,255,0)');
        g.save();
        g.translate(x + ox, y + oy);
        g.scale(sx, 1 / sx);
        g.translate(-(x + ox), -(y + oy));
        g.fillStyle = gr;
        g.beginPath();
        g.arc(x + ox, y + oy, rr, 0, Math.PI * 2);
        g.fill();
        g.restore();
      });
    }
  });
}

/** Отладка: развернуть три карты в один canvas (для просмотра в демо). */
export function previewCanvas(m: PBRMaps, size = 256): HTMLCanvasElement {
  const c = makeCanvas(size * 3, size);
  const g = ctxOf(c);
  g.drawImage(m.canvases.map, 0, 0, size, size);
  g.drawImage(m.canvases.normal, size, 0, size, size);
  g.drawImage(m.canvases.orm, size * 2, 0, size, size);
  return c;
}
