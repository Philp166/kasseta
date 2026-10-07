// Интерфейс: HUD (здоровье, выносливость, силуэт повреждений, волна, оружие), полоски врагов, надписи,
// экран смерти, подсказки, стартовый экран и виртуальные кнопки для сенсорных экранов. Чистый DOM, без зависимостей.

import * as THREE from 'three';
import type { Game } from './game';
import { Enemy } from './enemy';
import { REGIONS, Region } from '../character/regions';

const CSS = `
.ew-root{position:fixed;inset:0;pointer-events:none;font-family:"Segoe UI",Roboto,system-ui,sans-serif;color:#e8e2d6;user-select:none;-webkit-user-select:none;z-index:5}
.ew-root *{box-sizing:border-box}
.ew-panel{background:rgba(9,11,13,.58);border:1px solid rgba(232,226,214,.14);backdrop-filter:blur(3px);border-radius:3px}
.ew-tl{position:absolute;left:max(16px,env(safe-area-inset-left));top:max(14px,env(safe-area-inset-top));width:min(300px,52vw);padding:10px 12px}
.ew-lbl{font-size:10px;letter-spacing:.16em;text-transform:uppercase;color:#b9ad96;display:flex;justify-content:space-between;margin-bottom:3px}
.ew-bar{height:9px;background:rgba(0,0,0,.55);border:1px solid rgba(232,226,214,.12);position:relative;overflow:hidden;margin-bottom:8px}
.ew-bar>i{position:absolute;inset:0 auto 0 0;width:100%;display:block;transition:width .12s linear}
.ew-hp>i{background:linear-gradient(90deg,#7d1616,#c0322b)}
.ew-hp>b{position:absolute;inset:0 auto 0 0;display:block;background:rgba(255,255,255,.35);transition:width .6s ease .25s}
.ew-st>i{background:linear-gradient(90deg,#8a7a2a,#cdb85a)}
.ew-bl{position:absolute;left:max(16px,env(safe-area-inset-left));bottom:max(16px,env(safe-area-inset-bottom));padding:8px 10px;display:flex;gap:10px;align-items:center}
.ew-bl svg{width:46px;height:92px}
.ew-bl .t{font-size:10px;letter-spacing:.12em;text-transform:uppercase;color:#b9ad96;line-height:1.7}
.ew-tc{position:absolute;left:50%;top:max(12px,env(safe-area-inset-top));transform:translateX(-50%);padding:6px 16px;text-align:center}
.ew-tc .w{font-size:12px;letter-spacing:.3em;text-transform:uppercase;color:#d9c9a3}
.ew-tc .s{font-size:11px;color:#9d927f;margin-top:2px}
.ew-br{position:absolute;right:max(16px,env(safe-area-inset-right));bottom:max(16px,env(safe-area-inset-bottom));padding:8px 12px;text-align:right}
.ew-br .wp{font-size:13px;letter-spacing:.2em;text-transform:uppercase;color:#e0d2ae}
.ew-br .k{font-size:10px;color:#9d927f;margin-top:3px;letter-spacing:.08em}
.ew-msg{position:absolute;left:50%;top:30%;transform:translate(-50%,-50%);font-size:clamp(20px,3.6vw,38px);letter-spacing:.34em;text-transform:uppercase;color:#e6d9b8;text-shadow:0 2px 14px rgba(0,0,0,.9);opacity:0;transition:opacity .35s;text-align:center;white-space:nowrap}
.ew-cross{position:absolute;left:50%;top:50%;width:26px;height:26px;margin:-13px 0 0 -13px;opacity:0;transition:opacity .15s}
.ew-cross:before,.ew-cross:after{content:"";position:absolute;background:rgba(240,230,205,.85)}
.ew-cross:before{left:12px;top:0;width:2px;height:26px;clip-path:polygon(0 0,100% 0,100% 40%,0 40%,0 60%,100% 60%,100% 100%,0 100%)}
.ew-cross:after{top:12px;left:0;height:2px;width:26px;clip-path:polygon(0 0,40% 0,40% 100%,0 100%,60% 100%,60% 0,100% 0,100% 100%)}
.ew-vig{position:absolute;inset:0;background:radial-gradient(ellipse at center,rgba(0,0,0,0) 45%,rgba(110,8,8,.0) 70%,rgba(110,8,8,.0) 100%);opacity:1;transition:none}
.ew-flash{position:absolute;inset:0;background:rgba(150,12,12,.0)}
.ew-en{position:absolute;width:54px;height:6px;margin:-3px 0 0 -27px;background:rgba(0,0,0,.6);border:1px solid rgba(232,226,214,.2);display:none}
.ew-en i{display:block;height:100%;background:#b83a30}
.ew-lock{position:absolute;width:26px;height:26px;margin:-13px 0 0 -13px;border:2px solid rgba(235,214,150,.9);transform:rotate(45deg);display:none}
.ew-dead{position:absolute;inset:0;display:none;align-items:center;justify-content:center;flex-direction:column;background:radial-gradient(ellipse at center,rgba(0,0,0,.35),rgba(0,0,0,.82));text-align:center;pointer-events:auto}
.ew-dead h1{font-weight:300;font-size:clamp(20px,4vw,44px);letter-spacing:.18em;text-transform:uppercase;color:#e4d6b6;margin:0 24px 18px;line-height:1.35}
.ew-dead p{font-size:12px;letter-spacing:.25em;text-transform:uppercase;color:#a99d85;margin:4px}
.ew-start{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;background:rgba(5,7,9,.72);pointer-events:auto;cursor:pointer;z-index:9}
.ew-start .card{max-width:640px;padding:26px 30px;text-align:center}
.ew-start h2{font-weight:300;letter-spacing:.3em;text-transform:uppercase;font-size:clamp(20px,3vw,30px);margin:0 0 4px;color:#e6d9b8}
.ew-start .sub{font-size:11px;letter-spacing:.3em;text-transform:uppercase;color:#a99d85;margin-bottom:16px}
.ew-start table{margin:0 auto 14px;border-collapse:collapse;font-size:12px;color:#cfc5b0;text-align:left}
.ew-start td{padding:3px 12px}
.ew-start td:first-child{color:#e0c98f;white-space:nowrap}
.ew-start .go{display:inline-block;margin-top:6px;padding:9px 26px;border:1px solid rgba(232,226,214,.4);letter-spacing:.3em;text-transform:uppercase;font-size:12px;color:#f0e6cc}
.ew-help{position:absolute;right:max(16px,env(safe-area-inset-right));top:max(14px,env(safe-area-inset-top));padding:8px 10px;font-size:10.5px;color:#a99d85;letter-spacing:.06em;line-height:1.7;display:none}
.ew-touch{position:absolute;inset:0;display:none}
.ew-touch .joy{position:absolute;left:max(22px,env(safe-area-inset-left));bottom:max(30px,env(safe-area-inset-bottom));width:132px;height:132px;border-radius:50%;background:rgba(10,12,14,.35);border:1px solid rgba(232,226,214,.25);pointer-events:auto;touch-action:none}
.ew-touch .joy i{position:absolute;left:50%;top:50%;width:54px;height:54px;margin:-27px 0 0 -27px;border-radius:50%;background:rgba(232,226,214,.28);border:1px solid rgba(232,226,214,.5)}
.ew-touch .b{position:absolute;width:62px;height:62px;border-radius:50%;background:rgba(10,12,14,.45);border:1px solid rgba(232,226,214,.35);color:#eadfc3;display:flex;align-items:center;justify-content:center;font-size:11px;letter-spacing:.08em;pointer-events:auto;touch-action:none}
.ew-touch .b.on{background:rgba(180,120,50,.5)}
.ew-look{position:absolute;right:0;top:0;width:50%;height:60%;pointer-events:auto;touch-action:none}
`;

const KEYS: [string, string][] = [
  ['W A S D', 'движение'], ['Shift', 'спринт'], ['ЛКМ / J', 'удар копьём (удержать — тяжёлый)'], ['ПКМ / K', 'блок (в начале — парирование)'],
  ['Пробел', 'перекат (неуязвимость)'], ['Q', 'сменить оружие: копьё ↔ лук'], ['Лук: ЛКМ', 'держать — натягивать, отпустить — выстрел'],
  ['Tab', 'захват цели'], ['C', 'идти шагом'], ['`  /  F1', 'панель отладки'], ['H', 'подсказки'], ['R', 'подняться после смерти'],
];

const REGION_PATHS: Record<Region, string> = {
  head: '<circle cx="23" cy="9" r="7"/>',
  torso: '<path d="M14 18h18l2 30H12z"/>',
  armL: '<path d="M33 19l7 3-2 28h-5z"/>',
  armR: '<path d="M13 19l-7 3 2 28h5z"/>',
  legL: '<path d="M23 48h11l-1 40h-8z"/>',
  legR: '<path d="M12 48h11l-1 40h-8z"/>',
};

function lerpColor(f: number): string {
  // 0 — цел (серо-зелёный), 0.5 — жёлто-оранжевый, 1 — тёмно-красный
  const stops = [[78, 118, 82], [196, 170, 70], [190, 70, 44], [92, 10, 12]];
  const x = Math.min(0.999, Math.max(0, f)) * 3;
  const i = Math.floor(x), t = x - i;
  const a = stops[i], b = stops[i + 1];
  return `rgb(${Math.round(a[0] + (b[0] - a[0]) * t)},${Math.round(a[1] + (b[1] - a[1]) * t)},${Math.round(a[2] + (b[2] - a[2]) * t)})`;
}

export class UI {
  readonly root = document.createElement('div');
  private el: Record<string, HTMLElement> = {};
  private regionEls = new Map<Region, SVGElement>();
  private enemyBars = new Map<Enemy, { box: HTMLElement; fill: HTMLElement; t: number }>();
  private flash = 0;
  private vigPulse = 0;
  private msgT = 0;
  private lastHp = 100;
  private started = false;
  private lockSeen = false;
  private joy ={ id: -1, cx: 0, cy: 0 };
  private lookTouch = { id: -1, x: 0, y: 0 };
  helpOn = false;

  constructor(private game: Game) {
    const style = document.createElement('style');
    style.textContent = CSS;
    document.head.appendChild(style);
    this.root.className = 'ew-root';
    this.root.innerHTML = `
      <div class="ew-vig"></div><div class="ew-flash"></div>
      <div class="ew-panel ew-tl">
        <div class="ew-lbl"><span>Здоровье</span><span class="hpn">100</span></div>
        <div class="ew-bar ew-hp"><b></b><i></i></div>
        <div class="ew-lbl"><span>Выносливость</span></div>
        <div class="ew-bar ew-st" style="margin-bottom:0"><i></i></div>
      </div>
      <div class="ew-panel ew-tc"><div class="w">Волна 1</div><div class="s"></div></div>
      <div class="ew-panel ew-bl">
        <svg viewBox="0 0 46 92" fill="#4e7652" stroke="rgba(0,0,0,.55)" stroke-width="1">${REGIONS.map((r) => `<g data-r="${r}">${REGION_PATHS[r]}</g>`).join('')}</svg>
        <div class="t"><div>Лицо: <span class="fs">1</span> / 4</div><div>Шаг: <span class="gait">обычный</span></div><div>Убито: <span class="kl">0</span></div></div>
      </div>
      <div class="ew-panel ew-br"><div class="wp">Копьё</div><div class="k">Q — сменить · H — подсказки</div></div>
      <div class="ew-msg"></div>
      <div class="ew-cross"></div>
      <div class="ew-lock"></div>
      <div class="ew-panel ew-help">${KEYS.map(([k, v]) => `<div><b style="color:#e0c98f">${k}</b> — ${v}</div>`).join('')}</div>
      <div class="ew-dead"><h1>Слабость — не проблема.<br/>Главное — встать.</h1><p>R — подняться</p></div>
      <div class="ew-touch">
        <div class="ew-look"></div>
        <div class="joy"><i></i></div>
        <div class="b" data-a="attack" style="right:26px;bottom:110px">Удар</div>
        <div class="b" data-a="block" style="right:100px;bottom:70px">Блок</div>
        <div class="b" data-a="dodge" style="right:26px;bottom:34px">Рывок</div>
        <div class="b" data-a="swap" style="right:104px;bottom:150px;width:50px;height:50px">Q</div>
        <div class="b" data-a="sprint" style="left:170px;bottom:34px;width:50px;height:50px">Бег</div>
      </div>
      <div class="ew-start"><div class="ew-panel card">
        <h2 class="ttl">Эвенкийский воин</h2><div class="sub">Древний Север · Тайга · Выживание</div>
        <table>${KEYS.slice(0, 8).map(([k, v]) => `<tr><td>${k}</td><td>${v}</td></tr>`).join('')}</table>
        <div class="go">Нажми, чтобы начать</div>
      </div></div>`;
    document.body.appendChild(this.root);
    const q = (s: string) => this.root.querySelector(s) as HTMLElement;
    this.el = {
      hp: q('.ew-hp > i'), hpGhost: q('.ew-hp > b'), st: q('.ew-st > i'), hpn: q('.hpn'), wave: q('.ew-tc .w'), sub: q('.ew-tc .s'),
      wp: q('.ew-br .wp'), msg: q('.ew-msg'), cross: q('.ew-cross'), lock: q('.ew-lock'), dead: q('.ew-dead'), start: q('.ew-start'),
      help: q('.ew-help'), fs: q('.fs'), gait: q('.gait'), kl: q('.kl'), vig: q('.ew-vig'), flash: q('.ew-flash'), touch: q('.ew-touch'),
      joy: q('.joy'), look: q('.ew-look'), ttl: q('.ew-start .ttl'), go: q('.ew-start .go'),
    };
    this.root.querySelectorAll('svg g').forEach((g) => this.regionEls.set((g as SVGElement).dataset.r as Region, g as SVGElement));
    this.el.start.addEventListener('click', () => this.begin());
    this.el.start.addEventListener('touchend', (e) => { e.preventDefault(); this.begin(); });
    // события игры
    game.events.addEventListener('announce', (e) => this.say((e as CustomEvent).detail));
    game.events.addEventListener('hit', (e) => {
      const d = (e as CustomEvent).detail;
      if (d.victim === game.player && !d.res.blocked) { this.flash = Math.min(0.75, 0.25 + d.res.dealt / 40); }
    });
    game.events.addEventListener('playerdead', () => { this.el.dead.style.display = 'flex'; });
    this.setupTouch();
    window.addEventListener('keydown', (e) => { if (e.code === 'KeyH') this.toggleHelp(); });
    // Esc (потеря захвата мыши) = пауза; срабатывает только если захват до этого был получен
    document.addEventListener('pointerlockchange', () => {
      if (document.pointerLockElement) { this.lockSeen = true; return; }
      if (this.started && this.lockSeen && game.mode === 'play') this.pauseMenu();
    });
    // не показывать стартовый экран в тестах (параметр ?nostart=1)
    if (new URLSearchParams(location.search).has('nostart')) this.begin(true);
    else game.pause();
  }

  begin(silent = false): void {
    this.started = true;
    this.el.start.style.display = 'none';
    if (!silent) this.game.input.requestLock();
    this.game.resume();
  }

  private pauseMenu(): void {
    this.started = false;
    this.game.pause();
    this.el.ttl.textContent = 'Пауза';
    this.el.go.textContent = 'Нажми, чтобы продолжить';
    this.el.start.style.display = 'flex';
  }

  toggleHelp(): void {
    this.helpOn = !this.helpOn;
    this.el.help.style.display = this.helpOn ? 'block' : 'none';
  }

  say(text: string): void {
    this.el.msg.textContent = text;
    this.el.msg.style.opacity = '1';
    this.msgT = 2.2;
  }

  // ---------- Сенсорное управление ----------

  private setupTouch(): void {
    const coarse = matchMedia('(pointer: coarse)').matches || new URLSearchParams(location.search).has('touch');
    if (!coarse) return;
    this.el.touch.style.display = 'block';
    const inp = this.game.input;
    const joy = this.el.joy;
    const knob = joy.querySelector('i') as HTMLElement;
    joy.addEventListener('pointerdown', (e) => {
      joy.setPointerCapture(e.pointerId);
      const r = joy.getBoundingClientRect();
      this.joy = { id: e.pointerId, cx: r.left + r.width / 2, cy: r.top + r.height / 2 };
    });
    joy.addEventListener('pointermove', (e) => {
      if (e.pointerId !== this.joy.id) return;
      const dx = (e.clientX - this.joy.cx) / 56, dy = (e.clientY - this.joy.cy) / 56;
      const l = Math.hypot(dx, dy) || 1, k = Math.min(1, l) / l;
      inp.setVirtualMove(dx * k, -dy * k);
      knob.style.transform = `translate(${dx * k * 38}px,${dy * k * 38}px)`;
    });
    const end = (e: PointerEvent) => { if (e.pointerId === this.joy.id) { this.joy.id = -1; inp.setVirtualMove(0, 0); knob.style.transform = ''; } };
    joy.addEventListener('pointerup', end);
    joy.addEventListener('pointercancel', end);
    this.el.touch.querySelectorAll('.b').forEach((b) => {
      const a = (b as HTMLElement).dataset.a as 'attack' | 'block' | 'dodge' | 'swap' | 'sprint';
      b.addEventListener('pointerdown', (e) => { (b as HTMLElement).setPointerCapture((e as PointerEvent).pointerId); inp.setVirtual(a, true); b.classList.add('on'); });
      const up = () => { inp.setVirtual(a, false); b.classList.remove('on'); };
      b.addEventListener('pointerup', up);
      b.addEventListener('pointercancel', up);
    });
    const look = this.el.look;
    look.addEventListener('pointerdown', (e) => { look.setPointerCapture(e.pointerId); this.lookTouch = { id: e.pointerId, x: e.clientX, y: e.clientY }; });
    look.addEventListener('pointermove', (e) => {
      if (e.pointerId !== this.lookTouch.id) return;
      inp.addVirtualLook((e.clientX - this.lookTouch.x) * 0.006, (e.clientY - this.lookTouch.y) * 0.005);
      this.lookTouch.x = e.clientX; this.lookTouch.y = e.clientY;
    });
    look.addEventListener('pointerup', () => { this.lookTouch.id = -1; });
  }

  // ---------- Покадровое обновление ----------

  update(dt: number): void {
    const g = this.game;
    const p = g.player;
    const hp = p.dm.health;
    (this.el.hp as HTMLElement).style.width = `${hp * 100}%`;
    (this.el.hpGhost as HTMLElement).style.width = `${Math.max(hp, 0) * 100}%`;
    this.el.hpn.textContent = String(Math.max(0, Math.round(p.dm.hp)));
    (this.el.st as HTMLElement).style.width = `${(p.stamina / p.maxStamina) * 100}%`;
    this.el.wave.textContent = `Волна ${Math.max(1, g.wave)}`;
    const alive = g.aliveEnemies.length;
    this.el.sub.textContent = alive > 0 ? `Врагов: ${alive}` : g.mode === 'play' ? 'Следующая волна…' : '';
    this.el.wp.textContent = g.player.character.carry === 'bow' ? 'Лук' : 'Копьё';
    this.el.fs.textContent = String(p.dm.faceStage);
    this.el.kl.textContent = String(g.kills);
    const lim = p.dm.limp;
    this.el.gait.textContent = lim.level > 0.2 ? 'хромота' : p.dm.hurt > 0.35 ? 'тяжёлый' : 'обычный';
    for (const r of REGIONS) this.regionEls.get(r)?.setAttribute('fill', lerpColor(p.dm.frac(r)));
    // надпись
    if (this.msgT > 0) { this.msgT -= dt; if (this.msgT <= 0) this.el.msg.style.opacity = '0'; }
    // прицел
    const aiming = p.stateName === 'Draw' || p.stateName === 'Release';
    this.el.cross.style.opacity = aiming ? '1' : '0';
    // виньетка
    this.vigPulse += dt * (2 + (1 - hp) * 4);
    const low = Math.max(0, (0.38 - hp) / 0.38);
    const pulse = low * (0.5 + 0.5 * Math.sin(this.vigPulse));
    this.flash = Math.max(0, this.flash - dt * 2.4);
    (this.el.vig as HTMLElement).style.background = `radial-gradient(ellipse at center,rgba(0,0,0,0) 40%,rgba(105,6,6,${0.15 * low + 0.35 * pulse}) 78%,rgba(70,0,0,${0.35 * low + 0.45 * pulse}) 100%)`;
    (this.el.flash as HTMLElement).style.background = `rgba(150,12,12,${this.flash * 0.5})`;
    this.lastHp = hp;
    if (g.mode === 'play') this.el.dead.style.display = 'none';
    this.updateWorldMarkers(dt);
  }

  private tmp = new THREE.Vector3();
  private updateWorldMarkers(dt: number): void {
    const g = this.game;
    const cam = g.cam.camera;
    const w = window.innerWidth, h = window.innerHeight;
    const project = (p: THREE.Vector3): { x: number; y: number; ok: boolean } => {
      this.tmp.copy(p).project(cam);
      return { x: (this.tmp.x * 0.5 + 0.5) * w, y: (-this.tmp.y * 0.5 + 0.5) * h, ok: this.tmp.z < 1 && this.tmp.z > -1 };
    };
    for (const e of g.aliveEnemies) {
      let bar = this.enemyBars.get(e);
      if (!bar) {
        const box = document.createElement('div');
        box.className = 'ew-en';
        const fill = document.createElement('i');
        box.appendChild(fill);
        this.root.appendChild(box);
        bar = { box, fill, t: 0 };
        this.enemyBars.set(e, bar);
      }
      const damaged = e.dm.health < 0.999;
      const locked = g.player.lockTarget === e;
      bar.t = damaged ? 4 : Math.max(0, bar.t - dt);
      if (!(damaged || locked) || e.dm.dead) { bar.box.style.display = 'none'; continue; }
      const head = e.position.clone().setY(e.position.y + 2.05);
      const s = project(head);
      bar.box.style.display = s.ok ? 'block' : 'none';
      bar.box.style.left = `${s.x}px`;
      bar.box.style.top = `${s.y}px`;
      bar.fill.style.width = `${e.dm.health * 100}%`;
    }
    for (const [e, bar] of this.enemyBars) {
      if (e.dm.dead || !g.combatants.includes(e)) { bar.box.remove(); this.enemyBars.delete(e); }
    }
    const lt = g.player.lockTarget;
    if (lt && !lt.dm.dead) {
      const s = project(lt.position.clone().setY(lt.position.y + 1.2));
      this.el.lock.style.display = s.ok ? 'block' : 'none';
      this.el.lock.style.left = `${s.x}px`;
      this.el.lock.style.top = `${s.y}px`;
    } else this.el.lock.style.display = 'none';
  }

  get isStarted(): boolean { return this.started; }
}
