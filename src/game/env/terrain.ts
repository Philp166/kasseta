// Рельеф: массив высот для физики, меш (сетка 1 м с «юбкой»), дальнее поле, карты смешивания (splat)
// и шейдер земли (PBR-слои: подстилка, ветошь, мох/ягель, камень, снег; антитайлинг; нормали).

import * as THREE from 'three';
import { Noise2, sstep, clamp01 } from './noise';
import { GLSL_RT_NOISE } from './glsl';
import { HeightFn, TERRAIN_SEGMENTS, TERRAIN_SIZE } from './heights';
import type { TerrainData } from './types';
import type { GroundTextures } from './groundTex';

// ---------------------------------------------------------------- данные

export function buildTerrainData(fn: HeightFn): TerrainData {
  const n = TERRAIN_SEGMENTS + 1;
  const step = TERRAIN_SIZE / TERRAIN_SEGMENTS;
  const half = TERRAIN_SIZE / 2;
  const heights = new Float32Array(n * n);
  for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) heights[i * n + j] = fn(-half + j * step, -half + i * step);
  return { size: TERRAIN_SIZE, segments: TERRAIN_SEGMENTS, heights, originX: -half, originZ: -half };
}

/** Выборка высот/нормалей: та же триангуляция, что у меша и у коллайдера физики. */
export class TerrainSampler {
  readonly n: number;
  readonly step: number;
  constructor(readonly t: TerrainData, private outside: HeightFn) {
    this.n = t.segments + 1;
    this.step = t.size / t.segments;
  }

  heightAt = (x: number, z: number): number => {
    const t = this.t, n = this.n, H = t.heights;
    const fx = (x - t.originX) / this.step, fz = (z - t.originZ) / this.step;
    if (fx < 0 || fz < 0 || fx > t.segments || fz > t.segments) return this.outside(x, z);
    const j = Math.min(t.segments - 1, Math.floor(fx)), i = Math.min(t.segments - 1, Math.floor(fz));
    const tx = fx - j, tz = fz - i;
    const h00 = H[i * n + j], h10 = H[i * n + j + 1], h01 = H[(i + 1) * n + j], h11 = H[(i + 1) * n + j + 1];
    if (tx + tz <= 1) return h00 + (h10 - h00) * tx + (h01 - h00) * tz;
    return h11 + (h01 - h11) * (1 - tx) + (h10 - h11) * (1 - tz);
  };

  normalAt = (x: number, z: number, out = new THREE.Vector3()): THREE.Vector3 => {
    const e = 0.7;
    const hx = this.heightAt(x + e, z) - this.heightAt(x - e, z);
    const hz = this.heightAt(x, z + e) - this.heightAt(x, z - e);
    return out.set(-hx, 2 * e, -hz).normalize();
  };

  /** Уклон в градусах. */
  slopeAt(x: number, z: number): number {
    const v = this.normalAt(x, z, _v);
    return Math.acos(Math.min(1, v.y)) * 57.29578;
  }
}
const _v = new THREE.Vector3();

// ---------------------------------------------------------------- меш

export function buildTerrainGeometry(t: TerrainData, noise: Noise2): THREE.BufferGeometry {
  const n = t.segments + 1, step = t.size / t.segments, H = t.heights;
  const skirtN = 4 * t.segments;
  const vCount = n * n + (skirtN + 4) * 2;
  const pos = new Float32Array(vCount * 3);
  const nor = new Float32Array(vCount * 3);
  const col = new Float32Array(vCount * 3);
  const hAt = (i: number, j: number) => H[Math.max(0, Math.min(n - 1, i)) * n + Math.max(0, Math.min(n - 1, j))];

  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      const k = i * n + j, k3 = k * 3;
      const x = t.originX + j * step, z = t.originZ + i * step, y = H[k];
      pos[k3] = x; pos[k3 + 1] = y; pos[k3 + 2] = z;
      const dx = (hAt(i, j + 1) - hAt(i, j - 1)) / (2 * step);
      const dz = (hAt(i + 1, j) - hAt(i - 1, j)) / (2 * step);
      const il = 1 / Math.hypot(dx, 1, dz);
      nor[k3] = -dx * il; nor[k3 + 1] = il; nor[k3 + 2] = -dz * il;
      // кривизна: впадины темнее (AO), бугры чуть светлее
      let avg = 0;
      for (const [a, b] of [[-3, 0], [3, 0], [0, -3], [0, 3], [-2, -2], [2, 2], [-2, 2], [2, -2]]) avg += hAt(i + a, j + b);
      avg /= 8;
      const curv = avg - y; // >0 во впадинах
      const ao = 1 - clamp01(curv * 0.16) * 0.45 + clamp01(-curv * 0.1) * 0.08;
      const m1 = noise.fbm(x * 0.021, z * 0.021, 3);
      const m2 = noise.fbm(x * 0.07 + 20, z * 0.07 - 10, 2);
      const b = ao * (0.9 + 0.16 * m1);
      col[k3] = b * (1 + 0.07 * m2);
      col[k3 + 1] = b * (1 + 0.01 * m2);
      col[k3 + 2] = b * (1 - 0.07 * m2);
    }
  }

  const idx = new Uint32Array(t.segments * t.segments * 6 + t.segments * 4 * 6);
  let p = 0;
  for (let i = 0; i < t.segments; i++) {
    for (let j = 0; j < t.segments; j++) {
      const a = i * n + j, b = (i + 1) * n + j, c = i * n + j + 1, d = (i + 1) * n + j + 1;
      idx[p++] = a; idx[p++] = b; idx[p++] = c;
      idx[p++] = c; idx[p++] = b; idx[p++] = d;
    }
  }

  // юбка по краям: скрывает щели на стыке с дальним полем
  let v = n * n;
  const skirtDrop = 6;
  const edge = (ids: number[], outward: [number, number]) => {
    const base = v;
    for (const id of ids) {
      const s3 = id * 3, d3 = v * 3;
      pos[d3] = pos[s3]; pos[d3 + 1] = pos[s3 + 1] - skirtDrop; pos[d3 + 2] = pos[s3 + 2];
      nor[d3] = nor[s3]; nor[d3 + 1] = nor[s3 + 1]; nor[d3 + 2] = nor[s3 + 2];
      col[d3] = col[s3]; col[d3 + 1] = col[s3 + 1]; col[d3 + 2] = col[s3 + 2];
      v++;
    }
    for (let q = 0; q < ids.length - 1; q++) {
      const A = ids[q], B = ids[q + 1], A2 = base + q, B2 = base + q + 1;
      // нормаль грани должна смотреть наружу
      const ax = pos[A * 3], az = pos[A * 3 + 2], bx = pos[B * 3], bz = pos[B * 3 + 2];
      const ex = bx - ax, ez = bz - az; // вдоль кромки
      // нормаль треугольника (A,B,A2) в плоскости XZ ∝ (ez, -ex)
      const dot = ez * outward[0] - ex * outward[1];
      if (dot >= 0) { idx[p++] = A; idx[p++] = B; idx[p++] = A2; idx[p++] = B; idx[p++] = B2; idx[p++] = A2; }
      else { idx[p++] = A; idx[p++] = A2; idx[p++] = B; idx[p++] = B; idx[p++] = A2; idx[p++] = B2; }
    }
  };
  const row = (i: number) => Array.from({ length: n }, (_, j) => i * n + j);
  const colm = (j: number) => Array.from({ length: n }, (_, i) => i * n + j);
  edge(row(0), [0, -1]);
  edge(row(n - 1), [0, 1]);
  edge(colm(0), [-1, 0]);
  edge(colm(n - 1), [1, 0]);

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos.subarray(0, v * 3), 3));
  geo.setAttribute('normal', new THREE.BufferAttribute(nor.subarray(0, v * 3), 3));
  geo.setAttribute('color', new THREE.BufferAttribute(col.subarray(0, v * 3), 3));
  geo.setIndex(new THREE.BufferAttribute(idx.subarray(0, p), 1));
  geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 10, 0), t.size * 0.8);
  geo.boundingBox = new THREE.Box3(new THREE.Vector3(-t.size / 2, -20, -t.size / 2), new THREE.Vector3(t.size / 2, 80, t.size / 2));
  return geo;
}

/** Дальнее поле (квадрат 3200 м с вырезом под основной рельеф), шаг 16 м. */
export function buildFarGeometry(fn: HeightFn, noise: Noise2, half = 1600, cell = 16): THREE.BufferGeometry {
  const n = Math.round((2 * half) / cell) + 1;
  const pos = new Float32Array(n * n * 3);
  const col = new Float32Array(n * n * 3);
  const nor = new Float32Array(n * n * 3);
  const H = new Float32Array(n * n);
  for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) H[i * n + j] = fn(-half + j * cell, -half + i * cell);
  const hA = (i: number, j: number) => H[Math.max(0, Math.min(n - 1, i)) * n + Math.max(0, Math.min(n - 1, j))];
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      const k = (i * n + j) * 3;
      const x = -half + j * cell, z = -half + i * cell;
      pos[k] = x; pos[k + 1] = H[i * n + j]; pos[k + 2] = z;
      const dx = (hA(i, j + 1) - hA(i, j - 1)) / (2 * cell), dz = (hA(i + 1, j) - hA(i - 1, j)) / (2 * cell);
      const il = 1 / Math.hypot(dx, 1, dz);
      nor[k] = -dx * il; nor[k + 1] = il; nor[k + 2] = -dz * il;
      const m = noise.fbm(x * 0.004, z * 0.004, 3);
      const b = 0.85 + 0.2 * m;
      col[k] = b; col[k + 1] = b; col[k + 2] = b;
    }
  }
  const inner = TERRAIN_SIZE / 2 / cell; // половина выреза в ячейках
  const c0 = Math.round(half / cell);
  const idx: number[] = [];
  for (let i = 0; i < n - 1; i++) {
    for (let j = 0; j < n - 1; j++) {
      if (i >= c0 - inner && i < c0 + inner && j >= c0 - inner && j < c0 + inner) continue;
      const a = i * n + j, b = (i + 1) * n + j, c = i * n + j + 1, d = (i + 1) * n + j + 1;
      idx.push(a, b, c, c, b, d);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  geo.setIndex(idx);
  geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 0, 0), half * 1.6);
  return geo;
}

// ---------------------------------------------------------------- карты смешивания

export interface SplatInput {
  sampler: TerrainSampler;
  noise: Noise2;
  /** Тень полога: 0..1 на сетке res×res по всей карте (деревья затеняют землю). */
  canopy: Float32Array | null;
  /** Следы стоянки: центр лагеря и костра. */
  camp: { x: number; z: number; radius: number; fireX: number; fireZ: number };
  /** Дорожки (вытоптанная земля): ломаные линии. */
  paths: Array<Array<[number, number]>>;
}

export interface SplatTextures {
  a: THREE.DataTexture; // R=снег, G=подстилка, B=мох, A=сухая трава
  b: THREE.DataTexture; // R=тень полога, G=вытоптано (грязь), B=зола, A=иней
  res: number;
}

function distToPath(x: number, z: number, path: Array<[number, number]>): number {
  let best = 1e9;
  for (let i = 0; i < path.length - 1; i++) {
    const [ax, az] = path[i], [bx, bz] = path[i + 1];
    const dx = bx - ax, dz = bz - az;
    const l2 = dx * dx + dz * dz || 1;
    const t = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / l2));
    const d = Math.hypot(x - (ax + dx * t), z - (az + dz * t));
    if (d < best) best = d;
  }
  return best;
}

export function buildSplat(res: number, inp: SplatInput): SplatTextures {
  const { sampler, noise, camp } = inp;
  const A = new Uint8Array(res * res * 4);
  const B = new Uint8Array(res * res * 4);
  const half = TERRAIN_SIZE / 2;
  const cell = TERRAIN_SIZE / res;
  const nrm = new THREE.Vector3();
  for (let j = 0; j < res; j++) {
    for (let i = 0; i < res; i++) {
      const x = -half + (i + 0.5) * cell, z = -half + (j + 0.5) * cell;
      const h = sampler.heightAt(x, z);
      sampler.normalAt(x, z, nrm);
      const slope = 1 - nrm.y;
      const canopy = inp.canopy ? inp.canopy[j * res + i] : 0;
      const open = 1 - canopy;
      const r = Math.hypot(x - camp.x, z - camp.z);
      const f1 = noise.fbm(x * 0.031 + 100, z * 0.031 + 100, 3);
      const f2 = noise.fbm(x * 0.10 + 40, z * 0.10 - 70, 3);
      const f3 = noise.fbm(x * 0.33 + 7, z * 0.33 + 3, 2);
      const damp = noise.fbm(x * 0.017 - 30, z * 0.017 + 55, 3); // сыро / сухо

      // вытоптанная земля: центр лагеря, дорожки
      let trampled = 1 - sstep(camp.radius * 0.55, camp.radius * 1.05, r + f2 * 2.2);
      for (const path of inp.paths) {
        const d = distToPath(x, z, path);
        trampled = Math.max(trampled, (1 - sstep(0.7, 1.9, d + f3 * 0.5)) * 0.85);
      }
      const ashD = Math.hypot(x - camp.fireX, z - camp.fireZ);
      const ash = (1 - sstep(0.6, 1.9, ashD + f3 * 0.45)) * 0.95;

      // снег: пятна (граница на уровне 0.5), больше на открытых местах и выше по склону
      let snow = 0.5 + 0.55 * f1 + 0.22 * f2 + 0.05 * f3 + 0.12 * open - 0.12 + 0.004 * h - 0.9 * slope;
      snow -= trampled * 0.9 + ash;
      // подстилка/мох/трава: «предпочтения» слоя
      const litter = clamp01(0.25 + 0.8 * canopy + 0.2 * f2 + trampled * 1.2);
      const moss = clamp01(0.15 + 0.55 * (damp * 0.5 + 0.5) + 0.25 * f1 + 0.3 * canopy - trampled * 1.5 - 0.35 * slope);
      const grass = clamp01(0.2 + 0.9 * open * (0.6 + 0.5 * f2) - 0.35 * canopy - trampled * 1.2 - 0.2 * damp);
      const k = (j * res + i) * 4;
      A[k] = Math.round(clamp01(snow) * 255);
      A[k + 1] = Math.round(litter * 255);
      A[k + 2] = Math.round(moss * 255);
      A[k + 3] = Math.round(grass * 255);
      // иней: в тени, во впадинах и на открытой промёрзшей земле
      const frost = clamp01(0.35 + 0.5 * f2 + 0.25 * canopy - 0.2 * h * 0.02);
      B[k] = Math.round(clamp01(canopy) * 255);
      B[k + 1] = Math.round(clamp01(trampled) * 255);
      B[k + 2] = Math.round(clamp01(ash) * 255);
      B[k + 3] = Math.round(frost * 255);
    }
  }
  const mk = (data: Uint8Array) => {
    const t = new THREE.DataTexture(data, res, res, THREE.RGBAFormat, THREE.UnsignedByteType);
    t.colorSpace = THREE.NoColorSpace;
    t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
    t.minFilter = THREE.LinearMipmapLinearFilter;
    t.magFilter = THREE.LinearFilter;
    t.generateMipmaps = true;
    t.anisotropy = 4;
    t.needsUpdate = true;
    return t;
  };
  return { a: mk(A), b: mk(B), res };
}

// ---------------------------------------------------------------- материал

export interface TerrainUniforms {
  tAlb: THREE.IUniform;
  tNor: THREE.IUniform;
  tSplatA: THREE.IUniform;
  tSplatB: THREE.IUniform;
  uOrigin: THREE.IUniform<THREE.Vector2>;
  uInvSize: THREE.IUniform<number>;
  uTile: THREE.IUniform<THREE.Vector4>;
  uTile2: THREE.IUniform<number>;
  uDetail: THREE.IUniform<number>;
}

const FRAG_PARS = /* glsl */ `
uniform sampler2DArray tAlb;
uniform sampler2DArray tNor;
uniform sampler2D tSplatA;
uniform sampler2D tSplatB;
uniform vec4 uTile;
uniform float uTile2;
uniform float uDetail;
varying vec3 vTPos;
varying vec3 vTNor;
varying vec2 vSplatUv;
${GLSL_RT_NOISE}
vec3 gNxy;   // накопленная детальная нормаль (xy) и вес
float gRough;
vec2 rot2(vec2 v) { return vec2(v.x * 0.8 - v.y * 0.6, v.x * 0.6 + v.y * 0.8); }
// слой с антитайлингом: два масштаба/поворота, смешанных по низкочастотному шуму
vec4 sampAlb(vec2 P, vec2 dPx, vec2 dPy, float tile, float layer, float mixer) {
  vec2 uv = P * tile;
  vec2 uv2 = rot2(P * tile) * 0.37 + vec2(0.31, 0.77);
  vec4 a = textureGrad(tAlb, vec3(uv, layer), dPx * tile, dPy * tile);
  vec4 b = textureGrad(tAlb, vec3(uv2, layer), rot2(dPx * tile) * 0.37, rot2(dPy * tile) * 0.37);
  return mix(a, b, mixer);
}
vec4 sampNor(vec2 P, vec2 dPx, vec2 dPy, float tile, float layer, float mixer) {
  vec2 uv = P * tile;
  vec2 uv2 = rot2(P * tile) * 0.37 + vec2(0.31, 0.77);
  vec4 a = textureGrad(tNor, vec3(uv, layer), dPx * tile, dPy * tile);
  vec4 b = textureGrad(tNor, vec3(uv2, layer), rot2(dPx * tile) * 0.37, rot2(dPy * tile) * 0.37);
  vec2 nA = a.xy * 2.0 - 1.0;
  vec2 nT = b.xy * 2.0 - 1.0;
  // вторая выборка повёрнута и растянута: возвращаем вектор в мировые оси
  vec2 nB = vec2(0.8 * nT.x + 0.6 * nT.y, -0.6 * nT.x + 0.8 * nT.y) * 0.37;
  return vec4(mix(nA, nB, mixer), a.z, 1.0);
}
`;

const MAP_FRAG = /* glsl */ `
{
  vec2 P = vTPos.xz;
  float vd = length(vViewPosition);
  vec3 Ng = normalize(vTNor);
  vec2 dPx = dFdx(P), dPy = dFdy(P);
  vec4 sA = texture2D(tSplatA, vSplatUv);
  vec4 sB = texture2D(tSplatB, vSplatUv);
  float n1 = rtNoise(vec3(P * 0.11, 0.0));
  float n2 = rtNoise(vec3(P * 0.47, 3.0));
  float n3 = rtNoise(vec3(P * 2.3, 7.0));
  float mixer = smoothstep(0.30, 0.70, rtNoise(vec3(P * 0.037, 5.0)));
  float slope = 1.0 - Ng.y;

  // веса слоёв: 0 подстилка, 1 трава, 2 мох, 3 камень, 4 снег
  float wRock = smoothstep(0.24, 0.44, slope + (n2 - 0.5) * 0.16 + (n1 - 0.5) * 0.12);
  float wSnow = smoothstep(0.42, 0.58, sA.r + (n3 - 0.5) * 0.30 + (n2 - 0.5) * 0.18);
  wSnow *= 1.0 - smoothstep(0.30, 0.52, slope);
  vec3 g = vec3(sA.g, sA.a, sA.b);
  g = g * g + 0.001;
  g /= (g.x + g.y + g.z);
  float freeW = (1.0 - wRock) * (1.0 - wSnow);
  float w[5];
  w[0] = g.x * freeW; w[1] = g.y * freeW; w[2] = g.z * freeW;
  w[3] = wRock * (1.0 - wSnow); w[4] = wSnow;
  // вытоптанная земля — только подстилка/грязь
  float tr = sB.g;
  for (int i = 0; i < 5; i++) w[i] *= (i == 0 ? 1.0 : 1.0 - tr);
  w[0] += tr;

  float tiles[5];
  tiles[0] = uTile.x; tiles[1] = uTile.y; tiles[2] = uTile.z; tiles[3] = uTile.w; tiles[4] = uTile2;
  vec4 alb[5];
  float hb[5];
  float mx = 0.0;
  for (int i = 0; i < 5; i++) {
    hb[i] = 0.0;
    if (w[i] > 0.004) {
      alb[i] = sampAlb(P, dPx, dPy, tiles[i], float(i), mixer);
      hb[i] = w[i] + alb[i].a * 0.5;
      mx = max(mx, hb[i]);
    }
  }
  float sum = 0.0;
  for (int i = 0; i < 5; i++) {
    float b = (w[i] > 0.004) ? max(hb[i] - (mx - 0.22), 0.0) : 0.0;
    hb[i] = b; sum += b;
  }
  vec3 col = vec3(0.0);
  float rough = 0.0;
  float dn = uDetail * (1.0 - smoothstep(30.0, 110.0, vd));
  vec2 nxy = vec2(0.0);
  float rr[5];
  rr[0] = 0.95; rr[1] = 0.98; rr[2] = 1.0; rr[3] = 0.82; rr[4] = 0.62;
  float ns[5];
  ns[0] = 0.9; ns[1] = 0.7; ns[2] = 0.9; ns[3] = 1.1; ns[4] = 0.8;
  for (int i = 0; i < 5; i++) {
    if (hb[i] > 0.0) {
      float b = hb[i] / sum;
      col += alb[i].rgb * b;
      rough += rr[i] * b;
      if (dn > 0.01) {
        vec4 nn = sampNor(P, dPx, dPy, tiles[i], float(i), mixer);
        nxy += nn.xy * b * ns[i];
      }
    }
  }
  // иней на мёрзлой земле, зола и грязь
  float frost = sB.a * smoothstep(0.35, 0.8, n2 + 0.2 * n3) * (1.0 - w[4]) * 0.55;
  col = mix(col, vec3(0.55, 0.62, 0.70), frost * 0.5);
  col = mix(col, col * vec3(0.62, 0.55, 0.5), tr * 0.8);                 // грязь темнее
  col = mix(col, vec3(0.045, 0.04, 0.04) * (0.6 + n2), sB.b * 0.9);     // зола
  rough = mix(rough, 0.72, tr * 0.6);
  col *= 0.86 + 0.28 * n1;
  col *= 1.0 - 0.55 * sB.r;                                              // тень полога (AO)
  gRough = rough;
  gNxy = vec3(nxy * dn, 1.0);
  diffuseColor.rgb = col;
}
`;

export function createTerrainMaterial(
  ground: GroundTextures,
  splat: SplatTextures,
  tile: { dirt: number; grass: number; moss: number; rock: number; snow: number },
): { material: THREE.MeshStandardMaterial; uniforms: TerrainUniforms } {
  const uniforms: TerrainUniforms = {
    tAlb: { value: ground.albedo },
    tNor: { value: ground.normal },
    tSplatA: { value: splat.a },
    tSplatB: { value: splat.b },
    uOrigin: { value: new THREE.Vector2(-TERRAIN_SIZE / 2, -TERRAIN_SIZE / 2) },
    uInvSize: { value: 1 / TERRAIN_SIZE },
    uTile: { value: new THREE.Vector4(1 / tile.dirt, 1 / tile.grass, 1 / tile.moss, 1 / tile.rock) },
    uTile2: { value: 1 / tile.snow },
    uDetail: { value: 1 },
  };
  const material = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, metalness: 0 });
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>
uniform vec2 uOrigin; uniform float uInvSize;
varying vec3 vTPos; varying vec3 vTNor; varying vec2 vSplatUv;`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>
vTPos = position; vTNor = normal; vSplatUv = (position.xz - uOrigin) * uInvSize;`);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\n${FRAG_PARS}`)
      .replace('#include <map_fragment>', MAP_FRAG)
      .replace('#include <roughnessmap_fragment>', 'float roughnessFactor = gRough;')
      .replace('#include <normal_fragment_maps>', `
{
  vec3 Ng2 = normalize(vTNor);
  vec3 Nw = normalize(vec3(Ng2.x + gNxy.x, Ng2.y, Ng2.z + gNxy.y));
  normal = normalize((viewMatrix * vec4(Nw, 0.0)).xyz);
}`);
  };
  material.customProgramCacheKey = () => 'terrain-v1';
  return { material, uniforms };
}
