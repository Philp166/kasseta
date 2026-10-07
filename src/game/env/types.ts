// Публичные типы окружения (реэкспортируются из ../environment.ts).

import * as THREE from 'three';

export type Quality = 'low' | 'medium' | 'high';

export interface EnvironmentOptions {
  renderer: THREE.WebGLRenderer;
  scene: THREE.Scene;
  seed?: number;
  quality?: Quality;
  /** Необязательный индикатор загрузки: доля 0..1 и подпись этапа. */
  onProgress?: (fraction: number, label: string) => void;
}

export interface TerrainData {
  /** Сторона квадрата, м. */
  size: number;
  segments: number;
  /** (segments+1)² высот: строка = z, столбец = x. */
  heights: Float32Array;
  originX: number;
  originZ: number;
}

export interface EnvTree { x: number; y: number; z: number; radius: number; height: number }
export interface EnvRock { x: number; y: number; z: number; radius: number }

export interface EnvProp {
  kind: 'log' | 'firewood' | 'barrel' | 'crate';
  /** Центр тела (середина габарита), мир. */
  position: THREE.Vector3;
  quaternion: THREE.Quaternion;
  /** Полные габариты в локальных осях тела: x — ширина, y — высота, z — длина (ось брёвен/поленьев — Z). */
  size: THREE.Vector3;
  /** Визуал: мэш/группа, лежащий в сцене; позицию и кватернион синхронизирует игра по телу Rapier. */
  mesh: THREE.Object3D;
  /** Рекомендуемая масса, кг. */
  mass: number;
}

export interface Environment {
  heightAt(x: number, z: number): number;
  normalAt(x: number, z: number, out?: THREE.Vector3): THREE.Vector3;
  terrain: TerrainData;
  trees: EnvTree[];
  rocks: EnvRock[];
  props: EnvProp[];
  camp: { center: THREE.Vector3; fire: THREE.Vector3; radius: number };
  spawnPlayer: THREE.Vector3;
  enemySpawns: THREE.Vector3[];
  sun: THREE.DirectionalLight;
  setShadowTarget(p: THREE.Vector3): void;
  update(dt: number, camera: THREE.Camera): void;
  dispose(): void;

  // ---- расширения (необязательны для игры, нужны демо/отладке) ----
  /** Направление на солнце (единичный вектор, от мира к солнцу). */
  sunDirection: THREE.Vector3;
  /** Точка обзора на холме (камера «вид с холма») и точка, куда смотреть. */
  vista: { position: THREE.Vector3; target: THREE.Vector3 };
  /** Статистика построения: число деревьев, кустов и т.п. */
  stats: Record<string, number>;
  /** Настройки на лету: сила ветра, снегопад, туман. */
  settings: EnvSettings;
}

export interface EnvSettings {
  /** 0..2: сила ветра (качание хвои, дым, снег). */
  wind: number;
  /** 0..1: интенсивность падающего снега. */
  snowfall: number;
  /** Плотность тумана (FogExp2) — множитель к базовой. */
  fog: number;
  /** Яркость огня костра (множитель света). */
  fire: number;
}
