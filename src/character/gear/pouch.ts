// Поясная сумка: подушкой выпуклый кожаный мешок, клапан с вытисненным оленем и прошивкой, бахрома по низу, скрученная
// кожаная планка-подвес с обмоткой, косичка с костяной бусиной, костяной пуговица-«колышек».
// Система координат: начало — середина верхнего края мешка; сумка висит вниз (−Y, до ≈ −0.17), лицо к +Z.
// userData.sockets: bar (центр планки подвеса), top, bottom.

import * as THREE from 'three';
import { GeoBuilder, V, V3, tube, strap, ellipsoid } from './geom';
import { newGear, addSocket, finishGear, addMesh, thong, bead } from './common';
import { boneMat, brassMat, leatherMat, leatherPBR, LEATHERS, matFromMaps, wrapMat, cordMat } from './materials';

const C = { cy: -0.085, rx: 0.078, ry: 0.088, rz: 0.029, e: 0.6 };
const sp = (x: number) => Math.sign(x) * Math.pow(Math.abs(x), C.e);

/** Точка на поверхности мешка (суперэллипсоид) по параметрам (φ — от макушки, θ — от +Z). */
function bodyPoint(phi: number, th: number, out = V()): V3 {
  const sphi = Math.sin(phi);
  return out.set(sp(sphi) * sp(Math.sin(th)) * C.rx, C.cy + sp(Math.cos(phi)) * C.ry, sp(sphi) * sp(Math.cos(th)) * C.rz);
}
const PHI0 = 0.06;
const THMAX = Math.PI / 2 - 0.1;
const phiBot = (th: number) => Math.PI * (0.585 + 0.075 * Math.cos(th) * Math.cos(th));

let _flap: THREE.MeshStandardMaterial | null = null;
/** Кожа клапана: тёмная, с оленем (охряной контур), прошивкой по краю и потёртостями. */
export function flapMat(): THREE.MeshStandardMaterial {
  if (_flap) return _flap;
  const S = 1024;
  const t = leatherPBR({ ...LEATHERS.dark, size: S, seed: 31, grain: 120, stain: 0.6, scuff: 0.9 });
  // planar uv: u = x / 0.16 + 0.5, v = 1 + y / 0.16  (y ≤ 0)
  const px = (x: number) => (x / 0.16 + 0.5) * S;
  const py = (y: number) => (1 - (1 + y / 0.16)) * S;
  t.decal((g) => {
    // прошивка по краю клапана
    g.strokeStyle = '#c9a56e';
    g.lineWidth = 3.5;
    g.setLineDash([9, 7]);
    g.lineCap = 'round';
    g.beginPath();
    for (let i = 0; i <= 60; i++) {
      const th = -THMAX * 0.93 + (2 * THMAX * 0.93 * i) / 60;
      const p = bodyPoint(phiBot(th) - 0.12, th);
      if (i === 0) g.moveTo(px(p.x), py(p.y)); else g.lineTo(px(p.x), py(p.y));
    }
    g.stroke();
    g.setLineDash([]);
    // олень — охристый штриховой рисунок (центр клапана)
    const cx = px(0), cy = py(-0.07), s = S * 0.0072;
    g.strokeStyle = '#a4552f';
    g.fillStyle = '#a4552f';
    g.lineWidth = 7;
    g.lineJoin = 'round';
    const line = (pts: Array<[number, number]>) => { g.beginPath(); pts.forEach(([x, y], i) => (i ? g.lineTo(cx + x * s, cy + y * s) : g.moveTo(cx + x * s, cy + y * s))); g.stroke(); };
    // туловище
    g.beginPath(); g.ellipse(cx + 1 * s, cy + 2 * s, 11 * s, 5.2 * s, 0, 0, Math.PI * 2); g.stroke();
    // шея и голова
    line([[-6, -1], [-10, -8], [-12, -12]]);
    line([[-12, -12], [-16, -12.5], [-18.5, -10.5]]);
    // ноги
    line([[-6, 6], [-7, 14], [-7.5, 20]]); line([[-3, 7], [-3.5, 14], [-3, 20]]);
    line([[8, 6], [9, 14], [9.5, 20]]); line([[11, 5], [13, 12], [14.5, 19]]);
    // хвост
    line([[12, -1], [14, -3]]);
    // рога: основной ствол и отростки
    line([[-13, -12.5], [-12, -19], [-9, -24], [-7, -29]]);
    line([[-12, -19], [-16, -22], [-17.5, -27]]);
    line([[-10, -22.5], [-6.5, -22], [-3.5, -25]]);
    line([[-14, -13.5], [-18, -17], [-21, -17]]);
    line([[-8.5, -26], [-11, -29]]);
    // фон-точки вокруг
    for (let k = 0; k < 14; k++) { const a = (k / 14) * Math.PI * 2; g.beginPath(); g.arc(cx + Math.cos(a) * 28 * s, cy + (Math.sin(a) * 22 - 4) * s, 3, 0, Math.PI * 2); g.fill(); }
  }, { dh: 0.2, rough: 0.68 });
  t.blurHeight(1);
  t.cavity(0.6, 2, 0.35);
  _flap = matFromMaps(t.textures({ normalStrength: 4 }), { normalScale: 1 });
  _flap.name = 'pouchFlap';
  return _flap;
}

export function buildPouch(): THREE.Group {
  const g = newGear('Pouch');

  // ---------- Мешок ----------
  const body = new GeoBuilder();
  ellipsoid(V(0, C.cy, 0), C.rx, C.ry, C.rz, { rows: 18, cols: 32, e: C.e, tile: 0.2 }, body);
  for (let i = 0; i < body.uv.length; i += 2) { body.uv[i] *= 2.6; body.uv[i + 1] *= 1.0; }
  addMesh(g, body, leatherMat('dark'), 'body');

  // ---------- Клапан ----------
  const flap = new GeoBuilder();
  const rows = 16, cols = 28;
  const tmp = V();
  flap.grid(rows, cols, (i, j) => {
    const th = THMAX * (2 * (j / (cols - 1)) - 1);
    const phi = PHI0 + (i / (rows - 1)) * (phiBot(th) - PHI0);
    const p = bodyPoint(phi, th, tmp).clone();
    // небольшой отступ от мешка и выпуклость к центру
    const k = 1 + 0.045 * Math.sin(Math.PI * (i / (rows - 1)));
    p.x *= 1.012; p.y = C.cy + (p.y - C.cy) * 1.008;
    p.z = p.z * k + 0.0032;
    return { p, u: p.x / 0.16 + 0.5, v: 1 + p.y / 0.16 };
  }, { flip: false });
  addMesh(g, flap, flapMat(), 'flap');
  // валик по нижнему краю клапана
  const edge = new GeoBuilder();
  const epts: V3[] = [];
  for (let j = 0; j <= 28; j++) {
    const th = THMAX * (2 * (j / 28) - 1);
    const p = bodyPoint(phiBot(th), th).clone();
    p.x *= 1.012; p.y = C.cy + (p.y - C.cy) * 1.008; p.z = p.z * 1.045 * 0.995 + 0.0032;
    epts.push(p);
  }
  tube(new THREE.CatmullRomCurve3(epts), { radius: 0.0021, sides: 6, segs: 56, tile: 0.08, caps: 'round', capRings: 2 }, edge);
  addMesh(g, edge, leatherMat('black'), 'flapEdge');

  // ---------- Бахрома по низу ----------
  const fringe = new GeoBuilder();
  const N = 30;
  for (let i = 0; i < N; i++) {
    const s = i / (N - 1);
    const th = -1.25 + 2.5 * s;
    const root = bodyPoint(Math.PI * 0.75, th).clone();
    root.z += 0.001;
    const len = 0.03 + 0.036 * Math.abs(Math.sin(i * 12.9898) * 43758.5453 % 1);
    const sx = Math.sin(th) * 0.01, bend = ((i * 7) % 5 - 2) * 0.0016;
    thong(fringe, [root, root.clone().add(V(sx * 0.4 + bend, -len * 0.4, 0.004)), root.clone().add(V(sx + bend * 2, -len * 0.8, 0.007)), root.clone().add(V(sx * 1.2 + bend * 3, -len, 0.0075))], 0.0026, { taper: 0.5, sides: 4, tile: 0.05 });
  }
  addMesh(g, fringe, leatherMat('tan'), 'fringe');

  // ---------- Подвес: планка с обмоткой и ремни ----------
  const bar = new GeoBuilder();
  tube(new THREE.LineCurve3(V(-0.088, 0.048, 0.004), V(0.088, 0.048, 0.004)), { radius: 0.0112, squash: 1, sides: 12, segs: 10, tile: 0.2, caps: 'round', capRings: 3 }, bar);
  addMesh(g, bar, leatherMat('tan'), 'bar');
  const lash = new GeoBuilder();
  for (const x of [-0.078, 0.078, -0.052, 0.052]) {
    tube(new THREE.LineCurve3(V(x - 0.006, 0.048, 0.004), V(x + 0.006, 0.048, 0.004)), { radius: 0.0126, sides: 12, segs: 3, tile: 0.05 }, lash);
  }
  addMesh(g, lash, cordMat('sinew'), 'lashings');
  const straps = new GeoBuilder();
  for (const x of [-0.052, 0.052]) {
    const c = new THREE.CatmullRomCurve3([V(x, 0.052, 0.0045), V(x, 0.03, 0.026), V(x, 0.006, 0.0305), V(x, -0.012, 0.0310)]);
    strap(c, { width: 0.02, thick: 0.0034, up: V(0, 0, 1), tile: 0.2, segs: 14 }, straps);
  }
  addMesh(g, straps, leatherMat('tan'), 'straps');
  // тыльные ремни-петли: бегут за мешком к поясу
  const back = new GeoBuilder();
  for (const x of [-0.052, 0.052]) {
    const c = new THREE.CatmullRomCurve3([V(x, 0.052, 0.0), V(x, 0.052, -0.012), V(x, 0.02, -0.0295), V(x, -0.02, -0.0315)]);
    strap(c, { width: 0.02, thick: 0.0034, up: V(0, 0, 1), tile: 0.2, segs: 14 }, back);
  }
  addMesh(g, back, leatherMat('tan'), 'backStraps');

  // косичка и костяная бусина справа
  const braid = new GeoBuilder();
  const bd = new GeoBuilder();
  const bpts = [V(0.088, 0.044, 0.006), V(0.095, 0.02, 0.012), V(0.099, -0.01, 0.016), V(0.1, -0.04, 0.018), V(0.098, -0.07, 0.016)];
  thong(braid, bpts, 0.0032, { taper: 0.3, sides: 6 });
  thong(braid, [V(0.1, -0.06, 0.017), V(0.102, -0.09, 0.019), V(0.098, -0.108, 0.018)], 0.0016, { taper: 0.6 });
  thong(braid, [V(0.1, -0.06, 0.017), V(0.107, -0.085, 0.017), V(0.108, -0.1, 0.018)], 0.0016, { taper: 0.6 });
  bead(bd, V(0.0995, -0.052, 0.0175), 0.0058, 1.1);
  addMesh(g, braid, cordMat('leather'), 'braid');
  addMesh(g, bd, boneMat('ivory'), 'braidBead');

  // колышек-застёжка и колечко
  const peg = new GeoBuilder();
  tube(new THREE.LineCurve3(V(0, -0.118, 0.0415), V(0, -0.138, 0.0415)), { radius: 0.0058, squash: 1, sides: 8, segs: 4, tile: 0.1, caps: 'round', capRings: 2 }, peg);
  addMesh(g, peg, boneMat('aged'), 'toggle');
  const rg = new GeoBuilder();
  const lc = new GeoBuilder();
  thong(lc, [V(0, -0.1, 0.0425), V(0, -0.118, 0.045), V(0, -0.126, 0.0455)], 0.0016, { taper: 0 });
  addMesh(g, lc, cordMat('leather'), 'toggleLoop');
  void rg; void brassMat; void wrapMat;

  addSocket(g, 'bar', 0, 0.048, 0.004);
  addSocket(g, 'top', 0, 0.0, 0);
  addSocket(g, 'bottom', 0, -0.172, 0);
  return finishGear(g, { length: 0.22, axis: '-Y', origin: 'top' });
}
