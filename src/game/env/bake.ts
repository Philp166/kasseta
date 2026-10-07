// Запекание процедурных текстур на GPU: полноэкранный проход с фрагментным шейдером в RenderTarget.
// Быстро (миллисекунды), бесшовно (период шума = размер тайла), без загрузки внешних файлов.

import * as THREE from 'three';
import { GLSL_NOISE } from './glsl';

export interface BakeOpts {
  /** true — результат хранится как sRGB (шейдер пишет линейный цвет). */
  srgb?: boolean;
  repeat?: boolean;
  mip?: boolean;
  anisotropy?: number;
  uniforms?: Record<string, THREE.IUniform>;
  defines?: Record<string, string | number>;
}

const VERT = /* glsl */ `
varying vec2 vUv;
void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }
`;

export class Baker {
  private scene = new THREE.Scene();
  private cam = new THREE.Camera();
  private quad: THREE.Mesh;
  private owned: THREE.WebGLRenderTarget[] = [];

  constructor(private renderer: THREE.WebGLRenderer, private anisotropy = 8) {
    const geo = new THREE.PlaneGeometry(2, 2);
    this.quad = new THREE.Mesh(geo, new THREE.MeshBasicMaterial());
    this.quad.frustumCulled = false;
    this.scene.add(this.quad);
  }

  private material(frag: string, opts: BakeOpts): THREE.ShaderMaterial {
    return new THREE.ShaderMaterial({
      vertexShader: VERT,
      fragmentShader: `varying vec2 vUv;\n${GLSL_NOISE}\n${frag}`,
      uniforms: opts.uniforms ?? {},
      defines: opts.defines ?? {},
      depthTest: false,
      depthWrite: false,
      blending: THREE.NoBlending,
    });
  }

  private setupTex(tex: THREE.Texture, opts: BakeOpts) {
    tex.colorSpace = opts.srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
    const rep = opts.repeat ?? true;
    tex.wrapS = tex.wrapT = rep ? THREE.RepeatWrapping : THREE.ClampToEdgeWrapping;
    const mip = opts.mip ?? true;
    tex.generateMipmaps = mip;
    tex.minFilter = mip ? THREE.LinearMipmapLinearFilter : THREE.LinearFilter;
    tex.magFilter = THREE.LinearFilter;
    tex.anisotropy = Math.min(opts.anisotropy ?? this.anisotropy, this.anisotropy);
  }

  /** Одна 2D-текстура size×size. */
  texture2D(size: number, frag: string, opts: BakeOpts = {}, height = size): THREE.Texture {
    const rt = new THREE.WebGLRenderTarget(size, height, {
      type: THREE.UnsignedByteType,
      format: THREE.RGBAFormat,
      depthBuffer: false,
      stencilBuffer: false,
    });
    this.setupTex(rt.texture, opts);
    this.owned.push(rt);
    const mat = this.material(frag, opts);
    this.run(rt, mat, 0);
    mat.dispose();
    return rt.texture;
  }

  /** Массив слоёв (sampler2DArray): по фрагменту на слой. */
  array(size: number, frags: string[], opts: BakeOpts = {}): THREE.Texture {
    const rt = new THREE.WebGLArrayRenderTarget(size, size, frags.length, {
      type: THREE.UnsignedByteType,
      format: THREE.RGBAFormat,
      depthBuffer: false,
      stencilBuffer: false,
    });
    this.setupTex(rt.texture, opts);
    this.owned.push(rt);
    frags.forEach((frag, layer) => {
      const mat = this.material(frag, opts);
      this.run(rt, mat, layer);
      mat.dispose();
    });
    return rt.texture;
  }

  /**
   * Пара «альбедо + нормаль» по функции слоя `void layer(vec2 uv, out vec3 col, out float h)` (col — sRGB).
   * Альбедо: RGB — цвет, A — высота. Нормаль: RG — xy касательной нормали, B — высота.
   */
  surface(size: number, layerFn: string, strength: number, opts: BakeOpts = {}, height = size): { albedo: THREE.Texture; normal: THREE.Texture } {
    const alb = this.texture2D(size, `${layerFn}
void main() { vec3 col; float h; layer(vUv, col, h); gl_FragColor = vec4(srgb2lin(clamp(col, 0.0, 1.0)), clamp(h, 0.0, 1.0)); }`, { ...opts, srgb: true }, height);
    const nor = this.texture2D(size, `
uniform sampler2D uAlb; uniform vec2 uSize;
float H(ivec2 p) { ivec2 n = ivec2(uSize); p = ivec2(imod(p.x, n.x), imod(p.y, n.y)); return texelFetch(uAlb, p, 0).a; }
void main() {
  ivec2 p = ivec2(floor(vUv * uSize));
  float hl = H(p + ivec2(-1, 0)), hr = H(p + ivec2(1, 0)), hd = H(p + ivec2(0, -1)), hu = H(p + ivec2(0, 1));
  vec3 n = normalize(vec3((hl - hr) * ${strength.toFixed(2)}, (hd - hu) * ${strength.toFixed(2)}, 1.0));
  gl_FragColor = vec4(n.xy * 0.5 + 0.5, H(p), 1.0);
}`, { ...opts, srgb: false, uniforms: { uAlb: { value: alb }, uSize: { value: new THREE.Vector2(size, height) } } }, height);
    return { albedo: alb, normal: nor };
  }

  private run(rt: THREE.WebGLRenderTarget, mat: THREE.ShaderMaterial, layer: number) {
    const r = this.renderer;
    const prevRT = r.getRenderTarget();
    const prevAuto = r.autoClear;
    const prevShadow = r.shadowMap.enabled;
    this.quad.material = mat;
    r.autoClear = false;
    r.shadowMap.enabled = false;
    r.setRenderTarget(rt, layer);
    r.render(this.scene, this.cam);
    r.setRenderTarget(prevRT);
    r.autoClear = prevAuto;
    r.shadowMap.enabled = prevShadow;
  }

  dispose() {
    for (const rt of this.owned) rt.dispose();
    this.owned.length = 0;
    this.quad.geometry.dispose();
  }
}

/** Canvas → текстура (sRGB, мипмапы, анизотропия). */
export function canvasTexture(
  canvas: HTMLCanvasElement,
  o: { srgb?: boolean; repeat?: boolean; mip?: boolean; aniso?: number } = {},
): THREE.CanvasTexture {
  const t = new THREE.CanvasTexture(canvas);
  t.colorSpace = o.srgb === false ? THREE.NoColorSpace : THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = o.repeat ? THREE.RepeatWrapping : THREE.ClampToEdgeWrapping;
  t.generateMipmaps = o.mip ?? true;
  t.minFilter = (o.mip ?? true) ? THREE.LinearMipmapLinearFilter : THREE.LinearFilter;
  t.magFilter = THREE.LinearFilter;
  t.anisotropy = o.aniso ?? 8;
  t.needsUpdate = true;
  return t;
}
