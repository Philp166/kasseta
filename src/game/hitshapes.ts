// Хит-формы по костям: капсулы на голову, корпус, руки и ноги — попадания считаются по текущей позе скелета.
// Тесты «отрезок против капсулы» нужны для копья/стрел.

import * as THREE from 'three';
import { Rig } from '../character/rig';
import type { Region } from '../character/regions';

export interface Hurtbox {
  region: Region;
  a: THREE.Vector3;
  b: THREE.Vector3;
  radius: number;
}

type Def = { region: Region; from: string; to: string | THREE.Vector3; radius: number };

const HEAD_TOP = new THREE.Vector3(0, 0.2, 0.01);

export class HurtShapes {
  readonly boxes: Hurtbox[] = [];
  private defs: Def[];
  private rig: Rig;
  private tmp = new THREE.Vector3();

  constructor(rig: Rig, scale = 1) {
    this.rig = rig;
    this.defs = [
      { region: 'head', from: 'head', to: HEAD_TOP, radius: 0.14 * scale },
      { region: 'torso', from: 'hips', to: 'chest', radius: 0.21 * scale },
      { region: 'torso', from: 'chest', to: 'neck', radius: 0.19 * scale },
      { region: 'armL', from: 'upperArmL', to: 'lowerArmL', radius: 0.085 * scale },
      { region: 'armL', from: 'lowerArmL', to: 'handL', radius: 0.075 * scale },
      { region: 'armR', from: 'upperArmR', to: 'lowerArmR', radius: 0.085 * scale },
      { region: 'armR', from: 'lowerArmR', to: 'handR', radius: 0.075 * scale },
      { region: 'legL', from: 'upperLegL', to: 'lowerLegL', radius: 0.12 * scale },
      { region: 'legL', from: 'lowerLegL', to: 'footL', radius: 0.1 * scale },
      { region: 'legR', from: 'upperLegR', to: 'lowerLegR', radius: 0.12 * scale },
      { region: 'legR', from: 'lowerLegR', to: 'footR', radius: 0.1 * scale },
    ];
    for (const d of this.defs) this.boxes.push({ region: d.region, a: new THREE.Vector3(), b: new THREE.Vector3(), radius: d.radius });
  }

  /** Обновить капсулы по мировым позициям костей (вызывать после обновления скелета). */
  update(): void {
    this.rig.root.updateMatrixWorld(true);
    this.defs.forEach((d, i) => {
      const box = this.boxes[i];
      this.rig.b(d.from).getWorldPosition(box.a);
      if (typeof d.to === 'string') this.rig.b(d.to).getWorldPosition(box.b);
      else box.b.copy(d.to).applyMatrix4(this.rig.b(d.from).matrixWorld);
    });
  }

  /** Ближайшая точка между отрезком P0-P1 и капсулами; возвращает попадание с самым малым зазором. */
  testSegment(p0: THREE.Vector3, p1: THREE.Vector3, thickness: number): { box: Hurtbox; point: THREE.Vector3; dist: number } | null {
    let best: { box: Hurtbox; point: THREE.Vector3; dist: number } | null = null;
    for (const box of this.boxes) {
      const d = segSegDist(p0, p1, box.a, box.b, this.tmp);
      const gap = d - (box.radius + thickness);
      if (gap < 0 && (!best || gap < best.dist)) best = { box, point: this.tmp.clone(), dist: gap };
    }
    return best;
  }
}

const _d1 = new THREE.Vector3(), _d2 = new THREE.Vector3(), _r = new THREE.Vector3(), _c1 = new THREE.Vector3(), _c2 = new THREE.Vector3();

/** Расстояние между отрезками (p1,q1) и (p2,q2); в out — ближайшая точка на втором (капсуле). */
export function segSegDist(p1: THREE.Vector3, q1: THREE.Vector3, p2: THREE.Vector3, q2: THREE.Vector3, out: THREE.Vector3): number {
  _d1.subVectors(q1, p1);
  _d2.subVectors(q2, p2);
  _r.subVectors(p1, p2);
  const a = _d1.dot(_d1), e = _d2.dot(_d2), f = _d2.dot(_r);
  let s: number, t: number;
  const EPS = 1e-9;
  if (a <= EPS && e <= EPS) { s = t = 0; }
  else if (a <= EPS) { s = 0; t = clamp01(f / e); }
  else {
    const c = _d1.dot(_r);
    if (e <= EPS) { t = 0; s = clamp01(-c / a); }
    else {
      const b = _d1.dot(_d2);
      const denom = a * e - b * b;
      s = denom > EPS ? clamp01((b * f - c * e) / denom) : 0;
      t = (b * s + f) / e;
      if (t < 0) { t = 0; s = clamp01(-c / a); }
      else if (t > 1) { t = 1; s = clamp01((b - c) / a); }
    }
  }
  _c1.copy(p1).addScaledVector(_d1, s);
  _c2.copy(p2).addScaledVector(_d2, t);
  out.copy(_c2);
  return _c1.distanceTo(_c2);
}

const clamp01 = (x: number) => (x < 0 ? 0 : x > 1 ? 1 : x);
