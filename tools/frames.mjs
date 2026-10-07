// Серия кадров игры: node tools/frames.mjs <outPrefix> '<setup js>' '<[время сек...]>' [w h]
// setup-js выполняется один раз и может вернуть функцию (dt)=>void, которую вызываем каждый шаг симуляции.
import fs from 'node:fs';
import { launch, openPage } from './lib.mjs';
const [prefix, setup, timesJson, w = '640', h = '400'] = process.argv.slice(2);
const times = JSON.parse(timesJson);
const browser = await launch();
const { page, errors } = await openPage(browser, 'http://localhost:5173/?mode=game&nostart=1', { width: +w, height: +h });
await page.waitForFunction('window.__ready === true', null, { timeout: 120000 });
const info = await page.evaluate(async ([setupJs]) => { const g = window.__game; g.stop(); const f = await eval(setupJs); window.__perStep = f || (() => {}); return 'ok'; }, [setup]);
console.log('setup', info);
let t = 0;
for (let i = 0; i < times.length; i++) {
  const target = times[i];
  const data = await page.evaluate(([from, to]) => {
    const g = window.__game;
    const n = Math.round((to - from) * 60);
    for (let k = 0; k < n; k++) { g.step(1 / 60, k === n - 1); window.__perStep(1 / 60); }
    return g.renderer.domElement.toDataURL('image/png');
  }, [t, target]);
  t = target;
  fs.writeFileSync(`${prefix}_${i}.png`, Buffer.from(data.split(',')[1], 'base64'));
}
console.log('frames', times.length, 'errors', errors.length);
await browser.close();
