// Охотничий нож в ножнах: рукоять из рога с бронзовой крестовиной и набалдашником, обмотка жилой, ножны из тёмной
// кожи с тиснёным узором, бронзовые устье и наконечник, кожаная петля для пояса.
// Система координат: начало — устье ножен (по центру), рукоять вверх (+Y, до 0.16), ножны вниз (до −0.245).
// Лицевая сторона (узор) смотрит в −Z; петля для пояса — на +Z. Ножны и рукоять симметричны по X.
// userData.sockets: throat, pommel, tip, belt.

import * as THREE from 'three';
import { GeoBuilder, V, V3, tube, loftY, strap } from './geom';
import { newGear, addSocket, finishGear, addMesh, thong, bead } from './common';
import { boneMat, brassMat, leatherMat, leatherPBR, LEATHERS, matFromMaps, wrapMat, cordMat } from './materials';
import { drawOrnamentRect } from './ornament';

export const KNIFE = { sheath: 0.245, handle: 0.16 };

const SHEATH_K: Array<[number, number]> = [[0.0, 1.0], [-0.05, 0.96], [-0.12, 0.8], [-0.18, 0.62], [-0.215, 0.42], [-0.235, 0.18], [-0.245, 0.02]];
const RX = 0.0235, RZ = 0.0115;
function sheathK(y: number): number {
  for (let i = 0; i < SHEATH_K.length - 1; i++) {
    const [ya, ka] = SHEATH_K[i], [yb, kb] = SHEATH_K[i + 1];
    if (y <= ya && y >= yb) { const t = (y - ya) / (yb - ya); return ka + (kb - ka) * t; }
  }
  return SHEATH_K[SHEATH_K.length - 1][1];
}

let _mat: THREE.MeshStandardMaterial | null = null;
/** Тёмная кожа с тиснёной «лентой» вдоль ножен (лицевая сторона — середина текстуры по u). */
export function sheathMat(): THREE.MeshStandardMaterial {
  if (_mat) return _mat;
  const S = 1024;
  const t = leatherPBR({ ...LEATHERS.dark, size: S, seed: 33, grain: 140, stain: 0.55 });
  // лицевая половина занимает u ∈ [0.25, 0.75]; по длине v ∈ [0.1, 0.9]. Орнамент рисуем повёрнутой лентой.
  const x0 = S * 0.3, w = S * 0.4, y0 = S * 0.08, h = S * 0.86;
  t.decal((g) => {
    g.save();
    g.translate(x0, y0 + h);
    g.rotate(-Math.PI / 2);
    drawOrnamentRect(g, 0, 0, h, w, 'mixed', { relief: 'carved', accent: 0x9a7448, dark: 0x120a06, repeat: 4, weight: 1.0, borders: true, seed: 6 });
    g.restore();
  }, { dh: -0.3, rough: 0.7 });
  t.blurHeight(1);
  t.cavity(0.6, 2, 0.3);
  _mat = matFromMaps(t.textures({ normalStrength: 4 }), { normalScale: 1 });
  _mat.name = 'sheath';
  return _mat;
}

export function buildKnife(): THREE.Group {
  const g = newGear('Knife');

  // ---------- Ножны ----------
  const sh = new GeoBuilder();
  loftY({
    rings: SHEATH_K.map(([y, k]) => ({ y, rx: RX * k, rz: RZ * k })),
    cols: 24, uv: (_i, j, _th, y) => [j / 24, -y / KNIFE.sheath],
  }, sh);
  addMesh(g, sh, sheathMat(), 'sheath');

  // устье и наконечник — бронза
  const metal = new GeoBuilder();
  const ring = (y: number, k: number, grow: number) => ({ y, rx: RX * k + grow, rz: RZ * k + grow });
  loftY({ rings: [ring(0.006, 1.0, 0.0012), ring(0.002, 1.0, 0.0034), ring(-0.012, 1.0, 0.0036), ring(-0.03, 0.97, 0.0034), ring(-0.038, 0.96, 0.0012)], cols: 24, tile: 0.1 }, metal);
  // валик посередине устья
  loftY({ rings: [ring(-0.017, 0.99, 0.0036), ring(-0.019, 0.99, 0.0052), ring(-0.023, 0.99, 0.0052), ring(-0.025, 0.99, 0.0034)], cols: 24, tile: 0.1 }, metal);
  const kc = (y: number) => sheathK(y);
  loftY({ rings: [ring(-0.19, kc(-0.19), 0.0014), ring(-0.196, kc(-0.196), 0.0034), ring(-0.226, kc(-0.226), 0.0032), ring(-0.242, 0.1, 0.0024), ring(-0.249, 0.01, 0.0008)], cols: 20, tile: 0.1 }, metal);
  addMesh(g, metal, brassMat('bronze'), 'fittings');

  // заклёпки на устье
  const rivets = new GeoBuilder();
  for (const x of [-0.019, 0.019]) {
    loftY({ rings: [[-0.0125, 0.0016], [-0.0105, 0.0026], [-0.0095, 0.0006]].map(([y, r]) => ({ y, rx: r, rz: r, cx: x, cz: -(RZ + 0.0046) })), cols: 8, tile: 0.1 }, rivets);
  }
  addMesh(g, rivets, brassMat('brass'), 'rivets');

  // петля для пояса: плоская лента с тыльной стороны
  const frog = new GeoBuilder();
  const frogCurve = new THREE.CatmullRomCurve3([V(0, -0.06, RZ * 0.9), V(0, -0.02, RZ + 0.004), V(0, 0.03, RZ + 0.011), V(0, 0.072, RZ + 0.0125)]);
  strap(frogCurve, { width: 0.03, thick: 0.0042, up: V(0, 0, 1), tile: 0.2, segs: 18 }, frog);
  addMesh(g, frog, leatherMat('tan'), 'beltLoop');

  // ---------- Рукоять ----------
  const hnd = new GeoBuilder();
  const prof: Array<[number, number]> = [
    [0.005, 0.0108], [0.022, 0.0116], [0.05, 0.0132], [0.085, 0.0142], [0.112, 0.0132], [0.128, 0.0118],
    [0.134, 0.0152], [0.144, 0.0168], [0.152, 0.0152], [0.157, 0.0092], [0.1595, 0.0030],
  ];
  loftY({ rings: prof.map(([y, r]) => ({ y, rx: r * 1.0, rz: r * 0.86 })), cols: 14, tile: 0.1 }, hnd);
  addMesh(g, hnd, boneMat('antler'), 'handle');
  // обмотка жилой
  const wr = new GeoBuilder();
  tube(new THREE.LineCurve3(V(0, 0.032, 0), V(0, 0.092, 0)), { radius: (t) => 0.0148 + 0.0004 * Math.sin(t * Math.PI), squash: 0.88, sides: 14, segs: 12, tile: 0.1, caps: 'none' }, wr);
  addMesh(g, wr, wrapMat('tan'), 'handleWrap');
  // крестовина (овальная) и колпачок набалдашника
  const guard = new GeoBuilder();
  loftY({ rings: [[0.0, 0.0165, 0.0098], [0.003, 0.0192, 0.0108], [0.010, 0.0184, 0.0104], [0.015, 0.0128, 0.0096]].map(([y, rx, rz]) => ({ y, rx, rz })), cols: 18, tile: 0.1 }, guard);
  loftY({ rings: [[0.1445, 0.0142, 0.0142], [0.1485, 0.0172, 0.0172], [0.153, 0.0155, 0.0155], [0.1565, 0.0098, 0.0098]].map(([y, rx, rz]) => ({ y, rx: rx * 0.96, rz: rz * 0.96 })), cols: 14, tile: 0.1 }, guard);
  addMesh(g, guard, brassMat('bronze'), 'guard');
  // ремешок на набалдашнике с костяной бусиной
  const lan = new GeoBuilder();
  const lb = new GeoBuilder();
  const lpts = [V(0.0, 0.1585, 0.0), V(0.0, 0.1645, 0.0), V(0.011, 0.166, 0.004), V(0.02, 0.152, 0.006), V(0.022, 0.13, 0.006), V(0.02, 0.112, 0.0045)];
  thong(lan, lpts, 0.0019, { taper: 0.3 });
  bead(lb, V(0.0215, 0.12, 0.006), 0.0052, 1.15);
  addMesh(g, lan, cordMat('leather'), 'lanyard');
  addMesh(g, lb, boneMat('ivory'), 'lanyardBead');

  addSocket(g, 'throat', 0, 0, 0);
  addSocket(g, 'pommel', 0, KNIFE.handle, 0);
  addSocket(g, 'tip', 0, -KNIFE.sheath, 0);
  addSocket(g, 'belt', 0, 0.06, RZ + 0.012);
  return finishGear(g, { length: KNIFE.sheath + KNIFE.handle, axis: 'Y', origin: 'throat' });
}

export type { V3 };
