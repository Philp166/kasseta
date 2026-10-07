// Позы и запекание: поза кадра (FK-повороты + смещение бёдер + IK-цели) → AnimationClip.
// Клипы работают на логическом скелете (все кости в покое с единичным поворотом).

import * as THREE from 'three';
import { Rig, SECONDARY_PREFIXES } from '../character/rig';
import { solveLimb } from './ik';
import { DEG, clamp } from '../core/util';

export type V3 = [number, number, number];

// ---------- Ключи и плавность ----------

export type Ease = 'lin' | 'smooth' | 'in' | 'out' | 'in3' | 'out3' | 'snap';

export function ease(t: number, e: Ease): number {
  t = clamp(t);
  switch (e) {
    case 'lin': return t;
    case 'smooth': return t * t * (3 - 2 * t);
    case 'in': return t * t;
    case 'out': return 1 - (1 - t) * (1 - t);
    case 'in3': return t * t * t;
    case 'out3': return 1 - Math.pow(1 - t, 3);
    case 'snap': return t < 0.5 ? 0 : 1;
  }
}

/** Ключ: время (0..1 или секунды — как удобно), значения, плавность ИСХОДЯЩЕГО сегмента. */
export interface Key { t: number; v: number[]; e?: Ease }

/** Значение кривой по ключам (линейно по компонентам с плавностью сегмента). */
export function evalKeys(keys: Key[], t: number): number[] {
  if (t <= keys[0].t) return keys[0].v;
  const last = keys[keys.length - 1];
  if (t >= last.t) return last.v;
  let i = 0;
  while (i < keys.length - 2 && t > keys[i + 1].t) i++;
  const a = keys[i], b = keys[i + 1];
  const k = ease((t - a.t) / (b.t - a.t), a.e ?? 'smooth');
  return a.v.map((x, n) => x + (b.v[n] - x) * k);
}

export const K = (t: number, v: number[], e?: Ease): Key => ({ t, v, e });

// ---------- Поза кадра ----------

export interface IKTarget {
  limb: 'armL' | 'armR' | 'legL' | 'legR';
  /** Мировая позиция запястья/лодыжки в системе корня персонажа (ноги на y=0). */
  pos: THREE.Vector3;
  /** Ориентация кисти/стопы (мировая в системе корня). */
  quat?: THREE.Quaternion;
  pole?: THREE.Vector3;
}

export interface FramePose {
  /** Эйлеровы повороты (градусы, порядок XYZ) относительно покоя. */
  rot?: Record<string, V3>;
  /** Смещение бёдер от покоя, м. */
  hips?: V3;
  root?: { pos?: V3; rot?: V3 };
  ik?: IKTarget[];
  /** Прижать стопы к земле подстройкой высоты бёдер; float — «полёт» в беге (м). */
  ground?: { float?: number } | false;
  /** IK-цели рук считать относительно сдвига бёдер (чтобы оружие ходило вместе с телом). */
  ikFollowHips?: boolean;
}

const _e = new THREE.Euler();

/** Точки подошвы в локальной системе стопы (пятка, середина, носок). */
const SOLE: THREE.Vector3[] = [new THREE.Vector3(0, -0.095, -0.075), new THREE.Vector3(0, -0.095, 0.08), new THREE.Vector3(0.0, -0.1, 0.205)];
const _sp = new THREE.Vector3();

export function soleMinY(rig: Rig): number {
  let m = Infinity;
  for (const s of ['L', 'R']) {
    const foot = rig.b('foot' + s);
    const toe = rig.b('toe' + s);
    foot.updateWorldMatrix(true, false);
    toe.updateWorldMatrix(true, false);
    for (let i = 0; i < SOLE.length; i++) {
      const bone = i === 2 ? toe : foot;
      // носок считаем от кости пальцев: точка на 0.09 м впереди неё
      const p = i === 2 ? _sp.set(0, -0.045, 0.09) : _sp.copy(SOLE[i]);
      p.applyMatrix4(bone.matrixWorld);
      m = Math.min(m, p.y);
    }
  }
  return m;
}

export function applyFramePose(rig: Rig, pose: FramePose): void {
  rig.resetPose();
  const hips = rig.b('hips');
  const root = rig.root;
  if (pose.root?.pos) root.position.add(new THREE.Vector3(...pose.root.pos));
  if (pose.root?.rot) root.quaternion.setFromEuler(_e.set(pose.root.rot[0] * DEG, pose.root.rot[1] * DEG, pose.root.rot[2] * DEG, 'XYZ'));
  if (pose.rot) {
    for (const name in pose.rot) {
      const b = rig.bones.get(name);
      if (!b) continue;
      const r = pose.rot[name];
      b.quaternion.setFromEuler(_e.set(r[0] * DEG, r[1] * DEG, r[2] * DEG, 'XYZ'));
    }
  }
  if (pose.hips) hips.position.add(new THREE.Vector3(...pose.hips));
  rig.root.updateMatrixWorld(true);

  let hipShift = 0;
  if (pose.ground !== false && !(pose.ik && pose.ik.some((t) => t.limb.startsWith('leg')))) {
    const float = pose.ground ? pose.ground.float ?? 0 : 0;
    const dy = -soleMinY(rig) + float;
    hips.position.y += dy;
    hipShift = dy;
    rig.root.updateMatrixWorld(true);
  }
  if (pose.ik) {
    for (const t of pose.ik) {
      const side = t.limb.endsWith('L') ? 'L' : 'R';
      const sx = side === 'L' ? 1 : -1;
      const target = t.pos.clone();
      if (pose.ikFollowHips) target.y += hipShift;
      // цель задана в системе корня; кости считаются в мировой системе при root в начале координат
      const isArm = t.limb.startsWith('arm');
      const pole = t.pole ?? (isArm ? new THREE.Vector3(sx * 0.6, -0.5, -0.9) : new THREE.Vector3(sx * 0.15, 0, 1));
      solveLimb(
        rig, (isArm ? 'upperArm' : 'upperLeg') + side, (isArm ? 'lowerArm' : 'lowerLeg') + side, (isArm ? 'hand' : 'foot') + side,
        target, pole, t.quat,
      );
    }
    rig.root.updateMatrixWorld(true);
  }
}

// ---------- Запекание ----------

const ANIMATED = (name: string) => !SECONDARY_PREFIXES.some((p) => name.startsWith(p));

export interface BakeOpts {
  fps?: number;
  loop?: boolean;
  /** Ограничить набор костей (для слоёв «верх/низ»). */
  filter?: (boneName: string) => boolean;
}

/**
 * Запечь клип: poseAt(u, time) вызывается на каждом кадре. u — нормализованное время 0..1.
 * Пишутся кватернионы всех анимируемых костей (кроме пружинных), позиция бёдер и корня.
 */
export function bakeClip(rig: Rig, name: string, duration: number, poseAt: (u: number, time: number) => FramePose, opts: BakeOpts = {}): THREE.AnimationClip {
  const fps = opts.fps ?? 30;
  const frames = Math.max(2, Math.round(duration * fps)) + (opts.loop ? 0 : 0);
  const times: number[] = [];
  const bones = rig.list.filter((b) => ANIMATED(b.name));
  const qvals = new Map<string, number[]>();
  const hipPos: number[] = [];
  const rootPos: number[] = [];
  const rootQ: number[] = [];
  for (const b of bones) qvals.set(b.name, []);
  const prev = new Map<string, THREE.Quaternion>();
  for (let f = 0; f <= frames; f++) {
    const u = f / frames;
    const time = u * duration;
    applyFramePose(rig, poseAt(u, time));
    times.push(time);
    for (const b of bones) {
      const q = b.quaternion.clone();
      const p = prev.get(b.name);
      if (p && p.dot(q) < 0) { q.x = -q.x; q.y = -q.y; q.z = -q.z; q.w = -q.w; }
      prev.set(b.name, q);
      qvals.get(b.name)!.push(q.x, q.y, q.z, q.w);
    }
    hipPos.push(rig.b('hips').position.x, rig.b('hips').position.y, rig.b('hips').position.z);
    rootPos.push(rig.root.position.x, rig.root.position.y, rig.root.position.z);
    rootQ.push(rig.root.quaternion.x, rig.root.quaternion.y, rig.root.quaternion.z, rig.root.quaternion.w);
  }
  const tracks: THREE.KeyframeTrack[] = [];
  const keep = opts.filter ?? (() => true);
  for (const b of bones) {
    if (!keep(b.name)) continue;
    const arr = qvals.get(b.name)!;
    // пропускаем кости, которые всё время в покое — меньше работы миксеру
    let moving = false;
    for (let i = 0; i < arr.length; i += 4) {
      if (Math.abs(arr[i]) > 1e-5 || Math.abs(arr[i + 1]) > 1e-5 || Math.abs(arr[i + 2]) > 1e-5 || Math.abs(arr[i + 3] - 1) > 1e-5) { moving = true; break; }
    }
    if (!moving && b.name !== 'root') continue;
    tracks.push(new THREE.QuaternionKeyframeTrack(`${b.name}.quaternion`, times, arr));
  }
  if (keep('hips')) tracks.push(new THREE.VectorKeyframeTrack('hips.position', times, hipPos));
  if (keep('root')) {
    tracks.push(new THREE.VectorKeyframeTrack('root.position', times, rootPos));
    tracks.push(new THREE.QuaternionKeyframeTrack('root.quaternion', times, rootQ));
  }
  const clip = new THREE.AnimationClip(name, duration, tracks);
  rig.resetPose();
  rig.root.updateMatrixWorld(true);
  return clip;
}

// ---------- Слои тела ----------

const UPPER = /^(spine|chest|neck|head|shoulder|upperArm|lowerArm|hand|thumb|index|middle|ring|pinky)/;
export const isUpperBone = (n: string) => UPPER.test(n);
export const isLowerBone = (n: string) => !UPPER.test(n);

export function filterClip(clip: THREE.AnimationClip, name: string, keep: (bone: string) => boolean): THREE.AnimationClip {
  const tracks = clip.tracks.filter((t) => keep(t.name.split('.')[0]));
  return new THREE.AnimationClip(name, clip.duration, tracks.map((t) => t.clone()));
}

// ---------- Построение ориентаций оружия ----------

const Y = new THREE.Vector3(0, 1, 0), Z = new THREE.Vector3(0, 0, 1), X1 = new THREE.Vector3(1, 0, 0);
const _m = new THREE.Matrix4(), _x = new THREE.Vector3(), _z = new THREE.Vector3();

/** Кватернион древка: ось Y — вдоль axis, «плоскость клинка» (Z) вдоль hint, затем поворот roll вокруг оси. */
export function shaftQuat(axis: THREE.Vector3, rollDeg = 0, hint: THREE.Vector3 = Z): THREE.Quaternion {
  const y = axis.clone().normalize();
  _z.copy(hint).addScaledVector(y, -hint.dot(y));
  if (_z.lengthSq() < 1e-6) _z.copy(X1).addScaledVector(y, -X1.dot(y));
  _z.normalize();
  _x.crossVectors(y, _z).normalize();
  _z.crossVectors(_x, y);
  const q = new THREE.Quaternion().setFromRotationMatrix(_m.makeBasis(_x, y, _z));
  if (rollDeg) q.multiply(new THREE.Quaternion().setFromAxisAngle(Y, rollDeg * DEG));
  return q;
}

export const _unusedAxes = { Y, Z, X1 };
