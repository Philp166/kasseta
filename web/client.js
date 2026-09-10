// ── сеть (прогресс хранится в комнате платформы) ──────────────────────────
const room = new URLSearchParams(location.search).get("room") || ("p-" + playerId());
function playerId() {
  const key = "hf:game:playerId";
  let id = localStorage.getItem(key);
  if (!id) { id = Math.random().toString(36).slice(2, 10); localStorage.setItem(key, id); }
  return id;
}
const PING = "__ping", PONG = "__pong";
let socket = null, retry = 0;
let progress = { unlocked: 1, stars: {}, kills: 0, bestCombo: 0, maxLevel: 20 };
try { const l = JSON.parse(localStorage.getItem("kasseta:progress") || "null"); if (l) progress = l; } catch {}

function connect() {
  const proto = location.protocol === "https:" ? "wss:" : "ws:";
  socket = new WebSocket(`${proto}//${location.host}/ws/${encodeURIComponent(room)}`);
  socket.addEventListener("open", () => { retry = 0; setStatus(""); send({ type: "join", playerId: playerId() }); });
  socket.addEventListener("message", (e) => {
    if (e.data === PONG) return;
    let msg; try { msg = JSON.parse(e.data); } catch { return; }
    if (msg.type === "state" && msg.view && msg.view.unlocked) {
      progress = { ...progress, ...msg.view };
      localStorage.setItem("kasseta:progress", JSON.stringify(progress));
      if (UI.levels.classList.contains("on")) buildLevelGrid();
    } else if (msg.type === "error") setStatus(msg.error, true);
  });
  socket.addEventListener("close", () => { retry = Math.min(retry + 1, 6); setTimeout(connect, 500 * 2 ** (retry - 1)); });
}
function send(msg) { if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify(msg)); }
setInterval(() => { if (socket?.readyState === WebSocket.OPEN) socket.send(PING); }, 30_000);
function setStatus(t, err = false) { const s = document.querySelector("#status"); s.textContent = t; s.classList.toggle("error", err); }

// ── DOM ────────────────────────────────────────────────────────────────────
const $ = (s) => document.querySelector(s);
const UI = { menu: $("#menu"), levels: $("#levels"), result: $("#result"), grid: $("#grid") };
const canvas = $("#c"), ctx = canvas.getContext("2d");
const W = 1280, H = 720;
function fit() {
  const k = Math.min(innerWidth / W, innerHeight / H);
  canvas.style.width = Math.floor(W * k) + "px"; canvas.style.height = Math.floor(H * k) + "px";
}
addEventListener("resize", fit); fit();

// ── ассеты ─────────────────────────────────────────────────────────────────
const sheets = {}; let sheetMeta = {};
const bg = { hills: null, ground: null, objs: {} };
const OBJ_NAMES = ["barn", "silo", "windmill", "house", "tree", "fence", "pole", "truck", "hay"];
const OBJ_H = { barn: 260, silo: 300, windmill: 330, house: 250, tree: 220, fence: 70, pole: 240, truck: 110, hay: 70 };
function img(src) { return new Promise((res) => { const i = new Image(); i.onload = () => res(i); i.onerror = () => res(null); i.src = src; }); }
async function loadAll() {
  sheetMeta = await (await fetch("/sprites/sheets.json")).json();
  await Promise.all(Object.keys(sheetMeta).map(async (n) => { sheets[n] = await img(`/sprites/${n}.webp`); }));
  bg.hills = await img("/bg/hills.webp"); bg.ground = await img("/bg/ground.webp");
  await Promise.all(OBJ_NAMES.map(async (n) => { bg.objs[n] = await img(`/bg/obj/${n}.webp`); }));
}
function anim(name) { return sheetMeta[name] ? { name, ...sheetMeta[name] } : null; }

// ── звук (синтез, без файлов) ──────────────────────────────────────────────
let AC = null;
function audio() { if (!AC) { try { AC = new (window.AudioContext || window.webkitAudioContext)(); } catch {} } if (AC && AC.state === "suspended") AC.resume(); }
function noise(dur, freq, q, gain) {
  if (!AC) return;
  const b = AC.createBuffer(1, AC.sampleRate * dur, AC.sampleRate); const d = b.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / d.length);
  const s = AC.createBufferSource(); s.buffer = b; const f = AC.createBiquadFilter(); f.type = "bandpass"; f.frequency.value = freq; f.Q.value = q;
  const g = AC.createGain(); g.gain.value = gain; s.connect(f); f.connect(g); g.connect(AC.destination); s.start();
}
function tone(f0, f1, dur, gain, type = "sine") {
  if (!AC) return;
  const o = AC.createOscillator(); o.type = type; const g = AC.createGain(); const t = AC.currentTime;
  o.frequency.setValueAtTime(f0, t); o.frequency.exponentialRampToValueAtTime(f1, t + dur);
  g.gain.setValueAtTime(gain, t); g.gain.exponentialRampToValueAtTime(0.001, t + dur);
  o.connect(g); g.connect(AC.destination); o.start(t); o.stop(t + dur);
}
const SFX = {
  whoosh: () => noise(0.18, 900, 1.2, 0.35),
  hit: () => { noise(0.12, 300, 0.8, 0.6); tone(140, 60, 0.14, 0.5); },
  heavy: () => { noise(0.25, 180, 0.7, 0.9); tone(90, 35, 0.3, 0.8, "triangle"); },
  splat: () => noise(0.22, 500, 0.5, 0.5),
  hurt: () => tone(220, 90, 0.25, 0.5, "square"),
  parry: () => { tone(1400, 2200, 0.12, 0.35); noise(0.08, 3000, 3, 0.2); },
  boom: () => { noise(0.6, 120, 0.5, 1.2); tone(70, 25, 0.6, 1, "sawtooth"); },
  win: () => { tone(440, 660, 0.15, 0.3); setTimeout(() => tone(660, 880, 0.25, 0.3), 140); },
  lose: () => tone(300, 60, 0.9, 0.5, "sawtooth"),
};

// ── мир ────────────────────────────────────────────────────────────────────
const ROAD_TOP = 560, FAR_Y = 600, NEAR_Y = 715, PLAYER_X = 430;
const laneY = (d) => FAR_Y + (NEAR_Y - FAR_Y) * d;
const laneK = (d) => 0.86 + 0.26 * d;

const KIND = {
  basic:   { hp: 60,  speed: 70,  dmg: 12, h: 280, reach: 95,  wind: 0.5, cd: 1.4, face: -1, death: "basic_death",   walk: "basic_walk" },
  runner:  { hp: 40,  speed: 175, dmg: 9,  h: 260, reach: 90,  wind: 0.32, cd: 1.0, face: -1, death: "runner_death",  walk: "runner_walk" },
  fat:     { hp: 200, speed: 45,  dmg: 22, h: 340, reach: 110, wind: 0.75, cd: 2.0, face: -1, death: "fat_death",    walk: "fat_walk" },
  spitter: { hp: 70,  speed: 60,  dmg: 8,  h: 285, reach: 95,  wind: 0.5, cd: 1.6, face: 1, death: "spitter_death", walk: "spitter_walk", ranged: true },
  bomber:  { hp: 50,  speed: 85,  dmg: 28, h: 290, reach: 130, wind: 0.8, cd: 9,   face: -1, death: "bomber_death",  walk: "bomber_walk", bomb: true },
};
const PLAYER_H = 300, MAX_HP = 100;
const LIGHT = { time: 0.32, hit: 0.13, range: 170, dmg: 30 };
const HEAVY = { hold: 0.35, time: 0.55, hit: 0.28, range: 240, dmg: 95, stun: 1.6 };
const DODGE_T = 0.42, PARRY_T = 0.28, COMBO_RESET = 2.2;

function mulberry(seed) { return () => { seed |= 0; seed = seed + 0x6d2b79f5 | 0; let t = Math.imul(seed ^ seed >>> 15, 1 | seed); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
function buildLevel(level) {
  const rnd = mulberry(1000 + level * 7919);
  const pool = ["basic", "runner"];
  if (level >= 4) pool.push("fat"); if (level >= 7) pool.push("spitter"); if (level >= 11) pool.push("bomber");
  const waves = [];
  const n = level % 10 === 0 ? 3 : 3 + Math.floor(level / 4);
  for (let w = 0; w < n; w++) {
    const size = 2 + Math.floor(rnd() * (2 + level / 5)) + (w === n - 1 ? 1 : 0);
    const list = [];
    for (let i = 0; i < size; i++) {
      let kind = pool[0];
      if (rnd() < 0.35 + level * 0.025) kind = pool[Math.floor(rnd() * pool.length)];
      list.push({ kind, side: rnd() < 0.7 ? 1 : -1, lane: 0.15 + rnd() * 0.7, delay: i * (0.25 + rnd() * 0.3) });
    }
    waves.push(list);
  }
  if (level % 10 === 0) waves.push([{ kind: "fat", side: 1, lane: 0.5, delay: 0, boss: true }]);
  return waves;
}

let G = null;   // состояние текущего уровня
function newGame(level) {
  G = {
    level, waves: buildLevel(level), wave: -1, phase: "walk", phaseT: 1.6, scroll: 0,
    p: { hp: MAX_HP, x: PLAYER_X, lane: 0.5, face: 1, st: "idle", t: 0, ft: 0, inv: 0, parry: 0, combo: 0, comboT: 0, holdT: 0, holding: false, holdDir: 1, dmgTaken: 0, dead: false, flash: 0 },
    z: [], shots: [], fx: [], nums: [], kills: 0, bestCombo: 0, hitstop: 0, shake: 0, time: 0, over: false, cam: 0,
    scatter: [], nextObj: -200, orng: mulberry(20260910 + level),
  };
  while (G.nextObj < 1700) spawnObj();
}
function spawnObj() {
  const n = OBJ_NAMES[Math.floor(G.orng() * OBJ_NAMES.length)];
  const h = OBJ_H[n] * (0.88 + G.orng() * 0.27);
  const im = bg.objs[n]; const w = im ? im.width * h / im.height : h;
  G.scatter.push({ n, x: G.nextObj, h, w });
  G.nextObj += w + 60 + G.orng() * 300;
}

function spawnZ(spec) {
  const k = KIND[spec.kind];
  const boss = !!spec.boss; const mult = boss ? 5.5 : 1 + G.level * 0.04;
  G.z.push({
    kind: spec.kind, k, hp: k.hp * mult, maxhp: k.hp * mult, x: spec.side > 0 ? W + 160 : -160, lane: spec.lane, side: spec.side,
    st: "walk", t: 0, ft: Math.random() * 10, cd: 0.8 + Math.random(), stun: 0, dead: false, flash: 0, dieT: 0, boss, scale: boss ? 1.45 : 1, fuse: -1,
  });
}

// ── ввод ───────────────────────────────────────────────────────────────────
let ptr = null;
function sideOf(px) { const r = canvas.getBoundingClientRect(); return (px - r.left) < r.width / 2 ? -1 : 1; }
canvas.addEventListener("pointerdown", (e) => {
  audio(); if (!G || G.over || G.p.dead) return;
  ptr = { x: e.clientX, y: e.clientY, t: performance.now(), dir: sideOf(e.clientX) };
  G.p.holding = true; G.p.holdT = 0; G.p.holdDir = ptr.dir;
});
addEventListener("pointerup", (e) => {
  if (!ptr || !G || G.over) { ptr = null; return; }
  const dx = e.clientX - ptr.x, dy = e.clientY - ptr.y, held = (performance.now() - ptr.t) / 1000;
  const p = G.p; p.holding = false;
  if (p.dead) { ptr = null; return; }
  if (dy > 60 && Math.abs(dy) > Math.abs(dx)) doDodge(ptr.dir);
  else if (Math.abs(dx) > 60) doParry(dx > 0 ? 1 : -1);
  else if (held >= HEAVY.hold && p.st === "windup") doHeavyRelease();
  else doLight(ptr.dir);
  ptr = null;
});
addEventListener("keydown", (e) => {
  if (!G || G.over || e.repeat) return; audio();
  if (e.code === "ArrowRight" || e.code === "Space") doLight(1);
  else if (e.code === "ArrowLeft") doLight(-1);
  else if (e.code === "KeyF") { G.p.holding = true; G.p.holdT = HEAVY.hold; G.p.holdDir = G.p.face; }
  else if (e.code === "KeyS" || e.code === "ArrowDown") doDodge(G.p.face);
  else if (e.code === "KeyD") doParry(1); else if (e.code === "KeyA") doParry(-1);
});
addEventListener("keyup", (e) => { if (G && e.code === "KeyF") { G.p.holding = false; if (G.p.st === "windup") doHeavyRelease(); } });

function busy(p) { return ["attack", "heavy", "hurt", "dead", "dodge"].includes(p.st); }
function setSt(p, st, t) { p.st = st; p.t = t; p.ft = 0; }
function doLight(dir) {
  const p = G.p; if (busy(p) || p.st === "windup") return;
  p.face = dir; setSt(p, "attack", LIGHT.time); p.hitDone = false; SFX.whoosh();
}
function doHeavyRelease() {
  const p = G.p; if (p.st !== "windup") return;
  setSt(p, "heavy", HEAVY.time); p.hitDone = false; SFX.whoosh();
}
function doDodge(dir) {
  const p = G.p; if (busy(p)) return;
  p.face = dir; setSt(p, "dodge", DODGE_T); p.inv = DODGE_T; p.dodgeDir = -dir;
}
function doParry(dir) {
  const p = G.p; if (busy(p) || p.st === "windup") return;
  p.face = dir; setSt(p, "parry", PARRY_T); p.parry = PARRY_T;
}

// ── обновление ─────────────────────────────────────────────────────────────
function hitZ(z, dmg, kx, stun) {
  if (z.dead) return;
  const p = G.p;
  if (z.stun > 0) dmg *= 1.6;
  z.hp -= dmg; z.flash = 0.12; z.x += kx; if (stun) z.stun = Math.max(z.stun, stun);
  p.combo++; p.comboT = COMBO_RESET; G.bestCombo = Math.max(G.bestCombo, p.combo);
  G.nums.push({ x: z.x, y: laneY(z.lane) - z.k.h * laneK(z.lane) * z.scale * 0.8, v: Math.round(dmg), t: 0.8, big: dmg > 60 });
  splat(z.x, laneY(z.lane) - 120, 8 + dmg / 8);
  if (z.hp <= 0) killZ(z);
}
function killZ(z) {
  if (z.dead) return; z.dead = true; z.st = "death"; z.t = 0; z.ft = 0; z.dieT = 0; G.kills++; SFX.splat();
  splat(z.x, laneY(z.lane) - 140, 22);
  if (z.k.bomb) explode(z.x, z.lane, false);
}
function splat(x, y, n) {
  for (let i = 0; i < n; i++) G.fx.push({ x, y, vx: (Math.random() - 0.5) * 520, vy: -Math.random() * 420 - 60, r: 3 + Math.random() * 7, t: 0.5 + Math.random() * 0.4, c: Math.random() < 0.7 ? "#6f9a2e" : "#3e5a1a" });
}
function explode(x, lane, hurtPlayer) {
  SFX.boom(); G.shake = Math.max(G.shake, 22); G.hitstop = Math.max(G.hitstop, 0.09);
  for (let i = 0; i < 40; i++) G.fx.push({ x, y: laneY(lane) - 120, vx: (Math.random() - 0.5) * 900, vy: -Math.random() * 700, r: 4 + Math.random() * 12, t: 0.5 + Math.random() * 0.5, c: i % 3 ? "#e8802c" : "#f5d76e" });
  for (const o of G.z) if (!o.dead && Math.abs(o.x - x) < 260 && Math.abs(o.lane - lane) < 0.5) { o.hp -= 120; o.flash = 0.15; o.x += Math.sign(o.x - x) * 90; if (o.hp <= 0) killZ(o); }
  const p = G.p;
  if (hurtPlayer && Math.abs(p.x - x) < 240 && Math.abs(p.lane - lane) < 0.5) hurtP(28, Math.sign(p.x - x) || 1);
}
function hurtP(dmg, from) {
  const p = G.p; if (p.inv > 0 || p.dead) return;
  p.hp -= dmg; p.dmgTaken += dmg; p.flash = 0.15; p.inv = 0.5; p.combo = 0; SFX.hurt(); G.shake = Math.max(G.shake, 12);
  setSt(p, "hurt", 0.35); p.x += -from * 30;
  if (p.hp <= 0) { p.hp = 0; p.dead = true; setSt(p, "dead", 9); setTimeout(() => finish(false), 1400); }
}

function update(dt) {
  if (!G || G.over) return;
  const p = G.p;
  if (G.hitstop > 0) { G.hitstop -= dt; dt *= 0.06; }
  G.time += dt; G.shake = Math.max(0, G.shake - dt * 60);
  if (p.inv > 0) p.inv -= dt; if (p.parry > 0) p.parry -= dt; if (p.flash > 0) p.flash -= dt;
  if (p.comboT > 0) { p.comboT -= dt; if (p.comboT <= 0) p.combo = 0; }

  // фазы: идём → волна → идём
  if (G.phase === "walk") {
    G.phaseT -= dt; G.scroll += dt * 260;
    if (G.phaseT <= 0) { G.wave++; if (G.wave >= G.waves.length) { finish(true); return; } G.phase = "wave"; G.spawnT = 0; G.spawnI = 0; }
  } else if (G.phase === "wave") {
    G.spawnT += dt; const list = G.waves[G.wave];
    while (G.spawnI < list.length && list[G.spawnI].delay <= G.spawnT) { spawnZ(list[G.spawnI]); G.spawnI++; }
    if (G.spawnI >= list.length && G.z.every((z) => z.dead)) { G.phase = "walk"; G.phaseT = 2.4; }
  }
  while (G.nextObj - G.scroll * 0.45 < 1700) spawnObj();
  G.scatter = G.scatter.filter((o) => o.x - G.scroll * 0.45 + o.w > -400);

  // дед
  const walking = G.phase === "walk" && !busy(p) && p.st !== "windup" && p.st !== "parry";
  if (p.holding && !busy(p) && p.st !== "windup") { p.holdT += dt; if (p.holdT >= HEAVY.hold) { p.face = p.holdDir; setSt(p, "windup", 9); } }
  if (p.st === "windup") { if (!p.holding) doHeavyRelease(); }
  if (p.t > 0 && p.st !== "windup") { p.t -= dt; if (p.t <= 0 && !p.dead) setSt(p, "idle", 0); }
  if (p.st === "dodge") p.x += p.dodgeDir * dt * 340;
  p.x += (PLAYER_X - p.x) * (p.st === "dodge" ? 0 : dt * 3);
  p.ft += dt * (walking ? 11 : 12);
  if (p.st === "attack" && !p.hitDone && p.t <= LIGHT.time - LIGHT.hit) {
    p.hitDone = true; let any = false;
    for (const z of G.z) {
      const dx = (z.x - p.x) * p.face; const reach = LIGHT.range * z.scale;
      if (!z.dead && dx > -20 && dx < reach && Math.abs(z.lane - p.lane) < 0.5) { hitZ(z, LIGHT.dmg, p.face * 26, 0); any = true; }
    }
    if (any) { SFX.hit(); G.hitstop = 0.05; G.shake = Math.max(G.shake, 4); }
  }
  if (p.st === "heavy" && !p.hitDone && p.t <= HEAVY.time - HEAVY.hit) {
    p.hitDone = true; let any = false;
    for (const z of G.z) {
      const dx = (z.x - p.x) * p.face; const reach = HEAVY.range * z.scale;
      if (!z.dead && dx > -40 && dx < reach && Math.abs(z.lane - p.lane) < 0.6) { hitZ(z, HEAVY.dmg, p.face * 110, HEAVY.stun); any = true; }
    }
    SFX.heavy(); G.shake = Math.max(G.shake, any ? 14 : 6); if (any) G.hitstop = 0.11;
  }
  // подшагивание по глубине к ближайшему зомби
  const near = G.z.filter((z) => !z.dead).sort((a, b) => Math.abs(a.x - p.x) - Math.abs(b.x - p.x))[0];
  if (near && !busy(p)) p.lane += (near.lane - p.lane) * Math.min(1, dt * 1.6);

  // зомби
  for (const z of G.z) {
    z.ft += dt * (z.st === "walk" ? 10 : 12); if (z.flash > 0) z.flash -= dt;
    if (z.dead) { z.dieT += dt; continue; }
    if (z.stun > 0) { z.stun -= dt; continue; }
    const dx = p.x - z.x, dist = Math.abs(dx), dir = Math.sign(dx) || 1;
    const reach = z.k.reach * z.scale + 30;
    if (z.k.ranged && dist > 260 && dist < 520 && z.cd <= 0) { z.st = "wind"; z.t = z.k.wind; z.cd = z.k.cd; z.shoot = true; }
    if (z.st === "wind") {
      z.t -= dt;
      if (z.t <= 0) {
        z.st = "walk";
        if (z.shoot) { z.shoot = false; G.shots.push({ x: z.x, y: laneY(z.lane) - 150, vx: dir * 520, lane: z.lane, t: 2 }); }
        else if (z.k.bomb) { explode(z.x, z.lane, true); z.hp = 0; killZ(z); }
        else if (Math.abs(p.x - z.x) < reach + 40 && Math.abs(p.lane - z.lane) < 0.5) {
          if (p.parry > 0 && p.face === -dir) { SFX.parry(); z.stun = 1.8; z.x += dir * -60; G.hitstop = 0.08; G.nums.push({ x: z.x, y: laneY(z.lane) - 260, v: "ПАРИ!", t: 0.9, big: true }); }
          else hurtP(z.k.dmg * (z.boss ? 1.6 : 1), dir);
        }
      }
      continue;
    }
    z.cd -= dt;
    if (dist > reach) { z.x += dir * z.k.speed * dt * (z.boss ? 0.8 : 1); if (Math.abs(z.lane - p.lane) > 0.05) z.lane += Math.sign(p.lane - z.lane) * dt * 0.25; }
    else if (z.cd <= 0 && !z.k.ranged) { z.st = "wind"; z.t = z.k.wind; z.cd = z.k.cd; if (z.k.bomb) z.fuse = z.k.wind; }
    // расталкивание
    for (const o of G.z) if (o !== z && !o.dead && Math.abs(o.x - z.x) < 70 && Math.abs(o.lane - z.lane) < 0.12) { z.x -= Math.sign(o.x - z.x) * dt * 60; z.lane += Math.sign(z.lane - o.lane || 1) * dt * 0.2; }
    z.lane = Math.max(0.02, Math.min(0.98, z.lane));
  }
  G.z = G.z.filter((z) => !z.dead || z.dieT < 2.2);
  // плевки
  for (const s of G.shots) {
    s.x += s.vx * dt; s.t -= dt;
    if (Math.abs(s.x - p.x) < 50 && Math.abs(s.lane - p.lane) < 0.35 && s.t > 0) {
      s.t = 0;
      if (p.parry > 0 && p.face === -Math.sign(s.vx)) { SFX.parry(); G.nums.push({ x: p.x, y: laneY(p.lane) - 280, v: "ПАРИ!", t: 0.8, big: true }); }
      else hurtP(8, Math.sign(s.vx));
    }
  }
  G.shots = G.shots.filter((s) => s.t > 0);
  for (const f of G.fx) { f.x += f.vx * dt; f.y += f.vy * dt; f.vy += 1400 * dt; f.t -= dt; }
  G.fx = G.fx.filter((f) => f.t > 0);
  for (const n of G.nums) { n.y -= dt * 70; n.t -= dt; }
  G.nums = G.nums.filter((n) => n.t > 0);
}

// ── отрисовка ──────────────────────────────────────────────────────────────
function drawSheet(a, frame, x, y, h, flip, alpha = 1, flash = 0) {
  const s = sheets[a.name]; if (!s) return;
  const f = ((frame % a.n) + a.n) % a.n; const w = a.w * h / a.h;
  ctx.save(); ctx.globalAlpha = alpha; ctx.translate(x, y); if (flip) ctx.scale(-1, 1);
  ctx.drawImage(s, f * a.w, 0, a.w, a.h, -w / 2, -h, w, h);
  if (flash > 0) { ctx.globalCompositeOperation = "source-atop"; ctx.globalAlpha = Math.min(1, flash * 7); ctx.fillStyle = "#fff"; ctx.fillRect(-w / 2, -h, w, h); }
  ctx.restore();
}
function drawTile(im, y, hpx, k, factor) {
  if (!im) return; const tw = im.width * k, th = im.height * k; const off = (G.scroll * factor) % tw;
  for (let x = -off - tw; x < W + tw; x += tw) ctx.drawImage(im, 0, 0, im.width, im.height, x, y, tw + 1, th);
}
function render() {
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  const sky = ctx.createLinearGradient(0, 0, 0, 600); sky.addColorStop(0, "#a4b9ba"); sky.addColorStop(1, "#9daaa1");
  ctx.fillStyle = sky; ctx.fillRect(0, 0, W, H);
  if (!G) return;
  if (G.shake > 0) ctx.translate((Math.random() - 0.5) * G.shake, (Math.random() - 0.5) * G.shake);
  if (bg.hills) drawTile(bg.hills, 545 - bg.hills.height * 0.5, 0, 0.5, 0.12);
  for (const o of G.scatter) { const im = bg.objs[o.n]; if (im) ctx.drawImage(im, o.x - G.scroll * 0.45, 506 - o.h, o.w, o.h); }
  if (bg.ground) { const k = 170 / 488; drawTile(bg.ground, ROAD_TOP - 193 * k, 0, k, 1.0); }

  // сущности по глубине
  const p = G.p;
  const ents = G.z.map((z) => ({ y: laneY(z.lane), z })); ents.push({ y: laneY(p.lane), p });
  ents.sort((a, b) => a.y - b.y);
  for (const e of ents) {
    if (e.z) {
      const z = e.z, k = laneK(z.lane) * z.scale, h = z.k.h * k, y = laneY(z.lane), x = z.x;
      // тень
      ctx.fillStyle = "rgba(0,0,0,0.22)"; ctx.beginPath(); ctx.ellipse(x, y, h * 0.22, h * 0.06, 0, 0, Math.PI * 2); ctx.fill();
      const dir = Math.sign(p.x - z.x) || 1; const flip = dir !== z.k.face;
      let a = anim(z.k.walk), fr = Math.floor(z.ft), alpha = 1;
      if (z.dead) { a = anim(z.k.death) || a; fr = Math.min(a.n - 1, Math.floor(z.dieT * 14)); alpha = z.dieT > 1.5 ? Math.max(0, 1 - (z.dieT - 1.5) / 0.7) : 1; }
      else if (z.stun > 0) { fr = 0; }
      else if (z.st === "wind") { fr = 0; }
      if (!a) { ctx.fillStyle = "#6a7a3a"; ctx.fillRect(x - 40, y - h, 80, h); }
      else {
        const lean = z.st === "wind" && !z.dead ? Math.sin((z.k.wind - z.t) / z.k.wind * Math.PI) * 18 * dir : (z.stun > 0 ? Math.sin(G.time * 30) * 4 : 0);
        ctx.save(); ctx.translate(lean, 0); drawSheet(a, fr, x, y, h, flip, alpha, z.flash + (z.st === "wind" && z.t < 0.18 ? 0.1 : 0)); ctx.restore();
      }
      if (z.stun > 0 && !z.dead) { ctx.fillStyle = "#f5d76e"; ctx.font = "900 26px Rubik"; ctx.textAlign = "center"; ctx.fillText("✱ ✱ ✱", x, y - h - 12); }
      if (z.k.bomb && z.st === "wind" && !z.dead) { ctx.fillStyle = `rgba(255,80,20,${0.35 + 0.35 * Math.sin(G.time * 40)})`; ctx.beginPath(); ctx.arc(x, y - h * 0.5, h * 0.55, 0, Math.PI * 2); ctx.fill(); }
      if (z.boss || z.hp < z.maxhp) { const bw = 90 * z.scale; ctx.fillStyle = "#222"; ctx.fillRect(x - bw / 2, y - h - 8, bw, 7); ctx.fillStyle = z.boss ? "#d9542b" : "#8fbf3a"; ctx.fillRect(x - bw / 2, y - h - 8, bw * Math.max(0, z.hp / z.maxhp), 7); }
    } else {
      const k = laneK(p.lane), h = PLAYER_H * k, y = laneY(p.lane), x = p.x;
      ctx.fillStyle = "rgba(0,0,0,0.25)"; ctx.beginPath(); ctx.ellipse(x, y, h * 0.2, h * 0.055, 0, 0, Math.PI * 2); ctx.fill();
      const walking = G.phase === "walk" && !busy(p) && p.st !== "windup" && p.st !== "parry";
      let a, fr; const flip = p.face < 0;
      if (p.dead) { a = anim("ded_death"); fr = a ? Math.min(a.n - 1, Math.floor((9 - p.t) * 14)) : 0; }
      else if (p.st === "attack") { a = anim("ded_attack"); fr = a ? Math.min(a.n - 1, Math.floor((LIGHT.time - p.t) / LIGHT.time * a.n)) : 0; }
      else if (p.st === "heavy") { a = anim("ded_heavy"); fr = a ? Math.min(a.n - 1, Math.floor((HEAVY.time - p.t) / HEAVY.time * a.n)) : 0; }
      else if (p.st === "windup") { a = anim("ded_heavy"); fr = 0; }
      else if (walking) { a = anim("ded_walk") || anim("ded_idle"); fr = Math.floor(p.ft); }
      else { a = anim("ded_idle"); fr = Math.floor(p.ft * 0.7); }
      const tilt = p.st === "dodge" ? -p.face * 0.25 : (p.st === "parry" ? p.face * 0.12 : 0);
      ctx.save(); ctx.translate(x, y); ctx.rotate(tilt); ctx.translate(-x, -y);
      if (a) drawSheet(a, fr, x, y, h, flip, p.st === "dodge" ? 0.6 : 1, p.flash);
      else { ctx.fillStyle = "#8a7a5a"; ctx.fillRect(x - 35, y - h, 70, h); }
      ctx.restore();
      if (p.st === "windup") { const r = 26 + Math.sin(G.time * 24) * 6; ctx.strokeStyle = "#f5d76e"; ctx.lineWidth = 5; ctx.beginPath(); ctx.arc(x + p.face * 60, y - h * 0.75, r, 0, Math.PI * 2); ctx.stroke(); }
      if (p.st === "parry") { ctx.strokeStyle = "rgba(255,255,255,0.8)"; ctx.lineWidth = 6; ctx.beginPath(); ctx.arc(x + p.face * 70, y - h * 0.5, 60, -1.2, 1.2); ctx.stroke(); }
      if (p.st === "attack" || p.st === "heavy") {
        const prog = p.st === "attack" ? 1 - p.t / LIGHT.time : 1 - p.t / HEAVY.time;
        if (prog > 0.25 && prog < 0.7) { const rr = p.st === "attack" ? 150 : 230; ctx.strokeStyle = "rgba(255,255,255,0.55)"; ctx.lineWidth = p.st === "attack" ? 10 : 18; ctx.beginPath(); ctx.arc(x + p.face * 20, y - h * 0.5, rr * k, p.face > 0 ? -1.4 : Math.PI - 0.2, p.face > 0 ? 0.2 : Math.PI + 1.4); ctx.stroke(); }
      }
    }
  }
  for (const s of G.shots) { ctx.fillStyle = "#8fd13a"; ctx.beginPath(); ctx.arc(s.x, s.y, 12, 0, Math.PI * 2); ctx.fill(); ctx.fillStyle = "#4b7a1a"; ctx.beginPath(); ctx.arc(s.x - Math.sign(s.vx) * 10, s.y + 4, 7, 0, Math.PI * 2); ctx.fill(); }
  for (const f of G.fx) { ctx.globalAlpha = Math.min(1, f.t * 2); ctx.fillStyle = f.c; ctx.beginPath(); ctx.arc(f.x, f.y, f.r, 0, Math.PI * 2); ctx.fill(); }
  ctx.globalAlpha = 1;
  for (const n of G.nums) { ctx.font = `900 ${n.big ? 44 : 30}px Rubik`; ctx.textAlign = "center"; ctx.lineWidth = 6; ctx.strokeStyle = "#17181c"; ctx.fillStyle = n.big ? "#f5d76e" : "#fff"; ctx.globalAlpha = Math.min(1, n.t * 2); ctx.strokeText(n.v, n.x, n.y); ctx.fillText(n.v, n.x, n.y); }
  ctx.globalAlpha = 1;
  drawHUD();
}
function drawHUD() {
  const p = G.p; ctx.setTransform(1, 0, 0, 1, 0, 0);
  // HP
  ctx.fillStyle = "rgba(20,20,24,0.75)"; roundRect(22, 22, 330, 30, 8); ctx.fill();
  ctx.fillStyle = "#c93b2e"; roundRect(26, 26, 322 * Math.max(0, p.hp / MAX_HP), 22, 6); ctx.fill();
  ctx.font = "900 16px Rubik"; ctx.fillStyle = "#fff"; ctx.textAlign = "left"; ctx.fillText(`ДЕД  ${Math.ceil(p.hp)}`, 34, 43);
  // уровень / волна
  ctx.textAlign = "right"; ctx.font = "900 22px Rubik"; ctx.fillStyle = "#e9dfc7"; ctx.lineWidth = 5; ctx.strokeStyle = "#17181c";
  const wave = Math.max(0, G.wave) + 1; const txt = G.level % 10 === 0 && G.wave === G.waves.length - 1 ? "БОСС" : `ВОЛНА ${Math.min(wave, G.waves.length)}/${G.waves.length}`;
  ctx.strokeText(`УРОВЕНЬ ${G.level}   ${txt}`, W - 24, 44); ctx.fillText(`УРОВЕНЬ ${G.level}   ${txt}`, W - 24, 44);
  ctx.font = "700 16px Rubik"; ctx.fillStyle = "#c8b14a"; ctx.strokeText(`УБИТО ${G.kills}`, W - 24, 68); ctx.fillText(`УБИТО ${G.kills}`, W - 24, 68);
  if (p.combo >= 2) { const s = 1 + Math.min(0.6, p.combo * 0.04); ctx.save(); ctx.translate(W / 2, 90); ctx.scale(s, s); ctx.textAlign = "center"; ctx.font = "400 44px 'Rubik Wet Paint'"; ctx.lineWidth = 7; ctx.strokeStyle = "#17181c"; ctx.fillStyle = p.combo >= 10 ? "#d9542b" : "#f5d76e"; ctx.strokeText(`КОМБО ×${p.combo}`, 0, 0); ctx.fillText(`КОМБО ×${p.combo}`, 0, 0); ctx.restore(); }
  if (G.phase === "walk" && G.wave < G.waves.length - 1 && G.phaseT > 0.4) { ctx.textAlign = "center"; ctx.font = "700 20px Rubik"; ctx.fillStyle = "rgba(233,223,199,0.85)"; ctx.fillText(G.wave < 0 ? "Идём…" : "Дальше…", W / 2, 640); }
  if (p.flash > 0) { ctx.fillStyle = `rgba(200,40,30,${p.flash * 2})`; ctx.fillRect(0, 0, W, H); }
}
function roundRect(x, y, w, h, r) { ctx.beginPath(); ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r); ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath(); }

// ── экраны ─────────────────────────────────────────────────────────────────
function show(el) { for (const k of ["menu", "levels", "result"]) UI[k].classList.toggle("on", UI[k] === el); }
function startLevel(l) { newGame(l); show(null); }
function finish(won) {
  if (!G || G.over) return; G.over = true;
  const p = G.p; let stars = 0;
  if (won) { stars = 1; if (p.dmgTaken < MAX_HP * 0.7) stars = 2; if (p.dmgTaken < MAX_HP * 0.3) stars = 3; SFX.win(); } else SFX.lose();
  send({ type: "action", action: { type: "level_result", level: G.level, stars, kills: Math.min(200, G.kills), combo: Math.min(500, G.bestCombo) } });
  if (won) { progress.unlocked = Math.max(progress.unlocked, Math.min(20, G.level + 1)); progress.stars[String(G.level)] = Math.max(progress.stars[String(G.level)] || 0, stars); }
  progress.kills += G.kills; progress.bestCombo = Math.max(progress.bestCombo, G.bestCombo); localStorage.setItem("kasseta:progress", JSON.stringify(progress));
  $("#r-title").textContent = won ? (G.level === 20 ? "Кассета почти рядом" : "Уровень пройден") : "Деда съели";
  $("#r-stars").innerHTML = [1, 2, 3].map((i) => `<span class="${i <= stars ? "" : "off"}">★</span>`).join("");
  $("#r-kills").textContent = G.kills; $("#r-combo").textContent = G.bestCombo; $("#r-dmg").textContent = Math.round(p.dmgTaken);
  $("#r-next").style.display = won && G.level < 20 ? "" : "none";
  setTimeout(() => show(UI.result), won ? 700 : 300);
}
function buildLevelGrid() {
  $("#s-kills").textContent = progress.kills; $("#s-combo").textContent = progress.bestCombo;
  UI.grid.innerHTML = "";
  for (let l = 1; l <= 20; l++) {
    const d = document.createElement("div"); const st = progress.stars[String(l)] || 0;
    d.className = "lv" + (st ? " done" : "") + (l > progress.unlocked ? " locked" : "") + (l % 10 === 0 ? " boss" : "");
    d.textContent = l; if (st) { const s = document.createElement("small"); s.textContent = "★".repeat(st); d.append(s); }
    if (l <= progress.unlocked) d.addEventListener("click", () => { audio(); startLevel(l); });
    UI.grid.append(d);
  }
}
$("#play").addEventListener("click", () => { audio(); startLevel(Math.min(20, progress.unlocked)); });
$("#pick").addEventListener("click", () => { buildLevelGrid(); show(UI.levels); });
$("#back").addEventListener("click", () => show(UI.menu));
$("#r-next").addEventListener("click", () => startLevel(Math.min(20, G.level + 1)));
$("#r-retry").addEventListener("click", () => startLevel(G.level));
$("#r-menu").addEventListener("click", () => { G = null; show(UI.menu); });

// ── цикл ───────────────────────────────────────────────────────────────────
let last = performance.now();
function loop(now) { const dt = Math.min(0.05, (now - last) / 1000); last = now; update(dt); render(); requestAnimationFrame(loop); }
loadAll().then(() => { requestAnimationFrame(loop); });
connect();
