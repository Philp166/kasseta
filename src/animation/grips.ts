// Хваты: из положения древка (точка хвата, ось, поворот) получаем цели запястий для IK.
// Кисть в «позе хвата»: её локальная ось Z — вдоль древка (так построен кулак), центр ладони — смещение HAND_GRIP.

import * as THREE from 'three';
import { IKTarget, shaftQuat } from './pose';
import { DEG } from '../core/util';

/** Центр ладони в системе кисти (где проходит ось хвата). Для нового тела с пальцами значение уточняется. */
export const HAND_GRIP = {
  L: new THREE.Vector3(-0.01, -0.105, 0),
  R: new THREE.Vector3(0.01, -0.105, 0),
};

/** Кисть → древко: R_x(+90°) переводит ось древка (+Y) в локальную Z кисти. */
const HAND_FROM_SHAFT = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), -90 * DEG);

export interface TwoHandGrip {
  /** Точка хвата правой руки (центр ладони), мировая система корня. */
  gripR: THREE.Vector3;
  /** Направление от хвата к острию. */
  axis: THREE.Vector3;
  /** Поворот древка вокруг своей оси (определяет ориентацию лезвия), град. */
  roll?: number;
  /** Дополнительный поворот правой/левой кисти вокруг оси хвата, град. */
  rollR?: number;
  rollL?: number;
  /** Левая рука: расстояние вдоль древка от правой (м) или точка-«направляющая», на которую проецируется хват. */
  left?: number | THREE.Vector3 | null;
  poleR?: THREE.Vector3;
  poleL?: THREE.Vector3;
}

export interface GripResult {
  targets: IKTarget[];
  shaftQ: THREE.Quaternion;
  /** Положение древка (хват правой) и ось — для проверок и позиционирования оружия. */
  gripL?: THREE.Vector3;
}

function wristFor(side: 'L' | 'R', grip: THREE.Vector3, qHand: THREE.Quaternion): THREE.Vector3 {
  return grip.clone().sub(HAND_GRIP[side].clone().applyQuaternion(qHand));
}

export function twoHandGrip(g: TwoHandGrip): GripResult {
  const axis = g.axis.clone().normalize();
  const shaftQ = shaftQuat(axis, g.roll ?? 0);
  const targets: IKTarget[] = [];
  const qR = shaftQ.clone().multiply(HAND_FROM_SHAFT).multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), (g.rollR ?? 0) * DEG));
  targets.push({ limb: 'armR', pos: wristFor('R', g.gripR, qR), quat: qR, pole: g.poleR });
  let gripL: THREE.Vector3 | undefined;
  if (g.left !== null && g.left !== undefined) {
    let s: number;
    if (typeof g.left === 'number') s = g.left;
    else s = THREE.MathUtils.clamp(g.left.clone().sub(g.gripR).dot(axis), 0.18, 1.2);
    gripL = g.gripR.clone().addScaledVector(axis, s);
    const qL = shaftQ.clone().multiply(HAND_FROM_SHAFT).multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), (g.rollL ?? 180) * DEG));
    targets.push({ limb: 'armL', pos: wristFor('L', gripL, qL), quat: qL, pole: g.poleL });
  }
  return { targets, shaftQ, gripL };
}

/** Хват одной рукой (лук в левой, копьё в правой при ходьбе). */
export function oneHandGrip(side: 'L' | 'R', grip: THREE.Vector3, axis: THREE.Vector3, roll = 0, handRoll = 0, pole?: THREE.Vector3): { target: IKTarget; shaftQ: THREE.Quaternion } {
  const shaftQ = shaftQuat(axis, roll);
  const q = shaftQ.clone().multiply(HAND_FROM_SHAFT).multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), handRoll * DEG));
  return { target: { limb: side === 'L' ? 'armL' : 'armR', pos: wristFor(side, grip, q), quat: q, pole }, shaftQ };
}

/** Положение/ориентация сокета оружия в кисти: хват оружия совпадает с центром ладони. */
export function handSocket(side: 'L' | 'R'): { position: THREE.Vector3; quaternion: THREE.Quaternion } {
  // оружие: +Y вдоль древка; в кисти ось древка = локальная Z ⇒ повернуть +Y→+Z
  return { position: HAND_GRIP[side].clone(), quaternion: HAND_FROM_SHAFT.clone().invert() };
}

export const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
