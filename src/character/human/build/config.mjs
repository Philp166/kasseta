// Параметры формы: макро-модификаторы MakeHuman и таргеты лица/тела для «эвенкийского воина».
// Ключ детального модификатора: 'группа/имя-таргета|левая|правая' (знак значения выбирает сторону).

import { ageToValue } from './mh.mjs';

export const MACRO = {
  gender: 1,
  age: ageToValue(35),
  muscle: 0.8,
  weight: 0.5,
  height: 0.61,
  proportions: 0.5,
  asian: 1, caucasian: 0, african: 0,
};

const sym = (g, name, v, lo = 'decr', hi = 'incr') => ({ [`${g}/l-${name}|${lo}|${hi}`]: v, [`${g}/r-${name}|${lo}|${hi}`]: v });

/** Лицо: восточно-сибирский тип (широкие скулы, узкий разрез глаз, невысокая переносица, сильная челюсть). */
export const FACE = {
  'head/head-age|decr|incr': 0.3,
  'head/head-fat|decr|incr': -0.45,
  'head/head-square': 0.35,
  'head/head-scale-horiz|decr|incr': 0.22,
  ...sym('cheek', 'cheek-bones', 0.7),
  ...sym('cheek', 'cheek-volume', -0.35),
  ...sym('cheek', 'cheek-inner', -0.3),
  'chin/chin-width|decr|incr': 0.5,
  'chin/chin-bones|decr|incr': 0.4,
  'chin/chin-prominent|decr|incr': 0.2,
  ...sym('eyes', 'eye-height1', -0.35),
  ...sym('eyes', 'eye-height2', -0.3),
  ...sym('eyes', 'eye-epicanthus', -0.5, 'in', 'out'),
  ...sym('eyes', 'eye-bag', 0.25),
  'nose/nose-compression|compress|uncompress': -0.3,
  'nose/nose-width1|decr|incr': 0.4,
  'nose/nose-width3|decr|incr': 0.4,
  'nose/nose-point-width|decr|incr': 0.3,
  'nose/nose-hump|decr|incr': -0.3,
  'nose/nose-volume|decr|incr': 0.2,
  'mouth/mouth-scale-horiz|decr|incr': 0.25,
  'neck/neck-scale-horiz|decr|incr': 0.35,
};

/** Тело: подтянутый атлет. */
export const BODY = {
  'torso/torso-vshape|decr|incr': 0.5,
  'torso/torso-muscle-pectoral|decr|incr': 0.4,
  'torso/torso-muscle-dorsi|decr|incr': 0.45,
  ...sym('armslegs', 'upperarm-muscle', 0.45),
  ...sym('armslegs', 'upperarm-shoulder-muscle', 0.45),
  ...sym('armslegs', 'lowerarm-muscle', 0.35),
  ...sym('armslegs', 'upperleg-muscle', 0.35),
  ...sym('armslegs', 'lowerleg-muscle', 0.35),
  ...sym('armslegs', 'upperarm-scale-horiz', 0.5),
  ...sym('armslegs', 'lowerarm-scale-horiz', 0.12),
  ...sym('armslegs', 'foot-scale', -0.5),
  'armslegs/lowerlegs-height|decr|incr': -0.6,
};

export const DETAIL = { ...FACE, ...BODY };

/** Параметры скиннинга/позы. */
export const POSE = {
  flex: { thumb: [10, 14, 10], index: [16, 24, 12], middle: [22, 30, 14], ring: [28, 34, 16], pinky: [34, 38, 18] },
  forearmTwist: [0.22, 0.6],
  handFlex: 7,
  thumbOffset: 20,
  spreadKeep: 0.3,
};

/** Целевые ориентиры лица (мировые, метры). */
export const FACE_TARGET = { eyeY: 1.678, chinY: 1.556, topY: 1.78, earZ: 0.008 };
