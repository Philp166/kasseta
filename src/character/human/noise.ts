// Быстрый шум для процедурных текстур: 3D-шум Перлина (fbm) и 2D-хеш-шум. Детерминированный по seed.

export class Perlin3 {
  private p = new Uint8Array(512);
  constructor(seed = 1) {
    const perm = new Uint8Array(256);
    for (let i = 0; i < 256; i++) perm[i] = i;
    let s = (seed * 2654435761) >>> 0;
    const rnd = () => { s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0; return s / 4294967296; };
    for (let i = 255; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); const t = perm[i]; perm[i] = perm[j]; perm[j] = t; }
    for (let i = 0; i < 512; i++) this.p[i] = perm[i & 255];
  }
  private static fade(t: number): number { return t * t * t * (t * (t * 6 - 15) + 10); }
  private static grad(h: number, x: number, y: number, z: number): number {
    const u = (h & 15) < 8 ? x : y;
    const v = (h & 15) < 4 ? y : (h & 15) === 12 || (h & 15) === 14 ? x : z;
    return ((h & 1) === 0 ? u : -u) + ((h & 2) === 0 ? v : -v);
  }
  /** Шум в диапазоне ≈ [-1, 1]. */
  noise(x: number, y: number, z: number): number {
    const p = this.p;
    const X = Math.floor(x) & 255, Y = Math.floor(y) & 255, Z = Math.floor(z) & 255;
    x -= Math.floor(x); y -= Math.floor(y); z -= Math.floor(z);
    const u = Perlin3.fade(x), v = Perlin3.fade(y), w = Perlin3.fade(z);
    const A = p[X] + Y, AA = p[A] + Z, AB = p[A + 1] + Z, B = p[X + 1] + Y, BA = p[B] + Z, BB = p[B + 1] + Z;
    const g = Perlin3.grad;
    const l = (a: number, b: number, t: number) => a + t * (b - a);
    return l(
      l(l(g(p[AA], x, y, z), g(p[BA], x - 1, y, z), u), l(g(p[AB], x, y - 1, z), g(p[BB], x - 1, y - 1, z), u), v),
      l(l(g(p[AA + 1], x, y, z - 1), g(p[BA + 1], x - 1, y, z - 1), u), l(g(p[AB + 1], x, y - 1, z - 1), g(p[BB + 1], x - 1, y - 1, z - 1), u), v),
      w,
    );
  }
  /** fbm в [0, 1]. */
  fbm(x: number, y: number, z: number, oct = 4, lac = 2.03, gain = 0.5): number {
    let a = 1, f = 1, s = 0, n = 0;
    for (let i = 0; i < oct; i++) { s += a * this.noise(x * f, y * f, z * f); n += a; a *= gain; f *= lac; }
    return 0.5 + 0.5 * (s / n);
  }
}

/** Целочисленный хеш → [0, 1). */
export function hash2(ix: number, iy: number, seed = 0): number {
  let h = (ix * 374761393 + iy * 668265263 + seed * 1442695041) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

/** 2D value-noise с плавной интерполяцией, [0, 1]. */
export function vnoise2(x: number, y: number, seed = 0): number {
  const ix = Math.floor(x), iy = Math.floor(y);
  const fx = x - ix, fy = y - iy;
  const u = fx * fx * (3 - 2 * fx), v = fy * fy * (3 - 2 * fy);
  const a = hash2(ix, iy, seed), b = hash2(ix + 1, iy, seed), c = hash2(ix, iy + 1, seed), d = hash2(ix + 1, iy + 1, seed);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}

export const sstep = (a: number, b: number, x: number): number => {
  const t = x <= a ? 0 : x >= b ? 1 : (x - a) / (b - a);
  return t * t * (3 - 2 * t);
};
export const clamp01 = (x: number): number => (x < 0 ? 0 : x > 1 ? 1 : x);
export const mix = (a: number, b: number, t: number): number => a + (b - a) * t;
export const gauss = (d2: number, sigma: number): number => Math.exp(-d2 / (2 * sigma * sigma));

/** Расстояние от точки до отрезка (2D). */
export function segDist(px: number, py: number, ax: number, ay: number, bx: number, by: number): { d: number; t: number } {
  const dx = bx - ax, dy = by - ay;
  const l2 = dx * dx + dy * dy;
  let t = l2 > 0 ? ((px - ax) * dx + (py - ay) * dy) / l2 : 0;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  const x = ax + dx * t - px, y = ay + dy * t - py;
  return { d: Math.sqrt(x * x + y * y), t };
}

/** Расстояние до ломаной и параметр вдоль неё (0..1 по длине). */
export function polyDist(px: number, py: number, pts: number[][], cum?: number[]): { d: number; s: number } {
  let best = Infinity, bs = 0;
  let total = 0;
  const lens: number[] = [];
  if (cum) total = cum[cum.length - 1];
  else { for (let i = 0; i < pts.length - 1; i++) { const l = Math.hypot(pts[i + 1][0] - pts[i][0], pts[i + 1][1] - pts[i][1]); lens.push(l); total += l; } }
  let acc = 0;
  for (let i = 0; i < pts.length - 1; i++) {
    const r = segDist(px, py, pts[i][0], pts[i][1], pts[i + 1][0], pts[i + 1][1]);
    const l = cum ? cum[i + 1] - cum[i] : lens[i];
    if (r.d < best) { best = r.d; bs = (acc + r.t * l) / (total || 1); }
    acc += l;
  }
  return { d: best, s: bs };
}
