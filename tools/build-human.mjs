// Сборка «человека» из данных MakeHuman (CC0) в компактный бинарник для игры.
//   node tools/build-human.mjs          → public/models/human.bin + human.json (+ eye_brown.png)
// Формат: JSON описывает части (тело, голова, глаза, зубы, язык, ресницы), смещения буферов, морф-цели (разреженные),
// кости (имя, родитель, положение покоя) и ориентиры лица. Бинарник читает src/character/human/human.ts.

import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { buildCore, splitParts } from '../src/character/human/build/core.mjs';
import { assemblePart, positionNormals } from '../src/character/human/build/mesh.mjs';
import { RECIPES, JAW_DEG_PER_UNIT } from '../src/character/human/build/expr.mjs';
import { parseMhclo, parseObj, MH_DATA } from '../src/character/human/build/mh.mjs';
import { loadBase } from '../src/character/human/build/pipeline.mjs';

const OUT = path.resolve('public/models');
fs.mkdirSync(OUT, { recursive: true });

class Bin {
  constructor() { this.chunks = []; this.size = 0; }
  add(arr) {
    const pad = (4 - (this.size % 4)) % 4;
    if (pad) { this.chunks.push(Buffer.alloc(pad)); this.size += pad; }
    const off = this.size;
    const buf = Buffer.from(arr.buffer, arr.byteOffset, arr.byteLength);
    this.chunks.push(buf);
    this.size += buf.length;
    return off;
  }
  save(file) { fs.writeFileSync(file, Buffer.concat(this.chunks)); }
}
const bin = new Bin();
const attr = (arr, type, n) => ({ off: bin.add(arr), type, n, count: arr.length / n });

const t0 = Date.now();
const core = buildCore({ skullK: 0.1 });
const { R, bones, rest, P2, UV1, UV2, normals, W2 } = core;
const base = loadBase();
const BONE = Object.fromEntries(bones.map(([n], i) => [n, i]));
const parts = {};

const f32 = (a) => Float32Array.from(a);
const quantW = (w) => {
  const q = w.map((x) => Math.round(x * 255));
  let s = q.reduce((a, b) => a + b, 0);
  let k = 0; while (s !== 255 && k++ < 8) { const i = q.indexOf(Math.max(...q)); q[i] += 255 - s; s = q.reduce((a, b) => a + b, 0); }
  return q;
};

function emitMesh(name, { pos, nor, uv, skinB, skinW, idx, morphs = [], extra = {} }) {
  const n = pos.length / 3;
  const p = {
    name, verts: n, tris: idx.length / 3,
    position: attr(f32(pos), 'f32', 3), normal: attr(f32(nor), 'f32', 3),
    index: attr(n > 65535 ? Uint32Array.from(idx) : Uint16Array.from(idx), n > 65535 ? 'u32' : 'u16', 1),
    morphs: [], ...extra,
  };
  if (uv) p.uv = attr(f32(uv), 'f32', 2);
  if (skinB) { p.skinIndex = attr(Uint8Array.from(skinB), 'u8', 4); p.skinWeight = attr(Uint8Array.from(skinW), 'u8', 4); }
  for (const m of morphs) {
    p.morphs.push({ name: m.name, idx: attr(Uint32Array.from(m.idx), 'u32', 1), delta: attr(f32(m.delta), 'f32', 3), count: m.idx.length });
  }
  parts[name] = p;
  return p;
}

/** Часть из граней subdivision (тело/голова). */
function surfacePart(name, faces, uvSrc, morphSrc) {
  const a = assemblePart(faces);
  const n = a.posId.length;
  const pos = new Float64Array(n * 3), nor = new Float64Array(n * 3), uv = new Float64Array(n * 2);
  const skinB = new Array(n * 4), skinW = new Array(n * 4);
  for (let i = 0; i < n; i++) {
    const v = a.posId[i];
    for (let k = 0; k < 3; k++) { pos[i * 3 + k] = P2[v * 3 + k]; nor[i * 3 + k] = normals[v * 3 + k]; }
    uv[i * 2] = uvSrc[a.uvId[i] * 2]; uv[i * 2 + 1] = uvSrc[a.uvId[i] * 2 + 1];
    const q = quantW(W2[v].w);
    for (let k = 0; k < 4; k++) { skinB[i * 4 + k] = W2[v].b[k]; skinW[i * 4 + k] = q[k]; }
  }
  const morphs = [];
  if (morphSrc) {
    for (const [mname, D] of Object.entries(morphSrc)) {
      const idx = [], delta = [];
      for (let i = 0; i < n; i++) {
        const v = a.posId[i];
        const dx = D[v * 3], dy = D[v * 3 + 1], dz = D[v * 3 + 2];
        if (Math.abs(dx) + Math.abs(dy) + Math.abs(dz) > 2e-6) { idx.push(i); delta.push(dx, dy, dz); }
      }
      morphs.push({ name: mname, idx, delta });
    }
  }
  const p = emitMesh(name, { pos, nor, uv, skinB, skinW, idx: a.indices, morphs });
  return { p, a, pos, nor };
}

const { head, body } = splitParts(core);

// ---------- ориентиры лица ----------
const Q = R.Q;
const groupVerts = (g) => { const s = new Set(); for (const f of base.obj.faces) if (f.g === g) for (const i of f.v) s.add(i); return [...s]; };
const center = (ids, P = Q) => { const c = [0, 0, 0]; for (const i of ids) for (let k = 0; k < 3; k++) c[k] += P[i * 3 + k]; return c.map((x) => x / ids.length); };
const eyeL = center(groupVerts('helper-l-eye')), eyeR = center(groupVerts('helper-r-eye'));
// профиль в сагиттальной плоскости (|x| < 3 мм) по вершинам головы
const headPart = surfacePart('head', head, UV1, (() => {
  // морфы рецептов: смещения уже в метрах на вершинах subdivision
  const m = {};
  for (const k of Object.keys(core.morphs)) m[k] = core.morphs[k];
  return m;
})());
const hp = headPart.pos;
const sag = [];
for (let i = 0; i < hp.length / 3; i++) if (Math.abs(hp[i * 3]) < 0.003 && hp[i * 3 + 2] > 0.02) sag.push([hp[i * 3 + 1], hp[i * 3 + 2]]);
sag.sort((a, b) => a[0] - b[0]);
const inRange = (y0, y1) => sag.filter(([y]) => y >= y0 && y <= y1);
const eyeY = (eyeL[1] + eyeR[1]) / 2;
const noseCand = inRange(eyeY - 0.075, eyeY - 0.015).sort((a, b) => b[1] - a[1])[0];
const noseTip = [0, noseCand[0], noseCand[1]];
// впадина между губами — минимум z в диапазоне от основания носа до подбородка
let chinY = 1e9;
for (let i = 0; i < hp.length / 3; i++) if (Math.abs(hp[i * 3]) < 0.01 && hp[i * 3 + 1] < eyeY - 0.03 && hp[i * 3 + 1] > eyeY - 0.2 && hp[i * 3 + 2] > 0.03) chinY = Math.min(chinY, hp[i * 3 + 1]);
const mouthRange = inRange(chinY + 0.025, noseTip[1] - 0.014).filter(([, z]) => z > 0.07);
let mouth = mouthRange.length ? mouthRange.reduce((a, b) => (b[1] < a[1] ? b : a)) : [noseTip[1] - 0.03, 0.1];
const mouthC = [0, mouth[0], mouth[1]];
let top = -1e9; for (let i = 0; i < hp.length / 3; i++) top = Math.max(top, hp[i * 3 + 1]);
const lm = { eyeL, eyeR, noseTip, mouth: mouthC, chinY, top, earZ: R.lm.earZ + R.head.dz, eyeY };

// ---------- свелл-цели (отёки при повреждениях лица) ----------
const nrmH = headPart.nor;
function bumpTarget(name, centers, sigma, amp, dirFn) {
  const idx = [], delta = [];
  const n = hp.length / 3;
  for (let i = 0; i < n; i++) {
    let wMax = 0;
    for (const c of centers) {
      const d2 = (hp[i * 3] - c[0]) ** 2 + (hp[i * 3 + 1] - c[1]) ** 2 + (hp[i * 3 + 2] - c[2]) ** 2;
      const w = Math.exp(-d2 / (2 * sigma * sigma));
      if (w > wMax) wMax = w;
    }
    if (wMax < 0.02) continue;
    const nx = nrmH[i * 3], ny = nrmH[i * 3 + 1], nz = nrmH[i * 3 + 2];
    if (nz < -0.2) continue; // только лицевая сторона
    const d = dirFn ? dirFn(nx, ny, nz) : [nx, ny, nz];
    idx.push(i); delta.push(d[0] * amp * wMax, d[1] * amp * wMax, d[2] * amp * wMax);
  }
  headPart.p.morphs.push({ name, idx: attr(Uint32Array.from(idx), 'u32', 1), delta: attr(f32(delta), 'f32', 3), count: idx.length });
}
// щёки: центр — на скуле, чуть ниже и кнаружи от глаза
const cheekC = (s) => { const e = s > 0 ? eyeL : eyeR; return [e[0] + s * 0.012, e[1] - 0.036, e[2] - 0.012]; };
const surfPoint = (c) => {
  // ближайшая по (x, y) вершина лица с максимальным z
  let best = null, bz = -1e9;
  for (let i = 0; i < hp.length / 3; i++) {
    if (Math.abs(hp[i * 3] - c[0]) < 0.006 && Math.abs(hp[i * 3 + 1] - c[1]) < 0.006 && hp[i * 3 + 2] > bz) { bz = hp[i * 3 + 2]; best = [hp[i * 3], hp[i * 3 + 1], hp[i * 3 + 2]]; }
  }
  return best ?? c;
};
const cL = surfPoint(cheekC(1)), cR = surfPoint(cheekC(-1));
bumpTarget('swellCheekL', [cL], 0.026, 0.0095);
bumpTarget('swellCheekR', [cR], 0.026, 0.0095);
const eL = surfPoint([eyeL[0], eyeL[1] + 0.004, eyeL[2]]), eR = surfPoint([eyeR[0], eyeR[1] + 0.004, eyeR[2]]);
bumpTarget('swellEyeL', [eL], 0.019, 0.0075, (nx, ny, nz) => [nx * 0.7, ny * 0.7 - 0.45, nz]);
bumpTarget('swellEyeR', [eR], 0.019, 0.0075, (nx, ny, nz) => [nx * 0.7, ny * 0.7 - 0.45, nz]);

const bodyBuilt = surfacePart('body', body, UV2, null);

// ---------- профили сечений тела по высоте (для кроя одежды) ----------
// Для каждой группы (торс, руки, ноги) и высоты y: описанный эллипс сечения {cx, cz, rx, rz} без зазора.
const profiles = {};
{
  const groupOf = (name) => {
    if (/^(hips|spine|chest|neck)$/.test(name)) return 'torso';
    if (/^(shoulder|upperArm|lowerArm|hand|thumb\d|index\d|middle\d|ring\d|pinky\d)L$/.test(name) || /^(thumb|index|middle|ring|pinky)\dL$/.test(name)) return 'armL';
    if (/^(shoulder|upperArm|lowerArm|hand)R$/.test(name) || /^(thumb|index|middle|ring|pinky)\dR$/.test(name)) return 'armR';
    if (/^(upperLeg|lowerLeg|foot|toe)L$/.test(name)) return 'legL';
    if (/^(upperLeg|lowerLeg|foot|toe)R$/.test(name)) return 'legR';
    return null;
  };
  const ids = [...new Set(bodyBuilt.a.posId)];
  const byGroup = { torso: [], armL: [], armR: [], legL: [], legR: [] };
  for (const v of ids) {
    const g = groupOf(bones[W2[v].b[0]][0]);
    if (g) byGroup[g].push(v);
  }
  for (const [g, list] of Object.entries(byGroup)) {
    const arr = [];
    for (let y = 0.0; y <= 1.56; y += 0.02) {
      const slab = list.filter((v) => Math.abs(P2[v * 3 + 1] - y) < 0.011);
      if (slab.length < 6) continue;
      let x0 = 1e9, x1 = -1e9, z0 = 1e9, z1 = -1e9;
      for (const v of slab) { x0 = Math.min(x0, P2[v * 3]); x1 = Math.max(x1, P2[v * 3]); z0 = Math.min(z0, P2[v * 3 + 2]); z1 = Math.max(z1, P2[v * 3 + 2]); }
      const cx = (x0 + x1) / 2, cz = (z0 + z1) / 2, hx = Math.max(0.005, (x1 - x0) / 2), hz = Math.max(0.005, (z1 - z0) / 2);
      let f = 1;
      for (const v of slab) f = Math.max(f, Math.hypot((P2[v * 3] - cx) / hx, (P2[v * 3 + 2] - cz) / hz));
      arr.push({ y: +y.toFixed(3), cx: +cx.toFixed(4), cz: +cz.toFixed(4), rx: +(hx * f).toFixed(4), rz: +(hz * f).toFixed(4) });
    }
    profiles[g] = arr;
  }
}

// ---------- вспомогательные группы базового меша: зубы, язык, ресницы ----------
function groupPart(name, groupNames, { morphJaw = false, uv = false } = {}) {
  const faces = base.obj.faces.filter((f) => groupNames.includes(f.g));
  const key = new Map(), pid = [], tid = [], idx = [];
  for (const f of faces) {
    const vs = f.v.map((v, k) => {
      const kk = `${v}_${f.t[k]}`;
      let id = key.get(kk);
      if (id === undefined) { id = pid.length; key.set(kk, id); pid.push(v); tid.push(f.t[k]); }
      return id;
    });
    for (let k = 1; k + 1 < vs.length; k++) idx.push(vs[0], vs[k], vs[k + 1]);
  }
  const n = pid.length;
  const pos = new Float64Array(n * 3);
  for (let i = 0; i < n; i++) for (let k = 0; k < 3; k++) pos[i * 3 + k] = Q[pid[i] * 3 + k];
  // нормали по позициям
  const nor = new Float64Array(n * 3);
  for (let t = 0; t < idx.length; t += 3) {
    const [a, b, c] = [idx[t], idx[t + 1], idx[t + 2]];
    const ux = pos[b * 3] - pos[a * 3], uy = pos[b * 3 + 1] - pos[a * 3 + 1], uz = pos[b * 3 + 2] - pos[a * 3 + 2];
    const vx = pos[c * 3] - pos[a * 3], vy = pos[c * 3 + 1] - pos[a * 3 + 1], vz = pos[c * 3 + 2] - pos[a * 3 + 2];
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    for (const i of [a, b, c]) { nor[i * 3] += nx; nor[i * 3 + 1] += ny; nor[i * 3 + 2] += nz; }
  }
  for (let i = 0; i < n; i++) { const l = Math.hypot(nor[i * 3], nor[i * 3 + 1], nor[i * 3 + 2]) || 1; nor[i * 3] /= l; nor[i * 3 + 1] /= l; nor[i * 3 + 2] /= l; }
  const uvA = new Float64Array(n * 2);
  if (uv) for (let i = 0; i < n; i++) { uvA[i * 2] = base.obj.vt[tid[i] * 2]; uvA[i * 2 + 1] = base.obj.vt[tid[i] * 2 + 1]; }
  const skinB = [], skinW = [];
  for (let i = 0; i < n; i++) skinB.push(BONE.head, 0, 0, 0), skinW.push(255, 0, 0, 0);
  const morphs = [];
  if (morphJaw) {
    // жёсткий поворот нижней челюсти вокруг оси через сустав (x=0, y=…, z=…)
    const pivot = [0, lm.eyeY - 0.075, lm.earZ + 0.012];
    for (const [mname, recipe] of Object.entries(RECIPES)) {
      const w = recipe['mouth-open'] ?? 0;
      if (!w) continue;
      const th = (w * JAW_DEG_PER_UNIT * Math.PI) / 180;
      const c = Math.cos(th), s = Math.sin(th);
      const idxs = [], delta = [];
      for (let i = 0; i < n; i++) {
        const y = pos[i * 3 + 1] - pivot[1], z = pos[i * 3 + 2] - pivot[2];
        const y2 = y * c - z * s, z2 = y * s + z * c;
        idxs.push(i); delta.push(0, y2 - y, z2 - z);
      }
      morphs.push({ name: mname, idx: idxs, delta });
    }
  }
  emitMesh(name, { pos, nor, uv: uv ? uvA : null, skinB, skinW, idx, morphs });
}
groupPart('teethUpper', ['helper-upper-teeth']);
groupPart('teethLower', ['helper-lower-teeth'], { morphJaw: true });
groupPart('tongue', ['helper-tongue'], { morphJaw: true });
groupPart('lashL', ['helper-l-eyelashes-1', 'helper-l-eyelashes-2'], { uv: true });
groupPart('lashR', ['helper-r-eyelashes-1', 'helper-r-eyelashes-2'], { uv: true });

// ---------- глаза: высокополигональные из MakeHuman, подгонка по .mhclo ----------
{
  const dir = path.join(MH_DATA, 'eyes', 'high-poly');
  const eo = parseObj(fs.readFileSync(path.join(dir, 'high-poly.obj'), 'utf8'));
  const mh = parseMhclo(fs.readFileSync(path.join(dir, 'high-poly.mhclo'), 'utf8'));
  const sc = (k) => { const s = mh.scale[k]; return Math.abs(Q[s.a * 3 + 'xyz'.indexOf(k)] - Q[s.b * 3 + 'xyz'.indexOf(k)]) * 10 / s.s; };
  const S = [sc('x'), sc('y'), sc('z')];
  const nv = mh.verts.length;
  const P = new Float64Array(nv * 3);
  mh.verts.forEach((v, i) => {
    for (let k = 0; k < 3; k++) {
      let x = 0;
      v.idx.forEach((bi, j) => { x += Q[bi * 3 + k] * v.w[j]; });
      P[i * 3 + k] = x + v.off[k] * S[k] * 0.1;
    }
  });
  // глаза чуть крупнее и ближе к векам: иначе в разрезе виден тёмный провал
  const EYE_SCALE = +(process.env.EYE_SCALE ?? 1.1), EYE_DZ = +(process.env.EYE_DZ ?? 0.0035);
  for (const side of [1, -1]) {
    const ids = []; for (let i = 0; i < nv; i++) if (P[i * 3] * side > 0) ids.push(i);
    const c = [0, 0, 0]; for (const i of ids) for (let k = 0; k < 3; k++) c[k] += P[i * 3 + k] / ids.length;
    for (const i of ids) { for (let k = 0; k < 3; k++) P[i * 3 + k] = c[k] + (P[i * 3 + k] - c[k]) * EYE_SCALE; P[i * 3 + 2] += EYE_DZ; }
  }
  // уникальные пары (позиция, uv)
  const key = new Map(), pid = [], tid = [], idx = [];
  for (const f of eo.faces) {
    const vs = f.v.map((v, k) => { const kk = `${v}_${f.t[k]}`; let id = key.get(kk); if (id === undefined) { id = pid.length; key.set(kk, id); pid.push(v); tid.push(f.t[k]); } return id; });
    for (let k = 1; k + 1 < vs.length; k++) idx.push(vs[0], vs[k], vs[k + 1]);
  }
  const n = pid.length;
  const pos = new Float64Array(n * 3), uv = new Float64Array(n * 2);
  for (let i = 0; i < n; i++) { for (let k = 0; k < 3; k++) pos[i * 3 + k] = P[pid[i] * 3 + k]; uv[i * 2] = eo.vt[tid[i] * 2]; uv[i * 2 + 1] = eo.vt[tid[i] * 2 + 1]; }
  // нормали — сглаженные по позициям (одна точка → одна нормаль)
  const acc = new Map(), nor = new Float64Array(n * 3);
  const pkey = (i) => `${pid[i]}`;
  for (let t = 0; t < idx.length; t += 3) {
    const [a, b, c] = [idx[t], idx[t + 1], idx[t + 2]];
    const ux = pos[b * 3] - pos[a * 3], uy = pos[b * 3 + 1] - pos[a * 3 + 1], uz = pos[b * 3 + 2] - pos[a * 3 + 2];
    const vx = pos[c * 3] - pos[a * 3], vy = pos[c * 3 + 1] - pos[a * 3 + 1], vz = pos[c * 3 + 2] - pos[a * 3 + 2];
    const nn = [uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx];
    for (const i of [a, b, c]) { const k = pkey(i); const s = acc.get(k) ?? [0, 0, 0]; s[0] += nn[0]; s[1] += nn[1]; s[2] += nn[2]; acc.set(k, s); }
  }
  for (let i = 0; i < n; i++) { const s = acc.get(pkey(i)); const l = Math.hypot(...s) || 1; nor[i * 3] = s[0] / l; nor[i * 3 + 1] = s[1] / l; nor[i * 3 + 2] = s[2] / l; }
  const skinB = [], skinW = [];
  for (let i = 0; i < n; i++) skinB.push(BONE.head, 0, 0, 0), skinW.push(255, 0, 0, 0);
  // разделить на левый/правый глаз по знаку x центра грани; «роговичная оболочка» (UV в белом кружке атласа) — отдельно
  const left = [], right = [], cornL = [], cornR = [];
  const inShell = (i) => Math.hypot(uv[i * 2] - 0.93, uv[i * 2 + 1] - 0.07) < 0.085;
  for (let t = 0; t < idx.length; t += 3) {
    const cx = (pos[idx[t] * 3] + pos[idx[t + 1] * 3] + pos[idx[t + 2] * 3]) / 3;
    const shell = inShell(idx[t]) && inShell(idx[t + 1]) && inShell(idx[t + 2]);
    (cx > 0 ? (shell ? cornL : left) : (shell ? cornR : right)).push(idx[t], idx[t + 1], idx[t + 2]);
  }
  console.log('eye faces: ball', left.length / 3, right.length / 3, 'cornea', cornL.length / 3, cornR.length / 3);
  // нормали и обход граней должны смотреть наружу от центра глаза: проверяем и при необходимости переворачиваем
  const outward = (ids) => {
    const set = [...new Set(ids)];
    const c = [0, 0, 0];
    for (const i of set) for (let k = 0; k < 3; k++) c[k] += pos[i * 3 + k] / set.length;
    let dsum = 0;
    for (const i of set) dsum += nor[i * 3] * (pos[i * 3] - c[0]) + nor[i * 3 + 1] * (pos[i * 3 + 1] - c[1]) + nor[i * 3 + 2] * (pos[i * 3 + 2] - c[2]);
    return dsum >= 0;
  };
  const fixed = (ids) => {
    if (outward(ids)) return { ids, flip: false };
    const r = ids.slice();
    for (let t = 0; t < r.length; t += 3) { const x = r[t + 1]; r[t + 1] = r[t + 2]; r[t + 2] = x; }
    return { ids: r, flip: true };
  };
  const L = fixed(left), Rr = fixed(right);
  if (L.flip || Rr.flip) for (let i = 0; i < nor.length; i++) nor[i] = -nor[i];
  console.log('eye normals flipped:', L.flip, Rr.flip);
  for (const [nm, ids] of [['L', L.ids], ['R', Rr.ids]]) {
    const set = [...new Set(ids)];
    const c = [0, 0, 0]; for (const i of set) for (let k = 0; k < 3; k++) c[k] += pos[i * 3 + k] / set.length;
    let out = 0, tot = 0;
    for (let t = 0; t < ids.length; t += 3) {
      const [a, b, cc] = [ids[t], ids[t + 1], ids[t + 2]];
      const ux = pos[b * 3] - pos[a * 3], uy = pos[b * 3 + 1] - pos[a * 3 + 1], uz = pos[b * 3 + 2] - pos[a * 3 + 2];
      const vx = pos[cc * 3] - pos[a * 3], vy = pos[cc * 3 + 1] - pos[a * 3 + 1], vz = pos[cc * 3 + 2] - pos[a * 3 + 2];
      const n = [uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx];
      const m = [(pos[a * 3] + pos[b * 3] + pos[cc * 3]) / 3 - c[0], (pos[a * 3 + 1] + pos[b * 3 + 1] + pos[cc * 3 + 1]) / 3 - c[1], (pos[a * 3 + 2] + pos[b * 3 + 2] + pos[cc * 3 + 2]) / 3 - c[2]];
      tot++; if (n[0] * m[0] + n[1] * m[1] + n[2] * m[2] > 0) out++;
    }
    console.log('eye', nm, 'tris', tot, 'outward geometric', out, 'center', c.map((x) => x.toFixed(4)).join(','));
  }
  const mk = (name, ids) => emitMesh(name, { pos, nor, uv, skinB, skinW, idx: ids });
  mk('eyeL', L.ids); mk('eyeR', Rr.ids);
  mk('corneaL', fixed(cornL).ids); mk('corneaR', fixed(cornR).ids);
  lm.eyeBallL = center([...new Set(left)].map((i) => i), pos);
  lm.eyeBallR = center([...new Set(right)].map((i) => i), pos);
}

// ---------- кости ----------
const boneList = bones.map(([name, parent]) => ({ name, parent, pos: rest[name] }));

// кости пальцев для скелета игры (rig.ts подключает их к BONE_SPECS)
{
  const fingers = boneList.filter((b) => /^(thumb|index|middle|ring|pinky)[123][LR]$/.test(b.name));
  const lines = fingers.map((b) => `  { name: '${b.name}', parent: '${b.parent}', pos: [${b.pos.map((x) => +x.toFixed(5)).join(', ')}] },`);
  fs.writeFileSync(path.resolve('src/character/human/fingers.ts'),
    `// Сгенерировано tools/build-human.mjs (кости пальцев MakeHuman, поза покоя игры) — не править вручную.\nimport type { BoneSpec } from '../rig';\n\nexport const FINGER_BONE_SPECS: BoneSpec[] = [\n${lines.join('\n')}\n];\n`);
}

const json = { version: 1, bones: boneList, landmarks: lm, profiles, parts, bin: 'human.bin', stats: { verts: Object.values(parts).reduce((s, p) => s + p.verts, 0), tris: Object.values(parts).reduce((s, p) => s + p.tris, 0) } };
bin.save(path.join(OUT, 'human.bin'));
fs.writeFileSync(path.join(OUT, 'human.json'), JSON.stringify(json));

// текстура глаза (CC0, MakeHuman): 512²
try {
  execFileSync('python3', ['-I', '-c', `
from PIL import Image
im = Image.open(${JSON.stringify(path.join(MH_DATA, 'eyes', 'materials', 'brown_eye.png'))}).convert('RGBA')
im = im.resize((512, 512), Image.LANCZOS)
px = im.load()
for y in range(512):
    for x in range(512):
        r, g, b, a = px[x, y]
        lum = (r * 0.3 + g * 0.59 + b * 0.11) / 255.0
        redness = (r - g) / 255.0
        if redness > 0.12:           # радужка: от красноватой к тёмно-карей
            k = min(1.0, (redness - 0.12) * 6)
            r2, g2, b2 = r * (1 - 0.32 * k), g * (1 - 0.1 * k) + 6 * k, b * (1 - 0.1 * k) + 3 * k
        else:                        # белок: теплее и светлее
            r2, g2, b2 = min(255, r * 1.42 + 6), min(255, g * 1.38 + 4), min(255, b * 1.3)
        px[x, y] = (int(r2), int(g2), int(b2), a)
im.save(${JSON.stringify(path.join(OUT, 'eye_brown.png'))}, optimize=True)
`]);
} catch (e) { console.warn('eye texture:', e.message); }

console.log(`human.bin ${(bin.size / 1e6).toFixed(2)} МБ · вершин ${json.stats.verts} · треугольников ${json.stats.tris} · ${Date.now() - t0} мс`);
for (const [k, p] of Object.entries(parts)) console.log(' ', k.padEnd(10), 'v', p.verts, 'tris', p.tris, 'morphs', p.morphs.length);
console.log('landmarks', JSON.stringify(lm));
