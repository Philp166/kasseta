// Пружинные кости (вторичная динамика): волосы, хвост шкуры, подол кафтана, обереги.
// Верле-симуляция «хвостов» костей в мировых координатах (как в VRM spring bone): инерция, жёсткость к позе покоя,
// сопротивление, гравитация, ветер и столкновения с капсулами тела. Кости цепочки поворачиваются так, чтобы смотреть на симулированный хвост.

import * as THREE from 'three';
import { Rig, SECONDARY_PREFIXES, BONE_SPECS } from '../character/rig';

export interface SpringSettings {
  /** Возврат к позе покоя (0..1+). */
  stiffness: number;
  /** Сопротивление движению (0..1). */
  drag: number;
  /** Гравитация, м/с (вниз по -Y). */
  gravity: number;
  /** Радиус столкновения хвоста. */
  hitRadius: number;
}

export interface SpringCollider {
  bone: THREE.Object3D;
  /** Смещение центра (локально в кости). */
  offset: THREE.Vector3;
  /** Если задан — капсула от offset до tail (локально). */
  tail?: THREE.Vector3;
  radius: number;
}

class Joint {
  readonly boneAxis = new THREE.Vector3();
  readonly length: number;
  readonly initialQuat: THREE.Quaternion;
  readonly currentTail = new THREE.Vector3();
  readonly prevTail = new THREE.Vector3();
  constructor(readonly bone: THREE.Object3D, child: THREE.Object3D | null, parentDir: THREE.Vector3, readonly settings: SpringSettings) {
    if (child) {
      this.boneAxis.copy(child.position);
      this.length = Math.max(1e-4, this.boneAxis.length());
      this.boneAxis.normalize();
    } else {
      // хвостовая кость: продолжаем направление родителя
      this.boneAxis.copy(parentDir).normalize();
      this.length = 0.07;
    }
    this.initialQuat = bone.quaternion.clone();
  }
}

const _wp = new THREE.Vector3(), _rest = new THREE.Vector3(), _dir = new THREE.Vector3(), _tmp = new THREE.Vector3();
const _pq = new THREE.Quaternion(), _rq = new THREE.Quaternion(), _nq = new THREE.Quaternion(), _cq = new THREE.Quaternion();
const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _c = new THREE.Vector3(), _n = new THREE.Vector3();

export class SpringBones {
  private chains: Joint[][] = [];
  private colliders: SpringCollider[] = [];
  enabled = true;
  wind = new THREE.Vector3();
  private needInit = true;
  private t = 0;

  constructor(private rig: Rig, defs: { prefix: string; settings: SpringSettings }[], colliders: SpringCollider[]) {
    this.colliders = colliders;
    for (const d of defs) {
      // цепочки по префиксу: name_1, name_2, ...
      const groups = new Map<string, string[]>();
      for (const s of BONE_SPECS) {
        if (!s.name.startsWith(d.prefix)) continue;
        const m = s.name.match(/^(.*)_(\d+)$/);
        if (m) groups.set(m[1], [...(groups.get(m[1]) ?? []), s.name]);
        else if (s.name.startsWith(d.prefix) && SECONDARY_PREFIXES.some((p) => s.name.startsWith(p)) && !/_\d+$/.test(s.name)) groups.set(s.name, [s.name]);
      }
      for (const [, names] of groups) {
        const joints: Joint[] = [];
        let prevDir = new THREE.Vector3(0, names[0].startsWith('ear') ? 1 : -1, 0);
        for (let i = 0; i < names.length; i++) {
          const bone = rig.b(names[i]);
          const child = i + 1 < names.length ? rig.b(names[i + 1]) : null;
          const j = new Joint(bone, child, prevDir, d.settings);
          prevDir = j.boneAxis.clone();
          joints.push(j);
        }
        this.chains.push(joints);
      }
    }
  }

  /** Сбросить хвосты в позу покоя (после телепорта/загрузки). */
  reset(): void {
    this.needInit = true;
  }

  private init(): void {
    this.rig.root.updateMatrixWorld(true);
    for (const chain of this.chains) {
      for (const j of chain) {
        j.bone.quaternion.copy(j.initialQuat);
        j.bone.updateMatrixWorld(true);
        this.restTail(j, j.currentTail);
        j.prevTail.copy(j.currentTail);
      }
    }
    this.needInit = false;
  }

  private restTail(j: Joint, out: THREE.Vector3): THREE.Vector3 {
    const bone = j.bone;
    bone.parent!.getWorldQuaternion(_pq);
    _rq.copy(_pq).multiply(j.initialQuat);
    bone.getWorldPosition(_wp);
    return out.copy(j.boneAxis).applyQuaternion(_rq).multiplyScalar(j.length).add(_wp);
  }

  private cA: THREE.Vector3[] = [];
  private cB: THREE.Vector3[] = [];

  update(dt: number): void {
    if (!this.enabled) return;
    if (this.needInit) this.init();
    // подшаги фиксированной длины для устойчивости
    const sub = Math.min(Math.ceil(dt / (1 / 90)), 4);
    const h = dt / sub;
    // коллайдеры сидят на костях, которые пружины не двигают — считаем один раз за кадр
    this.rig.root.updateMatrixWorld(true);
    for (let i = 0; i < this.colliders.length; i++) {
      const c = this.colliders[i];
      if (!this.cA[i]) { this.cA[i] = new THREE.Vector3(); this.cB[i] = new THREE.Vector3(); }
      this.cA[i].copy(c.offset).applyMatrix4(c.bone.matrixWorld);
      if (c.tail) this.cB[i].copy(c.tail).applyMatrix4(c.bone.matrixWorld);
    }
    for (let s = 0; s < sub; s++) this.step(h);
  }

  private step(dt: number): void {
    this.t += dt;
    for (const chain of this.chains) {
      for (const j of chain) {
        const bone = j.bone;
        bone.parent!.getWorldQuaternion(_pq);
        _rq.copy(_pq).multiply(j.initialQuat);
        // голова кости (по матрице родителя и локальной позиции)
        _wp.copy(bone.position).applyMatrix4(bone.parent!.matrixWorld);
        // направление покоя
        _rest.copy(j.boneAxis).applyQuaternion(_rq);
        const st = j.settings;
        // инерция + жёсткость + гравитация + ветер
        _tmp.subVectors(j.currentTail, j.prevTail).multiplyScalar(1 - st.drag);
        _dir.copy(j.currentTail).add(_tmp).addScaledVector(_rest, st.stiffness * dt * 12 * 0.5);
        _dir.y -= st.gravity * dt * dt * 0.5 * 2;
        if (this.wind.lengthSq() > 0) _dir.addScaledVector(this.wind, dt * dt);
        // длина кости
        _dir.sub(_wp);
        if (_dir.lengthSq() < 1e-10) _dir.copy(_rest);
        _dir.normalize().multiplyScalar(j.length).add(_wp);
        // столкновения
        const r = st.hitRadius;
        for (let ci = 0; ci < this.colliders.length; ci++) {
          const c = this.colliders[ci];
          _a.copy(this.cA[ci]);
          let cx: THREE.Vector3;
          if (c.tail) {
            _b.copy(this.cB[ci]);
            // ближайшая точка отрезка a-b к хвосту
            _c.subVectors(_b, _a);
            const l2 = _c.lengthSq();
            const tt = l2 > 1e-9 ? THREE.MathUtils.clamp(_n.subVectors(_dir, _a).dot(_c) / l2, 0, 1) : 0;
            cx = _n.copy(_a).addScaledVector(_c, tt);
          } else cx = _n.copy(_a);
          const rad = c.radius + r;
          _tmp.subVectors(_dir, cx);
          const d2 = _tmp.lengthSq();
          if (d2 < rad * rad) {
            const d = Math.sqrt(d2) || 1e-6;
            _dir.copy(cx).addScaledVector(_tmp, rad / d);
            // сохранить длину кости
            _tmp.subVectors(_dir, _wp).normalize().multiplyScalar(j.length);
            _dir.copy(_wp).add(_tmp);
          }
        }
        j.prevTail.copy(j.currentTail);
        j.currentTail.copy(_dir);
        // повернуть кость к хвосту
        _tmp.subVectors(j.currentTail, _wp).normalize();
        _nq.setFromUnitVectors(_rest, _tmp);
        _cq.copy(_nq).multiply(_rq);
        bone.quaternion.copy(_pq).invert().multiply(_cq);
        bone.updateMatrixWorld(true);
      }
    }
  }
}

// ---------- Стандартные настройки персонажа ----------

export const SPRING_DEFS: { prefix: string; settings: SpringSettings }[] = [
  { prefix: 'hair', settings: { stiffness: 0.22, drag: 0.28, gravity: 9, hitRadius: 0.02 } },
  { prefix: 'pelt', settings: { stiffness: 0.2, drag: 0.4, gravity: 11, hitRadius: 0.035 } },
  { prefix: 'ear', settings: { stiffness: 0.7, drag: 0.4, gravity: 3, hitRadius: 0.01 } },
  { prefix: 'skirt', settings: { stiffness: 0.36, drag: 0.35, gravity: 9, hitRadius: 0.03 } },
  { prefix: 'medal', settings: { stiffness: 0.12, drag: 0.22, gravity: 9, hitRadius: 0.01 } },
  { prefix: 'fang', settings: { stiffness: 0.12, drag: 0.22, gravity: 9, hitRadius: 0.01 } },
  { prefix: 'featherBelt', settings: { stiffness: 0.18, drag: 0.25, gravity: 8, hitRadius: 0.01 } },
  { prefix: 'strap', settings: { stiffness: 0.25, drag: 0.3, gravity: 8, hitRadius: 0.01 } },
];

/** Капсулы тела для столкновений с подолом, накидкой и волосами. */
export function bodyColliders(rig: Rig): SpringCollider[] {
  const v = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
  const out: SpringCollider[] = [];
  const addLimb = (upper: string, lower: string, r1: number) => {
    const u = rig.b(upper), l = rig.b(lower);
    out.push({ bone: u, offset: v(0, 0, 0), tail: l.position.clone(), radius: r1 });
  };
  addLimb('upperLegL', 'lowerLegL', 0.115);
  addLimb('upperLegR', 'lowerLegR', 0.115);
  addLimb('lowerLegL', 'footL', 0.1);
  addLimb('lowerLegR', 'footR', 0.1);
  // торс: бёдра → грудь
  out.push({ bone: rig.b('hips'), offset: v(0, 0.02, 0), tail: v(0, 0.28, 0.0), radius: 0.17 });
  out.push({ bone: rig.b('chest'), offset: v(0, 0.0, 0.0), tail: v(0, 0.24, 0), radius: 0.18 });
  out.push({ bone: rig.b('head'), offset: v(0, 0.08, 0.01), radius: 0.12 });
  out.push({ bone: rig.b('upperArmL'), offset: v(0, 0, 0), tail: rig.b('lowerArmL').position.clone(), radius: 0.075 });
  out.push({ bone: rig.b('upperArmR'), offset: v(0, 0, 0), tail: rig.b('lowerArmR').position.clone(), radius: 0.075 });
  return out;
}
