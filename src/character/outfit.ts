// Меховые части наряда: волчья голова-капюшон, накидка со шкурой на спину, манжеты, оторочка подола, мех сапог.
// Сначала строятся «основы» (тёмные оболочки), затем из них вырастают тысячи прядей (FurBuilder).

import * as THREE from 'three';
import { Rig, COAT } from './rig';
import {
  Surface, SkinHelper, vloft, gridSurface, axisLoft, ellipsoid, combineWeights, ringsFromKeys, Ring,
} from './surface';
import { FurBuilder, FurSpec, lin } from './fur';
import { BodyParts, coatRadius, ARM_KEYS } from './body';
import { lerp, smoothstep, clamp } from '../core/util';

export interface OutfitQuality {
  /** Множитель плотности меха: 1 — герой, 0.35 — враги/дальние. */
  fur: number;
}

export interface FurOutfit {
  wolf: Surface;
  furBase: Surface;
  fur: Surface;
  cuffs: Surface;
  blades: number;
}

/** Кусочно-линейная интерполяция по контрольным точкам [x, значение], x по возрастанию. */
export function pw(points: [number, number][], x: number): number {
  if (x <= points[0][0]) return points[0][1];
  for (let i = 0; i < points.length - 1; i++) {
    const [x0, y0] = points[i], [x1, y1] = points[i + 1];
    if (x <= x1) {
      const t = (x - x0) / (x1 - x0);
      return y0 + (y1 - y0) * (t * t * (3 - 2 * t));
    }
  }
  return points[points.length - 1][1];
}

const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
const col = (hex: number): [number, number, number] => lin(hex);

// ---------- Волчья голова ----------
function buildWolfHead(sk: SkinHelper): Surface {
  const headB = sk.one('head');
  const s = new Surface();
  const furC = col(0x4a423a);
  // череп
  s.append(ellipsoid({ center: V(0, 0, 0), radii: V(0.09, 0.076, 0.11), rows: 18, cols: 28, bone: headB, color: furC }));
  // брови/надбровье — придаёт угрюмый взгляд
  for (const sx of [1, -1]) {
    s.append(ellipsoid({ center: V(sx * 0.047, 0.036, 0.074), radii: V(0.034, 0.014, 0.032), rows: 8, cols: 12, bone: headB, color: col(0x3a332d), rot: new THREE.Euler(0.25, sx * -0.25, sx * 0.2) }));
  }
  // морда
  s.append(
    axisLoft({
      from: V(0, 0, 0.05), dir: V(0, 0, 1), up: V(0, 1, 0), cols: 20, bone: headB,
      rings: [
        { t: 0.0, rx: 0.068, rz: 0.058, oz: 0.0 },
        { t: 0.05, rx: 0.06, rz: 0.053, oz: -0.004 },
        { t: 0.1, rx: 0.05, rz: 0.046, oz: -0.01 },
        { t: 0.15, rx: 0.042, rz: 0.039, oz: -0.014 },
        { t: 0.195, rx: 0.036, rz: 0.033, oz: -0.017 },
        { t: 0.215, rx: 0.028, rz: 0.026, oz: -0.018 },
        { t: 0.225, rx: 0.012, rz: 0.012, oz: -0.018 },
      ],
      color: () => furC,
    }),
  );
  // верхние губы по бокам морды
  for (const sx of [1, -1]) {
    s.append(ellipsoid({ center: V(sx * 0.036, -0.03, 0.15), radii: V(0.02, 0.016, 0.06), rows: 8, cols: 12, bone: headB, color: col(0x51483f), rot: new THREE.Euler(0, sx * 0.06, 0) }));
  }
  // нос
  s.append(ellipsoid({ center: V(0, -0.016, 0.272), radii: V(0.026, 0.018, 0.017), rows: 10, cols: 14, bone: headB, color: col(0x0c0b0b) }));
  // глаза (янтарные)
  for (const sx of [1, -1]) {
    s.append(ellipsoid({ center: V(sx * 0.053, 0.018, 0.088), radii: V(0.0105, 0.007, 0.009), rows: 8, cols: 12, bone: headB, color: col(0xc78a2a), rot: new THREE.Euler(0, sx * 0.5, sx * -0.3) }));
  }
  // уши
  for (const sx of [1, -1]) {
    const eb = combineWeights([headB, sk.one(sx > 0 ? 'earL' : 'earR')], [0.35, 0.65]);
    const dir = V(sx * 0.2, 1, -0.28).normalize();
    s.append(
      axisLoft({
        from: V(sx * 0.058, 0.05, -0.045), dir, up: V(0, 0, 1), cols: 14,
        bone: (i) => (i < 2 ? combineWeights([headB, eb], [0.6, 0.4]) : eb),
        rings: [
          { t: 0.0, rx: 0.037, rz: 0.018 },
          { t: 0.03, rx: 0.035, rz: 0.018 },
          { t: 0.07, rx: 0.024, rz: 0.012 },
          { t: 0.098, rx: 0.006, rz: 0.004 },
          { t: 0.104, rx: 0.001, rz: 0.001 },
        ],
        color: (i, j) => (j / 14 > 0.5 ? col(0x9a8e7d) : col(0x3c352f)),
      }),
    );
  }
  // посадка на голову: чуть вперёд-вниз
  const m = new THREE.Matrix4().makeTranslation(0, 1.806, 0.006).multiply(new THREE.Matrix4().makeRotationX(0.2));
  s.transform(m);
  return s;
}

// ---------- Капюшон вокруг лица ----------
function buildHoodShell(sk: SkinHelper): Surface {
  const c = V(0, 1.69, -0.012), R = V(0.137, 0.146, 0.142);
  const rows = 26, cols = 34;
  const phi0 = 0.32, phi1 = 1.98;
  const open: [number, number][] = [[1.55, 0.0], [1.58, 0.3], [1.62, 0.6], [1.66, 0.56], [1.71, 0.5], [1.76, 0.62], [1.82, 1.05]];
  return gridSurface({
    rows, cols, wrap: false,
    fn: (i, j) => {
      const phi = lerp(phi0, phi1, i / (rows - 1));
      const y = c.y + R.y * Math.cos(phi);
      const th0 = pw(open, y);
      const th = lerp(th0, Math.PI * 2 - th0, j / (cols - 1));
      const p = V(c.x + R.x * Math.sin(phi) * Math.sin(th), y, c.z + R.z * Math.sin(phi) * Math.cos(th));
      const b = sk.chainY(y, [['head', 1.6], ['neck', 1.5], ['chest', 0]], 0.06);
      // кромка у лица — длиннее и гуще
      const edge = 1 - smoothstep(0, 0.35, Math.min(j / (cols - 1), 1 - j / (cols - 1))) * 0.0;
      return { p, u: j / (cols - 1), v: i / (rows - 1), b: b.b, w: b.w, color: lin(0x2f2924), f: edge };
    },
  });
}

// ---------- Накидка (мантия) и хвост шкуры на спину ----------
function buildMantleShell(sk: SkinHelper): Surface {
  const keys = [
    { y: 1.625, rx: 0.12, rz: 0.118, cz: -0.01 },
    { y: 1.57, rx: 0.155, rz: 0.148, cz: -0.02 },
    { y: 1.5, rx: 0.245, rz: 0.165, cz: -0.03 },
    { y: 1.41, rx: 0.3, rz: 0.19, cz: -0.04 },
    { y: 1.3, rx: 0.285, rz: 0.17, cz: -0.045 },
    { y: 1.15, rx: 0.25, rz: 0.15, cz: -0.045 },
    { y: 0.98, rx: 0.2, rz: 0.14, cz: -0.04 },
  ];
  const rings = ringsFromKeys(keys, 34);
  const open: [number, number][] = [[0.98, 2.55], [1.15, 2.25], [1.3, 1.9], [1.41, 1.35], [1.5, 0.9], [1.57, 0.62], [1.625, 0.55]];
  return vloft({
    rings, cols: 40, wrap: false,
    th0: (y) => pw(open, y),
    th1: (y) => Math.PI * 2 - pw(open, y),
    skin: (y, th) => {
      const sx = Math.sin(th);
      const ax = Math.abs(sx);
      const S = sx > 0 ? 'L' : 'R';
      const base = sk.chainY(y, [['head', 1.6], ['neck', 1.52], ['chest', 0]], 0.05);
      const pk = 0.62 * smoothstep(1.38, 1.05, y) * (1 - smoothstep(0.35, 0.8, ax));
      const sideK = 0.55 * smoothstep(0.55, 0.9, ax) * smoothstep(1.47, 1.36, y) * (1 - smoothstep(1.12, 0.95, y));
      const shK = 0.45 * smoothstep(0.35, 0.9, ax) * smoothstep(1.34, 1.46, y);
      const pelt = sk.chainY(y, [['pelt_1', 1.31], ['pelt_2', 1.135], ['pelt_3', 0.975], ['pelt_4', 0]], 0.05);
      const side = sk.chainY(y, [[`pelt${S}_1`, 1.375], [`pelt${S}_2`, 1.27], [`pelt${S}_3`, 0]], 0.05);
      const shoulder = sk.one(`shoulder${S}`);
      const rest = 1 - pk - sideK - shK;
      return combineWeights([base, pelt, side, shoulder], [Math.max(rest, 0.05), pk, sideK, shK]);
    },
    color: () => lin(0x2f2924),
    f: () => 1,
  });
}

// ---------- Меховые манжеты на рукавах ----------
function buildCuffs(sk: SkinHelper): Surface {
  const s = new Surface();
  for (const [sx, S] of [[1, 'L'], [-1, 'R']] as const) {
    const keys = ARM_KEYS(sx);
    const last = keys[keys.length - 1];
    const rings: Ring[] = [0.955, 0.94, 0.89, 0.875].map((y, i) => ({
      y, cx: last.cx! + (0.9 - y) * 0.06, rx: last.rx + (i === 0 || i === 3 ? 0.005 : 0.012), rz: last.rz + (i === 0 || i === 3 ? 0.005 : 0.012),
    }));
    s.append(
      vloft({
        rings, cols: 18, wrap: true,
        skin: (y) => sk.chainY(y, [[`lowerArm${S}`, 0.86], [`hand${S}`, 0]], 0.03),
        color: () => lin(0x2a1e15),
        f: () => 1,
      }),
    );
  }
  return s;
}

// ---------- Оторочка подола ----------
function buildHemTrim(sk: SkinHelper): Surface {
  const s = new Surface();
  const n = 5;
  const ys = [0.6, 0.575, 0.55, 0.535, 0.525];
  for (const [side, th0, th1, k] of [['L', -0.1, Math.PI, 1.0], ['R', -Math.PI, 0.1, 1.012]] as const) {
    const rings: Ring[] = ys.map((y, i) => {
      const r = coatRadius(y);
      const bulge = i === 0 || i === n - 1 ? 0.004 : 0.011;
      return { y, rx: (r.rx + bulge) * k, rz: (r.rz + bulge) * k, cz: r.cz };
    });
    s.append(
      vloft({
        rings, cols: 22, wrap: false, th0, th1,
        skin: (y, th) => {
          const a = (Math.abs(th) * 180) / Math.PI;
          const tag = a < 60 ? 'F' : a < 122 ? 'S' : 'B';
          const tY = smoothstep(1.03, 0.64, y);
          const legW = 0.42 * tY * (0.45 + 0.55 * Math.abs(Math.cos(th)));
          const cb = sk.chainY(y, [[`skirt${tag}${side}_1`, 0.88], [`skirt${tag}${side}_2`, 0.66], [`skirt${tag}${side}_3`, 0]], 0.08);
          return combineWeights([sk.one(`upperLeg${side}`), cb], [legW, 1 - legW]);
        },
        color: () => lin(0x2a1e15),
        f: () => 1,
      }),
    );
  }
  return s;
}

// ---------- Общая сборка ----------
export function buildFurOutfit(rig: Rig, sk: SkinHelper, body: BodyParts, q: OutfitQuality): FurOutfit {
  const wolf = buildWolfHead(sk);
  const hood = buildHoodShell(sk);
  const mantle = buildMantleShell(sk);
  const cuffs = buildCuffs(sk);
  const hem = buildHemTrim(sk);
  const furBase = new Surface().append(hood).append(mantle);
  cuffs.append(hem);

  const fb = new FurBuilder();
  const D = q.fur;
  const down = V(0, -1, 0);
  const wolfFur = [[0x8f8577, 3], [0x6d6256, 3], [0xb0a592, 2], [0x4a4036, 2], [0xd2c6ae, 1]] as [number, number][];
  const darkFur = [[0x7a6f62, 3], [0x5a4f45, 3], [0x948a7a, 2], [0x3b332c, 2], [0xb8ad98, 0.7]] as [number, number][];
  const bootFur = [[0xa89983, 3], [0x857662, 3], [0xc3b69d, 2], [0x62564a, 1.5], [0xd8cdb6, 0.7]] as [number, number][];
  const trimFur = [[0x6a5646, 3], [0x85705a, 2], [0x4b3b2f, 2.5], [0xa38d74, 0.8]] as [number, number][];

  // голова волка: короткий плотный мех, расчёсан назад-вниз
  fb.emit(wolf, { density: 14000 * D, length: [0.016, 0.034], width: [0.008, 0.013], lift: 0.5, droop: 0.25, comb: V(0, -0.35, -1), palette: wolfFur, seed: 11, jitter: 0.4, clumpSize: 0.015 });
  // капюшон — длиннее, ложится вниз
  fb.emit(hood, { density: 14000 * D, length: [0.045, 0.09], width: [0.012, 0.02], lift: 0.42, droop: 0.7, comb: down, palette: darkFur, seed: 12, jitter: 0.4, rootDarken: 0.5 });
  // мантия
  fb.emit(mantle, { density: 14000 * D, length: [0.055, 0.12], width: [0.013, 0.022], lift: 0.42, droop: 0.75, comb: down, palette: wolfFur, seed: 13, jitter: 0.4, rootDarken: 0.5, clumpSize: 0.032 });
  // манжеты и подол
  fb.emit(cuffs, { density: 13000 * D, length: [0.03, 0.06], width: [0.009, 0.015], lift: 0.6, droop: 0.55, comb: down, palette: trimFur, seed: 14, clumpSize: 0.02 });
  // сапоги: клочковатый мех от голенища до стопы
  const boots = body.boots;
  const mask = boots.furF.slice();
  for (let i = 0; i < boots.vertexCount; i++) {
    const y = boots.positions[i * 3 + 1];
    mask[i] = y < 0.03 ? 0 : 1;
  }
  const bootsFurSurf = new Surface();
  Object.assign(bootsFurSurf, boots, { furF: mask });
  fb.emit(bootsFurSurf, { density: 9000 * D, length: [0.04, 0.09], width: [0.012, 0.02], lift: 0.45, droop: 0.65, comb: down, palette: bootFur, seed: 15, jitter: 0.4, rootDarken: 0.55, clumpSize: 0.03 });

  return { wolf, furBase, fur: fb.out, cuffs, blades: fb.blades };
}

export { clamp as _clamp, COAT as _COAT };
