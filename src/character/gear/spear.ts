// Копьё охотника: тёмное древко с резными поясками, кожаные обмотки хвата, кованый наконечник-«лист» с барбами и
// ребром жёсткости, втулка, обмотка жилой, перья, кисти и костяные бусины.
// Начало — точка основного хвата правой руки; ось вдоль +Y. butt ≈ -1.0, tip ≈ +1.1.
// userData.sockets: gripR (0,0,0), gripL (0,0.45,0), tip, butt, hitbase (начало зоны поражения — основание втулки).

import * as THREE from 'three';
import { GeoBuilder, V, V3, tube, loftY, torus, sphere } from './geom';
import { buildBlade, chaikin, symmetricLoop, BladeLoop, Pt } from './blade';
import { newGear, addSocket, finishGear, addMesh, thong, bead, orient, sstep } from './common';
import { woodMat, carvedWoodMat, wrapMat, cordMat, steelMat, boneMat, brassMat, TILE } from './materials';
import { featherGeometry, featherMat } from './feather';

export const SPEAR = { butt: -1.0, tip: 1.1, gripL: 0.45, hitbase: 0.8 };

/** Ось древка: лёгкая ручная кривизна (до ~3 мм), нулевая в точке хвата. */
function axis(y: number): V3 {
  const f = (yy: number): [number, number] => {
    const t = (yy + 1.0) / 2.1;
    return [0.0026 * Math.sin(Math.PI * t) + 0.0011 * Math.sin(3.1 * Math.PI * t + 0.6), 0.0014 * Math.sin(2 * Math.PI * t + 1.2)];
  };
  const a = f(y), b = f(0);
  return V(a[0] - b[0], y, a[1] - b[1]);
}

function shaftR(y: number): number {
  const bump = sstep(-0.95, -0.3, y) * (1 - sstep(0.3, 0.86, y));
  return 0.0145 + 0.0026 * bump;
}

interface ZoneOpts {
  sides?: number;
  tile: number;
  vOffset?: number;
  segs?: number;
  caps?: 'none' | 'flat';
}

/** Участок древка между y0 и y1 с радиусом r(y). */
function zone(gb: GeoBuilder, y0: number, y1: number, r: (y: number) => number, o: ZoneOpts): void {
  const n = Math.max(2, Math.ceil((y1 - y0) / 0.12));
  const pts: V3[] = [];
  for (let i = 0; i <= n; i++) pts.push(axis(y0 + ((y1 - y0) * i) / n));
  const curve = new THREE.CatmullRomCurve3(pts, false, 'centripetal');
  tube(curve, {
    radius: (t) => r(y0 + t * (y1 - y0)),
    sides: o.sides ?? 14,
    segs: o.segs ?? Math.max(3, Math.ceil((y1 - y0) / 0.05)),
    tile: o.tile,
    vOffset: o.vOffset ?? 0,
    caps: o.caps ?? 'none',
    up: V(0, 0, 1),
  }, gb);
}

export type SpearStyle = 'hunter' | 'raider';

/** Копьё героя (резьба, перья, бусины) или простое копьё налётчика (ясень, железо, сыромятные обмотки). */
export function buildSpear(style: SpearStyle = 'hunter'): THREE.Group {
  const raider = style === 'raider';
  const g = newGear('Spear');

  // ---------- Древко ----------
  const plain = new GeoBuilder();
  const carved = new GeoBuilder();
  const wrapR = new GeoBuilder();
  const wrapL = new GeoBuilder();
  const tW = TILE.woodV;
  const vOff = (y: number) => (y - SPEAR.butt) / tW;
  const plainZone = (y0: number, y1: number) => zone(plain, y0, y1, shaftR, { tile: tW, vOffset: vOff(y0), sides: 14 });
  // резные пояски: два типа по 0.052 м (см. CARVED_ROWS: ряды 0-1 и 2-3 плитки 0.104 м)
  const ring = (y0: number, type: 0 | 1) => {
    const y1 = y0 + 0.052;
    const collar = (y: number) => 0.0007 + 0.0006 * (Math.exp(-(((y - y0) / 0.0035) ** 2)) + Math.exp(-(((y - y1) / 0.0035) ** 2)));
    if (raider) zone(plain, y0, y1, (y) => shaftR(y) + 0.5 * collar(y), { tile: tW, vOffset: vOff(y0), sides: 14 });
    else zone(carved, y0, y1, (y) => shaftR(y) + collar(y), { tile: 0.104, vOffset: type * 0.5, sides: 16, segs: 16 });
  };
  plainZone(-0.915, -0.80);
  ring(-0.80, 0);
  plainZone(-0.748, -0.60);
  ring(-0.60, 1);
  plainZone(-0.548, -0.30);
  ring(-0.30, 0);
  plainZone(-0.248, -0.172);
  // обмотка хвата правой руки: ±0.17 м с округлыми концами
  const wr = (y0: number, y1: number, bump: number) => (y: number) => shaftR(y) + bump * (0.35 + 0.65 * Math.min(sstep(y0, y0 + 0.03, y), 1 - sstep(y1 - 0.03, y1, y)));
  zone(wrapR, -0.17, 0.17, wr(-0.17, 0.17, 0.0016), { tile: 0.12, vOffset: 0, sides: 16, segs: 20 });
  plainZone(0.17, 0.355);
  zone(wrapL, 0.355, 0.545, wr(0.355, 0.545, 0.0014), { tile: 0.12, vOffset: 0.3, sides: 16, segs: 14 });
  plainZone(0.545, 0.60);
  ring(0.60, 1);
  plainZone(0.652, 0.70);
  ring(0.70, 0);
  plainZone(0.752, 0.80);
  addMesh(g, plain, woodMat(raider ? 'ash' : 'shaft'), 'shaftPlain');
  addMesh(g, carved, carvedWoodMat('shaft'), 'shaftCarved');
  addMesh(g, wrapR, wrapMat('dark'), 'gripWrapR');
  addMesh(g, wrapL, wrapMat(raider ? 'dark' : 'tan'), 'gripWrapL');

  // ---------- Концевые перетяжки жилой на обмотках ----------
  const sinew = new GeoBuilder();
  for (const y of [-0.17, 0.17, 0.355, 0.545]) {
    const r = shaftR(y) + 0.0013;
    const c = axis(y);
    torus(r, 0.0016, 18, 5, { c }, sinew);
    torus(r - 0.0004, 0.0013, 18, 5, { c: c.clone().add(V(0, y < 0.3 ? 0.0032 : -0.0032, 0)) }, sinew);
  }
  // обмотка под наконечником: толстая «колодка» из жилы
  const bindA = new THREE.CatmullRomCurve3([axis(0.768), axis(0.805), axis(0.842)]);
  tube(bindA, { radius: (t) => 0.0172 + 0.0014 * Math.sin(t * Math.PI), sides: 16, segs: 14, tile: 0.12, up: V(0, 0, 1) }, sinew);
  addMesh(g, sinew, cordMat('sinew'), 'sinewBinding');

  // ---------- Кованый наконечник ----------
  const flats = new GeoBuilder();
  const edges = new GeoBuilder();
  const ctrl: Pt[] = [[0, 0.0125], [0.018, 0.0185], [0.05, 0.0295], [0.09, 0.029], [0.14, 0.0255], [0.19, 0.016], [0.222, 0.0065], [0.235, 0]];
  const outline = chaikin(ctrl, 3, new Set([2]));
  const top: BladeLoop[] = [
    { pts: [[-1, 0], [-0.8, 0.26]], edge: true },
    { pts: [[-0.8, 0.26], [-0.52, 0.36], [-0.27, 0.4]] },
    { pts: [[-0.27, 0.4], [-0.17, 0.72], [-0.07, 0.95], [0, 1.0]] },
    { pts: [[0, 1.0], [0.07, 0.95], [0.17, 0.72], [0.27, 0.4]] },
    { pts: [[0.27, 0.4], [0.52, 0.36], [0.8, 0.26]] },
    { pts: [[0.8, 0.26], [1, 0]], edge: true },
  ];
  const y0 = 0.865;
  buildBlade({
    length: 0.235, y0, outline, thick: (t) => 0.0034 * Math.pow(1 - t, 0.85) + 0.0007,
    loop: symmetricLoop(top), stations: 46, tile: 0.25, edgeTint: 1.3,
    tintAlong: (t) => 0.9 + 0.12 * t,
  }, flats, edges);
  addMesh(g, flats, steelMat(raider ? 'iron' : 'forged'), 'headFlats');
  addMesh(g, edges, steelMat('blade', { vertexColors: true }), 'headEdges');

  // втулка: кольца с переходом в плоский гребень
  const sock = new GeoBuilder();
  const socketRings: Array<[number, number, number]> = [
    [0.788, 0.0200, 0.0200], [0.793, 0.0215, 0.0215], [0.803, 0.0202, 0.0202], [0.826, 0.0180, 0.0180], [0.848, 0.0172, 0.0172],
    [0.862, 0.0176, 0.0176], [0.869, 0.0196, 0.0196], [0.876, 0.0182, 0.0182], [0.888, 0.0160, 0.0150],
    [0.904, 0.0140, 0.0098], [0.924, 0.0112, 0.0062], [0.948, 0.0075, 0.0044], [0.972, 0.0030, 0.0034],
  ];
  loftY({ rings: socketRings.map(([y, rx, rz]) => ({ y, rx, rz })), cols: 18, tile: 0.25, uAround: 1 }, sock);
  // торец втулки внизу (виден снизу как тёмное отверстие)
  addMesh(g, sock, steelMat(raider ? 'iron' : 'forged'), 'socket');
  // заклёпка через втулку
  const pin = new GeoBuilder();
  sphere(V(0.0215, 0.812, 0), 0.0034, 4, 8, pin);
  sphere(V(-0.0215, 0.812, 0), 0.0034, 4, 8, pin);
  addMesh(g, pin, steelMat('dull'), 'pin');

  // ---------- Пятка: железный башмак и костяное кольцо ----------
  const shoe = new GeoBuilder();
  loftY({
    rings: [[-1.0, 0.0045], [-0.996, 0.0095], [-0.988, 0.0125], [-0.965, 0.0141], [-0.943, 0.0152], [-0.937, 0.0163], [-0.931, 0.0158], [-0.926, 0.0148]]
      .map(([y, r]) => ({ y, rx: r, rz: r, ...(() => { const a = axis(y); return { cx: a.x, cz: a.z }; })() })),
    cols: 16, tile: 0.25,
  }, shoe);
  addMesh(g, shoe, steelMat('dull'), 'buttShoe');
  const ringB = new GeoBuilder();
  loftY({
    rings: [[-0.926, 0.0152], [-0.922, 0.0170], [-0.9, 0.0170], [-0.894, 0.0152]].map(([y, r]) => ({ y, rx: r, rz: r, cx: axis(y).x, cz: axis(y).z })),
    cols: 16, tile: 0.25,
  }, ringB);
  addMesh(g, ringB, boneMat('aged'), 'buttRing');

  // ---------- Перья, кисти, бусины ----------
  const feathers = new GeoBuilder();
  const fa: Array<{ a: number; beta: number; len: number; wid: number; curl: number; tw: number; mirror: boolean }> = [
    { a: 20, beta: 17, len: 0.235, wid: 0.048, curl: 0.045, tw: 0.25, mirror: false },
    { a: 112, beta: 26, len: 0.215, wid: 0.045, curl: 0.04, tw: -0.3, mirror: true },
    { a: 205, beta: 15, len: 0.24, wid: 0.05, curl: 0.05, tw: 0.2, mirror: false },
    { a: 292, beta: 23, len: 0.2, wid: 0.044, curl: 0.04, tw: -0.25, mirror: true },
    { a: 60, beta: 33, len: 0.13, wid: 0.032, curl: 0.03, tw: 0.4, mirror: true },
    { a: 250, beta: 35, len: 0.12, wid: 0.03, curl: 0.028, tw: -0.4, mirror: false },
  ];
  for (const f of fa) {
    const a = (f.a * Math.PI) / 180, b = (f.beta * Math.PI) / 180;
    const base = axis(0.806).add(V(Math.cos(a) * 0.0185, 0, Math.sin(a) * 0.0185));
    const dir = V(Math.sin(b) * Math.cos(a), -Math.cos(b), Math.sin(b) * Math.sin(a));
    const m = orient(dir, V(Math.cos(a), 0, Math.sin(a)), base);
    const fg = featherGeometry({ length: f.len, width: f.wid, curl: f.curl, cup: f.wid * 0.1, twist: f.tw, mirror: f.mirror });
    feathers.append(fg, m);
  }
  if (!raider) addMesh(g, feathers, featherMat('barred'), 'feathers');

  // кожаные кисти с костяными бусинами и жильные хвосты
  const thongs = new GeoBuilder();
  const beads = new GeoBuilder();
  const ts: Array<{ a: number; len: number; sway: number; beads: number[] }> = [
    { a: 60, len: 0.17, sway: 0.012, beads: [0.8, 1.0] },
    { a: 155, len: 0.15, sway: -0.01, beads: [0.92] },
    { a: 245, len: 0.2, sway: 0.014, beads: [0.55, 0.95] },
    { a: 330, len: 0.13, sway: -0.012, beads: [1.0] },
    { a: 100, len: 0.095, sway: 0.008, beads: [] },
  ];
  for (const t of ts) {
    const a = (t.a * Math.PI) / 180;
    const out = V(Math.cos(a), 0, Math.sin(a)), side = V(-Math.sin(a), 0, Math.cos(a));
    const p0 = axis(0.797).add(out.clone().multiplyScalar(0.019));
    const pts: V3[] = [];
    for (let i = 0; i <= 6; i++) {
      const s = i / 6;
      pts.push(p0.clone().addScaledVector(out, 0.012 * Math.sin(s * 2.2) + 0.006 * s).addScaledVector(side, t.sway * Math.sin(s * 3.0)).add(V(0, -t.len * s, 0)));
    }
    thong(thongs, pts, 0.0019, { taper: 0.45 });
    const curve = new THREE.CatmullRomCurve3(pts);
    for (const bf of t.beads) {
      const c = curve.getPoint(Math.min(1, bf));
      bead(beads, c, 0.0050, 0.9);
    }
  }
  if (!raider) {
    addMesh(g, thongs, cordMat('leather'), 'thongs');
    addMesh(g, beads, boneMat('ivory'), 'beads');
  }

  // ---------- Сокеты ----------
  addSocket(g, 'gripR', 0, 0, 0);
  addSocket(g, 'gripL', 0, SPEAR.gripL, 0);
  addSocket(g, 'tip', 0, SPEAR.tip, 0);
  addSocket(g, 'butt', 0, SPEAR.butt, 0);
  addSocket(g, 'hitbase', 0, SPEAR.hitbase, 0);
  g.userData.hitSegment = [V(0, 0.45, 0), V(0, SPEAR.tip, 0)];
  return finishGear(g, { length: SPEAR.tip - SPEAR.butt, axis: 'Y', origin: 'gripR', style });
}

export { brassMat };
