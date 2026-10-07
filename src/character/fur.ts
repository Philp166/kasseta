// Мех: тысячи тонких «лезвий-прядей» с градиентом цвета, запечённых в один SkinnedMesh.
// Каждая прядь привязана к тем же костям, что и поверхность, из которой растёт, поэтому мех
// двигается вместе с телом и качается вместе с пружинными костями (хвост шкуры, подол, волосы).

import * as THREE from 'three';
import { Surface } from './surface';
import { RNG, clamp } from '../core/util';

export interface FurSpec {
  /** Прядей на квадратный метр. */
  density: number;
  length: [number, number];
  width: [number, number];
  /** 0 — пряди лежат вдоль поверхности, 1 — торчат перпендикулярно. */
  lift: number;
  /** Сколько пряди «заваливается» по направлению расчёсывания (0..1). */
  droop: number;
  /** Направление расчёсывания (в системе координат модели). */
  comb: THREE.Vector3;
  /** Палитра sRGB (hex) с весами. */
  palette: [number, number][];
  rootDarken?: number;
  tipLighten?: number;
  /** Разброс направлений. */
  jitter?: number;
  seed?: number;
  /** Дополнительный множитель плотности по вершинам (берётся из Surface.furF). */
  useVertexF?: boolean;
  /** Размер клочка (м) и сила общего наклона прядей внутри клочка. */
  clumpSize?: number;
  clump?: number;
}

const _c = new THREE.Color();
export function lin(hex: number): [number, number, number] {
  _c.setHex(hex);
  return [_c.r, _c.g, _c.b];
}

function hashCell(ix: number, iy: number, iz: number, seed: number): number {
  let h = Math.imul(ix, 374761393) ^ Math.imul(iy, 668265263) ^ Math.imul(iz, 1103515245) ^ Math.imul(seed, 2246822519);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

export class FurBuilder {
  readonly out = new Surface();
  blades = 0;

  emit(surf: Surface, spec: FurSpec): void {
    const rng = new RNG((spec.seed ?? 1) * 7919 + surf.vertexCount);
    const pal = spec.palette.map(([hex, w]) => ({ c: lin(hex), w }));
    const totalW = pal.reduce((s, p) => s + p.w, 0);
    const pickColor = (): [number, number, number] => {
      let r = rng.next() * totalW;
      for (const p of pal) { r -= p.w; if (r <= 0) return p.c; }
      return pal[0].c;
    };
    const P = surf.positions, N = surf.normals, I = surf.indices, F = surf.furF;
    const rootD = spec.rootDarken ?? 0.45;
    const tipL = spec.tipLighten ?? 1.12;
    const jit = spec.jitter ?? 0.35;
    const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();
    const n = new THREE.Vector3(), t = new THREE.Vector3(), bi = new THREE.Vector3();
    const dir = new THREE.Vector3(), dir2 = new THREE.Vector3(), tmp = new THREE.Vector3();
    const comb = spec.comb.clone().normalize();
    const grav = new THREE.Vector3(0, -1, 0);

    for (let tri = 0; tri < I.length; tri += 3) {
      const i0 = I[tri], i1 = I[tri + 1], i2 = I[tri + 2];
      a.set(P[i0 * 3], P[i0 * 3 + 1], P[i0 * 3 + 2]);
      b.set(P[i1 * 3], P[i1 * 3 + 1], P[i1 * 3 + 2]);
      c.set(P[i2 * 3], P[i2 * 3 + 1], P[i2 * 3 + 2]);
      tmp.subVectors(b, a); bi.subVectors(c, a);
      const area = tmp.cross(bi).length() * 0.5;
      const fAvg = spec.useVertexF === false ? 1 : (F[i0] + F[i1] + F[i2]) / 3;
      if (fAvg <= 0.001 || area < 1e-9) continue;
      const expect = area * spec.density * fAvg;
      let count = Math.floor(expect);
      if (rng.next() < expect - count) count++;
      for (let k = 0; k < count; k++) {
        let u = rng.next(), v = rng.next();
        if (u + v > 1) { u = 1 - u; v = 1 - v; }
        const w0 = 1 - u - v, w1 = u, w2 = v;
        const px = a.x * w0 + b.x * w1 + c.x * w2;
        const py = a.y * w0 + b.y * w1 + c.y * w2;
        const pz = a.z * w0 + b.z * w1 + c.z * w2;
        n.set(
          N[i0 * 3] * w0 + N[i1 * 3] * w1 + N[i2 * 3] * w2,
          N[i0 * 3 + 1] * w0 + N[i1 * 3 + 1] * w1 + N[i2 * 3 + 1] * w2,
          N[i0 * 3 + 2] * w0 + N[i1 * 3 + 2] * w1 + N[i2 * 3 + 2] * w2,
        ).normalize();
        // местные касательные
        t.set(rng.gauss(), rng.gauss(), rng.gauss());
        t.addScaledVector(n, -t.dot(n)).normalize();
        // клочок: общая для соседних прядей «судьба» (цвет, наклон, длина)
        const cs = spec.clumpSize ?? 0.028;
        const cx = Math.floor(px / cs), cy = Math.floor(py / cs), cz = Math.floor(pz / cs);
        const h1 = hashCell(cx, cy, cz, (spec.seed ?? 1) + 1), h2 = hashCell(cx, cy, cz, (spec.seed ?? 1) + 2);
        const h3 = hashCell(cx, cy, cz, (spec.seed ?? 1) + 3), h4 = hashCell(cx, cy, cz, (spec.seed ?? 1) + 4);
        const clumpK = spec.clump ?? 0.55;
        // направление пряди: между нормалью и касательной плоскостью, смещённое к расчёсыванию
        const combT = tmp.copy(comb).addScaledVector(n, -comb.dot(n));
        const cl = combT.length();
        if (cl > 1e-4) combT.multiplyScalar(1 / cl);
        const lift = clamp(spec.lift + rng.gauss() * 0.12, 0.05, 1);
        dir.copy(n).multiplyScalar(lift).addScaledVector(cl > 1e-4 ? combT : t, (1 - lift) * 1.0 + 0.25);
        // общий наклон клочка вокруг нормали
        const ang = h1 * Math.PI * 2;
        tmp.set(Math.cos(ang), Math.sin(ang), h2 * 2 - 1).addScaledVector(n, 0);
        tmp.addScaledVector(n, -tmp.dot(n));
        if (tmp.lengthSq() > 1e-6) tmp.normalize();
        dir.addScaledVector(tmp, clumpK * (0.4 + h3 * 0.8));
        dir.addScaledVector(t, rng.gauss() * jit * 0.6).addScaledVector(n, rng.gauss() * jit * 0.3).normalize();
        const len = rng.range(spec.length[0], spec.length[1]) * (0.8 + h4 * 0.55);
        const wid = rng.range(spec.width[0], spec.width[1]);
        // вторая половина пряди заваливается по расчёсыванию + гравитации
        dir2.copy(dir).addScaledVector(comb, spec.droop * 0.6).addScaledVector(grav, spec.droop * 0.9).normalize();
        // ширина-вектор
        bi.crossVectors(dir, t);
        if (bi.lengthSq() < 1e-6) bi.crossVectors(dir, n);
        bi.normalize();
        // положения
        const mx = px + dir.x * len * 0.5, my = py + dir.y * len * 0.5, mz = pz + dir.z * len * 0.5;
        const tx = mx + dir2.x * len * 0.55, ty = my + dir2.y * len * 0.55, tz = mz + dir2.z * len * 0.55;
        // нормаль для освещения — мягкая (поверхность + направление пряди)
        const nx = n.x * 0.7 + dir.x * 0.3, ny = n.y * 0.7 + dir.y * 0.3, nz = n.z * 0.7 + dir.z * 0.3;
        const nl = Math.hypot(nx, ny, nz) || 1;
        // цвет
        let base: [number, number, number];
        if (rng.next() < 0.75) {
          let r = h2 * totalW;
          base = pal[0].c;
          for (const p of pal) { r -= p.w; if (r <= 0) { base = p.c; break; } }
        } else base = pickColor();
        const br = 0.84 + rng.next() * 0.3 + (h3 - 0.5) * 0.12;
        const rc: [number, number, number] = [base[0] * br * rootD, base[1] * br * rootD, base[2] * br * rootD];
        const mc: [number, number, number] = [base[0] * br, base[1] * br, base[2] * br];
        const tc: [number, number, number] = [base[0] * br * tipL, base[1] * br * tipL, base[2] * br * tipL];
        // кость — по ближайшей вершине треугольника
        const iv = w0 >= w1 && w0 >= w2 ? i0 : w1 >= w2 ? i1 : i2;
        const o = this.out;
        const base0 = o.vertexCount;
        const hw = wid * 0.5;
        const verts: [number, number, number, [number, number, number]][] = [
          [px - bi.x * hw, py - bi.y * hw, pz - bi.z * hw, rc],
          [px + bi.x * hw, py + bi.y * hw, pz + bi.z * hw, rc],
          [mx - bi.x * hw * 0.7, my - bi.y * hw * 0.7, mz - bi.z * hw * 0.7, mc],
          [mx + bi.x * hw * 0.7, my + bi.y * hw * 0.7, mz + bi.z * hw * 0.7, mc],
          [tx, ty, tz, tc],
        ];
        for (let q = 0; q < 5; q++) {
          o.positions.push(verts[q][0], verts[q][1], verts[q][2]);
          o.normals.push(nx / nl, ny / nl, nz / nl);
          o.uvs.push(q & 1, q / 4);
          o.colors.push(verts[q][3][0], verts[q][3][1], verts[q][3][2]);
          o.skinIndex.push(surf.skinIndex[iv * 4], surf.skinIndex[iv * 4 + 1], surf.skinIndex[iv * 4 + 2], surf.skinIndex[iv * 4 + 3]);
          o.skinWeight.push(surf.skinWeight[iv * 4], surf.skinWeight[iv * 4 + 1], surf.skinWeight[iv * 4 + 2], surf.skinWeight[iv * 4 + 3]);
          o.furF.push(1);
          o.gScalar.push(0);
        }
        o.indices.push(base0, base0 + 1, base0 + 2, base0 + 1, base0 + 3, base0 + 2, base0 + 2, base0 + 3, base0 + 4);
        this.blades++;
      }
    }
    this.out.hasColor = true;
  }
}
