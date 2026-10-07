// Проверка игрового ядра в браузере: node tools/test-game.mjs [url]
import { launch, openPage } from './lib.mjs';
const url = process.argv[2] || 'http://localhost:5173/?mode=game&nostart=1';
const browser = await launch();
const { page, errors } = await openPage(browser, url, { width: 960, height: 540 });
await page.waitForFunction('window.__ready === true', null, { timeout: 120000 });
const out = await page.evaluate(() => {
  const g = window.__game;
  g.stop();
  const log = {};
  const p = g.player;
  const y0 = g.env.heightAt(p.position.x, p.position.z);
  log.spawn = { x: p.position.x, y: p.position.y, z: p.position.z, ground: y0 };
  // падение с высоты 4 м
  p.mover.teleport(p.position.clone().setY(y0 + 4));
  for (let i = 0; i < 90; i++) g.step(1 / 60, false);
  log.afterFall = { y: p.position.y, ground: g.env.heightAt(p.position.x, p.position.z), grounded: p.mover.grounded };
  // соответствие физики и рельефа в нескольких точках
  const diffs = [];
  for (const [x, z] of [[10, 5], [-20, 30], [40, -15], [-55, -42], [0, 0]]) {
    const gy = g.pw.groundY(x, z);
    diffs.push({ x, z, phys: gy, env: g.env.heightAt(x, z), d: gy === null ? null : +(gy - g.env.heightAt(x, z)).toFixed(3) });
  }
  log.diffs = diffs;
  // ходьба вперёд 3 секунды (клавиша W)
  const start = p.position.clone();
  g.input.keys.add('KeyW');
  for (let i = 0; i < 180; i++) g.step(1 / 60, false);
  g.input.keys.delete('KeyW');
  log.walk = { dx: p.position.x - start.x, dz: p.position.z - start.z, speed: p.speed, y: p.position.y, ground: g.env.heightAt(p.position.x, p.position.z) };
  // ход в сторону деревьев: упираемся ли в ствол
  const t = g.env.trees[0];
  p.mover.teleport(new g.player.position.constructor(t.x - 5, g.env.heightAt(t.x - 5, t.z) + 0.1, t.z));
  p.facing = Math.PI / 2;
  g.cam.yaw = Math.PI / 2;
  g.input.keys.add('KeyW');
  for (let i = 0; i < 200; i++) g.step(1 / 60, false);
  g.input.keys.delete('KeyW');
  log.tree = { treeX: t.x, treeZ: t.z, r: t.radius, x: p.position.x, z: p.position.z, dist: Math.hypot(p.position.x - t.x, p.position.z - t.z) };
  return log;
});
console.log(JSON.stringify(out, null, 1));
console.log('errors:', errors.length);
await browser.close();
