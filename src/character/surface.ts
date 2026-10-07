// Параметрические поверхности со скиннингом. Из них собирается тело, одежда и снаряжение.
// Вершина = позиция + UV + до 4 костей с весами + цвет + пара служебных скаляров (для меха).

import * as THREE from 'three';
import { Rig } from './rig';
import { DEG, clamp, smoothstep } from '../core/util';

export interface Vtx {
  p: THREE.Vector3;
  u: number;
  v: number;
  /** Индексы костей и веса (до 4, сумма нормализуется). */
  b: number[];
  w: number[];
  color?: [number, number, number];
  /** Множитель плотности/длины меха (0 = мех не растёт). */
  f?: number;
  /** Произвольный скаляр (например, «ранимость» участка). */
  g?: number;
}

export type Weights = [number, number][]; // [индекс кости, вес]

/** Оставить 4 самых тяжёлых влияния и нормализовать. */
export function packWeights(w: Weights): { b: number[]; w: number[] } {
  const arr = w.filter(([, x]) => x > 1e-4).sort((a, b) => b[1] - a[1]).slice(0, 4);
  if (arr.length === 0) return { b: [0, 0, 0, 0], w: [1, 0, 0, 0] };
  const sum = arr.reduce((s, [, x]) => s + x, 0);
  const b = arr.map(([i]) => i);
  const ww = arr.map(([, x]) => x / sum);
  while (b.length < 4) { b.push(0); ww.push(0); }
  return { b, w: ww };
}

export class Surface {
  positions: number[] = [];
  normals: number[] = [];
  uvs: number[] = [];
  colors: number[] = [];
  skinIndex: number[] = [];
  skinWeight: number[] = [];
  furF: number[] = [];
  gScalar: number[] = [];
  indices: number[] = [];
  hasColor = false;

  get vertexCount(): number {
    return this.positions.length / 3;
  }

  append(o: Surface): this {
    const base = this.vertexCount;
    this.positions.push(...o.positions);
    this.normals.push(...o.normals);
    this.uvs.push(...o.uvs);
    this.skinIndex.push(...o.skinIndex);
    this.skinWeight.push(...o.skinWeight);
    this.furF.push(...o.furF);
    this.gScalar.push(...o.gScalar);
    if (this.hasColor || o.hasColor) {
      // выровнять цвета: если у одной из поверхностей цветов нет — белый
      if (!this.hasColor) { this.colors = new Array(base * 3).fill(1); this.hasColor = true; }
      if (o.hasColor) this.colors.push(...o.colors);
      else for (let i = 0; i < o.vertexCount; i++) this.colors.push(1, 1, 1);
    }
    for (const i of o.indices) this.indices.push(i + base);
    return this;
  }

  /** Применить матрицу к позициям и нормалям (кости не меняются). */
  transform(m: THREE.Matrix4): this {
    const v = new THREE.Vector3();
    const nm = new THREE.Matrix3().getNormalMatrix(m);
    for (let i = 0; i < this.positions.length; i += 3) {
      v.set(this.positions[i], this.positions[i + 1], this.positions[i + 2]).applyMatrix4(m);
      this.positions[i] = v.x; this.positions[i + 1] = v.y; this.positions[i + 2] = v.z;
      v.set(this.normals[i], this.normals[i + 1], this.normals[i + 2]).applyMatrix3(nm).normalize();
      this.normals[i] = v.x; this.normals[i + 1] = v.y; this.normals[i + 2] = v.z;
    }
    return this;
  }

  /** Переназначить все вершины на одну кость (жёсткая привязка). */
  bindRigid(boneIdx: number): this {
    const n = this.vertexCount;
    this.skinIndex = [];
    this.skinWeight = [];
    for (let i = 0; i < n; i++) this.skinIndex.push(boneIdx, 0, 0, 0), this.skinWeight.push(1, 0, 0, 0);
    return this;
  }

  /** Подмешать произвольный множитель к цвету (затемнение/осветление). */
  tint(r: number, g: number, b: number): this {
    if (!this.hasColor) { this.colors = new Array(this.vertexCount * 3).fill(1); this.hasColor = true; }
    for (let i = 0; i < this.colors.length; i += 3) {
      this.colors[i] *= r; this.colors[i + 1] *= g; this.colors[i + 2] *= b;
    }
    return this;
  }

  toGeometry(regionOfBone?: Int8Array): THREE.BufferGeometry {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.positions, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.normals, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uvs, 2));
    if (this.hasColor) g.setAttribute('color', new THREE.Float32BufferAttribute(this.colors, 3));
    g.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(this.skinIndex, 4));
    g.setAttribute('skinWeight', new THREE.Float32BufferAttribute(this.skinWeight, 4));
    if (regionOfBone) {
      // веса регионов тела по влиянию костей — нужны шейдеру повреждений
      const n = this.vertexCount;
      const A = new Float32Array(n * 3), B = new Float32Array(n * 3);
      for (let i = 0; i < n; i++) {
        for (let k = 0; k < 4; k++) {
          const w = this.skinWeight[i * 4 + k];
          if (w <= 0) continue;
          const r = regionOfBone[this.skinIndex[i * 4 + k]];
          if (r < 0) continue;
          if (r < 3) A[i * 3 + r] += w; else B[i * 3 + (r - 3)] += w;
        }
      }
      g.setAttribute('aRegA', new THREE.BufferAttribute(A, 3));
      g.setAttribute('aRegB', new THREE.BufferAttribute(B, 3));
    }
    g.setIndex(this.indices);
    g.computeBoundingSphere();
    g.computeBoundingBox();
    return g;
  }
}

export interface GridOpts {
  rows: number;
  cols: number;
  /** Замкнуть кольцо по j (добавляет шовную вершину). */
  wrap?: boolean;
  /** Перевернуть ориентацию (нормали внутрь). */
  flip?: boolean;
  fn: (i: number, j: number) => Vtx;
}

/** Сетка rows × cols (+1 шовный столбец при wrap), нормали сглажены, включая шов. */
export function gridSurface(o: GridOpts): Surface {
  const { rows, cols, wrap = false, flip = false } = o;
  const stride = wrap ? cols + 1 : cols;
  const s = new Surface();
  const P: THREE.Vector3[] = new Array(rows * stride);
  for (let i = 0; i < rows; i++) {
    for (let j = 0; j < stride; j++) {
      const v = o.fn(i, j);
      P[i * stride + j] = v.p;
      s.positions.push(v.p.x, v.p.y, v.p.z);
      s.uvs.push(v.u, v.v);
      const b = v.b, w = v.w;
      for (let k = 0; k < 4; k++) {
        s.skinIndex.push(b[k] ?? 0);
        s.skinWeight.push(w[k] ?? 0);
      }
      if (v.color) {
        if (!s.hasColor) { s.hasColor = true; s.colors = new Array(i * stride * 3 + j * 3).fill(1); }
        s.colors.push(...v.color);
      } else if (s.hasColor) s.colors.push(1, 1, 1);
      s.furF.push(v.f ?? 1);
      s.gScalar.push(v.g ?? 0);
    }
  }
  const at = (i: number, j: number) => {
    if (wrap) {
      const jj = ((j % cols) + cols) % cols; // шов: сравниваем по уникальным столбцам
      return P[clamp(i, 0, rows - 1) * stride + jj];
    }
    return P[clamp(i, 0, rows - 1) * stride + clamp(j, 0, cols - 1)];
  };
  const dU = new THREE.Vector3(), dV = new THREE.Vector3(), n = new THREE.Vector3();
  const nrm: THREE.Vector3[] = new Array(rows * stride);
  for (let i = 0; i < rows; i++) {
    for (let j = 0; j < stride; j++) {
      dU.subVectors(at(i, j + 1), at(i, j - 1));
      dV.subVectors(at(i + 1, j), at(i - 1, j));
      n.crossVectors(dV, dU);
      if (n.lengthSq() < 1e-14) {
        // вырожденный полюс: берём нормаль соседнего ряда
        const k = i === 0 ? 1 : rows - 2;
        const q = nrm[clamp(k, 0, rows - 1) * stride + j];
        n.copy(q ?? new THREE.Vector3(0, 1, 0));
      }
      n.normalize();
      if (flip) n.negate();
      nrm[i * stride + j] = n.clone();
    }
  }
  // Нормали вырожденных рядов (если считались раньше соседей) — перепроверить.
  for (let i = 0; i < rows; i++) {
    for (let j = 0; j < stride; j++) {
      const q = nrm[i * stride + j];
      if (q.lengthSq() < 0.5) {
        const k = i === 0 ? 1 : i === rows - 1 ? rows - 2 : i;
        q.copy(nrm[k * stride + j]);
      }
      s.normals.push(q.x, q.y, q.z);
    }
  }
  const nj = wrap ? cols : cols - 1;
  for (let i = 0; i < rows - 1; i++) {
    for (let j = 0; j < nj; j++) {
      const a = i * stride + j, b = a + 1, c = a + stride, d = c + 1;
      if (!flip) s.indices.push(a, c, b, b, c, d);
      else s.indices.push(a, b, c, b, d, c);
    }
  }
  return s;
}

// ---------- Помощники весов ----------

export class SkinHelper {
  constructor(public rig: Rig) {}

  /** Один костяк. */
  one(name: string): { b: number[]; w: number[] } {
    return packWeights([[this.rig.idx(name), 1]]);
  }

  /**
   * Цепочка костей сверху вниз вдоль Y: каждая кость действует до yEnd, на границе — плавный переход шириной blend.
   * segs: [[кость, yEnd], ...] где yEnd последней игнорируется.
   */
  chainY(y: number, segs: [string, number][], blend = 0.05): { b: number[]; w: number[] } {
    const w: Weights = [];
    let remaining = 1;
    for (let k = 0; k < segs.length - 1; k++) {
      const yEnd = segs[k][1];
      // доля следующей кости на границе
      const toNext = smoothstep(yEnd + blend, yEnd - blend, y);
      const me = remaining * (1 - toNext);
      if (me > 0) w.push([this.rig.idx(segs[k][0]), me]);
      remaining *= toNext;
      if (remaining < 1e-4) break;
    }
    if (remaining > 1e-4) w.push([this.rig.idx(segs[segs.length - 1][0]), remaining]);
    return packWeights(w);
  }

  mix(a: [string, number], b: [string, number], c?: [string, number], d?: [string, number]) {
    const w: Weights = [[this.rig.idx(a[0]), a[1]], [this.rig.idx(b[0]), b[1]]];
    if (c) w.push([this.rig.idx(c[0]), c[1]]);
    if (d) w.push([this.rig.idx(d[0]), d[1]]);
    return packWeights(w);
  }
}

// ---------- Готовые формы ----------

export interface Ring {
  y: number;
  rx: number;
  rz: number;
  cx?: number;
  cz?: number;
}

export interface VloftOpts {
  rings: Ring[]; // сверху вниз (y убывает) — при flip=false нормали наружу
  cols: number;
  wrap?: boolean;
  /** Диапазон углов (θ от +Z к +X), если не замкнуто. Может зависеть от высоты. */
  th0?: number | ((y: number, i: number) => number);
  th1?: number | ((y: number, i: number) => number);
  skin: (y: number, th: number, i: number, j: number) => { b: number[]; w: number[] };
  /** Радиальная модуляция: множитель радиуса и смещение по Y. */
  mod?: (th: number, y: number, i: number, j: number) => { r?: number; dy?: number; dz?: number };
  uv?: (i: number, j: number, th: number) => [number, number];
  color?: (i: number, j: number, y: number, th: number) => [number, number, number];
  f?: (i: number, j: number, y: number, th: number) => number;
  g?: (i: number, j: number, y: number, th: number) => number;
  flip?: boolean;
}

/** Вертикальный лофт: кольца-эллипсы по высоте. Основа торса, рук, ног, сапог и кафтана. */
export function vloft(o: VloftOpts): Surface {
  const rows = o.rings.length;
  const wrap = !!o.wrap;
  const getT0 = (y: number, i: number) => (typeof o.th0 === 'function' ? o.th0(y, i) : o.th0 ?? 0);
  const getT1 = (y: number, i: number) => (typeof o.th1 === 'function' ? o.th1(y, i) : o.th1 ?? Math.PI * 2);
  return gridSurface({
    rows,
    cols: o.cols,
    wrap,
    flip: o.flip,
    fn: (i, j) => {
      const R = o.rings[i];
      const t = wrap ? j / o.cols : j / (o.cols - 1);
      const th = wrap ? t * Math.PI * 2 : getT0(R.y, i) + (getT1(R.y, i) - getT0(R.y, i)) * t;
      const m = o.mod ? o.mod(th, R.y, i, j) : {};
      const r = m.r ?? 1;
      const p = new THREE.Vector3(
        (R.cx ?? 0) + Math.sin(th) * R.rx * r,
        R.y + (m.dy ?? 0),
        (R.cz ?? 0) + Math.cos(th) * R.rz * r + (m.dz ?? 0),
      );
      const sk = o.skin(R.y, th, i, j);
      const uv = o.uv ? o.uv(i, j, th) : [t, i / (rows - 1)];
      return {
        p, u: uv[0], v: uv[1], b: sk.b, w: sk.w,
        color: o.color ? o.color(i, j, R.y, th) : undefined,
        f: o.f ? o.f(i, j, R.y, th) : 1,
        g: o.g ? o.g(i, j, R.y, th) : 0,
      };
    },
  });
}

/** Интерполяция колец по списку ключевых (y → радиусы) c плавной кривой. */
export function ringsFromKeys(keys: { y: number; rx: number; rz: number; cx?: number; cz?: number }[], n: number): Ring[] {
  const out: Ring[] = [];
  const ys = keys.map((k) => k.y);
  const y0 = ys[0], y1 = ys[ys.length - 1];
  for (let i = 0; i < n; i++) {
    const y = y0 + ((y1 - y0) * i) / (n - 1);
    // найти сегмент
    let k = 0;
    while (k < keys.length - 2 && (y1 < y0 ? y < keys[k + 1].y : y > keys[k + 1].y)) k++;
    const a = keys[k], b = keys[k + 1];
    const t = clamp((y - a.y) / (b.y - a.y));
    const e = t * t * (3 - 2 * t);
    const mix = (p: number, q: number) => p + (q - p) * e;
    out.push({ y, rx: mix(a.rx, b.rx), rz: mix(a.rz, b.rz), cx: mix(a.cx ?? 0, b.cx ?? 0), cz: mix(a.cz ?? 0, b.cz ?? 0) });
  }
  return out;
}

/** Эллипсоид (для головы, ладоней, амулетов). Полюса по оси Y; θ от +Z к +X. */
export function ellipsoid(opts: {
  center: THREE.Vector3;
  radii: THREE.Vector3;
  rows?: number;
  cols?: number;
  bone: { b: number[]; w: number[] };
  rot?: THREE.Euler;
  color?: [number, number, number];
  uv?: (th: number, ph: number) => [number, number];
  /** displace(dir, th, ph) → новая позиция на единичной сфере (до масштабирования). */
  shape?: (p: THREE.Vector3, th: number, ph: number) => THREE.Vector3;
  f?: number;
  flip?: boolean;
}): Surface {
  const rows = opts.rows ?? 14, cols = opts.cols ?? 20;
  const rotM = new THREE.Matrix4();
  if (opts.rot) rotM.makeRotationFromEuler(opts.rot);
  const s = gridSurface({
    rows, cols, wrap: true, flip: opts.flip,
    fn: (i, j) => {
      const ph = Math.PI * (i / (rows - 1)); // 0 = верхний полюс, π = нижний
      const th = (j / cols) * Math.PI * 2;
      let p = new THREE.Vector3(Math.sin(ph) * Math.sin(th), Math.cos(ph), Math.sin(ph) * Math.cos(th));
      if (opts.shape) p = opts.shape(p, th, ph);
      p.multiply(opts.radii).applyMatrix4(rotM).add(opts.center);
      const uv = opts.uv ? opts.uv(th, ph) : [j / cols, 1 - i / (rows - 1)];
      return { p, u: uv[0], v: uv[1], b: opts.bone.b, w: opts.bone.w, color: opts.color, f: opts.f ?? 1 };
    },
  });
  return s;
}

/** Ось-ориентированный лофт вдоль произвольной оси (копьё, лук, перья, когти). */
export interface AxisRing {
  t: number; // позиция вдоль оси (метры от начала)
  rx: number;
  rz: number;
  ox?: number; // смещение центра колец
  oz?: number;
}

export function axisLoft(opts: {
  from: THREE.Vector3;
  dir: THREE.Vector3; // единичная
  up?: THREE.Vector3; // куда смотрит «+Z кольца»
  rings: AxisRing[];
  cols: number;
  bone: { b: number[]; w: number[] } | ((i: number, j: number, t: number) => { b: number[]; w: number[] });
  color?: (i: number, j: number, t: number) => [number, number, number];
  uv?: (i: number, j: number, t: number) => [number, number];
  f?: number;
  flip?: boolean;
}): Surface {
  const dir = opts.dir.clone().normalize();
  const upHint = opts.up ? opts.up.clone() : Math.abs(dir.y) < 0.95 ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(0, 0, 1);
  const right = new THREE.Vector3().crossVectors(upHint, dir).normalize(); // «X кольца»
  const fwd = new THREE.Vector3().crossVectors(dir, right).normalize(); // «Z кольца»
  const rows = opts.rings.length;
  const s = gridSurface({
    rows, cols: opts.cols, wrap: true, flip: opts.flip,
    fn: (i, j) => {
      const R = opts.rings[i];
      const th = (j / opts.cols) * Math.PI * 2;
      const p = opts.from.clone()
        .addScaledVector(dir, R.t)
        .addScaledVector(right, (R.ox ?? 0) + Math.sin(th) * R.rx)
        .addScaledVector(fwd, (R.oz ?? 0) + Math.cos(th) * R.rz);
      const uv = opts.uv ? opts.uv(i, j, R.t) : [j / opts.cols, i / (rows - 1)];
      const sk = typeof opts.bone === 'function' ? opts.bone(i, j, R.t) : opts.bone;
      return { p, u: uv[0], v: uv[1], b: sk.b, w: sk.w, color: opts.color ? opts.color(i, j, R.t) : undefined, f: opts.f ?? 1 };
    },
  });
  return s;
}

/** Лента (плоская полоса) вдоль ломаной — ремни, перевязи, шнуры. width — по нормали. */
export function ribbon(opts: {
  pts: THREE.Vector3[];
  width: number | ((t: number) => number);
  normal: (t: number, p: THREE.Vector3) => THREE.Vector3; // «наружу» от поверхности
  offset?: number; // подъём над поверхностью
  thickness?: number;
  bone: (t: number, p: THREE.Vector3) => { b: number[]; w: number[] };
  color?: [number, number, number];
  uvScale?: number;
  curve?: boolean;
}): Surface {
  const curve = new THREE.CatmullRomCurve3(opts.pts, false, 'centripetal');
  const n = Math.max(4, Math.ceil(curve.getLength() / 0.02));
  const widthAt = typeof opts.width === 'number' ? () => opts.width as number : opts.width;
  const th = opts.thickness ?? 0.006;
  // лента — 2 стороны (верх и низ) с узкими боками: сделаем коробчатое сечение из 4 вершин
  const s = gridSurface({
    rows: n + 1, cols: 4, wrap: true,
    fn: (i, j) => {
      const t = i / n;
      const p = curve.getPointAt(t);
      const tan = curve.getTangentAt(t).normalize();
      const nrm = opts.normal(t, p).clone().normalize();
      const side = new THREE.Vector3().crossVectors(nrm, tan).normalize();
      const hw = widthAt(t) / 2;
      const off = opts.offset ?? 0;
      // сечение: (-hw, 0) -> (hw, 0) -> (hw, th) -> (-hw, th)
      const corners = [[-hw, 0], [hw, 0], [hw, th], [-hw, th]];
      const c = corners[j % 4];
      const q = p.clone().addScaledVector(side, c[0]).addScaledVector(nrm, off + c[1]);
      const sk = opts.bone(t, p);
      return { p: q, u: (t * curve.getLength()) / (opts.uvScale ?? 0.2), v: (c[0] + hw) / (2 * hw), b: sk.b, w: sk.w, color: opts.color };
    },
  });
  return s;
}

/** Труба вдоль кривой Катмулла–Рома: пальцы, пряди, шнуры, перья-стержни. */
export function pathTube(opts: {
  pts: THREE.Vector3[];
  radius: number | ((t: number) => number);
  /** Эллиптичность: множитель радиуса вдоль binormal (по умолчанию 1). */
  squash?: number | ((t: number) => number);
  sides?: number;
  segs?: number;
  bone: { b: number[]; w: number[] } | ((t: number, p: THREE.Vector3) => { b: number[]; w: number[] });
  color?: [number, number, number] | ((t: number) => [number, number, number]);
  capped?: boolean;
  f?: number;
  uvScale?: number;
}): Surface {
  const curve = new THREE.CatmullRomCurve3(opts.pts, false, 'centripetal');
  const len = curve.getLength();
  const segs = opts.segs ?? Math.max(4, Math.ceil(len / 0.03));
  const sides = opts.sides ?? 6;
  const frames = curve.computeFrenetFrames(segs, false);
  const rad = typeof opts.radius === 'number' ? () => opts.radius as number : opts.radius;
  const sq = opts.squash === undefined ? () => 1 : typeof opts.squash === 'number' ? () => opts.squash as number : opts.squash;
  return gridSurface({
    rows: segs + 1, cols: sides, wrap: true, flip: true,
    fn: (i, j) => {
      const t = i / segs;
      const p = curve.getPointAt(t);
      let r = rad(t);
      if (opts.capped && (i === 0 || i === segs)) r *= 0.05;
      const th = (j / sides) * Math.PI * 2;
      const N = frames.normals[i], B = frames.binormals[i];
      const q = p.clone().addScaledVector(N, Math.cos(th) * r).addScaledVector(B, Math.sin(th) * r * sq(t));
      const sk = typeof opts.bone === 'function' ? opts.bone(t, p) : opts.bone;
      const col = typeof opts.color === 'function' ? opts.color(t) : opts.color;
      return { p: q, u: j / sides, v: (t * len) / (opts.uvScale ?? 0.2), b: sk.b, w: sk.w, color: col, f: opts.f ?? 1 };
    },
  });
}

/** Объединить несколько наборов весов с коэффициентами. */
export function combineWeights(sets: { b: number[]; w: number[] }[], k: number[]): { b: number[]; w: number[] } {
  const acc = new Map<number, number>();
  sets.forEach((s, n) => s.b.forEach((bi, m) => acc.set(bi, (acc.get(bi) ?? 0) + s.w[m] * k[n])));
  return packWeights([...acc.entries()] as Weights);
}

export const _deg = DEG;
