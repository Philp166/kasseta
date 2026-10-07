// Один проход subdivision Catmull–Clark по квадам как линейный оператор.
// Оператор можно применять к позициям, весам скиннинга и смещениям морф-таргетов — всё остаётся согласованным.
// UV подразделяются билинейно (границы швов сохраняются).

/** CSR-оператор: новая вершина i = Σ w[k] · old[idx[k]] для k ∈ [ptr[i], ptr[i+1]). */
export class Op {
  constructor(rows) {
    const n = rows.length;
    this.n = n;
    this.ptr = new Int32Array(n + 1);
    let total = 0;
    for (const r of rows) total += r.length;
    this.idx = new Int32Array(total);
    this.w = new Float64Array(total);
    let o = 0;
    rows.forEach((r, i) => {
      this.ptr[i] = o;
      for (const [j, w] of r) { this.idx[o] = j; this.w[o] = w; o++; }
    });
    this.ptr[n] = o;
  }
  /** Применить к плотному массиву (n_old × stride). */
  apply(src, stride = 3) {
    const out = new Float64Array(this.n * stride);
    for (let i = 0; i < this.n; i++) {
      for (let k = this.ptr[i]; k < this.ptr[i + 1]; k++) {
        const j = this.idx[k] * stride, w = this.w[k];
        for (let c = 0; c < stride; c++) out[i * stride + c] += src[j + c] * w;
      }
    }
    return out;
  }
}

function addRow(row, j, w) {
  for (const e of row) if (e[0] === j) { e[1] += w; return; }
  row.push([j, w]);
}

/**
 * @param nV число вершин
 * @param faces массив квадов [a,b,c,d]
 * @returns { faces: новые квады, op: Op для позиций, nNew }
 * Порядок новых вершин: старые, рёбра, грани.
 */
export function subdivideTopology(nV, faces) {
  const edgeId = new Map();           // 'a_b' (a<b) → индекс ребра
  const edges = [];                   // [a, b, faceCount, f1, f2]
  const ekey = (a, b) => (a < b ? a * nV + b : b * nV + a);
  faces.forEach((f, fi) => {
    for (let k = 0; k < 4; k++) {
      const a = f[k], b = f[(k + 1) % 4];
      const key = ekey(a, b);
      let e = edgeId.get(key);
      if (e === undefined) { e = edges.length; edgeId.set(key, e); edges.push({ a: Math.min(a, b), b: Math.max(a, b), f: [] }); }
      edges[e].f.push(fi);
    }
  });
  const nE = edges.length, nF = faces.length;
  const rows = new Array(nV + nE + nF);
  for (let i = 0; i < rows.length; i++) rows[i] = [];
  // грани-точки
  for (let fi = 0; fi < nF; fi++) for (const v of faces[fi]) addRow(rows[nV + nE + fi], v, 0.25);
  // рёберные точки
  edges.forEach((e, ei) => {
    const row = rows[nV + ei];
    if (e.f.length === 2) {
      addRow(row, e.a, 0.25); addRow(row, e.b, 0.25);
      for (const fi of e.f) for (const v of faces[fi]) addRow(row, v, 0.25 * 0.25);
    } else { addRow(row, e.a, 0.5); addRow(row, e.b, 0.5); }
  });
  // вершинные точки
  const vf = Array.from({ length: nV }, () => []), ve = Array.from({ length: nV }, () => []);
  faces.forEach((f, fi) => f.forEach((v) => vf[v].push(fi)));
  edges.forEach((e, ei) => { ve[e.a].push(ei); ve[e.b].push(ei); });
  for (let v = 0; v < nV; v++) {
    const row = rows[v];
    const bnd = ve[v].filter((ei) => edges[ei].f.length === 1);
    if (bnd.length === 0) {
      const n = ve[v].length;
      if (n < 3) { addRow(row, v, 1); continue; }
      // (F + 2R + (n-3)P) / n, где F — среднее граней, R — среднее середин рёбер
      addRow(row, v, (n - 3) / n);
      for (const fi of vf[v]) for (const u of faces[fi]) addRow(row, u, (1 / n) * (1 / vf[v].length) * 0.25);
      for (const ei of ve[v]) { const e = edges[ei]; addRow(row, e.a, (2 / n) * (1 / ve[v].length) * 0.5); addRow(row, e.b, (2 / n) * (1 / ve[v].length) * 0.5); }
    } else if (bnd.length === 2) {
      addRow(row, v, 0.75);
      for (const ei of bnd) { const e = edges[ei]; addRow(row, e.a === v ? e.b : e.a, 0.125); }
    } else addRow(row, v, 1);
  }
  // новые квады
  const nf = [];
  for (let fi = 0; fi < nF; fi++) {
    const f = faces[fi];
    const fp = nV + nE + fi;
    const ep = [0, 1, 2, 3].map((k) => nV + edgeId.get(ekey(f[k], f[(k + 1) % 4])));
    for (let k = 0; k < 4; k++) nf.push([f[k], ep[k], fp, ep[(k + 3) % 4]]);
  }
  return { faces: nf, op: new Op(rows), edgeId, nV, nE, nF, ekey };
}

/** UV: билинейное подразделение. uvFaces — по 4 индекса vt на грань (соответствуют faces). */
export function subdivideUV(nUV, uvFaces) {
  const key = (a, b) => (a < b ? a * nUV + b : b * nUV + a);
  const eid = new Map(); const eList = [];
  for (const f of uvFaces) for (let k = 0; k < 4; k++) {
    const a = f[k], b = f[(k + 1) % 4], kk = key(a, b);
    if (!eid.has(kk)) { eid.set(kk, eList.length); eList.push([a, b]); }
  }
  const nE = eList.length, nF = uvFaces.length;
  const rows = [];
  for (let i = 0; i < nUV; i++) rows.push([[i, 1]]);
  for (const [a, b] of eList) rows.push([[a, 0.5], [b, 0.5]]);
  for (const f of uvFaces) rows.push(f.map((v) => [v, 0.25]));
  const nf = [];
  uvFaces.forEach((f, fi) => {
    const fp = nUV + nE + fi;
    const ep = [0, 1, 2, 3].map((k) => nUV + eid.get(key(f[k], f[(k + 1) % 4])));
    for (let k = 0; k < 4; k++) nf.push([f[k], ep[k], fp, ep[(k + 3) % 4]]);
  });
  return { faces: nf, op: new Op(rows) };
}
