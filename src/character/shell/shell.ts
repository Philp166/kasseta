// Оболочка одежды героя из внешней модели (TRELLIS), подготовленной tools/build-shell.mjs: капюшон с волчьей мордой,
// меховая накидка, кафтан с поясом и орнаментом, сапоги. Привязка к НАШЕМУ скелету считается здесь по правилам от
// положения вершины (как у процедурной одежды): торс — цепочка костей, подол — пружинные цепочки, сапоги — ноги.

import * as THREE from 'three';
import type { Rig } from '../rig';
import { COAT } from '../rig';
import { SkinHelper, combineWeights } from '../surface';
import { smoothstep } from '../../core/util';

interface ShellMeta { version: number; verts: number; tris: number; position: number; normal: number; uv: number; units: number; index: number }
interface ShellAssets { meta: ShellMeta; buf: ArrayBuffer; albedo: HTMLImageElement | null }
let assets: ShellAssets | null = null;
let loading: Promise<boolean> | null = null;
const geoCache = new Map<string, THREE.BufferGeometry>();

export const shellReady = (): boolean => assets !== null;

export function preloadShell(base: string = import.meta.env.BASE_URL + 'models/'): Promise<boolean> {
  if (assets) return Promise.resolve(true);
  if (loading) return loading;
  loading = (async () => {
    try {
      const mr = await fetch(base + 'shell.json');
      if (!mr.ok) return false;
      const meta = (await mr.json()) as ShellMeta;
      const br = await fetch(base + 'shell.bin');
      if (!br.ok) return false;
      const buf = await br.arrayBuffer();
      const albedo = await new Promise<HTMLImageElement | null>((res) => {
        const im = new Image();
        im.onload = () => res(im);
        im.onerror = () => res(null);
        im.src = base + 'shell_albedo.jpg';
      });
      assets = { meta, buf, albedo };
      return true;
    } catch (e) {
      console.warn('shell: не удалось загрузить', e);
      return false;
    }
  })();
  return loading;
}

type SW = { b: number[]; w: number[] };

/** Правила весов по положению вершины в позе покоя (метры). */
function weightsAt(sk: SkinHelper, x: number, y: number, z: number): SW {
  const side = x >= 0 ? 'L' : 'R';
  // торс и голова: цепочка костей по высоте
  const torso = (): SW => {
    const base = sk.chainY(y, [['head', 1.56], ['neck', 1.49], ['chest', 1.16], ['spine', 1.05], ['hips', 0]], 0.045);
    const sh = 0.45 * smoothstep(0.12, 0.32, Math.abs(x)) * smoothstep(1.28, 1.4, y) * (1 - smoothstep(1.5, 1.6, y));
    return sh > 0.001 ? combineWeights([base, sk.one(`shoulder${side}`)], [1 - sh, sh]) : base;
  };
  if (y >= 1.04) return torso();
  // подол: как у процедурного кафтана — бёдра, ноги и пружинные цепочки по углу
  const cz = COAT.radiusAt(y).cz;
  const th = Math.atan2(x, z - cz);
  const a = (Math.abs(th) * 180) / Math.PI;
  const tag = a < 60 ? 'F' : a < 122 ? 'S' : 'B';
  const h = smoothstep(0.97, 1.04, y);
  const tY = smoothstep(1.03, 0.64, y);
  const legW = 0.42 * tY * (0.45 + 0.55 * Math.abs(Math.cos(th)));
  const chainW = Math.max(0, 1 - h - legW * (1 - h));
  const cb = sk.chainY(y, [[`skirt${tag}${side}_1`, 0.88], [`skirt${tag}${side}_2`, 0.66], [`skirt${tag}${side}_3`, 0]], 0.08);
  const skirt = combineWeights([sk.one('hips'), sk.one(`upperLeg${side}`), cb], [h, legW * (1 - h), chainW]);
  // ниже подола — ноги и сапоги
  const legK = smoothstep(0.62, 0.5, y);
  if (legK <= 0.001) return skirt;
  const leg = sk.chainY(y, [[`upperLeg${side}`, 0.5], [`lowerLeg${side}`, 0.1], [`foot${side}`, 0]], 0.06);
  const toeK = smoothstep(0.06, 0.16, z) * smoothstep(0.14, 0.07, y);
  const legT = toeK > 0.001 ? combineWeights([leg, sk.one(`toe${side}`)], [1 - toeK, toeK]) : leg;
  return legK >= 0.999 ? legT : combineWeights([skirt, legT], [1 - legK, legK]);
}

export interface ShellBuild { mesh: THREE.SkinnedMesh; geometry: THREE.BufferGeometry }

/** Геометрия оболочки (общая для всех экземпляров) с весами и атрибутами регионов повреждений. */
function shellGeometry(rig: Rig, regionOfBone: Int8Array): THREE.BufferGeometry {
  const cached = geoCache.get('shell');
  if (cached) return cached;
  const { meta, buf } = assets!;
  const n = meta.verts;
  const pos = new Float32Array(buf, meta.position, n * 3);
  const nor = new Float32Array(buf, meta.normal, n * 3);
  const uv = new Float32Array(buf, meta.uv, n * 2);
  const idx = new Uint32Array(buf, meta.index, meta.tris * 3);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  g.setIndex(new THREE.BufferAttribute(idx, 1));
  const sk = new SkinHelper(rig);
  const si = new Uint16Array(n * 4), sw = new Float32Array(n * 4);
  const A = new Float32Array(n * 3), B = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    const r = weightsAt(sk, pos[i * 3], pos[i * 3 + 1], pos[i * 3 + 2]);
    for (let k = 0; k < 4; k++) {
      si[i * 4 + k] = r.b[k]; sw[i * 4 + k] = r.w[k];
      if (r.w[k] > 0) {
        const reg = regionOfBone[r.b[k]];
        if (reg >= 0) { if (reg < 3) A[i * 3 + reg] += r.w[k]; else B[i * 3 + reg - 3] += r.w[k]; }
      }
    }
  }
  g.setAttribute('skinIndex', new THREE.BufferAttribute(si, 4));
  g.setAttribute('skinWeight', new THREE.BufferAttribute(sw, 4));
  g.setAttribute('aRegA', new THREE.BufferAttribute(A, 3));
  g.setAttribute('aRegB', new THREE.BufferAttribute(B, 3));
  g.computeBoundingSphere();
  g.computeBoundingBox();
  geoCache.set('shell', g);
  return g;
}

let sharedMat: THREE.MeshStandardMaterial | null = null;
function shellMaterial(): THREE.MeshStandardMaterial {
  if (sharedMat) return sharedMat;
  const tex = assets!.albedo ? new THREE.Texture(assets!.albedo) : null;
  if (tex) { tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 8; tex.flipY = false; tex.needsUpdate = true; }
  sharedMat = new THREE.MeshStandardMaterial({ map: tex, color: 0xffffff, roughness: 0.95, metalness: 0 });
  sharedMat.name = 'shell';
  return sharedMat;
}

export function buildShell(rig: Rig, regionOfBone: Int8Array): THREE.SkinnedMesh {
  const geo = shellGeometry(rig, regionOfBone);
  const mesh = new THREE.SkinnedMesh(geo, shellMaterial().clone());
  mesh.name = 'shell';
  mesh.frustumCulled = false;
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  mesh.bind(rig.skeleton, new THREE.Matrix4());
  return mesh;
}
