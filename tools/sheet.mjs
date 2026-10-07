// Лист ракурсов: node tools/sheet.mjs <out.png> '<json views>' [tileW tileH cols] [js перед съёмкой] [url]
// views — массив [азимут, высота, дистанция, высота цели, fov?]
import fs from 'node:fs';
import { launch, openPage } from './lib.mjs';
const [out, viewsJson, tw = '480', th = '720', cols = '', pre = '', url = 'http://localhost:5173/'] = process.argv.slice(2);
const views = JSON.parse(viewsJson);
const browser = await launch();
const { page, errors } = await openPage(browser, url, { width: 1000, height: 700 });
await page.waitForFunction('window.__ready === true', null, { timeout: 120000 });
if (pre) {
  const r = await page.evaluate(pre);
  if (r !== undefined) console.log('pre ->', JSON.stringify(r));
}
await page.waitForTimeout(400);
const data = await page.evaluate(([v, w, h, c]) => window.__v.sheet(v, w, h, c || v.length), [views, +tw, +th, cols ? +cols : 0]);
fs.writeFileSync(out, Buffer.from(data.split(',')[1], 'base64'));
console.log('saved', out, 'errors:', errors.length);
await browser.close();
