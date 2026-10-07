// Геометрия снаряжения без скиннинга: сетки с гладкими нормалями, трубы, лофты, сечения лезвий.
// Соглашение: grid(rows, cols, fn) — нормаль = dV × dU (i — «вдоль», j — «вокруг»). Лофты сами выбирают flip,
// чтобы нормали смотрели наружу. UV задаются в метрах / размер плитки (tile), чтобы плотность текселей
// у разных предметов совпадала.

import * as THREE from 'three';

export type V3 = THREE.Vector3;
export const V = (x = 0, y = 0, z = 0): V3 => new THREE.Vector3(x, y, z);

export interface GV {
  p: THREE.Vector3;
  u: number;
  v: number;
  c?: [number, number, number];
}

export interface Ring {
  y: number;
  rx: number;
  rz: number;
  cx?: number;
  cz?: number;
}

const _m3 = new THREE.Matrix3();
const _v = new THREE.Vector3();

export class GeoBuilder {
  pos: number[] = [];
  nor: number[] = [];
  uv: number[] = [];
  col: number[] = [];
  idx: number[] = [];
  hasCol = false;

  get vertexCount(): number {
    return this.pos.length / 3;
  }
  get tris(): number {
    return this.idx.length / 3;
  }

  /** Сетка rows × cols. wrap — замкнуть по j (шовная вершина добавляется сама). */
  grid(rows: number, cols: number, fn: (i: number, j: number) => GV, o: { wrap?: boolean; flip?: boolean } = {}): this {
    const wrap = !!o.wrap, flip = !!o.flip;
    const stride = wrap ? cols + 1 : cols;
    const base = this.vertexCount;
    const P: THREE.Vector3[] = new Array(rows * stride);
    const hadCol = this.hasCol;
    let anyCol = false;
    const cols3: ([number, number, number] | undefined)[] = new Array(rows * stride);
    for (let i = 0; i < rows; i++) {
      for (let j = 0; j < stride; j++) {
        const g = fn(i, j);
        const k = i * stride + j;
        P[k] = g.p;
        cols3[k] = g.c;
        if (g.c) anyCol = true;
        this.pos.push(g.p.x, g.p.y, g.p.z);
        this.uv.push(g.u, g.v);
      }
    }
    if (anyCol || hadCol) {
      if (!hadCol) {
        this.col = new Array(base * 3).fill(1);
        this.hasCol = true;
      }
      for (let k = 0; k < rows * stride; k++) {
        const c = cols3[k];
        if (c) this.col.push(c[0], c[1], c[2]);
        else this.col.push(1, 1, 1);
      }
    }
    const at = (i: number, j: number) => {
      const ii = i < 0 ? 0 : i >= rows ? rows - 1 : i;
      if (wrap) return P[ii * stride + (((j % cols) + cols) % cols)];
      return P[ii * stride + (j < 0 ? 0 : j >= cols ? cols - 1 : j)];
    };
    const dU = new THREE.Vector3(), dV = new THREE.Vector3(), n = new THREE.Vector3();
    const N: THREE.Vector3[] = new Array(rows * stride);
    for (let i = 0; i < rows; i++) {
      for (let j = 0; j < stride; j++) {
        dU.subVectors(at(i, j + 1), at(i, j - 1));
        dV.subVectors(at(i + 1, j), at(i - 1, j));
        n.crossVectors(dV, dU);
        if (n.lengthSq() < 1e-18) n.set(0, 0, 0);
        else n.normalize();
        if (flip) n.negate();
        N[i * stride + j] = n.clone();
      }
    }
    // вырожденные (полюса): взять нормаль соседнего ряда
    for (let i = 0; i < rows; i++) {
      for (let j = 0; j < stride; j++) {
        const q = N[i * stride + j];
        if (q.lengthSq() < 0.5) {
          let k = i;
          for (let s = 1; s < rows && N[k * stride + j].lengthSq() < 0.5; s++) {
            k = Math.min(rows - 1, Math.max(0, i + (i === 0 ? s : -s)));
          }
          q.copy(N[k * stride + j]);
          if (q.lengthSq() < 0.5) q.set(0, 1, 0);
        }
        this.nor.push(q.x, q.y, q.z);
      }
    }
    const nj = wrap ? cols : cols - 1;
    for (let i = 0; i < rows - 1; i++) {
      for (let j = 0; j < nj; j++) {
        const a = base + i * stride + j, b = a + 1, c = a + stride, d = c + 1;
        if (!flip) this.idx.push(a, c, b, b, c, d);
        else this.idx.push(a, b, c, b, d, c);
      }
    }
    return this;
  }

  /** Плоский веер-крышка по кольцу точек (нормаль задаётся явно). */
  fan(ring: THREE.Vector3[], normal: THREE.Vector3, uvf?: (p: THREE.Vector3) => [number, number], color?: [number, number, number]): this {
    const c = new THREE.Vector3();
    for (const p of ring) c.add(p);
    c.multiplyScalar(1 / ring.length);
    const base = this.vertexCount;
    const push = (p: THREE.Vector3) => {
      this.pos.push(p.x, p.y, p.z);
      this.nor.push(normal.x, normal.y, normal.z);
      const t = uvf ? uvf(p) : [p.x * 5, p.z * 5];
      this.uv.push(t[0], t[1]);
      if (this.hasCol || color) {
        if (!this.hasCol) { this.col = new Array(base * 3).fill(1); this.hasCol = true; }
        const k = color ?? [1, 1, 1];
        this.col.push(k[0], k[1], k[2]);
      }
    };
    push(c);
    for (const p of ring) push(p);
    const n = ring.length;
    for (let i = 0; i < n; i++) this.idx.push(base, base + 1 + i, base + 1 + ((i + 1) % n));
    return this;
  }

  /** Присоединить другой построитель (с матрицей). */
  append(o: GeoBuilder, m?: THREE.Matrix4): this {
    const base = this.vertexCount;
    if (m) {
      _m3.getNormalMatrix(m);
      for (let i = 0; i < o.pos.length; i += 3) {
        _v.set(o.pos[i], o.pos[i + 1], o.pos[i + 2]).applyMatrix4(m);
        this.pos.push(_v.x, _v.y, _v.z);
        _v.set(o.nor[i], o.nor[i + 1], o.nor[i + 2]).applyMatrix3(_m3).normalize();
        this.nor.push(_v.x, _v.y, _v.z);
      }
    } else {
      for (let i = 0; i < o.pos.length; i++) { this.pos.push(o.pos[i]); this.nor.push(o.nor[i]); }
    }
    for (let i = 0; i < o.uv.length; i++) this.uv.push(o.uv[i]);
    if (this.hasCol || o.hasCol) {
      if (!this.hasCol) { this.col = new Array(base * 3).fill(1); this.hasCol = true; }
      if (o.hasCol) for (let i = 0; i < o.col.length; i++) this.col.push(o.col[i]);
      else for (let i = 0; i < o.vertexCount; i++) this.col.push(1, 1, 1);
    }
    for (let i = 0; i < o.idx.length; i++) this.idx.push(o.idx[i] + base);
    return this;
  }

  /** Применить матрицу ко всему накопленному. */
  transform(m: THREE.Matrix4): this {
    _m3.getNormalMatrix(m);
    for (let i = 0; i < this.pos.length; i += 3) {
      _v.set(this.pos[i], this.pos[i + 1], this.pos[i + 2]).applyMatrix4(m);
      this.pos[i] = _v.x; this.pos[i + 1] = _v.y; this.pos[i + 2] = _v.z;
      _v.set(this.nor[i], this.nor[i + 1], this.nor[i + 2]).applyMatrix3(_m3).normalize();
      this.nor[i] = _v.x; this.nor[i + 1] = _v.y; this.nor[i + 2] = _v.z;
    }
    return this;
  }

  /** Умножить вершинные цвета (тонировка/затемнение). */
  tint(r: number, g = r, b = r): this {
    if (!this.hasCol) { this.col = new Array(this.vertexCount * 3).fill(1); this.hasCol = true; }
    for (let i = 0; i < this.col.length; i += 3) { this.col[i] *= r; this.col[i + 1] *= g; this.col[i + 2] *= b; }
    return this;
  }

  /** Вершинный AO/тонировка по функции позиции (p → множитель). */
  shade(fn: (p: THREE.Vector3) => number): this {
    if (!this.hasCol) { this.col = new Array(this.vertexCount * 3).fill(1); this.hasCol = true; }
    for (let i = 0; i < this.pos.length; i += 3) {
      const k = fn(_v.set(this.pos[i], this.pos[i + 1], this.pos[i + 2]));
      this.col[i] *= k; this.col[i + 1] *= k; this.col[i + 2] *= k;
    }
    return this;
  }

  toGeometry(): THREE.BufferGeometry {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nor, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    if (this.hasCol) g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    g.setIndex(this.vertexCount > 65000 ? new THREE.Uint32BufferAttribute(this.idx, 1) : new THREE.Uint16BufferAttribute(this.idx, 1));
    g.computeBoundingSphere();
    g.computeBoundingBox();
    return g;
  }

  mesh(material: THREE.Material, name = ''): THREE.Mesh {
    const m = new THREE.Mesh(this.toGeometry(), material);
    m.name = name;
    m.castShadow = true;
    m.receiveShadow = true;
    return m;
  }
}

// ---------- Фреймы вдоль кривой ----------

export interface Frame {
  p: THREE.Vector3;
  t: THREE.Vector3;
  n: THREE.Vector3;
  b: THREE.Vector3;
  s: number; // длина дуги от начала (м)
}

/** n+1 фреймов (параллельный перенос) вдоль кривой; up — подсказка начального «n». */
export function framesAlong(curve: THREE.Curve<THREE.Vector3>, n: number, up?: THREE.Vector3): Frame[] {
  const fr = curve.computeFrenetFrames(n, false);
  const out: Frame[] = [];
  let s = 0;
  let prev: THREE.Vector3 | null = null;
  for (let i = 0; i <= n; i++) {
    const p = curve.getPoint(i / n);
    if (prev) s += p.distanceTo(prev);
    prev = p;
    out.push({ p, t: fr.tangents[i].clone(), n: fr.normals[i].clone(), b: fr.binormals[i].clone(), s });
  }
  if (up) {
    // повернуть все фреймы так, чтобы первый n лежал в плоскости (t, up)
    const t0 = out[0].t;
    const nn = up.clone().addScaledVector(t0, -up.dot(t0)).normalize();
    const ang = Math.atan2(out[0].b.dot(nn), out[0].n.dot(nn));
    for (const f of out) {
      const c = Math.cos(ang), sn = Math.sin(ang);
      const n2 = f.n.clone().multiplyScalar(c).addScaledVector(f.b, sn);
      const b2 = f.b.clone().multiplyScalar(c).addScaledVector(f.n, -sn);
      f.n = n2;
      f.b = b2;
    }
  }
  return out;
}

// ---------- Трубы ----------

export interface TubeOpts {
  radius: number | ((t: number) => number);
  /** Масштаб по бинормали (эллиптичность). */
  squash?: number | ((t: number) => number);
  sides?: number;
  segs?: number;
  /** 'round' — полусфера, 'flat' — плоская крышка, 'none' — открытая. */
  caps?: 'none' | 'flat' | 'round';
  capRings?: number;
  /** Метров на единицу UV; u вдоль окружности делается uAround раз. */
  tile?: number;
  uAround?: number;
  /** Мультипликатор радиуса от (t, угол) — резные пояса, рёбра. */
  rMod?: (t: number, th: number) => number;
  color?: (t: number, th: number) => [number, number, number];
  twist?: (t: number) => number;
  up?: THREE.Vector3;
  frames?: Frame[];
  /** Сдвиг v (в единицах плитки) — чтобы текстура была непрерывной между сегментами. */
  vOffset?: number;
}

/** Труба вдоль кривой (нормали наружу). Возвращает построитель. */
export function tube(curve: THREE.Curve<THREE.Vector3>, o: TubeOpts, gb = new GeoBuilder()): GeoBuilder {
  const sides = o.sides ?? 8;
  const segs = o.segs ?? Math.max(4, Math.ceil(curve.getLength() / 0.02));
  const rad = typeof o.radius === 'number' ? () => o.radius as number : o.radius;
  const sq = o.squash === undefined ? () => 1 : typeof o.squash === 'number' ? () => o.squash as number : o.squash;
  const fr = o.frames ?? framesAlong(curve, segs, o.up);
  const tile = o.tile ?? 0.2;
  const uA = o.uAround ?? 1;
  type R = { p: THREE.Vector3; n: THREE.Vector3; b: THREE.Vector3; r: number; s: number; t: number; q: number; tan: THREE.Vector3 };
  const rings: R[] = [];
  const L = fr[fr.length - 1].s;
  const mk = (f: Frame, t: number): R => ({ p: f.p, n: f.n, b: f.b, r: rad(t), s: f.s, t, q: sq(t), tan: f.t });
  const caps = o.caps ?? 'none';
  const nc = o.capRings ?? 3;
  if (caps === 'round') {
    const f = fr[0], r0 = rad(0);
    for (let k = 0; k < nc; k++) {
      const a = (Math.PI / 2) * (1 - (k + 0.15) / nc); // от кончика к основанию
      rings.push({ p: f.p.clone().addScaledVector(f.t, -r0 * Math.sin(a)), n: f.n, b: f.b, r: r0 * Math.cos(a), s: f.s - r0 * Math.sin(a), t: 0, q: sq(0), tan: f.t });
    }
  }
  for (let i = 0; i <= segs; i++) rings.push(mk(fr[i], i / segs));
  if (caps === 'round') {
    const f = fr[segs], r1 = rad(1);
    for (let k = nc - 1; k >= 0; k--) {
      const a = (Math.PI / 2) * (1 - (k + 0.15) / nc);
      rings.push({ p: f.p.clone().addScaledVector(f.t, r1 * Math.sin(a)), n: f.n, b: f.b, r: r1 * Math.cos(a), s: f.s + r1 * Math.sin(a), t: 1, q: sq(1), tan: f.t });
    }
  }
  const nR = rings.length;
  const startIdx = gb.vertexCount;
  gb.grid(nR, sides, (i, j) => {
    const R = rings[i];
    const th = (j / sides) * Math.PI * 2;
    const tw = o.twist ? o.twist(R.t) : 0;
    const a = th + tw;
    const mod = o.rMod ? o.rMod(R.t, th) : 1;
    const p = R.p.clone().addScaledVector(R.n, Math.cos(a) * R.r * mod).addScaledVector(R.b, Math.sin(a) * R.r * R.q * mod);
    return { p, u: (j / sides) * uA, v: R.s / tile + (o.vOffset ?? 0), c: o.color ? o.color(R.t, th) : undefined };
  }, { wrap: true, flip: true });
  if (caps === 'flat') {
    const mkCap = (R: R, sign: number) => {
      const pts: THREE.Vector3[] = [];
      for (let j = 0; j < sides; j++) {
        const th = (j / sides) * Math.PI * 2;
        pts.push(R.p.clone().addScaledVector(R.n, Math.cos(th) * R.r).addScaledVector(R.b, Math.sin(th) * R.r * R.q));
      }
      gb.fan(sign > 0 ? pts : pts.slice().reverse(), R.tan.clone().multiplyScalar(sign), (p) => [p.x / tile, p.z / tile]);
    };
    mkCap(rings[0], -1);
    mkCap(rings[nR - 1], 1);
  }
  void startIdx; void L;
  return gb;
}

// ---------- Лофт по оси Y (кольца-эллипсы) ----------

export interface LoftYOpts {
  rings: Ring[];
  cols: number;
  wrap?: boolean;
  /** Диапазон углов, если не замкнуто (θ от +Z к +X). */
  th0?: number;
  th1?: number;
  tile?: number;
  uAround?: number;
  mod?: (th: number, y: number, i: number, j: number) => number;
  dy?: (th: number, y: number, i: number, j: number) => number;
  color?: (i: number, j: number, y: number, th: number) => [number, number, number];
  /** Развернуть нормали внутрь. */
  inside?: boolean;
  /** Переопределить u/v. */
  uv?: (i: number, j: number, th: number, y: number, vLen: number) => [number, number];
}

/** Лофт колец вдоль Y (порядок колец любой: направление нормалей определяется автоматически). */
export function loftY(o: LoftYOpts, gb = new GeoBuilder()): GeoBuilder {
  const rows = o.rings.length;
  const wrap = o.wrap ?? true;
  const th0 = o.th0 ?? 0, th1 = o.th1 ?? Math.PI * 2;
  const up = o.rings[rows - 1].y > o.rings[0].y;
  const tile = o.tile ?? 0.2;
  const uA = o.uAround ?? 1;
  // длина дуги профиля для v
  const vLen: number[] = [0];
  for (let i = 1; i < rows; i++) {
    const a = o.rings[i - 1], b = o.rings[i];
    const dr = Math.hypot((b.rx - a.rx), (b.rz - a.rz)) * 0.7071;
    vLen.push(vLen[i - 1] + Math.hypot(b.y - a.y, dr));
  }
  gb.grid(rows, o.cols, (i, j) => {
    const R = o.rings[i];
    const t = wrap ? j / o.cols : j / (o.cols - 1);
    const th = wrap ? t * Math.PI * 2 : th0 + (th1 - th0) * t;
    const m = o.mod ? o.mod(th, R.y, i, j) : 1;
    const dy = o.dy ? o.dy(th, R.y, i, j) : 0;
    const p = new THREE.Vector3((R.cx ?? 0) + Math.sin(th) * R.rx * m, R.y + dy, (R.cz ?? 0) + Math.cos(th) * R.rz * m);
    const uv = o.uv ? o.uv(i, j, th, R.y, vLen[i]) : ([t * uA, vLen[i] / tile] as [number, number]);
    return { p, u: uv[0], v: uv[1], c: o.color ? o.color(i, j, R.y, th) : undefined };
  }, { wrap, flip: up !== !!o.inside });
  return gb;
}

/** Профиль вращения [y, r] (+ эллиптичность rz/rx) → кольца. */
export function lathe(profile: Array<[number, number]>, cols: number, o: Partial<LoftYOpts> & { squash?: number } = {}, gb = new GeoBuilder()): GeoBuilder {
  const sq = o.squash ?? 1;
  return loftY({ ...o, rings: profile.map(([y, r]) => ({ y, rx: Math.max(r, 1e-5), rz: Math.max(r * sq, 1e-5) })), cols }, gb);
}

// ---------- Простые тела ----------

/** Эллипсоид (опционально суперэллипсоид: e<1 — подушка/закруглённый бокс). */
export function ellipsoid(c: V3, rx: number, ry: number, rz: number, o: { rows?: number; cols?: number; e?: number; rot?: THREE.Euler; tile?: number; color?: [number, number, number] } = {}, gb = new GeoBuilder()): GeoBuilder {
  const rows = o.rows ?? 8, cols = o.cols ?? 12;
  const e = o.e ?? 1;
  const rm = new THREE.Matrix4();
  if (o.rot) rm.makeRotationFromEuler(o.rot);
  const sp = (x: number) => Math.sign(x) * Math.pow(Math.abs(x), e);
  gb.grid(rows, cols, (i, j) => {
    const ph = (Math.PI * i) / (rows - 1);
    const th = (j / cols) * Math.PI * 2;
    const sphi = Math.sin(ph);
    const p = new THREE.Vector3(sp(sphi) * sp(Math.sin(th)) * rx, sp(Math.cos(ph)) * ry, sp(sphi) * sp(Math.cos(th)) * rz);
    p.applyMatrix4(rm).add(c);
    return { p, u: j / cols, v: i / (rows - 1), c: o.color };
  }, { wrap: true, flip: true });
  return gb;
}

export function sphere(c: V3, r: number, rows = 6, cols = 8, gb = new GeoBuilder()): GeoBuilder {
  return ellipsoid(c, r, r, r, { rows, cols }, gb);
}

/** Тор вокруг оси Y в плоскости XZ: R — большой радиус, r — малый. */
export function torus(R: number, r: number, segs = 20, sides = 8, o: { c?: V3; rot?: THREE.Euler; squash?: number; uTile?: number; color?: [number, number, number] } = {}, gb = new GeoBuilder()): GeoBuilder {
  const rm = new THREE.Matrix4();
  if (o.rot) rm.makeRotationFromEuler(o.rot);
  const c = o.c ?? V();
  gb.grid(segs + 1, sides, (i, j) => {
    const a = (i / segs) * Math.PI * 2;
    const b = (j / sides) * Math.PI * 2;
    const rr = R + r * Math.cos(b);
    const p = new THREE.Vector3(Math.sin(a) * rr, r * Math.sin(b) * (o.squash ?? 1), Math.cos(a) * rr).applyMatrix4(rm).add(c);
    return { p, u: (i / segs) * (o.uTile ?? 1), v: j / sides, c: o.color };
  }, { wrap: true, flip: false });
  return gb;
}

// ---------- Сечения со «жёсткими» гранями (лезвия, ремни) ----------

export interface SweepStation {
  c: THREE.Vector3; // центр сечения
  ex: THREE.Vector3; // ось «поперёк» (ширина)
  ez: THREE.Vector3; // ось «толщина»
  /** Полуширина, полутолщина и сдвиг центра по ex. */
  hw: number;
  hz: number;
  ox?: number;
  /** Множитель цвета станции (затемнение у конца). */
  k?: number;
}

/**
 * Протягивание «кусков» сечения вдоль станций. Каждый кусок — ломаная [sx, sz] (sx ∈ [-1,1] × hw, sz × hz);
 * между кусками нормали расщепляются (острые рёбра), внутри куска — гладкие вдоль и поперёк.
 * Нормали выбираются наружу, если куски перечислены в порядке обхода сечения против часовой стрелки
 * в системе (ex, ez) при взгляде с +Y (вдоль пути).
 */
export function sweepPatches(
  stations: SweepStation[],
  patches: Array<Array<[number, number]>>,
  o: { tile?: number; colorOf?: (patch: number, k: number, st: number) => [number, number, number] | undefined; flip?: boolean; uOffset?: number } = {},
  gbs: GeoBuilder | GeoBuilder[] | ((patch: number) => GeoBuilder) = new GeoBuilder(),
): GeoBuilder | GeoBuilder[] | ((patch: number) => GeoBuilder) {
  const tile = o.tile ?? 0.25;
  const n = stations.length;
  // метрическая длина вдоль пути
  const vs: number[] = [0];
  for (let i = 1; i < n; i++) vs.push(vs[i - 1] + stations[i].c.distanceTo(stations[i - 1].c));
  // метрическая длина поперёк (по ширине в середине пути)
  const mid = stations[Math.floor(n / 2)];
  let uAcc = o.uOffset ?? 0;
  patches.forEach((pts, pi) => {
    const gb = typeof gbs === 'function' ? gbs(pi) : Array.isArray(gbs) ? gbs[pi % gbs.length] : gbs;
    const us: number[] = [uAcc];
    for (let k = 1; k < pts.length; k++) {
      us.push(us[k - 1] + Math.hypot((pts[k][0] - pts[k - 1][0]) * mid.hw, (pts[k][1] - pts[k - 1][1]) * mid.hz));
    }
    uAcc = us[us.length - 1];
    gb.grid(n, pts.length, (i, k) => {
      const S = stations[i];
      const [sx, sz] = pts[k];
      const p = S.c.clone().addScaledVector(S.ex, (S.ox ?? 0) + sx * S.hw).addScaledVector(S.ez, sz * S.hz);
      const base = o.colorOf ? o.colorOf(pi, k, i) : undefined;
      const c = base ?? (S.k !== undefined ? ([S.k, S.k, S.k] as [number, number, number]) : undefined);
      return { p, u: us[k] / tile, v: vs[i] / tile, c };
    }, { flip: o.flip });
  });
  return gbs;
}

// ---------- Ремни, ленты ----------

/** Плоский ремень вдоль кривой: ширина w по вектору side(t), толщина th. Возвращает построитель. */
export function strap(curve: THREE.Curve<THREE.Vector3>, o: { width: number | ((t: number) => number); thick: number; up: THREE.Vector3; segs?: number; tile?: number; edgeRound?: number; color?: (t: number) => [number, number, number] }, gb = new GeoBuilder()): GeoBuilder {
  const segs = o.segs ?? Math.max(6, Math.ceil(curve.getLength() / 0.02));
  const fr = framesAlong(curve, segs, o.up);
  const wf = typeof o.width === 'number' ? () => o.width as number : o.width;
  const st: SweepStation[] = fr.map((f, i) => {
    // «вверх» по ремню — это ez (толщина), поперёк — ex; ось пути t
    const ez = o.up.clone().addScaledVector(f.t, -o.up.dot(f.t)).normalize();
    const ex = new THREE.Vector3().crossVectors(f.t, ez).normalize();
    const t = i / segs;
    const k = o.color ? o.color(t) : undefined;
    return { c: f.p, ex, ez, hw: wf(t) / 2, hz: o.thick / 2, k: k ? k[0] : undefined };
  });
  // порядок обхода: верх (слева направо), правый торец, низ (справа налево), левый торец
  const r = o.edgeRound ?? 0.35;
  const top: Array<[number, number]> = [[-1, 0.55], [-1 + r * 0.4, 1], [1 - r * 0.4, 1], [1, 0.55]];
  const right: Array<[number, number]> = [[1, 0.55], [1, -0.55]];
  const bottom: Array<[number, number]> = [[1, -0.55], [1 - r * 0.4, -1], [-1 + r * 0.4, -1], [-1, -0.55]];
  const left: Array<[number, number]> = [[-1, -0.55], [-1, 0.55]];
  sweepPatches(st, [top, right, bottom, left], { tile: o.tile ?? 0.2, flip: true }, gb);
  return gb;
}

/** Считает треугольники во всей иерархии. */
export function countTriangles(obj: THREE.Object3D): number {
  let n = 0;
  obj.traverse((o) => {
    const m = o as THREE.Mesh;
    if (m.isMesh && m.geometry) {
      const g = m.geometry as THREE.BufferGeometry;
      n += (g.index ? g.index.count : g.getAttribute('position').count) / 3;
    }
  });
  return Math.round(n);
}
