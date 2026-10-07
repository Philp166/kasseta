// Сборка персонажа: скелет + меши + материалы + оружие + аниматор + вторичная физика.
// Два наряда: «evenki» (герой: волчий капюшон, накидка, мех) и «raider» (враг: кожаная броня, шлем).

import * as THREE from 'three';
import { Rig } from './rig';
import { SkinHelper, Surface } from './surface';
import { HeadShape } from './head';
import { buildBody } from './body';
import { buildRegionMap } from './regions';
import { buildFurOutfit, buildCuffsOnly } from './outfit';
import { patchNoFlip } from './materials';
import { Animator } from '../animation/animator';
import { handSocket } from '../animation/grips';
import { SpringBones, SPRING_DEFS, bodyColliders } from '../physics/springbones';
import { buildSpear, buildBow, buildQuiver, buildKnife, buildPouch, buildFangCluster, buildMedallion } from './gear';
import { DamageVisuals } from './damageVisuals';
import { Human, humanReady, humanEyeImage } from './human/human';
import { makeHumanMaterials } from './human/materials';
import { getSkins } from './human/skin';
import { shellReady, buildShell } from './shell/shell';
import type { WeaponCarry } from '../animation/gait';
import type { DamageModel, HitInfo } from '../game/damage';
import type { Region } from './regions';

/** Сгибание пальцев при полном хвате (градусы вокруг оси Z кисти для 1-й, 2-й, 3-й фаланги). */
const FINGER_CURL: Record<string, [number, number, number]> = {
  index: [26, 46, 30], middle: [32, 52, 32], ring: [38, 54, 34], pinky: [44, 56, 36],
};
/** Большой палец: [поворот к ладони вокруг Y, сгибание вокруг Z] по фалангам (градусы, знак по стороне). */
const THUMB: Array<[number, number]> = [[-30, 10], [0, 30], [0, 34]];

export interface CharacterOptions {
  outfit?: 'evenki' | 'raider';
  seed?: number;
  /** Плотность меха: 1 — герой, меньше — для врагов. */
  furQuality?: number;
  /** Не использовать оболочку одежды из внешней модели (процедурная одежда). */
  noShell?: boolean;
}

export class Character {
  readonly rig = new Rig();
  readonly group = new THREE.Group();
  readonly meshes: THREE.SkinnedMesh[] = [];
  readonly sk = new SkinHelper(this.rig);
  readonly head = new HeadShape();
  readonly regionMap = buildRegionMap(this.rig);
  /** Реалистичный человек (MakeHuman) — если данные загружены; иначе старая процедурная голова. */
  human: Human | null = null;
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
  /** Прочее снаряжение на теле (колчан, нож, сумка, обереги). */
  readonly gear: Record<string, THREE.Object3D> = {};
  carry: WeaponCarry = 'none';
  /** Натяжение лука 0..1 (выставляет игрок): тетива идёт за правой рукой. */
  bowDraw = 0;
  private _nockV = new THREE.Vector3();
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
    const useHuman = humanReady();
    // оболочка одежды героя из внешней модели (капюшон, накидка, кафтан, сапоги); рукава и манжеты — мои
    const useShell = useHuman && shellReady() && this.outfit === 'evenki' && !opts.noShell;
    const body = buildBody(this.rig, this.sk, this.head, !useHuman, useShell);
    const mat = (c: number, r = 0.85) => new THREE.MeshStandardMaterial({ color: c, roughness: r, metalness: 0 });
    const vmat = (r = 0.92, side: THREE.Side = THREE.FrontSide) => new THREE.MeshStandardMaterial({ vertexColors: true, roughness: r, metalness: 0, side });
    if (useHuman) this.addHuman();
    if (this.outfit === 'evenki' && useShell) {
      this.addMesh('coat', body.sleeves, mat(0x3b2a1c, 0.95));
      const co = buildCuffsOnly(this.sk, { fur: opts.furQuality ?? 1 });
      const furMat0 = vmat(0.95, THREE.DoubleSide);
      patchNoFlip(furMat0);
      this.addMesh('cuffs', co.cuffs, vmat(0.95));
      this.addMesh('fur', co.fur, furMat0);
      this.stats = { blades: co.blades };
      const sh = buildShell(this.rig, this.regionMap);
      this.group.add(sh);
      this.meshes.push(sh);
    } else if (this.outfit === 'evenki') {
      if (!useHuman) this.addMesh('skin', body.skin, mat(0xb98a66, 0.6));
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
      if (!useHuman) this.addMesh('skin', body.skin, mat(0xc29a76, 0.6));
      this.addMesh('coat', body.coat, mat(0x3e444a, 0.92));
      this.addMesh('trousers', body.trousers, mat(0x2d2924, 0.95));
      this.addMesh('boots', body.boots, mat(0x2a211a, 0.88));
      this.addMesh('belt', body.belt, mat(0x1d1a17, 0.7));
    }
    this.initDamage();
    this.initSockets();
    this.springs = new SpringBones(this.rig, SPRING_DEFS, bodyColliders(this.rig));
    if (this.outfit === 'raider') this.addPlaceholderHelmet();
    this.weapons.spear = buildSpear(this.outfit === 'evenki' ? 'hunter' : 'raider');
    if (this.outfit === 'evenki') {
      this.weapons.bow = buildBow();
      this.attachGear();
    }
    this.setCarry('spear');
  }

  /** Шейдерный слой повреждений: подключается ко всем материалам тела и одежды. */
  private initDamage(): void {
    const dv = new DamageVisuals(this);
    for (const m of this.meshes) {
      const mat = m.material as THREE.MeshStandardMaterial;
      switch (m.name) {
        case 'skin': case 'skinHead': dv.patch(mat, { skin: true }); break;
        case 'eyeL': case 'eyeR': case 'corneaL': case 'corneaR': case 'teethUpper': case 'teethLower': case 'tongue': case 'lashL': case 'lashR': break;
        case 'coat': case 'trousers': case 'boots': case 'cuffs': case 'shell': dv.patch(mat, { tear: true }); break;
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
      else { this.sockets.back.add(spear); spear.position.set(0.02, 0.1, -0.07); spear.rotation.set(0.12, 0, -0.5); }
    }
    if (bow) {
      bow.removeFromParent();
      if (kind === 'bow') { bow.position.set(0, 0, 0); bow.quaternion.identity(); this.sockets.handL.add(bow); }
      else { this.sockets.back.add(bow); bow.position.set(0.0, -0.02, -0.13); bow.rotation.set(0.0, 0.0, -0.95); }
    }
  }

  /** Поставить предмет на кость: позиция — в мировых координатах позы покоя (поворотов покоя нет). */
  private put(name: string, obj: THREE.Object3D, bone: string, rest: [number, number, number], euler: [number, number, number] = [0, 0, 0], scale = 1): THREE.Object3D {
    const spec = this.rig.specs.get(bone)!;
    obj.position.set(rest[0] - spec.pos[0], rest[1] - spec.pos[1], rest[2] - spec.pos[2]);
    obj.rotation.set(euler[0], euler[1], euler[2]);
    obj.scale.setScalar(scale);
    this.rig.b(bone).add(obj);
    this.gear[name] = obj;
    return obj;
  }

  /** Снаряжение героя: колчан со стрелами, нож, сумка, обереги (на пружинных костях). */
  private attachGear(): void {
    this.put('quiver', buildQuiver(), 'chest', [-0.115, 1.43, -0.245], [-0.14, 0, 0.5]);
    this.put('knife', buildKnife(), 'hips', [0.175, 1.0, 0.115], [0, Math.PI - 0.55, 0.3]);
    this.put('pouch', buildPouch(), 'hips', [-0.205, 0.995, -0.01], [0, -Math.PI / 2 + 0.2, 0]);
    // обереги висят на пружинных цепочках: корень предмета = голова первой кости цепочки
    const hang = (name: string, obj: THREE.Object3D, bone: string, scale = 1, euler: [number, number, number] = [0, 0, 0], dz = 0): void => {
      const spec = this.rig.specs.get(bone)!;
      void spec;
      obj.position.set(0, 0, dz);
      obj.rotation.set(euler[0], euler[1], euler[2]);
      obj.scale.setScalar(scale);
      this.rig.b(bone).add(obj);
      this.gear[name] = obj;
    };
    hang('medallion', buildMedallion(), 'medal_1', 1, [0, 0, 0], 0.0);
    this.gear.medallion.position.y = -0.084;
    hang('fangsL', buildFangCluster({ feather: 'white' }), 'fangL_1', 0.8, [0, 0.15, 0]);
    hang('fangsR', buildFangCluster({ feather: 'barred' }), 'fangR_1', 0.8, [0, -0.15, 0]);
    hang('tasselL', buildFangCluster({ feather: 'dark' }), 'featherBeltL_1', 0.75, [0, 0.4, 0]);
  }

  /** Тетива лука: следует за правой рукой при натяжении; иначе — в покое. Возвращает мировую точку наложения стрелы. */
  nockWorld(out = new THREE.Vector3()): THREE.Vector3 {
    const bow = this.weapons.bow;
    if (bow && this.carry === 'bow') {
      const n = bow.userData.nockLocal as THREE.Vector3 | undefined;
      bow.updateWorldMatrix(true, false);
      return out.copy(n ?? this._nockV.set(0, 0, -0.17)).applyMatrix4(bow.matrixWorld);
    }
    return this.sockets.handR.getWorldPosition(out);
  }

  private updateBow(): void {
    const bow = this.weapons.bow;
    if (!bow || this.carry !== 'bow') return;
    const fn = bow.userData.updateString as ((n: THREE.Vector3 | null, showArrow?: boolean) => void) | undefined;
    if (!fn) return;
    if (this.bowDraw > 0.02) {
      bow.updateWorldMatrix(true, false);
      this.sockets.handR.getWorldPosition(this._nockV);
      bow.worldToLocal(this._nockV);
      fn(this._nockV, true);
    } else fn(null, false);
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
    this.updateFingers(dt);
    this.group.updateMatrixWorld(true);
    this.springs.update(dt);
    this.updateBow();
  }

  // ---------- Пальцы ----------
  private gripNow = { L: 0, R: 0 };
  private gripTarget = { L: 0, R: 0 };
  private fingerQ = new THREE.Quaternion();
  private fingerE = new THREE.Euler();

  /** Хват: пальцы сгибаются вокруг оси оружия (ось Z кисти). amount 0..1 — степень; thumb — прижатие большого. */
  setHandGrip(side: 'L' | 'R', amount: number, thumb = amount): void {
    const sgn = side === 'L' ? -1 : 1;
    const FD = Math.PI / 180;
    const set = (name: string, rx: number, ry: number, rz: number) => {
      const b = this.rig.bones.get(name);
      if (!b) return;
      b.quaternion.setFromEuler(this.fingerE.set(rx * FD, ry * FD * sgn, rz * FD * sgn));
    };
    const k = amount;
    for (const [f, c] of Object.entries(FINGER_CURL)) {
      set(`${f}1${side}`, 0, 0, c[0] * k);
      set(`${f}2${side}`, 0, 0, c[1] * k);
      set(`${f}3${side}`, 0, 0, c[2] * k);
    }
    set(`thumb1${side}`, 0, THUMB[0][0] * thumb, THUMB[0][1] * thumb);
    set(`thumb2${side}`, 0, THUMB[1][0] * thumb, THUMB[1][1] * thumb);
    set(`thumb3${side}`, 0, THUMB[2][0] * thumb, THUMB[2][1] * thumb);
  }

  private updateFingers(dt: number): void {
    if (!this.human) return;
    const g = this.gripTarget;
    if (this.ragdollActive || !this._animator) { g.L = 0; g.R = 0; }
    else {
      this._animator.grip(g);
      // лук: левая — на рукояти (чуть слабее кулака), правая — «крючок» на тетиве
      if (this.carry === 'bow') { g.R = Math.min(g.R, 0.75); g.L = Math.min(g.L, 0.85); }
    }
    const k = 1 - Math.exp(-16 * dt);
    this.gripNow.L += (g.L - this.gripNow.L) * k;
    this.gripNow.R += (g.R - this.gripNow.R) * k;
    this.setHandGrip('L', this.gripNow.L, this.carry === 'bow' ? 0.8 : this.gripNow.L);
    this.setHandGrip('R', this.gripNow.R, this.carry === 'bow' ? 0.0 : this.gripNow.R);
  }

  /** Тело, голова, глаза, зубы из данных MakeHuman. */
  private addHuman(): void {
    const sk = getSkins();
    const mats = makeHumanMaterials({ eyeImage: humanEyeImage(), head: sk?.head ?? {}, body: sk?.body ?? {}, tone: this.outfit === 'evenki' ? 0xb08462 : 0xc29a76 });
    const h = new Human(this.rig, this.regionMap, mats);
    for (const m of h.meshes) { this.group.add(m); this.meshes.push(m); }
    this.human = h;
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
