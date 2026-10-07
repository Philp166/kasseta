// Серия поз: node tools/seq.mjs <out.png> '<js poseFn(k) как выражение>' <count> '<view json>' [tileW tileH cols] [pre-js]
import fs from 'node:fs';
import { launch, openPage } from './lib.mjs';
const [out, poseJs, count, viewJson, tw = '300', th = '520', cols = '', pre = '', url = 'http://localhost:5173/?mode=viewer'] = process.argv.slice(2);
const browser = await launch();
const { page, errors } = await openPage(browser, url, { width: 1000, height: 700 });
await page.waitForFunction('window.__ready === true', null, { timeout: 120000 });
if (pre) { const r = await page.evaluate(pre); if (r !== undefined) console.log('pre ->', JSON.stringify(r)); }
const t0 = Date.now();
const data = await page.evaluate(([js, n, view, w, h, c]) => {
  const fn = eval(js);
  return window.__v.sheetSeq(n, view, w, h, c || n, fn);
}, [poseJs, +count, JSON.parse(viewJson), +tw, +th, cols ? +cols : 0]);
fs.writeFileSync(out, Buffer.from(data.split(',')[1], 'base64'));
console.log('saved', out, 'errors:', errors.length, 'ms:', Date.now() - t0);
await browser.close();
