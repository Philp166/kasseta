// Ввод: клавиатура, мышь (pointer lock), геймпад, виртуальные кнопки (тач). Всё приводится к «действиям».

import * as THREE from 'three';

export type Action = 'attack' | 'block' | 'sprint' | 'dodge' | 'swap' | 'lock' | 'interact' | 'restart' | 'debug' | 'walk' | 'help';

const KEYMAP: Record<string, Action> = {
  KeyJ: 'attack', KeyK: 'block', ShiftLeft: 'sprint', ShiftRight: 'sprint', Space: 'dodge',
  KeyQ: 'swap', Tab: 'lock', KeyE: 'interact', KeyR: 'restart', Backquote: 'debug', F1: 'debug',
  KeyC: 'walk', KeyH: 'help',
};

export class Input {
  /** Движение: x — вправо, y — вперёд (−1..1, длина ≤ 1). */
  readonly move = new THREE.Vector2();
  /** Накопленный за кадр поворот камеры (радианы). */
  readonly look = new THREE.Vector2();
  /** Колесо мыши за кадр. */
  wheel = 0;
  locked = false;
  sensitivity = 0.0022;
  invertY = false;
  private held = new Set<Action>();
  private prevHeld = new Set<Action>();
  private keys = new Set<string>();
  private mouseButtons = new Set<number>();
  private virtual = new Set<Action>();
  private virtualMove = new THREE.Vector2();
  private virtualLook = new THREE.Vector2();
  private gpPrev = new Set<Action>();
  usingGamepad = false;

  constructor(private canvas: HTMLElement) {
    window.addEventListener('keydown', (e) => {
      if (e.repeat) return;
      this.keys.add(e.code);
      if (e.code === 'Tab' || e.code === 'Space' || e.code === 'F1') e.preventDefault();
    });
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));
    window.addEventListener('blur', () => { this.keys.clear(); this.mouseButtons.clear(); });
    canvas.addEventListener('mousedown', (e) => {
      this.mouseButtons.add(e.button);
      if (!this.locked && e.button === 0) this.requestLock();
    });
    window.addEventListener('mouseup', (e) => this.mouseButtons.delete(e.button));
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    window.addEventListener('mousemove', (e) => {
      if (!this.locked) return;
      this.look.x += e.movementX * this.sensitivity;
      this.look.y += e.movementY * this.sensitivity * (this.invertY ? -1 : 1);
    });
    window.addEventListener('wheel', (e) => { this.wheel += Math.sign(e.deltaY); }, { passive: true });
    document.addEventListener('pointerlockchange', () => {
      this.locked = document.pointerLockElement === canvas;
    });
  }

  requestLock(): void {
    try {
      const p = (this.canvas as HTMLCanvasElement).requestPointerLock?.() as unknown;
      if (p && typeof (p as Promise<void>).catch === 'function') (p as Promise<void>).catch(() => {});
    } catch { /* в headless/iframe может быть запрещено — игра работает и без захвата */ }
  }

  setVirtual(a: Action, down: boolean): void {
    if (down) this.virtual.add(a); else this.virtual.delete(a);
  }
  setVirtualMove(x: number, y: number): void { this.virtualMove.set(x, y); }
  addVirtualLook(dx: number, dy: number): void { this.virtualLook.x += dx; this.virtualLook.y += dy; }

  /** Вызывать в начале кадра. */
  poll(): void {
    this.prevHeld = this.held;
    const h = new Set<Action>();
    for (const code of this.keys) { const a = KEYMAP[code]; if (a) h.add(a); }
    if (this.mouseButtons.has(0)) h.add('attack');
    if (this.mouseButtons.has(2)) h.add('block');
    if (this.mouseButtons.has(1)) h.add('lock');
    for (const a of this.virtual) h.add(a);
    // движение
    let mx = 0, my = 0;
    if (this.keys.has('KeyW') || this.keys.has('ArrowUp')) my += 1;
    if (this.keys.has('KeyS') || this.keys.has('ArrowDown')) my -= 1;
    if (this.keys.has('KeyD') || this.keys.has('ArrowRight')) mx += 1;
    if (this.keys.has('KeyA') || this.keys.has('ArrowLeft')) mx -= 1;
    mx += this.virtualMove.x; my += this.virtualMove.y;
    // геймпад
    const pads = navigator.getGamepads ? navigator.getGamepads() : [];
    const gp = pads && [...pads].find((p) => p && p.connected);
    const nowGp = new Set<Action>();
    if (gp) {
      const dz = (v: number) => (Math.abs(v) < 0.16 ? 0 : v);
      const lx = dz(gp.axes[0] ?? 0), ly = dz(gp.axes[1] ?? 0), rx = dz(gp.axes[2] ?? 0), ry = dz(gp.axes[3] ?? 0);
      if (lx || ly) { mx += lx; my -= ly; this.usingGamepad = true; }
      this.look.x += rx * 0.045;
      this.look.y += ry * 0.035;
      const b = (i: number) => !!gp.buttons[i]?.pressed;
      if (b(0)) nowGp.add('dodge');
      if (b(2) || b(7)) nowGp.add('attack');
      if (b(3)) nowGp.add('swap');
      if (b(6) || b(4)) nowGp.add('block');
      if (b(10)) nowGp.add('sprint');
      if (b(11)) nowGp.add('lock');
      if (b(9)) nowGp.add('debug');
    }
    for (const a of nowGp) h.add(a);
    this.gpPrev = nowGp;
    this.held = h;
    this.look.x += this.virtualLook.x; this.look.y += this.virtualLook.y;
    this.virtualLook.set(0, 0);
    this.move.set(mx, my);
    if (this.move.lengthSq() > 1) this.move.normalize();
  }

  down(a: Action): boolean { return this.held.has(a); }
  pressed(a: Action): boolean { return this.held.has(a) && !this.prevHeld.has(a); }
  released(a: Action): boolean { return !this.held.has(a) && this.prevHeld.has(a); }

  /** Вызывать в конце кадра: сброс накопителей. */
  endFrame(): void {
    this.look.set(0, 0);
    this.wheel = 0;
  }
}
