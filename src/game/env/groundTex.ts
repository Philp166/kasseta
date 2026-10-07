// Процедурные слои земли (запекаются на GPU в массивы текстур):
// 0 — мёрзлая лесная подстилка (хвоя, комья), 1 — сухая трава-ветошь, 2 — мох и ягель,
// 3 — камень с трещинами и лишайником, 4 — снег.
// Альбедо-массив: RGB = цвет (sRGB), A = высота слоя (для смешивания по высоте).
// Нормаль-массив: RG = xy касательной нормали, B = высота, A = 1.

import * as THREE from 'three';
import { Baker } from './bake';

/** Общая «шапка»: каждый слой определяет layer(uv, col, h). Цвета задаются в sRGB. */
const LAYER_FUNCS: string[] = [
  /* 0: подстилка */ /* glsl */ `
void layer(vec2 uv, out vec3 col, out float h) {
  vec3 w = worley(uv * 7.0, 7, 11u);
  float clod = 1.0 - smoothstep(0.05, 0.62, w.x);
  float n1 = fbm(uv * 8.0, 8, 5, 0.55, 21u);
  float n2 = fbm(uv * 40.0, 40, 3, 0.5, 23u);
  h = 0.38 + 0.26 * n1 + 0.24 * clod + 0.07 * n2;
  vec3 c0 = vec3(0.17, 0.125, 0.09);
  vec3 c1 = vec3(0.30, 0.225, 0.16);
  vec3 c2 = vec3(0.26, 0.24, 0.21);
  col = mix(c0, c1, smoothstep(-0.35, 0.55, n1 + 0.4 * clod));
  col = mix(col, c2, smoothstep(0.1, 0.7, n2) * 0.35);
  // старая хвоя и мелкие веточки
  vec4 s0 = strokes(uv * 34.0, 34, 31u, 0.6, 0.055, 0.0, 3.1416);
  vec3 nc = mix(vec3(0.55, 0.36, 0.18), vec3(0.33, 0.2, 0.1), s0.z) * (0.7 + 0.5 * s0.y);
  col = mix(col, nc, s0.x * 0.8);
  h += s0.x * 0.1 * s0.y;
  vec4 s1 = strokes(uv * 10.0, 10, 41u, 0.85, 0.05, 0.0, 3.1416);
  col = mix(col, vec3(0.19, 0.13, 0.09) * (0.8 + 0.5 * s1.z), s1.x * 0.85);
  h += s1.x * 0.16;
  // светлая крошка и редкие пятнышки изморози
  float sp = h21(ivec2(uv * 512.0), 51u);
  col += step(0.988, sp) * vec3(0.20, 0.21, 0.22);
  col *= 0.88 + 0.24 * h21(ivec2(uv * 1024.0), 53u);
}`,
  /* 1: сухая трава-ветошь */ /* glsl */ `
void layer(vec2 uv, out vec3 col, out float h) {
  float n1 = fbm(uv * 6.0, 6, 4, 0.55, 121u);
  col = mix(vec3(0.10, 0.075, 0.05), vec3(0.19, 0.145, 0.085), smoothstep(-0.4, 0.5, n1));
  h = 0.2 + 0.1 * n1;
  for (int k = 0; k < 4; k++) {
    float fk = 22.0 + float(k) * 6.0;
    int pk = int(fk);
    float ang = float(k) * 0.8 + 0.25 * sin(float(k) * 3.1);
    vec4 s = strokes(uv * fk, pk, 131u + uint(k) * 17u, 0.95, 0.05, ang, 1.15);
    float pick = s.z;
    vec3 straw = vec3(0.70, 0.58, 0.34);
    vec3 ochre = vec3(0.55, 0.40, 0.20);
    vec3 grey = vec3(0.56, 0.51, 0.42);
    vec3 rust = vec3(0.44, 0.27, 0.14);
    vec3 b = pick < 0.35 ? mix(ochre, straw, pick / 0.35)
           : pick < 0.7 ? mix(straw, grey, (pick - 0.35) / 0.35)
           : mix(grey, rust, (pick - 0.7) / 0.3);
    b *= 0.78 + 0.42 * s.y;
    b = mix(b * 0.7, b, smoothstep(0.0, 1.0, s.w));   // у корня темнее
    col = mix(col, b, s.x);
    h = mix(h, 0.38 + 0.13 * float(k) + 0.1 * s.y, s.x);
  }
}`,
  /* 2: мох и ягель */ /* glsl */ `
void layer(vec2 uv, out vec3 col, out float h) {
  vec3 w = worley(uv * 11.0, 11, 161u);
  float cushion = 1.0 - smoothstep(0.0, 0.58, w.x);
  float n = fbm(uv * 22.0, 22, 4, 0.55, 163u);
  float n0 = fbm(uv * 5.0, 5, 3, 0.5, 165u);
  h = 0.22 + 0.5 * cushion * (0.7 + 0.3 * n) + 0.1 * n;
  vec3 dark = vec3(0.065, 0.10, 0.04);
  vec3 mid = vec3(0.17, 0.235, 0.075);
  vec3 lite = vec3(0.36, 0.42, 0.16);
  col = mix(dark, mid, smoothstep(0.1, 0.5, h));
  col = mix(col, lite, smoothstep(0.52, 0.85, h) * (0.45 + 0.55 * n));
  col = mix(col, col * vec3(1.15, 0.95, 0.7), smoothstep(0.1, 0.6, n0) * 0.45);  // бурые участки мха
  // ягель (олений мох): бледно-серо-зелёные ветвистые подушки
  float lm = smoothstep(0.12, 0.38, fbm(uv * 4.0, 4, 3, 0.5, 167u));
  vec3 w2 = worley(uv * 46.0, 46, 169u);
  float curl = smoothstep(0.04, 0.38, w2.y - w2.x);
  float fuzz = h21(ivec2(uv * 700.0), 171u);
  vec3 lichen = mix(vec3(0.48, 0.52, 0.40), vec3(0.80, 0.80, 0.70), curl * (0.6 + 0.4 * fuzz));
  col = mix(col, lichen, lm * 0.85);
  h = mix(h, 0.45 + 0.28 * curl, lm * 0.8);
  col *= 0.9 + 0.2 * fuzz;
}`,
  /* 3: камень */ /* glsl */ `
void layer(vec2 uv, out vec3 col, out float h) {
  float n1 = fbm(uv * 4.0, 4, 5, 0.55, 181u);
  float n2 = fbm(uv * 18.0, 18, 4, 0.5, 183u);
  vec2 wq = vec2(fbm(uv * 3.0, 3, 3, 0.5, 185u), fbm(uv * 3.0 + 0.37, 3, 3, 0.5, 186u));
  float cr = gnoise(uv * 6.0 + 0.16 * wq * 6.0, 6, 187u);
  float crack = 1.0 - smoothstep(0.0, 0.075, abs(cr));
  float cr2 = gnoise(uv * 15.0 + 0.1 * wq * 15.0, 15, 189u);
  float crack2 = (1.0 - smoothstep(0.0, 0.06, abs(cr2))) * 0.6;
  float strata = 0.5 + 0.5 * sin((uv.y * 12.0 + n1 * 2.2) * 6.2831853 / 2.0);
  h = 0.55 + 0.22 * n1 + 0.1 * n2 - 0.38 * crack - 0.2 * crack2 + 0.04 * strata;
  vec3 g0 = vec3(0.29, 0.29, 0.30);
  vec3 g1 = vec3(0.47, 0.46, 0.45);
  col = mix(g0, g1, smoothstep(-0.3, 0.55, n1)) * (0.82 + 0.34 * n2);
  col = mix(col, col * vec3(1.12, 0.98, 0.84), smoothstep(0.1, 0.6, fbm(uv * 7.0, 7, 3, 0.5, 191u)) * 0.5);
  col *= 1.0 - 0.6 * max(crack, crack2);
  // лишайник: жёлто-зелёные и белёсые пятна
  vec3 w = worley(uv * 13.0, 13, 193u);
  float spot = (1.0 - smoothstep(0.08, 0.3, w.x)) * smoothstep(0.15, 0.55, fbm(uv * 9.0, 9, 3, 0.5, 195u));
  vec3 lc = mix(vec3(0.54, 0.58, 0.28), vec3(0.74, 0.75, 0.62), h21(ivec2(floor(uv * 13.0)), 197u));
  col = mix(col, lc, spot * 0.75);
  h += spot * 0.05;
}`,
  /* 4: снег */ /* glsl */ `
void layer(vec2 uv, out vec3 col, out float h) {
  float n1 = fbm(uv * 5.0, 5, 4, 0.5, 201u);
  float n2 = fbm(uv * 26.0, 26, 3, 0.5, 203u);
  vec3 w = worley(uv * 9.0, 9, 205u);
  h = 0.5 + 0.3 * n1 + 0.06 * n2 + 0.1 * (1.0 - smoothstep(0.0, 0.5, w.x));
  col = mix(vec3(0.70, 0.77, 0.86), vec3(0.94, 0.96, 0.99), smoothstep(0.3, 0.75, h));
  col *= 0.96 + 0.06 * h21(ivec2(uv * 600.0), 207u);
}`,
];

const ALB_FRAG = (fn: string) => /* glsl */ `
${fn}
void main() {
  vec3 col; float h;
  layer(vUv, col, h);
  gl_FragColor = vec4(srgb2lin(clamp(col, 0.0, 1.0)), clamp(h, 0.0, 1.0));
}`;

/** Нормальная карта по высоте (альбедо-массив, слой L); strength — «высота рельефа». */
const NOR_FRAG = (layer: number, strength: number) => /* glsl */ `
uniform sampler2DArray uAlb;
uniform float uSize;
float H(ivec2 p) {
  int n = int(uSize);
  p = ivec2(imod(p.x, n), imod(p.y, n));
  return texelFetch(uAlb, ivec3(p, ${layer}), 0).a;
}
void main() {
  ivec2 p = ivec2(floor(vUv * uSize));
  float hl = H(p + ivec2(-1, 0)), hr = H(p + ivec2(1, 0));
  float hd = H(p + ivec2(0, -1)), hu = H(p + ivec2(0, 1));
  float hc = H(p);
  vec3 n = normalize(vec3((hl - hr) * ${strength.toFixed(2)}, (hd - hu) * ${strength.toFixed(2)}, 1.0));
  gl_FragColor = vec4(n.xy * 0.5 + 0.5, hc, 1.0);
}`;

export interface GroundTextures {
  albedo: THREE.Texture; // sampler2DArray
  normal: THREE.Texture; // sampler2DArray
  size: number;
}

export const GROUND_LAYER = { dirt: 0, grass: 1, moss: 2, rock: 3, snow: 4 } as const;

export function bakeGroundTextures(baker: Baker, size: number, aniso: number): GroundTextures {
  const albedo = baker.array(size, LAYER_FUNCS.map(ALB_FRAG), { srgb: true, anisotropy: aniso });
  const strengths = [5.0, 4.0, 5.5, 7.0, 2.2];
  // нормали: читаем альбедо-массив; каждый слой — отдельный проход (uniform общий)
  const uniforms = { uAlb: { value: albedo }, uSize: { value: size } };
  const normal = baker.array(size, strengths.map((s, i) => NOR_FRAG(i, s)), { srgb: false, anisotropy: aniso, uniforms });
  return { albedo, normal, size };
}
