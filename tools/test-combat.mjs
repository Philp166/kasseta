// Проверка боя и ИИ: node tools/test-combat.mjs
import { launch, openPage } from './lib.mjs';
const browser = await launch();
const { page, errors } = await openPage(browser, 'http://localhost:5173/?mode=game', { width: 960, height: 540 });
await page.waitForFunction('window.__ready === true', null, { timeout: 120000 });
const out = await page.evaluate(async () => {
  const g = window.__game;
  g.stop();
  const log = [];
  const P = g.player;
  const t0 = performance.now();
  // 1) ждём первую волну
  for (let i = 0; i < 60 * 4; i++) g.step(1 / 60, false);
  log.push({ t: 'wave', wave: g.wave, enemies: g.aliveEnemies.length, simMs: Math.round(performance.now() - t0) });
  // 2) наблюдаем сближение
  const snap = () => g.aliveEnemies.map((e) => ({ s: e.stateName, d: +e.distanceTo(P).toFixed(1), hp: Math.round(e.dm.hp) }));
  for (let sec = 0; sec < 12; sec++) {
    for (let i = 0; i < 60; i++) g.step(1 / 60, false);
    log.push({ sec, player: { st: P.stateName, hp: Math.round(P.dm.hp) }, enemies: snap() });
  }
  // 3) игрок атакует ближайшего: поворачиваем к нему и бьём
  const nearest = () => g.aliveEnemies.sort((a, b) => a.distanceTo(P) - b.distanceTo(P))[0];
  let hits = 0, kills0 = g.kills;
  g.events.addEventListener('hit', (e) => { if (e.detail.attacker === P) hits++; });
  for (let n = 0; n < 40; n++) {
    const e = nearest();
    if (!e) break;
    // двигаемся к врагу
    const d = e.distanceTo(P);
    P.cam = P.cam; g.cam.yaw = Math.atan2(e.position.x - P.position.x, e.position.z - P.position.z);
    g.input.keys.delete('KeyW'); g.input.keys.delete('KeyJ');
    if (d > 2.3) g.input.keys.add('KeyW'); else g.input.keys.add('KeyJ');
    for (let i = 0; i < 20; i++) g.step(1 / 60, false);
    g.input.keys.delete('KeyJ');
    for (let i = 0; i < 8; i++) g.step(1 / 60, false);
  }
  g.input.keys.clear();
  log.push({ afterFight: { hits, kills: g.kills - kills0, playerHp: Math.round(P.dm.hp), alive: g.aliveEnemies.length, regions: Object.fromEntries(Object.entries(P.dm.region).map(([k, v]) => [k, Math.round(v)])), face: P.dm.faceStage, simMs: Math.round(performance.now() - t0) } });
  return log;
});
for (const l of out) console.log(JSON.stringify(l));
console.log('errors:', errors.length);
await browser.close();
