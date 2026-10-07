// Обереги и подвески: связка клыков с пером и костяными бусинами, бронзовый солнечный медальон на шнуре, кисть из
// перьев. Каждый предмет «висит» вдоль −Y от точки подвеса (начало координат), лицо — к +Z.
// Пружинную подвижность даёт скелет персонажа (подвески крепятся к костям medal*/fang*/featherBelt*).

import * as THREE from 'three';
import { GeoBuilder, V, V3, tube, loftY, torus, ellipsoid } from './geom';
import { newGear, addSocket, finishGear, addMesh, thong, bead } from './common';
import { boneMat, brassMat, BRASSES, brassPBR, cordMat, leatherMat, matFromMaps, woodMat, wrapMat } from './materials';
import { featherGeometry, featherMat, FeatherKind } from './feather';

// ---------- Клык ----------

/** Клык: изогнутый конус с «меховым» колпачком у корня; корень в (0,0,0), остриё вниз и слегка вперёд (+Z). */
export function fangGeometry(len = 0.075, r0 = 0.0105, curve = 0.026, rootCap = true): { tooth: GeoBuilder; cap: GeoBuilder } {
  const pts: V3[] = [];
  for (let i = 0; i <= 8; i++) { const s = i / 8; pts.push(V(0, -len * s, curve * Math.pow(s, 2.2))); }
  const c = new THREE.CatmullRomCurve3(pts);
  const tooth = new GeoBuilder(), cap = new GeoBuilder();
  tube(c, { radius: (t) => r0 * Math.pow(1 - t, 0.85) * (1 + 0.1 * Math.sin(t * 3)) + 0.0006, squash: 0.86, sides: 10, segs: 14, tile: 0.1, caps: 'round', capRings: 2, up: V(1, 0, 0) }, tooth);
  if (rootCap) {
    const c2 = new THREE.LineCurve3(V(0, 0.003, -0.0005), V(0, -0.0105, -0.0003));
    tube(c2, { radius: (t) => r0 * (1.12 + 0.12 * Math.sin(t * Math.PI)) * (1 - 0.08 * t), squash: 0.9, sides: 10, segs: 4, tile: 0.06, caps: 'none', up: V(1, 0, 0) }, cap);
  }
  return { tooth, cap };
}

function addFang(g: THREE.Object3D, at: V3, rotZ: number, scale: number, parts: { tooth: GeoBuilder; cap: GeoBuilder }, tb: GeoBuilder, cb: GeoBuilder): void {
  const m = new THREE.Matrix4().compose(at, new THREE.Quaternion().setFromEuler(new THREE.Euler(0, 0, rotZ)), V(scale, scale, scale));
  tb.append(parts.tooth, m);
  cb.append(parts.cap, m);
  void g;
}

/** Связка: деревянный «идол» с обмоткой, бронзовое кольцо, два клыка, перо и бусины. Подвес — вверху. */
export function buildFangCluster(opts: { feather?: FeatherKind } = {}): THREE.Group {
  const g = newGear('FangCluster');
  // подвесной обух: резной деревянный цилиндр с обмоткой
  const idol = new GeoBuilder();
  loftY({ rings: [[0.0, 0.0105], [-0.004, 0.0125], [-0.016, 0.0115], [-0.026, 0.0128], [-0.032, 0.0098], [-0.035, 0.0066]].map(([y, r]) => ({ y, rx: r, rz: r })), cols: 10, tile: 0.1 }, idol);
  addMesh(g, idol, woodMat('handle'), 'idol');
  const wrp = new GeoBuilder();
  tube(new THREE.LineCurve3(V(0, -0.006, 0), V(0, -0.017, 0)), { radius: 0.0138, sides: 12, segs: 5, tile: 0.1, caps: 'none' }, wrp);
  addMesh(g, wrp, wrapMat('tan'), 'idolWrap');
  // кольцо
  const ringG = new GeoBuilder();
  torus(0.0105, 0.0017, 18, 6, { c: V(0, -0.0455, 0), rot: new THREE.Euler(Math.PI / 2, 0, 0) }, ringG);
  addMesh(g, ringG, brassMat('bronze'), 'ring');
  // шнуры
  const cords = new GeoBuilder();
  const beads = new GeoBuilder();
  const fangs = { tooth: new GeoBuilder(), cap: new GeoBuilder() };
  const f1 = fangGeometry(0.078, 0.0108, 0.027), f2 = fangGeometry(0.066, 0.0098, 0.022);
  // левая и правая ветви колечком-«ухом»
  thong(cords, [V(0, -0.036, 0), V(-0.01, -0.054, 0.002), V(-0.021, -0.068, 0.003), V(-0.024, -0.082, 0.003)], 0.0021, { taper: 0.1 });
  thong(cords, [V(0, -0.036, 0), V(0.01, -0.054, 0.002), V(0.021, -0.066, 0.003), V(0.025, -0.078, 0.003)], 0.0021, { taper: 0.1 });
  bead(beads, V(-0.0185, -0.064, 0.003), 0.0068, 1.1);
  bead(beads, V(0.0195, -0.062, 0.003), 0.0064, 1.1);
  addFang(g, V(-0.024, -0.082, 0.003), 0.1, 1, f1, fangs.tooth, fangs.cap);
  addFang(g, V(0.025, -0.078, 0.003), -0.12, 0.88, f2, fangs.tooth, fangs.cap);
  // перо посередине
  thong(cords, [V(0, -0.0475, 0), V(0.0, -0.062, 0.001), V(0.001, -0.072, 0.0015)], 0.0017, { taper: 0.0 });
  const fe = new GeoBuilder();
  const fg = featherGeometry({ length: 0.105, width: 0.026, curl: 0.012, cup: 0.0025, twist: 0.2, rows: 12, cols: 5 });
  fe.append(fg, new THREE.Matrix4().compose(V(0.001, -0.071, 0.002), new THREE.Quaternion().setFromEuler(new THREE.Euler(Math.PI, 0, 0.04)), V(1, 1, 1)));
  addMesh(g, cords, cordMat('leather'), 'cords');
  addMesh(g, beads, boneMat('ivory'), 'beads');
  addMesh(g, fangs.tooth, boneMat('ivory'), 'fangs');
  addMesh(g, fangs.cap, leatherMat('black'), 'fangCaps');
  addMesh(g, fe, featherMat(opts.feather ?? 'white'), 'feather');
  addSocket(g, 'top', 0, 0, 0);
  addSocket(g, 'tipL', -0.026, -0.155, 0.02);
  addSocket(g, 'tipR', 0.027, -0.14, 0.02);
  return finishGear(g, { length: 0.17, axis: '-Y', origin: 'top' });
}

// ---------- Медальон ----------

let _medal: THREE.MeshStandardMaterial | null = null;
/** Бронзовая поверхность с солнечным узором: кольца, крест, лучи, точки. Лицо — в центре текстуры. */
export function medallionMat(): THREE.MeshStandardMaterial {
  if (_medal) return _medal;
  const S = 512;
  const t = brassPBR({ ...BRASSES.bronze, size: S, seed: 12, hammer: 0.6 });
  t.decal((g, w, h) => {
    const cx = w / 2, cy = h / 2, R = w * 0.5;
    g.strokeStyle = '#e8b26a';
    g.fillStyle = '#e8b26a';
    g.lineCap = 'round';
    const ring = (r: number, lw: number) => { g.lineWidth = lw; g.beginPath(); g.arc(cx, cy, r * R, 0, Math.PI * 2); g.stroke(); };
    ring(0.9, 5); ring(0.8, 3); ring(0.5, 5); ring(0.2, 4);
    // крест и косые лучи
    g.lineWidth = 6;
    for (let k = 0; k < 4; k++) {
      const a = (k * Math.PI) / 2;
      g.beginPath(); g.moveTo(cx + Math.cos(a) * 0.2 * R, cy + Math.sin(a) * 0.2 * R); g.lineTo(cx + Math.cos(a) * 0.8 * R, cy + Math.sin(a) * 0.8 * R); g.stroke();
    }
    g.lineWidth = 3;
    for (let k = 0; k < 8; k++) {
      const a = (k * Math.PI) / 4 + Math.PI / 8;
      g.beginPath(); g.moveTo(cx + Math.cos(a) * 0.5 * R, cy + Math.sin(a) * 0.5 * R); g.lineTo(cx + Math.cos(a) * 0.8 * R, cy + Math.sin(a) * 0.8 * R); g.stroke();
    }
    // точки между кольцами и «зубцы»
    for (let k = 0; k < 24; k++) {
      const a = (k * Math.PI * 2) / 24;
      g.beginPath(); g.arc(cx + Math.cos(a) * 0.85 * R, cy + Math.sin(a) * 0.85 * R, 3.2, 0, Math.PI * 2); g.fill();
    }
    for (let k = 0; k < 16; k++) {
      const a = (k * Math.PI * 2) / 16;
      g.beginPath(); g.arc(cx + Math.cos(a) * 0.35 * R, cy + Math.sin(a) * 0.35 * R, 2.6, 0, Math.PI * 2); g.fill();
    }
    g.beginPath(); g.arc(cx, cy, 0.07 * R, 0, Math.PI * 2); g.fill();
  }, { dh: 0.22, rough: 0.34, metal: 0.95, k: 0.9, alphaMul: undefined });
  t.blurHeight(1);
  t.cavity(0.8, 2, 0.5);
  _medal = matFromMaps(t.textures({ normalStrength: 3 }), { normalScale: 1, envMapIntensity: 1.15 });
  _medal.name = 'medallion';
  return _medal;
}

/** Медальон: диск ⌀≈7 см с бортиком, ушко и шнур вверху, подвеска с бусиной внизу. Лицо — к +Z. */
export function buildMedallion(): THREE.Group {
  const g = newGear('Medallion');
  const R = 0.034;
  const face = new GeoBuilder();
  const poly: THREE.Vector3[] = [];
  for (let i = 0; i < 40; i++) { const a = (i / 40) * Math.PI * 2; poly.push(V(Math.sin(a) * 0.0305, 0.0016, Math.cos(a) * 0.0305)); }
  // перед (в системе до поворота): +Y
  face.fan(poly, V(0, 1, 0), (p) => [0.5 + p.x / (2 * R), 0.5 - p.z / (2 * R)]);
  // бортик и кромка
  loftY({
    rings: [[0.0016, 0.0305], [0.0020, 0.0310], [0.0045, 0.0335], [0.0050, 0.0345], [0.0040, 0.0352], [0.0, 0.0355], [-0.0030, 0.0352], [-0.0035, 0.0335]].map(([y, r]) => ({ y, rx: r, rz: r })),
    cols: 40, tile: 0.1, uv: (i, j, th) => [0.5 + Math.sin(th) * (i < 2 ? 0.0305 / (2 * R) : 0.49), 0.5 - Math.cos(th) * (i < 2 ? 0.0305 / (2 * R) : 0.49)],
  }, face);
  // тыл
  const back: THREE.Vector3[] = [];
  for (let i = 0; i < 40; i++) { const a = (i / 40) * Math.PI * 2; back.push(V(Math.sin(a) * 0.0335, -0.0035, Math.cos(a) * 0.0335)); }
  face.fan(back.slice().reverse(), V(0, -1, 0), (p) => [0.5 + p.x / (2 * R), 0.5 + p.z / (2 * R)]);
  face.transform(new THREE.Matrix4().makeRotationX(Math.PI / 2));
  addMesh(g, face, medallionMat(), 'disc');
  // ушко, шнур и нижняя подвеска
  const eye = new GeoBuilder();
  torus(0.0065, 0.0017, 14, 6, { c: V(0, R + 0.0052, 0), rot: new THREE.Euler(0, 0, 0) }, eye);
  loftY({ rings: [[R + 0.0005, 0.0075], [R + 0.004, 0.0065], [R + 0.008, 0.0045]].map(([y, r]) => ({ y, rx: r, rz: 0.003 })), cols: 10, tile: 0.1 }, eye);
  addMesh(g, eye, brassMat('bronze'), 'eyelet');
  const cord = new GeoBuilder();
  const beads = new GeoBuilder();
  thong(cord, [V(0, R + 0.012, 0), V(0, R + 0.03, 0.0), V(0, R + 0.05, 0.001)], 0.0022, { taper: 0 });
  thong(cord, [V(0, -R + 0.002, 0.0), V(0, -R - 0.012, 0.002), V(0, -R - 0.03, 0.002)], 0.0017, { taper: 0.3 });
  bead(beads, V(0, -R - 0.022, 0.002), 0.0055, 1.15);
  const tr = new THREE.Matrix4();
  void tr;
  const fe = new GeoBuilder();
  fe.append(featherGeometry({ length: 0.07, width: 0.02, curl: 0.006, cup: 0.002, twist: 0.1, rows: 10, cols: 5 }),
    new THREE.Matrix4().compose(V(0, -R - 0.03, 0.0), new THREE.Quaternion().setFromEuler(new THREE.Euler(Math.PI, 0, 0)), V(1, 1, 1)));
  addMesh(g, cord, cordMat('leather'), 'cord');
  addMesh(g, beads, boneMat('ivory'), 'bead');
  addMesh(g, fe, featherMat('dark'), 'feather');
  addSocket(g, 'top', 0, R + 0.05, 0);
  addSocket(g, 'center', 0, 0, 0);
  void ellipsoid;
  return finishGear(g, { length: 2 * R + 0.1, axis: '-Y', origin: 'center', radius: R });
}
