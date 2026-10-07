// Сборка оболочки одежды из внешней модели (GLB, TRELLIS): вырезание, посадка, нормали → public/models/shell.*
//   node tools/build-shell.mjs [путь/к/модели.glb]
import fs from 'node:fs';
import path from 'node:path';
import { PNG } from 'pngjs';
import { execFileSync } from 'node:child_process';
import { processShell, weldedNormals, pushOut, FIT } from '../src/character/shell/process.mjs';

const SRC = process.argv[2] || '.tmp/trellis/ref.glb';
const OUT = path.resolve('public/models');
fs.mkdirSync(OUT, { recursive: true });
const t0 = Date.now();

const d = fs.readFileSync(SRC);
const jl = d.readUInt32LE(12);
const j = JSON.parse(d.slice(20, 20 + jl).toString());
const binOff = 20 + jl + 8;
const acc = j.accessors, bv = j.bufferViews;
const slice = (i, Ctor) => {
  const a = acc[i], v = bv[a.bufferView];
  const comps = a.type === 'VEC3' ? 3 : a.type === 'VEC2' ? 2 : 1;
  const off = binOff + (v.byteOffset || 0) + (a.byteOffset || 0);
  const buf = d.buffer.slice(d.byteOffset + off, d.byteOffset + off + a.count * comps * 4);
  return new Ctor(buf);
};
const prim = j.meshes[0].primitives[0];
const idx = slice(prim.indices, Uint32Array);
const pos = slice(prim.attributes.POSITION, Float32Array);
const uv = slice(prim.attributes.TEXCOORD_0, Float32Array);

// текстура базового цвета
const im = j.images[j.textures[j.materials[prim.material ?? 0].pbrMetallicRoughness.baseColorTexture.index].source];
const v = bv[im.bufferView];
let pngBuf = d.slice(binOff + (v.byteOffset || 0), binOff + (v.byteOffset || 0) + v.byteLength);
pngBuf = pngBuf.slice(0, pngBuf.lastIndexOf(Buffer.from('IEND')) + 8); // отрезаем выравнивающие нули после IEND
const png = PNG.sync.read(pngBuf);
const col = new Float32Array(pos.length);
for (let i = 0; i < pos.length / 3; i++) {
  const x = Math.min(png.width - 1, Math.max(0, Math.floor(uv[i * 2] * png.width)));
  const y = Math.min(png.height - 1, Math.max(0, Math.floor((1 - uv[i * 2 + 1]) * png.height)));
  const o = (y * png.width + x) * 4;
  col[i * 3] = png.data[o] / 255; col[i * 3 + 1] = png.data[o + 1] / 255; col[i * 3 + 2] = png.data[o + 2] / 255;
}

const res = processShell({ pos, uv, idx, col }, FIT);
console.log('вырезано по классам', JSON.stringify(res.stats.counts), '· мелких кусков треугольников:', res.stats.removedSmall, '· осталось', res.stats.keptTris, 'треугольников,', res.stats.verts, 'вершин');

// выталкивание из тела (голова + тело без рук): позиции и нормали из human.bin
let moved = 0;
try {
  const hj = JSON.parse(fs.readFileSync(path.join(OUT, 'human.json'), 'utf8'));
  const hb = fs.readFileSync(path.join(OUT, 'human.bin'));
  const view = (a, C) => new C(hb.buffer.slice(hb.byteOffset + a.off, hb.byteOffset + a.off + a.count * a.n * (C === Float32Array ? 4 : C === Uint8Array ? 1 : 4)));
  const parts = ['body', 'head'].map((n) => ({ pos: view(hj.parts[n].position, Float32Array), nor: view(hj.parts[n].normal, Float32Array), si: view(hj.parts[n].skinIndex, Uint8Array), sw: view(hj.parts[n].skinWeight, Uint8Array) }));
  const names = hj.bones.map((b) => b.name);
  const bp = [], bn = [];
  for (const p of parts) {
    for (let i = 0; i < p.pos.length / 3; i++) {
      // только туловище, ноги и голова: исключаем руки (шея и плечи остаются)
      let armW = 0;
      for (let k = 0; k < 4; k++) if (/^(upperArm|lowerArm|hand|thumb|index|middle|ring|pinky)/.test(names[p.si[i * 4 + k]])) armW += p.sw[i * 4 + k] / 255;
      if (armW > 0.35) continue;
      bp.push(p.pos[i * 3], p.pos[i * 3 + 1], p.pos[i * 3 + 2]); bn.push(p.nor[i * 3], p.nor[i * 3 + 1], p.nor[i * 3 + 2]);
    }
  }
  moved = pushOut(res.pos, { pos: Float32Array.from(bp), nor: Float32Array.from(bn) }, +(process.env.CLEAR ?? 0.008));
} catch (e) { console.warn('push-out пропущен:', e.message); }
console.log('вытолкнуто из тела вершин:', moved);

const nor = weldedNormals(res.pos, res.idx);

// запись: позиции/нормали/uv float32, индексы uint32
const chunks = []; let size = 0;
const add = (arr) => { const pad = (4 - (size % 4)) % 4; if (pad) { chunks.push(Buffer.alloc(pad)); size += pad; } const off = size; const b = Buffer.from(arr.buffer, arr.byteOffset, arr.byteLength); chunks.push(b); size += b.length; return off; };
const meta = {
  version: 1, verts: res.stats.verts, tris: res.stats.keptTris,
  position: add(res.pos), normal: add(nor), uv: add(res.uv), units: add(res.units), index: add(res.idx),
  fit: FIT,
};
fs.writeFileSync(path.join(OUT, 'shell.bin'), Buffer.concat(chunks));
fs.writeFileSync(path.join(OUT, 'shell.json'), JSON.stringify(meta));
// альбедо → JPEG (меньше размер)
fs.writeFileSync('.tmp/trellis/albedo.png', pngBuf);
execFileSync('python3', ['-I', '-c', `
from PIL import Image
im = Image.open('.tmp/trellis/albedo.png').convert('RGB')
im.save(${JSON.stringify(path.join(OUT, 'shell_albedo.jpg'))}, quality=92, optimize=True)
`]);
console.log(`shell.bin ${(size / 1e6).toFixed(2)} МБ · ${Date.now() - t0} мс`);
