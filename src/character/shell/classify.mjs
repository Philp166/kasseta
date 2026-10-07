// Классификация вершин внешней модели-оболочки (TRELLIS): что оставить, что вырезать (заменяется моими деталями).
// Координаты — исходные единицы модели: y ∈ [-0.5, 0.5] (сапоги → уши капюшона), +Z — вперёд, +X — левая сторона героя.
// Общий модуль: используется и браузером (отладочная страница), и Node-скриптом сборки.

export const CLASS = { KEEP: 0, SPEAR: 1, QUIVER: 2, FACE: 3, HAND: 4, ARM: 5, SCABBARD: 6 };
export const CLASS_COLORS = [[0.5, 0.5, 0.5], [1, 0.1, 0.1], [0.1, 1, 0.1], [1, 0.9, 0.1], [1, 0.4, 0.9], [0.1, 0.5, 1], [0.1, 1, 1]];

export const VOL = {
  // копьё: ось от пятки до острия; радиус древка и «головной» зоны (наконечник, перья, обмотки)
  spear: { b: [-0.045, -0.5, 0.075], t: [-0.205, 0.335, 0.19], rShaft: 0.012, rLow: 0.007, lowTo: 0.22, rHead: 0.06, headFrom: 0.66 },
  // колчан/лук за спиной (диагональ слева-сверху вниз)
  quiver: { b: [0.075, -0.115, -0.185], t: [0.235, 0.455, -0.14], rBody: 0.034, rTop: 0.075, topFrom: 0.78 },
  // руки: плечо → локоть → запястье → кисть; радиусы
  armR: { pts: [[-0.185, 0.17, 0.0], [-0.205, 0.065, 0.0], [-0.17, 0.0, 0.17]], r: [0.06, 0.055, 0.055], minAbsX: 0.14 },
  armL: { pts: [[0.185, 0.17, -0.02], [0.21, 0.05, -0.07], [0.2, -0.04, 0.0], [0.19, -0.085, 0.035]], r: [0.06, 0.055, 0.055, 0.05], minAbsX: 0.14 },
  // ножны на левом бедре (выступают за контур кафтана)
  scabbard: { b: [0.13, 0.07, 0.04], t: [0.2, -0.17, 0.02], r: 0.045, minAbsX: 0.115 },
  // лицо и шея в «окне» капюшона (на их месте — моя голова): боксы без цветового отбора
  faces: [
    { min: [-0.05, 0.318, 0.03], max: [0.05, 0.378, 0.14] },
    { min: [-0.04, 0.255, -0.02], max: [0.04, 0.318, 0.11] },
  ],
};

const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

/** Расстояние до отрезка и параметр t вдоль него. */
export function segParam(p, a, b) {
  const ab = sub(b, a), ap = sub(p, a);
  const l2 = dot(ab, ab);
  const t = l2 > 0 ? Math.max(0, Math.min(1, dot(ap, ab) / l2)) : 0;
  const c = [a[0] + ab[0] * t, a[1] + ab[1] * t, a[2] + ab[2] * t];
  return { d: Math.hypot(p[0] - c[0], p[1] - c[1], p[2] - c[2]), t };
}

export function isSkin(r, g, b) {
  // r,g,b в 0..1: тёплые «кожные» тона (красноватые), заметно светлее/краснее меха и кожи одежды
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
  if (mx < 0.22) return false;
  const sat = mx > 0 ? (mx - mn) / mx : 0;
  return r >= g && g >= b * 0.98 && sat > 0.26 && (r - b) > 0.12 && r / Math.max(g, 0.01) > 1.12;
}

/** classes: Uint8Array(n). pos в единицах модели, col — Float32Array(3n) в 0..1 (sRGB). */
export function classify(pos, col, vol = VOL) {
  const n = pos.length / 3;
  const out = new Uint8Array(n);
  const p = [0, 0, 0];
  for (let i = 0; i < n; i++) {
    p[0] = pos[i * 3]; p[1] = pos[i * 3 + 1]; p[2] = pos[i * 3 + 2];
    let c = CLASS.KEEP;
    // копьё
    {
      const s = segParam(p, vol.spear.b, vol.spear.t);
      const r = s.t > vol.spear.headFrom ? vol.spear.rHead : s.t < vol.spear.lowTo ? vol.spear.rLow : vol.spear.rShaft;
      if (s.d < r) c = CLASS.SPEAR;
    }
    // колчан
    if (c === CLASS.KEEP) {
      const s = segParam(p, vol.quiver.b, vol.quiver.t);
      const r = s.t > vol.quiver.topFrom ? vol.quiver.rTop : vol.quiver.rBody;
      if (s.d < r) c = CLASS.QUIVER;
    }
    // ножны
    if (c === CLASS.KEEP) {
      const s = segParam(p, vol.scabbard.b, vol.scabbard.t);
      if (s.d < vol.scabbard.r && p[0] > vol.scabbard.minAbsX) c = CLASS.SCABBARD;
    }
    // руки
    if (c === CLASS.KEEP) {
      for (const arm of [vol.armR, vol.armL]) {
        if (Math.abs(p[0]) < arm.minAbsX || Math.sign(p[0]) !== Math.sign(arm.pts[0][0])) continue;
        for (let k = 0; k + 1 < arm.pts.length; k++) {
          const s = segParam(p, arm.pts[k], arm.pts[k + 1]);
          const r = arm.r[k] + (arm.r[k + 1] - arm.r[k]) * s.t;
          if (s.d < r) { c = isSkin(col[i * 3], col[i * 3 + 1], col[i * 3 + 2]) && k === arm.pts.length - 2 ? CLASS.HAND : CLASS.ARM; break; }
        }
        if (c !== CLASS.KEEP) break;
      }
    }
    // лицо
    if (c === CLASS.KEEP) {
      for (const f of vol.faces) {
        if (p[0] > f.min[0] && p[0] < f.max[0] && p[1] > f.min[1] && p[1] < f.max[1] && p[2] > f.min[2] && p[2] < f.max[2]) { c = CLASS.FACE; break; }
      }
    }
    out[i] = c;
  }
  return out;
}
