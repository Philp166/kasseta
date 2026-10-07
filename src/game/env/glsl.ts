// Общая библиотека GLSL: целочисленные хеши, тайлящийся градиентный шум, fbm, Вороной, «мазки».
// Используется и при запекании текстур на GPU, и в рантайм-шейдерах (небо, огонь, земля).

export const GLSL_NOISE = /* glsl */ `
uint ghash(uint x) {
  x ^= x >> 16; x *= 0x7feb352du; x ^= x >> 15; x *= 0x846ca68bu; x ^= x >> 16;
  return x;
}
uint ghash2(uvec2 v) { return ghash(v.x ^ ghash(v.y + 0x9e3779b9u)); }
int imod(int a, int b) { int r = a - b * (a / b); return r < 0 ? r + b : r; }
ivec2 wrapc(ivec2 p, int per) { return per > 0 ? ivec2(imod(p.x, per), imod(p.y, per)) : p; }
float h21(ivec2 p, uint s) { return float(ghash2(uvec2(p) + s * 0x85ebca6bu) & 0xffffffu) * (1.0 / 16777215.0); }
vec2 h22(ivec2 p, uint s) {
  uint h = ghash2(uvec2(p) + s * 0x85ebca6bu);
  return vec2(float(h & 0xffffu), float(h >> 16u)) * (1.0 / 65535.0);
}
float hash12(vec2 p) { return h21(ivec2(floor(p)), 0u); }

vec2 gradAt(ivec2 c, ivec2 per, uint s) {
  c = ivec2(per.x > 0 ? imod(c.x, per.x) : c.x, per.y > 0 ? imod(c.y, per.y) : c.y);
  float a = h21(c, s) * 6.2831853;
  return vec2(cos(a), sin(a));
}
// Градиентный шум, [-1,1]. per>0 — период решётки (бесшовность), per=0 — без повторения.
float gnoise(vec2 p, ivec2 per, uint s) {
  ivec2 i = ivec2(floor(p));
  vec2 f = fract(p);
  vec2 u = f * f * f * (f * (f * 6.0 - 15.0) + 10.0);
  float a = dot(gradAt(i, per, s), f);
  float b = dot(gradAt(i + ivec2(1, 0), per, s), f - vec2(1.0, 0.0));
  float c = dot(gradAt(i + ivec2(0, 1), per, s), f - vec2(0.0, 1.0));
  float d = dot(gradAt(i + ivec2(1, 1), per, s), f - vec2(1.0, 1.0));
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y) * 1.41;
}
float gnoise(vec2 p, int per, uint s) { return gnoise(p, ivec2(per), s); }
float fbm(vec2 p, ivec2 per, int oct, float gain, uint s) {
  float a = 0.5, sum = 0.0, n = 0.0;
  for (int i = 0; i < 8; i++) {
    if (i >= oct) break;
    sum += a * gnoise(p, per, s + uint(i) * 7u);
    n += a; a *= gain; p *= 2.0; per *= 2;
  }
  return sum / n;
}
float fbm(vec2 p, int per, int oct, float gain, uint s) { return fbm(p, ivec2(per), oct, gain, s); }
// Вороной: (F1, F2, id)
vec3 worley(vec2 p, ivec2 per, uint s) {
  ivec2 i = ivec2(floor(p));
  vec2 f = fract(p);
  float d1 = 9.0, d2 = 9.0, id = 0.0;
  for (int y = -1; y <= 1; y++) for (int x = -1; x <= 1; x++) {
    ivec2 c = i + ivec2(x, y);
    ivec2 w = ivec2(per.x > 0 ? imod(c.x, per.x) : c.x, per.y > 0 ? imod(c.y, per.y) : c.y);
    vec2 o = h22(w, s);
    vec2 r = vec2(float(x), float(y)) + o - f;
    float d = dot(r, r);
    if (d < d1) { d2 = d1; d1 = d; id = h21(w, s + 3u); }
    else if (d < d2) d2 = d;
  }
  return vec3(sqrt(d1), sqrt(d2), id);
}
vec3 worley(vec2 p, int per, uint s) { return worley(p, ivec2(per), s); }
// Слой «мазков» (иголки, травинки, прутья): результат (покрытие, приоритет, id, t вдоль мазка 0..1)
vec4 strokes(vec2 p, int per, uint s, float len, float wid, float baseAng, float spread) {
  ivec2 i = ivec2(floor(p));
  float bestZ = -1.0;
  vec4 res = vec4(0.0);
  for (int y = -1; y <= 1; y++) for (int x = -1; x <= 1; x++) {
    ivec2 c = i + ivec2(x, y);
    ivec2 w = wrapc(c, per);
    vec2 o = h22(w, s);
    float ang = baseAng + (h21(w, s + 1u) - 0.5) * 2.0 * spread;
    float L = len * (0.55 + 0.9 * h21(w, s + 2u));
    vec2 q = p - (vec2(c) + o);
    vec2 dir = vec2(cos(ang), sin(ang));
    float t = clamp(dot(q, dir), -L, L);
    float dist = length(q - dir * t);
    float W = wid * (0.6 + 0.8 * h21(w, s + 4u)) * (1.0 - 0.55 * abs(t) / L);
    float cov = 1.0 - smoothstep(W * 0.55, W, dist);
    float z = h21(w, s + 5u);
    if (cov > 0.02 && z > bestZ) {
      bestZ = z;
      res = vec4(cov, z, h21(w, s + 6u), t / L * 0.5 + 0.5);
    }
  }
  return res;
}
vec3 srgb2lin(vec3 c) { return pow(c, vec3(2.2)); }
vec3 lin2srgb(vec3 c) { return pow(c, vec3(1.0 / 2.2)); }
`;

/** Простой шум для рантайм-шейдеров (без тайлинга): value noise на хеше. */
export const GLSL_RT_NOISE = /* glsl */ `
float rtHash(vec3 p) {
  p = fract(p * 0.3183099 + vec3(0.1, 0.2, 0.3));
  p *= 17.0;
  return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
}
float rtNoise(vec3 x) {
  vec3 i = floor(x), f = fract(x);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(rtHash(i + vec3(0, 0, 0)), rtHash(i + vec3(1, 0, 0)), f.x),
                 mix(rtHash(i + vec3(0, 1, 0)), rtHash(i + vec3(1, 1, 0)), f.x), f.y),
             mix(mix(rtHash(i + vec3(0, 0, 1)), rtHash(i + vec3(1, 0, 1)), f.x),
                 mix(rtHash(i + vec3(0, 1, 1)), rtHash(i + vec3(1, 1, 1)), f.x), f.y), f.z);
}
float rtFbm(vec3 p) {
  float a = 0.5, s = 0.0;
  for (int i = 0; i < 5; i++) { s += a * rtNoise(p); p = p * 2.02 + vec3(1.7, 9.2, 3.3); a *= 0.5; }
  return s / 0.96875;
}
`;
