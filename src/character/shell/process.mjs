// Подготовка внешней модели-оболочки (TRELLIS): вырезание лишнего, посадка по моему скелету (кусочно-линейная
// деформация осей), капюшон выше лица, подвод нормалей. Работает на типизированных массивах, без three.

import { classify, CLASS } from './classify.mjs';

/** Кусочно-линейная посадка: по высоте исходной модели (y_u) задаются масштабы по x/z и сдвиг по z. */
export const FIT = {
  sy: 1.85, y0: 0.5,
  ys: [-0.5, -0.27, -0.19, 0.0, 0.1, 0.24, 0.33, 0.5],
  sx: [1.0, 1.0, 1.35, 1.35, 1.3, 1.3, 1.25, 1.2],
  sz: [1.05, 1.05, 1.25, 1.2, 1.2, 1.1, 1.1, 1.1],
  dz: [0.0, 0.0, 0.02, 0.045, 0.045, 0.03, 0.02, 0.0],
  /** Капюшон поднимается над лицом: плавно от fromY до toY (в единицах модели). */
  hood: { fromY: 0.30, toY: 0.42, up: 0.05, back: 0.0 },
  minComponentTris: 300,
};

const smooth = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
function interp(xs, vs, x) {
  if (x <= xs[0]) return vs[0];
  for (let i = 0; i + 1 < xs.length; i++) {
    if (x <= xs[i + 1]) { const t = (x - xs[i]) / (xs[i + 1] - xs[i]); return vs[i] + (vs[i + 1] - vs[i]) * t; }
  }
  return vs[vs.length - 1];
}

/** Единицы модели → метры в системе моего скелета. */
export function warp(x, y, z, F = FIT) {
  const sx = interp(F.ys, F.sx, y), sz = interp(F.ys, F.sz, y), dz = interp(F.ys, F.dz, y);
  const h = smooth(F.hood.fromY, F.hood.toY, y);
  return [x * sx, (y + F.y0) * F.sy + F.hood.up * h, z * sz + dz + F.hood.back * h];
}

/**
 * raw: { pos, nor, uv, idx, col } (позиции в единицах модели). Возвращает очищенный и посаженный меш.
 * stats — для отчёта.
 */
export function processShell(raw, F = FIT) {
  const { pos, uv, idx, col } = raw;
  const nV = pos.length / 3, nT = idx.length / 3;
  const cls = classify(pos, col);
  const counts = new Array(8).fill(0);
  for (let i = 0; i < nV; i++) counts[cls[i]]++;

  // 1) треугольники без вырезанных вершин
  const keep = new Uint8Array(nT);
  let kept = 0;
  for (let t = 0; t < nT; t++) {
    if (cls[idx[t * 3]] === 0 && cls[idx[t * 3 + 1]] === 0 && cls[idx[t * 3 + 2]] === 0) { keep[t] = 1; kept++; }
  }

  // 2) склейка по позициям (разрывы UV-швов) и компоненты связности
  const wid = new Int32Array(nV);
  const map = new Map();
  for (let i = 0; i < nV; i++) {
    const k = `${Math.round(pos[i * 3] * 1e5)}_${Math.round(pos[i * 3 + 1] * 1e5)}_${Math.round(pos[i * 3 + 2] * 1e5)}`;
    let id = map.get(k);
    if (id === undefined) { id = map.size; map.set(k, id); }
    wid[i] = id;
  }
  const nW = map.size;
  const par = new Int32Array(nW).map((_, i) => i);
  const find = (a) => { while (par[a] !== a) { par[a] = par[par[a]]; a = par[a]; } return a; };
  for (let t = 0; t < nT; t++) {
    if (!keep[t]) continue;
    const a = find(wid[idx[t * 3]]), b = find(wid[idx[t * 3 + 1]]), c = find(wid[idx[t * 3 + 2]]);
    if (a !== b) par[b] = a;
    const a2 = find(a), c2 = find(c);
    if (a2 !== c2) par[c2] = a2;
  }
  const compTris = new Map();
  for (let t = 0; t < nT; t++) if (keep[t]) { const r = find(wid[idx[t * 3]]); compTris.set(r, (compTris.get(r) ?? 0) + 1); }
  let removedSmall = 0;
  for (let t = 0; t < nT; t++) {
    if (!keep[t]) continue;
    if ((compTris.get(find(wid[idx[t * 3]])) ?? 0) < F.minComponentTris) { keep[t] = 0; removedSmall++; }
  }

  // 3) компактизация вершин
  const remap = new Int32Array(nV).fill(-1);
  let nv = 0;
  const outIdx = [];
  for (let t = 0; t < nT; t++) {
    if (!keep[t]) continue;
    for (let k = 0; k < 3; k++) {
      const v = idx[t * 3 + k];
      if (remap[v] < 0) remap[v] = nv++;
      outIdx.push(remap[v]);
    }
  }
  const P = new Float32Array(nv * 3), UV = new Float32Array(nv * 2), SRC = new Int32Array(nv);
  const U = new Float32Array(nv * 3); // исходные позиции (единицы модели) — для весов/отладки
  for (let v = 0; v < nV; v++) {
    const r = remap[v];
    if (r < 0) continue;
    SRC[r] = v;
    const w = warp(pos[v * 3], pos[v * 3 + 1], pos[v * 3 + 2], F);
    P[r * 3] = w[0]; P[r * 3 + 1] = w[1]; P[r * 3 + 2] = w[2];
    U[r * 3] = pos[v * 3]; U[r * 3 + 1] = pos[v * 3 + 1]; U[r * 3 + 2] = pos[v * 3 + 2];
    UV[r * 2] = uv[v * 2]; UV[r * 2 + 1] = uv[v * 2 + 1];
  }
  return { pos: P, uv: UV, src: SRC, units: U, idx: Uint32Array.from(outIdx), stats: { nV, nT, counts, keptTris: outIdx.length / 3, removedSmall, verts: nv } };
}

/** Сглаженные нормали по склеенным позициям (без швов на разрывах UV). */
export function weldedNormals(pos, idx) {
  const nV = pos.length / 3;
  const key = new Map();
  const wid = new Int32Array(nV);
  for (let i = 0; i < nV; i++) {
    const k = `${Math.round(pos[i * 3] * 1e5)}_${Math.round(pos[i * 3 + 1] * 1e5)}_${Math.round(pos[i * 3 + 2] * 1e5)}`;
    let id = key.get(k);
    if (id === undefined) { id = key.size; key.set(k, id); }
    wid[i] = id;
  }
  const acc = new Float64Array(key.size * 3);
  for (let t = 0; t < idx.length; t += 3) {
    const a = idx[t], b = idx[t + 1], c = idx[t + 2];
    const ux = pos[b * 3] - pos[a * 3], uy = pos[b * 3 + 1] - pos[a * 3 + 1], uz = pos[b * 3 + 2] - pos[a * 3 + 2];
    const vx = pos[c * 3] - pos[a * 3], vy = pos[c * 3 + 1] - pos[a * 3 + 1], vz = pos[c * 3 + 2] - pos[a * 3 + 2];
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    for (const i of [a, b, c]) { const w = wid[i]; acc[w * 3] += nx; acc[w * 3 + 1] += ny; acc[w * 3 + 2] += nz; }
  }
  const N = new Float32Array(nV * 3);
  for (let i = 0; i < nV; i++) {
    const w = wid[i];
    const l = Math.hypot(acc[w * 3], acc[w * 3 + 1], acc[w * 3 + 2]) || 1;
    N[i * 3] = acc[w * 3] / l; N[i * 3 + 1] = acc[w * 3 + 1] / l; N[i * 3 + 2] = acc[w * 3 + 2] / l;
  }
  return N;
}

/**
 * Выталкивание оболочки наружу из тела человека (зазор clearance, м): body — позиции и нормали точек тела (без рук).
 * Сетка ячеек 2 см; для каждой вершины оболочки — ближайшая точка тела; если вершина «под кожей» — выносим по нормали.
 */
export function pushOut(pos, body, clearance = 0.007, range = 0.06) {
  const cell = 0.02;
  const grid = new Map();
  const key = (x, y, z) => `${x}_${y}_${z}`;
  const nb = body.pos.length / 3;
  for (let i = 0; i < nb; i++) {
    const k = key(Math.floor(body.pos[i * 3] / cell), Math.floor(body.pos[i * 3 + 1] / cell), Math.floor(body.pos[i * 3 + 2] / cell));
    const a = grid.get(k); if (a) a.push(i); else grid.set(k, [i]);
  }
  const n = pos.length / 3;
  let moved = 0;
  for (let v = 0; v < n; v++) {
    const x = pos[v * 3], y = pos[v * 3 + 1], z = pos[v * 3 + 2];
    const cx = Math.floor(x / cell), cy = Math.floor(y / cell), cz = Math.floor(z / cell);
    let best = -1, bd = range * range;
    for (let dx = -3; dx <= 3; dx++) for (let dy = -3; dy <= 3; dy++) for (let dz = -3; dz <= 3; dz++) {
      const a = grid.get(key(cx + dx, cy + dy, cz + dz));
      if (!a) continue;
      for (const i of a) {
        const d = (body.pos[i * 3] - x) ** 2 + (body.pos[i * 3 + 1] - y) ** 2 + (body.pos[i * 3 + 2] - z) ** 2;
        if (d < bd) { bd = d; best = i; }
      }
    }
    if (best < 0) continue;
    const qx = body.pos[best * 3], qy = body.pos[best * 3 + 1], qz = body.pos[best * 3 + 2];
    const nx = body.nor[best * 3], ny = body.nor[best * 3 + 1], nz = body.nor[best * 3 + 2];
    const s = (x - qx) * nx + (y - qy) * ny + (z - qz) * nz; // расстояние вдоль нормали (отрицательное — внутри)
    if (s < clearance) {
      const k = clearance - s;
      pos[v * 3] = x + nx * k; pos[v * 3 + 1] = y + ny * k; pos[v * 3 + 2] = z + nz * k;
      moved++;
    }
  }
  return moved;
}

export { CLASS };
