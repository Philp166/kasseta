// Вспомогательные операции над мешами: острова UV, нормали, упаковка частей, упаковка UV.

/** Острова UV: объединение граней по общим индексам vt. Возвращает массив номеров островов по граням. */
export function uvIslands(uvFaces, nUV) {
  const parent = new Int32Array(nUV).map((_, i) => i);
  const find = (a) => { while (parent[a] !== a) { parent[a] = parent[parent[a]]; a = parent[a]; } return a; };
  const uni = (a, b) => { a = find(a); b = find(b); if (a !== b) parent[b] = a; };
  for (const f of uvFaces) { uni(f[0], f[1]); uni(f[1], f[2]); uni(f[2], f[3]); }
  const ids = new Map();
  return uvFaces.map((f) => {
    const r = find(f[0]);
    if (!ids.has(r)) ids.set(r, ids.size);
    return ids.get(r);
  });
}

/** Сглаженные нормали по позициям (площадные веса): quads → два треугольника. P: Float64Array 3n. */
export function positionNormals(P, quads) {
  const n = P.length / 3;
  const N = new Float64Array(n * 3);
  const add = (a, b, c) => {
    const ux = P[b * 3] - P[a * 3], uy = P[b * 3 + 1] - P[a * 3 + 1], uz = P[b * 3 + 2] - P[a * 3 + 2];
    const vx = P[c * 3] - P[a * 3], vy = P[c * 3 + 1] - P[a * 3 + 1], vz = P[c * 3 + 2] - P[a * 3 + 2];
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    for (const i of [a, b, c]) { N[i * 3] += nx; N[i * 3 + 1] += ny; N[i * 3 + 2] += nz; }
  };
  for (const q of quads) { add(q[0], q[1], q[2]); add(q[0], q[2], q[3]); }
  for (let i = 0; i < n; i++) {
    const l = Math.hypot(N[i * 3], N[i * 3 + 1], N[i * 3 + 2]) || 1;
    N[i * 3] /= l; N[i * 3 + 1] /= l; N[i * 3 + 2] /= l;
  }
  return N;
}

/**
 * Собрать буферы части: уникальные пары (позиция, uv0[, uv1]) → вершины, квады → треугольники.
 * faces: [{p:[4 pos ids], t:[4 uv ids], t1?:[4 uv1 ids]}]
 * Возвращает { map: Int32Array вершина→id позиции, uvIdx, indices }.
 */
export function assemblePart(faces, { withUV1 = false } = {}) {
  const key = new Map();
  const posId = [], uvId = [], uv1Id = [];
  const idx = [];
  const get = (p, t, t1) => {
    const k = withUV1 ? `${p}_${t}_${t1}` : `${p}_${t}`;
    let v = key.get(k);
    if (v === undefined) { v = posId.length; key.set(k, v); posId.push(p); uvId.push(t); uv1Id.push(t1); }
    return v;
  };
  for (const f of faces) {
    const v = [0, 1, 2, 3].map((k) => get(f.p[k], f.t[k], f.t1 ? f.t1[k] : -1));
    idx.push(v[0], v[1], v[2], v[0], v[2], v[3]);
  }
  return { posId: Int32Array.from(posId), uvId: Int32Array.from(uvId), uv1Id: Int32Array.from(uv1Id), indices: idx };
}

/**
 * Простая упаковка прямоугольников (островов UV) в единичный квадрат: общий масштаб s, полочный алгоритм.
 * rects: [{id, w, h}] → { s, place: Map id → [ox, oy] } (смещение левого нижнего угла после масштаба).
 */
export function packRects(rects, gutter = 0.006) {
  const fits = (s) => {
    const sorted = rects.slice().sort((a, b) => b.h - a.h);
    const place = new Map();
    let x = gutter, y = gutter, rowH = 0;
    for (const r of sorted) {
      const w = r.w * s, h = r.h * s;
      if (x + w + gutter > 1) { x = gutter; y += rowH + gutter; rowH = 0; }
      if (y + h + gutter > 1 || w + 2 * gutter > 1) return null;
      place.set(r.id, [x, y]);
      x += w + gutter; rowH = Math.max(rowH, h);
    }
    return place;
  };
  let lo = 0.05, hi = 6, best = null;
  for (let i = 0; i < 40; i++) {
    const mid = (lo + hi) / 2;
    const p = fits(mid);
    if (p) { lo = mid; best = p; } else hi = mid;
  }
  return { s: lo, place: best };
}
