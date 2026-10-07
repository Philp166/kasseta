// Игровой цикл: рендер + физика + ввод + камера + окружение + бойцы + эффекты.
// Game реализует World — то, что нужно бойцам от мира (физика, эффекты, события).

import * as THREE from 'three';
import { EntityManager, GameEntity } from 'yuka';
import { PhysicsWorld } from '../physics/world';
import { Input } from './input';
import { FollowCamera } from './camera';
import { Character } from '../character/character';
import { Player } from './player';
import { Enemy, KINDS } from './enemy';
import { Combatant, World, HitResult } from './combatant';
import { HitInfo } from './damage';
import { FX } from './fx';
import { Projectiles } from './projectiles';
import { createDevEnvironment } from './devEnv';
import type { EnvironmentLike } from './envTypes';
import { buildArrow } from '../character/gear';
import { RNG } from '../core/util';

export class Game implements World {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly input: Input;
  pw!: PhysicsWorld;
  cam!: FollowCamera;
  env!: EnvironmentLike;
  fx!: FX;
  projectiles!: Projectiles;
  player!: Player;
  readonly manager = new EntityManager();
  readonly combatants: Combatant[] = [];
  private obstacles: GameEntity[] = [];
  private last = performance.now();
  private running = false;
  time = 0;
  frame = 0;
  /** Эффективный dt текущего кадра (с хит-стопом) — читают состояния. */
  dtLast = 1 / 60;
  private hitStopT = 0;
  timeScale = 1;
  readonly hooks: Array<(dt: number) => void> = [];
  // состояние партии
  wave = 0;
  kills = 0;
  mode: 'play' | 'dead' = 'play';
  announcement: { text: string; t: number } | null = null;
  private waveTimer = 2.5;
  private rng = new RNG(2024);
  autoWaves = true;
  /** Пауза (стартовый экран, меню): мир не симулируется, камера медленно кружит вокруг героя. */
  paused = false;
  private idleLook = new THREE.Vector2();
  /** События для интерфейса. */
  readonly events = new EventTarget();

  constructor(readonly canvas: HTMLCanvasElement) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.0;
    this.input = new Input(canvas);
    window.addEventListener('resize', () => this.resize());
  }

  static async create(canvas: HTMLCanvasElement): Promise<Game> {
    const g = new Game(canvas);
    await g.init();
    return g;
  }

  async init(): Promise<void> {
    this.pw = await PhysicsWorld.create();
    this.cam = new FollowCamera(this.pw);
    this.env = createDevEnvironment(this.scene);
    this.buildWorldColliders();
    this.fx = new FX(this.scene, this.env);
    this.projectiles = new Projectiles(this.scene, this.pw, () => this.combatants, (t, hit) => {
      t.receiveHit(hit, (hit.source as Combatant) ?? null);
    });
    this.pw.onStep.push((dt) => {
      for (const c of this.combatants) if (!c.dm.dead) c.mover.fixedUpdate(dt);
    });
    this.spawnPlayer();
    this.resize();
  }

  spawnPlayer(): void {
    const ch = new Character({ outfit: 'evenki' });
    this.scene.add(ch.group);
    this.player = new Player(this, ch, this.env.spawnPlayer.clone());
    this.player.attach(this.input, this.cam);
    this.combatants.push(this.player);
    this.cam.yaw = 0;
  }

  buildWorldColliders(): void {
    const { pw, env } = this;
    pw.addTerrain(env.terrain);
    for (const t of env.trees) {
      pw.addStaticCylinder(t.x, t.y, t.z, t.radius, t.height);
      const e = new GameEntity();
      e.position.set(t.x, t.y, t.z);
      e.boundingRadius = t.radius + 0.45;
      this.obstacles.push(e);
    }
    for (const r of env.rocks) {
      pw.addStaticBall(r.x, r.y, r.z, r.radius);
      const e = new GameEntity();
      e.position.set(r.x, r.y, r.z);
      e.boundingRadius = r.radius + 0.4;
      this.obstacles.push(e);
    }
  }

  // ---------- World (для бойцов) ----------

  hitStop(seconds: number): void { this.hitStopT = Math.max(this.hitStopT, seconds); }

  announce(text: string, seconds = 2): void {
    this.announcement = { text, t: seconds };
    this.events.dispatchEvent(new CustomEvent('announce', { detail: text }));
  }

  enemiesOf(c: Combatant): Combatant[] {
    if (c.team === 'player') return this.combatants.filter((x) => x.team === 'enemy' && !x.dm.dead);
    return this.player && !this.player.dm.dead ? [this.player] : [];
  }

  onKill(victim: Combatant, hit: HitInfo): void {
    if (victim === this.player) {
      this.mode = 'dead';
      this.timeScale = 0.35;
      this.events.dispatchEvent(new CustomEvent('playerdead'));
    } else {
      this.kills++;
      this.events.dispatchEvent(new CustomEvent('kill', { detail: victim }));
    }
    void hit;
  }

  onHitLanded(attacker: Combatant | null, victim: Combatant, hit: HitInfo, res: HitResult): void {
    // враги рядом слышат бой
    if (victim.team === 'enemy') for (const e of this.combatants) if (e instanceof Enemy) e.hear(victim.position, 16);
    if (victim === this.player) this.cam.addTrauma(Math.min(0.9, 0.25 + res.dealt / 40));
    this.events.dispatchEvent(new CustomEvent('hit', { detail: { attacker, victim, hit, res } }));
  }

  shootArrow(owner: Combatant, origin: THREE.Vector3, velocity: THREE.Vector3, damage: number): void {
    const mesh = buildArrow(owner.team === 'enemy' ? 'raider' : 'hunter');
    this.projectiles.spawn({ pos: origin.clone(), vel: velocity.clone(), owner, damage, mesh });
    // враги слышат выстрел
    for (const e of this.combatants) if (e instanceof Enemy) e.hear(origin, 12);
  }

  // ---------- Враги и волны ----------

  spawnEnemy(pos: THREE.Vector3, kind = 'raider'): Enemy {
    const ch = new Character({ outfit: 'raider' });
    this.scene.add(ch.group);
    const e = new Enemy(this, ch, pos.clone(), KINDS[kind], this.obstacles, this.manager, this.rng.int(1, 99999));
    e.target = this.player;
    this.combatants.push(e);
    return e;
  }

  startWave(n: number): void {
    this.wave = n;
    const count = Math.min(9, 2 + n);
    const spawns = this.env.enemySpawns;
    const start = this.rng.int(0, spawns.length - 1);
    for (let i = 0; i < count; i++) {
      const p = spawns[(start + i * 2) % spawns.length];
      const kind = n >= 3 && i % 3 === 2 ? 'veteran' : 'raider';
      const e = this.spawnEnemy(p, kind);
      // волновые налётчики охотятся на героя — знают, где он
      e.wakeIn = 0.4 + i * 0.35;
    }
    this.announce(`Волна ${n}`, 2.5);
  }

  get aliveEnemies(): Enemy[] {
    return this.combatants.filter((c): c is Enemy => c instanceof Enemy && !c.dm.dead);
  }

  restart(): void {
    for (const c of this.combatants) {
      c.ragdoll?.dispose();
      if (!c.dm.dead) c.mover.dispose();
      c.character.group.removeFromParent();
      if (c instanceof Enemy) this.manager.remove(c.vehicle);
    }
    this.combatants.length = 0;
    this.wave = 0;
    this.kills = 0;
    this.mode = 'play';
    this.timeScale = 1;
    this.waveTimer = 2.5;
    this.spawnPlayer();
  }

  // ---------- Цикл ----------

  resize(): void {
    const w = window.innerWidth, h = window.innerHeight;
    this.renderer.setSize(w, h, false);
    this.cam?.setAspect(w / h);
    this.fx?.setScreenScale(h * this.renderer.getPixelRatio());
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    this.last = performance.now();
    const loop = (now: number) => {
      if (!this.running) return;
      const dt = Math.min((now - this.last) / 1000, 0.1);
      this.last = now;
      this.step(dt);
      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
  }

  stop(): void { this.running = false; }

  pause(): void { this.paused = true; }
  resume(): void { this.paused = false; }

  /** Кадр на паузе: герой дышит, камера плывёт, окружение живёт; боевая логика и физика стоят. */
  private stepPaused(dt: number, render: boolean): void {
    this.time += dt;
    this.frame++;
    this.input.poll();
    this.player.character.update(dt);
    this.idleLook.set(dt * 0.1, 0);
    const focus = this.player.position;
    this.cam.update(dt, focus, this.idleLook, 0, false);
    this.env.setShadowTarget(focus);
    this.env.update(dt, this.cam.camera);
    if (render) this.renderer.render(this.scene, this.cam.camera);
    this.input.endFrame();
  }

  /** Один кадр (можно вызывать вручную в тестах с произвольным dt; render=false — без отрисовки). */
  step(dt: number, render = true): void {
    if (this.paused) { this.stepPaused(dt, render); return; }
    this.time += dt;
    this.frame++;
    this.input.poll();
    if (this.input.pressed('restart') && this.mode === 'dead') this.restart();
    let sdt = dt * this.timeScale;
    if (this.hitStopT > 0) { this.hitStopT -= dt; sdt *= 0.08; }
    this.dtLast = sdt;
    if (this.announcement) { this.announcement.t -= dt; if (this.announcement.t <= 0) this.announcement = null; }

    // волны
    if (this.autoWaves && this.mode === 'play') {
      if (this.aliveEnemies.length === 0) {
        this.waveTimer -= dt;
        if (this.waveTimer <= 0) { this.startWave(this.wave + 1); this.waveTimer = 5; }
      }
    }

    // логика
    this.player.update(sdt);
    this.manager.update(sdt);
    for (const c of this.combatants) if (c !== this.player) c.update(sdt);
    this.pw.update(sdt);
    for (const c of this.combatants) {
      if (c.dm.dead) c.updateRagdoll(sdt);
      else c.syncVisual(this.pw.alpha);
    }
    for (const c of this.combatants) {
      c.character.update(sdt);
      c.hurt.update();
    }
    for (const c of this.combatants) c.postAnimation();
    this.projectiles.update(sdt);
    this.fx.update(sdt);
    for (const h of this.hooks) h(sdt);

    // камера
    const aimWanted = this.player.stateName === 'Draw' || this.player.stateName === 'Release';
    const focus = this.player.dm.dead && this.player.ragdoll ? this.ragdollFocus() : this.player.position;
    this.cam.update(dt, focus, this.input.look, this.input.wheel, aimWanted);
    this.env.setShadowTarget(focus);
    this.env.update(dt, this.cam.camera);
    if (render) this.renderer.render(this.scene, this.cam.camera);
    this.input.endFrame();
  }

  private ragdollFocus(): THREE.Vector3 {
    const t = this.player.ragdoll!.parts.get('pelvis')!.body.translation();
    return new THREE.Vector3(t.x, t.y - 1.0, t.z);
  }
}
