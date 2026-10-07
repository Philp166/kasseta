// Актор: персонаж + физическое тело + направление. Базовый класс игрока и врагов.

import * as THREE from 'three';
import { Character } from '../character/character';
import { Mover, PhysicsWorld } from '../physics/world';
import { lerp } from '../core/util';

export class Actor {
  readonly mover: Mover;
  /** Азимут взгляда персонажа: 0 — к +Z. */
  facing = 0;
  faction: 'player' | 'enemy' = 'enemy';
  dead = false;
  private visual = new THREE.Vector3();

  constructor(readonly character: Character, pw: PhysicsWorld, footPos: THREE.Vector3) {
    this.mover = new Mover(pw, footPos);
    this.facing = 0;
    this.character.group.position.copy(footPos);
  }

  /** Позиция подошв (шаг физики). */
  get position(): THREE.Vector3 { return this.mover.position; }

  get forward(): THREE.Vector3 { return new THREE.Vector3(Math.sin(this.facing), 0, Math.cos(this.facing)); }

  /** Плавный поворот к азимуту (рад/с). */
  turnTo(yaw: number, rate: number, dt: number): void {
    let d = yaw - this.facing;
    d = Math.atan2(Math.sin(d), Math.cos(d));
    const step = Math.sign(d) * Math.min(Math.abs(d), rate * dt);
    this.facing += step;
  }

  /** Горизонтальная скорость тела по направлению (в мировых осях). */
  setVelocity(dir: THREE.Vector3, speed: number): void {
    this.mover.desired.set(dir.x * speed, 0, dir.z * speed);
  }

  /** Привести визуал в соответствие физике (с интерполяцией). */
  syncVisual(alpha: number): void {
    this.mover.visualPosition(alpha, this.visual);
    this.character.group.position.copy(this.visual);
    this.character.group.rotation.y = this.facing;
  }

  dispose(): void {
    this.mover.dispose();
    this.character.group.removeFromParent();
  }

  static dist2D(a: THREE.Vector3, b: THREE.Vector3): number {
    return Math.hypot(a.x - b.x, a.z - b.z);
  }
}

export { lerp as _lerp };
