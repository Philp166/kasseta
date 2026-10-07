// Базовое тело и одежда: ноги, сапоги, кафтан (торс + рукава + подол), кулаки, пояс.
// Всё строится вертикальными лофтами (кольца-эллипсы по высоте) — это даёт чистые кольцевые рёбра для скиннинга.

import * as THREE from 'three';
import { Rig, COAT } from './rig';
import {
  Surface, SkinHelper, vloft, ringsFromKeys, axisLoft, ellipsoid, pathTube, combineWeights, Ring,
} from './surface';
import { HeadShape, buildEars, buildNeck } from './head';
import { smoothstep, clamp, lerp } from '../core/util';

export interface BodyParts {
  skin: Surface;
  coat: Surface;
  trousers: Surface;
  boots: Surface;
  belt: Surface;
}

type Key = { y: number; rx: number; rz: number; cx?: number; cz?: number };

// Крой по измеренным сечениям человека (tools/build-human.mjs → profiles): кафтан свободный, зазор ≈ 2.5 см.
export const TORSO_KEYS: Key[] = [
  { y: 1.545, rx: 0.088, rz: 0.072, cz: 0.01 },
  { y: 1.50, rx: 0.176, rz: 0.104, cz: 0.002 },
  { y: 1.46, rx: 0.240, rz: 0.126, cz: -0.006 },
  { y: 1.42, rx: 0.262, rz: 0.15, cz: 0.0 },
  { y: 1.36, rx: 0.235, rz: 0.168, cz: 0.015 },
  { y: 1.30, rx: 0.224, rz: 0.163, cz: 0.018 },
  { y: 1.20, rx: 0.192, rz: 0.142, cz: 0.02 },
  { y: 1.10, rx: 0.172, rz: 0.127, cz: 0.037 },
  { y: 1.04, rx: 0.185, rz: 0.132, cz: 0.041 },
];

function evalKeys(keys: Key[], y: number): Key {
  const y0 = keys[0].y, y1 = keys[keys.length - 1].y;
  y = clamp(y, Math.min(y0, y1), Math.max(y0, y1));
  let k = 0;
  while (k < keys.length - 2 && y < keys[k + 1].y) k++;
  const a = keys[k], b = keys[k + 1];
  const t = clamp((y - a.y) / (b.y - a.y));
  const e = t * t * (3 - 2 * t);
  const m = (p: number, q: number) => p + (q - p) * e;
  return { y, rx: m(a.rx, b.rx), rz: m(a.rz, b.rz), cx: m(a.cx ?? 0, b.cx ?? 0), cz: m(a.cz ?? 0, b.cz ?? 0) };
}

/** Радиусы кафтана на высоте y: торс выше талии, колокол подола ниже. */
export function coatRadius(y: number): { rx: number; rz: number; cz: number } {
  if (y >= 1.04) {
    const k = evalKeys(TORSO_KEYS, y);
    return { rx: k.rx, rz: k.rz, cz: k.cz ?? 0 };
  }
  return COAT.radiusAt(y);
}

export const ARM_KEYS = (sx: number): Key[] => [
  { y: 1.47, rx: 0.1, rz: 0.115, cx: sx * 0.2 },
  { y: 1.4, rx: 0.105, rz: 0.13, cx: sx * 0.205 },
  { y: 1.28, rx: 0.088, rz: 0.098, cx: sx * 0.212 },
  { y: 1.13, rx: 0.076, rz: 0.078, cx: sx * 0.222 },
  { y: 1.0, rx: 0.068, rz: 0.07, cx: sx * 0.229 },
  { y: 0.9, rx: 0.062, rz: 0.064, cx: sx * 0.234 },
];

const arcU = (th: number, rx: number, rz: number) => (th * (rx + rz) * 0.5) / 0.4;
const vOf = (y: number) => (1.55 - y) / 0.4;

export function buildBody(rig: Rig, sk: SkinHelper, head: HeadShape, withSkin = true): BodyParts {
  const skin = new Surface();
  const coat = new Surface();
  const trousers = new Surface();
  const boots = new Surface();
  const belt = new Surface();

  // ---------- Кожа: голова, шея, уши ----------
  if (withSkin) {
    skin.append(head.build(sk));
    skin.append(buildNeck(sk));
    skin.append(buildEars(sk));
  }

  // ---------- Ноги ----------
  for (const [sx, S] of [[1, 'L'], [-1, 'R']] as const) {
    const cx = sx * 0.1;
    const trKeys: Key[] = [
      { y: 0.97, rx: 0.102, rz: 0.148, cx: sx * 0.104, cz: 0.02 },
      { y: 0.8, rx: 0.1, rz: 0.108, cx: sx * 0.101, cz: 0.005 },
      { y: 0.62, rx: 0.078, rz: 0.083, cx },
      { y: 0.5, rx: 0.072, rz: 0.078, cx },
      { y: 0.34, rx: 0.065, rz: 0.07, cx },
      { y: 0.2, rx: 0.062, rz: 0.066, cx },
    ];
    trousers.append(
      vloft({
        rings: ringsFromKeys(trKeys, 24), cols: 18, wrap: true,
        skin: (y) => sk.chainY(y, [[`upperLeg${S}`, 0.5], [`lowerLeg${S}`, 0.095], [`foot${S}`, 0]], 0.06),
        uv: (i, j, th) => [arcU(th, 0.08, 0.09), vOf(trKeys[0].y - (i / 23) * 0.77)],
        f: () => 0,
      }),
    );
    // Голенище сапога (мех будет нарощен поверх)
    const bKeys: Key[] = [
      { y: 0.5, rx: 0.103, rz: 0.108, cx, cz: 0.004 },
      { y: 0.47, rx: 0.094, rz: 0.1, cx, cz: 0.004 },
      { y: 0.3, rx: 0.087, rz: 0.094, cx, cz: 0.004 },
      { y: 0.16, rx: 0.083, rz: 0.091, cx, cz: 0.004 },
      { y: 0.09, rx: 0.082, rz: 0.093, cx, cz: 0.004 },
    ];
    boots.append(
      vloft({
        rings: ringsFromKeys(bKeys, 18), cols: 20, wrap: true,
        skin: (y) => sk.chainY(y, [[`upperLeg${S}`, 0.5], [`lowerLeg${S}`, 0.1], [`foot${S}`, 0]], 0.03),
        uv: (i, j, th) => [arcU(th, 0.09, 0.1), vOf(0.5 - (i / 17) * 0.41)],
        g: () => 1,
      }),
    );
    // Стопа вдоль +Z
    const footRings = [
      { t: 0.0, rx: 0.012, rz: 0.02, oz: 0.06 },
      { t: 0.012, rx: 0.05, rz: 0.055, oz: 0.06 },
      { t: 0.05, rx: 0.072, rz: 0.075, oz: 0.075 },
      { t: 0.11, rx: 0.083, rz: 0.08, oz: 0.08 },
      { t: 0.17, rx: 0.086, rz: 0.066, oz: 0.067 },
      { t: 0.24, rx: 0.084, rz: 0.052, oz: 0.054 },
      { t: 0.3, rx: 0.064, rz: 0.04, oz: 0.042 },
      { t: 0.335, rx: 0.032, rz: 0.028, oz: 0.03 },
      { t: 0.347, rx: 0.006, rz: 0.008, oz: 0.025 },
    ];
    boots.append(
      axisLoft({
        from: new THREE.Vector3(cx, 0, -0.1), dir: new THREE.Vector3(0, 0, 1), up: new THREE.Vector3(0, 1, 0),
        rings: footRings, cols: 20,
        bone: (i, j, t) => {
          const k = smoothstep(0.19, 0.25, t);
          return combineWeights([sk.one(`foot${S}`), sk.one(`toe${S}`)], [1 - k, k]);
        },
        uv: (i, j, t) => [j / 20 * 1.2, t / 0.3],
        f: 1,
      }),
    );
  }

  // ---------- Кафтан: торс ----------
  const nT = 26;
  const torsoRings = ringsFromKeys(TORSO_KEYS, nT);
  const torsoCols = 48;
  coat.append(
    vloft({
      rings: torsoRings, cols: torsoCols, wrap: true,
      skin: (y, th) => {
        const base = sk.chainY(y, [['neck', 1.49], ['chest', 1.16], ['spine', 1.05], ['hips', 0]], 0.05);
        const x = Math.sin(th);
        const sh = 0.4 * smoothstep(0.35, 0.95, Math.abs(x)) * smoothstep(1.36, 1.44, y);
        if (sh <= 0.001) return base;
        const side = x > 0 ? 'L' : 'R';
        return combineWeights([base, sk.one(`shoulder${side}`)], [1 - sh, sh]);
      },
      uv: (i, j, th) => [arcU(th, 0.18, 0.12), vOf(torsoRings[i].y)],
      f: (i) => (i < 3 ? 0.4 : 0.15),
    }),
  );

  // ---------- Кафтан: подол — две панели с запахом, разрезы спереди и сзади ----------
  const nS = 24;
  const hemRings: Ring[] = [];
  for (let i = 0; i < nS; i++) {
    const y = 1.04 + ((COAT.hemY - 1.04) * i) / (nS - 1);
    const r = coatRadius(y);
    hemRings.push({ y, rx: r.rx, rz: r.rz, cz: r.cz });
  }
  for (const [side, th0, th1, k] of [['L', -0.1, Math.PI, 1.0], ['R', -Math.PI, 0.1, 1.012]] as const) {
    const S = side;
    coat.append(
      vloft({
        rings: hemRings.map((r) => ({ ...r, rx: r.rx * k, rz: r.rz * k })),
        cols: 22, wrap: false, th0, th1,
        skin: (y, th) => {
          const a = (Math.abs(th) * 180) / Math.PI;
          const tag = a < 60 ? 'F' : a < 122 ? 'S' : 'B';
          const h = smoothstep(0.97, 1.04, y);
          const tY = smoothstep(1.03, 0.64, y);
          const legW = 0.42 * tY * (0.45 + 0.55 * Math.abs(Math.cos(th)));
          const chainW = Math.max(0, 1 - h - legW * (1 - h));
          const cb = sk.chainY(y, [[`skirt${tag}${S}_1`, 0.88], [`skirt${tag}${S}_2`, 0.66], [`skirt${tag}${S}_3`, 0]], 0.08);
          return combineWeights([sk.one('hips'), sk.one(`upperLeg${S}`), cb], [h, legW * (1 - h), chainW - 0]);
        },
        uv: (i, j, th) => [arcU(th, 0.22, 0.17), vOf(hemRings[i].y)],
        f: () => 0.1,
      }),
    );
  }

  // ---------- Кафтан: рукава ----------
  for (const [sx, S] of [[1, 'L'], [-1, 'R']] as const) {
    const keys = ARM_KEYS(sx);
    const rings = ringsFromKeys(keys, 22);
    coat.append(
      vloft({
        rings, cols: 18, wrap: true,
        skin: (y) => {
          const base = sk.chainY(y, [[`upperArm${S}`, 1.125], [`lowerArm${S}`, 0.855], [`hand${S}`, 0]], 0.06);
          const sh = 0.5 * smoothstep(1.41, 1.47, y);
          return sh > 0.001 ? combineWeights([base, sk.one(`shoulder${S}`)], [1 - sh, sh]) : base;
        },
        uv: (i, j, th) => [arcU(th, 0.075, 0.078), vOf(keys[0].y - (i / 21) * 0.57)],
        f: (i) => (i > 18 ? 0.5 : 0.2),
      }),
    );
  }

  // ---------- Кулаки (хват вокруг древка вдоль оси Z) ----------
  if (withSkin) for (const S of ['L', 'R'] as const) skin.append(buildFist(rig, sk, S));

  // ---------- Пояс ----------
  const bandRings = (y0: number, y1: number, off: number): Ring[] => {
    const ys = [y0, y0 - 0.004, y1 + 0.004, y1];
    const offs = [off * 0.4, off, off, off * 0.4];
    return ys.map((y, i) => {
      const r = coatRadius(y);
      return { y, rx: r.rx + offs[i], rz: r.rz + offs[i], cz: r.cz };
    });
  };
  for (const [y0, y1, off] of [[1.092, 1.016, 0.009], [0.995, 0.972, 0.007]] as const) {
    belt.append(
      vloft({
        rings: bandRings(y0, y1, off), cols: 48, wrap: true,
        skin: (y) => sk.chainY(y, [['spine', 1.05], ['hips', 0]], 0.03),
        uv: (i, j, th) => [arcU(th, 0.17, 0.12) * 1.4, 0.5],
        f: () => 0,
      }),
    );
  }
  return { skin, coat, trousers, boots, belt };
}

/** Кулак вокруг древка: ладонь, четыре пальца дугой и большой палец. Ось хвата — Z. */
export function buildFist(rig: Rig, sk: SkinHelper, S: 'L' | 'R'): Surface {
  const sx = S === 'L' ? 1 : -1;
  const W = rig.rest(`hand${S}`);
  const nDir = -sx; // нормаль ладони направлена к бедру
  const bone = sk.one(`hand${S}`);
  const s = new Surface();
  s.append(
    ellipsoid({
      center: W.clone().add(new THREE.Vector3(nDir * 0.004, -0.043, 0.0)),
      radii: new THREE.Vector3(0.022, 0.047, 0.036), rows: 10, cols: 14, bone, f: 0,
    }),
  );
  const C = { n: 0.01, d: -0.105 }, R = 0.03;
  for (let f = 0; f < 4; f++) {
    const z = 0.027 - 0.0185 * f;
    const rr = 0.0088 - 0.0004 * f;
    const pts: THREE.Vector3[] = [];
    for (let k = 0; k <= 7; k++) {
      const a = ((140 + (235 * k) / 7) * Math.PI) / 180;
      pts.push(new THREE.Vector3(W.x + nDir * (C.n + R * Math.cos(a)), W.y + C.d + R * Math.sin(a), W.z + z));
    }
    s.append(pathTube({ pts, radius: rr, sides: 7, segs: 14, bone, capped: true, f: 0 }));
  }
  // большой палец: от основания вперёд поверх хвата
  const thumb = [
    new THREE.Vector3(W.x + nDir * 0.014, W.y - 0.04, W.z + 0.034),
    new THREE.Vector3(W.x + nDir * 0.026, W.y - 0.075, W.z + 0.046),
    new THREE.Vector3(W.x + nDir * 0.045, W.y - 0.098, W.z + 0.04),
    new THREE.Vector3(W.x + nDir * 0.052, W.y - 0.112, W.z + 0.024),
  ];
  s.append(pathTube({ pts: thumb, radius: (t) => lerp(0.0105, 0.008, t), sides: 7, segs: 10, bone, capped: true, f: 0 }));
  return s;
}

export { lerp as _lerp };
