// Построение геометрии деревьев: ствол + ярусы ветвей из карточек с хвоей (провисание, изгиб, AO по вершинам).
// Всё строится в локальных координатах дерева: основание в (0,0,0), ось — Y. Несколько уровней детализации.

import * as THREE from 'three';
import { RNG } from '../../core/util';
import type { Atlas } from './needles';

export type SpeciesId = 'spruce' | 'fir' | 'larch' | 'birch' | 'snag';

export interface SpeciesSpec {
  id: SpeciesId;
  /** Номинальная высота, м (масштаб 1). */
  H: number;
  crownBase: number;
  /** Максимальная длина нижних ветвей, м. */
  Rmax: number;
  whorls: number; // ярусов на LOD0
  perWhorl: [number, number]; // ветвей в ярусе: внизу / вверху
  pitchBase: number; // угол ветви внизу (отрицательный — вниз)
  pitchTop: number;
  droop: number; // провисание конца ветви (доля длины)
  tipUp: number; // загиб кончика вверх (доля длины)
  widthRatio: number; // ширина карточки / длина
  trunkR0: number; // радиус у земли при масштабе 1
  trunkRTop: number;
  flare: number;
  /** ячейки атласа хвои для лап (индексы) и для сухих веточек */
  sprayCells: number[];
  deadCell: number;
  /** ярус плотнее: множитель числа вторичных карточек */
  density: number;
  /** сколько сухих веточек на нижней части ствола */
  deadTwigs: number;
  /** доля нижней части кроны, где ветви сухие/отсутствуют (для леса) */
  bareLower: number;
}

export const SPECIES: Record<SpeciesId, SpeciesSpec> = {
  spruce: {
    id: 'spruce', H: 20, crownBase: 2.6, Rmax: 3.5, whorls: 27, perWhorl: [7, 4], pitchBase: -0.42, pitchTop: 0.5,
    droop: 0.34, tipUp: 0.1, widthRatio: 0.62, trunkR0: 0.3, trunkRTop: 0.025, flare: 0.5,
    sprayCells: [0, 1], deadCell: 3, density: 1, deadTwigs: 26, bareLower: 0.08,
  },
  fir: {
    id: 'fir', H: 22, crownBase: 3.4, Rmax: 2.3, whorls: 32, perWhorl: [6, 4], pitchBase: -0.2, pitchTop: 0.55,
    droop: 0.22, tipUp: 0.16, widthRatio: 0.6, trunkR0: 0.27, trunkRTop: 0.022, flare: 0.35,
    sprayCells: [0, 1], deadCell: 3, density: 1, deadTwigs: 20, bareLower: 0.06,
  },
  larch: {
    id: 'larch', H: 21, crownBase: 4.2, Rmax: 2.9, whorls: 20, perWhorl: [6, 3], pitchBase: -0.1, pitchTop: 0.4,
    droop: 0.28, tipUp: 0.18, widthRatio: 0.66, trunkR0: 0.28, trunkRTop: 0.022, flare: 0.55,
    sprayCells: [0, 1, 2], deadCell: 3, density: 1, deadTwigs: 18, bareLower: 0.1,
  },
  birch: {
    id: 'birch', H: 12.5, crownBase: 3.2, Rmax: 2.6, whorls: 15, perWhorl: [4, 3], pitchBase: 0.1, pitchTop: 0.65,
    droop: 0.35, tipUp: 0.04, widthRatio: 0.7, trunkR0: 0.13, trunkRTop: 0.018, flare: 0.25,
    sprayCells: [0, 1, 3, 2], deadCell: 2, density: 1, deadTwigs: 0, bareLower: 0,
  },
  snag: {
    id: 'snag', H: 11, crownBase: 3, Rmax: 1.6, whorls: 8, perWhorl: [3, 2], pitchBase: -0.2, pitchTop: 0.3,
    droop: 0.2, tipUp: 0.1, widthRatio: 0.6, trunkR0: 0.2, trunkRTop: 0.04, flare: 0.4,
    sprayCells: [], deadCell: 3, density: 1, deadTwigs: 30, bareLower: 0,
  },
};

interface Buf {
  pos: number[]; nor: number[]; uv: number[]; col: number[]; wind: number[]; idx: number[];
}
const newBuf = (): Buf => ({ pos: [], nor: [], uv: [], col: [], wind: [], idx: [] });

const _t = new THREE.Vector3(), _s = new THREE.Vector3(), _n = new THREE.Vector3(), _r = new THREE.Vector3();
const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _c = new THREE.Vector3();

export interface CardParams {
  origin: THREE.Vector3;
  az: number;
  len: number;
  wid: number;
  pitch: number; // угол начального направления над горизонтом
  droop: number; // провисание конца, м
  tipUp: number; // загиб кончика вверх, м
  roll: number;
  segs: number;
  uv: [number, number, number, number];
  flip: boolean;
  /** AO у основания и на конце */
  ao0: number;
  ao1: number;
  /** доля «радиальной» нормали для общего объёма кроны */
  radial: number;
  /** угол радиальной нормали над горизонтом */
  radialPitch: number;
  windAmp: number;
  /** при нижнем ярусе нормаль смотрит вниз-наружу */
  upBias?: number;
}

/** Карточка-ветвь: полоса вдоль изогнутой оси от ствола наружу. */
export function addCard(b: Buf, p: CardParams) {
  const dx = Math.cos(p.az), dz = Math.sin(p.az);
  const base = b.pos.length / 3;
  const segs = p.segs;
  const cp = Math.cos(p.pitch), sp = Math.sin(p.pitch);
  const pts: THREE.Vector3[] = [];
  const tans: THREE.Vector3[] = [];
  for (let i = 0; i <= segs; i++) {
    const t = i / segs;
    const s = p.len * t;
    // ось ветви: начальный угол, провисание ~t^1.8, кончик подгибается вверх ~t^4
    const hx = s * cp;
    const hy = s * sp - p.droop * Math.pow(t, 1.8) + p.tipUp * Math.pow(t, 4);
    pts.push(new THREE.Vector3(p.origin.x + dx * hx, p.origin.y + hy, p.origin.z + dz * hx));
  }
  for (let i = 0; i <= segs; i++) {
    const a = pts[Math.max(0, i - 1)], c = pts[Math.min(segs, i + 1)];
    tans.push(new THREE.Vector3().subVectors(c, a).normalize());
  }
  const cr = Math.cos(p.roll), sr = Math.sin(p.roll);
  for (let i = 0; i <= segs; i++) {
    const t = i / segs;
    _t.copy(tans[i]);
    // боковая ось: горизонтальная, перпендикулярная ветви
    _s.set(-_t.z, 0, _t.x);
    if (_s.lengthSq() < 1e-6) _s.set(1, 0, 0);
    _s.normalize();
    _n.crossVectors(_t, _s).normalize(); // «верх» карточки (≈ +Y при нулевом крене)
    // крен вокруг оси ветви
    const sx = _s.x * cr + _n.x * sr, sy = _s.y * cr + _n.y * sr, sz = _s.z * cr + _n.z * sr;
    const nx = _n.x * cr - _s.x * sr, ny = _n.y * cr - _s.y * sr, nz = _n.z * cr - _s.z * sr;
    // ширина: тоньше у кончика
    const w = p.wid * (0.9 + 0.1 * Math.sin(Math.PI * Math.min(1, t * 1.1))) * 0.5;
    // сглаженная нормаль: смесь нормали карточки (обращённой вверх) и радиальной по кроне
    let cnx = nx, cny = ny, cnz = nz;
    if (cny < 0) { cnx = -cnx; cny = -cny; cnz = -cnz; }
    const rp = p.radialPitch;
    const rx = dx * Math.cos(rp), ry = Math.sin(rp), rz = dz * Math.cos(rp);
    let mx = cnx * (1 - p.radial) + rx * p.radial, my = cny * (1 - p.radial) + ry * p.radial + (p.upBias ?? 0), mz = cnz * (1 - p.radial) + rz * p.radial;
    const ml = Math.hypot(mx, my, mz) || 1;
    mx /= ml; my /= ml; mz /= ml;
    const inner = smooth01(t / 0.7);
    const ao = p.ao0 + (p.ao1 - p.ao0) * inner;
    const px = pts[i].x, py = pts[i].y, pz = pts[i].z;
    for (let side = 0; side < 2; side++) {
      const sg = side === 0 ? -1 : 1;
      b.pos.push(px + sx * w * sg, py + sy * w * sg, pz + sz * w * sg);
      b.nor.push(mx, my, mz);
      const u = p.uv[0] + (p.uv[2] - p.uv[0]) * t;
      const v = (side === 0) !== p.flip ? p.uv[1] : p.uv[3];
      b.uv.push(u, v);
      b.col.push(ao, ao, ao);
      b.wind.push(p.windAmp * t);
    }
  }
  for (let i = 0; i < segs; i++) {
    const a = base + i * 2;
    b.idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
  }
}

const smooth01 = (x: number) => {
  const t = Math.min(1, Math.max(0, x));
  return t * t * (3 - 2 * t);
};

// ---------------------------------------------------------------- ствол

export interface TrunkParams {
  H: number;
  r0: number;
  rTop: number;
  flare: number;
  segs: number;
  rings: number;
  lean: [number, number]; // смещение оси по x/z на вершине, м
  crownBase: number;
  uvRepeat: number;
  uvMeter: number; // метров ствола на тайл текстуры
  /** где начинается тёмная зона внутри кроны (AO ствола) */
  shadeFrom: number;
  /** радиус ствола для верхней части кроны не меньше (для берёзы с веткой) */
  windAmp?: number;
}

export function trunkRadius(p: TrunkParams, y: number): number {
  const t = Math.min(1, y / p.H);
  const taper = p.rTop + (p.r0 - p.rTop) * Math.pow(1 - t, 0.9);
  return taper * (1 + p.flare * Math.exp(-y / 0.55));
}

export function trunkAxis(p: TrunkParams, y: number, out: THREE.Vector3): THREE.Vector3 {
  const t = Math.min(1, y / p.H);
  const k = t * t;
  return out.set(p.lean[0] * k, y, p.lean[1] * k);
}

export function buildTrunkGeometry(p: TrunkParams): THREE.BufferGeometry {
  const b = newBuf();
  const ring: number[] = [];
  for (let r = 0; r <= p.rings; r++) ring.push(p.H * Math.pow(r / p.rings, 1.35));
  const ax = new THREE.Vector3();
  for (let r = 0; r <= p.rings; r++) {
    const y = ring[r];
    trunkAxis(p, y, ax);
    const rad = trunkRadius(p, y);
    // наклон боковой поверхности (для нормали)
    const dr = (trunkRadius(p, y + 0.2) - trunkRadius(p, Math.max(0, y - 0.2))) / 0.4;
    const shade = y < 1.2 ? 0.55 + 0.45 * smooth01(y / 1.2) : 1;
    const inCrown = smooth01((y - p.shadeFrom) / 1.8);
    const ao = shade * (1 - 0.62 * inCrown);
    for (let s = 0; s <= p.segs; s++) {
      const a = (s / p.segs) * Math.PI * 2;
      const c = Math.cos(a), sn = Math.sin(a);
      b.pos.push(ax.x + c * rad, y, ax.z + sn * rad);
      const nl = Math.hypot(1, dr);
      b.nor.push(c / nl, -dr / nl, sn / nl);
      b.uv.push((s / p.segs) * p.uvRepeat, y / p.uvMeter);
      b.col.push(ao, ao, ao);
      b.wind.push(0);
    }
  }
  const row = p.segs + 1;
  for (let r = 0; r < p.rings; r++) {
    for (let s = 0; s < p.segs; s++) {
      const a = r * row + s;
      b.idx.push(a, a + row, a + 1, a + 1, a + row, a + row + 1);
    }
  }
  return toGeometry(b);
}

function toGeometry(b: Buf): THREE.BufferGeometry {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(b.pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(b.nor, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(b.uv, 2));
  g.setAttribute('color', new THREE.Float32BufferAttribute(b.col, 3));
  g.setAttribute('aWind', new THREE.Float32BufferAttribute(b.wind, 1));
  g.setIndex(b.idx);
  return g;
}

// ---------------------------------------------------------------- крона

export interface TreeGeo {
  trunk: THREE.BufferGeometry;
  foliage: THREE.BufferGeometry;
  /** радиус кроны у основания и высота модели (для импостора и коллайдеров) */
  crownRadius: number;
  height: number;
  trunkRadius: number;
}

/**
 * lod: 0 — полная, 1 — упрощённая (меньше ярусов, шире карточки).
 * Возвращает независимые геометрии ствола и хвои (в одном локальном пространстве).
 */
export function buildTree(spec: SpeciesSpec, atlas: Atlas | null, lod: 0 | 1, seed: number): TreeGeo {
  const rng = new RNG(seed);
  const H = spec.H * rng.range(0.94, 1.06);
  const lean: [number, number] = [rng.range(-0.5, 0.5), rng.range(-0.5, 0.5)];
  const tp: TrunkParams = {
    H, r0: spec.trunkR0 * rng.range(0.92, 1.1), rTop: spec.trunkRTop, flare: spec.flare,
    segs: lod === 0 ? 9 : 5, rings: lod === 0 ? 11 : 5, lean, crownBase: spec.crownBase,
    uvRepeat: spec.id === 'birch' ? 1 : 2, uvMeter: spec.id === 'birch' ? 3.2 : 3.6, shadeFrom: spec.crownBase - 0.2,
  };
  const trunk = buildTrunkGeometry(tp);
  const fb = newBuf();
  const ax = new THREE.Vector3();
  const org = new THREE.Vector3();
  const cellUV = (i: number) => (atlas ? atlas.cell(i) : [0, 0, 1, 1] as [number, number, number, number]);

  const isBirch = spec.id === 'birch';
  const N = lod === 0 ? spec.whorls : Math.max(8, Math.round(spec.whorls * 0.45));
  const lenK = lod === 0 ? 1 : 1.28; // на LOD1 карточки крупнее
  const cardSeg = lod === 0 ? 3 : 2;
  const crownH = H - spec.crownBase;
  let maxR = 0;

  for (let k = 0; k < N; k++) {
    const u = N === 1 ? 1 : k / (N - 1);
    const y = spec.crownBase + crownH * Math.pow(u, 0.92) * 0.97;
    const cf = (y - spec.crownBase) / crownH; // 0 внизу кроны, 1 вверху
    let L = (spec.Rmax * Math.pow(Math.max(0.02, 1 - cf), isBirch ? 0.55 : 0.82) + 0.3) * rng.range(0.84, 1.16);
    if (isBirch) L *= 0.6 + 0.8 * Math.sin(Math.PI * Math.min(1, cf * 0.9 + 0.1));
    maxR = Math.max(maxR, L);
    const nb = Math.max(3, Math.round((spec.perWhorl[0] + (spec.perWhorl[1] - spec.perWhorl[0]) * cf) * (lod === 0 ? 1 : 0.7)));
    const az0 = rng.range(0, Math.PI * 2);
    trunkAxis(tp, y, ax);
    const trunkR = trunkRadius(tp, y);
    for (let b = 0; b < nb; b++) {
      const az = az0 + ((b + rng.range(-0.3, 0.3)) / nb) * Math.PI * 2;
      const pitch = spec.pitchBase + (spec.pitchTop - spec.pitchBase) * Math.pow(cf, 0.85) + rng.range(-0.13, 0.13);
      const len = L * rng.range(0.82, 1.1) * lenK;
      const droop = spec.droop * len * rng.range(0.8, 1.25) * (1 - 0.35 * cf);
      const tipUp = spec.tipUp * len * rng.range(0.6, 1.3);
      org.set(ax.x + Math.cos(az) * trunkR * 0.8, y + rng.range(-0.12, 0.12), ax.z + Math.sin(az) * trunkR * 0.8);
      const tierAO = 0.5 + 0.5 * Math.pow(cf, 0.65);
      const cell = spec.sprayCells.length ? rng.pick(spec.sprayCells) : spec.deadCell;
      const base: Omit<CardParams, 'len' | 'roll' | 'uv' | 'ao0' | 'ao1' | 'droop' | 'tipUp' | 'segs' | 'flip'> = {
        origin: org, az, wid: 0, pitch, radial: isBirch ? 0.25 : 0.52, radialPitch: 0.55 - 0.4 * cf, windAmp: 1,
        upBias: 0.1,
      };
      const jit = rng.range(-0.06, 0.06);
      const mk = (lenF: number, roll: number, widF: number, aoK: number, cellIdx: number, dm = 1, tm = 1) =>
        addCard(fb, {
          ...base, len: len * lenF, wid: len * lenF * spec.widthRatio * widF, roll, segs: cardSeg, uv: cellUV(cellIdx), flip: rng.chance(0.5),
          droop: droop * lenF * dm, tipUp: tipUp * lenF * tm, ao0: (0.3 + jit) * tierAO * aoK, ao1: (0.92 + jit) * tierAO * aoK,
        });
      if (spec.id === 'snag') {
        mk(0.9, rng.range(-0.3, 0.3), 0.8, 1, spec.deadCell);
        continue;
      }
      if (isBirch) {
        // ветвь берёзы: свисающая карточка + боковая
        mk(1, rng.range(-0.2, 0.2), 1, 1, cell);
        if (lod === 0) mk(0.8, rng.pick([-1, 1]) * rng.range(0.7, 1.2), 0.9, 0.9, rng.pick(spec.sprayCells), 1.2, 1);
        continue;
      }
      // основная лапа + вторая под углом (V-образно) + «занавес» свисающих веточек
      mk(1, rng.range(-0.14, 0.14), 1, 1, cell);
      if (lod === 0) {
        mk(0.86, rng.pick([-1, 1]) * rng.range(0.55, 0.95), 0.92, 0.9, spec.sprayCells.length ? rng.pick(spec.sprayCells) : cell, 1.1);
        if (cf < 0.8 && rng.chance(0.7 * spec.density)) mk(0.62, rng.pick([-1, 1]) * rng.range(1.15, 1.5), 0.8, 0.75, cell, 1.5, 0.5);
      } else if (rng.chance(0.55)) {
        mk(0.8, rng.pick([-1, 1]) * rng.range(0.6, 1.0), 0.95, 0.9, cell, 1.1);
      }
    }
  }

  // верхушка: вертикальные карточки
  if (spec.id !== 'snag') {
    const topY = H * 0.93;
    trunkAxis(tp, topY, ax);
    const nTop = lod === 0 ? 5 : 3;
    for (let i = 0; i < nTop; i++) {
      const az = (i / nTop) * Math.PI * 2 + rng.range(-0.3, 0.3);
      org.set(ax.x, topY + rng.range(-0.3, 0.3), ax.z);
      const len = (isBirch ? 1.3 : 1.5) * rng.range(0.8, 1.15);
      addCard(fb, {
        origin: org, az, len, wid: len * spec.widthRatio * 0.8, pitch: 1.05 + rng.range(-0.15, 0.15), droop: len * 0.05, tipUp: len * 0.04, roll: rng.range(-0.4, 0.4),
        segs: 2, uv: cellUV(spec.sprayCells.length ? spec.sprayCells[spec.sprayCells.length - 1] : spec.deadCell), flip: rng.chance(0.5), ao0: 0.8, ao1: 1, radial: 0.35, radialPitch: 1.0, windAmp: 1.4,
      });
    }
  }

  // сухие веточки в нижней части ствола (под кроной)
  const nDead = lod === 0 ? spec.deadTwigs : Math.floor(spec.deadTwigs * 0.35);
  for (let i = 0; i < nDead; i++) {
    const y = rng.range(0.9, spec.crownBase + (spec.id === 'snag' ? H * 0.6 : 0.8));
    trunkAxis(tp, y, ax);
    const az = rng.range(0, Math.PI * 2);
    const len = rng.range(0.55, 1.35) * (1 - 0.35 * Math.min(1, y / (spec.crownBase + 1)));
    const trunkR = trunkRadius(tp, y);
    org.set(ax.x + Math.cos(az) * trunkR * 0.8, y, ax.z + Math.sin(az) * trunkR * 0.8);
    addCard(fb, {
      origin: org, az, len, wid: len * 0.55, pitch: rng.range(-0.3, 0.25), droop: len * rng.range(0.05, 0.25), tipUp: 0, roll: rng.range(-0.6, 0.6), segs: 2,
      uv: cellUV(spec.deadCell), flip: rng.chance(0.5), ao0: 0.45, ao1: 0.7, radial: 0.2, radialPitch: 0.1, windAmp: 0.3,
    });
  }

  const foliage = toGeometry(fb);
  return { trunk, foliage, crownRadius: maxR * lenK, height: H, trunkRadius: tp.r0 };
}

/** Конус-«облако» для дальнего LOD крон на горизонте (когда нужен совсем дешёвый вариант). */
export function dispose(...gs: THREE.BufferGeometry[]) {
  for (const g of gs) g.dispose();
}
void _r; void _a; void _b; void _c;
