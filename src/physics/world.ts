// Физика на Rapier: мир с фиксированным шагом, статика (рельеф, деревья, скалы), динамика (брёвна, ящики),
// рейкасты и контроллер персонажа (KinematicCharacterController: капсула, шаги по ступенькам, склоны, толчки).

import RAPIER from '@dimforge/rapier3d-compat';
import * as THREE from 'three';
import type { TerrainData } from '../game/envTypes';

export { RAPIER };

/** Группы столкновений (биты). */
export const G = {
  WORLD: 0x0001,
  CHAR: 0x0002,
  RAGDOLL: 0x0004,
  PROP: 0x0008,
  PROJ: 0x0010,
} as const;

/** Rapier InteractionGroups: старшие 16 бит — «кто я», младшие — «с кем сталкиваюсь». */
export const mask = (member: number, filter: number) => (((member & 0xffff) << 16) | (filter & 0xffff)) >>> 0;

export interface RayHit {
  toi: number;
  point: THREE.Vector3;
  normal: THREE.Vector3;
  collider: RAPIER.Collider;
}

export class PhysicsWorld {
  readonly world: RAPIER.World;
  readonly fixedDt = 1 / 60;
  private acc = 0;
  /** Вызывается перед каждым фиксированным шагом симуляции. */
  readonly onStep: Array<(dt: number) => void> = [];
  /** Доля шага (0..1) для интерполяции визуала. */
  alpha = 0;
  timeScale = 1;

  private constructor(world: RAPIER.World) {
    this.world = world;
  }

  static async create(gravityY = -9.81): Promise<PhysicsWorld> {
    await RAPIER.init();
    const world = new RAPIER.World({ x: 0, y: gravityY, z: 0 });
    world.timestep = 1 / 60;
    return new PhysicsWorld(world);
  }

  /** Продвинуть физику на dt секунд (с накоплением и ограничением числа шагов). */
  update(frameDt: number): void {
    this.acc += Math.min(frameDt, 0.1) * this.timeScale;
    let steps = 0;
    while (this.acc >= this.fixedDt && steps < 5) {
      for (const f of this.onStep) f(this.fixedDt);
      this.world.step();
      this.acc -= this.fixedDt;
      steps++;
    }
    if (steps === 5) this.acc = 0;
    this.alpha = this.acc / this.fixedDt;
  }

  // ---------- Статика ----------

  /** Рельеф как trimesh из тех же вершин, что рисует рендер. */
  addTerrain(t: TerrainData): RAPIER.Collider {
    const n = t.segments + 1;
    const step = t.size / t.segments;
    const verts = new Float32Array(n * n * 3);
    for (let i = 0; i < n; i++) {
      for (let j = 0; j < n; j++) {
        const k = (i * n + j) * 3;
        verts[k] = t.originX + j * step;
        verts[k + 1] = t.heights[i * n + j];
        verts[k + 2] = t.originZ + i * step;
      }
    }
    const idx = new Uint32Array(t.segments * t.segments * 6);
    let p = 0;
    for (let i = 0; i < t.segments; i++) {
      for (let j = 0; j < t.segments; j++) {
        const a = i * n + j, b = (i + 1) * n + j, c = i * n + j + 1, d = (i + 1) * n + j + 1;
        idx[p++] = a; idx[p++] = b; idx[p++] = c;
        idx[p++] = c; idx[p++] = b; idx[p++] = d;
      }
    }
    const desc = RAPIER.ColliderDesc.trimesh(verts, idx)
      .setFriction(1)
      .setCollisionGroups(mask(G.WORLD, 0xffff));
    return this.world.createCollider(desc);
  }

  addStaticCylinder(x: number, y: number, z: number, radius: number, height: number): RAPIER.Collider {
    const desc = RAPIER.ColliderDesc.cylinder(height / 2, radius)
      .setTranslation(x, y + height / 2, z)
      .setCollisionGroups(mask(G.WORLD, 0xffff));
    return this.world.createCollider(desc);
  }

  addStaticBall(x: number, y: number, z: number, radius: number): RAPIER.Collider {
    const desc = RAPIER.ColliderDesc.ball(radius)
      .setTranslation(x, y, z)
      .setCollisionGroups(mask(G.WORLD, 0xffff));
    return this.world.createCollider(desc);
  }

  // ---------- Динамика ----------

  addDynamicBox(pos: THREE.Vector3, quat: THREE.Quaternion, size: THREE.Vector3, density = 400): { body: RAPIER.RigidBody; collider: RAPIER.Collider } {
    const body = this.world.createRigidBody(
      RAPIER.RigidBodyDesc.dynamic()
        .setTranslation(pos.x, pos.y, pos.z)
        .setRotation({ x: quat.x, y: quat.y, z: quat.z, w: quat.w })
        .setLinearDamping(0.15)
        .setAngularDamping(0.4)
        .setCanSleep(true),
    );
    const collider = this.world.createCollider(
      RAPIER.ColliderDesc.cuboid(size.x / 2, size.y / 2, size.z / 2)
        .setDensity(density)
        .setFriction(0.8)
        .setRestitution(0.1)
        .setCollisionGroups(mask(G.PROP, G.WORLD | G.CHAR | G.PROP | G.RAGDOLL)),
      body,
    );
    return { body, collider };
  }

  addDynamicCylinder(pos: THREE.Vector3, quat: THREE.Quaternion, radius: number, length: number, density = 450): { body: RAPIER.RigidBody; collider: RAPIER.Collider } {
    // цилиндр Rapier ориентирован вдоль Y — бревно кладётся поворотом тела
    const body = this.world.createRigidBody(
      RAPIER.RigidBodyDesc.dynamic()
        .setTranslation(pos.x, pos.y, pos.z)
        .setRotation({ x: quat.x, y: quat.y, z: quat.z, w: quat.w })
        .setLinearDamping(0.15)
        .setAngularDamping(0.5),
    );
    const collider = this.world.createCollider(
      RAPIER.ColliderDesc.cylinder(length / 2, radius)
        .setDensity(density)
        .setFriction(0.8)
        .setRestitution(0.1)
        .setCollisionGroups(mask(G.PROP, G.WORLD | G.CHAR | G.PROP | G.RAGDOLL)),
      body,
    );
    return { body, collider };
  }

  // ---------- Запросы ----------

  /** Луч по заданным группам (по умолчанию — только мир). Направление должно быть нормализовано. */
  castRay(origin: THREE.Vector3, dir: THREE.Vector3, maxToi: number, filter = mask(0xffff, G.WORLD), excludeCollider?: RAPIER.Collider): RayHit | null {
    const ray = new RAPIER.Ray({ x: origin.x, y: origin.y, z: origin.z }, { x: dir.x, y: dir.y, z: dir.z });
    const hit = this.world.castRayAndGetNormal(ray, maxToi, true, undefined, filter, excludeCollider);
    if (!hit) return null;
    return {
      toi: hit.timeOfImpact,
      point: new THREE.Vector3(origin.x + dir.x * hit.timeOfImpact, origin.y + dir.y * hit.timeOfImpact, origin.z + dir.z * hit.timeOfImpact),
      normal: new THREE.Vector3(hit.normal.x, hit.normal.y, hit.normal.z),
      collider: hit.collider,
    };
  }

  /** Высота поверхности мира под точкой (луч сверху вниз) — для проверки совпадения с рендером. */
  groundY(x: number, z: number, fromY = 200): number | null {
    const h = this.castRay(new THREE.Vector3(x, fromY, z), new THREE.Vector3(0, -1, 0), fromY + 50);
    return h ? h.point.y : null;
  }

  /** Отладочные линии физики (для визуализации). */
  debugBuffers(): { vertices: Float32Array; colors: Float32Array } {
    const b = this.world.debugRender();
    return { vertices: b.vertices, colors: b.colors };
  }
}

// ---------- Контроллер персонажа ----------

export interface MoverOptions {
  radius?: number;
  /** Половина высоты цилиндрической части капсулы. */
  halfHeight?: number;
  mass?: number;
  groups?: number;
  /** С кем сталкивается контроллер. */
  filter?: number;
}

/** Капсула с KinematicCharacterController: гравитация, шаги по ступенькам, скольжение по склонам, толчки. */
export class Mover {
  readonly body: RAPIER.RigidBody;
  readonly collider: RAPIER.Collider;
  readonly controller: RAPIER.KinematicCharacterController;
  readonly radius: number;
  readonly halfHeight: number;
  /** Смещение от центра капсулы до подошвы. */
  readonly footOffset: number;
  /** Желаемая горизонтальная скорость (м/с), выставляется игровой логикой каждый кадр. */
  desired = new THREE.Vector3();
  /** Внешняя скорость (отбрасывание), затухает. */
  knock = new THREE.Vector3();
  vy = 0;
  grounded = false;
  groundNormal = new THREE.Vector3(0, 1, 0);
  /** Фактическая скорость за последний шаг. */
  velocity = new THREE.Vector3();
  gravity = 9.81;
  private prev = new THREE.Vector3();
  private curr = new THREE.Vector3();
  private filter: number;

  constructor(private pw: PhysicsWorld, footPos: THREE.Vector3, o: MoverOptions = {}) {
    this.radius = o.radius ?? 0.3;
    this.halfHeight = o.halfHeight ?? 0.55;
    this.footOffset = this.halfHeight + this.radius;
    this.filter = o.filter ?? mask(G.CHAR, G.WORLD | G.PROP | G.CHAR);
    this.body = pw.world.createRigidBody(
      RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(footPos.x, footPos.y + this.footOffset, footPos.z),
    );
    this.collider = pw.world.createCollider(
      RAPIER.ColliderDesc.capsule(this.halfHeight, this.radius)
        .setCollisionGroups(o.groups ?? mask(G.CHAR, G.WORLD | G.PROP | G.CHAR))
        .setFriction(0),
      this.body,
    );
    const c = pw.world.createCharacterController(0.02);
    c.setUp({ x: 0, y: 1, z: 0 });
    c.setSlideEnabled(true);
    c.enableAutostep(0.36, 0.12, true);
    c.enableSnapToGround(0.28);
    c.setMaxSlopeClimbAngle((52 * Math.PI) / 180);
    c.setMinSlopeSlideAngle((38 * Math.PI) / 180);
    c.setApplyImpulsesToDynamicBodies(true);
    c.setCharacterMass(o.mass ?? 80);
    this.controller = c;
    this.curr.copy(footPos);
    this.prev.copy(footPos);
  }

  /** Позиция подошв (шаг физики). */
  get position(): THREE.Vector3 {
    return this.curr;
  }

  /** Позиция подошв, сглаженная между шагами. */
  visualPosition(alpha: number, out = new THREE.Vector3()): THREE.Vector3 {
    return out.lerpVectors(this.prev, this.curr, alpha);
  }

  teleport(footPos: THREE.Vector3): void {
    this.body.setTranslation({ x: footPos.x, y: footPos.y + this.footOffset, z: footPos.z }, true);
    this.body.setNextKinematicTranslation({ x: footPos.x, y: footPos.y + this.footOffset, z: footPos.z });
    this.curr.copy(footPos);
    this.prev.copy(footPos);
    this.vy = 0;
    this.knock.set(0, 0, 0);
  }

  /** Фиксированный шаг: вызывается перед world.step(). */
  fixedUpdate(dt: number): void {
    // гравитация
    if (this.grounded && this.vy <= 0) this.vy = -2; // прижим к земле
    else this.vy -= this.gravity * dt;
    this.vy = Math.max(this.vy, -40);
    // затухание отбрасывания
    const kd = Math.exp(-6 * dt);
    this.knock.x *= kd;
    this.knock.z *= kd;
    if (this.grounded) this.knock.y *= kd;
    const dx = (this.desired.x + this.knock.x) * dt;
    const dz = (this.desired.z + this.knock.z) * dt;
    const dy = (this.vy + this.knock.y) * dt;
    this.controller.computeColliderMovement(this.collider, { x: dx, y: dy, z: dz }, undefined, this.filter);
    const m = this.controller.computedMovement();
    this.grounded = this.controller.computedGrounded();
    const t = this.body.translation();
    const nx = t.x + m.x, ny = t.y + m.y, nz = t.z + m.z;
    this.body.setNextKinematicTranslation({ x: nx, y: ny, z: nz });
    this.prev.copy(this.curr);
    this.curr.set(nx, ny - this.footOffset, nz);
    this.velocity.set(m.x / dt, m.y / dt, m.z / dt);
    if (this.grounded && this.vy < 0) this.vy = 0;
    // потолок/удар головой
    if (m.y < dy * 0.5 && dy > 0) this.vy = 0;
  }

  /** Импульс отбрасывания (м/с). */
  push(v: THREE.Vector3): void {
    this.knock.add(v);
  }

  dispose(): void {
    this.pw.world.removeCharacterController(this.controller);
    this.pw.world.removeCollider(this.collider, false);
    this.pw.world.removeRigidBody(this.body);
  }
}
