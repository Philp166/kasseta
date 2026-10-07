// CPU-шум для рельефа и размещения: градиентный шум Перлина с таблицей перестановок (от сида),
// fbm, ridged, а также пространственная хеш-сетка для проверки дистанций между объектами.

import { RNG } from '../../core/util';

export class Noise2 {
  private perm = new Uint8Array(512);
  private gx = new Float32Array(256);
  private gy = new Float32Array(256);

  constructor(seed = 1) {
    const rng = new RNG(seed * 7919 + 13);
    const p = new Uint8Array(256);
    for (let i = 0; i < 256; i++) p[i] = i;
    for (let i = 255; i > 0; i--) {
      const j = Math.floor(rng.next() * (i + 1));
      const t = p[i]; p[i] = p[j]; p[j] = t;
    }
    for (let i = 0; i < 512; i++) this.perm[i] = p[i & 255];
    for (let i = 0; i < 256; i++) {
      const a = rng.next() * Math.PI * 2;
      this.gx[i] = Math.cos(a);
      this.gy[i] = Math.sin(a);
    }
  }

  /** Шум примерно в диапазоне [-1, 1]. */
  noise(x: number, y: number): number {
    const xi = Math.floor(x), yi = Math.floor(y);
    const xf = x - xi, yf = y - yi;
    const X = xi & 255, Y = yi & 255;
    const u = xf * xf * xf * (xf * (xf * 6 - 15) + 10);
    const v = yf * yf * yf * (yf * (yf * 6 - 15) + 10);
    const P = this.perm;
    const a = P[P[X] + Y], b = P[P[X + 1] + Y], c = P[P[X] + Y + 1], d = P[P[X + 1] + Y + 1];
    const n00 = this.gx[a] * xf + this.gy[a] * yf;
    const n10 = this.gx[b] * (xf - 1) + this.gy[b] * yf;
    const n01 = this.gx[c] * xf + this.gy[c] * (yf - 1);
    const n11 = this.gx[d] * (xf - 1) + this.gy[d] * (yf - 1);
    const x0 = n00 + u * (n10 - n00), x1 = n01 + u * (n11 - n01);
    return (x0 + v * (x1 - x0)) * 1.41;
  }

  /** fbm, нормированный к ~[-1, 1]. */
  fbm(x: number, y: number, oct = 4, lac = 2, gain = 0.5): number {
    let amp = 1, f = 1, sum = 0, norm = 0;
    for (let i = 0; i < oct; i++) {
      sum += amp * this.noise(x * f + i * 31.7, y * f - i * 17.3);
      norm += amp;
      amp *= gain;
      f *= lac;
    }
    return sum / norm;
  }

  /** Ridged-шум [0, 1]: острые гребни. */
  ridged(x: number, y: number, oct = 4): number {
    let amp = 0.5, f = 1, sum = 0, norm = 0, w = 1;
    for (let i = 0; i < oct; i++) {
      let n = 1 - Math.abs(this.noise(x * f + i * 11.1, y * f + i * 5.7));
      n *= n;
      n *= w;
      w = Math.min(1, Math.max(0, n * 1.6));
      sum += amp * n;
      norm += amp;
      amp *= 0.5;
      f *= 2.03;
    }
    return sum / norm;
  }
}

/** Хеш-сетка точек: быстрый запрос «есть ли рядом объект ближе d». */
export class PointGrid {
  private cells = new Map<number, number[]>();
  readonly xs: number[] = [];
  readonly zs: number[] = [];
  readonly rs: number[] = [];
  constructor(private cell = 4) {}

  private key(ix: number, iz: number) {
    return (ix + 4096) * 8192 + (iz + 4096);
  }

  add(x: number, z: number, r = 0): number {
    const id = this.xs.length;
    this.xs.push(x); this.zs.push(z); this.rs.push(r);
    const k = this.key(Math.floor(x / this.cell), Math.floor(z / this.cell));
    let arr = this.cells.get(k);
    if (!arr) this.cells.set(k, (arr = []));
    arr.push(id);
    return id;
  }

  /** true, если в точке (x,z) с радиусом r есть пересечение с уже добавленными (с зазором gap). */
  hits(x: number, z: number, r: number, gap = 0): boolean {
    const reach = Math.ceil((r + 6 + gap) / this.cell);
    const cx = Math.floor(x / this.cell), cz = Math.floor(z / this.cell);
    for (let i = -reach; i <= reach; i++) {
      for (let j = -reach; j <= reach; j++) {
        const arr = this.cells.get(this.key(cx + i, cz + j));
        if (!arr) continue;
        for (const id of arr) {
          const dx = this.xs[id] - x, dz = this.zs[id] - z;
          const rr = this.rs[id] + r + gap;
          if (dx * dx + dz * dz < rr * rr) return true;
        }
      }
    }
    return false;
  }

  /** Ближайшее расстояние до края ближайшего объекта (в пределах range), иначе range. */
  nearest(x: number, z: number, range = 8): number {
    const reach = Math.ceil(range / this.cell);
    const cx = Math.floor(x / this.cell), cz = Math.floor(z / this.cell);
    let best = range;
    for (let i = -reach; i <= reach; i++) {
      for (let j = -reach; j <= reach; j++) {
        const arr = this.cells.get(this.key(cx + i, cz + j));
        if (!arr) continue;
        for (const id of arr) {
          const d = Math.hypot(this.xs[id] - x, this.zs[id] - z) - this.rs[id];
          if (d < best) best = d;
        }
      }
    }
    return best;
  }
}

export const sstep = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};
export const mix = (a: number, b: number, t: number) => a + (b - a) * t;
export const clamp01 = (x: number) => (x < 0 ? 0 : x > 1 ? 1 : x);
