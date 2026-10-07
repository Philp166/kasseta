// Окружение «северная тайга, поздняя осень»: рельеф, небо и свет, лес, подлесок, лагерь с чумами и костром.
// Публичный API: createEnvironment(opts) → Environment (см. env/types.ts). Подробности — в src/game/env/*.

import * as THREE from 'three';
import type { Environment, EnvironmentOptions, EnvSettings } from './env/types';
import { QUALITY } from './env/quality';
import { Baker } from './env/bake';
import { bakeGroundTextures } from './env/groundTex';
import { createHeightFn, TERRAIN_SIZE } from './env/heights';
import { buildFarGeometry, buildSplat, buildTerrainData, buildTerrainGeometry, createTerrainMaterial, TerrainSampler } from './env/terrain';
import { createSky } from './env/sky';
import { Noise2 } from './env/noise';

export type { Environment, EnvironmentOptions, TerrainData, EnvTree, EnvRock, EnvProp, EnvSettings, Quality } from './env/types';

const lin = (r: number, g: number, b: number) => new THREE.Color().setRGB(r, g, b, THREE.LinearSRGBColorSpace);
const nextFrame = () => new Promise<void>((res) => setTimeout(res, 0));

export async function createEnvironment(opts: EnvironmentOptions): Promise<Environment> {
  const { renderer, scene } = opts;
  const seed = opts.seed ?? 7;
  const q = QUALITY[opts.quality ?? 'medium'];
  const progress = (f: number, label: string) => opts.onProgress?.(f, label);
  const disposables: Array<{ dispose(): void }> = [];

  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.0;
  const group = new THREE.Group();
  group.name = 'Environment';
  scene.add(group);

  // ---------- рельеф ----------
  progress(0.02, 'рельеф');
  const noise = new Noise2(seed + 5);
  const { fn: heightFn, vista } = createHeightFn(seed);
  const terrain = buildTerrainData(heightFn);
  const sampler = new TerrainSampler(terrain, heightFn);
  await nextFrame();

  // ---------- текстуры земли ----------
  progress(0.1, 'текстуры');
  const baker = new Baker(renderer, q.anisotropy);
  disposables.push(baker);
  const ground = bakeGroundTextures(baker, q.texSize, q.anisotropy);

  const camp = { x: 0, z: 0, radius: 13, fireX: 0, fireZ: 0 };
  const splat = buildSplat(512, { sampler, noise, canopy: null, camp, paths: [] });
  const { material: terrainMat, uniforms: terrainU } = createTerrainMaterial(ground, splat, { dirt: 2.6, grass: 2.2, moss: 2.0, rock: 3.2, snow: 3.5 });
  const terrainGeo = buildTerrainGeometry(terrain, noise);
  const terrainMesh = new THREE.Mesh(terrainGeo, terrainMat);
  terrainMesh.receiveShadow = true;
  terrainMesh.frustumCulled = false;
  terrainMesh.name = 'terrain';
  group.add(terrainMesh);

  const farMat = new THREE.MeshStandardMaterial({ vertexColors: true, color: lin(0.06, 0.075, 0.06), roughness: 1 });
  const farMesh = new THREE.Mesh(buildFarGeometry(heightFn, noise), farMat);
  farMesh.frustumCulled = false;
  group.add(farMesh);

  // ---------- небо, свет, туман ----------
  progress(0.5, 'небо');
  const sunDir = new THREE.Vector3(0.72, 0.36, 0.59).normalize();
  const horizon = lin(0.30, 0.345, 0.395);
  const sky = createSky({
    sunDir, horizon, zenith: lin(0.075, 0.09, 0.125), ground: lin(0.075, 0.07, 0.065),
    sunColor: lin(1.0, 0.86, 0.66), cover: 0.7,
  });
  group.add(sky.mesh);
  scene.environment = sky.bakeEnvironment(renderer);
  scene.environmentIntensity = 0.9;
  scene.fog = new THREE.FogExp2(horizon.getHex(), 0.0085);
  (scene.fog as THREE.FogExp2).color.copy(horizon);
  scene.background = horizon.clone();

  const hemi = new THREE.HemisphereLight(lin(0.5, 0.58, 0.7), lin(0.12, 0.1, 0.08), 0.35);
  group.add(hemi);
  const sun = new THREE.DirectionalLight(lin(1.0, 0.9, 0.78), 2.2);
  sun.castShadow = true;
  sun.shadow.mapSize.set(q.shadowMap, q.shadowMap);
  const sc = sun.shadow.camera;
  const E = q.shadowExtent;
  sc.left = -E; sc.right = E; sc.top = E; sc.bottom = -E; sc.near = 1; sc.far = 220;
  sun.shadow.bias = -0.0004;
  sun.shadow.normalBias = 0.05;
  sun.shadow.radius = 2.5;
  group.add(sun, sun.target);

  const shadowTarget = new THREE.Vector3();
  const setShadowTarget = (p: THREE.Vector3) => {
    // привязка к сетке текселей — тени не «плавают» при движении цели
    const texel = (2 * E) / q.shadowMap;
    const right = new THREE.Vector3().crossVectors(new THREE.Vector3(0, 1, 0), sunDir).normalize();
    const up = new THREE.Vector3().crossVectors(sunDir, right).normalize();
    const px = Math.round(p.dot(right) / texel) * texel, py = Math.round(p.dot(up) / texel) * texel;
    const pd = p.dot(sunDir);
    shadowTarget.copy(right).multiplyScalar(px).addScaledVector(up, py).addScaledVector(sunDir, pd);
    sun.target.position.copy(shadowTarget);
    sun.position.copy(shadowTarget).addScaledVector(sunDir, 110);
    sun.target.updateMatrixWorld();
    sun.updateMatrixWorld();
  };
  setShadowTarget(new THREE.Vector3(0, 0, 0));

  const settings: EnvSettings = { wind: 1, snowfall: 1, fog: 1, fire: 1 };
  const baseFog = 0.0085;

  const env: Environment = {
    heightAt: sampler.heightAt,
    normalAt: sampler.normalAt,
    terrain,
    trees: [], rocks: [], props: [],
    camp: { center: new THREE.Vector3(0, sampler.heightAt(0, 0), 0), fire: new THREE.Vector3(0, sampler.heightAt(0, 0), 0), radius: camp.radius },
    spawnPlayer: new THREE.Vector3(0, sampler.heightAt(0, 3), 3),
    enemySpawns: [],
    sun, setShadowTarget,
    sunDirection: sunDir,
    vista: { position: new THREE.Vector3(vista.x, sampler.heightAt(vista.x, vista.z) + 1.7, vista.z), target: new THREE.Vector3(0, 6, 0) },
    stats: {},
    settings,
    update(dt, camera) {
      sky.update(dt);
      (scene.fog as THREE.FogExp2).density = baseFog * settings.fog;
      void camera;
    },
    dispose() {
      scene.remove(group);
      sky.dispose();
      terrainGeo.dispose(); terrainMat.dispose(); farMat.dispose();
      for (const d of disposables) d.dispose();
    },
  };
  void terrainU; void TERRAIN_SIZE;
  progress(1, 'готово');
  return env;
}
