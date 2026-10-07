// Голова: эллипсоид, вылепленный функциями-«буграми» (надбровья, глазницы, нос, скулы, губы, подбородок).
// HeadShape используется и мешем, и рисовальщиком лица: краска ложится точно по тем же координатам.

import * as THREE from 'three';
import { Surface, gridSurface, ellipsoid, vloft, SkinHelper } from './surface';
import { lerp, smoothstep, clamp } from '../core/util';

export const HEAD = {
  cx: 0,
  cy: 1.668,
  cz: 0.012,
  rx: 0.076,
  ry: 0.113,
  rz: 0.099,
  eyeY: 1.678,
  browY: 1.707,
  noseY: 1.641,
  mouthY: 1.604,
  chinY: 1.556,
  eyeX: 0.033,
};

export class HeadShape {
  rows = 72;
  cols = 112;

  /** Масштаб ширины/глубины по высоте: нижняя часть уже (скулы → подбородок). */
  taper(y: number): { sx: number; sz: number } {
    const t = smoothstep(HEAD.chinY, HEAD.cy + 0.01, y);
    return { sx: lerp(0.55, 1.0, t), sz: lerp(0.78, 1.0, t) };
  }

  /** Точка на лице по параметрам сферы. th=0 — прямо вперёд, ph=0 — макушка. */
  point(th: number, ph: number): THREE.Vector3 {
    const { cy, cz, rx, ry, rz, eyeY, browY, noseY, mouthY, chinY, eyeX } = HEAD;
    const sp = Math.sin(ph), cp = Math.cos(ph);
    const dz = sp * Math.cos(th);
    const y = cy + ry * cp;
    const { sx, sz } = this.taper(y);
    let x = rx * sp * Math.sin(th) * sx;
    let z = cz + rz * dz * sz;
    const ax = Math.abs(x);
    const front = smoothstep(0.05, 0.55, dz);
    const g = (x0: number, y0: number, sxx: number, syy: number) =>
      Math.exp(-(((ax - x0) / sxx) ** 2 + ((y - y0) / syy) ** 2)) * front;
    let dzAdd = 0, dxAdd = 0;
    // лоб и надбровные дуги
    dzAdd += 0.004 * g(0, 1.735, 0.055, 0.025);
    dzAdd += 0.009 * g(0.030, browY, 0.032, 0.0095);
    dzAdd += 0.006 * g(0, browY, 0.02, 0.011);
    // глазницы
    dzAdd -= 0.007 * g(eyeX, eyeY, 0.021, 0.014);
    // переносица и нос
    dzAdd += 0.011 * g(0, eyeY - 0.004, 0.0085, 0.03);
    dzAdd += 0.028 * g(0, noseY + 0.006, 0.0135, 0.021);
    dzAdd += 0.011 * g(0.016, noseY - 0.008, 0.012, 0.008); // крылья носа
    // скулы и впадины щёк
    dzAdd += 0.007 * g(0.052, eyeY - 0.022, 0.024, 0.017);
    dxAdd += 0.006 * g(0.055, eyeY - 0.022, 0.026, 0.018);
    dzAdd -= 0.004 * g(0.046, noseY - 0.028, 0.03, 0.02);
    // губы и подбородок
    dzAdd += 0.009 * g(0, mouthY + 0.006, 0.021, 0.0055);
    dzAdd += 0.008 * g(0, mouthY - 0.008, 0.018, 0.0065);
    dzAdd -= 0.0032 * g(0, mouthY - 0.0005, 0.022, 0.0018);
    dzAdd += 0.012 * g(0, chinY + 0.016, 0.024, 0.02);
    // затылок чуть выпуклее
    dzAdd -= 0.007 * smoothstep(-0.25, -0.85, dz);
    z += dzAdd;
    x += Math.sign(x) * dxAdd;
    return new THREE.Vector3(x, y, z);
  }

  /** Координаты текстуры для точки лица (x, y в метрах, спереди). */
  uv(x: number, y: number): { u: number; v: number } {
    const { cy, ry, rx } = HEAD;
    const ph = Math.acos(clamp((y - cy) / ry, -1, 1));
    const { sx } = this.taper(y);
    const sinth = clamp(x / (rx * Math.sin(ph) * sx + 1e-6), -1, 1);
    const th = Math.asin(sinth);
    return { u: 0.5 + th / (Math.PI * 2), v: 1 - ph / Math.PI };
  }

  /** Локальный масштаб «пикселей на метр» в точке (для рисования признаков лица в метрах). */
  scale(x: number, y: number, W: number, H: number): { sx: number; sy: number } {
    const e = 0.0006;
    const a = this.uv(x - e, y), b = this.uv(x + e, y);
    const c = this.uv(x, y - e), d = this.uv(x, y + e);
    return { sx: (Math.abs(b.u - a.u) / (2 * e)) * W, sy: (Math.abs(d.v - c.v) / (2 * e)) * H };
  }

  build(sk: SkinHelper): Surface {
    const bone = sk.one('head');
    return gridSurface({
      rows: this.rows,
      cols: this.cols,
      wrap: true,
      fn: (i, j) => {
        const ph = Math.PI * (i / (this.rows - 1));
        const th = -Math.PI + (j / this.cols) * Math.PI * 2;
        return { p: this.point(th, ph), u: j / this.cols, v: 1 - i / (this.rows - 1), b: bone.b, w: bone.w, f: 0 };
      },
    });
  }
}

export function buildEars(sk: SkinHelper): Surface {
  const bone = sk.one('head');
  const s = new Surface();
  for (const sx of [1, -1]) {
    s.append(
      ellipsoid({
        center: new THREE.Vector3(sx * 0.0745, 1.668, -0.004),
        radii: new THREE.Vector3(0.008, 0.032, 0.021),
        rows: 10, cols: 14, bone,
        rot: new THREE.Euler(0, 0, sx * -0.18),
        flip: false,
      }),
    );
  }
  return s;
}

/** Шея: от основания до челюсти. */
export function buildNeck(sk: SkinHelper): Surface {
  const rings = [];
  const n = 8;
  for (let i = 0; i < n; i++) {
    const y = 1.625 - (i / (n - 1)) * 0.19;
    rings.push({ y, rx: 0.049 + 0.004 * (i / (n - 1)), rz: 0.052 + 0.005 * (i / (n - 1)), cz: 0.004 });
  }
  return vloft({
    rings, cols: 18, wrap: true,
    skin: (y) => sk.chainY(y, [['head', 1.57], ['neck', 1.45], ['chest', 0]], 0.03),
    uv: (i, j) => [j / 18, 1 - i / (n - 1)],
    f: () => 0,
  });
}
