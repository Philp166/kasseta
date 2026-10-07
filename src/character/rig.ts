// Скелет персонажа. Один набор костей на всех (игрок и враги): клипы анимации переиспользуются.
// Соглашения: метры, Y вверх, персонаж смотрит в +Z, ЛЕВАЯ сторона = +X.
// Поза покоя — руки опущены (A-поза), у всех костей единичный поворот, только смещения.
// Это упрощает анимацию: любой клип = «поворот относительно покоя».

import * as THREE from 'three';
import { FINGER_BONE_SPECS } from './human/fingers';

export interface BoneSpec {
  name: string;
  parent: string | null;
  /** Мировая позиция в позе покоя. */
  pos: [number, number, number];
}

const v3 = (x: number, y: number, z: number): [number, number, number] => [x, y, z];

/** Основные кости (левая = +X). */
function core(): BoneSpec[] {
  const L = (n: string) => n + 'L';
  const R = (n: string) => n + 'R';
  const out: BoneSpec[] = [
    { name: 'root', parent: null, pos: v3(0, 0, 0) },
    { name: 'hips', parent: 'root', pos: v3(0, 0.95, 0) },
    { name: 'spine', parent: 'hips', pos: v3(0, 1.07, 0) },
    { name: 'chest', parent: 'spine', pos: v3(0, 1.23, 0) },
    { name: 'neck', parent: 'chest', pos: v3(0, 1.47, 0.005) },
    { name: 'head', parent: 'neck', pos: v3(0, 1.58, 0.0) },
  ];
  for (const [sx, nm] of [[1, L], [-1, R]] as const) {
    out.push(
      { name: nm('shoulder'), parent: 'chest', pos: v3(sx * 0.045, 1.43, 0) },
      { name: nm('upperArm'), parent: nm('shoulder'), pos: v3(sx * 0.205, 1.425, 0) },
      { name: nm('lowerArm'), parent: nm('upperArm'), pos: v3(sx * 0.225, 1.125, 0) },
      { name: nm('hand'), parent: nm('lowerArm'), pos: v3(sx * 0.235, 0.855, 0) },
      { name: nm('upperLeg'), parent: 'hips', pos: v3(sx * 0.095, 0.93, 0) },
      { name: nm('lowerLeg'), parent: nm('upperLeg'), pos: v3(sx * 0.1, 0.5, 0.0) },
      { name: nm('foot'), parent: nm('lowerLeg'), pos: v3(sx * 0.1, 0.095, 0.0) },
      { name: nm('toe'), parent: nm('foot'), pos: v3(sx * 0.1, 0.045, 0.115) },
    );
  }
  return out;
}

/** Цепочка вторичных костей: name_1, name_2 ... каждая — потомок предыдущей. */
function chain(prefix: string, parent: string, pts: [number, number, number][]): BoneSpec[] {
  return pts.map((p, i) => ({ name: `${prefix}_${i + 1}`, parent: i === 0 ? parent : `${prefix}_${i}`, pos: p }));
}

// Форма кафтана — общая для скелета (цепочки подола) и меша (см. outfit).
export const COAT = {
  waistY: 1.04,
  hemY: 0.54,
  radiusAt(y: number): { rx: number; rz: number; cz: number } {
    // от талии (y≈1.04) к подолу (y≈0.54) кафтан раскрывается колоколом
    const t = THREE.MathUtils.clamp((1.04 - y) / (1.04 - 0.54), 0, 1);
    const e = t * t * 0.55 + t * 0.45;
    return { rx: 0.186 + 0.12 * e, rz: 0.134 + 0.1 * e, cz: 0.041 * (1 - t) - 0.01 * t };
  },
};

function skirtChains(): BoneSpec[] {
  const out: BoneSpec[] = [];
  const levels = [0.99, 0.77, 0.56];
  const angles: [string, number][] = [['F', 28], ['S', 92], ['B', 152]];
  for (const [side, sx] of [['L', 1], ['R', -1]] as const) {
    for (const [tag, deg] of angles) {
      const th = (deg * Math.PI) / 180;
      const pts = levels.map((y) => {
        const r = COAT.radiusAt(y);
        const k = y > 0.95 ? 0.85 : 0.95;
        return v3(sx * Math.sin(th) * r.rx * k, y, r.cz + Math.cos(th) * r.rz * k);
      });
      out.push(...chain(`skirt${tag}${side}`, 'hips', pts));
    }
  }
  return out;
}

function secondary(): BoneSpec[] {
  const out: BoneSpec[] = [];
  // Волосы: длинные тёмные пряди из-под капюшона. Две передние (на грудь) и три задние.
  out.push(...chain('hairFL', 'head', [v3(0.074, 1.655, 0.0), v3(0.082, 1.545, 0.03), v3(0.088, 1.43, 0.06), v3(0.09, 1.33, 0.085)]));
  out.push(...chain('hairFR', 'head', [v3(-0.074, 1.655, 0.0), v3(-0.082, 1.545, 0.03), v3(-0.088, 1.43, 0.06), v3(-0.09, 1.33, 0.085)]));
  out.push(...chain('hairBL', 'head', [v3(0.05, 1.63, -0.085), v3(0.06, 1.52, -0.115), v3(0.065, 1.4, -0.14), v3(0.065, 1.29, -0.15)]));
  out.push(...chain('hairBM', 'head', [v3(0.0, 1.63, -0.09), v3(0.0, 1.52, -0.122), v3(0.0, 1.4, -0.148), v3(0.0, 1.28, -0.158)]));
  out.push(...chain('hairBR', 'head', [v3(-0.05, 1.63, -0.085), v3(-0.06, 1.52, -0.115), v3(-0.065, 1.4, -0.14), v3(-0.065, 1.29, -0.15)]));
  // Хвост шкуры и боковые меховые клапаны накидки.
  out.push(...chain('pelt', 'chest', [v3(0, 1.40, -0.165), v3(0, 1.22, -0.215), v3(0, 1.05, -0.235), v3(0, 0.90, -0.235)]));
  out.push(...chain('peltL', 'chest', [v3(0.255, 1.43, -0.05), v3(0.29, 1.32, -0.075), v3(0.30, 1.22, -0.09)]));
  out.push(...chain('peltR', 'chest', [v3(-0.255, 1.43, -0.05), v3(-0.29, 1.32, -0.075), v3(-0.30, 1.22, -0.09)]));
  // Уши волчьей головы.
  out.push({ name: 'earL', parent: 'head', pos: v3(0.07, 1.865, -0.035) });
  out.push({ name: 'earR', parent: 'head', pos: v3(-0.07, 1.865, -0.035) });
  // Подол кафтана.
  out.push(...skirtChains());
  // Обереги: медальон, клыки, перья на поясе.
  out.push(...chain('medal', 'chest', [v3(0, 1.345, 0.135), v3(0, 1.275, 0.155)]));
  out.push(...chain('fangL', 'chest', [v3(0.05, 1.355, 0.125), v3(0.056, 1.29, 0.145)]));
  out.push(...chain('fangR', 'chest', [v3(-0.05, 1.355, 0.125), v3(-0.056, 1.29, 0.145)]));
  out.push(...chain('featherBeltL', 'hips', [v3(0.205, 1.03, 0.11), v3(0.225, 0.93, 0.125), v3(0.235, 0.83, 0.13)]));
  out.push(...chain('strapR', 'hips', [v3(-0.20, 1.03, 0.115), v3(-0.215, 0.93, 0.13), v3(-0.222, 0.84, 0.135)]));
  return out;
}

export const BONE_SPECS: BoneSpec[] = [...core(), ...secondary(), ...FINGER_BONE_SPECS];

/** Кости, которые двигает пружинная физика (а не анимация). */
export const SECONDARY_PREFIXES = ['hair', 'pelt', 'ear', 'skirt', 'medal', 'fang', 'featherBelt', 'strap'];

/** Пальцы: thumb1L … pinky3R. */
export const isFingerBone = (n: string): boolean => /^(thumb|index|middle|ring|pinky)[123][LR]$/.test(n);

export class Rig {
  readonly bones = new Map<string, THREE.Bone>();
  readonly list: THREE.Bone[] = [];
  readonly specs = new Map<string, BoneSpec>();
  readonly index = new Map<string, number>();
  readonly root: THREE.Bone;
  readonly skeleton: THREE.Skeleton;
  /** Родитель-хранилище на время расчёта обратных матриц покоя. */
  private holder = new THREE.Group();

  constructor() {
    for (const s of BONE_SPECS) {
      const b = new THREE.Bone();
      b.name = s.name;
      this.bones.set(s.name, b);
      this.specs.set(s.name, s);
      this.index.set(s.name, this.list.length);
      this.list.push(b);
    }
    for (const s of BONE_SPECS) {
      const b = this.bones.get(s.name)!;
      if (s.parent) {
        const p = this.specs.get(s.parent)!;
        this.bones.get(s.parent)!.add(b);
        b.position.set(s.pos[0] - p.pos[0], s.pos[1] - p.pos[1], s.pos[2] - p.pos[2]);
      } else {
        b.position.set(...s.pos);
      }
    }
    this.root = this.bones.get('root')!;
    this.holder.add(this.root);
    this.holder.updateMatrixWorld(true);
    this.skeleton = new THREE.Skeleton(this.list);
  }

  b(name: string): THREE.Bone {
    const b = this.bones.get(name);
    if (!b) throw new Error(`Нет кости ${name}`);
    return b;
  }

  idx(name: string): number {
    const i = this.index.get(name);
    if (i === undefined) throw new Error(`Нет кости ${name}`);
    return i;
  }

  /** Мировая позиция кости в позе покоя. */
  rest(name: string): THREE.Vector3 {
    const s = this.specs.get(name);
    if (!s) throw new Error(`Нет кости ${name}`);
    return new THREE.Vector3(...s.pos);
  }

  /** Вернуть все кости в позу покоя (поворот единичный). */
  resetPose(): void {
    for (const s of BONE_SPECS) {
      const b = this.bones.get(s.name)!;
      b.quaternion.identity();
      b.scale.set(1, 1, 1);
      if (s.parent) {
        const p = this.specs.get(s.parent)!;
        b.position.set(s.pos[0] - p.pos[0], s.pos[1] - p.pos[1], s.pos[2] - p.pos[2]);
      } else b.position.set(...s.pos);
    }
  }

  /** Длина сегмента кость→потомок в покое (для IK). */
  length(from: string, to: string): number {
    return this.rest(from).distanceTo(this.rest(to));
  }
}

/** Кости, образующие цепочки пружин: [родитель-цепочки, [кости...]] для настройки физики. */
export function chainsByPrefix(prefix: string): string[][] {
  const chains = new Map<string, string[]>();
  for (const s of BONE_SPECS) {
    if (!s.name.startsWith(prefix)) continue;
    const m = s.name.match(/^(.*)_(\d+)$/);
    if (!m) continue;
    const arr = chains.get(m[1]) ?? [];
    arr.push(s.name);
    chains.set(m[1], arr);
  }
  return [...chains.values()];
}
