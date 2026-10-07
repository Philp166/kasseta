// Библиотека клипов: все запекаются один раз на запасном скелете и затем шарятся всеми персонажами.

import * as THREE from 'three';
import { Rig } from '../character/rig';
import { bakeClip, filterClip, isLowerBone, isUpperBone, CLIP_HANDS } from './pose';
import { gaitPose, gaitDuration, GaitKind, WeaponCarry, Injury } from './gait';
import { channelPose, readyKeys, thrustKeys, sweepKeys, heavyKeys, blockKeys, bowPose, rollPose } from './combat';

export type Variant = 'n' | 'h' | 'lL' | 'lR';
export const VARIANT_INJURY: Record<Variant, Injury> = {
  n: { level: 0, side: null },
  h: { level: 1, side: null },
  lL: { level: 1, side: 'L' },
  lR: { level: 1, side: 'R' },
};

export interface ClipMeta {
  duration: number;
  /** Для походок: скорость (м/с), при которой стопы не скользят при timeScale=1. */
  speed?: number;
  loop: boolean;
  /** События по нормализованному времени (для боя): окна урона и т.п. */
  events?: Record<string, number | [number, number]>;
  /** Какие руки держат оружие (0..1 по доле кадров с IK-целью). */
  hands?: { L: number; R: number };
}

export class AnimLibrary {
  readonly clips = new Map<string, THREE.AnimationClip>();
  readonly meta = new Map<string, ClipMeta>();

  constructor() {
    const rig = new Rig();
    this.bakeLocomotion(rig);
    this.bakeCombat(rig);
  }

  get(name: string): THREE.AnimationClip {
    const c = this.clips.get(name);
    if (!c) throw new Error(`Нет клипа ${name}`);
    return c;
  }

  add(clip: THREE.AnimationClip, meta: ClipMeta): void {
    meta.hands = CLIP_HANDS.get(clip.name) ?? { L: 0, R: 0 };
    this.clips.set(clip.name, clip);
    this.meta.set(clip.name, meta);
    // слои «верх/низ» для смешивания поверх походки
    this.clips.set(clip.name + ':upper', filterClip(clip, clip.name + ':upper', isUpperBone));
    this.clips.set(clip.name + ':lower', filterClip(clip, clip.name + ':lower', (b) => isLowerBone(b) || b === 'root'));
  }

  private bakeCombat(rig: Rig): void {
    const mk = (name: string, dur: number, fn: (u: number) => import('./pose').FramePose, meta: Omit<ClipMeta, 'duration'>) =>
      this.add(bakeClip(rig, name, dur, fn, { loop: meta.loop }), { duration: dur, ...meta });
    mk('spear.ready', 1.6, (u) => channelPose(readyKeys(), u), { loop: true });
    mk('spear.thrust', 0.72, (u) => channelPose(thrustKeys(), u), { loop: false, events: { hit: [0.34, 0.5], lunge: [0.22, 0.4] } });
    mk('spear.sweep', 0.88, (u) => channelPose(sweepKeys(), u), { loop: false, events: { hit: [0.4, 0.6], lunge: [0.3, 0.55] } });
    mk('spear.heavy', 1.1, (u) => channelPose(heavyKeys(), u), { loop: false, events: { hit: [0.46, 0.58], lunge: [0.38, 0.52] } });
    mk('spear.block', 1.0, (u) => channelPose(blockKeys(), u), { loop: true });
    mk('roll', 0.78, (u) => rollPose(u), { loop: false, events: { invuln: [0.05, 0.7] } });
    mk('bow.draw', 0.9, (u) => bowPose(u), { loop: false });
    mk('bow.aim', 1.2, () => bowPose(1), { loop: true });
    mk('bow.release', 0.32, (u) => bowPose(Math.max(0, 1 - u * 3.2), { recoil: Math.sin(Math.min(1, u * 1.6) * Math.PI) * 0.9 }), { loop: false });
  }

  private bakeLocomotion(rig: Rig): void {
    const kinds: GaitKind[] = ['idle', 'walk', 'run', 'sprint'];
    const weapons: WeaponCarry[] = ['none', 'spear', 'bow'];
    for (const kind of kinds) {
      for (const weapon of weapons) {
        for (const v of Object.keys(VARIANT_INJURY) as Variant[]) {
          if (kind === 'sprint' && v !== 'n') continue;
          const inj = VARIANT_INJURY[v];
          const dur = gaitDuration(kind, inj);
          const name = `${kind}.${weapon}.${v}`;
          const clip = bakeClip(rig, name, dur, (u) => gaitPose(kind, u, weapon, inj), { loop: true });
          const meta: ClipMeta = { duration: dur, loop: true };
          if (kind !== 'idle') meta.speed = measureSpeed(rig, kind, weapon, inj, dur);
          this.add(clip, meta);
        }
      }
    }
  }
}

/** Скорость походки: наклон движения опорной стопы назад относительно тела (м/с). */
function measureSpeed(rig: Rig, kind: GaitKind, weapon: WeaponCarry, inj: Injury, dur: number): number {
  const N = 40;
  const pts: Array<{ t: number; z: number }> = [];
  const v = new THREE.Vector3();
  for (let i = 0; i <= N; i++) {
    const u = i / N;
    const phi = u;
    // применяем позу и смотрим мировую позицию левой лодыжки
    const pose = gaitPose(kind, phi, weapon, inj);
    // быстрый путь: импорт applyFramePose циклом не нужен — используем bakeClip-стиль через pose.ts
    rigPose(rig, pose);
    rig.b('footL').getWorldPosition(v);
    pts.push({ t: u * dur, z: v.z });
  }
  // стоянка: участок, где стопа на земле (y мало) — берём первую половину цикла (φ 0.05..0.48)
  const a = pts[Math.round(N * 0.06)], b = pts[Math.round(N * 0.46)];
  const speed = (a.z - b.z) / (b.t - a.t);
  return Math.max(0.5, speed);
}

import { applyFramePose } from './pose';
function rigPose(rig: Rig, pose: import('./pose').FramePose) {
  applyFramePose(rig, pose);
}
