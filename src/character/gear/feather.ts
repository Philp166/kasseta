// Перья: процедурная текстура опахала (бородки, полосы, зазубрины по краю через alphaMap) и геометрия
// (изогнутая лента + стержень-очин). Используются в копье, стрелах, колчане, амулетах.

import * as THREE from 'three';
import { RNG } from '../../core/util';
import { PBR, PBRMaps, Fbm, hex, mixRGB, sstep, texSize, makeCanvas, ctxOf, RGB } from './texkit';
import { GeoBuilder, V, tube } from './geom';

export type FeatherKind = 'barred' | 'dark' | 'white';

interface FeatherStyle {
  light: number; mid: number; dark: number; tip: number;
  bars: number;       // число полос по длине
  barStrength: number;
  edgeLight: number;
  seed: number;
}
const STYLES: Record<FeatherKind, FeatherStyle> = {
  // серо-белое с тёмными полосами, бурый кончик (копьё, колчан)
  barred: { light: 0xdcd5c7, mid: 0x9d9282, dark: 0x40342b, tip: 0x5a4636, bars: 7, barStrength: 0.9, edgeLight: 0xf1ece2, seed: 3 },
  // тёмное маховое орлиное: бурое с белёсым концом (амулеты)
  dark: { light: 0x8a7458, mid: 0x4f3d2e, dark: 0x1f1610, tip: 0xd9d0c0, bars: 5, barStrength: 0.35, edgeLight: 0xb09a78, seed: 8 },
  // светлое оперение стрел
  white: { light: 0xe9e5db, mid: 0xb5ad9e, dark: 0x6d6254, tip: 0xcfc7b8, bars: 4, barStrength: 0.4, edgeLight: 0xf4f1ea, seed: 12 },
};

export interface FeatherTex extends PBRMaps {
  alphaMap: THREE.CanvasTexture;
}

const TEX: Map<string, FeatherTex> = new Map();
const MATS: Map<string, THREE.MeshStandardMaterial> = new Map();

/** Контур опахала в долях: полуширина vane на позиции s (0 — основание, 1 — кончик). */
function vane(s: number): number {
  const a = sstep(0.08, 0.36, s);
  const t = Math.max(0, (s - 0.46) / 0.54);
  const b = Math.max(0, 1 - Math.pow(t, 2.1));
  return a * Math.pow(b, 0.72);
}

export function makeFeatherTex(kind: FeatherKind): FeatherTex {
  const st = STYLES[kind];
  const W = texSize(256), H = texSize(1024);
  const t = new PBR(W, H);
  const light = hex(st.light), mid = hex(st.mid), dark = hex(st.dark), tipC = hex(st.tip), edgeL = hex(st.edgeLight);
  const rng = new RNG(st.seed * 17 + 3);
  const wob = new Fbm(6, 4, st.seed, 0.6, 1, 2);
  const mott = new Fbm(3, 4, st.seed + 1, 0.55, 1, 1);
  const barbN = new Fbm(40, 2, st.seed + 2, 0.5, 1, 1);
  const cx = W / 2;
  const maxHW = W * 0.46;
  const theta = (52 * Math.PI) / 180; // угол бородок к стержню
  const period = Math.max(3, W / 64);
  // маска формы (альфа) — рисуем на canvas
  const alphaC = makeCanvas(W, H);
  const ag = ctxOf(alphaC);
  ag.fillStyle = '#000';
  ag.fillRect(0, 0, W, H);
  ag.fillStyle = '#fff';
  ag.beginPath();
  const N = 96;
  const asym = 0.74; // левая половина уже
  for (let i = 0; i <= N; i++) {
    const s = i / N;
    const y = H * (1 - s);
    const jag = (rng.next() - 0.5) * 3;
    const x = cx - vane(s) * maxHW * asym + jag;
    if (i === 0) ag.moveTo(x, y); else ag.lineTo(x, y);
  }
  for (let i = N; i >= 0; i--) {
    const s = i / N;
    const y = H * (1 - s);
    const jag = (rng.next() - 0.5) * 3;
    ag.lineTo(cx + vane(s) * maxHW + jag, y);
  }
  ag.closePath();
  ag.fill();
  // зазубрины (расщепления бородок) вдоль краёв
  ag.globalCompositeOperation = 'destination-out';
  ag.strokeStyle = '#000';
  for (let i = 0; i < 70; i++) {
    const s = rng.range(0.12, 0.98);
    const side = rng.next() < 0.5 ? -1 : 1;
    const hw = vane(s) * maxHW * (side < 0 ? asym : 1);
    const y0 = H * (1 - s);
    const x0 = cx + side * hw;
    const L = rng.range(8, 34) * (W / 256);
    ag.lineWidth = rng.range(0.8, 2.2) * (W / 256);
    ag.beginPath();
    ag.moveTo(x0 + side * 3, y0 + 2);
    // щель идёт вдоль направления бородки (к кончику и внутрь)
    ag.lineTo(x0 - side * Math.sin(theta) * L, y0 + Math.cos(theta) * L);
    ag.stroke();
  }
  // рваный кончик
  for (let i = 0; i < 9; i++) {
    const s = rng.range(0.9, 1.0);
    const y0 = H * (1 - s);
    ag.beginPath();
    ag.arc(cx + (rng.next() - 0.5) * maxHW * 0.7, y0 + rng.range(0, 8), rng.range(2, 5), 0, Math.PI * 2);
    ag.fill();
  }
  ag.globalCompositeOperation = 'source-over';
  const ad = ag.getImageData(0, 0, W, H).data;
  const alpha = new Float32Array(W * H);
  for (let i = 0; i < W * H; i++) alpha[i] = ad[i * 4] / 255;

  t.gen((u, v, p, x, y) => {
    const s = 1 - v; // 0 — основание, 1 — кончик
    const dx = x + 0.5 - cx;
    const side = dx < 0 ? -1 : 1;
    const hw = Math.max(1, vane(s) * maxHW * (side < 0 ? asym : 1));
    const rel = Math.min(1, Math.abs(dx) / hw); // 0 у стержня, 1 у края
    // бородки: параллельные линии под углом theta
    const dy = (H - y) ;
    const q = (Math.abs(dx) * Math.cos(theta) - dy * Math.sin(theta) * side * side);
    const wv = wob.at(u, v);
    const barb = 0.5 + 0.5 * Math.sin(((q + wv * 6) / period) * Math.PI * 2);
    const bn = barbN.at(u, v);
    // полосы-«перекладины»: шевроны к кончику
    const ph = s * st.bars + rel * 0.35 + (wv - 0.5) * 0.5;
    const bar = sstep(0.42, 0.58, 0.5 + 0.5 * Math.sin(ph * Math.PI * 2)) * st.barStrength * sstep(0.1, 0.25, s);
    const m = mott.at(u, v);
    let c = mixRGB(light, mid, clamp01(0.25 + (m - 0.5) * 0.7 + rel * 0.25));
    c = mixRGB(c, dark, bar);
    c = mixRGB(c, tipC, sstep(0.86, 0.97, s));
    c = mixRGB(c, edgeL, sstep(0.82, 1.0, rel) * 0.5);
    // освещение бородок
    const bk = 0.86 + 0.24 * barb + 0.1 * (bn - 0.5);
    p.r = c[0] * bk; p.g = c[1] * bk; p.b = c[2] * bk;
    // стержень
    const rach = 1 - sstep(2.2, 5.5, Math.abs(dx));
    if (rach > 0 && s > 0.02) {
      const rc: RGB = mixRGB(hex(0xcab894), [1, 1, 1], 0.1);
      p.r += (rc[0] - p.r) * rach; p.g += (rc[1] - p.g) * rach; p.b += (rc[2] - p.b) * rach;
    }
    // очин (голая часть у основания)
    if (s < 0.1) {
      const q2 = 1 - sstep(4, 9, Math.abs(dx));
      p.r += (0.8 - p.r) * q2; p.g += (0.72 - p.g) * q2; p.b += (0.55 - p.b) * q2;
    }
    p.h = 0.5 + 0.22 * (barb - 0.5) + 0.04 * (bn - 0.5) + rach * 0.18;
    p.rough = 0.7 + 0.15 * (0.5 - barb);
    p.metal = 0;
    p.ao = 0.85 + 0.15 * barb;
  });
  const maps = t.textures({ normalStrength: 2.4 });
  // alphaMap — серый canvas (G-канал используется three)
  const ac2 = makeCanvas(W, H);
  const ag2 = ctxOf(ac2);
  const im = ag2.createImageData(W, H);
  for (let i = 0; i < W * H; i++) {
    const a = Math.round(alpha[i] * 255);
    im.data[i * 4] = a; im.data[i * 4 + 1] = a; im.data[i * 4 + 2] = a; im.data[i * 4 + 3] = 255;
  }
  ag2.putImageData(im, 0, 0);
  const at = new THREE.CanvasTexture(ac2);
  at.colorSpace = THREE.NoColorSpace;
  at.anisotropy = 4;
  at.wrapS = at.wrapT = THREE.ClampToEdgeWrapping;
  at.needsUpdate = true;
  for (const tx of [maps.map, maps.normalMap, maps.orm]) tx.wrapS = tx.wrapT = THREE.ClampToEdgeWrapping;
  return { ...maps, alphaMap: at };
}

const clamp01 = (x: number) => (x < 0 ? 0 : x > 1 ? 1 : x);

export function featherTex(kind: FeatherKind): FeatherTex {
  let t = TEX.get(kind);
  if (!t) TEX.set(kind, (t = makeFeatherTex(kind)));
  return t;
}

export function featherMat(kind: FeatherKind = 'barred'): THREE.MeshStandardMaterial {
  let m = MATS.get(kind);
  if (!m) {
    const t = featherTex(kind);
    m = new THREE.MeshStandardMaterial({
      map: t.map, normalMap: t.normalMap, normalScale: new THREE.Vector2(0.8, 0.8),
      roughnessMap: t.orm, aoMap: t.orm, alphaMap: t.alphaMap,
      roughness: 1, metalness: 0, side: THREE.DoubleSide, alphaTest: 0.5, alphaToCoverage: true,
    });
    m.name = 'feather:' + kind;
    MATS.set(kind, m);
  }
  return m;
}

export interface FeatherOpts {
  length: number;
  /** Полная ширина полотна (м). */
  width: number;
  /** Кривизна вдоль длины (м прогиба на конце). */
  curl?: number;
  /** Желобчатость поперёк. */
  cup?: number;
  /** Скручивание (рад) от основания к кончику. */
  twist?: number;
  /** Зеркалить по u (разнообразие). */
  mirror?: boolean;
  rows?: number;
  cols?: number;
}

/**
 * Перо: лежит вдоль +Y (основание в начале координат, кончик в (0, length, ·)), плоскость полотна XY, изгиб к +Z.
 * Возвращает построитель (геометрия: полотно-лента + стержень).
 */
export function featherGeometry(o: FeatherOpts, gb = new GeoBuilder()): GeoBuilder {
  const rows = o.rows ?? 14, cols = o.cols ?? 7;
  const L = o.length, W = o.width;
  const curl = o.curl ?? L * 0.18, cup = o.cup ?? W * 0.12, tw = o.twist ?? 0;
  const spine = (s: number) => new THREE.Vector3(0, s * L, curl * s * s);
  gb.grid(rows, cols, (i, j) => {
    const s = i / (rows - 1);
    const u = j / (cols - 1);
    const x = (u - 0.5) * W;
    const c = spine(s);
    const a = tw * s;
    const dz = cup * (2 * u - 1) * (2 * u - 1);
    const p = new THREE.Vector3(x * Math.cos(a), c.y, c.z + dz + x * Math.sin(a));
    return { p, u: o.mirror ? 1 - u : u, v: s };
  }, { flip: true });
  // стержень: тонкая трубка по оси полотна
  const pts: THREE.Vector3[] = [];
  for (let i = 0; i <= 8; i++) pts.push(spine(i / 8).add(V(0, 0, cup * 0.0)));
  const curve = new THREE.CatmullRomCurve3(pts);
  const sub = new GeoBuilder();
  tube(curve, { radius: (t) => 0.0011 * (1 - t * 0.75) + 0.0002, sides: 4, segs: 10, caps: 'none', tile: L }, sub);
  // привязать UV стержня к центральной линии текстуры (u=0.5)
  for (let i = 0; i < sub.uv.length; i += 2) sub.uv[i] = 0.5 + (sub.uv[i] - 0.5) * 0.02;
  gb.append(sub);
  return gb;
}

export { RNG };
