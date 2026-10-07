// Модель повреждений по регионам тела: голова, корпус, обе руки, обе ноги.
// От неё зависят: стадия лица (1..4), раны на теле, хромота и сутулость в анимации, скорость, исход боя.

import * as THREE from 'three';
import { REGIONS, Region } from '../character/regions';
import { clamp } from '../core/util';

export interface HitInfo {
  /** Базовый урон до множителей региона. */
  amount: number;
  region: Region;
  /** Мировая точка попадания. */
  point: THREE.Vector3;
  /** Направление удара (от атакующего к цели, нормализованное). */
  dir: THREE.Vector3;
  /** Тип: колющий/рубящий/стрела — влияет на вид раны и отбрасывание. */
  kind: 'pierce' | 'slash' | 'arrow' | 'blunt';
  /** Сила отбрасывания (м/с). */
  knock?: number;
  /** Не снимается блоком/уклоном. */
  unblockable?: boolean;
  source?: unknown;
}

export interface Wound {
  region: Region;
  /** Положение в системе покоя меша (для шейдера). */
  rest: THREE.Vector3;
  radius: number;
  severity: number;
  seed: number;
  /** Возраст в секундах (потёки растут). */
  age: number;
  kind: HitInfo['kind'];
}

const REGION_HP: Record<Region, number> = { head: 36, torso: 110, armL: 44, armR: 44, legL: 56, legR: 56 };
/** Сколько урона по региону превращается в общую потерю здоровья. */
const GLOBAL_MULT: Record<Region, number> = { head: 1.9, torso: 1.0, armL: 0.55, armR: 0.55, legL: 0.65, legR: 0.65 };

export class DamageModel {
  maxHp = 100;
  hp = 100;
  region: Record<Region, number> = { head: 36, torso: 110, armL: 44, armR: 44, legL: 56, legR: 56 };
  wounds: Wound[] = [];
  dead = false;
  /** Последний регион, получивший урон. */
  lastHit: Region | null = null;
  /** Источник смерти. */
  deathHit: HitInfo | null = null;

  /** Доля повреждений региона: 0 — цел, 1 — выведен из строя. */
  frac(r: Region): number {
    return clamp(1 - this.region[r] / REGION_HP[r]);
  }

  /** Общая «жизнь» 0..1. */
  get health(): number {
    return clamp(this.hp / this.maxHp);
  }

  /** Стадия лица 1..4 (как на референсе): здоров → ссадины → глубокая рана → тяжёлая травма. */
  get faceStage(): 1 | 2 | 3 | 4 {
    const f = Math.max(this.frac('head'), (1 - this.health) * 0.62);
    if (f < 0.12) return 1;
    if (f < 0.4) return 2;
    if (f < 0.72) return 3;
    return 4;
  }

  /** Непрерывная степень повреждений лица (для плавного смешивания стадий): 0..3. */
  get faceBlend(): number {
    const f = Math.max(this.frac('head'), (1 - this.health) * 0.62);
    return clamp(f / 0.72, 0, 1) * 3;
  }

  /** Хромота: поражённая нога и степень (0..1). */
  get limp(): { level: number; side: 'L' | 'R' | null } {
    const l = this.frac('legL'), r = this.frac('legR');
    const m = Math.max(l, r);
    if (m < 0.3) return { level: 0, side: null };
    return { level: clamp((m - 0.15) / 0.7), side: l >= r ? 'L' : 'R' };
  }

  /** Сутулость/«тяжёлая» походка. */
  get hurt(): number {
    return clamp(Math.max((0.55 - this.health) / 0.55, this.frac('torso') * 0.9));
  }

  /** Ослабление атак по повреждению руки с оружием. */
  weaponArmPenalty(side: 'L' | 'R' = 'R'): number {
    return this.frac(side === 'R' ? 'armR' : 'armL');
  }

  /** Применить удар. Возвращает фактический урон и признак смерти. */
  apply(hit: HitInfo, armor = 0): { dealt: number; killed: boolean; stageBefore: number; stageAfter: number } {
    const stageBefore = this.faceStage;
    if (this.dead) return { dealt: 0, killed: false, stageBefore, stageAfter: stageBefore };
    const base = hit.amount * (1 - armor);
    this.region[hit.region] = Math.max(0, this.region[hit.region] - base);
    const dealt = base * GLOBAL_MULT[hit.region];
    this.hp = Math.max(0, this.hp - dealt);
    this.lastHit = hit.region;
    if (this.hp <= 0 || this.region.head <= 0) {
      this.dead = true;
      this.deathHit = hit;
    }
    return { dealt, killed: this.dead, stageBefore, stageAfter: this.faceStage };
  }

  heal(amount: number): void {
    this.hp = Math.min(this.maxHp, this.hp + amount);
    for (const r of REGIONS) this.region[r] = Math.min(REGION_HP[r], this.region[r] + amount * 0.6);
  }

  reset(): void {
    this.hp = this.maxHp;
    this.dead = false;
    this.wounds = [];
    this.deathHit = null;
    this.lastHit = null;
    for (const r of REGIONS) this.region[r] = REGION_HP[r];
  }

  /** Установить повреждения региона вручную (панель отладки): 0..1. */
  setFrac(r: Region, f: number): void {
    this.region[r] = REGION_HP[r] * (1 - clamp(f));
  }
}

export const REGION_MAX = REGION_HP;
