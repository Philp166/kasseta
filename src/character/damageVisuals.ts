// Визуализация повреждений: шейдерный слой поверх любых материалов персонажа.
//  • по регионам тела (голова, корпус, руки, ноги) растут грязь, пятна крови, дыры и прорехи в одежде;
//  • конкретные раны (до 12) — кровавое пятно с потёками, у одежды ещё и пробоина, у кожи — края раны;
//  • на коже — царапины и синяки при небольших повреждениях.
// Работает в «системе покоя» меша (позиции до скиннинга), поэтому не зависит от позы и от UV.

import * as THREE from 'three';
import type { Character } from './character';
import type { DamageModel, HitInfo } from '../game/damage';
import { REGIONS, Region } from './regions';
import { RNG } from '../core/util';

export const MAX_WOUNDS = 12;

export interface DamageFlags {
  /** Прорехи и пробоины (одежда). */
  tear?: boolean;
  /** Кожа: царапины, синяки, края ран. */
  skin?: boolean;
  /** Мех: кровь красит концы прядей. */
  fur?: boolean;
}

interface WoundRec {
  region: Region;
  rest: THREE.Vector3;
  radius: number;
  severity: number;
  seed: number;
  age: number;
  kind: number;
}

const KIND: Record<HitInfo['kind'], number> = { pierce: 0, slash: 1, arrow: 2, blunt: 3 };

const GLSL_COMMON = /* glsl */ `
uniform vec3 uRegA;
uniform vec3 uRegB;
uniform vec4 uWounds[${MAX_WOUNDS}];
uniform vec4 uWoundData[${MAX_WOUNDS}];
uniform float uDirt;
varying vec3 vRest;
varying vec3 vRA;
varying vec3 vRB;
float gWet = 0.0;
float h31(vec3 p){ p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
float vn(vec3 x){
  vec3 i = floor(x); vec3 f = fract(x); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(h31(i), h31(i + vec3(1,0,0)), f.x), mix(h31(i + vec3(0,1,0)), h31(i + vec3(1,1,0)), f.x), f.y),
             mix(mix(h31(i + vec3(0,0,1)), h31(i + vec3(1,0,1)), f.x), mix(h31(i + vec3(0,1,1)), h31(i + vec3(1,1,1)), f.x), f.y), f.z);
}
float fbm3(vec3 p){ return 0.55 * vn(p) + 0.3 * vn(p * 2.1 + 7.3) + 0.15 * vn(p * 4.3 + 1.7); }
`;

const GLSL_BODY = /* glsl */ `
{
  float dmg = clamp(dot(vRA, uRegA) + dot(vRB, uRegB), 0.0, 1.0);
  float n1 = fbm3(vRest * 6.0);
  float n2 = fbm3(vRest * 17.0 + 3.1);
  float dirt = smoothstep(0.38, 0.82, n1) * (uDirt + 0.5 * dmg);
  diffuseColor.rgb *= 1.0 - 0.55 * dirt;
  #ifdef DMG_SKIN
    // синяки (малые повреждения) и царапины
    float low = smoothstep(0.04, 0.2, dmg) * (1.0 - smoothstep(0.55, 0.9, dmg));
    float bruiseN = smoothstep(0.52, 0.75, fbm3(vRest * 9.0 + 2.0));
    vec3 bruiseCol = mix(vec3(0.42, 0.26, 0.5), vec3(0.62, 0.55, 0.28), smoothstep(0.4, 0.9, n2));
    diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * bruiseCol * 1.2, bruiseN * low * 0.7);
    float sc = 1.0 - smoothstep(0.0, 0.035, abs(vn(vRest * vec3(40.0, 9.0, 40.0) + 4.0) - 0.5));
    diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.17, 0.012, 0.012), sc * smoothstep(0.08, 0.3, dmg) * 0.75);
  #endif
  float bl = smoothstep(0.1, 0.45, dmg);
  float bloodN = n1 * 0.65 + n2 * 0.35;
  float stain = smoothstep(1.0 - 0.36 * dmg, 1.13 - 0.36 * dmg, bloodN) * bl;
  vec3 bloodCol = mix(vec3(0.13, 0.004, 0.007), vec3(0.055, 0.016, 0.012), smoothstep(0.35, 0.75, n2));
  diffuseColor.rgb = mix(diffuseColor.rgb, bloodCol, stain * 0.82);
  gWet = max(gWet, stain * 0.35 * (1.0 - smoothstep(0.35, 0.75, n2)));
  #ifdef DMG_TEAR
    float tearN = fbm3(vRest * 11.0 + 9.0);
    if (dmg > 0.5 && tearN > 1.07 - 0.42 * (dmg - 0.4)) discard;
  #endif
  for (int i = 0; i < ${MAX_WOUNDS}; i++) {
    vec4 w = uWounds[i];
    if (w.w <= 0.0) continue;
    vec4 wd = uWoundData[i];
    vec3 d = vRest - w.xyz;
    float rr = w.w;
    float sev = wd.x, seed = wd.y, age = wd.z;
    float dist = length(vec3(d.x, d.y * (d.y < 0.0 ? 0.6 : 1.0), d.z));
    float edge = rr * (0.7 + 0.55 * fbm3(vRest * 40.0 + seed));
    float core = smoothstep(edge, edge * 0.25, dist);
    float below = max(-d.y, 0.0);
    float run = rr * (2.2 + min(age, 10.0) * 0.9) * (0.4 + sev);
    float lane = vn(vec3(d.x * 55.0 + seed * 7.0, d.z * 55.0, seed));
    float streak = smoothstep(0.56, 0.7, lane) * smoothstep(run, 0.0, below) * step(0.0, -d.y) * smoothstep(rr * 2.6, 0.0, length(d.xz));
    float m = max(core, streak * 0.9);
    vec3 col = mix(vec3(0.17, 0.006, 0.01), vec3(0.03, 0.002, 0.004), core);
    #ifdef DMG_SKIN
      float ring = smoothstep(edge * 1.25, edge * 0.7, dist) - core;
      diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.3, 0.04, 0.035), clamp(ring, 0.0, 1.0) * 0.8);
    #endif
    diffuseColor.rgb = mix(diffuseColor.rgb, col, m * 0.95);
    gWet = max(gWet, m);
    #ifdef DMG_TEAR
      if (sev > 0.55 && dist < edge * 0.42) discard;
    #endif
  }
}
`;

export class DamageVisuals {
  readonly uRegA = { value: new THREE.Vector3() };
  readonly uRegB = { value: new THREE.Vector3() };
  readonly uWounds = { value: Array.from({ length: MAX_WOUNDS }, () => new THREE.Vector4(0, 0, 0, 0)) };
  readonly uWoundData = { value: Array.from({ length: MAX_WOUNDS }, () => new THREE.Vector4(0, 0, 0, 0)) };
  readonly uDirt = { value: 0.12 };
  readonly wounds: WoundRec[] = [];
  /** Целевые доли повреждений регионов и сглаженные текущие. */
  private target: Record<Region, number> = { head: 0, torso: 0, armL: 0, armR: 0, legL: 0, legR: 0 };
  private cur: Record<Region, number> = { head: 0, torso: 0, armL: 0, armR: 0, legL: 0, legR: 0 };
  private rng = new RNG(5);
  private candidates = new Map<THREE.SkinnedMesh, Map<Region, number[]>>();
  /** Подписчики на смену стадии лица (кожа головы подменяет текстуры). */
  onFaceStage?: (stage: 1 | 2 | 3 | 4, blend: number) => void;
  private lastStage = 0;
  /** Переопределение для панели отладки: null — брать из модели. */
  override: Partial<Record<Region, number>> | null = null;

  constructor(private character: Character) {}

  /** Подключить шейдерный слой к материалу. */
  patch(mat: THREE.MeshStandardMaterial, flags: DamageFlags = {}): void {
    const prev = mat.onBeforeCompile;
    const prevKey = mat.customProgramCacheKey?.bind(mat);
    mat.onBeforeCompile = (shader, renderer) => {
      prev?.call(mat, shader, renderer);
      shader.uniforms.uRegA = this.uRegA;
      shader.uniforms.uRegB = this.uRegB;
      shader.uniforms.uWounds = this.uWounds;
      shader.uniforms.uWoundData = this.uWoundData;
      shader.uniforms.uDirt = this.uDirt;
      const defs: string[] = [];
      if (flags.tear) defs.push('#define DMG_TEAR');
      if (flags.skin) defs.push('#define DMG_SKIN');
      if (flags.fur) defs.push('#define DMG_FUR');
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', `#include <common>\nattribute vec3 aRegA;\nattribute vec3 aRegB;\nvarying vec3 vRest;\nvarying vec3 vRA;\nvarying vec3 vRB;`)
        .replace('#include <begin_vertex>', `#include <begin_vertex>\nvRest = position;\nvRA = aRegA;\nvRB = aRegB;`);
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', `${defs.join('\n')}\n#include <common>\n${GLSL_COMMON}`)
        .replace('#include <color_fragment>', `#include <color_fragment>\n${GLSL_BODY}`)
        .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>\nroughnessFactor = mix(roughnessFactor, 0.26, clamp(gWet, 0.0, 1.0));`);
    };
    const key = `dmg${flags.tear ? 'T' : ''}${flags.skin ? 'S' : ''}${flags.fur ? 'F' : ''}`;
    mat.customProgramCacheKey = () => `${prevKey ? prevKey() : ''}|${key}`;
    mat.needsUpdate = true;
  }

  // ---------- Раны ----------

  /** Добавить рану в точке попадания: находим ближайшую вершину региона и берём её положение «в покое». */
  addWound(region: Region, worldPoint: THREE.Vector3, dir: THREE.Vector3, kind: HitInfo['kind'], severity: number): void {
    const rest = this.findRest(region, worldPoint);
    if (!rest) return;
    const radius = (kind === 'slash' ? 0.045 : kind === 'blunt' ? 0.055 : 0.032) * (0.7 + severity);
    const rec: WoundRec = { region, rest, radius, severity, seed: this.rng.range(1, 90), age: 0, kind: KIND[kind] };
    void dir;
    this.wounds.push(rec);
    if (this.wounds.length > MAX_WOUNDS) this.wounds.shift();
    this.uploadWounds();
  }

  private regionCandidates(mesh: THREE.SkinnedMesh, region: Region): number[] {
    let m = this.candidates.get(mesh);
    if (!m) { m = new Map(); this.candidates.set(mesh, m); }
    let arr = m.get(region);
    if (arr) return arr;
    arr = [];
    const A = mesh.geometry.getAttribute('aRegA') as THREE.BufferAttribute | undefined;
    const B = mesh.geometry.getAttribute('aRegB') as THREE.BufferAttribute | undefined;
    if (A && B) {
      const ri = REGIONS.indexOf(region);
      for (let i = 0; i < A.count; i++) {
        const w = ri < 3 ? A.getComponent(i, ri) : B.getComponent(i, ri - 3);
        if (w > 0.55) arr.push(i);
      }
    }
    m.set(region, arr);
    return arr;
  }

  private findRest(region: Region, worldPoint: THREE.Vector3): THREE.Vector3 | null {
    let best: THREE.Vector3 | null = null;
    let bestD = Infinity;
    const local = new THREE.Vector3(), v = new THREE.Vector3();
    for (const mesh of this.character.meshes) {
      if (!mesh.geometry.getAttribute('aRegA')) continue;
      if (mesh.name === 'fur') continue; // слишком много вершин, раны берём с основ
      const cand = this.regionCandidates(mesh, region);
      if (!cand.length) continue;
      mesh.skeleton.update();
      mesh.updateWorldMatrix(true, false);
      local.copy(worldPoint);
      mesh.worldToLocal(local);
      const pos = mesh.geometry.getAttribute('position') as THREE.BufferAttribute;
      const n = Math.min(cand.length, 900);
      for (let k = 0; k < n; k++) {
        const idx = cand.length <= 900 ? cand[k] : cand[(Math.random() * cand.length) | 0];
        mesh.getVertexPosition(idx, v);
        const d = v.distanceToSquared(local);
        if (d < bestD) { bestD = d; best = new THREE.Vector3(pos.getX(idx), pos.getY(idx), pos.getZ(idx)); }
      }
    }
    return best;
  }

  private uploadWounds(): void {
    for (let i = 0; i < MAX_WOUNDS; i++) {
      const w = this.wounds[i];
      if (w) {
        this.uWounds.value[i].set(w.rest.x, w.rest.y, w.rest.z, w.radius);
        this.uWoundData.value[i].set(w.severity, w.seed, w.age, w.kind);
      } else {
        this.uWounds.value[i].set(0, 0, 0, 0);
      }
    }
  }

  // ---------- Покадровое обновление ----------

  sync(dm: DamageModel, dt = 1 / 60): void {
    for (const r of REGIONS) this.target[r] = this.override?.[r] ?? dm.frac(r);
    const k = 1 - Math.exp(-4 * dt);
    for (const r of REGIONS) this.cur[r] += (this.target[r] - this.cur[r]) * k;
    this.uRegA.value.set(this.cur.head, this.cur.torso, this.cur.armL);
    this.uRegB.value.set(this.cur.armR, this.cur.legL, this.cur.legR);
    this.uDirt.value = 0.1 + 0.12 * (1 - dm.health);
    let aged = false;
    for (const w of this.wounds) { w.age += dt; aged = true; }
    if (aged) {
      for (let i = 0; i < this.wounds.length; i++) this.uWoundData.value[i].z = this.wounds[i].age;
    }
    const stage = this.override ? stageFrom(this.cur.head) : dm.faceStage;
    if (stage !== this.lastStage) {
      this.lastStage = stage;
      this.onFaceStage?.(stage as 1 | 2 | 3 | 4, dm.faceBlend);
    }
  }

  clear(): void {
    this.wounds.length = 0;
    this.uploadWounds();
    for (const r of REGIONS) { this.target[r] = 0; this.cur[r] = 0; }
  }
}

function stageFrom(f: number): 1 | 2 | 3 | 4 {
  return f < 0.12 ? 1 : f < 0.4 ? 2 : f < 0.72 ? 3 : 4;
}
