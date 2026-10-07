// Боец: здоровье по регионам, выносливость, блок и парирование, реакция на удар, смерть → рэгдолл.
// Базовый класс для игрока и врагов.

import * as THREE from 'three';
import { Actor } from './actor';
import { DamageModel, HitInfo } from './damage';
import { HurtShapes } from './hitshapes';
import { Ragdoll } from '../physics/ragdoll';
import type { PhysicsWorld } from '../physics/world';
import type { EnvironmentLike } from './envTypes';
import type { FX } from './fx';
import type { FollowCamera } from './camera';
import { Character } from '../character/character';
import { Region } from '../character/regions';
import { clamp } from '../core/util';

export type WeaponKind = 'spear' | 'bow' | 'none';

/** Что бойцу нужно от мира (реализует Game). */
export interface World {
  pw: PhysicsWorld;
  env: EnvironmentLike;
  fx: FX;
  cam: FollowCamera;
  time: number;
  combatants: Combatant[];
  hitStop(seconds: number): void;
  announce(text: string, seconds?: number): void;
  onKill(victim: Combatant, hit: HitInfo): void;
  onHitLanded(attacker: Combatant | null, victim: Combatant, hit: HitInfo, res: HitResult): void;
  shootArrow(owner: Combatant, origin: THREE.Vector3, velocity: THREE.Vector3, damage: number): void;
  /** Живые враги игрока (для автонаведения и захвата цели). */
  enemiesOf(c: Combatant): Combatant[];
}

export interface HitResult {
  dealt: number;
  blocked: boolean;
  parried: boolean;
  killed: boolean;
  guardBroken: boolean;
  ignored: boolean;
}

const _v = new THREE.Vector3(), _w = new THREE.Vector3();

export abstract class Combatant extends Actor {
  readonly dm = new DamageModel();
  readonly hurt: HurtShapes;
  stamina = 100;
  maxStamina = 100;
  staminaDelay = 0;
  weaponKind: WeaponKind = 'spear';
  blocking = false;
  blockTime = 0;
  invuln = 0;
  /** Оглушение: пока >0, боец не действует. */
  stagger = 0;
  ragdoll: Ragdoll | null = null;
  /** Кого уже задели этим взмахом (чтобы не бить дважды). */
  swingHits = new Set<Combatant>();
  armor = 0;
  /** Сопротивление оглушению (порог урона). */
  poise = 14;
  name = 'боец';
  /** Скорость отдачи/сила ударов. */
  powerMul = 1;

  constructor(readonly world: World, character: Character, footPos: THREE.Vector3, readonly team: 'player' | 'enemy') {
    super(character, world.pw, footPos);
    this.faction = team;
    this.hurt = new HurtShapes(character.rig);
    this.character.group.userData.combatant = this;
  }

  /** Находится ли боец в состоянии, когда его нельзя бить (уклон). */
  get isInvulnerable(): boolean {
    return this.invuln > 0 || this.dm.dead;
  }

  // ---------- Оружие ----------

  /** Отрезок оружия (мир): от «ударной базы» до острия. */
  weaponSegment(a: THREE.Vector3, b: THREE.Vector3): boolean {
    const socket = this.character.sockets.handR;
    if (this.weaponKind !== 'spear') return false;
    const obj = this.character.carried('spear');
    if (!obj) return false;
    obj.updateWorldMatrix(true, false);
    const seg = (obj.userData.hitSegment as [THREE.Vector3, THREE.Vector3] | undefined) ?? [new THREE.Vector3(0, 0.35, 0), new THREE.Vector3(0, 1.15, 0)];
    a.copy(seg[0]).applyMatrix4(obj.matrixWorld);
    b.copy(seg[1]).applyMatrix4(obj.matrixWorld);
    void socket;
    return true;
  }

  // ---------- Получение удара ----------

  receiveHit(hit: HitInfo, attacker: Combatant | null = null): HitResult {
    const res: HitResult = { dealt: 0, blocked: false, parried: false, killed: false, guardBroken: false, ignored: false };
    if (this.isInvulnerable) { res.ignored = true; return res; }
    const w = this.world;
    const front = this.forward;
    const toAttacker = _v.copy(hit.dir).multiplyScalar(-1).setY(0).normalize();
    const facing = front.dot(toAttacker);
    // блок: только спереди, не для «неблокируемых»
    if (this.blocking && !hit.unblockable && facing > -0.2 && this.stagger <= 0) {
      const parry = this.blockTime < 0.24;
      res.blocked = true;
      res.parried = parry;
      const cost = parry ? 0 : hit.amount * 0.75;
      this.stamina -= cost;
      this.staminaDelay = 1.0;
      w.fx.sparksAt(hit.point, toAttacker.clone().setY(0.4).normalize(), parry ? 22 : 12);
      w.cam.addTrauma(parry ? 0.35 : 0.2);
      w.hitStop(parry ? 0.1 : 0.05);
      this.mover.push(hit.dir.clone().setY(0).normalize().multiplyScalar((hit.knock ?? 3) * 0.35));
      if (parry && attacker) {
        attacker.stagger = Math.max(attacker.stagger, 0.95);
        attacker.interrupt();
        w.announce('Парирование!', 0.8);
      }
      if (this.stamina <= 0) {
        res.guardBroken = true;
        this.stamina = 0;
        this.stagger = 0.8;
        this.blocking = false;
        this.interrupt();
        const r = this.dm.apply({ ...hit, amount: hit.amount * 0.4 }, this.armor);
        res.dealt = r.dealt;
        this.postDamage(hit, res, r.killed);
      }
      w.onHitLanded(attacker, this, hit, res);
      return res;
    }
    const r = this.dm.apply(hit, this.armor);
    res.dealt = r.dealt;
    res.killed = r.killed;
    this.postDamage(hit, res, r.killed);
    w.onHitLanded(attacker, this, hit, res);
    return res;
  }

  private postDamage(hit: HitInfo, res: HitResult, killed: boolean): void {
    const w = this.world;
    // раны, кровь
    this.character.addWound?.(hit.region, hit.point, hit.dir, hit.kind, Math.min(1, hit.amount / 30 + 0.3));
    w.fx.bloodBurst(hit.point, hit.dir.clone().setY(0.2), 0.7 + Math.min(1.5, hit.amount / 20));
    // отдача корпуса
    const local = _w.copy(hit.dir).applyAxisAngle(new THREE.Vector3(0, 1, 0), -this.facing);
    this.character.animator.flinch(local, clamp(hit.amount / 24, 0.35, 1.4));
    this.mover.push(hit.dir.clone().setY(0).normalize().multiplyScalar(hit.knock ?? 3));
    this.staminaDelay = Math.max(this.staminaDelay, 0.8);
    if (res.dealt >= this.poise && !killed) {
      this.stagger = Math.max(this.stagger, clamp(0.28 + res.dealt * 0.012, 0.3, 0.75));
      this.interrupt();
    }
    if (killed) this.die(hit);
  }

  /** Прервать текущее действие (атаку и т.п.) — реализуют наследники. */
  interrupt(): void {}

  /** Логика кадра (ИИ или ввод). */
  abstract update(dt: number): void;

  /** После обновления анимации: попадания оружия. */
  postAnimation(): void {}

  // ---------- Смерть ----------

  die(hit: HitInfo): void {
    if (this.ragdoll) return;
    this.dead = true;
    this.dm.dead = true;
    this.blocking = false;
    const a = this.character.animator;
    a.stopFull(0.01);
    a.setOverlay(null);
    const vel = this.mover.velocity.clone();
    vel.y = Math.max(vel.y, 0);
    this.character.group.updateMatrixWorld(true);
    this.ragdoll = new Ragdoll(this.world.pw, this.character, vel, {
      dir: hit.dir.clone().setY(0.15).normalize(),
      strength: 1.3 + (hit.knock ?? 3) * 0.55,
    });
    this.character.ragdollActive = true;
    this.mover.dispose();
    this.world.onKill(this, hit);
  }

  // ---------- Покадровые общие вещи ----------

  tickCommon(dt: number): void {
    if (this.invuln > 0) this.invuln -= dt;
    if (this.stagger > 0) this.stagger -= dt;
    if (this.blocking) this.blockTime += dt; else this.blockTime = 0;
    if (this.staminaDelay > 0) this.staminaDelay -= dt;
    else if (!this.blocking) this.stamina = Math.min(this.maxStamina, this.stamina + dt * (this.maxStamina * 0.2) * (1 - 0.5 * this.dm.hurt));
    // анимационные добавки от состояния
    this.character.animator.breath = clamp(Math.max((1 - this.stamina / this.maxStamina) * 0.7, this.dm.hurt * 0.9 - 0.1));
    this.character.damageVisuals?.sync(this.dm, dt);
  }

  updateRagdoll(dt: number): void {
    if (this.ragdoll) this.ragdoll.update(dt);
  }

  /** Горизонтальное расстояние до другого бойца. */
  distanceTo(o: Combatant): number {
    return Actor.dist2D(this.position, o.position);
  }

  /** Мировая позиция «центра массы». */
  center(out = new THREE.Vector3()): THREE.Vector3 {
    return out.copy(this.position).setY(this.position.y + 1.05);
  }

  regionAt(point: THREE.Vector3): Region {
    const t = this.hurt.testSegment(point, point, 0.3);
    return t ? t.box.region : 'torso';
  }
}
