// Демо окружения (env.html): свободная камера/облёт, ракурсы, замер производительности.
// Параметры URL: ?q=low|medium|high  &view=<имя>  &tour=1  &manual=1 (рендер только по вызову __demo.render)
//   &char=1 (поставить персонажа для масштаба)  &hud=0  &seed=N
// Управление: ЛКМ+мышь — поворот, WASD — полёт, Shift — быстрее, Q/E — вниз/вверх, 1..7 — ракурсы, T — облёт, H — HUD.

import * as THREE from 'three';
import { createEnvironment } from './game/environment';
import type { Environment } from './game/environment';

const params = new URLSearchParams(location.search);
const quality = (params.get('q') as 'low' | 'medium' | 'high') || 'medium';
const manual = params.get('manual') === '1';
const canvas = document.getElementById('view') as HTMLCanvasElement;
const hud = document.getElementById('hud') as HTMLDivElement;

const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true, powerPreference: 'high-performance' });
const dprCap = quality === 'low' ? 1 : quality === 'medium' ? 1.5 : 2;
renderer.setPixelRatio(Math.min(window.devicePixelRatio, dprCap));
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(58, 1, 0.1, 6000);

function resize() {
  const w = window.innerWidth, h = window.innerHeight;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}
window.addEventListener('resize', resize);
resize();

interface View { pos: [number, number, number]; look: [number, number, number]; fov?: number; label: string }
let env: Environment;
const views: Record<string, () => View> = {};
let viewName = '';
let yaw = 0, pitch = 0;
const keys = new Set<string>();
let speed = 8;
let tourT = -1;
let sceneTime = 0;
let player: { group: THREE.Object3D } | null = null;

function setCam(pos: THREE.Vector3, look: THREE.Vector3, fov = 58) {
  camera.position.copy(pos);
  camera.fov = fov;
  camera.updateProjectionMatrix();
  camera.lookAt(look);
  const e = new THREE.Euler().setFromQuaternion(camera.quaternion, 'YXZ');
  yaw = e.y; pitch = e.x;
}

function setView(name: string) {
  const f = views[name];
  if (!f) return false;
  const v = f();
  setCam(new THREE.Vector3(...v.pos), new THREE.Vector3(...v.look), v.fov ?? 58);
  viewName = name;
  return true;
}

function frame(dt: number) {
  sceneTime += dt;
  if (tourT >= 0) updateTour(dt);
  else fly(dt);
  env.setShadowTarget(player ? player.group.position : new THREE.Vector3(camera.position.x + Math.sin(yaw) * -12, 0, camera.position.z - Math.cos(yaw) * 12).setY(env.heightAt(camera.position.x, camera.position.z)));
  env.update(dt, camera);
  renderer.render(scene, camera);
}

function fly(dt: number) {
  const dir = new THREE.Vector3();
  camera.getWorldDirection(dir);
  const right = new THREE.Vector3().crossVectors(dir, camera.up).normalize();
  const k = (keys.has('ShiftLeft') ? 4 : 1) * speed * dt;
  if (keys.has('KeyW')) camera.position.addScaledVector(dir, k);
  if (keys.has('KeyS')) camera.position.addScaledVector(dir, -k);
  if (keys.has('KeyD')) camera.position.addScaledVector(right, k);
  if (keys.has('KeyA')) camera.position.addScaledVector(right, -k);
  if (keys.has('KeyE')) camera.position.y += k;
  if (keys.has('KeyQ')) camera.position.y -= k;
}

// ---- облёт: плавный путь по ключевым ракурсам ----
let tourCurve: { pos: THREE.CatmullRomCurve3; look: THREE.CatmullRomCurve3 } | null = null;
function startTour() {
  const names = ['overview', 'hill', 'camp', 'fire', 'forest', 'edge'];
  const ps: THREE.Vector3[] = [], ls: THREE.Vector3[] = [];
  for (const n of names) { const v = views[n](); ps.push(new THREE.Vector3(...v.pos)); ls.push(new THREE.Vector3(...v.look)); }
  ps.push(ps[0].clone()); ls.push(ls[0].clone());
  tourCurve = { pos: new THREE.CatmullRomCurve3(ps, false, 'centripetal'), look: new THREE.CatmullRomCurve3(ls, false, 'centripetal') };
  tourT = 0;
}
function updateTour(dt: number) {
  if (!tourCurve) return;
  tourT = Math.min(1, tourT + dt / 90);
  const p = tourCurve.pos.getPoint(tourT), l = tourCurve.look.getPoint(tourT);
  // не заходить под землю
  p.y = Math.max(p.y, env.heightAt(p.x, p.z) + 1.4);
  camera.position.copy(p);
  camera.lookAt(l);
  if (tourT >= 1) tourT = 0;
}

function hudText(): string {
  const i = renderer.info;
  const s = env?.stats ?? {};
  return [
    `Тайга · качество ${quality} · ракурс ${viewName || 'свободный'}`,
    `вызовов отрисовки ${i.render.calls} · треугольников ${(i.render.triangles / 1000).toFixed(0)}k`,
    `деревьев ${s.trees ?? 0} (коллайдеров ${env?.trees.length ?? 0}) · камней ${env?.rocks.length ?? 0}`,
    '1 общий  2 лагерь  3 лес  4 холм  5 костёр  6 край  7 игрок · T облёт · H HUD',
  ].join('\n');
}

async function main() {
  env = await createEnvironment({
    renderer, scene, quality, seed: +(params.get('seed') ?? 7),
    onProgress: (f, label) => { const el = document.getElementById('loading'); if (el) el.textContent = `Загрузка тайги… ${(f * 100) | 0}% · ${label}`; },
  });
  const c = env.camp;
  const g = (x: number, z: number) => env.heightAt(x, z);
  views.overview = () => ({ label: 'общий план', pos: [-26, g(-26, 44) + 14, 44], look: [2, g(0, 0) + 3, -4], fov: 55 });
  views.camp = () => ({ label: 'лагерь', pos: [5.6, g(5.6, 7.4) + 1.7, 7.4], look: [-1.2, g(0, 0) + 1.6, -1.0], fov: 60 });
  views.forest = () => ({ label: 'лес изнутри', pos: [-34, g(-34, -30) + 1.7, -30], look: [-14, g(-14, -10) + 5, -4], fov: 62 });
  views.hill = () => {
    const v = env.vista;
    return { label: 'вид с холма', pos: [v.position.x, v.position.y + 0.5, v.position.z], look: [v.target.x, v.target.y + 4, v.target.z], fov: 58 };
  };
  views.fire = () => ({ label: 'костёр', pos: [c.fire.x + 2.4, g(2.4, 2.0) + 1.2, c.fire.z + 2.0], look: [c.fire.x, c.fire.y + 0.9, c.fire.z], fov: 62 });
  views.edge = () => ({ label: 'опушка', pos: [-8, g(-8, -18) + 1.8, -18], look: [8, g(8, 10) + 4, 30], fov: 62 });
  views.player = () => ({ label: 'игрок', pos: [c.fire.x + 1.6, g(1.6, 9) + 2.6, c.fire.z + 9.0], look: [c.fire.x + 0.2, c.fire.y + 1.3, c.fire.z + 3.2], fov: 55 });

  if (params.get('char') === '1') {
    const { Character } = await import('./character/character');
    const ch = new Character();
    ch.group.position.copy(env.spawnPlayer);
    ch.group.rotation.y = Math.PI * 0.85;
    scene.add(ch.group);
    player = ch;
  }

  const initial = params.get('view') || 'overview';
  setView(initial);
  document.getElementById('loading')?.remove();

  // управление
  let drag = false;
  canvas.addEventListener('mousedown', () => { drag = true; tourT = -1; });
  window.addEventListener('mouseup', () => (drag = false));
  window.addEventListener('mousemove', (e) => {
    if (!drag) return;
    yaw -= e.movementX * 0.0035;
    pitch = Math.max(-1.5, Math.min(1.5, pitch - e.movementY * 0.0035));
    camera.quaternion.setFromEuler(new THREE.Euler(pitch, yaw, 0, 'YXZ'));
  });
  window.addEventListener('wheel', (e) => { speed = Math.max(1, Math.min(80, speed * (e.deltaY > 0 ? 0.85 : 1.18))); });
  window.addEventListener('keydown', (e) => {
    keys.add(e.code);
    const map: Record<string, string> = { Digit1: 'overview', Digit2: 'camp', Digit3: 'forest', Digit4: 'hill', Digit5: 'fire', Digit6: 'edge', Digit7: 'player' };
    if (map[e.code]) { tourT = -1; setView(map[e.code]); }
    if (e.code === 'KeyT') (tourT < 0 ? startTour() : (tourT = -1));
    if (e.code === 'KeyH') document.body.classList.toggle('nohud');
  });
  window.addEventListener('keyup', (e) => keys.delete(e.code));
  if (params.get('hud') === '0') document.body.classList.add('nohud');
  if (params.get('vig') === '0') document.body.classList.add('novig');
  if (params.get('tour') === '1') startTour();

  // API для проверок снаружи
  (window as any).__demo = {
    env, renderer, scene, camera, setView, setCam,
    /** Рендер n кадров с шагом dt (для детерминированных скриншотов). */
    render(n = 1, dt = 1 / 30) { for (let i = 0; i < n; i++) frame(dt); return renderer.info.render.calls; },
    place(x: number, y: number, z: number, lx: number, ly: number, lz: number, fov = 58) { setCam(new THREE.Vector3(x, y, z), new THREE.Vector3(lx, ly, lz), fov); viewName = 'custom'; },
    /** Замер: draw calls / треугольники по ракурсам + время кадра. */
    perf(frames = 3) {
      const out: Record<string, unknown> = {};
      for (const name of Object.keys(views)) {
        setView(name);
        frame(1 / 60);
        const t0 = performance.now();
        for (let i = 0; i < frames; i++) frame(1 / 60);
        const ms = (performance.now() - t0) / frames;
        const i = renderer.info;
        out[name] = { calls: i.render.calls, tris: i.render.triangles, points: i.render.points, lines: i.render.lines, ms: +ms.toFixed(1) };
      }
      const i = renderer.info;
      out.memory = { geometries: i.memory.geometries, textures: i.memory.textures, programs: i.programs?.length ?? 0 };
      console.log('PERF', JSON.stringify(out));
      return out;
    },
  };

  const t0 = performance.now();
  let last = performance.now(), acc = 0;
  const loop = () => {
    const now = performance.now();
    const dt = Math.min((now - last) / 1000, 0.1);
    last = now;
    frame(dt);
    acc += dt;
    if (acc > 0.5) { hud.textContent = hudText(); acc = 0; }
    requestAnimationFrame(loop);
  };
  if (!manual) requestAnimationFrame(loop);
  else frame(0.016);
  hud.textContent = hudText();
  console.log('ENV ready in', ((performance.now() - t0) | 0), 'ms (post-init)');
  (window as any).__ready = true;
}

main().catch((e) => {
  console.error('FATAL', e);
  const el = document.getElementById('loading');
  if (el) el.textContent = 'Ошибка: ' + (e && e.message);
  document.title = 'ERROR: ' + (e && e.message);
});
