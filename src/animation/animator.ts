// Рантайм анимаций: слои поверх стандартного AnimationMixer.
//  • походка: клипы idle/walk/run/sprint (низ и верх раздельно) смешиваются по скорости с общей фазой (стопы не скользят);
//  • оверлей верхней части тела (блок, прицеливание);
//  • полнотельные «выстрелы» (атаки, перекат) с событиями по нормализованному времени;
//  • процедурные добавки после миксера: поворот к цели, отдача от ударов, тяжёлое дыхание.
// Веса всех действий плавно тянутся к целевым (кроссфейд без рывков).

import * as THREE from 'three';
import { AnimLibrary, Variant, ClipMeta } from './library';
import type { WeaponCarry } from './gait';
import { Rig } from '../character/rig';
import { DEG, clamp } from '../core/util';

let sharedLib: AnimLibrary | null = null;
export function getAnimLibrary(): AnimLibrary {
  if (!sharedLib) sharedLib = new AnimLibrary();
  return sharedLib;
}

type Layer = 'lower' | 'upper' | 'full';

interface W {
  action: THREE.AnimationAction;
  w: number;
  target: number;
  rate: number;
}

export interface OneShot {
  name: string;
  meta: ClipMeta;
  /** Секунды от начала (с учётом скорости). */
  t: number;
  speed: number;
  loop: boolean;
  /** Время задаётся извне (натяжение лука). */
  manual: boolean;
  fadeIn: number;
  fadeOut: number;
  done: boolean;
  onDone?: () => void;
}

const GAITS = ['walk', 'run', 'sprint'] as const;

export class Animator {
  readonly mixer: THREE.AnimationMixer;
  readonly lib = getAnimLibrary();
  weapon: WeaponCarry = 'none';
  variant: Variant = 'n';
  speed = 0;
  private phase = 0;
  private weights = new Map<string, W>();
  private full: OneShot | null = null;
  private fullW = 0;
  private overlay: { name: string; w: number; target: number } | null = null;
  /** Скорость смешивания весов (1/с). */
  blendRate = 11;

  // добавки
  aimYaw = 0; // рад: куда повернуть верх тела относительно таза
  aimPitch = 0;
  breath = 0; // 0..1 — тяжёлое дыхание
  private flinchV = new THREE.Vector3(); // скорость пружины отдачи [pitch, yaw, roll]
  private flinchX = new THREE.Vector3();
  private time = 0;
  private rig: Rig | null = null;
  /** Кости, на которые накладываются добавки, и их «чистые» значения от миксера (миксер пишет в кость только при изменении). */
  private readonly affected = ['spine', 'chest', 'neck', 'head', 'shoulderL', 'shoulderR'];
  private clean = new Map<string, THREE.Quaternion>();

  constructor(readonly root: THREE.Object3D, rig?: Rig) {
    this.mixer = new THREE.AnimationMixer(root);
    this.rig = rig ?? null;
  }

  // ---------- Действия и веса ----------

  private act(clipName: string): W {
    let w = this.weights.get(clipName);
    if (!w) {
      const action = this.mixer.clipAction(this.lib.get(clipName));
      action.setEffectiveWeight(0);
      action.enabled = true;
      action.play();
      w = { action, w: 0, target: 0, rate: this.blendRate };
      this.weights.set(clipName, w);
    }
    return w;
  }

  private setTarget(clipName: string, target: number, rate = this.blendRate): void {
    const w = this.act(clipName);
    w.target = target;
    w.rate = rate;
  }

  // ---------- Походка ----------

  setLocomotion(speed: number, weapon: WeaponCarry, variant: Variant): void {
    this.speed = speed;
    this.weapon = weapon;
    this.variant = variant;
  }

  private gaitWeights(s: number): Record<'idle' | 'walk' | 'run' | 'sprint', number> {
    const vw = this.lib.meta.get('walk.none.n')?.speed ?? 1.5;
    const vr = this.lib.meta.get('run.none.n')?.speed ?? 4;
    const vs = this.lib.meta.get('sprint.none.n')?.speed ?? 5.8;
    const out = { idle: 0, walk: 0, run: 0, sprint: 0 };
    if (s <= 0.12) out.idle = 1;
    else if (s < vw * 0.85) {
      const t = (s - 0.12) / (vw * 0.85 - 0.12);
      out.idle = 1 - t; out.walk = t;
    } else if (s < vw) {
      out.walk = 1;
    } else if (s < vr) {
      const t = (s - vw) / (vr - vw);
      out.walk = 1 - t; out.run = t;
    } else if (s < vs) {
      const t = (s - vr) / (vs - vr);
      out.run = 1 - t; out.sprint = t;
    } else out.sprint = 1;
    return out;
  }

  // ---------- Полнотельные клипы и оверлей ----------

  /** Проиграть полнотельный клип (атака, перекат): локомоция гасится, клип идёт по собственному времени. */
  playFull(name: string, o: { fadeIn?: number; fadeOut?: number; speed?: number; loop?: boolean; manual?: boolean; onDone?: () => void } = {}): OneShot {
    const meta = this.lib.meta.get(name)!;
    this.full = {
      name, meta, t: 0, speed: o.speed ?? 1, loop: o.loop ?? meta.loop, manual: o.manual ?? false,
      fadeIn: o.fadeIn ?? 0.08, fadeOut: o.fadeOut ?? 0.15, done: false, onDone: o.onDone,
    };
    this.setTarget(name, 0, 100);
    return this.full;
  }

  /** Установить время «ручного» клипа (нормализованное 0..1). */
  scrub(u: number): void {
    if (this.full) this.full.t = clamp(u) * this.full.meta.duration;
  }

  stopFull(fadeOut = 0.15): void {
    if (!this.full) return;
    this.full.fadeOut = fadeOut;
    this.full.done = true;
  }

  get fullClip(): OneShot | null { return this.full && !this.full.done ? this.full : this.full; }

  /** Нормализованное время текущего полнотельного клипа (или null). */
  fullU(): number | null {
    if (!this.full || this.full.done) return null;
    return this.full.t / this.full.meta.duration;
  }

  /** Находится ли клип внутри окна события (например, 'hit'). */
  inWindow(event: string): boolean {
    const f = this.full;
    if (!f || f.done) return false;
    const e = f.meta.events?.[event];
    if (e === undefined) return false;
    const u = f.t / f.meta.duration;
    return typeof e === 'number' ? Math.abs(u - e) < 0.02 : u >= e[0] && u <= e[1];
  }

  /** Оверлей верхней части тела (блок и т.п.), null — убрать. */
  setOverlay(name: string | null): void {
    if (!name) { if (this.overlay) this.overlay.target = 0; return; }
    if (this.overlay && this.overlay.name !== name) {
      this.setTarget(this.overlay.name + ':upper', 0, 30);
      this.overlay = { name, w: 0, target: 1 };
    } else if (!this.overlay) this.overlay = { name, w: 0, target: 1 };
    else this.overlay.target = 1;
  }

  // ---------- Отдача ----------

  /** Толчок корпуса (мировое направление удара локально персонажу: x вправо, z вперёд), сила 0..1. */
  flinch(localDir: THREE.Vector3, strength: number): void {
    // удар сзади (dir.z>0 к телу) → корпус вперёд (+pitch); удар слева → крен вправо
    this.flinchV.x += -localDir.z * 140 * strength;
    this.flinchV.z += localDir.x * 120 * strength;
    this.flinchV.y += localDir.x * 60 * strength;
  }

  // ---------- Обновление ----------

  update(dt: number): void {
    this.time += dt;
    this.updateLocomotion(dt);
    this.updateFull(dt);
    this.updateOverlay(dt);
    // применить веса
    for (const w of this.weights.values()) {
      w.w += (w.target - w.w) * (1 - Math.exp(-w.rate * dt));
      if (Math.abs(w.target - w.w) < 0.002) w.w = w.target;
      w.action.setEffectiveWeight(w.w);
    }
    if (this.rig) for (const [n, q] of this.clean) this.rig.bones.get(n)!.quaternion.copy(q);
    this.mixer.update(0); // время ставим сами
    if (this.rig) {
      for (const n of this.affected) {
        const b = this.rig.bones.get(n);
        if (!b) continue;
        const c = this.clean.get(n);
        if (c) c.copy(b.quaternion); else this.clean.set(n, b.quaternion.clone());
      }
    }
    this.applyAdditive(dt);
  }

  private updateLocomotion(dt: number): void {
    const gw = this.gaitWeights(this.speed);
    const v = this.variant;
    const wp = this.weapon;
    const lowW = 1 - this.fullW;
    const upW = lowW * (1 - (this.overlay ? this.overlay.w : 0));
    // целевые веса по всем вариантам: всё нулим, нужное включаем
    for (const [name, w] of this.weights) {
      if (/^(idle|walk|run|sprint)\./.test(name)) w.target = 0;
    }
    // скорость фазы
    let freq = 0, wsum = 0;
    for (const g of GAITS) {
      const wg = gw[g];
      if (wg <= 0) continue;
      const nm = `${g}.${wp}.${g === 'sprint' ? 'n' : v}`;
      const meta = this.lib.meta.get(nm);
      if (!meta) continue;
      const s = Math.max(this.speed, 0.3);
      freq += wg * (s / (meta.speed ?? 1.5)) / meta.duration;
      wsum += wg;
    }
    if (wsum > 0) this.phase = (this.phase + (freq / wsum) * dt) % 1;
    else this.phase = (this.phase + dt / 4) % 1;
    for (const k of ['idle', 'walk', 'run', 'sprint'] as const) {
      const wg = gw[k];
      const vv = k === 'sprint' ? 'n' : v;
      const base = `${k}.${wp}.${vv}`;
      if (wg > 0 || this.weights.has(base + ':lower')) {
        this.setTarget(base + ':lower', wg * lowW);
        this.setTarget(base + ':upper', wg * upW);
      }
    }
    // фаза для всех активных действий походки (синхронно)
    for (const [name, w] of this.weights) {
      if (!/^(idle|walk|run|sprint)\./.test(name)) continue;
      const base = name.replace(/:(lower|upper)$/, '');
      const dur = this.lib.meta.get(base)!.duration;
      const isIdle = name.startsWith('idle.');
      w.action.time = (isIdle ? (this.time / dur) % 1 : this.phase) * dur;
    }
  }

  private updateFull(dt: number): void {
    const f = this.full;
    if (!f) { this.fullW += (0 - this.fullW) * (1 - Math.exp(-14 * dt)); return; }
    const dur = f.meta.duration;
    if (!f.manual && !f.done) f.t += dt * f.speed;
    let finished = false;
    if (f.t >= dur) {
      if (f.loop) f.t = f.t % dur;
      else { f.t = dur; finished = true; }
    }
    // «плавность» входа/выхода как вес
    const tIn = f.fadeIn > 0 ? clamp(f.t / f.fadeIn) : 1;
    const tOut = f.fadeOut > 0 && !f.loop ? clamp((dur - f.t) / f.fadeOut) : 1;
    let target = Math.min(tIn, f.done ? 0 : 1);
    if (!f.loop && !f.manual) target = Math.min(tIn, tOut);
    if (f.done) target = 0;
    this.fullW += (target - this.fullW) * (1 - Math.exp(-(f.done ? 12 : 22) * dt));
    const w = this.act(f.name);
    w.target = this.fullW;
    w.rate = 200;
    w.action.time = f.t;
    // убрать оверлей/локомоцию из-под веса — делается через lowW/upW выше
    if (finished && !f.done) {
      f.done = true;
      f.onDone?.();
    }
    if (f.done && this.fullW < 0.01) { w.target = 0; this.full = null; this.fullW = 0; }
  }

  private updateOverlay(dt: number): void {
    const o = this.overlay;
    if (!o) return;
    o.w += (o.target - o.w) * (1 - Math.exp(-14 * dt));
    if (o.target === 0 && o.w < 0.005) { this.setTarget(o.name + ':upper', 0, 30); this.overlay = null; return; }
    const w = this.act(o.name + ':upper');
    w.target = o.w * (1 - this.fullW);
    w.rate = 200;
    // оверлейный клип — цикл по своему времени
    const dur = this.lib.meta.get(o.name)!.duration;
    w.action.time = (this.time % dur);
  }

  // ---------- Процедурные добавки ----------

  private applyAdditive(dt: number): void {
    const rig = this.rig;
    if (!rig) return;
    // пружина отдачи
    const k = 140, c = 18;
    for (const a of ['x', 'y', 'z'] as const) {
      const acc = -k * this.flinchX[a] - c * this.flinchV[a];
      this.flinchV[a] += acc * dt;
      this.flinchX[a] += this.flinchV[a] * dt;
    }
    const q = new THREE.Quaternion(), e = new THREE.Euler();
    const mul = (name: string, x: number, y: number, z: number) => {
      const b = rig.bones.get(name);
      if (!b) return;
      b.quaternion.multiply(q.setFromEuler(e.set(x * DEG, y * DEG, z * DEG, 'XYZ')));
    };
    const fx = this.flinchX.x * 0.08, fy = this.flinchX.y * 0.08, fz = this.flinchX.z * 0.08;
    mul('spine', fx * 0.5, fy * 0.5, fz * 0.5);
    mul('chest', fx * 0.5, fy * 0.5, fz * 0.5);
    mul('neck', fx * 0.5, fy * 0.5, fz * 0.4);
    mul('head', fx * 0.4, fy * 0.3, fz * 0.3);
    // дыхание при ранении
    if (this.breath > 0.01) {
      const br = Math.sin(this.time * (5.5 + 2 * this.breath));
      mul('chest', -2.5 * this.breath * br, 0, 0);
      mul('spine', -1.5 * this.breath * br, 0, 0);
      mul('shoulderL', 0, 0, 2.2 * this.breath * br);
      mul('shoulderR', 0, 0, -2.2 * this.breath * br);
    }
    // поворот верха к цели
    const yaw = this.aimYaw / DEG, pitch = this.aimPitch / DEG;
    if (Math.abs(yaw) > 0.01 || Math.abs(pitch) > 0.01) {
      mul('spine', pitch * 0.25, yaw * 0.25, 0);
      mul('chest', pitch * 0.3, yaw * 0.3, 0);
      mul('neck', pitch * 0.2, yaw * 0.2, 0);
      mul('head', pitch * 0.25, yaw * 0.25, 0);
    }
  }
}
