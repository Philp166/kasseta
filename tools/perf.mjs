import { launch, openPage } from './lib.mjs';
const browser = await launch();
const { page, errors } = await openPage(browser, 'http://localhost:5173/?mode=game&nostart=1', { width: 960, height: 540 });
await page.waitForFunction('window.__ready === true', null, { timeout: 120000 });
const out = await page.evaluate(() => {
  const g = window.__game; g.stop();
  for (let i = 0; i < 60 * 4; i++) g.step(1 / 60, false); // волна
  const res = {};
  const time = (name, fn, n = 60) => { const t = performance.now(); for (let i = 0; i < n; i++) fn(); res[name] = +((performance.now() - t) / n).toFixed(3); };
  time('fullStep', () => g.step(1 / 60, false));
  time('player.update', () => g.player.update(1 / 60));
  time('manager.update', () => g.manager.update(1 / 60));
  time('enemies.update', () => { for (const c of g.combatants) if (c !== g.player) c.update(1 / 60); });
  time('pw.update', () => g.pw.update(1 / 60));
  time('char.update(all)', () => { for (const c of g.combatants) c.character.update(1 / 60); });
  time('char.springs(all)', () => { for (const c of g.combatants) c.character.springs.update(1 / 60); });
  time('char.animator(all)', () => { for (const c of g.combatants) c.character.animator.update(1 / 60); });
  time('hurt.update(all)', () => { for (const c of g.combatants) c.hurt.update(); });
  time('syncVisual', () => { for (const c of g.combatants) c.syncVisual(0.5); });
  res.combatants = g.combatants.length;
  return res;
});
console.log(JSON.stringify(out, null, 1));
await browser.close();
