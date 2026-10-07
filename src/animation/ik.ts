// Двухзвенный IK (рука/нога) по реальным костям скелета. Используется при запекании клипов в FK.
// Локоть/колено получают «честный» шарнир: поворот предплечья идёт вокруг одной оси (без «конфетной обёртки»).

import * as THREE from 'three';
import { Rig } from '../character/rig';

const _A = new THREE.Vector3(), _B = new THREE.Vector3(), _C = new THREE.Vector3();
const _u = new THREE.Vector3(), _pp = new THREE.Vector3(), _P = new THREE.Vector3();
const _v0 = new THREE.Vector3(), _v1 = new THREE.Vector3(), _fd = new THREE.Vector3();
const _q = new THREE.Quaternion(), _q2 = new THREE.Quaternion(), _Wp = new THREE.Quaternion(), _Wu = new THREE.Quaternion();
const _X = new THREE.Vector3(), _n = new THREE.Vector3(), _tmp = new THREE.Vector3();

export interface IKResult {
  /** Длина цели относительно полной длины конечности (>1 — не достать). */
  stretch: number;
  elbow: THREE.Vector3;
}

/**
 * @param target  желаемая мировая позиция конца (запястье/лодыжка)
 * @param pole    куда смотрит локоть/колено (мировое направление-подсказка)
 * @param endQuat мировая ориентация конца (кисть/стопа), если задана
 */
export function solveLimb(
  rig: Rig, upperName: string, lowerName: string, endName: string,
  target: THREE.Vector3, pole: THREE.Vector3, endQuat?: THREE.Quaternion,
): IKResult {
  const U = rig.b(upperName), L = rig.b(lowerName), E = rig.b(endName);
  U.quaternion.identity();
  L.quaternion.identity();
  U.parent!.updateWorldMatrix(true, false);
  U.updateWorldMatrix(false, true);

  U.getWorldPosition(_A);
  L.getWorldPosition(_B);
  E.getWorldPosition(_C);
  const a = _A.distanceTo(_B), b = _B.distanceTo(_C);

  _u.subVectors(target, _A);
  const dRaw = _u.length();
  _u.multiplyScalar(1 / Math.max(dRaw, 1e-6));
  const d = THREE.MathUtils.clamp(dRaw, Math.abs(a - b) + 1e-4, a + b - 1e-4);
  const x = (a * a + d * d - b * b) / (2 * d);
  const y = Math.sqrt(Math.max(a * a - x * x, 0));
  _pp.copy(pole).addScaledVector(_u, -pole.dot(_u));
  if (_pp.lengthSq() < 1e-8) _pp.set(0, 0, 1).addScaledVector(_u, -_u.z);
  if (_pp.lengthSq() < 1e-8) _pp.set(1, 0, 0);
  _pp.normalize();
  _P.copy(_A).addScaledVector(_u, x).addScaledVector(_pp, y); // положение локтя
  const Tc = _tmp.copy(_A).addScaledVector(_u, d);              // достижимый конец

  // --- верхнее звено: качание к локтю ---
  U.parent!.getWorldQuaternion(_Wp);
  const restDirU = L.position.clone().normalize();               // направление к нижнему звену в покое (локально)
  _v0.copy(restDirU).applyQuaternion(_Wp);
  _v1.subVectors(_P, _A).normalize();
  _q.setFromUnitVectors(_v0, _v1);
  _Wu.copy(_q).multiply(_Wp);                                    // мировой поворот после качания
  // --- закрутка: ось шарнира (локальная X) вдоль нормали плоскости изгиба ---
  _n.crossVectors(_u, _pp).normalize();
  _X.set(1, 0, 0).applyQuaternion(_Wu);
  if (_X.dot(_n) < 0) _n.negate();
  // угол между _X и _n вокруг оси _v1
  const cx = _tmp.crossVectors(_X, _n).dot(_v1);
  const dx = _X.dot(_n);
  const tw = Math.atan2(cx, dx);
  _q2.setFromAxisAngle(_v1, tw);
  _Wu.premultiply(_q2);
  U.quaternion.copy(_Wp).invert().multiply(_Wu);

  // --- нижнее звено: чистый шарнир к цели ---
  U.updateWorldMatrix(false, true);
  const restDirL = E.position.clone().normalize();
  _fd.subVectors(Tc.copy(_A).addScaledVector(_u, d), _P).normalize();
  // _fd в системе верхнего звена
  const invWu = _q.copy(_Wu).invert();
  _fd.applyQuaternion(invWu);
  L.quaternion.setFromUnitVectors(restDirL, _fd);
  L.updateWorldMatrix(false, true);

  if (endQuat) {
    L.getWorldQuaternion(_q);
    E.quaternion.copy(_q).invert().multiply(endQuat);
  }
  return { stretch: dRaw / (a + b), elbow: _P.clone() };
}
