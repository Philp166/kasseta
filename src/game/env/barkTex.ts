// Процедурные текстуры коры (GPU): ель, пихта, лиственница, берёза, сухостой. Бесшовные по u и v.
// UV ствола: u — вокруг (повтор 2 раза), v — вдоль, 3.6 м на тайл → признаки вытянуты по вертикали.

import * as THREE from 'three';
import { Baker } from './bake';

const BARK_SPRUCE = /* glsl */ `
void layer(vec2 uv, out vec3 col, out float h) {
  vec2 warp = vec2(fbm(uv * vec2(6.0, 8.0), ivec2(6, 8), 3, 0.5, 301u), fbm(uv * vec2(6.0, 8.0) + 3.1, ivec2(6, 8), 3, 0.5, 303u)) * 0.045;
  vec3 w = worley((uv + warp) * vec2(12.0, 34.0), ivec2(12, 34), 305u);
  float edge = smoothstep(0.0, 0.2, w.y - w.x);
  float plate = 1.0 - smoothstep(0.1, 0.62, w.x);
  float n1 = fbm(uv * vec2(8.0, 24.0), ivec2(8, 24), 4, 0.55, 307u);
  float n2 = fbm(uv * vec2(32.0, 96.0), ivec2(32, 96), 3, 0.5, 309u);
  h = 0.25 + 0.55 * edge + 0.22 * plate + 0.1 * n1 + 0.05 * n2;
  vec3 c0 = vec3(0.17, 0.12, 0.095);
  vec3 c1 = vec3(0.40, 0.27, 0.20);
  vec3 c2 = vec3(0.42, 0.38, 0.34);
  float hue = h21(ivec2(floor((uv + warp) * vec2(12.0, 34.0))), 311u);
  col = mix(c0, mix(c1, c2, hue * 0.8), smoothstep(0.1, 0.8, h));
  col *= 0.8 + 0.4 * n2;
  // лишайник: бледные пятна
  float lich = smoothstep(0.35, 0.6, fbm(uv * vec2(4.0, 6.0), ivec2(4, 6), 3, 0.5, 313u));
  col = mix(col, vec3(0.50, 0.55, 0.40), lich * 0.35 * (1.0 - edge * 0.5));
}`;

const BARK_FIR = /* glsl */ `
void layer(vec2 uv, out vec3 col, out float h) {
  float n1 = fbm(uv * vec2(5.0, 4.0), ivec2(5, 4), 4, 0.5, 321u);
  float n2 = fbm(uv * vec2(24.0, 40.0), ivec2(24, 40), 3, 0.5, 323u);
  vec3 w = worley(uv * vec2(18.0, 54.0), ivec2(18, 54), 325u);
  float blister = 1.0 - smoothstep(0.05, 0.28, w.x);
  float streak = fbm(uv * vec2(14.0, 2.0), ivec2(14, 2), 3, 0.5, 327u);
  h = 0.5 + 0.18 * n1 + 0.06 * n2 + 0.14 * blister + 0.06 * streak;
  vec3 c = mix(vec3(0.26, 0.245, 0.23), vec3(0.50, 0.48, 0.45), smoothstep(-0.3, 0.6, n1 + 0.3 * streak));
  col = c * (0.85 + 0.3 * n2);
  col = mix(col, vec3(0.16, 0.13, 0.11), blister * 0.5);
  float lich = smoothstep(0.3, 0.55, fbm(uv * vec2(4.0, 5.0), ivec2(4, 5), 3, 0.5, 329u));
  col = mix(col, vec3(0.55, 0.60, 0.48), lich * 0.4);
}`;

const BARK_LARCH = /* glsl */ `
void layer(vec2 uv, out vec3 col, out float h) {
  vec2 warp = vec2(fbm(uv * vec2(5.0, 6.0), ivec2(5, 6), 3, 0.5, 341u), fbm(uv * vec2(5.0, 6.0) + 2.2, ivec2(5, 6), 3, 0.5, 343u)) * 0.06;
  float cr = gnoise((uv + warp) * vec2(9.0, 5.0), ivec2(9, 5), 345u);
  float furrow = 1.0 - smoothstep(0.0, 0.34, abs(cr));
  float cr2 = gnoise((uv + warp * 1.4) * vec2(20.0, 10.0), ivec2(20, 10), 347u);
  float furrow2 = (1.0 - smoothstep(0.0, 0.28, abs(cr2))) * 0.5;
  float n2 = fbm(uv * vec2(30.0, 60.0), ivec2(30, 60), 3, 0.5, 349u);
  h = 0.75 - 0.5 * furrow - 0.2 * furrow2 + 0.07 * n2;
  vec3 deep = vec3(0.12, 0.06, 0.045);
  vec3 ridge = vec3(0.42, 0.22, 0.14);
  vec3 grey = vec3(0.40, 0.33, 0.29);
  col = mix(deep, mix(ridge, grey, smoothstep(0.2, 0.7, fbm(uv * vec2(6.0, 9.0), ivec2(6, 9), 3, 0.5, 351u))), smoothstep(0.1, 0.75, h));
  col *= 0.82 + 0.36 * n2;
}`;

const BARK_BIRCH = /* glsl */ `
void layer(vec2 uv, out vec3 col, out float h) {
  float n1 = fbm(uv * vec2(3.0, 5.0), ivec2(3, 5), 4, 0.5, 361u);
  float n2 = fbm(uv * vec2(24.0, 48.0), ivec2(24, 48), 3, 0.5, 363u);
  // горизонтальные тёмные «чечевички»: вытянуты по окружности
  float m1 = gnoise(uv * vec2(3.0, 70.0), ivec2(3, 70), 365u);
  float m2 = gnoise(uv * vec2(6.0, 150.0) + 1.7, ivec2(6, 150), 367u);
  float mark = smoothstep(0.18, 0.5, m1 + 0.5 * m2 + 0.18 * n1) ;
  float band = smoothstep(0.45, 0.8, fbm(uv * vec2(2.0, 10.0), ivec2(2, 10), 3, 0.5, 369u));
  mark = max(mark * 0.9, band * 0.55);
  // отслаивающиеся полоски бересты
  float peel = smoothstep(0.55, 0.75, gnoise(uv * vec2(4.0, 18.0), ivec2(4, 18), 371u));
  vec3 white = mix(vec3(0.80, 0.78, 0.72), vec3(0.92, 0.91, 0.87), 0.5 + 0.5 * n1);
  white = mix(white, vec3(0.70, 0.66, 0.58), peel * 0.5);
  col = mix(white, vec3(0.08, 0.07, 0.065), mark);
  col *= 0.94 + 0.12 * n2;
  h = 0.55 - 0.3 * mark + 0.12 * peel + 0.04 * n2;
}`;

const BARK_SNAG = /* glsl */ `
void layer(vec2 uv, out vec3 col, out float h) {
  float grain = fbm(uv * vec2(26.0, 3.0), ivec2(26, 3), 4, 0.55, 381u);
  float n1 = fbm(uv * vec2(5.0, 6.0), ivec2(5, 6), 4, 0.5, 383u);
  float crack = 1.0 - smoothstep(0.0, 0.05, abs(gnoise(uv * vec2(8.0, 4.0) + 0.2 * n1, ivec2(8, 4), 385u)));
  h = 0.55 + 0.2 * grain + 0.1 * n1 - 0.4 * crack;
  col = mix(vec3(0.30, 0.28, 0.26), vec3(0.50, 0.47, 0.43), smoothstep(-0.2, 0.6, grain + 0.3 * n1));
  col *= 1.0 - 0.6 * crack;
  col = mix(col, vec3(0.45, 0.50, 0.38), smoothstep(0.35, 0.6, fbm(uv * vec2(3.0, 5.0), ivec2(3, 5), 3, 0.5, 387u)) * 0.25);
}`;

export type BarkKind = 'spruce' | 'fir' | 'larch' | 'birch' | 'snag';
export interface BarkSet { albedo: THREE.Texture; normal: THREE.Texture }

export function bakeBark(baker: Baker, size: number, aniso: number): Record<BarkKind, BarkSet> {
  const o = { anisotropy: aniso };
  return {
    spruce: baker.surface(size, BARK_SPRUCE, 5.0, o),
    fir: baker.surface(size, BARK_FIR, 3.0, o),
    larch: baker.surface(size, BARK_LARCH, 6.0, o),
    birch: baker.surface(size, BARK_BIRCH, 2.2, o),
    snag: baker.surface(size, BARK_SNAG, 4.0, o),
  };
}
