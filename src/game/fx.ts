// Эффекты: пулы частиц на одном ShaderMaterial (кровь, искры, снег/пыль, дымка). Всё на CPU, ≤ ~1500 частиц.

import * as THREE from 'three';
import type { EnvironmentLike } from './envTypes';
import { RNG } from '../core/util';

interface PoolOpts {
  count: number;
  size: number;
  additive?: boolean;
  gravity?: number;
  drag?: number;
  bounce?: number;
  /** Прилипать к земле (кровь): останавливаться при касании. */
  stick?: boolean;
}

class ParticlePool {
  readonly points: THREE.Points;
  private pos: Float32Array;
  private col: Float32Array;
  private siz: Float32Array;
  private vel: Float32Array;
  private life: Float32Array;
  private maxLife: Float32Array;
  private baseSize: Float32Array;
  private cursor = 0;
  private stuck: Uint8Array;
  private geo: THREE.BufferGeometry;

  constructor(private o: PoolOpts) {
    const n = o.count;
    this.pos = new Float32Array(n * 3).fill(1e5);
    this.col = new Float32Array(n * 4);
    this.siz = new Float32Array(n);
    this.vel = new Float32Array(n * 3);
    this.life = new Float32Array(n);
    this.maxLife = new Float32Array(n).fill(1);
    this.baseSize = new Float32Array(n).fill(o.size);
    this.stuck = new Uint8Array(n);
    this.geo = new THREE.BufferGeometry();
    this.geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    this.geo.setAttribute('color', new THREE.BufferAttribute(this.col, 4));
    this.geo.setAttribute('size', new THREE.BufferAttribute(this.siz, 1));
    const mat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: o.additive ? THREE.AdditiveBlending : THREE.NormalBlending,
      uniforms: { uScale: { value: 600 } },
      vertexShader: `
        attribute vec4 color; attribute float size; varying vec4 vC; uniform float uScale;
        void main(){ vC = color; vec4 mv = modelViewMatrix * vec4(position,1.0); gl_Position = projectionMatrix * mv;
          gl_PointSize = size * uScale / max(0.1, -mv.z); }`,
      fragmentShader: `
        varying vec4 vC;
        void main(){ vec2 d = gl_PointCoord - 0.5; float a = smoothstep(0.5, 0.15, length(d)); gl_FragColor = vec4(vC.rgb, vC.a * a); }`,
    });
    this.points = new THREE.Points(this.geo, mat);
    this.points.frustumCulled = false;
  }

  setScale(s: number): void {
    (this.points.material as THREE.ShaderMaterial).uniforms.uScale.value = s;
  }

  emit(p: THREE.Vector3, v: THREE.Vector3, life: number, color: THREE.Color, alpha: number, sizeMul = 1): void {
    const i = this.cursor;
    this.cursor = (this.cursor + 1) % this.o.count;
    this.pos[i * 3] = p.x; this.pos[i * 3 + 1] = p.y; this.pos[i * 3 + 2] = p.z;
    this.vel[i * 3] = v.x; this.vel[i * 3 + 1] = v.y; this.vel[i * 3 + 2] = v.z;
    this.life[i] = life; this.maxLife[i] = life;
    this.col[i * 4] = color.r; this.col[i * 4 + 1] = color.g; this.col[i * 4 + 2] = color.b; this.col[i * 4 + 3] = alpha;
    this.baseSize[i] = this.o.size * sizeMul;
    this.siz[i] = this.baseSize[i];
    this.stuck[i] = 0;
  }

  update(dt: number, env: EnvironmentLike): void {
    const o = this.o;
    const g = o.gravity ?? 0, drag = o.drag ?? 0;
    const n = o.count;
    for (let i = 0; i < n; i++) {
      if (this.life[i] <= 0) { this.siz[i] = 0; continue; }
      this.life[i] -= dt;
      const l = this.life[i] / this.maxLife[i];
      if (!this.stuck[i]) {
        this.vel[i * 3 + 1] -= g * dt;
        const k = Math.exp(-drag * dt);
        this.vel[i * 3] *= k; this.vel[i * 3 + 1] *= k; this.vel[i * 3 + 2] *= k;
        this.pos[i * 3] += this.vel[i * 3] * dt;
        this.pos[i * 3 + 1] += this.vel[i * 3 + 1] * dt;
        this.pos[i * 3 + 2] += this.vel[i * 3 + 2] * dt;
        const gy = env.heightAt(this.pos[i * 3], this.pos[i * 3 + 2]);
        if (this.pos[i * 3 + 1] < gy + 0.01) {
          this.pos[i * 3 + 1] = gy + 0.01;
          if (o.stick) { this.stuck[i] = 1; this.vel[i * 3] = this.vel[i * 3 + 1] = this.vel[i * 3 + 2] = 0; this.life[i] = Math.max(this.life[i], 6); this.maxLife[i] = Math.max(this.maxLife[i], 6); }
          else if (o.bounce) { this.vel[i * 3 + 1] = Math.abs(this.vel[i * 3 + 1]) * o.bounce; this.vel[i * 3] *= 0.6; this.vel[i * 3 + 2] *= 0.6; }
        }
      }
      this.col[i * 4 + 3] = Math.min(this.col[i * 4 + 3], l * 1.6);
      this.siz[i] = this.baseSize[i] * (this.stuck[i] ? 1.4 : 0.6 + 0.4 * l);
    }
    this.geo.attributes.position.needsUpdate = true;
    this.geo.attributes.color.needsUpdate = true;
    this.geo.attributes.size.needsUpdate = true;
  }
}

export class FX {
  private blood = new ParticlePool({ count: 700, size: 0.045, gravity: 9.8, drag: 0.4, stick: true });
  private sparks = new ParticlePool({ count: 300, size: 0.03, additive: true, gravity: 6, drag: 1.2, bounce: 0.3 });
  private dust = new ParticlePool({ count: 400, size: 0.22, gravity: -0.15, drag: 2.2 });
  private rng = new RNG(99);
  private c = new THREE.Color();

  constructor(scene: THREE.Scene, private env: EnvironmentLike) {
    scene.add(this.blood.points, this.sparks.points, this.dust.points);
  }

  setScreenScale(heightPx: number): void {
    const s = heightPx * 0.9;
    this.blood.setScale(s); this.sparks.setScale(s); this.dust.setScale(s);
  }

  bloodBurst(p: THREE.Vector3, dir: THREE.Vector3, amount = 1): void {
    const n = Math.round(14 * amount);
    for (let i = 0; i < n; i++) {
      const v = new THREE.Vector3(dir.x + this.rng.gauss() * 0.9, Math.abs(this.rng.gauss()) * 1.2 + 0.3, dir.z + this.rng.gauss() * 0.9);
      v.multiplyScalar(this.rng.range(1.2, 4.5));
      this.c.setRGB(0.32 + this.rng.next() * 0.2, 0.01, 0.015);
      this.blood.emit(p, v, this.rng.range(0.5, 1.4), this.c, 0.95, this.rng.range(0.6, 1.5));
    }
    // мелкий туман брызг
    for (let i = 0; i < 4; i++) {
      this.c.setRGB(0.28, 0.02, 0.02);
      this.dust.emit(p, new THREE.Vector3(this.rng.gauss() * 0.4, this.rng.range(0, 0.5), this.rng.gauss() * 0.4), 0.45, this.c, 0.28, 0.6);
    }
  }

  sparksAt(p: THREE.Vector3, normal: THREE.Vector3, n = 14): void {
    for (let i = 0; i < n; i++) {
      const v = new THREE.Vector3(normal.x + this.rng.gauss(), normal.y + Math.abs(this.rng.gauss()), normal.z + this.rng.gauss()).multiplyScalar(this.rng.range(2, 7));
      this.c.setRGB(1, 0.55 + this.rng.next() * 0.3, 0.2);
      this.sparks.emit(p, v, this.rng.range(0.15, 0.5), this.c, 1, this.rng.range(0.7, 1.4));
    }
  }

  puff(p: THREE.Vector3, n = 6, tint = 0.72): void {
    for (let i = 0; i < n; i++) {
      this.c.setRGB(tint, tint, tint * 1.02);
      this.dust.emit(p, new THREE.Vector3(this.rng.gauss() * 0.7, this.rng.range(0.2, 0.9), this.rng.gauss() * 0.7), this.rng.range(0.5, 1.1), this.c, 0.45, this.rng.range(0.8, 1.6));
    }
  }

  update(dt: number): void {
    this.blood.update(dt, this.env);
    this.sparks.update(dt, this.env);
    this.dust.update(dt, this.env);
  }
}
