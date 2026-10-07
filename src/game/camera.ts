// Камера от третьего лица: орбита вокруг героя, столкновение с рельефом/деревьями через рейкаст Rapier,
// прицельный режим (ближе, через плечо), мягкая привязка к цели, тряска от попаданий.

import * as THREE from 'three';
import { PhysicsWorld, mask, G } from '../physics/world';
import { clamp, lerp, DEG } from '../core/util';

export class FollowCamera {
  readonly camera = new THREE.PerspectiveCamera(58, 16 / 9, 0.08, 400);
  yaw = 0; // куда смотрит камера по горизонтали; 0 = к +Z
  pitch = 16 * DEG; // высота камеры над целью (положительная — выше цели)
  distance = 3.6;
  minDistance = 1.8;
  maxDistance = 7;
  aim = 0; // 0..1 прицельный режим
  shake = 0; // «травма» 0..1
  private smoothPos = new THREE.Vector3();
  private smoothTarget = new THREE.Vector3();
  private curDist = 3.6;
  private init = false;
  private tmp = new THREE.Vector3();
  private dir = new THREE.Vector3();
  private time = 0;
  /** Мягкий захват цели: если задан — камера плавно разворачивается к нему. */
  lockTarget: THREE.Vector3 | null = null;

  constructor(private pw: PhysicsWorld) {}

  get forward(): THREE.Vector3 { return new THREE.Vector3(Math.sin(this.yaw), 0, Math.cos(this.yaw)); }
  get right(): THREE.Vector3 { return new THREE.Vector3(-Math.cos(this.yaw), 0, Math.sin(this.yaw)); }

  addTrauma(t: number): void { this.shake = Math.min(1, this.shake + t); }

  update(dt: number, target: THREE.Vector3, look: THREE.Vector2, wheel: number, aimWanted: boolean, focusHeight = 1.55): void {
    this.time += dt;
    this.yaw -= look.x;
    this.pitch = clamp(this.pitch + look.y, -22 * DEG, 62 * DEG);
    if (this.lockTarget) {
      const to = this.tmp.subVectors(this.lockTarget, target);
      const wantYaw = Math.atan2(to.x, to.z);
      let d = wantYaw - this.yaw;
      d = Math.atan2(Math.sin(d), Math.cos(d));
      this.yaw += d * Math.min(1, dt * 5);
      const wantPitch = clamp(0.2 + (target.y - this.lockTarget.y) * 0.05, 0.05, 0.5);
      this.pitch = lerp(this.pitch, wantPitch, Math.min(1, dt * 3));
    }
    this.distance = clamp(this.distance + wheel * 0.4, this.minDistance, this.maxDistance);
    this.aim = lerp(this.aim, aimWanted ? 1 : 0, Math.min(1, dt * 9));

    const focus = this.tmp.set(target.x, target.y + focusHeight, target.z);
    if (!this.init) { this.smoothTarget.copy(focus); this.init = true; }
    this.smoothTarget.lerp(focus, 1 - Math.exp(-14 * dt));
    const dist = lerp(this.distance, 2.15, this.aim);
    const f = this.forward, r = this.right;
    const cp = Math.cos(this.pitch), sp = Math.sin(this.pitch);
    const shoulder = lerp(0.0, 0.55, this.aim) + 0.0;
    // желаемая позиция: позади цели, выше при положительном pitch, смещение через правое плечо
    const desired = new THREE.Vector3(
      this.smoothTarget.x - f.x * dist * cp + r.x * shoulder,
      this.smoothTarget.y + sp * dist + 0.18,
      this.smoothTarget.z - f.z * dist * cp + r.z * shoulder,
    );
    // столкновение: луч от цели к желаемой точке
    const dirV = this.dir.subVectors(desired, this.smoothTarget);
    const len = dirV.length();
    dirV.multiplyScalar(1 / Math.max(len, 1e-4));
    const hit = this.pw.castRay(this.smoothTarget, dirV, len + 0.3, mask(0xffff, G.WORLD));
    const allowed = hit ? Math.max(0.55, hit.toi - 0.3) : len;
    this.curDist = lerp(this.curDist, allowed, allowed < this.curDist ? 1 : 1 - Math.exp(-6 * dt));
    desired.copy(this.smoothTarget).addScaledVector(dirV, Math.min(len, this.curDist));
    // не опускаться под землю: проверка по вертикали
    this.smoothPos.copy(desired);

    this.camera.position.copy(this.smoothPos);
    // тряска
    if (this.shake > 0.001) {
      const s = this.shake * this.shake;
      const t = this.time * 38;
      this.camera.position.x += Math.sin(t * 1.3) * 0.05 * s;
      this.camera.position.y += Math.sin(t * 1.9 + 1.2) * 0.05 * s;
      this.camera.position.z += Math.sin(t * 1.1 + 2.4) * 0.05 * s;
      this.shake = Math.max(0, this.shake - dt * 1.8);
    }
    const lookAt = this.tmp.copy(this.smoothTarget).addScaledVector(r, shoulder * 0.9).addScaledVector(f, 0.0);
    this.camera.lookAt(lookAt);
    // поле зрения: прицел сужает
    const fov = lerp(58, 44, this.aim);
    if (Math.abs(this.camera.fov - fov) > 0.01) { this.camera.fov = fov; this.camera.updateProjectionMatrix(); }
  }

  setAspect(a: number): void {
    this.camera.aspect = a;
    this.camera.updateProjectionMatrix();
  }
}
