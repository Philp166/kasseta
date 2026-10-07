// Аналитическая функция высот: холмы крупного масштаба, плоская поляна лагеря в центре,
// чаша из подъёмов по краям (с «окнами» к дальним горам) и скалистый холм-обзорник.
// Используется для рельефа 320×320 м, дальнего поля и расстановки объектов.

import { Noise2, sstep } from './noise';

export const TERRAIN_SIZE = 320;
export const TERRAIN_SEGMENTS = 320;
export const CAMP_RADIUS = 13;

export interface VistaSpec { x: number; z: number; height: number }

export function createHeightFn(seed: number) {
  const A = new Noise2(seed);
  const B = new Noise2(seed + 101);
  const C = new Noise2(seed + 202);
  const vista: VistaSpec = { x: -74, z: 56, height: 25 };
  // направление «окна» в рельефе (вид с холма смотрит через лагерь к дальним горам)
  const gapDir = Math.atan2(-vista.z, -vista.x);

  const fn = (x: number, z: number): number => {
    const r = Math.hypot(x, z);
    const wx = B.fbm(x * 0.012, z * 0.012, 2) * 22;
    const wz = B.fbm(x * 0.012 + 50, z * 0.012 - 20, 2) * 22;
    let hills = A.fbm((x + wx) * 0.0045, (z + wz) * 0.0045, 3, 2, 0.36) * 30;
    hills += A.fbm(x * 0.016 + 7, z * 0.016 - 3, 2, 2, 0.4) * 3.5;
    const fine = C.fbm(x * 0.07, z * 0.07, 2, 2, 0.4) * 0.28 + C.noise(x * 0.31, z * 0.31) * 0.05;
    const k = sstep(10, 46, r);
    // чаша по краям, неровная по азимуту
    const th = Math.atan2(z, x);
    let rimAmp = 22 + 26 * (0.5 + 0.5 * A.noise(Math.cos(th) * 1.5 + 10, Math.sin(th) * 1.5 + 4));
    let dth = th - gapDir;
    dth = Math.atan2(Math.sin(dth), Math.cos(dth));
    rimAmp *= 1 - 0.75 * Math.exp(-(dth * dth) / (2 * 0.38 * 0.38));
    const rim = Math.pow(sstep(80, 190, r), 1.5) * rimAmp;
    // дальние горы за пределами карты поднимаются сильнее
    const far = Math.pow(sstep(170, 900, r), 1.3) * (90 + 120 * (0.5 + 0.5 * A.noise(x * 0.0025 + 2, z * 0.0025 - 7)));
    // скалистый холм-обзорник
    const dx = x - vista.x + B.noise(x * 0.03, z * 0.03) * 6;
    const dz = z - vista.z + B.noise(x * 0.03 + 9, z * 0.03) * 6;
    const d2 = dx * dx + dz * dz;
    let bump = vista.height * Math.exp(-d2 / (2 * 21 * 21));
    bump += 4.0 * C.ridged(x * 0.045 + 1, z * 0.045 + 5, 3) * Math.exp(-d2 / (2 * 26 * 26));
    // скальные гребни на склонах
    const rg = Math.max(0, C.ridged(x * 0.014 + 3, z * 0.014 + 8, 3) - 0.62);
    const ridges = rg * 14 * sstep(32, 80, r) * (1 - sstep(180, 330, r));
    return hills * k + fine * (0.2 + 0.8 * k) + rim + far + bump * sstep(22, 44, r) + ridges;
  };
  return { fn, vista, gapDir };
}

export type HeightFn = (x: number, z: number) => number;
