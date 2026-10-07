// Библиотека PBR-материалов снаряжения. Все текстуры — процедурные (texkit), материалы кэшируются.
// MeshStandardMaterial: map (альбедо) + normalMap + ORM (R=AO, G=roughness, B=metalness → aoMap/roughnessMap/metalnessMap).
// Тайлинг: дерево — u один раз вокруг (≈0.1 м), v = 0.5 м на повтор; остальное — плитка 0.25 м (кость/латунь/кожа/сталь).

import * as THREE from 'three';
import { RNG, clamp } from '../../core/util';
import {
  PBR, PBRMaps, Fbm, Voronoi, RGB, hex, mixRGB, sstep, texSize, scratchMask, blotchMask, tiled,
} from './texkit';
import { paintOrnament } from './ornament';

// ---------- Размеры плиток (метров на единицу UV) ----------

export const TILE = {
  /** Дерево: u вокруг (≈0.1 м окружности), v = 0.5 м. */
  woodU: 0.1,
  woodV: 0.5,
  /** Универсальная квадратная плитка. */
  std: 0.25,
  leather: 0.2,
  cord: 0.12,
};

const CACHE = new Map<string, THREE.MeshStandardMaterial>();
const TEX_CACHE = new Map<string, PBRMaps>();

export function clearGearCache(): void {
  for (const m of CACHE.values()) m.dispose();
  for (const t of TEX_CACHE.values()) { t.map.dispose(); t.normalMap.dispose(); t.orm.dispose(); }
  CACHE.clear();
  TEX_CACHE.clear();
}

export function matFromMaps(t: PBRMaps, o: { normalScale?: number; metal?: boolean; aoIntensity?: number; side?: THREE.Side; vertexColors?: boolean; color?: number; envMapIntensity?: number } = {}): THREE.MeshStandardMaterial {
  const m = new THREE.MeshStandardMaterial({
    map: t.map,
    normalMap: t.normalMap,
    normalScale: new THREE.Vector2(o.normalScale ?? 1, o.normalScale ?? 1),
    roughnessMap: t.orm,
    metalnessMap: t.orm,
    aoMap: t.orm,
    aoMapIntensity: o.aoIntensity ?? 1,
    roughness: 1,
    metalness: 1,
    side: o.side ?? THREE.FrontSide,
    vertexColors: o.vertexColors ?? false,
    color: o.color ?? 0xffffff,
    envMapIntensity: o.envMapIntensity ?? 1,
  });
  return m;
}

function cached(key: string, make: () => THREE.MeshStandardMaterial): THREE.MeshStandardMaterial {
  let m = CACHE.get(key);
  if (!m) { m = make(); m.name = key; CACHE.set(key, m); }
  return m;
}
function cachedTex(key: string, make: () => PBRMaps): PBRMaps {
  let t = TEX_CACHE.get(key);
  if (!t) TEX_CACHE.set(key, (t = make()));
  return t;
}

// ============================================================
// ДЕРЕВО
// ============================================================

export interface WoodOpts {
  base: number; dark: number; light: number;
  rings?: number;      // годичные кольца поперёк u
  rough?: number;
  pore?: number;       // плотность пор 0..1
  scratches?: number;
  stain?: number;      // тёмные пятна/копоть
  polish?: number;     // участки «заглаженности» руками
  grey?: number;       // серый налёт старения 0..1
  seed?: number;
  size?: [number, number];
  knots?: number;
}

export function makeWoodTex(o: WoodOpts): PBRMaps {
  return woodPBR(o).textures({ normalStrength: 3.2 });
}

/** Дерево до упаковки в текстуры — чтобы нанести резьбу/узор поверх. */
export function woodPBR(o: WoodOpts): PBR {
  const [w, h] = o.size ?? [texSize(512), texSize(1024)];
  const seed = o.seed ?? 1;
  const t = new PBR(w, h);
  const base = hex(o.base), dark = hex(o.dark), light = hex(o.light);
  const warpF = new Fbm(2, 3, seed, 0.55);
  const lowF = new Fbm(2, 4, seed + 3, 0.5, 1, 2);
  const grainF = new Fbm(2, 4, seed + 1, 0.62, 28, 1);
  const fineF = new Fbm(2, 3, seed + 2, 0.6, 60, 2);
  const poreF = new Fbm(2, 2, seed + 5, 0.5, 100, 12);
  const stainF = new Fbm(2, 4, seed + 7, 0.55);
  const ringN = o.rings ?? 14;
  const poreK = o.pore ?? 0.5;
  const rough0 = o.rough ?? 0.62;
  const knots: Array<[number, number, number]> = [];
  const rk = new RNG(seed * 31 + 7);
  for (let i = 0; i < (o.knots ?? 0); i++) knots.push([rk.next(), rk.next(), rk.range(0.035, 0.06)]);
  t.gen((u, v, p) => {
    const wp = warpF.at(u, v * 0.7);
    const low = lowF.at(u + 0.31, v);
    // годичные кольца: волнистые полосы вдоль v
    let rr = u * ringN + (wp - 0.5) * 1.6 + (low - 0.5) * 0.7;
    let kn = 0;
    for (const k of knots) {
      let du = u - k[0], dv = (v - k[1]) * 0.45;
      du -= Math.round(du); dv -= Math.round(dv);
      const d = Math.hypot(du, dv);
      const infl = Math.exp(-(d * d) / (k[2] * k[2]));
      rr += infl * 2.4 * (1 - d / (k[2] * 3));
      kn = Math.max(kn, Math.exp(-(d * d) / (k[2] * k[2] * 0.12)));
    }
    const ring = 0.5 + 0.5 * Math.sin(rr * Math.PI * 2);
    const late = sstep(0.5, 0.97, ring);
    const g = grainF.at(u, v);
    const f = fineF.at(u, v);
    const pr = poreF.at(u, v);
    const pore = sstep(0.68 - poreK * 0.1, 0.84, pr) * (0.3 + 0.7 * (1 - late));
    // цвет: светлые ранние и тёмные поздние слои, поверх — тонкие волокна и плавная пятнистость
    let c = mixRGB(light, base, 0.45 + 0.25 * late + 0.55 * (g - 0.5));
    c = mixRGB(c, dark, clamp(late * 0.3 + (0.5 - f) * 0.9 + (0.5 - g) * 0.4, 0, 1) * 0.6);
    const tone = 0.86 + 0.28 * (low - 0.5) * 2 * 0.5 + 0.16 * (f - 0.5);
    p.r = c[0] * tone * (1 - pore * 0.4);
    p.g = c[1] * tone * (1 - pore * 0.42);
    p.b = c[2] * tone * (1 - pore * 0.4);
    if (kn > 0.02) { p.r *= 1 - kn * 0.55; p.g *= 1 - kn * 0.55; p.b *= 1 - kn * 0.5; }
    p.h = 0.5 + 0.16 * (g - 0.5) + 0.12 * (f - 0.5) + 0.05 * (ring - 0.5) - 0.3 * pore - kn * 0.04;
    p.rough = rough0 + 0.16 * (0.5 - g) + pore * 0.14 + late * 0.05;
    p.metal = 0;
    p.ao = 1 - pore * 0.55;
  });
  // старение: сероватый налёт, пятна, царапины, заглаженные руками участки
  if (o.stain) {
    t.gen((u, v, p) => {
      const s = sstep(0.5, 0.78, stainF.at(u, v)) * o.stain!;
      p.r *= 1 - 0.5 * s; p.g *= 1 - 0.55 * s; p.b *= 1 - 0.5 * s;
      p.rough += 0.1 * s;
    });
  }
  if (o.grey) {
    const gf = new Fbm(3, 4, seed + 11, 0.55, 1, 3);
    t.gen((u, v, p) => {
      const s = sstep(0.45, 0.8, gf.at(u, v)) * o.grey!;
      const l = (p.r + p.g + p.b) / 3;
      p.r += (l * 1.05 - p.r) * s * 0.7; p.g += (l * 1.02 - p.g) * s * 0.7; p.b += (l * 1.0 - p.b) * s * 0.7;
      p.rough += 0.12 * s;
    });
  }
  if (o.polish) {
    const pf = new Fbm(2, 3, seed + 13, 0.5, 1, 2);
    t.gen((u, v, p) => {
      const s = sstep(0.5, 0.75, pf.at(u, v)) * o.polish!;
      p.rough -= 0.2 * s;
      p.r *= 1 + 0.08 * s; p.g *= 1 + 0.07 * s; p.b *= 1 + 0.05 * s;
      p.h += (0.5 - p.h) * 0.4 * s;
    });
  }
  const sc = scratchMask(t, Math.round((o.scratches ?? 90) * (w * h) / (512 * 1024)), { angle: Math.PI / 2, spread: 0.9, len: [0.02, 0.12], width: [0.5, 1.1], alpha: [0.2, 0.7], seed: seed + 21 });
  t.paint(sc, { color: mixRGB(light, [1, 1, 1], 0.15), dh: -0.1, k: 0.55, rough: 0.5 });
  const dents = blotchMask(t, Math.round(14 * (w * h) / (512 * 1024)), [4, 10], { seed: seed + 22, alpha: [0.5, 1] });
  t.paint(dents, { dh: -0.12, k: 0.8, color: mixRGB(dark, base, 0.3) });
  t.cavity(0.7, 2, 0.4);
  return t;
}

const WOODS: Record<string, WoodOpts> = {
  // тёмное мореное древко копья
  shaft: { base: 0x4d3322, dark: 0x25170e, light: 0x6b4a31, rings: 5, rough: 0.58, pore: 0.6, scratches: 150, stain: 0.5, polish: 0.8, grey: 0.25, seed: 3, knots: 1 },
  // лук: янтарный лак, потёртый
  bow: { base: 0x8a5a33, dark: 0x4a2c16, light: 0xb27c47, rings: 4, rough: 0.46, pore: 0.35, scratches: 70, stain: 0.2, polish: 1.0, grey: 0.1, seed: 8 },
  // светлый ясень: древки стрел, топорища, копья налётчиков
  ash: { base: 0xa88358, dark: 0x6b4c2c, light: 0xcfae7c, rings: 7, rough: 0.6, pore: 0.7, scratches: 120, stain: 0.3, polish: 0.7, grey: 0.35, seed: 12 },
  // рукояти, резное дерево
  handle: { base: 0x5e3b25, dark: 0x2d1a10, light: 0x8a5c3a, rings: 6, rough: 0.5, pore: 0.4, scratches: 80, stain: 0.35, polish: 1.0, grey: 0.15, seed: 15 },
  // доски щита
  plank: { base: 0x8b6a45, dark: 0x4f3a24, light: 0xb89566, rings: 5, rough: 0.74, pore: 0.7, scratches: 200, stain: 0.5, polish: 0.2, grey: 0.45, seed: 19, knots: 2 },
};

export function woodTex(kind: string): PBRMaps {
  return cachedTex('wood:' + kind, () => makeWoodTex(WOODS[kind] ?? WOODS.shaft));
}
export function woodMat(kind: keyof typeof WOODS | string = 'shaft'): THREE.MeshStandardMaterial {
  return cached('wood:' + kind, () => matFromMaps(woodTex(kind), { normalScale: 1 }));
}

// Резное дерево: квадратная плитка 0.104 м × 0.104 м (u — вокруг древка), 4 ряда по 0.026 м: ромбы / зигзаг / треугольники / жгут.
export const CARVED_ROWS = { diamonds: 0, zigzag: 1, triangles: 2, knot: 3 } as const;
export function carvedWoodTex(kind: string = 'shaft'): PBRMaps {
  return cachedTex('carved:' + kind, () => {
    const n = texSize(512);
    const t = woodPBR({ ...(WOODS[kind] ?? WOODS.shaft), size: [n, n], seed: (WOODS[kind]?.seed ?? 3) + 40, scratches: 60, knots: 0 });
    const rows: Array<['diamonds' | 'zigzag' | 'triangles' | 'knot', number]> = [['diamonds', 3], ['zigzag', 6], ['triangles', 6], ['knot', 4]];
    rows.forEach(([style, rep], i) => {
      // светлая кромка-«фаска» и тёмные канавки: два прохода — тёмный контур и светлый внутри
      paintOrnament(t, { x: 0, y: (i * n) / 4, w: n, h: n / 4 }, style, { relief: 'carved', repeat: rep, accent: 0x120a05, wear: 0.25, depth: -0.5, seed: 5 + i, weight: 1.15 });
    });
    t.blurHeight(1);
    t.cavity(0.9, 2, 0.35);
    return t.textures({ normalStrength: 4.2 });
  });
}
export function carvedWoodMat(kind: string = 'shaft'): THREE.MeshStandardMaterial {
  return cached('carved:' + kind, () => matFromMaps(carvedWoodTex(kind), { normalScale: 1 }));
}

// ============================================================
// КОЖА
// ============================================================

export interface LeatherOpts {
  base: number; dark: number; wear: number;
  grain?: number;     // ячеек зерна на плитку (по умолч. 96)
  wrinkle?: number;   // выраженность складок 0..1
  rough?: number;
  stain?: number;
  scuff?: number;     // потёртости до светлой основы
  seed?: number;
  size?: number;
  burnish?: number;   // жирный блеск на выступах
}

/** Кожа до упаковки в текстуры — чтобы нанести тиснение/рисунок поверх (колчан, ножны, сумка). */
export function leatherPBR(o: LeatherOpts): PBR {
  const S = o.size ?? texSize(512);
  const seed = o.seed ?? 1;
  const t = new PBR(S, S);
  const base = hex(o.base), dark = hex(o.dark), wear = hex(o.wear);
  const vor = new Voronoi(o.grain ?? 64, seed, 512);
  const vor2 = new Voronoi(Math.round((o.grain ?? 64) * 0.4), seed + 4, 256);
  const fold = new Fbm(3, 4, seed + 1, 0.55, 2, 1);
  const fold2 = new Fbm(5, 3, seed + 2, 0.5, 1, 3);
  const lowF = new Fbm(2, 4, seed + 3, 0.55);
  const mottle = new Fbm(6, 3, seed + 4, 0.6);
  const wearF = new Fbm(3, 4, seed + 5, 0.6);
  const wr = o.wrinkle ?? 0.6;
  const rough0 = o.rough ?? 0.6;
  const burnish = o.burnish ?? 0.5;
  t.gen((u, v, p) => {
    const e = vor.edge(u, v);
    const pebble = sstep(0.02, 0.3, e);
    const pb2 = sstep(0.0, 0.25, vor2.edge(u + 0.2, v + 0.1));
    // складки: «хребты» шума в двух направлениях
    const f1 = 1 - Math.abs(2 * fold.at(u, v) - 1);
    const f2 = 1 - Math.abs(2 * fold2.at(u + 0.4, v) - 1);
    const creases = Math.pow(f1, 5) * 0.8 + Math.pow(f2, 6) * 0.6;
    const low = lowF.at(u, v);
    const mot = mottle.at(u, v);
    p.h = 0.5 + 0.2 * (pebble - 0.5) + 0.08 * (pb2 - 0.5) - wr * 0.34 * creases + 0.08 * (low - 0.5);
    let c = mixRGB(dark, base, clamp(0.35 + 0.55 * pebble + (mot - 0.5) * 0.7 + (low - 0.5) * 0.4, 0, 1));
    // потёртости: светлые выступы
    const wv = sstep(0.55, 0.78, wearF.at(u, v)) * (o.scuff ?? 0.6) * (0.4 + 0.6 * pebble);
    c = mixRGB(c, wear, wv * 0.7);
    // тёмные трещинки между «зёрнами» и в складках
    const crack = (1 - pebble) * 0.55 + creases * wr * 0.5;
    c = mixRGB(c, scaleDark(dark), crack * 0.65);
    p.r = c[0]; p.g = c[1]; p.b = c[2];
    p.rough = rough0 + 0.18 * crack - burnish * 0.2 * pebble * sstep(0.4, 0.7, mot) - wv * 0.12;
    p.metal = 0;
    p.ao = 1 - 0.55 * crack;
  });
  if (o.stain) {
    const stf = new Fbm(2, 4, seed + 9, 0.55, 1, 1);
    t.gen((u, v, p) => {
      const s = sstep(0.5, 0.76, stf.at(u, v)) * o.stain!;
      p.r *= 1 - 0.55 * s; p.g *= 1 - 0.6 * s; p.b *= 1 - 0.55 * s; p.rough += 0.08 * s;
    });
  }
  const sc = scratchMask(t, Math.round(60 * (S * S) / (512 * 512)), { len: [0.02, 0.1], width: [0.5, 1.2], alpha: [0.15, 0.55], seed: seed + 20 });
  t.paint(sc, { color: mixRGB(wear, [1, 1, 1], 0.1), dh: -0.08, k: 0.5, rough: 0.5 });
  t.cavity(0.9, 2, 0.5);
  return t;
}
export function makeLeatherTex(o: LeatherOpts): PBRMaps {
  return leatherPBR(o).textures({ normalStrength: 3.6 });
}
const scaleDark = (c: RGB): RGB => [c[0] * 0.6, c[1] * 0.6, c[2] * 0.6];

export const LEATHERS: Record<string, LeatherOpts> = {
  dark: { base: 0x4a2e1c, dark: 0x1e120a, wear: 0x8b6542, grain: 64, wrinkle: 0.7, rough: 0.62, stain: 0.5, scuff: 0.7, seed: 2 },
  tan: { base: 0x8a5a36, dark: 0x3d2414, wear: 0xc89a66, grain: 72, wrinkle: 0.45, rough: 0.58, stain: 0.35, scuff: 0.6, seed: 4 },
  red: { base: 0x6e3220, dark: 0x2a120a, wear: 0xa8653f, grain: 64, wrinkle: 0.55, rough: 0.6, stain: 0.4, scuff: 0.7, seed: 6 },
  black: { base: 0x2a1c14, dark: 0x0e0806, wear: 0x5c4531, grain: 72, wrinkle: 0.6, rough: 0.55, stain: 0.3, scuff: 0.7, seed: 7, burnish: 0.8 },
  rawhide: { base: 0xa88a62, dark: 0x5a4328, wear: 0xd5bd92, grain: 40, wrinkle: 0.4, rough: 0.7, stain: 0.5, scuff: 0.4, seed: 10 },
};

export function leatherTex(kind: string): PBRMaps {
  return cachedTex('leather:' + kind, () => makeLeatherTex(LEATHERS[kind] ?? LEATHERS.dark));
}
export function leatherMat(kind: keyof typeof LEATHERS | string = 'dark', o: { vertexColors?: boolean; side?: THREE.Side } = {}): THREE.MeshStandardMaterial {
  return cached(`leather:${kind}:${o.vertexColors ? 'vc' : ''}:${o.side ?? 0}`, () => matFromMaps(leatherTex(kind), { normalScale: 1, vertexColors: o.vertexColors, side: o.side }));
}

// Кожаная обмотка спиралью (u — вокруг, v — вдоль; один виток на 1/turns плитки 0.12 м).
export interface WrapOpts { base: number; dark: number; wear: number; turns?: number; seed?: number; size?: number; lace?: number }
export function makeWrapTex(o: WrapOpts): PBRMaps {
  const S = o.size ?? texSize(512);
  const seed = o.seed ?? 1;
  const t = new PBR(S, S);
  const base = hex(o.base), dark = hex(o.dark), wear = hex(o.wear);
  const vor = new Voronoi(48, seed, 256);
  const mot = new Fbm(5, 4, seed + 1, 0.6);
  const wearF = new Fbm(3, 4, seed + 2, 0.6, 1, 2);
  const low = new Fbm(2, 3, seed + 3, 0.5);
  const turns = o.turns ?? 8;
  t.gen((u, v, p) => {
    const ph = u + v * turns;
    const fr = ph - Math.floor(ph);
    // профиль витка: плавный подъём, обрыв (край ремешка)
    const ramp = Math.pow(fr, 0.7);
    const edge = sstep(0.0, 0.07, fr) * (1 - sstep(0.93, 1.0, fr) * 0.0);
    const lip = 1 - sstep(0.0, 0.12, fr); // тень у нахлёста
    const e = vor.edge(u * 2, v * 2);
    const peb = sstep(0.02, 0.28, e);
    const m = mot.at(u, v), wv = sstep(0.55, 0.8, wearF.at(u, v)), lw = low.at(u, v);
    let c = mixRGB(dark, base, clamp01(0.4 + 0.5 * ramp + (m - 0.5) * 0.7 + (lw - 0.5) * 0.3 + 0.12 * peb));
    c = mixRGB(c, wear, wv * 0.55 * (0.4 + 0.6 * ramp));
    c = mixRGB(c, dark, lip * 0.7);
    p.r = c[0]; p.g = c[1]; p.b = c[2];
    p.h = 0.25 + 0.5 * ramp * edge - 0.2 * lip + 0.1 * (peb - 0.5);
    p.rough = 0.62 + 0.16 * lip - wv * 0.15 - 0.08 * ramp;
    p.metal = 0;
    p.ao = 1 - 0.65 * lip;
  });
  // тонкий шнур-перетяжка по спирали (светлая жила)
  if (o.lace) {
    const lc = hex(0xb79c6a);
    t.gen((u, v, p) => {
      const ph = u + v * turns * 0.5 + 0.5;
      const fr = Math.abs(ph - Math.floor(ph) - 0.5);
      const lacing = 1 - sstep(0.02, 0.05, fr);
      if (lacing <= 0) return;
      p.r += (lc[0] * 0.8 - p.r) * lacing; p.g += (lc[1] * 0.8 - p.g) * lacing; p.b += (lc[2] * 0.8 - p.b) * lacing;
      p.h += 0.2 * lacing;
    });
  }
  t.cavity(0.8, 2, 0.4);
  return t.textures({ normalStrength: 3.8 });
}
const WRAPS: Record<string, WrapOpts> = {
  dark: { base: 0x4d3120, dark: 0x1b0f08, wear: 0x8a6240, turns: 8, seed: 3 },
  tan: { base: 0x8a6038, dark: 0x3a2412, wear: 0xc09462, turns: 7, seed: 5, lace: 1 },
};
export function wrapTex(kind: string): PBRMaps {
  return cachedTex('wrap:' + kind, () => makeWrapTex(WRAPS[kind] ?? WRAPS.dark));
}
export function wrapMat(kind: keyof typeof WRAPS | string = 'dark'): THREE.MeshStandardMaterial {
  return cached('wrap:' + kind, () => matFromMaps(wrapTex(kind), { normalScale: 1 }));
}
const clamp01 = (x: number) => (x < 0 ? 0 : x > 1 ? 1 : x);

// ============================================================
// СТАЛЬ / ЖЕЛЕЗО
// ============================================================

export interface SteelOpts {
  dark: number; bright: number; rust: number;
  rustAmt?: number;   // 0..1
  brush?: number;     // выраженность строчки шлифовки
  hammer?: number;    // вмятины ковки
  rough?: number;
  scratches?: number;
  pits?: number;
  seed?: number;
  size?: number | [number, number];
  /** Угол строчки шлифовки: 0 — вдоль v. */
  etch?: number;      // «дамасский» узор 0..1
  scale?: number;     // 1 — как есть; >1 крупнее детали
}

export function makeSteelTex(o: SteelOpts): PBRMaps {
  const sz = o.size ?? texSize(1024);
  const [w, h] = Array.isArray(sz) ? sz : [sz, sz];
  const seed = o.seed ?? 1;
  const t = new PBR(w, h);
  const dark = hex(o.dark), bright = hex(o.bright), rust = hex(o.rust);
  const brushF = new Fbm(4, 4, seed, 0.65, 24, 1);
  const brushF2 = new Fbm(4, 3, seed + 1, 0.6, 60, 2);
  const lowF = new Fbm(2, 5, seed + 2, 0.55);
  const rustF = new Fbm(3, 5, seed + 3, 0.6);
  const pitF = new Fbm(24, 2, seed + 4, 0.5);
  const hamV = new Voronoi(10, seed + 5, 256);
  const damF = new Fbm(2, 3, seed + 6, 0.5, 1, 1);
  const damW = new Fbm(3, 4, seed + 7, 0.55);
  const rAmt = o.rustAmt ?? 0.25;
  const br = o.brush ?? 0.7;
  const rough0 = o.rough ?? 0.42;
  const pitsK = o.pits ?? 0.5;
  t.gen((u, v, p) => {
    const b1 = brushF.at(u, v), b2 = brushF2.at(u, v);
    const low = lowF.at(u, v);
    const ham = o.hammer ? hamV.d1(u, v) : 0;
    const dent = o.hammer ? (1 - sstep(0.0, 0.55, ham)) : 0;
    const pit = sstep(0.7, 0.86, pitF.at(u, v)) * pitsK * (0.4 + 0.6 * sstep(0.35, 0.7, low));
    let tone = 0.35 + 0.35 * (low - 0.5) * 2 + br * 0.25 * (b1 - 0.5) + br * 0.15 * (b2 - 0.5);
    // дамасский травлёный узор: волнистые слои по v
    let dam = 0;
    if (o.etch) {
      const ph = (v * 14 + (damW.at(u, v) - 0.5) * 7 + (damF.at(u, v) - 0.5) * 2) * Math.PI * 2;
      dam = Math.sin(ph) * 0.5 + 0.5;
      tone += (dam - 0.5) * 0.4 * o.etch;
    }
    let c = mixRGB(dark, bright, clamp(tone, 0, 1));
    // ржавчина: пятна по низким частотам, чаще в питтингах
    const rz = clamp((sstep(0.52, 0.78, rustF.at(u + 0.5, v)) + pit * 0.8) * rAmt * 2.2, 0, 1);
    c = mixRGB(c, rust, rz * 0.85);
    c = [c[0] * (1 - pit * 0.5), c[1] * (1 - pit * 0.5), c[2] * (1 - pit * 0.5)];
    p.r = c[0]; p.g = c[1]; p.b = c[2];
    p.h = 0.5 + 0.08 * br * (b1 - 0.5) + 0.04 * (b2 - 0.5) - 0.35 * pit - dent * (o.hammer ?? 0) * 0.12 + (o.etch ? (dam - 0.5) * 0.05 * o.etch : 0) + rz * 0.06 * (pitF.at(u * 3, v * 3) - 0.5);
    p.rough = rough0 + 0.22 * (1 - tone) * 0.6 + 0.12 * (b2 - 0.5) + rz * 0.4 + pit * 0.2;
    p.metal = clamp(0.96 - rz * 0.65 - pit * 0.2, 0, 1);
    p.ao = 1 - pit * 0.6;
  });
  const sc = scratchMask(t, Math.round((o.scratches ?? 180) * (w * h) / (1024 * 1024)), { angle: Math.PI / 2, spread: 1.1, len: [0.01, 0.12], width: [0.5, 1.3], alpha: [0.25, 0.9], seed: seed + 21 });
  t.paint(sc, { color: [0.82, 0.83, 0.85], dh: -0.1, k: 0.6, rough: 0.28, metal: 1 });
  t.cavity(0.6, 2, 0.35);
  return t.textures({ normalStrength: 2.4 });
}

const STEELS: Record<string, SteelOpts> = {
  // кованое тёмное железо (наконечник копья охотников)
  forged: { dark: 0x34363a, bright: 0x8e9196, rust: 0x6a3b20, rustAmt: 0.3, brush: 0.8, hammer: 0.7, rough: 0.46, scratches: 220, pits: 0.6, seed: 3 },
  // светлая, хорошо заточенная сталь клинка
  blade: { dark: 0x555960, bright: 0xc4c7cb, rust: 0x70401f, rustAmt: 0.12, brush: 0.9, hammer: 0.0, rough: 0.34, scratches: 260, pits: 0.35, seed: 5, etch: 0.8 },
  // регулярное железо налётчиков: чище, но с ржавчиной
  iron: { dark: 0x3d4045, bright: 0x9a9da2, rust: 0x7a4322, rustAmt: 0.35, brush: 0.7, hammer: 0.35, rough: 0.5, scratches: 260, pits: 0.55, seed: 9 },
  // ржавое/почерневшее (умбон, обод)
  dull: { dark: 0x2c2e31, bright: 0x70737a, rust: 0x5a3219, rustAmt: 0.45, brush: 0.6, hammer: 0.5, rough: 0.58, scratches: 200, pits: 0.8, seed: 11 },
};

export function steelTex(kind: string): PBRMaps {
  return cachedTex('steel:' + kind, () => makeSteelTex(STEELS[kind] ?? STEELS.forged));
}
export function steelMat(kind: keyof typeof STEELS | string = 'forged', o: { vertexColors?: boolean; side?: THREE.Side } = {}): THREE.MeshStandardMaterial {
  return cached(`steel:${kind}:${o.vertexColors ? 'vc' : ''}:${o.side ?? 0}`, () => matFromMaps(steelTex(kind), { normalScale: 1, vertexColors: o.vertexColors, side: o.side, envMapIntensity: 1.1 }));
}

// ============================================================
// КОСТЬ / КЛЫК / РОГ
// ============================================================

export interface BoneOpts {
  base: number; dark: number; stain: number;
  veins?: number; cracks?: number; rough?: number; seed?: number; size?: number;
}

export function makeBoneTex(o: BoneOpts): PBRMaps {
  const S = o.size ?? texSize(512);
  const seed = o.seed ?? 1;
  const t = new PBR(S, S);
  const base = hex(o.base), dark = hex(o.dark), stain = hex(o.stain);
  const vein = new Fbm(3, 4, seed, 0.6, 14, 1);
  const lowF = new Fbm(2, 4, seed + 1, 0.55);
  const pore = new Fbm(16, 2, seed + 2, 0.5, 8, 1);
  const stainF = new Fbm(2, 5, seed + 3, 0.6, 1, 1);
  const crackV = new Voronoi(7, seed + 4, 256, 0.95);
  t.gen((u, v, p) => {
    const vn = vein.at(u, v);
    const low = lowF.at(u, v);
    const pr = pore.at(u, v);
    const st = sstep(0.45, 0.8, stainF.at(u + 0.3, v));
    let c = mixRGB(base, dark, clamp(0.35 * (1 - vn) * (o.veins ?? 0.8) + 0.3 * (1 - low), 0, 1) * 0.55);
    c = mixRGB(c, stain, st * 0.55);
    const ck = 1 - sstep(0.0, 0.06, crackV.edge(u, v) * 0.3);
    const cr = ck * (o.cracks ?? 0.5) * sstep(0.45, 0.65, vn);
    c = [c[0] * (1 - cr * 0.55), c[1] * (1 - cr * 0.6), c[2] * (1 - cr * 0.65)];
    p.r = c[0] * (0.96 + 0.08 * pr); p.g = c[1] * (0.96 + 0.08 * pr); p.b = c[2] * (0.95 + 0.08 * pr);
    p.h = 0.5 + 0.1 * (vn - 0.5) + 0.05 * (pr - 0.5) - cr * 0.3;
    p.rough = (o.rough ?? 0.48) + 0.14 * (0.5 - vn) + st * 0.1 + cr * 0.2;
    p.metal = 0;
    p.ao = 1 - cr * 0.6;
  });
  const sc = scratchMask(t, Math.round(50 * (S * S) / (512 * 512)), { angle: Math.PI / 2, spread: 1.2, len: [0.02, 0.1], width: [0.5, 1.0], alpha: [0.2, 0.6], seed: seed + 5 });
  t.paint(sc, { color: mixRGB(base, dark, 0.45), dh: -0.08, k: 0.5 });
  t.cavity(0.6, 2, 0.4);
  return t.textures({ normalStrength: 2.2 });
}
const BONES: Record<string, BoneOpts> = {
  ivory: { base: 0xe2d6bd, dark: 0xa38a62, stain: 0x8b6a3e, veins: 0.9, cracks: 0.6, rough: 0.44, seed: 2 },
  aged: { base: 0xcdbd9c, dark: 0x8d7149, stain: 0x6e5030, veins: 1, cracks: 0.9, rough: 0.55, seed: 6 },
  antler: { base: 0xb4a07c, dark: 0x6c5836, stain: 0x4e3b22, veins: 1, cracks: 0.6, rough: 0.6, seed: 9 },
};
export function boneTex(kind: string): PBRMaps {
  return cachedTex('bone:' + kind, () => makeBoneTex(BONES[kind] ?? BONES.ivory));
}
export function boneMat(kind: keyof typeof BONES | string = 'ivory'): THREE.MeshStandardMaterial {
  return cached('bone:' + kind, () => matFromMaps(boneTex(kind), { normalScale: 1 }));
}

// ============================================================
// БРОНЗА / ЛАТУНЬ / СЕРЕБРО
// ============================================================

export interface BrassOpts {
  base: number; bright: number; patina: number; dark: number;
  patinaAmt?: number; rough?: number; seed?: number; size?: number; hammer?: number;
}

/** Бронза до упаковки в текстуры (для нанесения рисунка: медальон). */
export function brassPBR(o: BrassOpts): PBR {
  const S = o.size ?? texSize(512);
  const seed = o.seed ?? 1;
  const t = new PBR(S, S);
  const base = hex(o.base), bright = hex(o.bright), patina = hex(o.patina), dark = hex(o.dark);
  const lowF = new Fbm(3, 5, seed, 0.6);
  const fine = new Fbm(16, 3, seed + 1, 0.6, 1, 1);
  const hamV = new Voronoi(9, seed + 2, 256);
  const patF = new Fbm(4, 5, seed + 3, 0.62);
  const amt = o.patinaAmt ?? 0.4;
  t.gen((u, v, p) => {
    const low = lowF.at(u, v), f = fine.at(u, v);
    const ham = (1 - sstep(0.0, 0.5, hamV.d1(u, v))) * (o.hammer ?? 0.5);
    let c = mixRGB(base, bright, clamp((f - 0.35) * 1.4 + (low - 0.5) * 0.6 + ham * 0.2, 0, 1));
    c = mixRGB(c, dark, sstep(0.55, 0.85, lowF.at(u + 0.4, v + 0.2)) * 0.5);
    const pt = sstep(0.55, 0.78, patF.at(u, v)) * amt;
    c = mixRGB(c, patina, pt * 0.75);
    p.r = c[0]; p.g = c[1]; p.b = c[2];
    p.h = 0.5 + 0.08 * (f - 0.5) - ham * 0.1 - pt * 0.08;
    p.rough = (o.rough ?? 0.38) + 0.2 * (1 - f) + pt * 0.35 + ham * 0.05;
    p.metal = clamp(0.95 - pt * 0.5, 0, 1);
    p.ao = 1;
  });
  const sc = scratchMask(t, Math.round(160 * (S * S) / (512 * 512)), { len: [0.01, 0.08], width: [0.5, 1.1], alpha: [0.3, 0.8], seed: seed + 5 });
  t.paint(sc, { color: mixRGB(bright, [1, 1, 1], 0.2), dh: -0.08, k: 0.6, rough: 0.28, metal: 1 });
  t.cavity(0.8, 2, 0.5);
  return t;
}
export function makeBrassTex(o: BrassOpts): PBRMaps {
  return brassPBR(o).textures({ normalStrength: 2.4 });
}
export const BRASSES: Record<string, BrassOpts> = {
  brass: { base: 0xa9792f, bright: 0xe3bb6a, patina: 0x4f7a58, dark: 0x4a3216, patinaAmt: 0.3, rough: 0.36, seed: 2 },
  bronze: { base: 0x8a5d2b, bright: 0xc78f4a, patina: 0x3f6d52, dark: 0x3a2610, patinaAmt: 0.5, rough: 0.42, seed: 5 },
  silver: { base: 0x9a9890, bright: 0xd8d6cf, patina: 0x4d4a44, dark: 0x3b3a36, patinaAmt: 0.45, rough: 0.34, seed: 8 },
};
export function brassTex(kind: string): PBRMaps {
  return cachedTex('brass:' + kind, () => makeBrassTex(BRASSES[kind] ?? BRASSES.brass));
}
export function brassMat(kind: keyof typeof BRASSES | string = 'brass'): THREE.MeshStandardMaterial {
  return cached('brass:' + kind, () => matFromMaps(brassTex(kind), { normalScale: 1, envMapIntensity: 1.15 }));
}

// ============================================================
// ЖИЛА / ШНУР / ОБМОТКА (диагональные пряди; u — вокруг, v — вдоль)
// ============================================================

export interface CordOpts {
  base: number; dark: number; light: number;
  strands?: number;   // прядей вокруг
  pitch?: number;     // наклон прядей
  rough?: number; seed?: number; size?: number;
}
export function makeCordTex(o: CordOpts): PBRMaps {
  const S = o.size ?? texSize(256);
  const seed = o.seed ?? 1;
  const t = new PBR(S, S);
  const base = hex(o.base), dark = hex(o.dark), light = hex(o.light);
  const nz = new Fbm(8, 4, seed, 0.6, 3, 3);
  const nz2 = new Fbm(4, 3, seed + 1, 0.55);
  const N = o.strands ?? 6, pitch = o.pitch ?? 6;
  t.gen((u, v, p) => {
    const ph = (u * N + v * pitch);
    const f = ph - Math.floor(ph);
    const prof = Math.sin(f * Math.PI); // 0..1..0 — профиль пряди
    const wob = nz.at(u, v);
    const c0 = mixRGB(dark, mixRGB(base, light, wob), 0.35 + 0.65 * Math.pow(prof, 0.8));
    const k = 0.88 + 0.2 * nz2.at(u, v);
    p.r = c0[0] * k; p.g = c0[1] * k; p.b = c0[2] * k;
    p.h = 0.2 + 0.7 * Math.pow(prof, 0.7) + 0.08 * (wob - 0.5);
    p.rough = (o.rough ?? 0.82) + 0.1 * (0.5 - wob);
    p.metal = 0;
    p.ao = 0.55 + 0.45 * prof;
  });
  return t.textures({ normalStrength: 3 });
}
const CORDS: Record<string, CordOpts> = {
  sinew: { base: 0xa88a5a, dark: 0x5e4528, light: 0xcfb585, strands: 7, pitch: 7, seed: 2 },
  leather: { base: 0x5a3a22, dark: 0x24150b, light: 0x8a6240, strands: 6, pitch: 5, seed: 4 },
  dark: { base: 0x3a2a1c, dark: 0x140d08, light: 0x5e442c, strands: 6, pitch: 6, seed: 6 },
  red: { base: 0x8a3a24, dark: 0x3a140a, light: 0xb8603c, strands: 6, pitch: 6, seed: 7 },
};
export function cordTex(kind: string): PBRMaps {
  return cachedTex('cord:' + kind, () => makeCordTex(CORDS[kind] ?? CORDS.sinew));
}
export function cordMat(kind: keyof typeof CORDS | string = 'sinew'): THREE.MeshStandardMaterial {
  return cached('cord:' + kind, () => matFromMaps(cordTex(kind), { normalScale: 1 }));
}

/** Простой однотонный материал для мелочей (шпеньки, заклёпки). */
export function plainMat(color: number, rough = 0.6, metal = 0): THREE.MeshStandardMaterial {
  return cached(`plain:${color}:${rough}:${metal}`, () => new THREE.MeshStandardMaterial({ color, roughness: rough, metalness: metal }));
}

export { tiled };
