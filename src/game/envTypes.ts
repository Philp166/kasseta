// Контракт окружения: то, что игре нужно от модуля рельефа/леса (реализация — environment.ts или запасной devEnv.ts).

import * as THREE from 'three';

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
  position: THREE.Vector3;
  quaternion: THREE.Quaternion;
  size: THREE.Vector3;
  mesh?: THREE.Object3D;
}

export interface EnvironmentLike {
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
}
