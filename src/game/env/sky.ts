// Небо: процедурное пасмурное небо (слои облаков, низкое солнце за облаками, дымка у горизонта)
// и дальние горы-силуэты в одном полноэкранном шейдере. Из того же шейдера запекается IBL (PMREM).

import * as THREE from 'three';

export interface SkyParams {
  sunDir: THREE.Vector3;
  horizon: THREE.Color; // цвет дымки = цвет тумана (линейный)
  zenith: THREE.Color;
  ground: THREE.Color;
  sunColor: THREE.Color;
  cover: number; // 0..1 плотность облаков
}

const VERT = /* glsl */ `
varying vec3 vDir;
void main() {
  vec4 v = inverse(projectionMatrix) * vec4(position.xy, 1.0, 1.0);
  vDir = transpose(mat3(viewMatrix)) * (v.xyz / v.w);
  gl_Position = vec4(position.xy, 1.0, 1.0);
}
`;

const FRAG = /* glsl */ `
uniform vec3 uSunDir;
uniform float uTime;
uniform vec3 uHorizon;
uniform vec3 uZenith;
uniform vec3 uGround;
uniform vec3 uSunCol;
uniform float uCover;
uniform float uWind;
varying vec3 vDir;

float h21f(vec2 p) { p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
float vnoise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  float a = h21f(i), b = h21f(i + vec2(1.0, 0.0)), c = h21f(i + vec2(0.0, 1.0)), d = h21f(i + vec2(1.0, 1.0));
  return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
}
float cfbm(vec2 p) {
  float s = 0.0, a = 0.5;
  mat2 m = mat2(1.6, 1.2, -1.2, 1.6);
  for (int i = 0; i < 5; i++) { s += a * vnoise(p); p = m * p; a *= 0.5; }
  return s;
}
float cfbm3(vec2 p) {
  float s = 0.0, a = 0.5;
  mat2 m = mat2(1.6, 1.2, -1.2, 1.6);
  for (int i = 0; i < 3; i++) { s += a * vnoise(p); p = m * p; a *= 0.5; }
  return s;
}

// горный хребет по азимуту (периодичен по кругу)
float ridge(float az, float seed, float freq) {
  vec2 c = vec2(cos(az), sin(az)) * freq + seed;
  return cfbm(c) * 1.15 - 0.2;
}

vec3 mountains(vec3 d, vec3 col, float aa) {
  float az = atan(d.x, d.z);
  float y = d.y;
  for (int i = 0; i < 3; i++) {
    float fi = float(i);
    float near = fi / 2.0;
    float base = 0.004 + 0.003 * fi;
    float amp = 0.075 - 0.012 * fi;
    float r = ridge(az, 13.0 * fi + 3.0, 1.6 + fi * 1.4);
    float rid = base + amp * max(r, 0.0) * (0.55 + 0.45 * (1.0 - near * 0.4));
    float cover = 1.0 - smoothstep(rid - aa, rid + aa, y);
    if (cover <= 0.0) continue;
    // цвет: дальние светлее и ближе к цвету дымки
    vec3 deep = vec3(0.10, 0.13, 0.18);
    vec3 mcol = mix(uHorizon, deep, 0.28 + 0.34 * near);
    // у подошвы сильнее дымка
    float low = smoothstep(rid, -0.002, y);
    mcol = mix(mcol, uHorizon, low * (0.85 - 0.25 * near));
    // тайга по склонам: тёмная зернистость
    float tex = vnoise(vec2(az * 140.0, y * 900.0)) * 0.6 + vnoise(vec2(az * 420.0, y * 2600.0)) * 0.4;
    mcol *= 0.9 + 0.2 * tex * (1.0 - near * 0.3);
    // снег на вершинах
    float snow = smoothstep(0.55, 0.9, (y - base) / max(rid - base, 1e-4)) * smoothstep(0.35, 0.6, r);
    mcol = mix(mcol, mix(uHorizon, vec3(0.82, 0.88, 0.96), 0.55), snow * (0.75 - 0.3 * near));
    col = mix(col, mcol, cover);
  }
  return col;
}

vec3 skyColor(vec3 d) {
  float y = d.y;
  float yc = max(y, 0.0);
  // базовый градиент: дымка у горизонта → тёмная синева в зените
  vec3 base = mix(uHorizon, uZenith, pow(yc, 0.42));
  // облака: проекция на плоскость, вытянутые полосы
  float wind = uTime * 0.006 * (0.4 + uWind);
  vec2 cp = d.xz / (yc + 0.2);
  cp = vec2(cp.x * 0.55 + wind, cp.y * 1.15 + wind * 0.3);
  vec2 warp = vec2(cfbm3(cp * 0.7 + 3.0), cfbm3(cp * 0.7 + 17.0)) - 0.5;
  float dens = cfbm(cp * 0.85 + warp * 1.6);
  float det = cfbm3(cp * 3.2 + warp * 2.0);
  float cov = smoothstep(0.62 - uCover * 0.5, 0.95 - uCover * 0.3, dens + (det - 0.5) * 0.18);
  // освещённость краёв облаков: край, обращённый к солнцу, светлее
  vec2 sdir = normalize(uSunDir.xz + 1e-4) * 0.35;
  float dens2 = cfbm3(cp * 0.85 + warp * 1.6 + sdir);
  float lit = clamp(0.55 + (dens - dens2) * 5.0, 0.0, 1.0);
  vec3 cdark = vec3(0.075, 0.09, 0.115);
  vec3 clite = vec3(0.50, 0.55, 0.62);
  vec3 ccol = mix(cdark, clite, lit * (0.55 + 0.45 * det));
  // нижняя кромка у горизонта светлее (дымка проходит сквозь облака)
  ccol = mix(ccol, uHorizon * 0.9, exp(-yc * 5.5) * 0.9);
  vec3 col = mix(base, ccol, cov * smoothstep(0.0, 0.08, yc) * 0.95 + cov * 0.05);
  // низкое солнце за пеленой: тёплое пятно, пробивающееся сквозь облака
  float sd = max(dot(d, uSunDir), 0.0);
  float glow = pow(sd, 5.0) * 0.28 + pow(sd, 36.0) * 0.55 + pow(sd, 400.0) * 1.6;
  float thin = 1.0 - cov * 0.8;
  col += uSunCol * glow * (0.35 + 0.65 * thin);
  // просветы у горизонта
  col = mix(col, uHorizon * 1.08, exp(-yc * 14.0) * 0.55);
  // под горизонтом — тёмная земля (нужна для IBL), у самой линии — дымка
  col = mix(col, uGround, smoothstep(-0.02, -0.35, y));
  return col;
}

void main() {
  vec3 d = normalize(vDir);
  float aa = fwidth(d.y) * 1.2 + 1e-5;
  vec3 col = skyColor(d);
  if (d.y > -0.05) col = mountains(d, col, aa);
  gl_FragColor = vec4(col, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

export interface Sky {
  mesh: THREE.Mesh;
  uniforms: Record<string, THREE.IUniform>;
  params: SkyParams;
  /** Запекает небо в PMREM для scene.environment (вызывать при смене параметров неба). */
  bakeEnvironment(renderer: THREE.WebGLRenderer): THREE.Texture;
  update(dt: number): void;
  dispose(): void;
}

export function createSky(params: SkyParams): Sky {
  const uniforms: Record<string, THREE.IUniform> = {
    uSunDir: { value: params.sunDir.clone() },
    uTime: { value: 0 },
    uHorizon: { value: params.horizon.clone() },
    uZenith: { value: params.zenith.clone() },
    uGround: { value: params.ground.clone() },
    uSunCol: { value: params.sunColor.clone() },
    uCover: { value: params.cover },
    uWind: { value: 1 },
  };
  const material = new THREE.ShaderMaterial({
    vertexShader: VERT,
    fragmentShader: FRAG,
    uniforms,
    depthWrite: false,
    depthTest: true,
  });
  const geo = new THREE.PlaneGeometry(2, 2);
  const mesh = new THREE.Mesh(geo, material);
  mesh.frustumCulled = false;
  mesh.renderOrder = 10000; // после непрозрачных: фрагменты неба отсекаются по глубине
  mesh.name = 'sky';

  let pmrem: THREE.PMREMGenerator | null = null;
  let envRT: THREE.WebGLRenderTarget | null = null;

  return {
    mesh, uniforms, params,
    bakeEnvironment(renderer) {
      // отдельная сцена только с небом; рендерим в кубокарту и фильтруем PMREM-ом
      const sc = new THREE.Scene();
      const m2 = new THREE.Mesh(geo, material);
      m2.frustumCulled = false;
      sc.add(m2);
      const cube = new THREE.WebGLCubeRenderTarget(256, { type: THREE.HalfFloatType, generateMipmaps: false });
      const cam = new THREE.CubeCamera(0.1, 100, cube);
      const prevTone = renderer.toneMapping;
      renderer.toneMapping = THREE.NoToneMapping; // IBL хранится в линейном HDR
      const prevT = uniforms.uTime.value;
      cam.update(renderer, sc);
      renderer.toneMapping = prevTone;
      uniforms.uTime.value = prevT;
      pmrem ??= new THREE.PMREMGenerator(renderer);
      envRT?.dispose();
      envRT = pmrem.fromCubemap(cube.texture);
      cube.dispose();
      return envRT.texture;
    },
    update(dt) {
      uniforms.uTime.value += dt;
    },
    dispose() {
      material.dispose();
      geo.dispose();
      envRT?.dispose();
      pmrem?.dispose();
    },
  };
}
