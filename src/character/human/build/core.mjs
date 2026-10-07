// Ядро сборки: форма → поза → subdivision → части (голова/тело) → скиннинг → морфы.

import { buildPosed, loadBase } from './pipeline.mjs';
import { subdivideTopology, subdivideUV } from './subdiv.mjs';
import { uvIslands, positionNormals, assemblePart, packRects } from './mesh.mjs';
import { logicalBones, logicalOf, collapseWeights, top4, restPositions, fingerTips } from './bones.mjs';
import { RECIPES, recipeDisp, MORPH_ORDER } from './expr.mjs';
import { m3, v3 } from './lin.mjs';

/** Линейная часть LBS: смещения (3n) → смещения в целевой позе. */
export function lbsDelta(pf, W, D, nV) {
  const lin = {};
  for (const n of Object.keys(pf.xf)) lin[n] = pf.xf[n].linear();
  const out = new Float64Array(D.length);
  for (let i = 0; i < nV; i++) {
    const d = [D[i * 3], D[i * 3 + 1], D[i * 3 + 2]];
    if (d[0] === 0 && d[1] === 0 && d[2] === 0) continue;
    let x = 0, y = 0, z = 0;
    for (const [b, w] of W[i]) { const q = m3.vec(lin[b], d); x += q[0] * w; y += q[1] * w; z += q[2] * w; }
    out[i * 3] = x; out[i * 3 + 1] = y; out[i * 3 + 2] = z;
  }
  return out;
}

export function buildCore(opts = {}) {
  const R = buildPosed({ skullK: opts.skullK ?? 0.1, shape: opts.shape, pose: opts.pose });
  const base = loadBase();
  const { obj, nV, W } = base;
  const bones = logicalBones();
  const boneIndex = new Map(bones.map(([n], i) => [n, i]));
  const rest = restPositions(R.pf);

  const bodyF = obj.faces.filter((f) => f.g === 'body');
  const nUV = obj.vt.length / 2;
  const topo = subdivideTopology(nV, bodyF.map((f) => f.v));
  const uvTopo = subdivideUV(nUV, bodyF.map((f) => f.t));
  const P2 = topo.op.apply(R.Q);
  const UV2 = uvTopo.op.apply(obj.vt, 2);
  const n2 = P2.length / 3;

  // скиннинг: свёртка на логические кости, затем оператор subdivision и top-4
  const Wc = collapseWeights(W, boneIndex);
  const op = topo.op;
  const W2 = new Array(n2);
  for (let i = 0; i < n2; i++) {
    const acc = new Map();
    for (let k = op.ptr[i]; k < op.ptr[i + 1]; k++) {
      const cw = op.w[k];
      for (const [b, w] of Wc[op.idx[k]]) acc.set(b, (acc.get(b) ?? 0) + w * cw);
    }
    W2[i] = top4(acc);
  }

  // острова UV и классификация: голова (голова, уши, рот) / тело
  const isl = uvIslands(bodyF.map((f) => f.t), nUV);
  const nIsl = Math.max(...isl) + 1;
  const headCnt = new Float64Array(nIsl), cnt = new Float64Array(nIsl);
  bodyF.forEach((f, fi) => {
    const dom = [...Wc[f.v[0]].entries()].sort((a, b) => b[1] - a[1])[0][0];
    const nm = bones[dom][0];
    cnt[isl[fi]]++;
    if (nm === 'head' || nm === 'neck') headCnt[isl[fi]]++;
  });
  const isHeadIsland = Array.from({ length: nIsl }, (_, i) => headCnt[i] / cnt[i] > 0.5);

  // грани после subdivision: по 4 на исходную
  const faces2 = topo.faces, uvFaces2 = uvTopo.faces;
  const faceIsl = (j) => isl[j >> 2];

  // упаковка UV головы (общий масштаб, чтобы плотность текселей была одинаковой)
  const uvIsland = new Int32Array(UV2.length / 2).fill(-1);
  bodyF.forEach((f, fi) => f.t.forEach((t) => { uvIsland[t] = isl[fi]; }));
  uvFaces2.forEach((f, j) => f.forEach((t) => { uvIsland[t] = faceIsl(j); }));
  const bbox = new Map();
  for (let t = 0; t < uvIsland.length; t++) {
    const id = uvIsland[t]; if (id < 0 || !isHeadIsland[id]) continue;
    const u = UV2[t * 2], v = UV2[t * 2 + 1];
    const b = bbox.get(id) ?? [1e9, 1e9, -1e9, -1e9];
    b[0] = Math.min(b[0], u); b[1] = Math.min(b[1], v); b[2] = Math.max(b[2], u); b[3] = Math.max(b[3], v);
    bbox.set(id, b);
  }
  const rects = [...bbox.entries()].map(([id, b]) => ({ id, w: b[2] - b[0], h: b[3] - b[1] }));
  const pack = packRects(rects);
  const UV1 = new Float64Array(UV2.length);
  for (let t = 0; t < uvIsland.length; t++) {
    const id = uvIsland[t];
    if (id < 0 || !isHeadIsland[id]) continue;
    const b = bbox.get(id), p = pack.place.get(id);
    UV1[t * 2] = (UV2[t * 2] - b[0]) * pack.s + p[0];
    UV1[t * 2 + 1] = (UV2[t * 2 + 1] - b[1]) * pack.s + p[1];
  }

  // морф-цели головы (смещения на исходных вершинах → линейная часть LBS → subdivision)
  const morphs = {};
  for (const [name, recipe] of Object.entries(RECIPES)) {
    const D = recipeDisp(nV, recipe);
    for (let i = 0; i < D.length; i++) D[i] *= 0.1;
    morphs[name] = op.apply(lbsDelta(R.pf, W, D, nV));
  }

  const normals = positionNormals(P2, faces2);

  return {
    R, bones, boneIndex, rest, tips: fingerTips(R.pf), topo, uvTopo, bodyF, P2, UV2, UV1, n2, W2, normals,
    faces2, uvFaces2, isHeadIsland, faceIsl, packScale: pack.s, morphs, nUV, nV, obj, Wc,
  };
}

/** Части (голова/тело) как наборы граней subdivision. */
export function splitParts(core) {
  const { faces2, uvFaces2, isHeadIsland, faceIsl } = core;
  const head = [], body = [];
  faces2.forEach((p, j) => {
    const f = { p, t: uvFaces2[j], t1: uvFaces2[j] };
    (isHeadIsland[faceIsl(j)] ? head : body).push(f);
  });
  return { head, body };
}

export const _v3 = v3;
export { MORPH_ORDER, logicalOf };
