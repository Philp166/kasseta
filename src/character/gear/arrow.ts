// Стрела охотника: ясеневое древко, кованый листовидный наконечник (или костяной), обмотки жилой, оперение из трёх
// барредных перьев, костяной хвостовик. Начало координат — середина древка, остриё на +Y (так её ориентирует Projectiles).

import * as THREE from 'three';
import { GeoBuilder, V, tube, loftY } from './geom';
import { newGear, finishGear, addMesh } from './common';
import { woodMat, steelMat, boneMat, cordMat } from './materials';
import { featherGeometry, featherMat, FeatherKind } from './feather';

export const ARROW = { length: 0.78, butt: -0.39, tip: 0.39, headLen: 0.072, shaftR: 0.0042 };

export interface ArrowParts {
  shaft: GeoBuilder;
  head: GeoBuilder;
  nock: GeoBuilder;
  binding: GeoBuilder;
  vanes: GeoBuilder;
}

const flatLeaf = (y0: number, len: number, w: number, th: number, gb: GeoBuilder): GeoBuilder => {
  // листовидный наконечник: сплюснутый эллиптический лофт
  const rings = [
    [0, 0.0040, 0.0040], [0.10, 0.0075, 0.0030], [0.24, 0.0105, 0.0020], [0.42, 0.0098, 0.0017], [0.62, 0.0070, 0.0013],
    [0.82, 0.0034, 0.0009], [0.95, 0.0012, 0.0005], [1, 0.0001, 0.0001],
  ].map(([k, rx, rz]) => ({ y: y0 + k * len, rx: rx * (w / 0.0105), rz: rz * (th / 0.002) }));
  return loftY({ rings, cols: 12, tile: 0.1 }, gb);
};

/** Части стрелы (для слияния в одну геометрию при построении колчана). */
export function arrowParts(opts: { head?: 'iron' | 'bone'; vanes?: number; fletchLen?: number; light?: boolean } = {}): ArrowParts {
  const { shaftR: r, butt, tip, headLen } = ARROW;
  const shaft = new GeoBuilder(), head = new GeoBuilder(), nock = new GeoBuilder(), binding = new GeoBuilder(), vanes = new GeoBuilder();
  const yHead = tip - headLen;
  const lowSides = opts.light ? 5 : 7;
  // древко
  tube(new THREE.LineCurve3(V(0, butt + 0.012, 0), V(0, yHead + 0.01, 0)), { radius: r, sides: lowSides, segs: 6, tile: 0.5, vOffset: 0.2 }, shaft);
  // хвостовик: костяной «ушкин» с прорезью
  const nockRings = [
    [butt, 0.0030], [butt + 0.002, 0.0056], [butt + 0.006, 0.0050], [butt + 0.0085, 0.0034], [butt + 0.011, 0.0054], [butt + 0.016, 0.0048], [butt + 0.02, r],
  ].map(([y, rr]) => ({ y, rx: rr, rz: rr * 0.9 }));
  loftY({ rings: nockRings, cols: 8, tile: 0.1 }, nock);
  // наконечник
  if ((opts.head ?? 'iron') === 'iron') {
    flatLeaf(yHead, headLen, 0.0105, 0.0020, head);
    // втулка-«шейка» и жильная обмотка
    loftY({ rings: [[yHead - 0.012, r * 1.05], [yHead - 0.004, r * 1.35], [yHead + 0.008, 0.0042]].map(([y, rr]) => ({ y, rx: rr, rz: rr })), cols: 8, tile: 0.1 }, binding);
  } else {
    // костяной: трёхгранное острие
    loftY({ rings: [[yHead - 0.01, 0.0052], [yHead + 0.012, 0.0062], [yHead + 0.05, 0.0035], [tip, 0.0003]].map(([y, rr]) => ({ y, rx: rr, rz: rr })), cols: 6, tile: 0.1 }, head);
    loftY({ rings: [[yHead - 0.016, 0.0046], [yHead - 0.008, 0.0057], [yHead + 0.004, 0.005]].map(([y, rr]) => ({ y, rx: rr, rz: rr })), cols: 8, tile: 0.1 }, binding);
  }
  // обмотка под оперением
  const fl = opts.fletchLen ?? 0.1;
  const yf0 = butt + 0.026;
  for (const yy of [yf0 - 0.004, yf0 + fl + 0.002]) {
    loftY({ rings: [[yy - 0.004, r * 1.1], [yy, r * 1.45], [yy + 0.004, r * 1.1]].map(([y, rr]) => ({ y, rx: rr, rz: rr })), cols: 7, tile: 0.1 }, binding);
  }
  // оперение: n перьев, повёрнуты по спирали
  const n = opts.vanes ?? 3;
  for (let k = 0; k < n; k++) {
    const a = (k / n) * Math.PI * 2 + 0.3;
    const radial = V(Math.cos(a), 0, Math.sin(a));
    const fg = featherGeometry({ length: fl, width: 0.0185, curl: 0.0035, cup: 0.0012, twist: 0.12, mirror: k % 2 === 1, rows: 8, cols: 4 });
    // перо лежит в плоскости XY, ширина по X → ширина вдоль radial; Z — по касательной
    const x = radial.clone();
    const z = V(-Math.sin(a), 0, Math.cos(a));
    const m = new THREE.Matrix4().makeBasis(x, V(0, 1, 0), z).setPosition(radial.clone().multiplyScalar(r + 0.0092).setY(yf0));
    vanes.append(fg, m);
  }
  return { shaft, head, nock, binding, vanes };
}

export type ArrowKind = 'hunter' | 'raider';

/** Готовая стрела (Group): древко, наконечник, оперение. */
export function buildArrow(kind: ArrowKind = 'hunter'): THREE.Group {
  const g = newGear('Arrow');
  const p = arrowParts({ head: kind === 'raider' ? 'iron' : 'iron' });
  addMesh(g, p.shaft, woodMat('ash'), 'shaft');
  addMesh(g, p.head, steelMat('iron'), 'head');
  addMesh(g, p.nock, boneMat('ivory'), 'nock');
  addMesh(g, p.binding, cordMat('sinew'), 'binding');
  addMesh(g, p.vanes, featherMat(kind === 'raider' ? 'dark' : 'barred'), 'vanes');
  finishGear(g, { length: ARROW.length, axis: 'Y', origin: 'center' });
  // стрела мелкая: тень от неё дорогая и незаметная
  g.traverse((o) => { o.castShadow = false; });
  return g;
}
