// Конвейер формы: база MakeHuman → модификаторы → подгонка и поза покоя игры (LBS).

import fs from 'node:fs';
import path from 'node:path';
import { MH_DATA, parseObj, applyMacros, applyDetail, loadSkeleton, loadWeights, jointPos } from './mh.mjs';
import { PoseFit, weightsPerVertex, GAME } from './fit.mjs';
import { planPose } from './pose-plan.mjs';
import { MACRO, DETAIL, POSE, FACE_TARGET } from './config.mjs';

let baseCache = null;
export function loadBase() {
  if (baseCache) return baseCache;
  const obj = parseObj(fs.readFileSync(path.join(MH_DATA, '3dobjs', 'base.obj'), 'utf8'));
  const nV = obj.v.length / 3;
  const skel = loadSkeleton();
  const W = weightsPerVertex(loadWeights(), nV);
  const bodyVerts = new Set();
  for (const f of obj.faces) if (f.g === 'body') for (const i of f.v) bodyVerts.add(i);
  baseCache = { obj, nV, skel, W, bodyVerts };
  return baseCache;
}

const smooth = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

/** Форма в исходной позе MakeHuman, метры, подошвы на y = 0. */
export function shapeMesh({ macro = MACRO, detail = DETAIL, extra = null } = {}) {
  const base = loadBase();
  const { obj, nV } = base;
  const disp = new Float64Array(nV * 3);
  applyMacros(disp, macro);
  applyDetail(disp, detail);
  if (extra) extra(disp, base);
  const P = new Float64Array(nV * 3);
  for (let i = 0; i < P.length; i++) P[i] = (obj.v[i] + disp[i]) * 0.1;
  let ymin = 1e9;
  for (const i of base.bodyVerts) ymin = Math.min(ymin, P[i * 3 + 1]);
  for (let i = 0; i < nV; i++) P[i * 3 + 1] -= ymin;
  return P;
}

export function groupCenter(obj, P, g) {
  const s = new Set();
  for (const f of obj.faces) if (f.g === g) for (const i of f.v) s.add(i);
  const c = [0, 0, 0];
  for (const i of s) { c[0] += P[i * 3]; c[1] += P[i * 3 + 1]; c[2] += P[i * 3 + 2]; }
  return c.map((x) => x / s.size);
}

/** Ориентиры исходной головы: глаз, макушка, подбородок, ухо. */
export function headLandmarks(P) {
  const { obj, bodyVerts } = loadBase();
  const eyeL = groupCenter(obj, P, 'helper-l-eye');
  let top = -1e9, chin = 1e9, ez = 0, en = 0;
  for (const i of bodyVerts) {
    const x = P[i * 3], y = P[i * 3 + 1], z = P[i * 3 + 2];
    if (y > eyeL[1] - 0.2) {
      if (y > top) top = y;
      if (Math.abs(x) < 0.012 && z > eyeL[2] - 0.06 && y > eyeL[1] - 0.17 && y < chin) chin = y;
      if (Math.abs(x) > 0.083 && y > eyeL[1] - 0.05 && y < eyeL[1] + 0.03) { ez += z; en++; }
    }
  }
  return { eyeY: eyeL[1], eyeX: eyeL[0], eyeZ: eyeL[2], top, chin, earZ: ez / Math.max(1, en) };
}

/**
 * Подгонка и поза. Возвращает { Q, pf, J }.
 * opts.ankleDy — смещение цели лодыжки при подгонке (опускает стопу на землю), opts.skullK — сжатие свода черепа.
 */
export function poseMesh(P0, { pose = POSE, ankleDy = 0, skullK = 0, headDy = null, headDz = null } = {}) {
  const base = loadBase();
  const { obj, nV, skel, W } = base;
  const P = Float64Array.from(P0);
  const lm0 = headLandmarks(P);
  // сжатие свода: выше линии бровей расстояние до неё уменьшается
  if (skullK) {
    const brow = lm0.eyeY + 0.035;
    for (let i = 0; i < nV; i++) {
      const y = P[i * 3 + 1];
      if (y > brow) P[i * 3 + 1] = brow + (y - brow) * (1 - skullK * smooth(brow, brow + 0.07, y));
    }
  }
  const lm = headLandmarks(P);
  const J = (n) => jointPos(skel, n, P);
  const hip = J('upperleg01.L____head'), sh = J('upperarm01.L____head');
  const yHip = hip[1], ySh = sh[1];
  const torsoMap = (p) => {
    const y = p[1];
    let yy;
    if (y <= yHip) yy = y + (GAME.upperLeg[1] - yHip);
    else if (y >= ySh) yy = y + (GAME.upperArm[1] - ySh);
    else yy = GAME.upperLeg[1] + ((GAME.upperArm[1] - GAME.upperLeg[1]) * (y - yHip)) / (ySh - yHip);
    const t = Math.min(1, Math.max(0, (y - yHip) / (ySh - yHip)));
    return [p[0], yy, p[2] + (-hip[2]) * (1 - t) + (-sh[2]) * t];
  };
  const dy = headDy ?? FACE_TARGET.eyeY - lm.eyeY;
  const dz = headDz ?? FACE_TARGET.earZ - lm.earZ;
  const pf = new PoseFit(skel, J, { ankleDy });
  planPose(pf, { head: { dy, dz }, torsoMap, ankleDy }, pose);
  const Q = pf.lbs(P, W, nV);
  return { Q, pf, P, lm, J, head: { dy, dz } };
}

/** Автоподбор: опускаем стопы так, чтобы подошва лежала на y = 0. */
export function buildPosed(opts = {}) {
  const base = loadBase();
  const P0 = shapeMesh(opts.shape || {});
  let ankleDy = 0, res;
  for (let it = 0; it < 3; it++) {
    res = poseMesh(P0, { ...opts.pose, ankleDy, skullK: opts.skullK ?? 0 });
    let ymin = 1e9;
    for (const i of base.bodyVerts) ymin = Math.min(ymin, res.Q[i * 3 + 1]);
    if (Math.abs(ymin) < 5e-4) break;
    ankleDy -= ymin;
  }
  res.ankleDy = ankleDy;
  return { P0, ...res };
}
