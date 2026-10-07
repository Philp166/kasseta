// Рецепты морф-таргетов лица: смеси «единиц действия» MakeHuman (expression/units/asian, CC0) + собственные отёки.
// Значения весов подобраны по рендерам; смещения в таргетах MH — в дециметрах.

import { addTarget } from './mh.mjs';

const U = (n) => `expression/units/asian/${n}.target`;

/** Рецепты: { имя морфа: { единица: вес } }. */
export const RECIPES = {
  // боевой оскал: верхняя губа поднята, нос сморщен, брови сдвинуты, глаза в щёлку
  snarl: {
    'mouth-upward-retraction': 1.0, 'nose-compression': 1.0, 'nose-depression': 0.4,
    'eyebrows-left-down': 0.9, 'eyebrows-right-down': 0.9,
    'eye-left-slit': 0.5, 'eye-right-slit': 0.5, 'eye-left-closure': 0.25, 'eye-right-closure': 0.25,
    'mouth-open': 0.22, 'mouth-corner-puller': 0.15,
    'nose-left-dilatation': 0.8, 'nose-right-dilatation': 0.8,
  },
  // гримаса боли: глаза зажмурены, внутренние концы бровей вверх, углы рта вниз и назад
  pain: {
    'eyebrows-left-inner-up': 0.9, 'eyebrows-right-inner-up': 0.9, 'eyebrows-left-down': 0.35, 'eyebrows-right-down': 0.35,
    'eye-left-closure': 0.8, 'eye-right-closure': 0.8, 'eye-left-slit': 0.3, 'eye-right-slit': 0.3,
    'mouth-depression-retraction': 0.9, 'mouth-compression': 0.35, 'nose-compression': 0.5,
    'mouth-open': 0.18, 'mouth-retraction': 0.3,
  },
  // боевой клич: рот широко открыт
  shout: {
    'mouth-open': 1.0, 'mouth-corner-puller': 0.25, 'mouth-upward-retraction': 0.25,
    'eyebrows-left-down': 0.8, 'eyebrows-right-down': 0.8,
    'eye-left-slit': 0.55, 'eye-right-slit': 0.55, 'eye-left-closure': 0.25, 'eye-right-closure': 0.25,
    'nose-left-dilatation': 1.0, 'nose-right-dilatation': 1.0,
  },
  squintL: { 'eye-left-closure': 0.5, 'eye-left-slit': 0.55, 'mouth-elevation': 0.15 },
  squintR: { 'eye-right-closure': 0.5, 'eye-right-slit': 0.55, 'mouth-elevation': 0.15 },
  jawOpen: { 'mouth-open': 0.75 },
  browAngry: { 'eyebrows-left-down': 1.0, 'eyebrows-right-down': 1.0, 'eye-left-slit': 0.25, 'eye-right-slit': 0.25 },
  blinkL: { 'eye-left-closure': 1.0 },
  blinkR: { 'eye-right-closure': 1.0 },
};

/** Базовые смещения (дециметры MH, массив 3n) для рецепта. */
export function recipeDisp(nV, recipe) {
  const d = new Float64Array(nV * 3);
  for (const [unit, w] of Object.entries(recipe)) addTarget(d, U(unit), w);
  return d;
}

/** Параметры жёсткого вращения нижней челюсти (для нижних зубов), градусы на единицу веса mouth-open. */
export const JAW_DEG_PER_UNIT = 20;

export const MORPH_ORDER = ['snarl', 'pain', 'shout', 'squintL', 'squintR', 'jawOpen', 'browAngry', 'blinkL', 'blinkR', 'swellCheekL', 'swellCheekR', 'swellEyeL', 'swellEyeR'];
