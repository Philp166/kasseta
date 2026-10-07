// Враг: ИИ на Yuka. Поведение собирается из стандартных блоков фреймворка:
//  • StateMachine/State — состояния (патруль, тревога, погоня, кружение, атака, блок, оглушение, бегство);
//  • Vehicle + SteeringBehaviors (Seek, Arrive, Wander, Flee, Separation, ObstacleAvoidance) — перемещение;
//  • Vision/MemorySystem — зрение с конусом и преградами, память о последней позиции цели;
//  • FuzzyModule — «агрессия» из расстояния и здоровья (нападать / кружить / отступать).
// Физически врага двигает Rapier (Mover): Yuka выдаёт желаемую скорость, физика возвращает фактическое положение.

import * as THREE from 'three';
import {
  Vehicle, EntityManager, GameEntity, StateMachine, State, SeekBehavior, ArriveBehavior, WanderBehavior, FleeBehavior,
  SeparationBehavior, ObstacleAvoidanceBehavior, Vision, MemorySystem, Regulator, Vector3 as YVec,
  FuzzyModule, FuzzyVariable, LeftShoulderFuzzySet, TriangularFuzzySet, RightShoulderFuzzySet, FuzzyRule, FuzzyAND,
} from 'yuka';
import { Combatant, World } from './combatant';
import { Character } from '../character/character';
import type { HitInfo } from './damage';
import { DEG, RNG, clamp } from '../core/util';
import type { Variant } from '../animation/library';

export interface EnemyKind {
  name: string;
  hp: number;
  speedRun: number;
  speedWalk: number;
  dmg: number;
  heavyDmg: number;
  attackRange: number;
  cooldown: [number, number];
  armor: number;
  poise: number;
  blockChance: number;
  morale: number;
}

export const KINDS: Record<string, EnemyKind> = {
  raider: { name: 'Налётчик', hp: 80, speedRun: 3.6, speedWalk: 1.5, dmg: 13, heavyDmg: 22, attackRange: 2.35, cooldown: [1.1, 2.2], armor: 0.1, poise: 16, blockChance: 0.28, morale: 0.5 },
  veteran: { name: 'Ветеран', hp: 120, speedRun: 4.0, speedWalk: 1.6, dmg: 17, heavyDmg: 28, attackRange: 2.45, cooldown: [0.8, 1.6], armor: 0.2, poise: 22, blockChance: 0.42, morale: 0.85 },
};

const _yq = { x: 0, y: 0, z: 0, w: 1 };

export class Enemy extends Combatant {
  readonly vehicle = new Vehicle();
  readonly sm: StateMachine<Enemy>;
  readonly memory = new MemorySystem(this.vehicle);
  readonly vision: Vision;
  readonly regulator = new Regulator(6);
  readonly fuzzy = new FuzzyModule();
  readonly kind: EnemyKind;
  target: Combatant | null = null;
  home = new THREE.Vector3();
  lastSeen: THREE.Vector3 | null = null;
  cooldown = 0.8;
  stateTime = 0;
  strafeDir = 1;
  aggression = 50;
  heavyNext = false;
  attackDone = false;
  attackHit = false;
  alerted = false;
  fleeing = false;
  private seek = new SeekBehavior(new YVec());
  private arrive = new ArriveBehavior(new YVec(), 2.2, 0.5);
  private wander = new WanderBehavior(1.2, 3, 4);
  private flee = new FleeBehavior(new YVec(), 14);
  private separation = new SeparationBehavior();
  private avoid: ObstacleAvoidanceBehavior;
  readonly rng: RNG;
  private variant: Variant = 'n';
  private sees = false;

  constructor(world: World, character: Character, foot: THREE.Vector3, kind: EnemyKind, obstacles: GameEntity[], readonly manager: EntityManager, seed = 1) {
    super(world, character, foot, 'enemy');
    this.kind = kind;
    this.name = kind.name;
    this.rng = new RNG(seed * 131 + 7);
    this.home.copy(foot);
    this.dm.maxHp = kind.hp;
    this.dm.hp = kind.hp;
    this.armor = kind.armor;
    this.poise = kind.poise;
    this.weaponKind = 'spear';
    // Vehicle
    const v = this.vehicle;
    v.position.set(foot.x, foot.y, foot.z);
    v.maxSpeed = kind.speedRun;
    v.maxForce = 28;
    v.mass = 1;
    v.updateOrientation = false;
    v.boundingRadius = 0.45;
    v.neighborhoodRadius = 3.2;
    v.updateNeighborhood = true;
    this.avoid = new ObstacleAvoidanceBehavior(obstacles);
    this.avoid.dBoxMinLength = 3;
    for (const [b, w] of [[this.seek, 1], [this.arrive, 1], [this.wander, 0.6], [this.flee, 1], [this.separation, 0.9], [this.avoid, 2.2]] as const) {
      b.weight = w;
      b.active = false;
      v.steering.add(b);
    }
    this.separation.active = true;
    this.avoid.active = true;
    manager.add(v);
    // восприятие
    this.vision = new Vision(v);
    this.vision.fieldOfView = 125 * DEG;
    this.vision.range = 30;
    this.vision.obstacles = obstacles;
    this.memory.memorySpan = 7;
    this.setupFuzzy();
    // конечный автомат
    this.sm = new StateMachine<Enemy>(this);
    this.sm.add('Idle', new IdleS());
    this.sm.add('Alert', new AlertS());
    this.sm.add('Chase', new ChaseS());
    this.sm.add('Circle', new CircleS());
    this.sm.add('Attack', new AttackS());
    this.sm.add('Block', new BlockS());
    this.sm.add('Stagger', new StaggerS());
    this.sm.add('Flee', new FleeS());
    this.sm.changeTo('Idle');
  }

  // ---------- Нечёткая логика ----------

  private setupFuzzy(): void {
    const fm = this.fuzzy;
    const dist = new FuzzyVariable();
    const close = new LeftShoulderFuzzySet(0, 2.5, 5);
    const medium = new TriangularFuzzySet(2.5, 6, 11);
    const far = new RightShoulderFuzzySet(6, 12, 40);
    dist.add(close); dist.add(medium); dist.add(far);
    fm.addFLV('distance', dist);
    const hp = new FuzzyVariable();
    const low = new LeftShoulderFuzzySet(0, 20, 45);
    const ok = new TriangularFuzzySet(20, 50, 80);
    const high = new RightShoulderFuzzySet(50, 80, 101);
    hp.add(low); hp.add(ok); hp.add(high);
    fm.addFLV('health', hp);
    const ag = new FuzzyVariable();
    const retreat = new LeftShoulderFuzzySet(0, 15, 40);
    const hold = new TriangularFuzzySet(25, 50, 75);
    const attack = new RightShoulderFuzzySet(60, 85, 101);
    ag.add(retreat); ag.add(hold); ag.add(attack);
    fm.addFLV('aggression', ag);
    fm.addRule(new FuzzyRule(new FuzzyAND(close, high), attack));
    fm.addRule(new FuzzyRule(new FuzzyAND(close, ok), attack));
    fm.addRule(new FuzzyRule(new FuzzyAND(close, low), retreat));
    fm.addRule(new FuzzyRule(new FuzzyAND(medium, high), hold));
    fm.addRule(new FuzzyRule(new FuzzyAND(medium, ok), hold));
    fm.addRule(new FuzzyRule(new FuzzyAND(medium, low), retreat));
    fm.addRule(new FuzzyRule(far, attack));
  }

  evaluateAggression(): number {
    if (!this.target) return 50;
    const d = this.distanceTo(this.target);
    this.fuzzy.fuzzify('distance', Math.min(d, 39.9));
    this.fuzzy.fuzzify('health', Math.min(this.dm.health * 100, 100));
    this.aggression = this.fuzzy.defuzzify('aggression');
    return this.aggression;
  }

  // ---------- Восприятие ----------

  /** Видит ли цель (конус зрения + преграды). */
  canSee(t: Combatant): boolean {
    this.syncVehicle();
    const p = new YVec(t.position.x, t.position.y + 1.2, t.position.z);
    return this.vision.visible(p);
  }

  /** Синхронизировать Yuka-транспорт с реальным положением и поворотом. */
  syncVehicle(): void {
    const v = this.vehicle;
    v.position.set(this.position.x, this.position.y, this.position.z);
    const h = this.facing / 2;
    _yq.y = Math.sin(h); _yq.w = Math.cos(h);
    v.rotation.set(0, _yq.y, 0, _yq.w);
  }

  hear(point: THREE.Vector3, radius: number): void {
    if (this.dm.dead || this.alerted) return;
    if (Math.hypot(point.x - this.position.x, point.z - this.position.z) < radius) this.wake();
  }

  wake(): void {
    if (this.dm.dead) return;
    const player = this.world.enemiesOf(this)[0] ?? null;
    if (player && !this.target) this.target = player;
    if (!this.alerted) { this.alerted = true; if (this.sm.currentState === this.sm.get('Idle')) this.sm.changeTo('Alert'); }
  }

  // ---------- Управление ----------

  setBehaviors(o: { seek?: THREE.Vector3 | null; arrive?: THREE.Vector3 | null; wander?: boolean; flee?: THREE.Vector3 | null; maxSpeed?: number }): void {
    this.seek.active = !!o.seek;
    this.arrive.active = !!o.arrive;
    this.wander.active = !!o.wander;
    this.flee.active = !!o.flee;
    if (o.seek) this.seek.target.set(o.seek.x, o.seek.y, o.seek.z);
    if (o.arrive) this.arrive.target.set(o.arrive.x, o.arrive.y, o.arrive.z);
    if (o.flee) this.flee.target.set(o.flee.x, o.flee.y, o.flee.z);
    if (o.maxSpeed !== undefined) this.vehicle.maxSpeed = o.maxSpeed;
  }

  /** Применить результат шага Yuka к физике. */
  applySteering(dt: number, faceVelocity: boolean, turnRate = 9): void {
    const v = this.vehicle.velocity;
    const sp = Math.hypot(v.x, v.z);
    const dir = sp > 0.01 ? new THREE.Vector3(v.x / sp, 0, v.z / sp) : this.forward;
    if (faceVelocity && sp > 0.2) this.turnTo(Math.atan2(dir.x, dir.z), turnRate, dt);
    this.mover.desired.set(v.x, 0, v.z);
    this.speedNow = sp;
  }
  speedNow = 0;
  /** Через сколько секунд проснуться и пойти на героя (-1 — не задано). */
  wakeIn = -1;

  faceTarget(dt: number, rate = 8): void {
    if (!this.target) return;
    const t = this.target.position;
    this.turnTo(Math.atan2(t.x - this.position.x, t.z - this.position.z), rate, dt);
  }

  updateAnim(): void {
    const lim = this.dm.limp;
    let v: Variant = 'n';
    if (lim.level > 0.2 && lim.side) v = lim.side === 'L' ? 'lL' : 'lR';
    else if (this.dm.hurt > 0.35) v = 'h';
    this.variant = v;
    const hv = Math.hypot(this.mover.velocity.x, this.mover.velocity.z);
    this.character.animator.setLocomotion(hv, 'spear', v);
  }

  override interrupt(): void {
    const n = this.stateName;
    if (n === 'Attack' || n === 'Block' || n === 'Circle' || n === 'Chase' || n === 'Idle' || n === 'Alert') this.sm.changeTo('Stagger');
  }

  get stateName(): string {
    for (const [k, s] of this.sm.states) if (s === this.sm.currentState) return k;
    return '';
  }

  // ---------- Апдейт ----------

  override update(dt: number): void {
    if (this.dm.dead) return;
    this.tickCommon(dt);
    this.cooldown -= dt;
    this.stateTime += dt;
    if (this.wakeIn >= 0) { this.wakeIn -= dt; if (this.wakeIn < 0) this.wake(); }
    this.dtNow = dt;
    this.syncVehicle();
    // зрение — 6 раз в секунду
    if (this.regulator.ready() && this.target) {
      this.sees = this.canSee(this.target);
      if (this.sees) this.lastSeen = this.target.position.clone();
    } else if (!this.target) {
      const p = this.world.enemiesOf(this)[0];
      if (p && this.regulator.ready() && this.distanceTo(p) < 34 && this.canSee(p)) { this.target = p; this.sees = true; this.wake(); }
    }
    // реакция на оглушение
    if (this.stagger > 0 && this.stateName !== 'Stagger') this.sm.changeTo('Stagger');
    this.sm.update();
  }
  dtNow = 1 / 60;
  get seesTarget(): boolean { return this.sees; }

  /** После анимации: проверка попаданий оружия врага по цели. */
  override postAnimation(): void {
    if (this.dm.dead || this.stateName !== 'Attack' || !this.target) return;
    const a = this.character.animator;
    if (!a.inWindow('hit') || this.attackHit) return;
    const p0 = new THREE.Vector3(), p1 = new THREE.Vector3();
    if (!this.weaponSegment(p0, p1)) return;
    const t = this.target.hurt.testSegment(p0, p1, 0.1);
    if (!t) return;
    this.attackHit = true;
    const dir = new THREE.Vector3().subVectors(this.target.position, this.position).setY(0).normalize();
    const dmg = (this.heavyNext ? this.kind.heavyDmg : this.kind.dmg) * this.powerMul;
    const hit: HitInfo = {
      amount: dmg, region: t.box.region, point: t.point.clone(), dir, kind: 'pierce', knock: this.heavyNext ? 6 : 3.5,
      unblockable: false, source: this,
    };
    this.target.receiveHit(hit, this);
  }

  /** Сообщить союзникам рядом (групповая тревога). */
  alertAllies(radius = 18): void {
    for (const c of this.world.combatants) {
      if (c === this || c.team !== 'enemy' || c.dm.dead) continue;
      if (c instanceof Enemy && this.distanceTo(c) < radius) c.wake();
    }
  }

  override die(hit: HitInfo): void {
    this.manager.remove(this.vehicle);
    super.die(hit);
  }
}

// ======================= Состояния =======================

class IdleS extends State<Enemy> {
  override enter(o: Enemy): void {
    o.stateTime = 0;
    o.setBehaviors({ wander: true, maxSpeed: o.kind.speedWalk });
  }
  override execute(o: Enemy): void {
    const dt = o.dtNow;
    // не уходить далеко от «дома»
    const dh = Math.hypot(o.position.x - o.home.x, o.position.z - o.home.z);
    if (dh > 9) o.setBehaviors({ arrive: o.home, maxSpeed: o.kind.speedWalk });
    else o.setBehaviors({ wander: true, maxSpeed: o.kind.speedWalk });
    o.applySteering(dt, true, 3);
    o.updateAnim();
    if (o.target && o.seesTarget) { o.alerted = true; o.sm.changeTo('Alert'); }
  }
}

class AlertS extends State<Enemy> {
  override enter(o: Enemy): void {
    o.stateTime = 0;
    o.setBehaviors({});
    o.alerted = true;
    o.alertAllies();
  }
  override execute(o: Enemy): void {
    const dt = o.dtNow;
    o.mover.desired.set(0, 0, 0);
    o.faceTarget(dt, 7);
    o.updateAnim();
    if (o.stateTime > 0.55) o.sm.changeTo('Chase');
  }
}

class ChaseS extends State<Enemy> {
  override enter(o: Enemy): void { o.stateTime = 0; }
  override execute(o: Enemy): void {
    const dt = o.dtNow;
    const t = o.target;
    if (!t || t.dm.dead) { o.sm.changeTo('Idle'); return; }
    const d = o.distanceTo(t);
    const aim = o.seesTarget || !o.lastSeen ? t.position : o.lastSeen;
    const ag = o.evaluateAggression();
    // отступление при низкой агрессии
    if (o.dm.health < 0.22 && o.kind.morale < 0.7 && !o.fleeing && o.stateTime > 0.5) { o.fleeing = true; o.sm.changeTo('Flee'); return; }
    if (d > o.kind.attackRange * 1.15) {
      o.setBehaviors({ seek: aim, maxSpeed: o.kind.speedRun * (0.9 + 0.25 * (ag / 100)) });
      o.applySteering(dt, true);
    } else {
      // в зоне удара
      o.setBehaviors({ arrive: aim, maxSpeed: 1.2 });
      o.applySteering(dt, false);
      o.faceTarget(dt, 10);
      if (o.cooldown <= 0 && ag > 38) { o.sm.changeTo('Attack'); return; }
      if (d < 3.6) { o.strafeDir = o.rng.next() < 0.5 ? -1 : 1; o.sm.changeTo('Circle'); return; }
    }
    o.updateAnim();
    // блок против игрока, который замахивается рядом
    if (d < 3.2 && t instanceof Combatant && o.rng.next() < 0.01 * o.kind.blockChance * 8 && (t as unknown as { stateName?: string }).stateName === 'Attack') o.sm.changeTo('Block');
  }
}

class CircleS extends State<Enemy> {
  private until = 1.2;
  override enter(o: Enemy): void {
    o.stateTime = 0;
    this.until = 0.8 + o.rng.next() * 1.4;
    o.setBehaviors({});
  }
  override execute(o: Enemy): void {
    const dt = o.dtNow;
    const t = o.target;
    if (!t || t.dm.dead) { o.sm.changeTo('Idle'); return; }
    const to = new THREE.Vector3().subVectors(t.position, o.position).setY(0);
    const d = to.length();
    to.normalize();
    // тангенциальное смещение вокруг цели + удержание дистанции
    const tan = new THREE.Vector3(-to.z * o.strafeDir, 0, to.x * o.strafeDir);
    const ag = o.evaluateAggression();
    const want = ag < 35 ? 4.2 : 2.9;
    const radial = clamp((d - want) * 1.2, -2, 2);
    const v = tan.multiplyScalar(1.7).addScaledVector(to, radial);
    const vehicle = o.vehicle;
    vehicle.velocity.set(v.x, 0, v.z);
    o.applySteering(dt, false);
    o.faceTarget(dt, 9);
    o.updateAnim();
    if (o.dm.health < 0.22 && o.kind.morale < 0.7 && !o.fleeing) { o.fleeing = true; o.sm.changeTo('Flee'); return; }
    if (d > o.kind.attackRange * 2.4) { o.sm.changeTo('Chase'); return; }
    if (o.stateTime > this.until) {
      if (o.cooldown <= 0 && ag > 45 && d < o.kind.attackRange * 1.5) o.sm.changeTo('Attack');
      else if (ag < 35 && o.rng.next() < 0.3) o.sm.changeTo('Block');
      else { o.strafeDir *= -1; o.stateTime = 0; this.until = 0.6 + o.rng.next() * 1.2; }
    }
  }
}

class AttackS extends State<Enemy> {
  private phase: 'wind' | 'hold' | 'strike' | 'recover' = 'wind';
  private holdT = 0;
  private lunged = false;
  override enter(o: Enemy): void {
    o.stateTime = 0;
    o.attackDone = false;
    o.attackHit = false;
    o.heavyNext = o.rng.next() < 0.28;
    this.phase = 'wind';
    this.lunged = false;
    this.holdT = o.heavyNext ? 0.75 : 0.42 + o.rng.next() * 0.25;
    o.setBehaviors({});
    o.mover.desired.set(0, 0, 0);
    const clip = o.heavyNext ? 'spear.heavy' : 'spear.thrust';
    const shot = o.character.animator.playFull(clip, { speed: 1.0, fadeIn: 0.12, fadeOut: 0.18, onDone: () => { o.attackDone = true; } });
    (o as unknown as { shot: unknown }).shot = shot;
    o.world.fx.sparksAt(o.character.rig.b('handR').getWorldPosition(new THREE.Vector3()), new THREE.Vector3(0, 1, 0), 5);
  }
  override execute(o: Enemy): void {
    const dt = o.dtNow;
    const a = o.character.animator;
    const shot = a.fullClip!;
    const u = a.fullU() ?? 1;
    o.faceTarget(dt, this.phase === 'strike' ? 2 : 10);
    // телеграф: замах → пауза → быстрый удар
    const windEnd = o.heavyNext ? 0.38 : 0.24;
    if (this.phase === 'wind') {
      shot.speed = 0.75;
      if (u >= windEnd) { this.phase = 'hold'; shot.speed = 0.0; }
    } else if (this.phase === 'hold') {
      this.holdT -= dt;
      if (this.holdT <= 0) { this.phase = 'strike'; shot.speed = o.heavyNext ? 1.45 : 1.6; }
    } else if (this.phase === 'strike') {
      if (a.inWindow('lunge')) o.mover.desired.copy(o.forward).multiplyScalar(o.heavyNext ? 4.2 : 3.4);
      else o.mover.desired.set(0, 0, 0);
      if (u > 0.55) { this.phase = 'recover'; shot.speed = 0.9; }
    } else {
      o.mover.desired.set(0, 0, 0);
    }
    o.updateAnim();
    if (o.stagger > 0) { o.sm.changeTo('Stagger'); return; }
    if (o.attackDone) {
      o.cooldown = o.kind.cooldown[0] + o.rng.next() * (o.kind.cooldown[1] - o.kind.cooldown[0]);
      o.strafeDir = o.rng.next() < 0.5 ? -1 : 1;
      o.sm.changeTo('Circle');
    }
    void this.lunged;
  }
  override exit(o: Enemy): void {
    o.character.animator.stopFull(0.12);
  }
}

class BlockS extends State<Enemy> {
  private until = 0.8;
  override enter(o: Enemy): void {
    o.stateTime = 0;
    o.blocking = true;
    o.blockTime = 0;
    this.until = 0.6 + o.rng.next() * 0.7;
    o.character.animator.setOverlay('spear.block');
    o.setBehaviors({});
  }
  override execute(o: Enemy): void {
    const dt = o.dtNow;
    o.faceTarget(dt, 10);
    o.mover.desired.set(0, 0, 0);
    o.updateAnim();
    if (o.stateTime > this.until || o.stamina <= 0) o.sm.changeTo('Circle');
  }
  override exit(o: Enemy): void {
    o.blocking = false;
    o.character.animator.setOverlay(null);
  }
}

class StaggerS extends State<Enemy> {
  override enter(o: Enemy): void {
    o.character.animator.stopFull(0.05);
    o.character.animator.setOverlay(null);
    o.blocking = false;
    o.setBehaviors({});
  }
  override execute(o: Enemy): void {
    o.mover.desired.multiplyScalar(0.7);
    o.updateAnim();
    if (o.stagger <= 0) o.sm.changeTo(o.target ? 'Circle' : 'Idle');
  }
}

class FleeS extends State<Enemy> {
  override enter(o: Enemy): void { o.stateTime = 0; }
  override execute(o: Enemy): void {
    const dt = o.dtNow;
    const t = o.target;
    if (!t) { o.sm.changeTo('Idle'); return; }
    o.setBehaviors({ flee: t.position, maxSpeed: o.kind.speedRun * 1.2 });
    o.applySteering(dt, true, 12);
    o.updateAnim();
    // отдышался или загнан в угол
    if (o.stateTime > 4.5 || o.distanceTo(t) > 22) { o.fleeing = false; o.dm.heal(8); o.sm.changeTo('Chase'); }
  }
}

