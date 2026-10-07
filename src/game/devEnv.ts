// Запасное (упрощённое) окружение по контракту EnvironmentLike: холмы, поляна, ели-конусы.
// Нужно для тестов физики и как резерв, если основное окружение не загрузилось.

import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type { EnvironmentLike, EnvTree, EnvRock, TerrainData } from './envTypes';
import { RNG, fbm2, smoothstep, lerp } from '../core/util';

export function createDevEnvironment(scene: THREE.Scene, seed = 7): EnvironmentLike {
  const size = 240, segments = 160;
  const half = size / 2;
  const n = segments + 1;
  const step = size / segments;
  const heights = new Float32Array(n * n);
  const rawH = (x: number, z: number) => {
    const r = Math.hypot(x, z);
    const hills = (fbm2(x * 0.011 + 40, z * 0.011 + 17, 4, seed) - 0.45) * 22;
    const detail = (fbm2(x * 0.06, z * 0.06, 3, seed + 5) - 0.5) * 1.6;
    const clearing = smoothstep(13, 38, r);
    const rim = smoothstep(80, 118, r) * 10;
    return (hills + detail) * clearing + rim;
  };
  for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) heights[i * n + j] = rawH(-half + j * step, -half + i * step);
  const terrain: TerrainData = { size, segments, heights, originX: -half, originZ: -half };

  const heightAt = (x: number, z: number) => {
    const fx = (x - terrain.originX) / step, fz = (z - terrain.originZ) / step;
    const j = Math.max(0, Math.min(segments - 1, Math.floor(fx))), i = Math.max(0, Math.min(segments - 1, Math.floor(fz)));
    const tx = Math.max(0, Math.min(1, fx - j)), tz = Math.max(0, Math.min(1, fz - i));
    const h00 = heights[i * n + j], h10 = heights[i * n + j + 1], h01 = heights[(i + 1) * n + j], h11 = heights[(i + 1) * n + j + 1];
    // та же триангуляция, что и у физики: (a,b,c)=(00,01z,10x) и (c,b,d)
    if (tx + tz <= 1) return h00 + (h10 - h00) * tx + (h01 - h00) * tz;
    return h11 + (h01 - h11) * (1 - tx) + (h10 - h11) * (1 - tz);
  };
  const normalAt = (x: number, z: number, out = new THREE.Vector3()) => {
    const e = 0.6;
    return out.set(heightAt(x - e, z) - heightAt(x + e, z), 2 * e, heightAt(x, z - e) - heightAt(x, z + e)).normalize();
  };

  // меш рельефа
  const geo = new THREE.PlaneGeometry(size, size, segments, segments);
  geo.rotateX(-Math.PI / 2);
  const pos = geo.attributes.position as THREE.BufferAttribute;
  const col = new Float32Array(pos.count * 3);
  const c = new THREE.Color();
  for (let k = 0; k < pos.count; k++) {
    const x = pos.getX(k), z = pos.getZ(k);
    const y = heightAt(x, z);
    pos.setY(k, y);
  }
  geo.computeVertexNormals();
  const nrm = geo.attributes.normal as THREE.BufferAttribute;
  for (let k = 0; k < pos.count; k++) {
    const x = pos.getX(k), z = pos.getZ(k), y = pos.getY(k);
    const slope = 1 - nrm.getY(k);
    const nz = fbm2(x * 0.15, z * 0.15, 3, seed + 9);
    const snow = smoothstep(0.52, 0.7, nz + y * 0.02 - slope * 1.2);
    const moss = smoothstep(0.35, 0.65, fbm2(x * 0.05, z * 0.05, 3, seed + 3)) * (1 - snow);
    c.setRGB(0.2, 0.17, 0.13); // мёрзлая земля
    c.lerp(new THREE.Color(0.17, 0.2, 0.12), moss * 0.7);
    c.lerp(new THREE.Color(0.32, 0.3, 0.27), smoothstep(0.25, 0.5, slope));
    c.lerp(new THREE.Color(0.78, 0.82, 0.86), snow);
    const k3 = k * 3;
    col[k3] = c.r; col[k3 + 1] = c.g; col[k3 + 2] = c.b;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  // порядок индексов физики и рендера не обязан совпадать, но высоты — те же
  const ground = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1 }));
  ground.receiveShadow = true;
  scene.add(ground);

  // деревья
  const rng = new RNG(seed);
  const trees: EnvTree[] = [];
  const rocks: EnvRock[] = [];
  const treeGeos: THREE.BufferGeometry[] = [];
  const trunk = new THREE.CylinderGeometry(0.22, 0.38, 3.2, 7);
  trunk.translate(0, 1.6, 0);
  paint(trunk, new THREE.Color(0.2, 0.14, 0.1));
  treeGeos.push(trunk);
  for (let t = 0; t < 7; t++) {
    const r = 2.6 - t * 0.3, h = 2.6 - t * 0.12;
    const cone = new THREE.ConeGeometry(r, h, 9, 1, true);
    cone.translate(0, 3 + t * 1.5, 0);
    paint(cone, new THREE.Color().setRGB(0.07 + t * 0.006, 0.17 + t * 0.012, 0.1));
    treeGeos.push(cone);
  }
  const treeGeo = mergeGeometries(treeGeos)!;
  const treeMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95, side: THREE.DoubleSide });
  const placed: { x: number; z: number }[] = [];
  for (let tries = 0; tries < 2600 && placed.length < 520; tries++) {
    const x = rng.range(-half + 6, half - 6), z = rng.range(-half + 6, half - 6);
    const r = Math.hypot(x, z);
    if (r < 17) continue;
    if (placed.some((p) => (p.x - x) ** 2 + (p.z - z) ** 2 < 11)) continue;
    placed.push({ x, z });
  }
  const inst = new THREE.InstancedMesh(treeGeo, treeMat, placed.length);
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), p = new THREE.Vector3();
  placed.forEach((t, i) => {
    const sc = rng.range(0.8, 1.7);
    const y = heightAt(t.x, t.z) - 0.1;
    q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), rng.range(0, Math.PI * 2));
    m.compose(p.set(t.x, y, t.z), q, s.set(sc, sc, sc));
    inst.setMatrixAt(i, m);
    if (Math.hypot(t.x, t.z) < 95) trees.push({ x: t.x, y, z: t.z, radius: 0.3 * sc, height: 12 * sc });
  });
  inst.castShadow = true;
  inst.receiveShadow = true;
  scene.add(inst);
  // валуны
  for (let k = 0; k < 40; k++) {
    const a = rng.range(0, Math.PI * 2), r = rng.range(20, 85);
    const x = Math.cos(a) * r, z = Math.sin(a) * r, rad = rng.range(0.6, 1.8);
    const y = heightAt(x, z) + rad * 0.3;
    const rock = new THREE.Mesh(new THREE.IcosahedronGeometry(rad, 1), new THREE.MeshStandardMaterial({ color: 0x5a5851, roughness: 1, flatShading: true }));
    rock.position.set(x, y, z);
    rock.scale.set(1, 0.7, 1);
    rock.castShadow = rock.receiveShadow = true;
    scene.add(rock);
    rocks.push({ x, y, z, radius: rad * 0.8 });
  }

  // свет
  const hemi = new THREE.HemisphereLight(0xa9bccd, 0x3b342b, 1.1);
  scene.add(hemi);
  const sun = new THREE.DirectionalLight(0xfff0dc, 3.0);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  const sc = sun.shadow.camera;
  sc.left = -22; sc.right = 22; sc.top = 22; sc.bottom = -22; sc.near = 1; sc.far = 120;
  sun.shadow.bias = -0.0003;
  sun.shadow.normalBias = 0.03;
  scene.add(sun, sun.target);
  const sunDir = new THREE.Vector3(-0.5, 0.75, 0.42).normalize();
  scene.fog = new THREE.FogExp2(0x9aa6b1, 0.011);
  scene.background = new THREE.Color(0x9aa6b1);

  const spawnPlayer = new THREE.Vector3(0, heightAt(0, 4) + 0.05, 4);
  const enemySpawns: THREE.Vector3[] = [];
  for (let k = 0; k < 12; k++) {
    const a = (k / 12) * Math.PI * 2, r = 38 + (k % 3) * 6;
    const x = Math.cos(a) * r, z = Math.sin(a) * r;
    enemySpawns.push(new THREE.Vector3(x, heightAt(x, z) + 0.05, z));
  }

  return {
    heightAt, normalAt, terrain, trees, rocks, props: [],
    camp: { center: new THREE.Vector3(0, heightAt(0, 0), 0), fire: new THREE.Vector3(0, heightAt(0, 0), 0), radius: 12 },
    spawnPlayer, enemySpawns, sun,
    setShadowTarget(t: THREE.Vector3) {
      sun.target.position.copy(t);
      sun.position.copy(t).addScaledVector(sunDir, 60);
      sun.target.updateMatrixWorld();
    },
    update() {},
    dispose() {
      scene.remove(ground, inst, hemi, sun, sun.target);
    },
  };
}

function paint(g: THREE.BufferGeometry, c: THREE.Color): void {
  const n = g.attributes.position.count;
  const arr = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { arr[i * 3] = c.r; arr[i * 3 + 1] = c.g; arr[i * 3 + 2] = c.b; }
  g.setAttribute('color', new THREE.BufferAttribute(arr, 3));
  g.deleteAttribute('uv');
}

export { lerp as _lerp };
