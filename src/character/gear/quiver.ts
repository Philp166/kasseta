// Колчан: вытянутый кожаный футляр с тиснёным плетёным узором, воротник и пояски, тёмный сшитый наконечник-колпак,
// кольца для ремня и семь стрел оперением вверх (наконечники внутри).
// Система координат: начало — центр устья, ось колчана вдоль Y (устье вверху, дно на y ≈ −0.64), внешняя сторона
// с узором — на −Z (носится на спине: к телу обращена +Z).
// userData.sockets: mouth, strapTop, strapBottom, center.

import * as THREE from 'three';
import { GeoBuilder, V, V3, loftY, torus, tube } from './geom';
import { newGear, addSocket, finishGear, addMesh, orient } from './common';
import { leatherMat, leatherPBR, LEATHERS, matFromMaps, cordMat, brassMat, boneMat, woodMat, steelMat } from './materials';
import { paintOrnament } from './ornament';
import { featherMat, FeatherKind } from './feather';
import { arrowParts, ARROW } from './arrow';

export const QUIVER = { depth: 0.64, bodyEnd: -0.5, rx: 0.056, rz: 0.046 };

let _tex: THREE.MeshStandardMaterial | null = null;

/** Материал тела: тёмная кожа с вытисненным узором-«плетением». */
export function quiverBodyMat(): THREE.MeshStandardMaterial {
  if (_tex) return _tex;
  const S = 1024;
  const t = leatherPBR({ ...LEATHERS.dark, size: S, seed: 21, stain: 0.7, grain: 170 });
  // v = (−y) / 0.5; зона узора y ∈ [−0.07, −0.43] → v ∈ [0.14, 0.86]
  paintOrnament(t, { x: 0, y: Math.round(S * 0.14), w: S, h: Math.round(S * 0.72) }, 'knot', {
    relief: 'carved', accent: 0x95703f, dark: 0x120a06, repeat: 3, weight: 1.0, wear: 0.55, depth: -0.4, seed: 4, borders: true,
  });
  t.blurHeight(1);
  t.cavity(0.6, 2, 0.35);
  _tex = matFromMaps(t.textures({ normalStrength: 4.2 }), { normalScale: 1 });
  _tex.name = 'quiverBody';
  return _tex;
}

/** Тело колчана: кольца (y, rx, rz) с гладкой интерполяцией. */
function bodyRings(y0: number, y1: number, n: number): Array<{ y: number; rx: number; rz: number }> {
  const prof: Array<[number, number]> = [
    [0.0, 1.0], [-0.02, 1.03], [-0.10, 1.0], [-0.25, 0.9], [-0.38, 0.77], [-0.50, 0.66],
  ];
  const f = (y: number) => {
    for (let i = 0; i < prof.length - 1; i++) {
      const [ya, ka] = prof[i], [yb, kb] = prof[i + 1];
      if (y <= ya && y >= yb) { const t = (y - ya) / (yb - ya); const s = t * t * (3 - 2 * t); return ka + (kb - ka) * s; }
    }
    return prof[prof.length - 1][1];
  };
  const out: Array<{ y: number; rx: number; rz: number }> = [];
  for (let i = 0; i <= n; i++) { const y = y0 + ((y1 - y0) * i) / n; const k = f(y); out.push({ y, rx: QUIVER.rx * k, rz: QUIVER.rz * k }); }
  return out;
}

export interface ArrowPose { x: number; z: number; tx: number; tz: number; fletch: FeatherKind; roll: number; up: number }

/** Одним мешем на материал: все стрелы пучка в системе колчана (оперением вверх). */
function arrowBundle(poses: ArrowPose[]): { shafts: GeoBuilder; heads: GeoBuilder; nocks: GeoBuilder; binding: GeoBuilder; vanes: Map<FeatherKind, GeoBuilder> } {
  const shafts = new GeoBuilder(), heads = new GeoBuilder(), nocks = new GeoBuilder(), binding = new GeoBuilder();
  const vanes = new Map<FeatherKind, GeoBuilder>();
  for (const p of poses) {
    const part = arrowParts({ head: 'iron', light: true });
    const top = V(p.x, p.up, p.z);
    const bottom = V(p.tx, p.up - ARROW.length, p.tz);
    const dir = bottom.clone().sub(top).normalize();   // остриё смотрит вниз
    const center = top.clone().addScaledVector(dir, ARROW.length / 2);
    const m = orient(dir, V(Math.cos(p.roll), 0, Math.sin(p.roll)), center);
    shafts.append(part.shaft, m); heads.append(part.head, m); nocks.append(part.nock, m); binding.append(part.binding, m);
    let vb = vanes.get(p.fletch);
    if (!vb) vanes.set(p.fletch, (vb = new GeoBuilder()));
    vb.append(part.vanes, m);
  }
  return { shafts, heads, nocks, binding, vanes };
}

export function buildQuiver(opts: { arrows?: number } = {}): THREE.Group {
  const g = newGear('Quiver');
  const { bodyEnd } = QUIVER;

  // ---------- Тело ----------
  const body = new GeoBuilder();
  loftY({
    rings: bodyRings(0, bodyEnd, 18), cols: 28,
    uv: (_i, j, _th, y) => [j / 28, -y / 0.5],
  }, body);
  addMesh(g, body, quiverBodyMat(), 'body');

  // колпак на дне: чёрная кожа
  const cap = new GeoBuilder();
  const kb = 0.66;
  loftY({
    rings: [[-0.485, 1.0], [-0.52, 0.92], [-0.56, 0.74], [-0.60, 0.47], [-0.63, 0.2], [-0.644, 0.03]]
      .map(([y, k]) => ({ y, rx: QUIVER.rx * kb * k, rz: QUIVER.rz * kb * k })),
    cols: 20, tile: 0.2,
  }, cap);
  addMesh(g, cap, leatherMat('black'), 'cap');

  // воротник устья: свёрнутая кожаная кромка + подкладка внутри
  const collar = new GeoBuilder();
  loftY({
    rings: [[0.012, 1.0], [0.008, 1.075], [-0.006, 1.08], [-0.035, 1.07], [-0.052, 1.05], [-0.058, 1.0]]
      .map(([y, k]) => ({ y, rx: QUIVER.rx * k + 0.0015, rz: QUIVER.rz * k + 0.0015 })),
    cols: 28, tile: 0.2,
  }, collar);
  addMesh(g, collar, leatherMat('tan'), 'collar');
  const inner = new GeoBuilder();
  loftY({
    rings: [[0.0, 0.98], [-0.05, 0.96], [-0.2, 0.85]].map(([y, k]) => ({ y, rx: QUIVER.rx * k * 0.94, rz: QUIVER.rz * k * 0.94 })),
    cols: 24, tile: 0.2, inside: true,
  }, inner);
  addMesh(g, inner, leatherMat('black', { side: THREE.DoubleSide }), 'inside');

  // нижний поясок и переход к колпаку
  const band = new GeoBuilder();
  loftY({
    rings: [[-0.452, 0.74], [-0.458, 0.79], [-0.476, 0.8], [-0.494, 0.79], [-0.5, 0.73]]
      .map(([y, k]) => ({ y, rx: QUIVER.rx * k * 0.98, rz: QUIVER.rz * k * 0.98 })),
    cols: 24, tile: 0.2,
  }, band);
  addMesh(g, band, leatherMat('tan'), 'lowerBand');
  // средний узкий поясок со шнуровкой
  const mid = new GeoBuilder();
  loftY({
    rings: [[-0.066, 1.0], [-0.07, 1.04], [-0.082, 1.045], [-0.094, 1.04], [-0.098, 1.0]]
      .map(([y, k]) => ({ y, rx: QUIVER.rx * k + 0.0008, rz: QUIVER.rz * k + 0.0008 })),
    cols: 28, tile: 0.2,
  }, mid);
  addMesh(g, mid, leatherMat('red'), 'upperBand');

  // шов: шнуровка по задней (к телу) стороне
  const seam = new GeoBuilder();
  const seamPts: V3[] = [];
  for (let i = 0; i <= 14; i++) { const y = -0.04 - (0.44 * i) / 14; const k = bodyRings(y, y, 1)[0]; seamPts.push(V(0.0, y, k.rz + 0.0012)); }
  tube(new THREE.CatmullRomCurve3(seamPts), { radius: 0.0017, sides: 5, segs: 40, tile: 0.06 }, seam);
  for (let i = 0; i < 14; i++) {
    const y = -0.06 - (0.42 * i) / 14;
    const k = bodyRings(y, y, 1)[0];
    for (const s of [-1, 1]) tube(new THREE.LineCurve3(V(s * 0.012, y + 0.006, k.rz * 0.985), V(-s * 0.0, y - 0.003, k.rz + 0.0016)), { radius: 0.0011, sides: 4, segs: 2, tile: 0.05 }, seam);
  }
  addMesh(g, seam, cordMat('sinew'), 'seam');

  // кольца для ремня (латунь) и бусины-подвески
  const rings = new GeoBuilder();
  for (const [y, side] of [[-0.075, 1], [-0.405, 1]] as Array<[number, number]>) {
    const k = bodyRings(y, y, 1)[0];
    torus(0.0105, 0.0027, 18, 6, { c: V(k.rx * 0.98, y, k.rz * 0.15), rot: new THREE.Euler(0, 0, Math.PI / 2), squash: 1 }, rings);
    void side;
  }
  addMesh(g, rings, brassMat('bronze'), 'ringsMetal');

  // кисточка на дне: кожаные хвостики + костяная бусина
  const tas = new GeoBuilder();
  const beads = new GeoBuilder();
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2;
    const pts = [V(0, -0.64, 0), V(Math.cos(a) * 0.006, -0.68, Math.sin(a) * 0.006), V(Math.cos(a) * 0.012, -0.73 - 0.01 * (i % 2), Math.sin(a) * 0.012)];
    tube(new THREE.CatmullRomCurve3(pts), { radius: 0.0018, sides: 5, segs: 10, tile: 0.06, caps: 'round', capRings: 2 }, tas);
  }
  const bead = new GeoBuilder();
  loftY({ rings: [[-0.655, 0.003], [-0.662, 0.0075], [-0.676, 0.0085], [-0.688, 0.0065], [-0.692, 0.003]].map(([y, r]) => ({ y, rx: r, rz: r })), cols: 10, tile: 0.1 }, bead);
  addMesh(g, tas, leatherMat('dark'), 'tassel');
  addMesh(g, bead, boneMat('ivory'), 'tasselBead');
  void beads;

  // ---------- Стрелы ----------
  const n = opts.arrows ?? 7;
  const fl: FeatherKind[] = ['barred', 'barred', 'white', 'barred', 'dark', 'barred', 'white'];
  const base: Array<[number, number, number]> = [
    [0.0, -0.004, 0], [0.026, 0.006, 40], [-0.026, 0.008, 150], [0.014, -0.026, 260], [-0.012, -0.024, 300], [0.037, -0.014, 80], [-0.037, -0.012, 200],
  ];
  const poses: ArrowPose[] = base.slice(0, n).map(([x, z, roll], i) => ({
    x, z, tx: x * 0.2, tz: z * 0.2, fletch: fl[i % fl.length], roll: (roll * Math.PI) / 180, up: 0.17 + (i % 3) * 0.018 - 0.01,
  }));
  const bundle = arrowBundle(poses);
  addMesh(g, bundle.shafts, woodMat('ash'), 'arrowShafts');
  addMesh(g, bundle.heads, steelMat('iron'), 'arrowHeads');
  addMesh(g, bundle.nocks, boneMat('ivory'), 'arrowNocks');
  addMesh(g, bundle.binding, cordMat('sinew'), 'arrowBindings');
  for (const [kind, gb] of bundle.vanes) addMesh(g, gb, featherMat(kind), 'fletching_' + kind);

  addSocket(g, 'mouth', 0, 0, 0);
  addSocket(g, 'strapTop', 0.058, -0.075, 0.0);
  addSocket(g, 'strapBottom', 0.04, -0.405, 0.0);
  addSocket(g, 'center', 0, -0.3, 0);
  return finishGear(g, { length: QUIVER.depth, axis: 'Y', origin: 'mouth', arrows: n });
}
