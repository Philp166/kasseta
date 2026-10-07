// Сборка персонажа: скелет + меши + материалы. Пока — базовое тело; остальные слои (мех, снаряжение,
// повреждения) подключаются отсюда же.

import * as THREE from 'three';
import { Rig } from './rig';
import { SkinHelper, Surface } from './surface';
import { HeadShape } from './head';
import { buildBody } from './body';
import { buildRegionMap } from './regions';
import { buildFurOutfit } from './outfit';
import { patchNoFlip } from './materials';

export interface CharacterOptions {
  seed?: number;
}

export class Character {
  readonly rig = new Rig();
  readonly group = new THREE.Group();
  readonly meshes: THREE.SkinnedMesh[] = [];
  readonly sk = new SkinHelper(this.rig);
  readonly head = new HeadShape();
  readonly regionMap = buildRegionMap(this.rig);

  constructor(public opts: CharacterOptions = {}) {
    this.group.name = 'Character';
    this.group.add(this.rig.root);
    this.group.updateMatrixWorld(true);
    const body = buildBody(this.rig, this.sk, this.head);
    const mat = (c: number, r = 0.85) => new THREE.MeshStandardMaterial({ color: c, roughness: r, metalness: 0 });
    this.addMesh('skin', body.skin, mat(0xb98a66, 0.6));
    this.addMesh('coat', body.coat, mat(0x4a3322, 0.95));
    this.addMesh('trousers', body.trousers, mat(0x2b2018, 0.95));
    this.addMesh('boots', body.boots, mat(0x3b2a1c, 0.9));
    this.addMesh('belt', body.belt, mat(0x2e1b0f, 0.8));
    const outfit = buildFurOutfit(this.rig, this.sk, body, { fur: 1 });
    const vmat = (r = 0.92, side: THREE.Side = THREE.FrontSide) => new THREE.MeshStandardMaterial({ vertexColors: true, roughness: r, metalness: 0, side });
    this.addMesh('wolf', outfit.wolf, vmat(0.85));
    this.addMesh('furBase', outfit.furBase, vmat(1, THREE.DoubleSide));
    this.addMesh('cuffs', outfit.cuffs, vmat(0.95));
    const furMat = vmat(0.95, THREE.DoubleSide);
    patchNoFlip(furMat);
    this.addMesh('fur', outfit.fur, furMat);
    this.stats = { blades: outfit.blades };
  }
  stats = { blades: 0 };

  addMesh(name: string, surf: Surface, material: THREE.Material): THREE.SkinnedMesh {
    const geo = surf.toGeometry(this.regionMap);
    const mesh = new THREE.SkinnedMesh(geo, material);
    mesh.name = name;
    mesh.frustumCulled = false;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    this.group.add(mesh);
    mesh.bind(this.rig.skeleton, new THREE.Matrix4());
    this.meshes.push(mesh);
    return mesh;
  }
}
