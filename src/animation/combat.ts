// Боевые клипы: копьё (выпад, взмах, тяжёлый удар, блок), перекат, лук.
// Задаются ключами каналов: хват и ось древка, направляющая левой руки, смещение таза, повороты корпуса, положение стоп.
// Стопы ставятся IK на землю, руки — IK по хвату древка. Время ключей — нормализованное (0..1).

import * as THREE from 'three';
import { FramePose, IKTarget, Key, K, V3, evalKeys } from './pose';
import { twoHandGrip, oneHandGrip, V } from './grips';
import { DEG } from '../core/util';

const Y_AXIS = new THREE.Vector3(0, 1, 0);

export interface Channels {
  gripR: Key[];       // точка хвата правой руки
  axis: Key[];        // направление к острию
  guideL: Key[];      // направляющая левой руки (проецируется на древко)
  roll?: Key[];       // поворот древка, град
  rollR?: Key[];
  rollL?: Key[];
  hips: Key[];        // смещение таза (м)
  hipsRot: Key[];     // град
  spine: Key[];
  chest: Key[];
  neck: Key[];
  head: Key[];
  footL: Key[];       // позиция лодыжки (м) и поворот по yaw (град) → [x,y,z,yaw]
  footR: Key[];
  shoulderL?: Key[];
  shoulderR?: Key[];
  poleR?: V3;
  poleL?: V3;
}

const v3 = (k: Key[], u: number): V3 => evalKeys(k, u).slice(0, 3) as V3;

function footTarget(side: 'L' | 'R', k: Key[], u: number): IKTarget {
  const a = evalKeys(k, u);
  const q = new THREE.Quaternion().setFromAxisAngle(Y_AXIS, (a[3] ?? 0) * DEG);
  return { limb: side === 'L' ? 'legL' : 'legR', pos: new THREE.Vector3(a[0], a[1], a[2]), quat: q };
}

export function channelPose(c: Channels, u: number): FramePose {
  const rot: Record<string, V3> = {
    hips: v3(c.hipsRot, u),
    spine: v3(c.spine, u),
    chest: v3(c.chest, u),
    neck: v3(c.neck, u),
    head: v3(c.head, u),
  };
  if (c.shoulderL) rot.shoulderL = v3(c.shoulderL, u);
  if (c.shoulderR) rot.shoulderR = v3(c.shoulderR, u);
  const gripR = new THREE.Vector3(...v3(c.gripR, u));
  const axis = new THREE.Vector3(...v3(c.axis, u));
  const guide = new THREE.Vector3(...v3(c.guideL, u));
  const g = twoHandGrip({
    gripR, axis, left: guide,
    roll: c.roll ? evalKeys(c.roll, u)[0] : 0,
    rollR: c.rollR ? evalKeys(c.rollR, u)[0] : 0,
    rollL: c.rollL ? evalKeys(c.rollL, u)[0] : 180,
    poleR: c.poleR ? new THREE.Vector3(...c.poleR) : new THREE.Vector3(-0.6, -0.5, -0.8),
    poleL: c.poleL ? new THREE.Vector3(...c.poleL) : new THREE.Vector3(0.6, -0.5, -0.8),
  });
  return {
    rot,
    hips: v3(c.hips, u),
    ik: [...g.targets, footTarget('L', c.footL, u), footTarget('R', c.footR, u)],
  };
}

const A = 0.095; // высота лодыжки над землёй

// ---------- Стойка ----------
const STANCE = {
  footL: [0.15, A, 0.32, 8], footR: [-0.16, A, -0.18, -12],
};

export function readyKeys(): Channels {
  const s = STANCE;
  return {
    gripR: [K(0, [-0.13, 1.04, 0.18])],
    axis: [K(0, [0.12, 0.26, 0.96])],
    guideL: [K(0, [0.1, 1.24, 0.52])],
    hips: [K(0, [0, -0.09, 0.0]), K(0.5, [0.005, -0.1, 0.005]), K(1, [0, -0.09, 0])],
    hipsRot: [K(0, [0, -18, 0])],
    spine: [K(0, [6, -8, 0])],
    chest: [K(0, [3, -6, 0]), K(0.5, [3.8, -6, 0]), K(1, [3, -6, 0])],
    neck: [K(0, [-3, 6, 0])],
    head: [K(0, [-4, 18, 0])],
    footL: [K(0, s.footL)],
    footR: [K(0, s.footR)],
  };
}

/** Прямой выпад копьём. */
export function thrustKeys(): Channels {
  const s = STANCE;
  return {
    gripR: [
      K(0, [-0.13, 1.04, 0.18], 'out'), K(0.24, [-0.17, 1.06, 0.0], 'in'), K(0.36, [-0.02, 1.15, 0.5]),
      K(0.5, [0.0, 1.16, 0.55], 'smooth'), K(0.74, [-0.13, 1.04, 0.18]), K(1, [-0.13, 1.04, 0.18]),
    ],
    axis: [
      K(0, [0.12, 0.26, 0.96]), K(0.24, [0.14, 0.34, 0.93]), K(0.36, [0.05, 0.14, 0.99]),
      K(0.5, [0.05, 0.14, 0.99]), K(0.74, [0.12, 0.26, 0.96]), K(1, [0.12, 0.26, 0.96]),
    ],
    guideL: [
      K(0, [0.1, 1.24, 0.52]), K(0.24, [0.1, 1.24, 0.4]), K(0.36, [0.1, 1.22, 0.62]),
      K(0.5, [0.1, 1.22, 0.64]), K(0.74, [0.1, 1.24, 0.52]), K(1, [0.1, 1.24, 0.52]),
    ],
    hips: [
      K(0, [0, -0.09, 0]), K(0.24, [0, -0.11, -0.08]), K(0.36, [0, -0.15, 0.2]), K(0.5, [0, -0.15, 0.22]),
      K(0.74, [0, -0.09, 0]), K(1, [0, -0.09, 0]),
    ],
    hipsRot: [K(0, [0, -18, 0]), K(0.24, [0, -30, 0]), K(0.36, [0, -2, 0]), K(0.5, [0, -2, 0]), K(0.74, [0, -18, 0]), K(1, [0, -18, 0])],
    spine: [K(0, [6, -8, 0]), K(0.24, [3, -16, 0]), K(0.36, [15, 6, 0]), K(0.5, [15, 6, 0]), K(0.74, [6, -8, 0]), K(1, [6, -8, 0])],
    chest: [K(0, [3, -6, 0]), K(0.24, [2, -12, 0]), K(0.36, [8, 6, 0]), K(0.5, [8, 6, 0]), K(0.74, [3, -6, 0]), K(1, [3, -6, 0])],
    neck: [K(0, [-3, 6, 0]), K(0.36, [-8, 6, 0]), K(1, [-3, 6, 0])],
    head: [K(0, [-4, 18, 0]), K(0.24, [-2, 26, 0]), K(0.36, [-6, 6, 0]), K(0.5, [-6, 6, 0]), K(1, [-4, 18, 0])],
    footL: [K(0, s.footL), K(0.24, [0.15, A, 0.3, 8]), K(0.36, [0.15, A, 0.58, 8], 'out'), K(0.55, [0.15, A, 0.58, 8]), K(0.8, s.footL), K(1, s.footL)],
    footR: [K(0, s.footR), K(0.24, [-0.16, A, -0.2, -12]), K(0.36, [-0.18, A, -0.26, -14]), K(0.55, [-0.18, A, -0.26, -14]), K(0.8, s.footR), K(1, s.footR)],
  };
}

/** Широкий горизонтальный взмах справа налево. */
export function sweepKeys(): Channels {
  const s = STANCE;
  const ax = (aDeg: number, y = 0.12): number[] => [Math.sin(aDeg * DEG), y, Math.cos(aDeg * DEG)];
  return {
    gripR: [
      K(0, [-0.13, 1.04, 0.18]), K(0.3, [-0.34, 1.08, -0.06], 'in'), K(0.46, [-0.06, 1.12, 0.3]),
      K(0.58, [0.14, 1.14, 0.36], 'out'), K(0.84, [-0.13, 1.04, 0.18]), K(1, [-0.13, 1.04, 0.18]),
    ],
    axis: [K(0, [0.12, 0.26, 0.96]), K(0.3, ax(-105)), K(0.46, ax(-10)), K(0.58, ax(70)), K(0.84, [0.12, 0.26, 0.96]), K(1, [0.12, 0.26, 0.96])],
    guideL: [
      K(0, [0.1, 1.24, 0.52]), K(0.3, [-0.2, 1.2, -0.2]), K(0.46, [0.04, 1.2, 0.5]), K(0.58, [0.45, 1.2, 0.3]),
      K(0.84, [0.1, 1.24, 0.52]), K(1, [0.1, 1.24, 0.52]),
    ],
    hips: [K(0, [0, -0.09, 0]), K(0.3, [-0.02, -0.12, -0.04]), K(0.5, [0.02, -0.14, 0.1]), K(0.84, [0, -0.09, 0]), K(1, [0, -0.09, 0])],
    hipsRot: [K(0, [0, -18, 0]), K(0.3, [0, -52, 0]), K(0.58, [0, 38, 0]), K(0.84, [0, -18, 0]), K(1, [0, -18, 0])],
    spine: [K(0, [6, -8, 0]), K(0.3, [8, -22, 0]), K(0.58, [10, 22, 0]), K(0.84, [6, -8, 0]), K(1, [6, -8, 0])],
    chest: [K(0, [3, -6, 0]), K(0.3, [4, -18, 0]), K(0.58, [6, 20, 0]), K(0.84, [3, -6, 0]), K(1, [3, -6, 0])],
    neck: [K(0, [-3, 6, 0]), K(0.3, [-4, 26, 0]), K(0.58, [-4, -20, 0]), K(1, [-3, 6, 0])],
    head: [K(0, [-4, 18, 0]), K(0.3, [-3, 40, 0]), K(0.58, [-3, -22, 0]), K(1, [-4, 18, 0])],
    footL: [K(0, s.footL), K(0.3, [0.2, A, 0.24, 30]), K(0.58, [0.22, A, 0.42, 12]), K(0.9, s.footL), K(1, s.footL)],
    footR: [K(0, s.footR), K(0.3, [-0.2, A, -0.2, -20]), K(0.58, [-0.18, A, -0.22, -10]), K(0.9, s.footR), K(1, s.footR)],
    roll: [K(0, [0])],
  };
}

/** Тяжёлый удар сверху с шагом. */
export function heavyKeys(): Channels {
  const s = STANCE;
  return {
    gripR: [
      K(0, [-0.13, 1.04, 0.18]), K(0.38, [-0.1, 1.68, -0.08], 'in3'), K(0.5, [-0.04, 1.3, 0.46], 'out'),
      K(0.62, [-0.02, 1.16, 0.58]), K(0.9, [-0.13, 1.04, 0.18]), K(1, [-0.13, 1.04, 0.18]),
    ],
    axis: [
      K(0, [0.12, 0.26, 0.96]), K(0.38, [0.04, 0.55, -0.83]), K(0.5, [0.04, -0.12, 0.99]),
      K(0.62, [0.04, -0.28, 0.96]), K(0.9, [0.12, 0.26, 0.96]), K(1, [0.12, 0.26, 0.96]),
    ],
    guideL: [
      K(0, [0.1, 1.24, 0.52]), K(0.38, [0.12, 1.58, 0.15]), K(0.5, [0.1, 1.3, 0.6]), K(0.62, [0.1, 1.2, 0.68]),
      K(0.9, [0.1, 1.24, 0.52]), K(1, [0.1, 1.24, 0.52]),
    ],
    hips: [K(0, [0, -0.09, 0]), K(0.38, [0, -0.06, -0.1]), K(0.5, [0, -0.2, 0.22]), K(0.62, [0, -0.2, 0.26]), K(0.9, [0, -0.09, 0]), K(1, [0, -0.09, 0])],
    hipsRot: [K(0, [0, -18, 0]), K(0.38, [0, -26, 0]), K(0.5, [0, 4, 0]), K(0.9, [0, -18, 0]), K(1, [0, -18, 0])],
    spine: [K(0, [6, -8, 0]), K(0.38, [-8, -10, 0]), K(0.5, [24, 4, 0]), K(0.62, [26, 4, 0]), K(0.9, [6, -8, 0]), K(1, [6, -8, 0])],
    chest: [K(0, [3, -6, 0]), K(0.38, [-10, -8, 0]), K(0.5, [16, 4, 0]), K(0.62, [18, 4, 0]), K(1, [3, -6, 0])],
    neck: [K(0, [-3, 6, 0]), K(0.38, [6, 4, 0]), K(0.5, [-14, 4, 0]), K(1, [-3, 6, 0])],
    head: [K(0, [-4, 18, 0]), K(0.38, [2, 12, 0]), K(0.5, [-10, 4, 0]), K(1, [-4, 18, 0])],
    footL: [K(0, s.footL), K(0.38, [0.15, A, 0.28, 8]), K(0.5, [0.15, A, 0.64, 8], 'out'), K(0.68, [0.15, A, 0.64, 8]), K(0.94, s.footL), K(1, s.footL)],
    footR: [K(0, s.footR), K(0.5, [-0.18, A, -0.28, -14]), K(0.68, [-0.18, A, -0.28, -14]), K(0.94, s.footR), K(1, s.footR)],
  };
}

/** Блок: древко горизонтально перед корпусом. */
export function blockKeys(): Channels {
  return {
    gripR: [K(0, [-0.3, 1.3, 0.3]), K(0.5, [-0.3, 1.31, 0.3]), K(1, [-0.3, 1.3, 0.3])],
    axis: [K(0, [0.97, 0.16, 0.18])],
    guideL: [K(0, [0.28, 1.36, 0.3])],
    roll: [K(0, [0])],
    rollR: [K(0, [90])],
    rollL: [K(0, [-90])],
    hips: [K(0, [0, -0.11, 0.02]), K(0.5, [0.004, -0.115, 0.02]), K(1, [0, -0.11, 0.02])],
    hipsRot: [K(0, [0, -8, 0])],
    spine: [K(0, [10, -4, 0])],
    chest: [K(0, [5, -2, 0]), K(0.5, [6, -2, 0]), K(1, [5, -2, 0])],
    neck: [K(0, [-6, 2, 0])],
    head: [K(0, [-8, 6, 0])],
    footL: [K(0, [0.17, A, 0.22, 10])],
    footR: [K(0, [-0.17, A, -0.1, -10])],
    poleR: [-0.4, -0.6, -0.7],
    poleL: [0.4, -0.6, -0.7],
  };
}

// ---------- Лук ----------

export interface BowParams { draw: number }

/**
 * Поза натяжения лука: левая рука держит лук вдоль линии прицеливания, правая тянет тетиву к щеке.
 * draw 0..1; линия цели — вдоль +Z на высоте 1.56 м, чуть правее оси головы.
 */
export function bowPose(draw: number, opts: { recoil?: number } = {}): FramePose {
  const rec = opts.recoil ?? 0;
  const lineX = -0.06, lineY = 1.55;
  const grip = new THREE.Vector3(lineX + 0.0, lineY - 0.03 - 0.02 * rec, 0.6);
  // положение руки на тетиве: от «холостого» (перед рукоятью) до щеки
  const nockRest = new THREE.Vector3(lineX, lineY, 0.6 - 0.17);
  const anchor = new THREE.Vector3(lineX + 0.005, lineY + 0.03, 0.045);
  const e = draw * draw * (3 - 2 * draw);
  const nock = nockRest.clone().lerp(anchor, e);
  nock.z -= 0.04 * rec;
  const bowAxis = new THREE.Vector3(0.0, 1, 0.04);
  const l = oneHandGrip('L', grip, bowAxis, 0, 0, V(0.7, 0.2, -0.5));
  // правая кисть: «крючок» тетивы — ориентируем кисть кулаком к цели; осью хвата служит направление тетивы (вертикаль)
  const r = oneHandGrip('R', nock, new THREE.Vector3(0, 1, 0), 0, 0, V(-0.2, 0.15, -1));
  const rot: Record<string, V3> = {
    hips: [0, -24, 0], spine: [2, -12, 0], chest: [1, -14, 0], neck: [-2, 36, 0], head: [-1, 24, 0],
    shoulderL: [0, 0, 0], shoulderR: [0, 0, 0],
  };
  return {
    rot,
    hips: [0, -0.07, 0.0],
    ik: [
      l.target, r.target,
      { limb: 'legL', pos: new THREE.Vector3(0.16, A, 0.2), quat: new THREE.Quaternion().setFromAxisAngle(Y_AXIS, 10 * DEG) },
      { limb: 'legR', pos: new THREE.Vector3(-0.2, A, -0.12), quat: new THREE.Quaternion().setFromAxisAngle(Y_AXIS, -35 * DEG) },
    ],
  };
}

// ---------- Перекат ----------

/** Кувырок вперёд: поворот корня вокруг таза на 360°, группировка. */
export function rollPose(u: number): FramePose {
  const tuck = Math.sin(Math.min(1, u * 1.1) * Math.PI);
  const ang = (u < 0.08 ? 0 : u > 0.92 ? 360 : ((u - 0.08) / 0.84) * 360) * 1;
  const pivot = new THREE.Vector3(0, 0.88, 0.04);
  const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), ang * DEG);
  const rp = pivot.clone().applyQuaternion(q);
  const pos = pivot.clone().sub(rp);
  // перед стартом и в конце — низкая стойка
  const t = tuck;
  return {
    root: { pos: [pos.x, pos.y - 0.12 * t, pos.z], rot: [ang, 0, 0] },
    rot: {
      hips: [0, 0, 0],
      spine: [34 * t, 0, 0], chest: [22 * t, 0, 0], neck: [18 * t, 0, 0], head: [10 * t, 0, 0],
      upperLegL: [-95 * t, 0, -4], upperLegR: [-95 * t, 0, 4],
      lowerLegL: [125 * t, 0, 0], lowerLegR: [125 * t, 0, 0],
      footL: [20 * t, 0, 0], footR: [20 * t, 0, 0],
      upperArmL: [-52 * t, 0, 14], upperArmR: [-52 * t, 0, -14],
      lowerArmL: [-100 * t, 0, 0], lowerArmR: [-100 * t, 0, 0],
    },
    ground: false,
  };
}

export const _combatDeg = DEG;
