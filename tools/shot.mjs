// Использование: node tools/shot.mjs <out.png> [url] [js-выражение] [ширина] [высота]
import { launch, openPage } from './lib.mjs';
const [out = 'shot.png', url = 'http://localhost:5173/', js = '', w = '1280', h = '720'] = process.argv.slice(2);
const browser = await launch();
const { page, errors } = await openPage(browser, url, { width: +w, height: +h });
await page.waitForFunction('window.__ready === true', null, { timeout: 120000 }).catch((e) => console.log('not ready:', e.message));
if (js) {
  const r = await page.evaluate(js);
  if (r !== undefined) console.log('eval ->', JSON.stringify(r));
}
await page.waitForTimeout(300);
console.log('title:', await page.title());
await page.screenshot({ path: out });
console.log('saved', out, 'errors:', errors.length);
await browser.close();
