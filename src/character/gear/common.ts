// Общие помощники сборки предметов: группа с сокетами, подсчёт треугольников, шнурки/бусины.

import * as THREE from 'three';
import { GeoBuilder, V, V3, tube, ellipsoid, countTriangles } from './geom';

export interface GearInfo {
  name: string;
  /** Число треугольников (на момент сборки). */
  tris: number;
  /** Габариты по оси предмета и пр. — см. описание билдера. */
  [k: string]: unknown;
}

/** Создать группу предмета с userData.sockets = {}. */
export function newGear(name: string): THREE.Group {
  const g = new THREE.Group();
  g.name = name;
  g.userData.sockets = {} as Record<string, THREE.Object3D>;
  return g;
}

/** Добавить именованный сокет-маркер (Object3D) в группу и в userData.sockets. */
export function addSocket(g: THREE.Object3D, name: string, x = 0, y = 0, z = 0, parent: THREE.Object3D = g): THREE.Object3D {
  const o = new THREE.Object3D();
  o.name = name;
  o.position.set(x, y, z);
  parent.add(o);
  (g.userData.sockets as Record<string, THREE.Object3D>)[name] = o;
  return o;
}

/** Завершить сборку: тени у всех мешей, userData.info. */
export function finishGear(g: THREE.Group, extra: Record<string, unknown> = {}): THREE.Group {
  g.traverse((o) => {
    const m = o as THREE.Mesh;
    if (m.isMesh) { m.castShadow = true; m.receiveShadow = true; }
  });
  g.userData.info = { name: g.name, tris: countTriangles(g), ...extra } as GearInfo;
  return g;
}

/** Добавить меш из построителя в группу (если в нём есть вершины). */
export function addMesh(g: THREE.Object3D, gb: GeoBuilder, mat: THREE.Material, name = ''): THREE.Mesh | null {
  if (gb.vertexCount === 0) return null;
  const m = gb.mesh(mat, name);
  g.add(m);
  return m;
}

/** Бусина-эллипсоид. */
export function bead(gb: GeoBuilder, c: V3, r: number, squash = 1, rot?: THREE.Euler): GeoBuilder {
  return ellipsoid(c, r, r * squash, r, { rows: 5, cols: 8, rot }, gb);
}

/** Шнурок/жила вдоль точек (с сужением к концу). */
export function thong(gb: GeoBuilder, pts: V3[], r: number, o: { taper?: number; sides?: number; tile?: number; caps?: boolean } = {}): GeoBuilder {
  const curve = new THREE.CatmullRomCurve3(pts, false, 'centripetal');
  const taper = o.taper ?? 0.5;
  return tube(curve, {
    radius: (t) => r * (1 - taper * t),
    sides: o.sides ?? 5,
    segs: Math.max(4, Math.ceil(curve.getLength() / 0.012)),
    caps: o.caps === false ? 'none' : 'round',
    capRings: 2,
    tile: o.tile ?? 0.06,
  }, gb);
}

/** Матрица из базиса (x, y, z) и позиции. */
export function basisMatrix(x: V3, y: V3, z: V3, p: V3 = V()): THREE.Matrix4 {
  return new THREE.Matrix4().makeBasis(x, y, z).setPosition(p);
}

/**
 * Матрица, переводящая ось +Y локальной системы в направление dir, а +Z — как можно ближе к outHint.
 */
export function orient(dir: V3, outHint: V3, p: V3 = V()): THREE.Matrix4 {
  const y = dir.clone().normalize();
  const z = outHint.clone().addScaledVector(y, -outHint.dot(y)).normalize();
  const x = new THREE.Vector3().crossVectors(y, z).normalize();
  const z2 = new THREE.Vector3().crossVectors(x, y).normalize();
  return basisMatrix(x, y, z2, p);
}

/** Плавная ступенька. */
export const sstep = (a: number, b: number, x: number): number => {
  const t = x <= a ? 0 : x >= b ? 1 : (x - a) / (b - a);
  return t * t * (3 - 2 * t);
};
