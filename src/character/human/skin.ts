// Процедурная кожа: «запекание по проекции» — для каждого текселя UV-атласа находится точка на меше (растеризация
// треугольников в UV-пространстве), цвет и рельеф считаются от её 3D-положения. Поэтому рисунок (брови, усы, рубцы,
// морщины, румянец) не зависит от раскладки UV. Результат: альбедо (sRGB), карта нормалей, карта шероховатости.

import * as THREE from 'three';
import { Perlin3, vnoise2, hash2, sstep, clamp01, mix, gauss, segDist, polyDist } from './noise';
import { humanPartData, humanJSON } from './human';

export interface SkinOpts {
  /** Сторона атласа головы / тела (пиксели). */
  size?: number;
  bodySize?: number;
  seed?: number;
  /** Боевая раскраска: три красные полосы на щеке. */
  warPaint?: boolean;
  /** Густота усов и бородки 0..1. */
  beard?: number;
  /** Возраст/обветренность 0..1: глубина морщин. */
  age?: number;
  /** Базовый тон кожи (sRGB 0..1). */
  tone?: [number, number, number];
}

export interface SkinMaps { map: THREE.CanvasTexture; normalMap: THREE.CanvasTexture; roughnessMap: THREE.CanvasTexture }
export interface SkinBake { head: SkinMaps; body: SkinMaps }

interface Raster { W: number; H: number; pos: Float32Array; nor: Float32Array; cov: Uint8Array }

/** Растеризация треугольников части в UV-пространстве: для каждого текселя — позиция и нормаль на меше. */
function rasterize(part: ReturnType<typeof humanPartData>, W: number, H: number): Raster {
  const { position, normal, uv, index } = part;
  const pos = new Float32Array(W * H * 3), nor = new Float32Array(W * H * 3), cov = new Uint8Array(W * H);
  if (!uv) return { W, H, pos, nor, cov };
  const eps = 0.03;
  for (let t = 0; t < index.length; t += 3) {
    const a = index[t], b = index[t + 1], c = index[t + 2];
    const x0 = uv[a * 2] * W, y0 = (1 - uv[a * 2 + 1]) * H;
    const x1 = uv[b * 2] * W, y1 = (1 - uv[b * 2 + 1]) * H;
    const x2 = uv[c * 2] * W, y2 = (1 - uv[c * 2 + 1]) * H;
    const det = (y1 - y2) * (x0 - x2) + (x2 - x1) * (y0 - y2);
    if (Math.abs(det) < 1e-9) continue;
    const minX = Math.max(0, Math.floor(Math.min(x0, x1, x2) - 0.5)), maxX = Math.min(W - 1, Math.ceil(Math.max(x0, x1, x2) + 0.5));
    const minY = Math.max(0, Math.floor(Math.min(y0, y1, y2) - 0.5)), maxY = Math.min(H - 1, Math.ceil(Math.max(y0, y1, y2) + 0.5));
    for (let y = minY; y <= maxY; y++) {
      const py = y + 0.5;
      for (let x = minX; x <= maxX; x++) {
        const px = x + 0.5;
        const l0 = ((y1 - y2) * (px - x2) + (x2 - x1) * (py - y2)) / det;
        const l1 = ((y2 - y0) * (px - x2) + (x0 - x2) * (py - y2)) / det;
        const l2 = 1 - l0 - l1;
        if (l0 < -eps || l1 < -eps || l2 < -eps) continue;
        const i = y * W + x;
        for (let k = 0; k < 3; k++) {
          pos[i * 3 + k] = position[a * 3 + k] * l0 + position[b * 3 + k] * l1 + position[c * 3 + k] * l2;
          nor[i * 3 + k] = normal[a * 3 + k] * l0 + normal[b * 3 + k] * l1 + normal[c * 3 + k] * l2;
        }
        const nl = Math.hypot(nor[i * 3], nor[i * 3 + 1], nor[i * 3 + 2]) || 1;
        nor[i * 3] /= nl; nor[i * 3 + 1] /= nl; nor[i * 3 + 2] /= nl;
        cov[i] = 1;
      }
    }
  }
  return { W, H, pos, nor, cov };
}

interface Layers { col: Float32Array; hgt: Float32Array; rgh: Float32Array }

/** Заполнить пустые тексели соседями (чтобы не было швов и тёмных каёмок на мипах). */
function dilate(R: Raster, L: Layers, passes = 8): void {
  const { W, H } = R;
  const done = R.cov.slice();
  const next = new Uint8Array(done.length);
  for (let it = 0; it < passes; it++) {
    next.set(done);
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const i = y * W + x;
        if (done[i]) continue;
        let n = 0, r = 0, g = 0, b = 0, h = 0, q = 0;
        for (let dy = -1; dy <= 1; dy++) {
          const yy = y + dy; if (yy < 0 || yy >= H) continue;
          for (let dx = -1; dx <= 1; dx++) {
            const xx = x + dx; if (xx < 0 || xx >= W) continue;
            const j = yy * W + xx;
            if (!done[j]) continue;
            n++; r += L.col[j * 3]; g += L.col[j * 3 + 1]; b += L.col[j * 3 + 2]; h += L.hgt[j]; q += L.rgh[j];
          }
        }
        if (n) { L.col[i * 3] = r / n; L.col[i * 3 + 1] = g / n; L.col[i * 3 + 2] = b / n; L.hgt[i] = h / n; L.rgh[i] = q / n; next[i] = 1; }
      }
    }
    done.set(next);
  }
}

/** Упаковка слоёв в текстуры three. strength — сила рельефа нормалей. */
function toTextures(L: Layers, W: number, H: number, strength: number): SkinMaps {
  const cc = document.createElement('canvas'), cn = document.createElement('canvas'), cr = document.createElement('canvas');
  cc.width = cn.width = cr.width = W; cc.height = cn.height = cr.height = H;
  const ic = new ImageData(W, H), inn = new ImageData(W, H), ir = new ImageData(W, H);
  const h = L.hgt;
  for (let y = 0; y < H; y++) {
    const ym = Math.max(0, y - 1), yp = Math.min(H - 1, y + 1);
    for (let x = 0; x < W; x++) {
      const i = y * W + x;
      const xm = Math.max(0, x - 1), xp = Math.min(W - 1, x + 1);
      const dx = (h[y * W + xp] - h[y * W + xm]) * 0.5 * strength;
      const dy = (h[yp * W + x] - h[ym * W + x]) * 0.5 * strength;
      const l = Math.hypot(dx, dy, 1);
      const o = i * 4;
      inn.data[o] = ((-dx / l) * 0.5 + 0.5) * 255;
      inn.data[o + 1] = ((dy / l) * 0.5 + 0.5) * 255;
      inn.data[o + 2] = ((1 / l) * 0.5 + 0.5) * 255;
      inn.data[o + 3] = 255;
      ic.data[o] = clamp01(L.col[i * 3]) * 255;
      ic.data[o + 1] = clamp01(L.col[i * 3 + 1]) * 255;
      ic.data[o + 2] = clamp01(L.col[i * 3 + 2]) * 255;
      ic.data[o + 3] = 255;
      ir.data[o] = 255; ir.data[o + 1] = clamp01(L.rgh[i]) * 255; ir.data[o + 2] = 0; ir.data[o + 3] = 255;
    }
  }
  cc.getContext('2d')!.putImageData(ic, 0, 0);
  cn.getContext('2d')!.putImageData(inn, 0, 0);
  cr.getContext('2d')!.putImageData(ir, 0, 0);
  const mk = (c: HTMLCanvasElement, srgb: boolean) => {
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
    t.anisotropy = 8;
    t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
    t.generateMipmaps = true;
    t.minFilter = THREE.LinearMipmapLinearFilter;
    t.needsUpdate = true;
    return t;
  };
  return { map: mk(cc, true), normalMap: mk(cn, false), roughnessMap: mk(cr, false) };
}

type RGB = [number, number, number];
const BLOOD: RGB = [0.60, 0.21, 0.17];
const HAIR: RGB = [0.075, 0.055, 0.045];

function over(dst: Float32Array, i: number, c: RGB, a: number): void {
  if (a <= 0) return;
  dst[i * 3] += (c[0] - dst[i * 3]) * a;
  dst[i * 3 + 1] += (c[1] - dst[i * 3 + 1]) * a;
  dst[i * 3 + 2] += (c[2] - dst[i * 3 + 2]) * a;
}

/** Цвет кожи без лица: тон + крупные пятна + загар (общее для головы и тела; в швах совпадает). */
function baseSkin(per: Perlin3, per2: Perlin3, px: number, py: number, pz: number, tone: RGB, out: RGB): void {
  const big = per.fbm(px * 14, py * 14, pz * 14, 4);
  const mid = per2.fbm(px * 60, py * 60, pz * 60, 3);
  const v = 1 + 0.2 * (big - 0.5) + 0.07 * (mid - 0.5);
  const warm = (per2.fbm(px * 9 + 11, py * 9, pz * 9, 3) - 0.5) * 0.16;
  out[0] = tone[0] * v * (1 + 0.5 * warm);
  out[1] = tone[1] * v * (1 - 0.35 * warm);
  out[2] = tone[2] * v * (1 - 0.8 * warm);
}

export function paintHeadLayers(R: Raster, o: Required<Pick<SkinOpts, 'seed' | 'warPaint' | 'beard' | 'age'>> & { tone: RGB }): Layers {
  const lm = humanJSON()!.landmarks as Record<string, number[] | number>;
  const eyeL = lm.eyeL as number[], noseTip = lm.noseTip as number[], mouth = lm.mouth as number[];
  const chinY = lm.chinY as number;
  const { W, H, pos, nor, cov } = R;
  const L: Layers = { col: new Float32Array(W * H * 3), hgt: new Float32Array(W * H), rgh: new Float32Array(W * H) };
  const per = new Perlin3(o.seed), per2 = new Perlin3(o.seed + 17), per3 = new Perlin3(o.seed + 41);
  const ex0 = eyeL[0], ey0 = eyeL[1];
  const noseY = noseTip[1], mouthY = mouth[1];
  const tmp: RGB = [0, 0, 0];
  const age = o.age;

  // линии морщин (в плоскости лица): [x, y] для |x|
  const forehead = [0.0, 1, 2].map((k) => ey0 + 0.050 + k * 0.0135);
  const crow: number[][][] = [-0.34, 0, 0.34].map((a) => {
    const cx = ex0 + 0.0205, cy = ey0 - 0.001;
    return [[cx, cy], [cx + Math.cos(a) * 0.013, cy + Math.sin(a) * 0.013], [cx + Math.cos(a) * 0.024, cy + Math.sin(a) * 0.024]];
  });
  const nasolabial = [[0.0185, noseY + 0.0045], [0.0245, noseY - 0.0075], [0.0315, mouthY + 0.0105], [0.0365, mouthY - 0.001], [0.039, mouthY - 0.011]];
  const marionette = [[0.0285, mouthY - 0.007], [0.0305, mouthY - 0.022], [0.0275, mouthY - 0.036]];
  const browPts = (): number[][] => {
    const pts: number[][] = [];
    for (let i = 0; i <= 8; i++) { const s = i / 8; pts.push([0.0075 + s * 0.052, ey0 + 0.0195 + 0.0045 * Math.sin(Math.PI * Math.min(1, s * 1.1)) - 0.0050 * s * s]); }
    return pts;
  };
  const brow = browPts();
  const mustache = [[0.0015, mouthY + 0.0135], [0.011, mouthY + 0.0145], [0.0225, mouthY + 0.0105], [0.0325, mouthY + 0.0], [0.0385, mouthY - 0.0115]];
  const goatee = [[0, mouthY - 0.0125], [0, mouthY - 0.0235], [0, chinY - 0.006]];
  const paint: number[][][] = [0, 1, 2].map((k) => [[-0.064, ey0 - 0.0045 - k * 0.0075], [-0.0485, ey0 - 0.0115 - k * 0.0075], [-0.0315, ey0 - 0.0235 - k * 0.0075]]);
  const paintW = [0.0031, 0.0029, 0.0023];
  const lipC = mouthY + 0.0005;

  for (let ti = 0; ti < W * H; ti++) {
    if (!cov[ti]) continue;
    const px = pos[ti * 3], py = pos[ti * 3 + 1], pz = pos[ti * 3 + 2];
    const nx = nor[ti * 3], ny = nor[ti * 3 + 1], nz = nor[ti * 3 + 2];
    const ax = Math.abs(px), side = px >= 0 ? 1 : -1;
    const tx = ti % W, ty = (ti / W) | 0;
    baseSkin(per, per2, px, py, pz, o.tone, tmp);
    let r = tmp[0], g = tmp[1], b = tmp[2];
    let h = 0.5;
    let rough = 0.74;
    const front = sstep(0.0, 0.45, nz);
    const faceZone = sstep(1.50, 1.58, py) * (1 - sstep(1.735, 1.775, py)) * sstep(0.02, 0.06, pz);

    // --- румянец и кровеносные сосуды ---
    const dCheek = (ax - (ex0 + 0.013)) ** 2 + (py - (ey0 - 0.034)) ** 2;
    const cheek = gauss(dCheek, 0.026) * front;
    const dNose = (px) ** 2 + (py - (noseY + 0.003)) ** 2 + (pz - noseTip[2] + 0.012) ** 2;
    const nose = gauss(dNose, 0.017);
    const ear = sstep(0.066, 0.082, ax) * (1 - sstep(0.03, 0.05, pz - 0.0)) * sstep(1.62, 1.66, py) * (1 - sstep(1.72, 1.76, py));
    const ruddy = clamp01(0.5 * cheek + 0.55 * nose + 0.75 * ear);
    const rv = 0.7 + 0.6 * per3.fbm(px * 30, py * 30, pz * 30, 3);
    r = mix(r, BLOOD[0], 0.55 * ruddy * rv); g = mix(g, BLOOD[1], 0.55 * ruddy * rv); b = mix(b, BLOOD[2], 0.55 * ruddy * rv);
    // лоб и скулы темнее/обветреннее, нижняя часть шеи светлее
    const sun = faceZone * (0.5 + 0.5 * sstep(1.66, 1.74, py)) * 0.1;
    r *= 1 - sun; g *= 1 - sun * 1.2; b *= 1 - sun * 1.4;
    const neck = sstep(1.52, 1.45, py);
    r *= 1 - 0.07 * neck; g *= 1 - 0.06 * neck;

    // --- глаза: веки, тени, мешки ---
    const exn = (ax - ex0) / 0.0215, eyn = (py - ey0) / 0.0105;
    const er = Math.hypot(exn, eyn);
    const lid = (1 - sstep(1.0, 1.7, er)) * front;
    const upperLid = lid * sstep(-0.3, 0.9, eyn) ;
    r *= 1 - 0.28 * lid - 0.1 * upperLid; g *= 1 - 0.34 * lid - 0.12 * upperLid; b *= 1 - 0.3 * lid - 0.1 * upperLid;
    // линия ресниц вдоль верхнего века
    const lash = (1 - sstep(0.0, 0.2, Math.abs(er - 1.02))) * sstep(-0.05, 0.4, eyn) * front;
    over(L.col, ti, HAIR, 0.55 * lash);
    // мешки под глазами
    const bagD = ((ax - ex0 - 0.002) / 0.026) ** 2 + ((py - (ey0 - 0.0165)) / 0.0075) ** 2;
    const bag = gauss(bagD, 0.5) * front * (0.6 + 0.4 * age);
    r *= 1 - 0.1 * bag; g *= 1 - 0.14 * bag; b *= 1 - 0.04 * bag;
    h -= 0.25 * bag * 0.2;

    // --- губы ---
    const lx = ax / 0.0265, ly = (py - lipC) / 0.0108;
    const lipR = Math.hypot(lx, ly);
    const lipMask = (1 - sstep(0.82, 1.02, lipR)) * front * sstep(0.04, 0.09, pz);
    // «разрез» рта и ямка над губой
    const slit = (1 - sstep(0.0, 0.0022, Math.abs(py - (mouthY - 0.0005)))) * (1 - sstep(0.7, 1.0, lx)) * front;
    const lc: RGB = [0.56, 0.31, 0.27];
    r = mix(r, lc[0] * (0.92 + 0.16 * per3.noise(px * 150, py * 150, pz * 150)), 0.6 * lipMask);
    g = mix(g, lc[1], 0.6 * lipMask); b = mix(b, lc[2], 0.6 * lipMask);
    r *= 1 - 0.55 * slit; g *= 1 - 0.65 * slit; b *= 1 - 0.6 * slit;
    rough = mix(rough, 0.5, lipMask);
    // вертикальные складочки губ
    h += lipMask * 0.05 * (vnoise2(px * 1100 + 3, py * 70, 5) - 0.5);

    // --- морщины ---
    let wr = 0; // глубина канавок 0..1
    // лоб: горизонтальные дуги, ослабевающие к вискам
    for (let k = 0; k < forehead.length; k++) {
      const yline = forehead[k] - 0.012 * (ax / 0.06) * (ax / 0.06);
      const d = Math.abs(py - yline - 0.002 * Math.sin(px * 160 + k * 2));
      const fade = (1 - sstep(0.035, 0.06, ax)) * sstep(1.0, 0.3, ax / 0.06 + 0.0);
      wr = Math.max(wr, (1 - sstep(0.0, 0.0016 + 0.0006 * age, d)) * (0.45 + 0.55 * per.noise(px * 60, py * 30, k)) * fade * front * (0.55 + 0.45 * age));
    }
    // межбровье: две вертикальные складки
    for (const sx of [-0.0045, 0.0045]) {
      const d = Math.hypot((px - sx) * 1.2, Math.max(0, Math.abs(py - (ey0 + 0.0215)) - 0.0045));
      wr = Math.max(wr, (1 - sstep(0.0, 0.0017, d)) * front * 0.5 * (0.4 + 0.6 * age));
    }
    // гусиные лапки
    for (const ln of crow) {
      const q = polyDist(ax, py, ln);
      wr = Math.max(wr, (1 - sstep(0.0, 0.0013, q.d)) * (1 - 0.5 * q.s) * front * (0.5 + 0.5 * age));
    }
    // носогубные и «марионеточные» складки
    {
      const q = polyDist(ax, py, nasolabial);
      wr = Math.max(wr, (1 - sstep(0.0, 0.0034, q.d)) * (0.8 - 0.35 * q.s) * front * 0.7);
      const m2 = polyDist(ax, py, marionette);
      wr = Math.max(wr, (1 - sstep(0.0, 0.0017, m2.d)) * 0.6 * front * (0.5 + 0.5 * age));
    }
    // нижнее веко
    wr = Math.max(wr, (1 - sstep(0.0, 0.0012, Math.abs(Math.hypot(exn, (py - (ey0 - 0.0085)) / 0.0075) - 1.15))) * sstep(-0.4, -1.0, eyn) * 0.4 * front);
    h -= 0.6 * wr;
    const wrD = 1 - 0.17 * wr;
    r *= wrD; g *= wrD * 0.97; b *= wrD * 0.95;

    // --- брови ---
    {
      const q = polyDist(ax, py, brow);
      const thick = 0.0040 * (1 - 0.5 * q.s) + 0.0008;
      const inBrow = (1 - sstep(thick * 0.35, thick * 1.1, q.d)) * front * sstep(0.015, 0.06, pz) * (1 - 0.5 * sstep(0.55, 1.0, q.s));
      if (inBrow > 0.01) {
        const strands = sstep(0.42, 0.8, vnoise2(q.s * 300, q.d * 2800, 3)) * 0.7 + 0.2;
        const a = inBrow * strands * 0.8;
        r = mix(r, HAIR[0] * 1.3, a); g = mix(g, HAIR[1] * 1.3, a); b = mix(b, HAIR[2] * 1.3, a);
        rough = mix(rough, 0.8, a);
        h += 0.05 * a;
      }
    }

    // --- щетина, усы, козлиная бородка ---
    if (o.beard > 0) {
      const bd = Math.hypot(px / 0.067, (py - (mouthY - 0.02)) / 0.072);
      let dens = (1 - sstep(0.55, 1.0, bd)) * sstep(0.01, 0.08, pz + 0.06) * (1 - lipMask) * (1 - sstep(0.5, 1.0, Math.abs(py - (mouthY + 0.002)) < 0.02 && ax < 0.03 ? 0 : 1) * 0);
      dens *= 0.28 + 0.4 * per2.fbm(px * 45, py * 45, pz * 45, 2);
      // над губой щетина гуще
      dens = Math.max(dens, (1 - sstep(0.012, 0.03, Math.abs(py - (mouthY + 0.012)))) * (1 - sstep(0.025, 0.045, ax)) * 0.6 * (1 - lipMask));
      const mq = polyDist(ax, py, mustache);
      const mTh = 0.0072 * (1 - 0.4 * mq.s) + 0.0014;
      const must = (1 - sstep(mTh * 0.6, mTh * 1.05, mq.d)) * (1 - lipMask * 0.9) * front;
      const gq = polyDist(ax, py, goatee);
      const gTh = 0.0085 * (1 - 0.55 * gq.s) + 0.0018;
      const goat = (1 - sstep(gTh * 0.5, gTh, gq.d)) * front * (1 - lipMask);
      const solid = Math.max(must, goat) * o.beard;
      dens = Math.max(dens, solid * 0.95);
      dens *= o.beard;
      if (dens > 0.01) {
        const dot = vnoise2(tx * 0.95, ty * 0.95, 11);
        const spec = sstep(1 - dens * 0.9, 1 - dens * 0.55, dot);
        const tone = 0.55 + 0.45 * hash2(tx, ty, 9);
        const a = Math.max(spec * 0.8, solid * 0.55 * (0.55 + 0.45 * vnoise2(px * 700, py * 1400, 8))) * tone;
        r = mix(r, HAIR[0] * 1.2, a); g = mix(g, HAIR[1] * 1.2, a); b = mix(b, HAIR[2] * 1.2, a);
        // под щетиной кожа сероватая-синеватая
        const shade = 0.12 * dens;
        r *= 1 - shade * 0.7; g *= 1 - shade * 0.55; b *= 1 - shade * 0.3;
        rough = mix(rough, 0.78, a);
        h += 0.2 * a;
      }
    }

    // --- боевая раскраска: рубцы-полосы на правой щеке ---
    if (o.warPaint && px < 0) {
      for (let k = 0; k < 3; k++) {
        const q = polyDist(px, py, paint[k]);
        const w0 = paintW[k] * (1 - 0.35 * q.s) * (0.8 + 0.4 * per3.noise(px * 200 + k, py * 200, pz * 200));
        const stroke = (1 - sstep(w0 * 0.55, w0 * 1.1, q.d)) * front * (1 - sstep(0.9, 1.0, q.s)) * sstep(0.0, 0.08, q.s + 0.05);
        if (stroke > 0.01) {
          const grit = 0.75 + 0.25 * vnoise2(tx * 0.8, ty * 0.8, 21 + k);
          const a = stroke * 0.9 * grit;
          r = mix(r, 0.27, a); g = mix(g, 0.065, a); b = mix(b, 0.05, a);
          h -= 0.12 * stroke; rough = mix(rough, 0.88, a);
          // воспалённый ореол вокруг
          const halo = (1 - sstep(w0 * 1.1, w0 * 3.0, q.d)) * front * 0.16;
          r = mix(r, BLOOD[0], halo); g = mix(g, BLOOD[1], halo); b = mix(b, BLOOD[2], halo);
        }
      }
    }

    // --- поры, веснушки, шрамики ---
    const pore = vnoise2(tx * 0.62, ty * 0.62, 3);
    const poreF = sstep(0.55, 0.9, pore);
    const micro = vnoise2(tx * 0.31 + 20, ty * 0.31, 13);
    h += (0.018 * (micro - 0.5) - 0.03 * poreF) * (0.6 + 0.4 * faceZone);
    const spots = sstep(0.7, 0.86, per3.fbm(px * 220, py * 220, pz * 220, 2)) * 0.18 * faceZone;
    r *= 1 - spots; g *= 1 - spots * 1.1; b *= 1 - spots * 0.8;
    // жирная Т-зона
    const tz = gauss(px * px * 3.0 + (py - (noseY + 0.01)) ** 2 * 0.3, 0.02) * front;
    rough = mix(rough, 0.58, tz * 0.6) + 0.08 * (pore - 0.5);
    // крупная неровность кожи
    h += 0.03 * (per.fbm(px * 120, py * 120, pz * 120, 3) - 0.5);
    // затенение «впадин» (AO по нормали вниз/внутрь)
    const cav = 1 - 0.1 * clamp01(-ny * 0.8) * (1 - nz * 0.5);
    r *= cav; g *= cav; b *= cav;

    L.col[ti * 3] = r; L.col[ti * 3 + 1] = g; L.col[ti * 3 + 2] = b;
    L.hgt[ti] = h; L.rgh[ti] = rough;
    void nx; void side;
  }
  return L;
}

export function paintBodyLayers(R: Raster, o: { seed: number; tone: RGB }): Layers {
  const { W, H, pos, nor, cov } = R;
  const L: Layers = { col: new Float32Array(W * H * 3), hgt: new Float32Array(W * H), rgh: new Float32Array(W * H) };
  const per = new Perlin3(o.seed), per2 = new Perlin3(o.seed + 17), per3 = new Perlin3(o.seed + 41);
  const tmp: RGB = [0, 0, 0];
  for (let ti = 0; ti < W * H; ti++) {
    if (!cov[ti]) continue;
    const px = pos[ti * 3], py = pos[ti * 3 + 1], pz = pos[ti * 3 + 2];
    const ny = nor[ti * 3 + 1];
    const ax = Math.abs(px);
    const tx = ti % W, ty = (ti / W) | 0;
    baseSkin(per, per2, px, py, pz, o.tone, tmp);
    let r = tmp[0], g = tmp[1], b = tmp[2];
    // загар: руки ниже локтя, кисти, шея — темнее и краснее; торс и ноги бледнее
    const forearm = sstep(1.2, 1.05, py) * sstep(0.1, 0.18, ax) * sstep(0.9, 0.84, 2 - py);
    const hand = sstep(0.92, 0.84, py) * sstep(0.1, 0.18, ax);
    const tan = clamp01(0.55 * forearm + 0.9 * hand);
    r *= 1 - 0.1 * tan; g *= 1 - 0.14 * tan; b *= 1 - 0.18 * tan;
    const torso = sstep(0.22, 0.12, ax) * sstep(1.0, 1.1, py) * sstep(1.52, 1.44, py);
    r *= 1 + 0.04 * torso; g *= 1 + 0.06 * torso; b *= 1 + 0.07 * torso;
    // красные локти, колени, суставы пальцев
    const joints = clamp01(
      gauss((ax - 0.222) ** 2 + (py - 1.125) ** 2 + pz * pz, 0.03) + gauss((ax - 0.1) ** 2 + (py - 0.5) ** 2, 0.045) + 0.7 * hand * sstep(0.6, 0.9, per3.fbm(px * 90, py * 90, pz * 90, 2)),
    );
    r = mix(r, BLOOD[0], 0.28 * joints); g = mix(g, BLOOD[1], 0.28 * joints); b = mix(b, BLOOD[2], 0.28 * joints);
    // волосы на руках и груди: тёмные точки
    const hairy = (0.25 * forearm + 0.18 * sstep(0.25, 0.0, ax) * sstep(1.22, 1.38, py) * sstep(1.46, 1.38, py) + 0.12 * sstep(0.95, 0.5, py) * sstep(0.0, 0.15, ax)) * (0.5 + 0.5 * per2.fbm(px * 40, py * 40, pz * 40, 2));
    const dot = vnoise2(tx * 0.9, ty * 0.9, 31);
    const hs = sstep(1 - hairy, 1 - hairy * 0.6, dot) * 0.45;
    r = mix(r, HAIR[0] * 1.6, hs); g = mix(g, HAIR[1] * 1.6, hs); b = mix(b, HAIR[2] * 1.6, hs);
    // поры, складки кожи
    const pore = vnoise2(tx * 0.62, ty * 0.62, 3);
    const poreF = sstep(0.55, 0.9, pore);
    let h = 0.5 + 0.02 * (vnoise2(tx * 0.31 + 20, ty * 0.31, 13) - 0.5) - 0.035 * poreF + 0.03 * (per.fbm(px * 110, py * 110, pz * 110, 3) - 0.5);
    // морщинки на суставах пальцев
    h -= joints * 0.12 * sstep(0.55, 0.62, Math.abs(Math.sin(py * 900 + per3.noise(px * 40, py * 40, pz * 40) * 3)));
    const cav = 1 - 0.08 * clamp01(-ny * 0.8);
    L.col[ti * 3] = r * cav; L.col[ti * 3 + 1] = g * cav; L.col[ti * 3 + 2] = b * cav;
    L.hgt[ti] = h;
    L.rgh[ti] = 0.76 + 0.06 * (pore - 0.5) + 0.1 * hs;
  }
  return L;
}

let baked: SkinBake | null = null;
export const getSkins = (): SkinBake | null => baked;

/** Запечь кожу головы и тела (асинхронно по кускам — страница не «зависает»). */
export async function bakeSkins(opts: SkinOpts = {}): Promise<SkinBake> {
  const size = opts.size ?? 1024, bsize = opts.bodySize ?? 1024;
  const o = {
    seed: opts.seed ?? 7, warPaint: opts.warPaint ?? true, beard: opts.beard ?? 1, age: opts.age ?? 0.55,
    tone: (opts.tone ?? [0.655, 0.495, 0.385]) as RGB,
  };
  const yieldUI = () => new Promise<void>((res) => setTimeout(res, 0));
  const t0 = performance.now();
  const headR = rasterize(humanPartData('head'), size, size);
  await yieldUI();
  const headL = paintHeadLayers(headR, o);
  await yieldUI();
  dilate(headR, headL, 10);
  const head = toTextures(headL, size, size, 2.2);
  await yieldUI();
  const bodyR = rasterize(humanPartData('body'), bsize, bsize);
  await yieldUI();
  const bodyL = paintBodyLayers(bodyR, o);
  dilate(bodyR, bodyL, 10);
  const body = toTextures(bodyL, bsize, bsize, 2.2);
  console.log(`кожа: ${(performance.now() - t0).toFixed(0)} мс (голова ${size}², тело ${bsize}²)`);
  baked = { head, body };
  return baked;
}

export { mix, segDist };
