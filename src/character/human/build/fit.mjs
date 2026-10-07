// Подгонка тела MakeHuman под скелет игры и «запекание» позы покоя.
// Идея: прямая кинематика по скелету MakeHuman (163 кости). Для каждой кости задаются целевые мировые позиции
// головы/хвоста (из таблицы суставов игры) — кость поворачивается и масштабируется вдоль оси ровно так, чтобы
// её концы легли на цели. Затем линейный скиннинг (LBS) с весами MakeHuman переносит вершины в новую позу.
// Кость описывается преобразованием p' = H + R · S(a, s) · (p − h): h/H — голова в исходной/целевой позе,
// a — единичная исходная ось кости, s — масштаб вдоль неё, R — чистый поворот (накапливается по иерархии).

import { v3, m3, Xf, deg } from './lin.mjs';

/** Таблица суставов игры (левая сторона; правая — зеркально по X). */
export const GAME = {
  hips: [0, 0.95, 0], spine: [0, 1.07, 0], chest: [0, 1.23, 0], neck: [0, 1.47, 0.005], head: [0, 1.58, 0],
  shoulder: [0.045, 1.43, 0], upperArm: [0.205, 1.425, 0], lowerArm: [0.225, 1.125, 0], hand: [0.235, 0.855, 0],
  upperLeg: [0.095, 0.93, 0], lowerLeg: [0.10, 0.50, 0], foot: [0.10, 0.095, 0], toe: [0.10, 0.045, 0.115],
};

class BoneXf {
  /** @param {number[]} h исходная голова, H целевая голова, a ось (ед.), s масштаб, R поворот (m3) */
  constructor(h, H, R, a = [0, 1, 0], s = 1) { this.h = h; this.H = H; this.R = R; this.a = a; this.s = s; this.M = null; }
  linear() {
    if (!this.M) this.M = m3.mul(this.R, m3.axialScale(this.a, this.s));
    return this.M;
  }
  apply(p) {
    const q = m3.vec(this.linear(), v3.sub(p, this.h));
    return [q[0] + this.H[0], q[1] + this.H[1], q[2] + this.H[2]];
  }
  /** Xf (p' = M p + t) для LBS. */
  xf() { const M = this.linear(); return Xf.about(M, this.h, this.H); }
}

export class PoseFit {
  /**
   * @param skel скелет MakeHuman (JSON), J(jointName) → позиция
   * @param J функция положения сустава (метры, исходная поза после модификаторов)
   * @param opts параметры позы
   */
  constructor(skel, J, opts = {}) {
    this.skel = skel; this.J = J; this.opts = opts;
    this.bones = skel.bones;
    this.xf = {};          // имя кости → BoneXf
    this.src = {};         // имя кости → {h, t}
    for (const [n, b] of Object.entries(this.bones)) this.src[n] = { h: J(b.head), t: J(b.tail) };
    this.order = this.topo();
    this.report = [];
  }

  topo() {
    const order = [], seen = new Set();
    const visit = (n) => {
      if (seen.has(n)) return;
      const p = this.bones[n].parent;
      if (p) visit(p);
      seen.add(n); order.push(n);
    };
    Object.keys(this.bones).forEach(visit);
    return order;
  }

  parentXf(n) { const p = this.bones[n].parent; return p ? this.xf[p] : null; }

  /** Образ исходной точки p в целевой позе по уже вычисленной кости. */
  mapVia(n, p) { return this.xf[n].apply(p); }

  /** Кость наследует преобразование родителя целиком (лицо, пальцы ног и т. п.). */
  inherit(n) { const px = this.parentXf(n); this.xf[n] = px ?? new BoneXf(this.src[n].h, this.src[n].h, m3.I()); }

  /** Только локальный поворот вокруг головы кости (в целевых координатах), без масштаба. rot — матрица 3x3. */
  localRotate(n, rot) {
    const px = this.parentXf(n);
    const h = this.src[n].h;
    const H = px.apply(h);
    const R = m3.mul(rot, px.R);
    this.xf[n] = new BoneXf(h, H, R, [0, 1, 0], 1);
  }

  /**
   * Подгонка по целевым концам: голова — в целевую точку H (или образ через родителя), хвост — в T.
   * roll — дополнительный поворот вокруг новой оси (скручивание), twist-база уже учтена в R родителя.
   */
  fit(n, { head, tail, roll = 0, scaleAxis = true }) {
    const px = this.parentXf(n);
    const s = this.src[n];
    const h = s.h;
    const H = head ?? (px ? px.apply(h) : h);
    const a = v3.norm(v3.sub(s.t, h));
    const len = v3.len(v3.sub(s.t, h));
    const Rp = px ? px.R : m3.I();
    const dNow = m3.vec(Rp, a);                     // направление оси после поворота родителя
    const dT = v3.sub(tail, H);
    const lenT = v3.len(dT);
    let R = m3.mul(m3.between(dNow, dT), Rp);
    if (roll) R = m3.mul(m3.axisAngle(dT, roll), R);
    const sc = scaleAxis ? lenT / len : 1;
    this.xf[n] = new BoneXf(h, H, R, a, sc);
    this.report.push({ bone: n, scale: sc, len, lenT });
    return this.xf[n];
  }

  /** Целиком заданный поворот (по реперу) + целевая голова. */
  frame(n, { head, R }) {
    const s = this.src[n];
    const px = this.parentXf(n);
    const H = head ?? (px ? px.apply(s.h) : s.h);
    this.xf[n] = new BoneXf(s.h, H, R, [0, 1, 0], 1);
    return this.xf[n];
  }

  lbs(P, W, nV) {
    // W: Map вершина → [[boneName, w], ...] (нормализованные)
    const out = new Float64Array(P.length);
    const M = {};
    for (const n of Object.keys(this.xf)) { const x = this.xf[n]; M[n] = x.xf(); }
    for (let i = 0; i < nV; i++) {
      const p = [P[i * 3], P[i * 3 + 1], P[i * 3 + 2]];
      const ws = W[i];
      let ox = 0, oy = 0, oz = 0;
      for (const [b, w] of ws) {
        const q = M[b].apply(p);
        ox += q[0] * w; oy += q[1] * w; oz += q[2] * w;
      }
      out[i * 3] = ox; out[i * 3 + 1] = oy; out[i * 3 + 2] = oz;
    }
    return out;
  }
}

/** Нормализованные веса MakeHuman на вершину: массив [[bone, w], ...] по вершинам. */
export function weightsPerVertex(weights, nV) {
  const per = Array.from({ length: nV }, () => []);
  for (const [bone, arr] of Object.entries(weights)) for (const [vi, w] of arr) per[vi].push([bone, w]);
  for (const list of per) {
    let sum = 0; for (const [, w] of list) sum += w;
    if (sum > 0) for (const e of list) e[1] /= sum;
    else list.push(['root', 1]);
  }
  return per;
}

export const _deg = deg;
