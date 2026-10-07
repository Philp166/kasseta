// Лук охотника: составной, с рефлексными концами; янтарное дерево, обмотка хвата сыромятью, костяные наконечники с
// проточками под тетиву, жильная тетива. Тетива — отдельные тонкие цилиндры: userData.updateString(nock) тянет её
// к руке, а при натяжении показывает наложенную стрелу.
// Система координат: начало — центр хвата; +Y вдоль плеч; брюшко лука и тетива со стороны −Z (к стрелку).
// userData.sockets: grip, nock (середина тетивы в покое, 0,0,-0.17), tipTop, tipBot, rest (полочка).

import * as THREE from 'three';
import { GeoBuilder, V, V3, tube } from './geom';
import { newGear, addSocket, finishGear, addMesh, sstep } from './common';
import { woodMat, wrapMat, cordMat, boneMat, leatherMat } from './materials';
import { buildArrow } from './arrow';

export const BOW = { half: 0.71, brace: 0.17, stringR: 0.0013 };

/** Ось дуги: прогиб к стрелку (−Z) и загнутые вперёд концы. */
export function staveZ(y: number): number {
  const a = Math.min(1, Math.abs(y) / BOW.half);
  return -0.21 * Math.pow(a, 1.8) + 0.04 * Math.pow(sstep(0.775, 1, a), 1.5);
}
const widthAt = (a: number) => 0.014 + 0.022 * (1 - Math.pow(a, 1.4));
const thickAt = (a: number) => 0.010 + 0.016 * (1 - Math.pow(a, 1.2));

function staveCurve(y0: number, y1: number, n = 30): THREE.CatmullRomCurve3 {
  const pts: V3[] = [];
  for (let i = 0; i <= n; i++) { const y = y0 + ((y1 - y0) * i) / n; pts.push(V(0, y, staveZ(y))); }
  return new THREE.CatmullRomCurve3(pts, false, 'centripetal');
}

const UP = V(0, 1, 0);
const _d = V(), _q = new THREE.Quaternion();
function place(mesh: THREE.Object3D, from: V3, to: V3, r: number): void {
  _d.subVectors(to, from);
  const len = Math.max(1e-5, _d.length());
  mesh.position.copy(from);
  mesh.quaternion.copy(_q.setFromUnitVectors(UP, _d.multiplyScalar(1 / len)));
  mesh.scale.set(r, len, r);
}

export function buildBow(): THREE.Group {
  const g = newGear('Bow');
  const H = BOW.half;

  // ---------- Дуга ----------
  const stave = new GeoBuilder();
  const full = staveCurve(-H + 0.045, H - 0.045, 36);
  const L = 2 * (H - 0.045);
  tube(full, {
    radius: (t) => widthAt(Math.abs(2 * t - 1) * (1 - 0.045 / H) + 0.045 / H * 0) / 2,
    squash: (t) => thickAt(Math.abs(2 * t - 1)) / widthAt(Math.abs(2 * t - 1)),
    sides: 12, segs: 56, tile: 0.5, vOffset: 0.1, up: V(1, 0, 0), caps: 'none',
  }, stave);
  addMesh(g, stave, woodMat('bow'), 'stave');
  void L;

  // ---------- Хват: обмотка, перетяжки ----------
  const wrap = new GeoBuilder();
  tube(staveCurve(-0.078, 0.078, 8), {
    radius: (t) => 0.0206 * (0.9 + 0.1 * Math.min(sstep(0, 0.12, t), 1 - sstep(0.88, 1, t))), squash: 0.78, sides: 16, segs: 20, tile: 0.12, up: V(1, 0, 0),
  }, wrap);
  addMesh(g, wrap, wrapMat('tan'), 'gripWrap');
  const lash = new GeoBuilder();
  for (const y0 of [-0.095, 0.079]) {
    tube(staveCurve(y0, y0 + 0.016, 4), { radius: 0.0215, squash: 0.8, sides: 14, segs: 5, tile: 0.06, up: V(1, 0, 0), caps: 'round', capRings: 2 }, lash);
  }
  addMesh(g, lash, cordMat('sinew'), 'lashings');
  // кожаная накладка-полочка под стрелу (слева от окна)
  const shelf = new GeoBuilder();
  tube(new THREE.LineCurve3(V(0.0235, 0.058, -0.006), V(0.0235, 0.018, 0.0)), { radius: 0.0052, squash: 1.2, sides: 8, segs: 3, tile: 0.1, caps: 'round', capRings: 2 }, shelf);
  addMesh(g, shelf, leatherMat('tan'), 'rest');

  // ---------- Костяные наконечники (проточки под тетиву) ----------
  const tips = new GeoBuilder();
  for (const s of [1, -1]) {
    const y0 = s * (H - 0.066), y1 = s * H;
    const c = staveCurve(Math.min(y0, y1), Math.max(y0, y1), 8);
    tube(c, {
      radius: (t) => { const k = s > 0 ? t : 1 - t; return 0.0092 - 0.0045 * k + 0.0012 * Math.exp(-(((k - 0.74) / 0.06) ** 2)); },
      squash: 0.85, sides: 10, segs: 14, tile: 0.06, up: V(1, 0, 0), caps: 'round', capRings: 3,
    }, tips);
  }
  addMesh(g, tips, boneMat('aged'), 'tips');

  // ---------- Тетива и «обмотка» в центре ----------
  const tipTop = V(0, H - 0.012, staveZ(H - 0.012) - 0.0035);
  const tipBot = V(0, -(H - 0.012), staveZ(H - 0.012) - 0.0035);
  const nockRest = V(0, 0, -BOW.brace);
  const cyl = new THREE.CylinderGeometry(1, 1, 1, 5, 1, true);
  cyl.translate(0, 0.5, 0);
  const strMat = cordMat('sinew');
  const sTop = new THREE.Mesh(cyl, strMat), sBot = new THREE.Mesh(cyl, strMat);
  const serving = new THREE.Mesh(cyl, cordMat('leather'));
  for (const m of [sTop, sBot, serving]) { m.castShadow = false; m.frustumCulled = false; g.add(m); }
  sTop.name = 'stringTop'; sBot.name = 'stringBot'; serving.name = 'serving';
  const arrow = buildArrow('hunter');
  arrow.visible = false;
  arrow.name = 'nockedArrow';
  g.add(arrow);

  const _n = V(), _a = V(), _b = V();
  g.userData.updateString = (nock: V3 | null, showArrow = false): void => {
    const n = nock ? _n.copy(nock) : _n.copy(nockRest);
    n.x = 0;
    n.z = Math.min(n.z, -BOW.brace);
    g.userData.nockLocal = (g.userData.nockLocal as V3 | undefined)?.copy(n) ?? n.clone();
    place(sTop, tipTop, n, BOW.stringR);
    place(sBot, n, tipBot, BOW.stringR);
    // «обмотка» на месте наложения стрелы
    place(serving, _a.set(n.x, n.y - 0.055, n.z), _b.set(n.x, n.y + 0.055, n.z), BOW.stringR * 1.9);
    arrow.visible = showArrow && n.z < -BOW.brace - 0.02;
    if (arrow.visible) {
      const dir = _a.set(0.052, 0, 1).normalize();
      arrow.position.copy(n).addScaledVector(dir, 0.39);
      arrow.quaternion.setFromUnitVectors(UP, dir);
    }
  };
  g.userData.updateString(null);

  addSocket(g, 'grip', 0, 0, 0);
  addSocket(g, 'nock', nockRest.x, nockRest.y, nockRest.z);
  addSocket(g, 'tipTop', tipTop.x, tipTop.y, tipTop.z);
  addSocket(g, 'tipBot', tipBot.x, tipBot.y, tipBot.z);
  addSocket(g, 'rest', 0.0235, 0.04, 0.0);
  finishGear(g, { length: 2 * H, axis: 'Y', origin: 'grip', stringSide: '-Z' });
  g.traverse((o) => { if (o === sTop || o === sBot || o === serving || o.parent === arrow || o === arrow) o.castShadow = false; });
  return g;
}
