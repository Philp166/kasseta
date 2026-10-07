// Сборка персонажа: скелет + меши + материалы + оружие + аниматор + вторичная физика.
// Два наряда: «evenki» (герой: волчий капюшон, накидка, мех) и «raider» (враг: кожаная броня, шлем).

import * as THREE from 'three';
import { Rig } from './rig';
import { SkinHelper, Surface } from './surface';
import { HeadShape } from './head';
import { buildBody } from './body';
import { buildRegionMap } from './regions';
import { buildFurOutfit } from './outfit';
import { patchNoFlip } from './materials';
import { Animator } from '../animation/animator';
import { handSocket } from '../animation/grips';
import { SpringBones, SPRING_DEFS, bodyColliders } from '../physics/springbones';
import { debugSpear, debugBow } from './debugProps';
import { DamageVisuals } from './damageVisuals';
import type { WeaponCarry } from '../animation/gait';
import type { DamageModel, HitInfo } from '../game/damage';
import type { Region } from './regions';

export interface CharacterOptions {
  outfit?: 'evenki' | 'raider';
  seed?: number;
  /** Плотность меха: 1 — герой, меньше — для врагов. */
  furQuality?: number;
}

export class Character {
  readonly rig = new Rig();
  readonly group = new THREE.Group();
  readonly meshes: THREE.SkinnedMesh[] = [];
  readonly sk = new SkinHelper(this.rig);
  readonly head = new HeadShape();
  readonly regionMap = buildRegionMap(this.rig);
  readonly outfit: 'evenki' | 'raider';
  stats = { blades: 0 };

  /** Вторичная физика (волосы, шкура, подол, обереги). */
  springs!: SpringBones;
  /** Рэгдолл включён: анимации не применяются. */
  ragdollActive = false;
  /** Визуализация повреждений (подключается модулем damage visuals). */
  damageVisuals?: DamageVisuals;
  addWound?: (region: Region, worldPoint: THREE.Vector3, dir: THREE.Vector3, kind: HitInfo['kind'], severity: number) => void;

  /** Оружие: что в руке и что за спиной. */
  readonly weapons: { spear?: THREE.Object3D; bow?: THREE.Object3D } = {};
  carry: WeaponCarry = 'none';
  /** Точки крепления: ладони (оружие) и спина. */
  readonly sockets: Record<'handL' | 'handR' | 'back', THREE.Object3D> = {
    handL: new THREE.Object3D(), handR: new THREE.Object3D(), back: new THREE.Object3D(),
  };
  private _animator: Animator | null = null;

  constructor(public opts: CharacterOptions = {}) {
    this.outfit = opts.outfit ?? 'evenki';
    this.group.name = 'Character';
    this.group.add(this.rig.root);
    this.group.updateMatrixWorld(true);
    const body = buildBody(this.rig, this.sk, this.head);
    const mat = (c: number, r = 0.85) => new THREE.MeshStandardMaterial({ color: c, roughness: r, metalness: 0 });
    const vmat = (r = 0.92, side: THREE.Side = THREE.FrontSide) => new THREE.MeshStandardMaterial({ vertexColors: true, roughness: r, metalness: 0, side });
    if (this.outfit === 'evenki') {
      this.addMesh('skin', body.skin, mat(0xb98a66, 0.6));
      this.addMesh('coat', body.coat, mat(0x4a3322, 0.95));
      this.addMesh('trousers', body.trousers, mat(0x2b2018, 0.95));
      this.addMesh('boots', body.boots, mat(0x3b2a1c, 0.9));
      this.addMesh('belt', body.belt, mat(0x2e1b0f, 0.8));
      const outfit = buildFurOutfit(this.rig, this.sk, body, { fur: opts.furQuality ?? 1 });
      this.addMesh('wolf', outfit.wolf, vmat(0.85));
      this.addMesh('furBase', outfit.furBase, vmat(1, THREE.DoubleSide));
      this.addMesh('cuffs', outfit.cuffs, vmat(0.95));
      const furMat = vmat(0.95, THREE.DoubleSide);
      patchNoFlip(furMat);
      this.addMesh('fur', outfit.fur, furMat);
      this.stats = { blades: outfit.blades };
    } else {
      this.addMesh('skin', body.skin, mat(0xc29a76, 0.6));
      this.addMesh('coat', body.coat, mat(0x3e444a, 0.92));
      this.addMesh('trousers', body.trousers, mat(0x2d2924, 0.95));
      this.addMesh('boots', body.boots, mat(0x2a211a, 0.88));
      this.addMesh('belt', body.belt, mat(0x1d1a17, 0.7));
    }
    this.initDamage();
    this.initSockets();
    this.springs = new SpringBones(this.rig, SPRING_DEFS, bodyColliders(this.rig));
    if (this.outfit === 'raider') this.addPlaceholderHelmet();
    this.weapons.spear = debugSpear();
    if (this.outfit === 'evenki') this.weapons.bow = debugBow();
    this.setCarry('spear');
  }

  /** Шейдерный слой повреждений: подключается ко всем материалам тела и одежды. */
  private initDamage(): void {
    const dv = new DamageVisuals(this);
    for (const m of this.meshes) {
      const mat = m.material as THREE.MeshStandardMaterial;
      switch (m.name) {
        case 'skin': dv.patch(mat, { skin: true }); break;
        case 'coat': case 'trousers': case 'boots': case 'cuffs': dv.patch(mat, { tear: true }); break;
        case 'fur': case 'furBase': case 'wolf': dv.patch(mat, { fur: true }); break;
        default: dv.patch(mat, {});
      }
    }
    this.damageVisuals = dv;
    this.addWound = (r, p, d, k, s) => dv.addWound(r, p, d, k, s);
  }

  // ---------- Оружие ----------

  /** Что сейчас в руке (или undefined). */
  carried(kind: 'spear' | 'bow'): THREE.Object3D | undefined {
    return this.carry === kind ? this.weapons[kind] : undefined;
  }

  /** В руку берётся carry, остальное — за спину. */
  setCarry(kind: WeaponCarry): void {
    this.carry = kind;
    const { spear, bow } = this.weapons;
    if (spear) {
      spear.removeFromParent();
      if (kind === 'spear') { spear.position.set(0, 0, 0); spear.quaternion.identity(); this.sockets.handR.add(spear); }
      else { this.sockets.back.add(spear); spear.position.set(-0.02, 0.14, -0.03); spear.rotation.set(0.1, 0, -0.42); }
    }
    if (bow) {
      bow.removeFromParent();
      if (kind === 'bow') { bow.position.set(0, 0, 0); bow.quaternion.identity(); this.sockets.handL.add(bow); }
      else { this.sockets.back.add(bow); bow.position.set(0.03, 0.04, -0.07); bow.rotation.set(0.0, 0.2, 0.5); }
    }
  }

  private initSockets(): void {
    for (const s of ['L', 'R'] as const) {
      const sk = this.sockets[('hand' + s) as 'handL' | 'handR'];
      const hs = handSocket(s);
      sk.position.copy(hs.position);
      sk.quaternion.copy(hs.quaternion);
      sk.name = 'socket_hand' + s;
      this.rig.b('hand' + s).add(sk);
    }
    this.sockets.back.name = 'socket_back';
    this.sockets.back.position.set(0, 1.2 - 1.23, -0.17);
    this.rig.b('chest').add(this.sockets.back);
  }

  private addPlaceholderHelmet(): void {
    const g = new THREE.Group();
    const iron = new THREE.MeshStandardMaterial({ color: 0x6c7075, roughness: 0.45, metalness: 0.85 });
    const cone = new THREE.Mesh(new THREE.ConeGeometry(0.115, 0.2, 14), iron);
    cone.position.set(0, 0.2, 0.01);
    const rim = new THREE.Mesh(new THREE.TorusGeometry(0.108, 0.012, 6, 18), iron);
    rim.rotation.x = Math.PI / 2;
    rim.position.set(0, 0.105, 0.005);
    const nasal = new THREE.Mesh(new THREE.BoxGeometry(0.016, 0.1, 0.01), iron);
    nasal.position.set(0, 0.06, 0.112);
    g.add(cone, rim, nasal);
    g.traverse((o) => { o.castShadow = true; });
    g.position.set(0, 0.0, 0);
    this.rig.b('head').add(g);
  }

  // ---------- Обновление ----------

  /** Аниматор создаётся лениво: запекание клипов занимает долю секунды. */
  get animator(): Animator {
    if (!this._animator) this._animator = new Animator(this.group, this.rig);
    return this._animator;
  }

  /** Обновить анимацию и вторичную физику (вызывать каждый кадр). */
  update(dt: number): void {
    if (this._animator && !this.ragdollActive) this._animator.update(dt);
    this.group.updateMatrixWorld(true);
    this.springs.update(dt);
  }

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
