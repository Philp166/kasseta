// Лист ракурсов внешней модели: node tools/refsheet.mjs <out.png> '<views json>' [tw th cols] [src] [pre-js]
import fs from 'node:fs';
import { launch, openPage } from './lib.mjs';
const [out, viewsJson, tw = '420', th = '640', cols = '', src = '/.tmp/trellis/ref.glb', pre = ''] = process.argv.slice(2);
const browser = await launch();
const { page, errors } = await openPage(browser, `http://localhost:5173/ref.html?src=${encodeURIComponent(src)}${process.env.REFQ ? '&' + process.env.REFQ : ''}`, { width: 900, height: 700 });
await page.waitForFunction('window.__ready === true', null, { timeout: 180000 });
if (pre) { const r = await page.evaluate(pre); if (r !== undefined) console.log('pre ->', JSON.stringify(r)); }
const data = await page.evaluate(([v, w, h, c]) => window.__r.sheet(v, w, h, c || v.length), [JSON.parse(viewsJson), +tw, +th, cols ? +cols : 0]);
fs.writeFileSync(out, Buffer.from(data.split(',')[1], 'base64'));
console.log('saved', out, 'errors:', errors.length);
await browser.close();
