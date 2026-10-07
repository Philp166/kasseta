// Игрок: боевой конечный автомат на Yuka (StateMachine/State).
// Состояния: Loco (движение) → Attack (комбо копьём) / Block (блок, парирование) / Roll (уклон) / Draw (лук) / Release / Stagger.

import * as THREE from 'three';
import { State, StateMachine } from 'yuka';
import { Combatant, World } from './combatant';
import { Input } from './input';
import { FollowCamera } from './camera';
import { Character } from '../character/character';
import { HitInfo } from './damage';
import { mask, G } from '../physics/world';
import { segSegDist } from './hitshapes';
import type { Variant } from '../animation/library';
import { clamp, lerp, DEG } from '../core/util';

interface AttackDef { clip: string; speed: number; dmg: number; knock: number; kind: HitInfo['kind']; cost: number; lunge: number; multi: boolean }

const COMBO: AttackDef[] = [
  { clip: 'spear.thrust', speed: 1.18, dmg: 22, knock: 4.0, kind: 'pierce', cost: 9, lunge: 3.9, multi: false },
  { clip: 'spear.sweep', speed: 1.1, dmg: 19, knock: 5.0, kind: 'slash', cost: 11, lunge: 2.6, multi: true },
  { clip: 'spear.thrust', speed: 1.3, dmg: 27, knock: 5.0, kind: 'pierce', cost: 12, lunge: 4.3, multi: false },
];
const HEAVY: AttackDef = { clip: 'spear.heavy', speed: 1.0, dmg: 44, knock: 8.5, kind: 'slash', cost: 26, lunge: 4.6, multi: true };

const UP = new THREE.Vector3(0, 1, 0);

export class Player extends Combatant {
  readonly sm: StateMachine<Player>;
  input!: Input;
  cam!: FollowCamera;
  walkSpeed = 1.7;
  runSpeed = 4.2;
  sprintSpeed = 6.3;
  walkToggle = false;
  speed = 0;
  // боёвка
  combo = 0;
  queued = false;
  attackDone = false;
  attackDef: AttackDef = COMBO[0];
  heavyHold = 0;
  drawProgress = 0;
  rollDir = new THREE.Vector3(0, 0, 1);
  rollDone = false;
  swapTimer = 0;
  lockTarget: Combatant | null = null;
  kills = 0;
  private moveDir = new THREE.Vector3(0, 0, 1);
  private lunged = false;
  private releaseDone = false;
  private variant: Variant = 'n';

  constructor(world: World, character: Character, foot: THREE.Vector3) {
    super(world, character, foot, 'player');
    this.name = 'Воин';
    this.poise = 18;
    this.sm = new StateMachine<Player>(this);
    this.sm.add('Loco', new Loco());
    this.sm.add('Attack', new AttackState());
    this.sm.add('Block', new BlockState());
    this.sm.add('Roll', new RollState());
    this.sm.add('Draw', new DrawState());
    this.sm.add('Release', new ReleaseState());
    this.sm.add('Stagger', new StaggerState());
    this.sm.changeTo('Loco');
  }

  attach(input: Input, cam: FollowCamera): void {
    this.input = input;
    this.cam = cam;
  }

  get stateName(): string {
    for (const [k, v] of this.sm.states) if (v === this.sm.currentState) return k;
    return '';
  }

  // ---------- Помощники движения ----------

  /** Желаемое направление по вводу (мировое, нормализованное) и величина 0..1. */
  inputDir(out = new THREE.Vector3()): number {
    const m = this.input.move;
    const mag = Math.min(1, m.length());
    if (mag < 0.05) return 0;
    out.set(0, 0, 0).addScaledVector(this.cam.forward, m.y).addScaledVector(this.cam.right, m.x).normalize();
    return mag;
  }

  speedMul(): number {
    const lim = this.dm.limp;
    return (1 - 0.38 * lim.level) * (1 - 0.18 * this.dm.hurt);
  }

  /** Свободное движение: бег/шаг/спринт; лицом по ходу. */
  moveFree(dt: number, maxSprintAllowed = true): void {
    const mag = this.inputDir(this.moveDir);
    const gp = this.input;
    if (gp.pressed('walk')) this.walkToggle = !this.walkToggle;
    let target = 0;
    if (mag > 0) {
      target = this.walkToggle ? this.walkSpeed : this.runSpeed;
      const sprint = gp.down('sprint') && maxSprintAllowed && this.stamina > 4 && this.dm.limp.level < 0.7;
      if (sprint) { target = this.sprintSpeed; this.stamina -= 11 * dt; this.staminaDelay = 0.6; }
      target *= Math.max(0.35, mag) * this.speedMul();
    }
    this.speed = lerp(this.speed, target, 1 - Math.exp(-(target > this.speed ? 9 : 14) * dt));
    if (mag > 0) this.turnTo(Math.atan2(this.moveDir.x, this.moveDir.z), 13, dt);
    this.setVelocity(mag > 0 ? this.moveDir : this.forward, this.speed);
  }

  /** Движение лицом к камере (блок, прицеливание). */
  moveStrafe(dt: number, maxSpeed: number): void {
    const mag = this.inputDir(this.moveDir);
    this.turnTo(this.cam.yaw, 16, dt);
    const sp = mag > 0 ? maxSpeed * mag * this.speedMul() : 0;
    this.speed = lerp(this.speed, sp, 1 - Math.exp(-12 * dt));
    this.setVelocity(this.moveDir, this.speed);
  }

  /** Анимационные параметры походки по состоянию повреждений. */
  updateLocoAnim(): void {
    const lim = this.dm.limp;
    let v: Variant = 'n';
    if (lim.level > 0.2 && lim.side) v = lim.side === 'L' ? 'lL' : 'lR';
    else if (this.dm.hurt > 0.35) v = 'h';
    this.variant = v;
    const hv = Math.hypot(this.mover.velocity.x, this.mover.velocity.z);
    const carry = this.character.carry;
    this.character.animator.setLocomotion(hv, carry, v);
  }

  /** Ближайший враг в конусе перед игроком — для помощи прицеливания при атаке. */
  nearestEnemy(range: number, halfAngleDeg: number): Combatant | null {
    let best: Combatant | null = null, bd = range;
    const f = this.forward;
    for (const e of this.world.enemiesOf(this)) {
      if (e.dm.dead) continue;
      const d = this.distanceTo(e);
      if (d > bd) continue;
      const to = new THREE.Vector3().subVectors(e.position, this.position).setY(0).normalize();
      if (f.dot(to) < Math.cos(halfAngleDeg * DEG)) continue;
      best = e; bd = d;
    }
    return best;
  }

  toggleLock(): void {
    if (this.lockTarget) { this.lockTarget = null; this.cam.lockTarget = null; return; }
    let best: Combatant | null = null, bd = 22;
    for (const e of this.world.enemiesOf(this)) {
      if (e.dm.dead) continue;
      const d = this.distanceTo(e);
      if (d < bd) { bd = d; best = e; }
    }
    this.lockTarget = best;
  }

  override interrupt(): void {
    // оглушение ломает атаку/натяжение
    const n = this.stateName;
    if (n === 'Attack' || n === 'Draw' || n === 'Block' || n === 'Release') this.sm.changeTo('Stagger');
    else if (n === 'Loco') this.sm.changeTo('Stagger');
  }

  // ---------- Основной апдейт ----------

  override update(dt: number): void {
    if (this.dm.dead) return;
    this.tickCommon(dt);
    if (this.swapTimer > 0) this.swapTimer -= dt;
    // захват цели
    if (this.input.pressed('lock')) this.toggleLock();
    if (this.lockTarget && (this.lockTarget.dm.dead || this.distanceTo(this.lockTarget) > 28)) this.lockTarget = null;
    this.cam.lockTarget = this.lockTarget ? this.lockTarget.center() : null;
    this.sm.update();
    // лицо к цели в тяжёлые моменты — в самих состояниях
    // прицельная добавка аниматора: наклон по камере в режиме лука
    const a = this.character.animator;
    const aiming = this.stateName === 'Draw';
    a.aimPitch = aiming ? clamp(-this.cam.pitch + 0.05, -0.8, 0.8) : lerp(a.aimPitch, 0, 0.2);
    a.aimYaw = lerp(a.aimYaw, 0, 0.2);
  }

  /** После анимации: проверка попаданий оружия. */
  override postAnimation(): void {
    if (this.dm.dead) return;
    if (this.stateName === 'Attack') this.resolveMelee();
  }

  private resolveMelee(): void {
    const a = this.character.animator;
    if (!a.inWindow('hit')) return;
    const p0 = new THREE.Vector3(), p1 = new THREE.Vector3();
    if (!this.weaponSegment(p0, p1)) return;
    const def = this.attackDef;
    const cand: { c: Combatant; t: NonNullable<ReturnType<Combatant['hurt']['testSegment']>> }[] = [];
    for (const e of this.world.enemiesOf(this)) {
      if (e.dm.dead || this.swingHits.has(e)) continue;
      const t = e.hurt.testSegment(p0, p1, 0.1);
      if (t) cand.push({ c: e, t });
    }
    cand.sort((x, y) => this.distanceTo(x.c) - this.distanceTo(y.c));
    for (const { c, t } of cand) {
      if (!def.multi && this.swingHits.size > 0) break;
      this.swingHits.add(c);
      const dir = new THREE.Vector3().subVectors(c.position, this.position).setY(0).normalize();
      const weak = 1 - 0.5 * this.dm.weaponArmPenalty('R');
      const hit: HitInfo = {
        amount: def.dmg * weak * this.powerMul, region: t.box.region, point: t.point.clone(), dir,
        kind: def.kind, knock: def.knock, source: this,
      };
      const res = c.receiveHit(hit, this);
      if (!res.ignored) {
        this.world.hitStop(res.blocked ? 0.05 : res.killed ? 0.14 : 0.08);
        this.world.cam.addTrauma(res.killed ? 0.55 : 0.3);
        if (res.killed) this.kills++;
      }
    }
    void UP;
  }

  // ---------- Лук ----------

  /** Точка прицеливания: луч из центра камеры — по врагам и миру. */
  aimPoint(): THREE.Vector3 {
    const cam = this.cam.camera;
    const o = cam.getWorldPosition(new THREE.Vector3());
    const d = cam.getWorldDirection(new THREE.Vector3());
    let bestT = 80;
    const wh = this.world.pw.castRay(o, d, 80, mask(0xffff, G.WORLD | G.PROP));
    if (wh) bestT = wh.toi;
    const tmp = new THREE.Vector3();
    const far = o.clone().addScaledVector(d, 80);
    for (const e of this.world.enemiesOf(this)) {
      if (e.dm.dead) continue;
      for (const b of e.hurt.boxes) {
        const dist = segSegDist(o, far, b.a, b.b, tmp);
        if (dist < b.radius) {
          const t = tmp.distanceTo(o);
          if (t < bestT) bestT = t;
        }
      }
    }
    return o.addScaledVector(d, bestT);
  }

  nockWorld(): THREE.Vector3 {
    const bow = this.character.carried('bow');
    const out = new THREE.Vector3();
    if (bow) {
      bow.updateWorldMatrix(true, false);
      const nock = bow.userData.sockets?.nock as THREE.Object3D | undefined;
      if (nock) return nock.getWorldPosition(out);
      return out.set(0, 0, -0.17).applyMatrix4(bow.matrixWorld);
    }
    return this.character.rig.b('handR').getWorldPosition(out);
  }

  fireArrow(power: number): void {
    const from = this.nockWorld();
    const target = this.aimPoint();
    const dir = target.sub(from).normalize();
    const speed = 20 + 34 * power;
    this.world.shootArrow(this, from, dir.multiplyScalar(speed), 28 * (0.5 + power) * (1 - 0.4 * this.dm.weaponArmPenalty('L')));
  }

  // ---------- Внутренние флаги для состояний ----------
  resetAttackFlags(): void { this.queued = false; this.attackDone = false; this.lunged = false; this.swingHits.clear(); }
  get lungedFlag(): boolean { return this.lunged; }
  set lungedFlag(v: boolean) { this.lunged = v; }
  get releaseFlag(): boolean { return this.releaseDone; }
  set releaseFlag(v: boolean) { this.releaseDone = v; }
  get variantNow(): Variant { return this.variant; }
}

// ======================= Состояния =======================

class Loco extends State<Player> {
  override enter(o: Player): void {
    o.blocking = false;
    o.character.animator.setOverlay(null);
    o.heavyHold = 0;
  }
  override execute(o: Player): void {
    const dt = 1 / 60; // реальный dt берётся из ввода/скорости ниже
    void dt;
    const step = (o.world as unknown as { dtLast?: number }).dtLast ?? 1 / 60;
    if (o.stagger > 0) { o.sm.changeTo('Stagger'); return; }
    o.moveFree(step);
    o.updateLocoAnim();
    const inp = o.input;
    // смена оружия
    if (inp.pressed('swap') && o.swapTimer <= 0) {
      o.swapTimer = 0.6;
      const next = o.character.carry === 'spear' ? 'bow' : 'spear';
      o.weaponKind = next;
      // чуть позже (визуальная «смена»)
      setTimeout(() => o.character.setCarry(next), 140);
      o.character.animator.flinch(new THREE.Vector3(0, 0, -1), 0.35);
      return;
    }
    if (inp.pressed('dodge') && o.stamina >= 18) { o.sm.changeTo('Roll'); return; }
    if (o.weaponKind === 'spear') {
      // тап — лёгкая атака; удержание — тяжёлая
      if (inp.down('attack')) o.heavyHold += step; else o.heavyHold = 0;
      if (inp.pressed('attack') && o.stamina >= 8) {
        o.combo = 0;
        o.attackDef = COMBO[0];
        o.sm.changeTo('Attack');
        return;
      }
      if (inp.down('attack') && o.heavyHold > 0.32 && o.stamina >= 24) {
        o.attackDef = HEAVY;
        o.combo = -1;
        o.sm.changeTo('Attack');
        return;
      }
      if (inp.down('block') && o.stamina > 5) { o.sm.changeTo('Block'); return; }
    } else if (o.weaponKind === 'bow') {
      if (inp.pressed('attack') && o.stamina >= 6) { o.sm.changeTo('Draw'); return; }
    }
  }
}

class AttackState extends State<Player> {
  private t = 0;
  override enter(o: Player): void {
    o.resetAttackFlags();
    const def = o.attackDef;
    o.stamina -= def.cost;
    o.staminaDelay = 0.9;
    // помощь прицеливанию: разворот к ближайшему врагу
    const tgt = o.lockTarget && !o.lockTarget.dm.dead ? o.lockTarget : o.nearestEnemy(4.2, 75);
    if (tgt) o.facing = Math.atan2(tgt.position.x - o.position.x, tgt.position.z - o.position.z);
    else {
      const d = new THREE.Vector3();
      if (o.inputDir(d) > 0) o.facing = Math.atan2(d.x, d.z);
    }
    const slow = 1 - 0.35 * o.dm.weaponArmPenalty('R');
    o.character.animator.playFull(def.clip, { speed: def.speed * slow, fadeIn: 0.06, fadeOut: 0.12, onDone: () => { o.attackDone = true; } });
    this.t = 0;
  }
  override execute(o: Player): void {
    const a = o.character.animator;
    const step = (o.world as unknown as { dtLast?: number }).dtLast ?? 1 / 60;
    this.t += step;
    const u = a.fullU() ?? 1;
    o.updateLocoAnim();
    // шаг вперёд в окне выпада; до этого — слабое управление
    if (a.inWindow('lunge')) {
      o.setVelocity(o.forward, o.attackDef.lunge * (1 - 0.3 * o.dm.limp.level));
    } else {
      o.mover.desired.multiplyScalar(0.6);
      o.speed *= 0.9;
    }
    if (o.input.pressed('attack') && u > 0.25) o.queued = true;
    if (o.input.pressed('dodge') && u > 0.5 && o.stamina >= 18) { a.stopFull(0.06); o.sm.changeTo('Roll'); return; }
    if (o.stagger > 0) { o.sm.changeTo('Stagger'); return; }
    if (o.attackDone || (u > 0.82 && o.queued)) {
      if (o.queued && o.combo >= 0 && o.stamina >= 8) {
        o.combo = (o.combo + 1) % COMBO.length;
        o.attackDef = COMBO[o.combo];
        o.sm.changeTo('Attack');
        // повторный вход в то же состояние: Yuka не повторяет enter при changeTo того же состояния — сделаем вручную
        this.enter(o);
      } else {
        o.sm.changeTo('Loco');
      }
    }
  }
  override exit(o: Player): void {
    o.character.animator.stopFull(0.12);
  }
}

class BlockState extends State<Player> {
  override enter(o: Player): void {
    o.blocking = true;
    o.blockTime = 0;
    o.character.animator.setOverlay('spear.block');
  }
  override execute(o: Player): void {
    const step = (o.world as unknown as { dtLast?: number }).dtLast ?? 1 / 60;
    if (o.stagger > 0) { o.sm.changeTo('Stagger'); return; }
    o.moveStrafe(step, 1.7);
    o.updateLocoAnim();
    if (o.input.pressed('dodge') && o.stamina >= 18) { o.sm.changeTo('Roll'); return; }
    if (!o.input.down('block') || o.stamina <= 0.5) o.sm.changeTo('Loco');
  }
  override exit(o: Player): void {
    o.blocking = false;
    o.character.animator.setOverlay(null);
  }
}

class RollState extends State<Player> {
  private t = 0;
  override enter(o: Player): void {
    o.stamina -= 20;
    o.staminaDelay = 1.0;
    o.invuln = 0.55;
    o.blocking = false;
    const d = new THREE.Vector3();
    if (o.inputDir(d) > 0) o.rollDir.copy(d); else o.rollDir.copy(o.forward);
    o.facing = Math.atan2(o.rollDir.x, o.rollDir.z);
    o.rollDone = false;
    o.character.animator.setOverlay(null);
    o.character.animator.playFull('roll', { speed: 1.0, fadeIn: 0.05, fadeOut: 0.12, onDone: () => { o.rollDone = true; } });
    o.world.fx.puff(o.position.clone().setY(o.position.y + 0.1), 6);
    this.t = 0;
  }
  override execute(o: Player): void {
    const step = (o.world as unknown as { dtLast?: number }).dtLast ?? 1 / 60;
    const u = o.character.animator.fullU() ?? 1;
    const k = u < 0.08 ? u / 0.08 : u > 0.82 ? Math.max(0, (1 - u) / 0.18) : 1;
    o.setVelocity(o.rollDir, 5.6 * k * (1 - 0.35 * o.dm.limp.level));
    o.speed = 4;
    o.character.animator.setLocomotion(0, o.character.carry, o.variantNow);
    void step;
    if (o.rollDone) o.sm.changeTo('Loco');
  }
  override exit(o: Player): void {
    o.character.animator.stopFull(0.1);
    o.invuln = Math.max(o.invuln, 0.05);
  }
}

class DrawState extends State<Player> {
  private cancelled = false;
  override enter(o: Player): void {
    o.drawProgress = 0;
    this.cancelled = false;
    o.character.animator.playFull('bow.draw', { manual: true, fadeIn: 0.12, fadeOut: 0.12, loop: false });
  }
  override execute(o: Player): void {
    const step = (o.world as unknown as { dtLast?: number }).dtLast ?? 1 / 60;
    const a = o.character.animator;
    if (o.stagger > 0) { o.sm.changeTo('Stagger'); return; }
    o.moveStrafe(step, 1.6);
    o.updateLocoAnim();
    const slow = 1 + 0.9 * o.dm.weaponArmPenalty('L');
    o.drawProgress = Math.min(1, o.drawProgress + step / (0.82 * slow));
    a.scrub(o.drawProgress);
    if (o.drawProgress >= 1) {
      o.stamina -= 3.5 * step;
      o.staminaDelay = 0.5;
      o.world.cam.addTrauma(0.012);
      if (o.stamina <= 0) { this.cancelled = true; }
    }
    if (o.input.pressed('block')) this.cancelled = true;
    if (this.cancelled) { o.sm.changeTo('Loco'); return; }
    if (o.input.released('attack')) {
      if (o.drawProgress >= 0.28) { o.fireArrow(o.drawProgress); o.sm.changeTo('Release'); }
      else o.sm.changeTo('Loco');
    }
  }
  override exit(o: Player): void {
    o.character.animator.stopFull(0.1);
  }
}

class ReleaseState extends State<Player> {
  override enter(o: Player): void {
    o.releaseFlag = false;
    o.world.cam.addTrauma(0.12);
    o.character.animator.playFull('bow.release', { fadeIn: 0.02, fadeOut: 0.1, onDone: () => { o.releaseFlag = true; } });
  }
  override execute(o: Player): void {
    const step = (o.world as unknown as { dtLast?: number }).dtLast ?? 1 / 60;
    o.moveStrafe(step, 1.3);
    o.updateLocoAnim();
    if (o.stagger > 0) { o.sm.changeTo('Stagger'); return; }
    if (o.releaseFlag) o.sm.changeTo('Loco');
  }
  override exit(o: Player): void {
    o.character.animator.stopFull(0.1);
  }
}

class StaggerState extends State<Player> {
  override enter(o: Player): void {
    o.blocking = false;
    o.character.animator.stopFull(0.05);
    o.character.animator.setOverlay(null);
    o.speed *= 0.3;
  }
  override execute(o: Player): void {
    o.mover.desired.multiplyScalar(0.8);
    o.updateLocoAnim();
    if (o.stagger <= 0) o.sm.changeTo('Loco');
  }
}
