// Чтение данных MakeHuman (CC0): базовый меш, таргеты, скелет, веса, mhclo-прокси.
// Формулы весов макро-модификаторов изучены по документации MakeHuman; код написан с нуля.

import fs from 'node:fs';
import path from 'node:path';

export const MH_ROOT = process.env.MH_ROOT || '/home/user/makehumancommunity/makehuman/makehuman';
export const MH_DATA = path.join(MH_ROOT, 'data');

/** Wavefront OBJ: позиции, UV и грани (v/vt) с именем группы. */
export function parseObj(text) {
  const v = [], vt = [], faces = [];
  let g = '';
  for (const line of text.split('\n')) {
    if (line.startsWith('v ')) {
      const p = line.trim().split(/\s+/);
      v.push(+p[1], +p[2], +p[3]);
    } else if (line.startsWith('vt ')) {
      const p = line.trim().split(/\s+/);
      vt.push(+p[1], +p[2]);
    } else if (line.startsWith('g ') || line.startsWith('o ')) {
      g = line.slice(2).trim();
    } else if (line.startsWith('f ')) {
      const p = line.trim().split(/\s+/).slice(1).map((s) => s.split('/'));
      faces.push({ g, v: p.map((q) => parseInt(q[0]) - 1), t: p.map((q) => (q[1] ? parseInt(q[1]) - 1 : -1)) });
    }
  }
  return { v: new Float64Array(v), vt: new Float64Array(vt), faces };
}

/** .target: строки «индекс dx dy dz». */
const targetCache = new Map();
export function loadTarget(rel) {
  if (targetCache.has(rel)) return targetCache.get(rel);
  const file = path.join(MH_DATA, 'targets', rel);
  const idx = [], d = [];
  for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
    if (!line || line[0] === '#') continue;
    const p = line.trim().split(/\s+/);
    if (p.length < 4) continue;
    idx.push(parseInt(p[0]));
    d.push(+p[1], +p[2], +p[3]);
  }
  const t = { idx: Int32Array.from(idx), d: Float64Array.from(d) };
  targetCache.set(rel, t);
  return t;
}

/** Добавить таргет с весом к массиву смещений (Float64Array 3*n). */
export function addTarget(disp, rel, w) {
  if (!w) return;
  const t = loadTarget(rel);
  for (let k = 0; k < t.idx.length; k++) {
    const i = t.idx[k] * 3;
    disp[i] += t.d[k * 3] * w;
    disp[i + 1] += t.d[k * 3 + 1] * w;
    disp[i + 2] += t.d[k * 3 + 2] * w;
  }
}

/** Значения макро-переменных по формулам MakeHuman (возраст: 0→1 год, 0.5→25, 1→90). */
export function macroVals({ gender = 1, age = 0.5, muscle = 0.5, weight = 0.5, height = 0.5, proportions = 0.5, caucasian = 0, african = 0, asian = 1 }) {
  const r = {};
  r.maleVal = gender; r.femaleVal = 1 - gender;
  if (age < 0.5) {
    r.oldVal = 0;
    r.babyVal = Math.max(0, 1 - age * 5.333);
    r.youngVal = Math.max(0, (age - 0.1875) * 3.2);
    r.childVal = Math.max(0, Math.min(1, 5.333 * age) - r.youngVal);
  } else {
    r.childVal = 0; r.babyVal = 0;
    r.oldVal = Math.max(0, age * 2 - 1);
    r.youngVal = 1 - r.oldVal;
  }
  r.maxweightVal = Math.max(0, weight * 2 - 1);
  r.minweightVal = Math.max(0, 1 - weight * 2);
  r.averageweightVal = 1 - (r.maxweightVal + r.minweightVal);
  r.maxmuscleVal = Math.max(0, muscle * 2 - 1);
  r.minmuscleVal = Math.max(0, 1 - muscle * 2);
  r.averagemuscleVal = 1 - (r.maxmuscleVal + r.minmuscleVal);
  r.maxheightVal = Math.max(0, height * 2 - 1);
  r.minheightVal = Math.max(0, 1 - height * 2);
  r.averageheightVal = 1 - (r.maxheightVal > r.minheightVal ? r.maxheightVal : r.minheightVal);
  r.idealproportionsVal = Math.max(0, proportions * 2 - 1);
  r.uncommonproportionsVal = Math.max(0, 1 - proportions * 2);
  r.regularproportionsVal = 1 - (r.idealproportionsVal > r.uncommonproportionsVal ? r.idealproportionsVal : r.uncommonproportionsVal);
  r.caucasianVal = caucasian; r.africanVal = african; r.asianVal = asian;
  return r;
}

export const ageToValue = (years) => (years < 25 ? (years - 1) / 48 : 0.5 + (years - 25) / 130);

/** Применить макро-таргеты (раса/пол/возраст/мышцы/вес/рост/пропорции) к массиву смещений. */
export function applyMacros(disp, p) {
  const V = macroVals(p);
  const dir = path.join(MH_DATA, 'targets', 'macrodetails');
  const sets = [['', 'macrodetails'], ['height', 'macrodetails/height'], ['proportions', 'macrodetails/proportions']];
  let used = 0;
  for (const [, sub] of sets) {
    const folder = path.join(MH_DATA, 'targets', sub);
    if (!fs.existsSync(folder)) continue;
    for (const f of fs.readdirSync(folder)) {
      if (!f.endsWith('.target')) continue;
      const vars = f.replace('.target', '').split('-');
      let w = 1;
      for (const t of vars) {
        const key = t + 'Val';
        if (t === 'universal') continue;
        if (!(key in V)) { w = 0; break; }
        w *= V[key];
      }
      if (w > 1e-6) { addTarget(disp, `${sub}/${f}`, w); used++; }
    }
  }
  return used;
}

/**
 * Детальные модификаторы: spec = { 'head/head-age': 0.3, 'nose/nose-width1': -0.5 ... }.
 * Знак: отрицательное значение берёт левый таргет (decr/in/down/...), положительное — правый.
 * Для одиночных (head-oval) значение ≥ 0.
 */
const PAIRS = {
  decr: 'incr', in: 'out', down: 'up', backward: 'forward', concave: 'convex', compress: 'uncompress',
  pointed: 'triangle', square: 'round', incr: null,
};
export function applyDetail(disp, spec) {
  for (const [key, val] of Object.entries(spec)) {
    // key: 'group/name-ext' где ext — «левая|правая» часть через «|»
    const group = key.split('/')[0];
    const rest = key.slice(group.length + 1);
    if (rest.includes('|')) {
      const [base, lo, hi] = rest.split('|');
      const name = val < 0 ? `${base}-${lo}` : `${base}-${hi}`;
      addTarget(disp, `${group}/${name}.target`, Math.abs(val));
    } else {
      addTarget(disp, `${group}/${rest}.target`, Math.abs(val));
    }
  }
}

/** Скелет по умолчанию: кости и joint-вершины. */
export function loadSkeleton() {
  const d = JSON.parse(fs.readFileSync(path.join(MH_DATA, 'rigs', 'default.mhskel'), 'utf8'));
  return d;
}

/** Веса: { bone: [[vertex, weight], ...] }. */
export function loadWeights() {
  return JSON.parse(fs.readFileSync(path.join(MH_DATA, 'rigs', 'default_weights.mhw'), 'utf8')).weights;
}

/** Положение joint-а = среднее по его вершинам. */
export function jointPos(skel, name, P) {
  const ids = skel.joints[name];
  const c = [0, 0, 0];
  for (const i of ids) { c[0] += P[i * 3]; c[1] += P[i * 3 + 1]; c[2] += P[i * 3 + 2]; }
  return c.map((x) => x / ids.length);
}

/** .mhclo: привязка прокси-меша к базовому (барицентры + смещения). */
export function parseMhclo(text) {
  const lines = text.split('\n');
  const out = { scale: {}, verts: [], meta: {} };
  let inVerts = false;
  for (const line of lines) {
    if (!line.trim() || line[0] === '#') continue;
    const p = line.trim().split(/\s+/);
    if (p[0] === 'verts') { inVerts = true; continue; }
    if (inVerts) {
      if (p.length === 1) {
        // вершина, совпадающая с одной базовой
        out.verts.push({ idx: [parseInt(p[0])], w: [1], off: [0, 0, 0] });
      } else if (p.length >= 9) {
        out.verts.push({ idx: [+p[0], +p[1], +p[2]], w: [+p[3], +p[4], +p[5]], off: [+p[6], +p[7], +p[8]] });
      }
    } else if (/^[xyz]_scale$/.test(p[0])) {
      out.scale[p[0][0]] = { a: parseInt(p[1]), b: parseInt(p[2]), s: +p[3] };
    } else out.meta[p[0]] = p.slice(1).join(' ');
  }
  return out;
}
