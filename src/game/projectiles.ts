// Стрелы: баллистика с подшагами, лучи по миру (Rapier) и тесты по хит-капсулам бойцов; застревают в цели или земле.

import * as THREE from 'three';
import { PhysicsWorld, mask, G } from '../physics/world';
import type { Combatant } from './combatant';
import type { HitInfo } from './damage';
import { REGIONS } from '../character/regions';

export interface ArrowInit {
  pos: THREE.Vector3;
  vel: THREE.Vector3;
  owner: Combatant;
  damage: number;
  mesh: THREE.Object3D;
}

interface Arrow extends ArrowInit {
  stuck: boolean;
  life: number;
  parent?: THREE.Object3D;
}

const UP = new THREE.Vector3(0, 1, 0);

export class Projectiles {
  private arrows: Arrow[] = [];
  /** Радиус «толщины» стрелы для попаданий. */
  thickness = 0.04;

  constructor(private scene: THREE.Scene, private pw: PhysicsWorld, private targets: () => Combatant[], private onHit: (target: Combatant, hit: HitInfo) => void) {}

  spawn(a: ArrowInit): void {
    this.scene.add(a.mesh);
    const arrow: Arrow = { ...a, stuck: false, life: 25 };
    this.arrows.push(arrow);
    this.orient(arrow);
  }

  private orient(a: Arrow): void {
    const d = a.vel.clone();
    if (d.lengthSq() < 1e-6) return;
    d.normalize();
    // меш стрелы: ось +Y вдоль древка, остриё на +Y
    a.mesh.quaternion.setFromUnitVectors(UP, d);
    a.mesh.position.copy(a.pos);
  }

  update(dt: number): void {
    const next: Arrow[] = [];
    for (const a of this.arrows) {
      a.life -= dt;
      if (a.life <= 0) { a.mesh.removeFromParent(); continue; }
      if (a.stuck) { next.push(a); continue; }
      const sub = 3;
      const h = dt / sub;
      let alive = true;
      for (let s = 0; s < sub && alive; s++) {
        const p0 = a.pos.clone();
        a.vel.y -= 9.81 * 0.55 * h;
        a.vel.multiplyScalar(Math.exp(-0.05 * h));
        const p1 = p0.clone().addScaledVector(a.vel, h);
        // бойцы
        let best: { c: Combatant; box: ReturnType<Combatant['hurt']['testSegment']> } | null = null;
        for (const c of this.targets()) {
          if (c === a.owner || c.dm.dead) continue;
          const t = c.hurt.testSegment(p0, p1, this.thickness);
          if (t && (!best || (t.dist < (best.box?.dist ?? 0)))) best = { c, box: t };
        }
        // мир
        const dir = a.vel.clone().normalize();
        const len = p0.distanceTo(p1);
        const wh = this.pw.castRay(p0, dir, len + 0.02, mask(0xffff, G.WORLD | G.PROP));
        if (best && (!wh || best.box!.point.distanceTo(p0) <= wh.toi + 0.3)) {
          const speed = a.vel.length();
          const hit: HitInfo = {
            amount: a.damage * Math.min(1.2, speed / 28), region: best.box!.box.region, point: best.box!.point.clone(),
            dir: dir.clone(), kind: 'arrow', knock: 2.2, source: a.owner,
          };
          this.onHit(best.c, hit);
          a.pos.copy(best.box!.point);
          a.stuck = true; alive = false;
          // воткнуть в кость цели
          const bone = best.c.character.rig.b(boneForRegion(best.box!.box.region));
          a.mesh.removeFromParent();
          bone.add(a.mesh);
          const inv = new THREE.Matrix4().copy(bone.matrixWorld).invert();
          a.mesh.position.copy(a.pos.clone().addScaledVector(dir, 0.08).applyMatrix4(inv));
          const q = new THREE.Quaternion();
          bone.getWorldQuaternion(q);
          a.mesh.quaternion.copy(q.invert().multiply(new THREE.Quaternion().setFromUnitVectors(UP, dir)));
          a.life = 12;
        } else if (wh) {
          a.pos.copy(wh.point).addScaledVector(dir, 0.1);
          a.stuck = true; alive = false;
          a.mesh.position.copy(a.pos);
          a.life = 20;
        } else a.pos.copy(p1);
      }
      if (!a.stuck) this.orient(a);
      next.push(a);
    }
    this.arrows = next;
  }
}

function boneForRegion(r: (typeof REGIONS)[number]): string {
  switch (r) {
    case 'head': return 'head';
    case 'torso': return 'chest';
    case 'armL': return 'lowerArmL';
    case 'armR': return 'lowerArmR';
    case 'legL': return 'lowerLegL';
    case 'legR': return 'lowerLegR';
  }
}
