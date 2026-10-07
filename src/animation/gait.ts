// Процедурные походки: покой, шаг, бег, спринт. Параметры подобраны так, чтобы стопы не «скользили» при согласованной скорости.
// Фаза φ=0: левая пятка касается земли; левая нога в опоре на 0..π, в переносе на π..2π.

import * as THREE from 'three';
import { FramePose, V3, IKTarget } from './pose';
import { oneHandGrip, twoHandGrip, V } from './grips';
import { DEG, smoothstep } from '../core/util';

export type GaitKind = 'idle' | 'walk' | 'run' | 'sprint';
export type WeaponCarry = 'none' | 'spear' | 'bow';
export interface Injury { level: number; side: 'L' | 'R' | null }

interface GaitParams {
  T: number; A: number; K: number; Kld: number; bob: number; sway: number; pelvisYaw: number; spineYaw: number;
  lean: number; armSwing: number; elbow0: number; elbow1: number; float: number; toeOff: number; heelUp: number; kneeBase: number;
}

const P: Record<Exclude<GaitKind, 'idle'>, GaitParams> = {
  walk: { T: 1.0, A: 23, K: 60, Kld: 11, bob: 0.02, sway: 0.026, pelvisYaw: 5, spineYaw: 6, lean: 3, armSwing: 15, elbow0: 12, elbow1: 12, float: 0, toeOff: 24, heelUp: 11, kneeBase: 4 },
  run: { T: 0.6, A: 41, K: 104, Kld: 22, bob: 0.04, sway: 0.02, pelvisYaw: 8, spineYaw: 10, lean: 11, armSwing: 40, elbow0: 78, elbow1: 12, float: 0.045, toeOff: 36, heelUp: 4, kneeBase: 10 },
  sprint: { T: 0.47, A: 48, K: 114, Kld: 24, bob: 0.05, sway: 0.016, pelvisYaw: 9, spineYaw: 12, lean: 19, armSwing: 52, elbow0: 88, elbow1: 12, float: 0.075, toeOff: 40, heelUp: 2, kneeBase: 14 },
};

export function gaitDuration(kind: GaitKind, inj: Injury): number {
  if (kind === 'idle') return 4;
  return P[kind].T * (1 + 0.14 * inj.level);
}

const wrapPi = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));
const bump = (a: number, c: number, w: number) => { const d = wrapPi(a - c); return Math.exp(-((d / w) ** 2)); };

/** Спиральная «ручная» подгонка поз по оружию: цели рук. */
function carryTargets(weapon: WeaponCarry, kind: GaitKind, phi: number, speedK: number, inj: Injury): { ik: IKTarget[]; freeL: boolean; freeR: boolean } {
  const bobv = kind === 'idle' ? Math.sin(phi) * 0.004 : Math.cos(2 * phi + Math.PI) * 0.012;
  if (weapon === 'spear') {
    // копьё в правой руке: в покое — упёрто нижним концом в землю, при ходьбе несут чуть наклонив вперёд
    const lift = kind === 'idle' ? 0 : kind === 'walk' ? 0.1 : 0.2;
    const tilt = (kind === 'idle' ? 4 : kind === 'walk' ? 14 : 24) * DEG;
    const sway = kind === 'idle' ? 0 : Math.sin(phi) * 0.05 * speedK;
    const axis = V(Math.sin(sway) * 0.4 + 0.02, Math.cos(tilt), Math.sin(tilt)).normalize();
    const grip = V(-0.285, 1.02 + lift + bobv, 0.12 + (kind === 'idle' ? 0 : 0.04));
    const r = oneHandGrip('R', grip, axis, 0, 0, V(-0.5, -0.4, -0.9));
    return { ik: [r.target], freeL: true, freeR: false };
  }
  if (weapon === 'bow') {
    // лук в левой руке, опущен вдоль бедра
    const grip = V(0.265, 0.98 + bobv, 0.1);
    const axis = V(0.04, 1, 0.1).normalize();
    const r = oneHandGrip('L', grip, axis, 0, 0, V(0.5, -0.4, -0.9));
    return { ik: [r.target], freeL: false, freeR: true };
  }
  void inj; void twoHandGrip;
  return { ik: [], freeL: true, freeR: true };
}

export function gaitPose(kind: GaitKind, u: number, weapon: WeaponCarry, inj: Injury): FramePose {
  const rot: Record<string, V3> = {};
  const hurt = inj.level;
  const hunch = 9 * hurt;
  const phi = u * Math.PI * 2;

  if (kind === 'idle') {
    const br = Math.sin(phi * 1.0), br2 = Math.sin(phi * 3 + 0.6);
    const shift = Math.sin(phi * 0.5 + 0.4); // ленивая смена опорной ноги раз в 8 с — укладываем в такт 4 с: используем синус на u
    rot.spine = [2 + hunch * 0.8 + 0.6 * br, 1.2 * shift, 1.1 * shift];
    rot.chest = [1.5 + hunch * 0.9 + 0.9 * br2, -1.0 * shift, 0.6 * shift];
    rot.neck = [-1 - hunch * 0.5, 0.8 * Math.sin(phi * 0.5), 0];
    rot.head = [-1.5 + hunch * 0.4, 1.5 * Math.sin(phi * 0.5 + 1), 0];
    rot.shoulderL = [0, 0, 1.0 + 0.8 * br];
    rot.shoulderR = [0, 0, -1.0 - 0.8 * br];
    rot.upperLegL = [-3 - 4 * hurt, 0, -1];
    rot.upperLegR = [-3 - 4 * hurt, 0, 1];
    rot.lowerLegL = [6 + 6 * hurt, 0, 0];
    rot.lowerLegR = [6 + 6 * hurt, 0, 0];
    rot.footL = [-3 + 0, 5, 0];
    rot.footR = [-3 + 0, -5, 0];
    rot.upperArmL = [4, 0, 7 - 1.5 * hurt];
    rot.upperArmR = [4, 0, -7 + 1.5 * hurt];
    rot.lowerArmL = [-14 - 8 * hurt, 0, 0];
    rot.lowerArmR = [-14 - 8 * hurt, 0, 0];
    rot.handL = [0, 0, 0];
    const c = carryTargets(weapon, kind, phi, 0, inj);
    return {
      rot, hips: [0.012 * shift, -0.015 - 0.02 * hurt, 0], ik: c.ik, ground: {}, ikFollowHips: true,
    };
  }

  const p = P[kind];
  let A = p.A, Kk = p.K;
  const speedK = kind === 'walk' ? 1 : kind === 'run' ? 1.4 : 1.8;
  const hipsPos: V3 = [0, 0, 0];

  // стороны
  const sides: Array<{ s: 'L' | 'R'; ph: number; inj: boolean }> = [
    { s: 'L', ph: phi, inj: hurt > 0 && inj.side === 'L' },
    { s: 'R', ph: phi + Math.PI, inj: hurt > 0 && inj.side === 'R' },
  ];
  const baseHurtA = 1 - 0.12 * hurt;
  for (const sd of sides) {
    const a = sd.ph;
    const k = sd.inj ? 0.62 : 1;
    const al = A * baseHurtA * k * Math.cos(a) + (sd.inj ? -3 : 0);
    const swing = Math.max(0, -Math.sin(a));
    const kn = p.kneeBase + Kk * (1 - 0.1 * hurt) * Math.pow(swing, 1.15) * (sd.inj ? 0.7 : 1) + p.Kld * bump(a, 0.45, 0.5) * (sd.inj ? 1.8 : 1);
    // стопа: пятка/носок относительно земли
    const w = p.toeOff * bump(a, 0.93 * Math.PI, 0.38) - p.heelUp * bump(a, 0.02, 0.3) + 7 * smoothstep(Math.PI, 1.5 * Math.PI, wrapPos(a));
    rot['upperLeg' + sd.s] = [-al, sd.s === 'L' ? 2 : -2, sd.s === 'L' ? -1.5 : 1.5];
    rot['lowerLeg' + sd.s] = [kn, 0, 0];
    rot['foot' + sd.s] = [w + al - kn, sd.s === 'L' ? 4 : -4, 0];
    rot['toe' + sd.s] = [-0.35 * p.toeOff * bump(a, 0.95 * Math.PI, 0.25), 0, 0];
  }
  // таз и корпус
  hipsPos[0] = p.sway * Math.sin(phi) * (1 - 0.2 * hurt);
  const limpRoll = hurt > 0 && inj.side ? (inj.side === 'L' ? 1 : -1) * 4 * hurt * Math.max(0, Math.sin(inj.side === 'L' ? phi : phi + Math.PI)) : 0;
  const lean = p.lean + hunch;
  rot.hips = [0, -p.pelvisYaw * Math.cos(phi), -limpRoll];
  rot.spine = [lean * 0.55, p.spineYaw * 0.55 * Math.cos(phi), limpRoll * 0.6];
  rot.chest = [lean * 0.35, p.spineYaw * 0.55 * Math.cos(phi), limpRoll * 0.4];
  rot.neck = [-lean * 0.45 + hunch * 0.3, -p.spineYaw * 0.4 * Math.cos(phi), 0];
  rot.head = [-lean * 0.25, -p.spineYaw * 0.35 * Math.cos(phi), 0];
  rot.shoulderL = [0, 0, 1];
  rot.shoulderR = [0, 0, -1];
  // руки (свободные)
  const armA = p.armSwing * (1 - 0.3 * hurt);
  for (const sd of [{ s: 'L', ph: phi }, { s: 'R', ph: phi + Math.PI }] as const) {
    const sg = sd.s === 'L' ? 1 : -1;
    const sw = armA * Math.cos(sd.ph);
    const fl = p.elbow0 + p.elbow1 * (0.5 - 0.5 * Math.cos(sd.ph)) + 6 * hurt;
    rot['upperArm' + sd.s] = [sw, 0, sg * (7 + (kind === 'walk' ? 0 : 4))];
    rot['lowerArm' + sd.s] = [-fl, 0, 0];
  }
  const c = carryTargets(weapon, kind, phi, speedK, inj);
  return {
    rot, hips: hipsPos, ik: c.ik, ground: { float: p.float * (bump(phi, 0.85 * Math.PI, 0.13 * Math.PI) + bump(phi, 1.85 * Math.PI, 0.13 * Math.PI)) },
    ikFollowHips: true,
  };
}

function wrapPos(a: number): number {
  const t = a % (Math.PI * 2);
  return t < 0 ? t + Math.PI * 2 : t;
}
