// Лезвия и наконечники: контур (полуширина по длине) × сечение с фасками, рёбрами жёсткости, долами.
// buildBlade протягивает «куски» сечения вдоль клинка: между кусками нормали расщепляются (острые грани), поэтому
// фаски заточки, рёбра и дол читаются в освещении. Режущие фаски уходят в отдельный построитель (полированный металл).

import * as THREE from 'three';
import { GeoBuilder, SweepStation, sweepPatches } from './geom';

export type Pt = [number, number];

/** Срезание углов (Чайкин): сглаживает ломаную, оставляя острыми точки из sharp (индексы) и концы. */
export function chaikin(pts: Pt[], iter: number, sharp: Set<number> = new Set()): Pt[] {
  let P: Array<{ p: Pt; s: boolean }> = pts.map((p, i) => ({ p, s: i === 0 || i === pts.length - 1 || sharp.has(i) }));
  const lerp2 = (a: Pt, b: Pt, t: number): Pt => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
  for (let k = 0; k < iter; k++) {
    const out: Array<{ p: Pt; s: boolean }> = [];
    for (let i = 0; i < P.length - 1; i++) {
      const a = P[i], b = P[i + 1];
      out.push(a.s ? a : { p: lerp2(a.p, b.p, 0.25), s: false });
      out.push(b.s ? b : { p: lerp2(a.p, b.p, 0.75), s: false });
    }
    P = out.filter((o, i) => i === 0 || Math.hypot(o.p[0] - out[i - 1].p[0], o.p[1] - out[i - 1].p[1]) > 1e-9);
  }
  return P.map((o) => o.p);
}

/** Значение полуширины на координате t (линейная интерполяция по плотной ломаной, t по возрастанию). */
export function sampleOutline(poly: Pt[], t: number): number {
  if (t <= poly[0][0]) return poly[0][1];
  for (let i = 0; i < poly.length - 1; i++) {
    const a = poly[i], b = poly[i + 1];
    if (t <= b[0]) {
      const d = b[0] - a[0];
      return d < 1e-12 ? b[1] : a[1] + ((b[1] - a[1]) * (t - a[0])) / d;
    }
  }
  return poly[poly.length - 1][1];
}

export interface BladeLoop {
  pts: Pt[];
  /** Режущая фаска — в «кромочный» построитель (светлый полированный металл). */
  edge?: boolean;
}

export interface BladeSpec {
  /** Длина клинка (м) вдоль +Y от основания (t=0) до кончика (t=length). */
  length: number;
  /** Контур: [t в метрах от основания, полуширина (м)] по возрастанию t. Уже сглаженный (chaikin). */
  outline: Pt[];
  /** Полутолщина в метрах (на гребне/спинке) как функция t∈[0,1]. */
  thick: (t: number) => number;
  /** Замкнутый обход сечения: верхняя грань слева направо, затем торец/нижняя грань справа налево. */
  loop: BladeLoop[];
  /** Сдвиг оси по X (м) — для одностороннего клинка. */
  center?: (t: number) => number;
  /** Изгиб клинка по Z (м) в зависимости от t∈[0,1]. */
  bend?: (t: number) => number;
  stations?: number;
  /** Положение основания по Y. */
  y0?: number;
  tile?: number;
  /** Цвет кромки (множитель). */
  edgeTint?: number;
  /** Дополнительные множители цвета по длине (затемнение у основания и т.п.). */
  tintAlong?: (t: number) => number;
}

/** Зеркальное сечение: верхние куски + нижние (отражение по Z, обратный порядок). */
export function symmetricLoop(top: BladeLoop[], between: BladeLoop[] = []): BladeLoop[] {
  const bottom = top
    .slice()
    .reverse()
    .map((l) => ({ pts: l.pts.slice().reverse().map(([x, z]) => [x, -z] as Pt), edge: l.edge }));
  return [...top, ...between, ...bottom];
}

export function buildBlade(spec: BladeSpec, flats: GeoBuilder, edges: GeoBuilder): void {
  const n = spec.stations ?? 44;
  const y0 = spec.y0 ?? 0;
  const st: SweepStation[] = [];
  const L = spec.length;
  for (let i = 0; i < n; i++) {
    const t = i / (n - 1);
    const hw = Math.max(1e-5, sampleOutline(spec.outline, t * L));
    const cx = spec.center ? spec.center(t) : 0;
    const bz = spec.bend ? spec.bend(t) : 0;
    const e = 1e-3;
    const bz2 = spec.bend ? spec.bend(Math.min(1, t + e)) : 0;
    const bz1 = spec.bend ? spec.bend(Math.max(0, t - e)) : 0;
    const slope = (bz2 - bz1) / ((Math.min(1, t + e) - Math.max(0, t - e)) * L);
    const phi = Math.atan(slope);
    const ez = new THREE.Vector3(0, -Math.sin(phi), Math.cos(phi));
    const k = spec.tintAlong ? spec.tintAlong(t) : undefined;
    st.push({
      c: new THREE.Vector3(cx, y0 + t * L, bz),
      ex: new THREE.Vector3(1, 0, 0),
      ez,
      hw,
      hz: Math.max(1e-5, spec.thick(t)),
      k,
    });
  }
  const patches = spec.loop.map((l) => l.pts);
  const et = spec.edgeTint ?? 1.0;
  // отдельные проходы: кромка и плоскости — чтобы тонкий ряд вершин принадлежал нужному материалу
  sweepPatches(st, patches, {
    tile: spec.tile ?? 0.25,
    flip: true,
    colorOf: (pi, _k, i) => {
      const base = st[i].k ?? 1;
      return spec.loop[pi].edge ? [base * et, base * et, base * et * 1.02] : [base, base, base];
    },
  }, (pi) => (spec.loop[pi].edge ? edges : flats));
}
