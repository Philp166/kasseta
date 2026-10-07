// Ортографические виды внешней модели с сеткой: node tools/refortho.mjs <out.png> <front|side|back> cx cy halfH [w h step] [src]
import fs from 'node:fs';
import { launch, openPage } from './lib.mjs';
const [out, view, cx, cy, halfH, w = '900', h = '1100', step = '0.05', src = '/.tmp/trellis/ref.glb', pre = ''] = process.argv.slice(2);
const browser = await launch();
const { page, errors } = await openPage(browser, `http://localhost:5173/ref.html?src=${encodeURIComponent(src)}${process.env.REFQ ? '&' + process.env.REFQ : ''}`, { width: 900, height: 700 });
await page.waitForFunction('window.__ready === true', null, { timeout: 180000 });
if (pre) { const r = await page.evaluate(pre); if (r !== undefined) console.log('pre ->', JSON.stringify(r)); }
const lines = process.env.LINES ? JSON.parse(process.env.LINES) : [];
const data = await page.evaluate(([v, a, b, c, ww, hh, st, ln]) => window.__r.ortho(v, a, b, c, ww, hh, st, ln), [view, +cx, +cy, +halfH, +w, +h, +step, lines]);
fs.writeFileSync(out, Buffer.from(data.split(',')[1], 'base64'));
console.log('saved', out, 'errors', errors.length);
await browser.close();
