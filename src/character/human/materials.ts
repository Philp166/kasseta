// Материалы человека: кожа (MeshPhysicalMaterial с мягким «подповерхностным» оттенком через sheen), глаза с влажным
// роговичным слоем, зубы, язык, ресницы. Текстуры кожи делает skin.ts (процедурно, запекание по UV).

import * as THREE from 'three';
import type { HumanParts } from './human';

export interface SkinSet {
  map?: THREE.Texture | null;
  normalMap?: THREE.Texture | null;
  roughnessMap?: THREE.Texture | null;
}

export interface HumanMaterialOpts {
  eyeImage: HTMLImageElement | null;
  head: SkinSet;
  body: SkinSet;
  tone?: number;
}

function skinMaterial(s: SkinSet, tone: number): THREE.MeshPhysicalMaterial {
  const m = new THREE.MeshPhysicalMaterial({
    color: s.map ? 0xffffff : tone,
    map: s.map ?? null,
    normalMap: s.normalMap ?? null,
    normalScale: new THREE.Vector2(0.9, 0.9),
    roughnessMap: s.roughnessMap ?? null,
    roughness: 1,
    metalness: 0,
    sheen: 0.22,
    sheenRoughness: 0.6,
    sheenColor: new THREE.Color(0xb98a6c),
    specularIntensity: 0.45,
    clearcoat: 0.0,
  });
  m.name = 'skin';
  return m;
}

export function makeHumanMaterials(o: HumanMaterialOpts): Partial<Record<keyof HumanParts, THREE.Material>> {
  const tone = o.tone ?? 0xb08462;
  let eyeTex: THREE.Texture | null = null;
  if (o.eyeImage) {
    eyeTex = new THREE.Texture(o.eyeImage);
    eyeTex.colorSpace = THREE.SRGBColorSpace;
    eyeTex.anisotropy = 8;
    eyeTex.needsUpdate = true;
  }
  const eye = new THREE.MeshStandardMaterial({ color: eyeTex ? 0xffffff : 0x4a3220, map: eyeTex, roughness: 0.34, metalness: 0 });
  eye.name = 'eye';
  // роговица: чёрная «стеклянная» оболочка, добавляющая только блики и отражения среды
  const cornea = new THREE.MeshStandardMaterial({
    color: 0x000000, roughness: 0.03, metalness: 0, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, envMapIntensity: 1.4,
  });
  cornea.name = 'cornea';
  const teeth = new THREE.MeshStandardMaterial({ color: 0xdcd2bc, roughness: 0.38 });
  const tongue = new THREE.MeshStandardMaterial({ color: 0x8b3a3c, roughness: 0.55 });
  const lash = new THREE.MeshStandardMaterial({ color: 0x0b0705, roughness: 0.9, side: THREE.DoubleSide });
  const body = skinMaterial(o.body, tone);
  const head = skinMaterial(o.head, tone);
  return { body, head, eyeL: eye, eyeR: eye, corneaL: cornea, corneaR: cornea, teethUpper: teeth, teethLower: teeth, tongue, lashL: lash, lashR: lash };
}
