// Рэгдолл на Rapier: при смерти скелет заменяется набором динамических капсул, связанных суставами.
// Тела создаются из текущей позы (ориентация тела = мировая ориентация кости), поэтому подгонка не нужна:
// кости просто берут вращение тел. Локти и колени — шарниры с пределами, плечи/бёдра/шея — сферические суставы.

import * as THREE from 'three';
import { PhysicsWorld, RAPIER, G, mask } from './world';
import { Character } from '../character/character';

interface Part {
  name: string;
  bone: THREE.Bone;
  body: RAPIER.RigidBody;
  /** Смещение центра тела от начала кости в системе кости. */
  center: THREE.Vector3;
}

const v = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
const _q = new THREE.Quaternion(), _q2 = new THREE.Quaternion(), _p = new THREE.Vector3(), _p2 = new THREE.Vector3();

export class Ragdoll {
  readonly parts = new Map<string, Part>();
  private joints: RAPIER.ImpulseJoint[] = [];
  private order: string[] = [];
  settledTime = 0;
  age = 0;

  constructor(private pw: PhysicsWorld, readonly character: Character, velocity: THREE.Vector3, impulse?: { dir: THREE.Vector3; strength: number; point?: THREE.Vector3 }) {
    const rig = character.rig;
    rig.root.updateMatrixWorld(true);
    character.group.updateMatrixWorld(true);
    const wpos = (n: string) => rig.b(n).getWorldPosition(new THREE.Vector3());
    const wq = (n: string) => rig.b(n).getWorldQuaternion(new THREE.Quaternion());

    // сегмент: [тело, кость, конец сегмента (кость | локальная точка), радиус, плотность, смещение-вращение капсулы]
    const defs: Array<{ name: string; bone: string; to: string | THREE.Vector3; r: number; d: number; along?: 'y' | 'z'; extend?: number }> = [
      { name: 'pelvis', bone: 'hips', to: v(0, 0.17, 0), r: 0.14, d: 900 },
      { name: 'torso', bone: 'spine', to: 'neck', r: 0.155, d: 800 },
      { name: 'head', bone: 'head', to: v(0, 0.2, 0.01), r: 0.115, d: 700 },
      { name: 'upperArmL', bone: 'upperArmL', to: 'lowerArmL', r: 0.05, d: 900 },
      { name: 'lowerArmL', bone: 'lowerArmL', to: 'handL', r: 0.045, d: 900, extend: 0.08 },
      { name: 'upperArmR', bone: 'upperArmR', to: 'lowerArmR', r: 0.05, d: 900 },
      { name: 'lowerArmR', bone: 'lowerArmR', to: 'handR', r: 0.045, d: 900, extend: 0.08 },
      { name: 'upperLegL', bone: 'upperLegL', to: 'lowerLegL', r: 0.078, d: 900 },
      { name: 'lowerLegL', bone: 'lowerLegL', to: 'footL', r: 0.062, d: 900 },
      { name: 'upperLegR', bone: 'upperLegR', to: 'lowerLegR', r: 0.078, d: 900 },
      { name: 'lowerLegR', bone: 'lowerLegR', to: 'footR', r: 0.062, d: 900 },
      { name: 'footL', bone: 'footL', to: v(0, -0.045, 0.2), r: 0.045, d: 600, along: 'z' },
      { name: 'footR', bone: 'footR', to: v(0, -0.045, 0.2), r: 0.045, d: 600, along: 'z' },
    ];

    const world = pw.world;
    for (const d of defs) {
      const bone = rig.b(d.bone);
      const q = wq(d.bone);
      const p0 = wpos(d.bone);
      // конец сегмента в системе кости
      const endLocal = typeof d.to === 'string'
        ? wpos(d.to).sub(p0).applyQuaternion(_q.copy(q).invert())
        : d.to.clone();
      if (d.extend) endLocal.addScaledVector(endLocal.clone().normalize(), d.extend);
      const center = endLocal.clone().multiplyScalar(0.5);
      const len = endLocal.length();
      const worldCenter = p0.clone().add(center.clone().applyQuaternion(q));
      const body = world.createRigidBody(
        RAPIER.RigidBodyDesc.dynamic()
          .setTranslation(worldCenter.x, worldCenter.y, worldCenter.z)
          .setRotation({ x: q.x, y: q.y, z: q.z, w: q.w })
          .setLinvel(velocity.x, velocity.y, velocity.z)
          .setLinearDamping(0.25)
          .setAngularDamping(2.2)
          .setCcdEnabled(true),
      );
      // капсула вдоль сегмента: ось Y капсулы → направление сегмента (в системе кости)
      const dir = endLocal.clone().normalize();
      const rotQ = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir);
      const half = Math.max(0.001, len / 2 - d.r);
      world.createCollider(
        RAPIER.ColliderDesc.capsule(half, d.r)
          .setTranslation(center.x, center.y, center.z)
          .setRotation({ x: rotQ.x, y: rotQ.y, z: rotQ.z, w: rotQ.w })
          .setDensity(d.d)
          .setFriction(0.9)
          .setRestitution(0.05)
          .setCollisionGroups(mask(G.RAGDOLL, G.WORLD | G.PROP)),
        body,
      );
      this.parts.set(d.name, { name: d.name, bone, body, center });
      this.order.push(d.name);
    }

    // суставы
    const bodyOf = (n: string) => this.parts.get(n)!;
    const localPoint = (part: Part, world: THREE.Vector3): { x: number; y: number; z: number } => {
      const t = part.body.translation(), r = part.body.rotation();
      _q.set(r.x, r.y, r.z, r.w).invert();
      _p.set(world.x - t.x, world.y - t.y, world.z - t.z).applyQuaternion(_q);
      return { x: _p.x, y: _p.y, z: _p.z };
    };
    const sph = (a: string, b: string, jointBone: string) => {
      const A = bodyOf(a), B = bodyOf(b);
      const J = wpos(jointBone);
      this.joints.push(world.createImpulseJoint(RAPIER.JointData.spherical(localPoint(A, J), localPoint(B, J)), A.body, B.body, true));
    };
    const hinge = (a: string, b: string, jointBone: string, min: number, max: number) => {
      const A = bodyOf(a), B = bodyOf(b);
      const J = wpos(jointBone);
      // ось шарнира — локальная X кости-родителя в мире; в системе каждого тела (ориентация тела = ориентация кости)
      const axis = { x: 1, y: 0, z: 0 };
      const j = world.createImpulseJoint(RAPIER.JointData.revolute(localPoint(A, J), localPoint(B, J), axis), A.body, B.body, true) as RAPIER.RevoluteImpulseJoint;
      j.setLimits(min, max);
      this.joints.push(j);
    };
    sph('pelvis', 'torso', 'spine');
    sph('torso', 'head', 'head');
    sph('torso', 'upperArmL', 'upperArmL');
    sph('torso', 'upperArmR', 'upperArmR');
    hinge('upperArmL', 'lowerArmL', 'lowerArmL', -2.45, 0.08);
    hinge('upperArmR', 'lowerArmR', 'lowerArmR', -2.45, 0.08);
    sph('pelvis', 'upperLegL', 'upperLegL');
    sph('pelvis', 'upperLegR', 'upperLegR');
    hinge('upperLegL', 'lowerLegL', 'lowerLegL', -0.08, 2.5);
    hinge('upperLegR', 'lowerLegR', 'lowerLegR', -0.08, 2.5);
    hinge('lowerLegL', 'footL', 'footL', -0.8, 0.8);
    hinge('lowerLegR', 'footR', 'footR', -0.8, 0.8);

    // удар
    if (impulse) {
      const strength = impulse.strength;
      for (const [n, k] of [['torso', 1], ['pelvis', 0.7], ['head', 0.45]] as const) {
        const p = bodyOf(n);
        const m = p.body.mass();
        p.body.applyImpulse({ x: impulse.dir.x * strength * m * k, y: (impulse.dir.y * strength + 1.6 * strength * 0.25) * m * k, z: impulse.dir.z * strength * m * k }, true);
      }
    }
    // небольшое вращение
    bodyOf('torso').body.applyTorqueImpulse({ x: (Math.random() - 0.5) * 2, y: (Math.random() - 0.5) * 2, z: (Math.random() - 0.5) * 2 }, true);
  }

  /** Перенести вращения тел на кости (вызывать после world.step). */
  update(dt: number): void {
    this.age += dt;
    const rig = this.character.rig;
    const root = rig.root;
    root.updateMatrixWorld(true);
    // порядок: родители раньше детей
    const apply = (name: string, parentName: string) => {
      const part = this.parts.get(name)!;
      const r = part.body.rotation();
      _q.set(r.x, r.y, r.z, r.w);
      const bone = part.bone;
      bone.parent!.updateWorldMatrix(true, false);
      bone.parent!.getWorldQuaternion(_q2);
      bone.quaternion.copy(_q2).invert().multiply(_q);
      bone.updateMatrixWorld(true);
      void parentName;
    };
    // бёдра — положение и вращение
    const pel = this.parts.get('pelvis')!;
    {
      const t = pel.body.translation(), r = pel.body.rotation();
      _q.set(r.x, r.y, r.z, r.w);
      // начало кости бёдер = центр тела − центр·вращение
      _p.copy(pel.center).applyQuaternion(_q);
      const wp = _p2.set(t.x - _p.x, t.y - _p.y, t.z - _p.z);
      const hips = pel.bone;
      root.updateMatrixWorld(true);
      const inv = new THREE.Matrix4().copy(root.matrixWorld).invert();
      hips.position.copy(wp.applyMatrix4(inv));
      root.getWorldQuaternion(_q2);
      hips.quaternion.copy(_q2).invert().multiply(_q);
      hips.updateMatrixWorld(true);
    }
    apply('torso', 'pelvis');
    // грудь следует торсу
    const chest = rig.b('chest');
    chest.quaternion.identity();
    chest.updateMatrixWorld(true);
    // шея — без поворота, голова — от тела
    rig.b('neck').quaternion.identity();
    rig.b('neck').updateMatrixWorld(true);
    apply('head', 'torso');
    for (const s of ['L', 'R']) {
      rig.b('shoulder' + s).quaternion.identity();
      rig.b('shoulder' + s).updateMatrixWorld(true);
      apply('upperArm' + s, 'torso');
      apply('lowerArm' + s, 'upperArm' + s);
      rig.b('hand' + s).quaternion.identity();
      apply('upperLeg' + s, 'pelvis');
      apply('lowerLeg' + s, 'upperLeg' + s);
      apply('foot' + s, 'lowerLeg' + s);
    }
    // «успокоился»: линейная скорость таза мала
    const lv = pel.body.linvel();
    if (Math.hypot(lv.x, lv.y, lv.z) < 0.15) this.settledTime += dt; else this.settledTime = 0;
  }

  get settled(): boolean {
    return this.settledTime > 1.2;
  }

  dispose(): void {
    for (const j of this.joints) this.pw.world.removeImpulseJoint(j, false);
    for (const p of this.parts.values()) this.pw.world.removeRigidBody(p.body);
    this.parts.clear();
    this.joints = [];
  }
}
