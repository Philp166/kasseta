// Человек (тело, голова, глаза, зубы, язык, ресницы) из данных MakeHuman (CC0): бинарник собирает tools/build-human.mjs.
// Загрузка — один раз на страницу (preloadHuman), потом любой Character строит свои меши синхронно (buildHuman).
// Скиннинг привязан к НАШЕМУ скелету по именам костей; морфы лица — стандартные morphTargetInfluences.

import * as THREE from 'three';
import type { Rig } from '../rig';

interface Attr { off: number; type: 'f32' | 'u8' | 'u16' | 'u32' | 'i8'; n: number; count: number }
interface MorphJSON { name: string; idx: Attr; delta: Attr; count: number }
export interface PartJSON {
  name: string; verts: number; tris: number;
  position: Attr; normal: Attr; index: Attr; uv?: Attr; skinIndex?: Attr; skinWeight?: Attr; morphs: MorphJSON[];
}
export interface HumanJSON {
  version: number;
  bones: Array<{ name: string; parent: string | null; pos: [number, number, number] }>;
  landmarks: Record<string, number[] | number>;
  parts: Record<string, PartJSON>;
  stats: { verts: number; tris: number };
}

interface Assets { json: HumanJSON; buf: ArrayBuffer; eyeImage: HTMLImageElement | null }
let assets: Assets | null = null;
const geoCache = new Map<string, THREE.BufferGeometry>();
let loading: Promise<boolean> | null = null;

export const humanReady = (): boolean => assets !== null;
export const humanJSON = (): HumanJSON | null => assets?.json ?? null;
export const humanEyeImage = (): HTMLImageElement | null => assets?.eyeImage ?? null;

/** Сырые массивы части (для запекания текстур): позиции, нормали, uv, индексы. */
export function humanPartData(name: string): { position: Float32Array; normal: Float32Array; uv: Float32Array | null; index: Uint16Array | Uint32Array } {
  if (!assets) throw new Error('human: данные не загружены');
  const p = assets.json.parts[name];
  return {
    position: view(p.position) as Float32Array,
    normal: view(p.normal) as Float32Array,
    uv: p.uv ? (view(p.uv) as Float32Array) : null,
    index: view(p.index) as Uint16Array | Uint32Array,
  };
}

/** Загрузить данные человека (если файлов нет — вернёт false, игра работает со старой процедурной головой). */
export function preloadHuman(base: string = import.meta.env.BASE_URL + 'models/'): Promise<boolean> {
  if (assets) return Promise.resolve(true);
  if (loading) return loading;
  loading = (async () => {
    try {
      const jr = await fetch(base + 'human.json');
      if (!jr.ok) return false;
      const json = (await jr.json()) as HumanJSON;
      const br = await fetch(base + 'human.bin');
      if (!br.ok) return false;
      const buf = await br.arrayBuffer();
      const eyeImage = await new Promise<HTMLImageElement | null>((res) => {
        const im = new Image();
        im.onload = () => res(im);
        im.onerror = () => res(null);
        im.src = base + 'eye_brown.png';
      });
      assets = { json, buf, eyeImage };
      return true;
    } catch (e) {
      console.warn('human: не удалось загрузить данные', e);
      return false;
    }
  })();
  return loading;
}

function view(a: Attr): Float32Array | Uint8Array | Uint16Array | Uint32Array | Int8Array {
  const { buf } = assets!;
  const len = a.count * a.n;
  switch (a.type) {
    case 'f32': return new Float32Array(buf, a.off, len);
    case 'u8': return new Uint8Array(buf, a.off, len);
    case 'u16': return new Uint16Array(buf, a.off, len);
    case 'u32': return new Uint32Array(buf, a.off, len);
    case 'i8': return new Int8Array(buf, a.off, len);
  }
}

export interface HumanParts {
  body: THREE.SkinnedMesh;
  head: THREE.SkinnedMesh;
  eyeL: THREE.SkinnedMesh;
  eyeR: THREE.SkinnedMesh;
  corneaL: THREE.SkinnedMesh;
  corneaR: THREE.SkinnedMesh;
  teethUpper: THREE.SkinnedMesh;
  teethLower: THREE.SkinnedMesh;
  tongue: THREE.SkinnedMesh;
  lashL: THREE.SkinnedMesh;
  lashR: THREE.SkinnedMesh;
}

/** Геометрия части: позиции/нормали/uv/индексы/скиннинг (индексы костей — в нашем скелете) + регионы повреждений. */
function partGeometry(p: PartJSON, rig: Rig, regionOfBone: Int8Array, boneNames: string[]): THREE.BufferGeometry {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(view(p.position) as Float32Array, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(view(p.normal) as Float32Array, 3));
  if (p.uv) g.setAttribute('uv', new THREE.BufferAttribute(view(p.uv) as Float32Array, 2));
  const n = p.verts;
  const si = view(p.skinIndex!) as Uint8Array, sw = view(p.skinWeight!) as Uint8Array;
  const remap = boneNames.map((name) => rig.idx(name));
  const idx = new Uint16Array(n * 4);
  const wt = new Float32Array(n * 4);
  const A = new Float32Array(n * 3), B = new Float32Array(n * 3);
  for (let i = 0; i < n * 4; i++) {
    const w = sw[i] / 255;
    wt[i] = w;
    idx[i] = w > 0 ? remap[si[i]] : 0;
    if (w > 0) {
      const r = regionOfBone[idx[i]];
      if (r >= 0) { const v = (i / 4) | 0; if (r < 3) A[v * 3 + r] += w; else B[v * 3 + r - 3] += w; }
    }
  }
  g.setAttribute('skinIndex', new THREE.BufferAttribute(idx, 4));
  g.setAttribute('skinWeight', new THREE.BufferAttribute(wt, 4));
  g.setAttribute('aRegA', new THREE.BufferAttribute(A, 3));
  g.setAttribute('aRegB', new THREE.BufferAttribute(B, 3));
  const ix = view(p.index);
  g.setIndex(new THREE.BufferAttribute(ix.constructor === Uint32Array ? (ix as Uint32Array) : (ix as Uint16Array), 1));
  if (p.morphs.length) {
    const arr: THREE.BufferAttribute[] = [];
    const names: string[] = [];
    for (const m of p.morphs) {
      const dense = new Float32Array(n * 3);
      const mi = view(m.idx) as Uint32Array, md = view(m.delta) as Float32Array;
      for (let k = 0; k < m.count; k++) {
        const v = mi[k];
        dense[v * 3] = md[k * 3]; dense[v * 3 + 1] = md[k * 3 + 1]; dense[v * 3 + 2] = md[k * 3 + 2];
      }
      const ba = new THREE.BufferAttribute(dense, 3);
      ba.name = m.name;
      arr.push(ba);
      names.push(m.name);
    }
    g.morphAttributes.position = arr;
    g.morphTargetsRelative = true;
    g.userData.morphNames = names;
  }
  g.computeBoundingSphere();
  g.computeBoundingBox();
  return g;
}

export class Human {
  readonly parts: HumanParts;
  readonly meshes: THREE.SkinnedMesh[];
  readonly landmarks: Record<string, number[] | number>;
  readonly json: HumanJSON;
  /** Состояние морфов лица (имя → вес). */
  readonly morph: Record<string, number> = {};
  eyeImage: HTMLImageElement | null;

  constructor(rig: Rig, regionOfBone: Int8Array, materials: Partial<Record<keyof HumanParts, THREE.Material>>) {
    if (!assets) throw new Error('human: данные не загружены (вызовите preloadHuman)');
    this.json = assets.json;
    this.landmarks = assets.json.landmarks;
    this.eyeImage = assets.eyeImage;
    const names = assets.json.bones.map((b) => b.name);
    const mk = (key: keyof HumanParts): THREE.SkinnedMesh => {
      const pj = assets!.json.parts[key];
      // геометрия общая для всех персонажей (индексы костей одинаковы), у каждого меша свой скелет и морфы
      let geo = geoCache.get(key);
      if (!geo) { geo = partGeometry(pj, rig, regionOfBone, names); geoCache.set(key, geo); }
      const mat = materials[key] ?? new THREE.MeshStandardMaterial({ color: 0xb98a66, roughness: 0.6 });
      const mesh = new THREE.SkinnedMesh(geo, mat);
      mesh.name = key === 'body' ? 'skin' : key === 'head' ? 'skinHead' : key;
      mesh.frustumCulled = false;
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mesh.bind(rig.skeleton, new THREE.Matrix4());
      return mesh;
    };
    const keys: Array<keyof HumanParts> = ['body', 'head', 'eyeL', 'eyeR', 'corneaL', 'corneaR', 'teethUpper', 'teethLower', 'tongue', 'lashL', 'lashR'];
    const o: Record<string, THREE.SkinnedMesh> = {};
    for (const k of keys) o[k] = mk(k);
    this.parts = o as unknown as HumanParts;
    this.meshes = keys.map((k) => o[k]);
    for (const m of this.meshes) if (m.geometry.userData.morphNames) m.updateMorphTargets();
    // ресницы и глаза не отбрасывают тень (дорого и незаметно)
    for (const k of ['eyeL', 'eyeR', 'corneaL', 'corneaR', 'lashL', 'lashR', 'tongue', 'teethUpper', 'teethLower'] as const) this.parts[k].castShadow = false;
  }

  /** Установить вес морфа лица (во всех частях, где он есть). */
  setMorph(name: string, w: number): void {
    this.morph[name] = w;
    for (const m of this.meshes) {
      const d = m.morphTargetDictionary;
      if (d && name in d && m.morphTargetInfluences) m.morphTargetInfluences[d[name]] = w;
    }
  }

  /** Все морфы сразу (отсутствующие — в ноль). */
  setMorphs(w: Record<string, number>): void {
    for (const m of this.meshes) {
      const d = m.morphTargetDictionary;
      if (!d || !m.morphTargetInfluences) continue;
      for (const k in d) m.morphTargetInfluences[d[k]] = w[k] ?? 0;
    }
    Object.assign(this.morph, w);
  }
}
