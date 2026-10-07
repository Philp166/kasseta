// Мини-линейная алгебра для сборщика: векторы — массивы из 3 чисел, матрицы 3x3 — Float64Array(9), построчно.

export const v3 = {
  add: (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]],
  sub: (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]],
  mul: (a, s) => [a[0] * s, a[1] * s, a[2] * s],
  dot: (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2],
  cross: (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]],
  len: (a) => Math.hypot(a[0], a[1], a[2]),
  norm: (a) => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; },
  lerp: (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t],
  dist: (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]),
  mirrorX: (a) => [-a[0], a[1], a[2]],
};

export const m3 = {
  I: () => Float64Array.from([1, 0, 0, 0, 1, 0, 0, 0, 1]),
  mul(a, b) {
    const o = new Float64Array(9);
    for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) o[i * 3 + j] = a[i * 3] * b[j] + a[i * 3 + 1] * b[3 + j] + a[i * 3 + 2] * b[6 + j];
    return o;
  },
  vec(m, v) { return [m[0] * v[0] + m[1] * v[1] + m[2] * v[2], m[3] * v[0] + m[4] * v[1] + m[5] * v[2], m[6] * v[0] + m[7] * v[1] + m[8] * v[2]]; },
  T(m) { return Float64Array.from([m[0], m[3], m[6], m[1], m[4], m[7], m[2], m[5], m[8]]); },
  fromCols(a, b, c) { return Float64Array.from([a[0], b[0], c[0], a[1], b[1], c[1], a[2], b[2], c[2]]); },
  axisAngle(axis, ang) {
    const [x, y, z] = v3.norm(axis); const c = Math.cos(ang), s = Math.sin(ang), t = 1 - c;
    return Float64Array.from([t * x * x + c, t * x * y - s * z, t * x * z + s * y, t * x * y + s * z, t * y * y + c, t * y * z - s * x, t * x * z - s * y, t * y * z + s * x, t * z * z + c]);
  },
  /** Кратчайший поворот a→b (единичные векторы). */
  between(a, b) {
    a = v3.norm(a); b = v3.norm(b);
    const d = v3.dot(a, b);
    if (d > 0.999999) return m3.I();
    if (d < -0.999999) {
      // разворот на 180°: любая ось, перпендикулярная a
      const ax = Math.abs(a[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0];
      return m3.axisAngle(v3.cross(a, ax), Math.PI);
    }
    const axis = v3.cross(a, b);
    return m3.axisAngle(axis, Math.acos(Math.max(-1, Math.min(1, d))));
  },
  /** Поворот, переводящий ортонормированный репер (a1, a2) в (b1, b2): a1→b1 точно, a2 → проекция b2. */
  frameAlign(a1, a2, b1, b2) {
    const fa = frameOf(a1, a2), fb = frameOf(b1, b2);
    return m3.mul(fb, m3.T(fa));
  },
  /** Угол вокруг оси axis (скручивание) из swing-twist разложения вращения R. */
  twistAngle(R, axis) {
    const q = quatFromMat(R);
    const ax = v3.norm(axis);
    const p = q[0] * ax[0] + q[1] * ax[1] + q[2] * ax[2];
    let ang = 2 * Math.atan2(p, q[3]);
    if (ang > Math.PI) ang -= 2 * Math.PI;
    if (ang < -Math.PI) ang += 2 * Math.PI;
    return ang;
  },
  /** Масштаб вдоль оси a (единичный): I + (s-1) a aT. */
  axialScale(a, s) {
    const k = s - 1;
    return Float64Array.from([1 + k * a[0] * a[0], k * a[0] * a[1], k * a[0] * a[2], k * a[1] * a[0], 1 + k * a[1] * a[1], k * a[1] * a[2], k * a[2] * a[0], k * a[2] * a[1], 1 + k * a[2] * a[2]]);
  },
};

function frameOf(e1, e2) {
  const a = v3.norm(e1);
  let b = v3.sub(e2, v3.mul(a, v3.dot(a, e2)));
  b = v3.norm(b);
  const c = v3.cross(a, b);
  return m3.fromCols(a, b, c);
}

export function quatFromMat(m) {
  const tr = m[0] + m[4] + m[8];
  let x, y, z, w;
  if (tr > 0) {
    const s = Math.sqrt(tr + 1) * 2; w = s / 4; x = (m[7] - m[5]) / s; y = (m[2] - m[6]) / s; z = (m[3] - m[1]) / s;
  } else if (m[0] > m[4] && m[0] > m[8]) {
    const s = Math.sqrt(1 + m[0] - m[4] - m[8]) * 2; w = (m[7] - m[5]) / s; x = s / 4; y = (m[1] + m[3]) / s; z = (m[2] + m[6]) / s;
  } else if (m[4] > m[8]) {
    const s = Math.sqrt(1 + m[4] - m[0] - m[8]) * 2; w = (m[2] - m[6]) / s; x = (m[1] + m[3]) / s; y = s / 4; z = (m[5] + m[7]) / s;
  } else {
    const s = Math.sqrt(1 + m[8] - m[0] - m[4]) * 2; w = (m[3] - m[1]) / s; x = (m[2] + m[6]) / s; y = (m[5] + m[7]) / s; z = s / 4;
  }
  const l = Math.hypot(x, y, z, w) || 1;
  return [x / l, y / l, z / l, w / l];
}

/** Аффинное преобразование p' = M p + t. */
export class Xf {
  constructor(m = m3.I(), t = [0, 0, 0]) { this.m = m; this.t = t; }
  apply(p) { const q = m3.vec(this.m, p); return [q[0] + this.t[0], q[1] + this.t[1], q[2] + this.t[2]]; }
  /** Преобразование с заданным образом точки h: p' = H + M (p - h). */
  static about(m, h, H) { return new Xf(m, v3.sub(H, m3.vec(m, h))); }
}

export const deg = (d) => (d * Math.PI) / 180;
