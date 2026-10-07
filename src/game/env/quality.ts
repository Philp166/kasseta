// Пресеты качества: размеры теней, дальности LOD, плотности, разрешения текстур.

import type { Quality } from './types';

export interface QualityCfg {
  shadowMap: number;
  shadowExtent: number; // половина стороны окна теней, м
  texSize: number; // размер процедурных текстур поверхности
  needleSize: number; // размер атласа хвои (ширина)
  lod0: number; // дальность полной модели дерева
  lod1: number; // дальность упрощённой модели
  treeDensity: number; // множитель плотности леса
  grassDensity: number;
  grassRange: number;
  snowFlakes: number;
  mist: number;
  pixelRatioCap: number;
  anisotropy: number;
  farTrees: number; // сколько «карточек-деревьев» в дальнем поле
}

export const QUALITY: Record<Quality, QualityCfg> = {
  low: {
    shadowMap: 1024, shadowExtent: 28, texSize: 256, needleSize: 512, lod0: 26, lod1: 85,
    treeDensity: 0.6, grassDensity: 0.35, grassRange: 28, snowFlakes: 700, mist: 6, pixelRatioCap: 1, anisotropy: 2, farTrees: 800,
  },
  medium: {
    shadowMap: 2048, shadowExtent: 34, texSize: 512, needleSize: 1024, lod0: 40, lod1: 125,
    treeDensity: 0.85, grassDensity: 0.7, grassRange: 42, snowFlakes: 2000, mist: 12, pixelRatioCap: 1.5, anisotropy: 8, farTrees: 2000,
  },
  high: {
    shadowMap: 4096, shadowExtent: 42, texSize: 1024, needleSize: 1024, lod0: 56, lod1: 170,
    treeDensity: 1.0, grassDensity: 1.0, grassRange: 58, snowFlakes: 4000, mist: 20, pixelRatioCap: 2, anisotropy: 16, farTrees: 3600,
  },
};
