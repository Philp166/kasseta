// Витрина снаряжения: gear.html
//   ?mode=stand            — все предметы на стенде (по умолчанию)
//   ?mode=item&name=spear  — один предмет крупно (turntable)
//   ?mode=manikin          — манекен (Character) с копьём, луком, ножом, сумкой, колчаном, амулетами
//   ?mode=tex&name=...     — материал на сфере/цилиндре + развёртка карт
// Для проверок снаружи: window.__v.sheet([[азимут, высота, дистанция, высота цели, fov?, tx?, tz?], ...], w, h, cols).

import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { makeGearEnvironment } from './character/gear/env';
import { countTriangles } from './character/gear/geom';
import * as MAT from './character/gear/materials';
import { previewCanvas } from './character/gear/texkit';
import { ornamentBandTexture, OrnamentStyle } from './character/gear/ornament';

const params = new URLSearchParams(location.search);
const mode = params.get('mode') ?? 'stand';
const nameParam = params.get('name') ?? '';

export class GearViewer {
  renderer: THREE.WebGLRenderer;
  scene = new THREE.Scene();
  camera: THREE.PerspectiveCamera;
  controls: OrbitControls;
  key: THREE.DirectionalLight;
  floor: THREE.Mesh;
  private last = performance.now();
  onTick: Array<(dt: number) => void> = [];

  constructor(canvas: HTMLCanvasElement) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.0;
    this.scene.background = new THREE.Color(0x0d1117);
    this.scene.environment = makeGearEnvironment(this.renderer);
    this.scene.environmentIntensity = 0.85;
    this.camera = new THREE.PerspectiveCamera(30, 1, 0.02, 80);
    this.controls = new OrbitControls(this.camera, canvas);
    this.controls.target.set(0, 1.0, 0);
    this.controls.enableDamping = true;
    const hemi = new THREE.HemisphereLight(0x8fa2b8, 0x2a2420, 0.25);
    this.scene.add(hemi);
    this.key = new THREE.DirectionalLight(0xffe2c4, 2.6);
    this.key.position.set(2.5, 3.5, 3.0);
    this.key.castShadow = true;
    this.key.shadow.mapSize.set(2048, 2048);
    const sc = this.key.shadow.camera;
    sc.left = -2.2; sc.right = 2.2; sc.top = 2.6; sc.bottom = -0.6; sc.near = 0.5; sc.far = 14;
    this.key.shadow.bias = -0.0003;
    this.key.shadow.normalBias = 0.006;
    this.scene.add(this.key);
    const rim = new THREE.DirectionalLight(0x9ec3ff, 1.6);
    rim.position.set(-3, 2.6, -3.2);
    this.scene.add(rim);
    const fill = new THREE.DirectionalLight(0xb9a68e, 0.35);
    fill.position.set(-2.5, 1.2, 2.5);
    this.scene.add(fill);
    this.floor = new THREE.Mesh(new THREE.CircleGeometry(6, 64), new THREE.MeshStandardMaterial({ color: 0x1a1d22, roughness: 0.95 }));
    this.floor.rotation.x = -Math.PI / 2;
    this.floor.receiveShadow = true;
    this.scene.add(this.floor);
    this.resize();
    window.addEventListener('resize', () => this.resize());
  }

  resize() {
    const w = window.innerWidth, h = window.innerHeight;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  /** Камера по орбите вокруг цели (tx, targetY, tz). */
  setCam(azimuthDeg: number, elevDeg: number, dist: number, targetY = 1.0, fov = 30, tx = 0, tz = 0) {
    const az = (azimuthDeg * Math.PI) / 180, el = (elevDeg * Math.PI) / 180;
    this.camera.fov = fov;
    this.camera.updateProjectionMatrix();
    this.controls.target.set(tx, targetY, tz);
    this.camera.position.set(
      tx + Math.sin(az) * Math.cos(el) * dist,
      targetY + Math.sin(el) * dist,
      tz + Math.cos(az) * Math.cos(el) * dist,
    );
    this.camera.lookAt(this.controls.target);
    this.controls.update();
  }

  render() { this.renderer.render(this.scene, this.camera); }

  /** Лист ракурсов: views = [азимут, высота, дистанция, высота цели, fov?, tx?, tz?]. */
  sheet(views: Array<number[]>, tileW = 480, tileH = 720, cols = views.length): string {
    const rows = Math.ceil(views.length / cols);
    const out = document.createElement('canvas');
    out.width = tileW * cols;
    out.height = tileH * rows;
    const ctx = out.getContext('2d')!;
    const prevAspect = this.camera.aspect;
    this.renderer.setSize(tileW, tileH, false);
    views.forEach((v, k) => {
      this.setCam(v[0], v[1], v[2], v[3], v[4] ?? 30, v[5] ?? 0, v[6] ?? 0);
      this.camera.aspect = tileW / tileH;
      this.camera.updateProjectionMatrix();
      this.renderer.render(this.scene, this.camera);
      ctx.drawImage(this.renderer.domElement, (k % cols) * tileW, Math.floor(k / cols) * tileH);
    });
    this.camera.aspect = prevAspect;
    this.resize();
    return out.toDataURL('image/png');
  }

  start() {
    const loop = () => {
      const now = performance.now();
      const dt = Math.min((now - this.last) / 1000, 0.1);
      this.last = now;
      for (const f of this.onTick) f(dt);
      this.controls.update();
      this.render();
      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
  }
}

const canvas = document.getElementById('view') as HTMLCanvasElement;
const viewer = new GearViewer(canvas);
(window as any).__v = viewer;
(window as any).__MAT = MAT;
(window as any).__countTris = countTriangles;

function log(s: string) {
  const el = document.getElementById('tris');
  if (el) el.textContent += s + '\n';
  console.log(s);
}

async function main() {
  if (mode === 'tex') {
    // материал: имя вида wood:shaft | leather:dark | steel:forged | bone:ivory | brass:bronze | cord:sinew
    const [kind, sub] = (nameParam || 'wood:shaft').split(':');
    const t0 = performance.now();
    const m = (MAT as any)[kind + 'Mat'](sub) as THREE.MeshStandardMaterial;
    log(`${kind}:${sub} сгенерирован за ${(performance.now() - t0).toFixed(0)} мс`);
    const tw = kind === 'wood' ? MAT.TILE.woodU : kind === 'leather' ? MAT.TILE.leather : kind === 'cord' ? MAT.TILE.cord : MAT.TILE.std;
    const th = kind === 'wood' ? MAT.TILE.woodV : tw;
    const pl = new THREE.Mesh(new THREE.PlaneGeometry(tw, th), m);
    pl.position.set(0, 0.5, 0);
    pl.castShadow = true; pl.receiveShadow = true;
    viewer.scene.add(pl);
    const pl2 = new THREE.Mesh(new THREE.PlaneGeometry(tw * 2, th * 2), m); // тайлинг 2x2
    (pl2.geometry.attributes.uv as THREE.BufferAttribute).array.forEach((_, i, a) => { (a as Float32Array)[i] *= 2; });
    pl2.position.set(tw * 1.6, 0.5, 0);
    pl2.castShadow = true; pl2.receiveShadow = true;
    viewer.scene.add(pl2);
    const s = new THREE.Mesh(new THREE.SphereGeometry(0.1, 64, 40), m);
    s.position.set(-tw * 1.2, 0.5, 0.05);
    s.castShadow = true; s.receiveShadow = true;
    viewer.scene.add(s);
    viewer.setCam(0, 6, 1.0, 0.5, 30, tw * 0.3, 0);
    (window as any).__tex = () => {
      const t = (MAT as any)[kind + 'Tex'](sub);
      return previewCanvas(t, 512).toDataURL('image/png');
    };
  }
  if (mode === 'orn') {
    // ленты орнамента: все стили друг под другом
    const styles: OrnamentStyle[] = ['mixed', 'diamonds', 'zigzag', 'triangles', 'meander', 'knot'];
    const sel = nameParam ? (nameParam.split(',') as OrnamentStyle[]) : styles;
    sel.forEach((st, i) => {
      const t0 = performance.now();
      const b = ornamentBandTexture(st, { fringe: st === 'mixed' });
      log(`ornament ${st}: ${(performance.now() - t0).toFixed(0)} мс`);
      const m = new THREE.MeshStandardMaterial({ map: b.map, normalMap: b.normalMap, roughnessMap: b.orm, aoMap: b.orm, roughness: 1, metalness: 0 });
      const pl = new THREE.Mesh(new THREE.PlaneGeometry(1.0, 0.125), m);
      pl.position.set(0, 1.6 - i * 0.15, 0);
      viewer.scene.add(pl);
      (window as any)['__band_' + st] = b;
    });
    viewer.setCam(0, 0, 1.55, 1.6 - (sel.length - 1) * 0.075, 30, 0, 0);
    (window as any).__tex = () => (window as any).__band_mixed ? (() => { const b = (window as any).__band_mixed; const c = document.createElement('canvas'); c.width = 2048; c.height = 256 * 3; const g = c.getContext('2d')!; g.drawImage(b.canvases.map, 0, 0); g.drawImage(b.canvases.normal, 0, 256); g.drawImage(b.canvases.orm, 0, 512); return c.toDataURL('image/png'); })() : '';
  }
  if (mode === 'item') {
    // один предмет: gear.html?mode=item&name=spear (несколько через запятую — в ряд)
    const { GEAR } = await import('./character/gear/index');
    const names = (nameParam || 'spear').split(',');
    names.forEach((n, i) => {
      const t0 = performance.now();
      const obj = GEAR[n]();
      log(`${n}: ${(performance.now() - t0).toFixed(0)} мс, ${countTriangles(obj)} треуг.`);
      const d = obj.userData.display as { pos?: number[]; rot?: number[] } | undefined;
      obj.position.set(i * 0.8 + (d?.pos?.[0] ?? 0), d?.pos?.[1] ?? 1.0, d?.pos?.[2] ?? 0);
      if (d?.rot) obj.rotation.set(d.rot[0], d.rot[1], d.rot[2]);
      obj.traverse((o) => { o.castShadow = true; o.receiveShadow = true; });
      viewer.scene.add(obj);
      (window as any)['__item_' + n] = obj;
    });
    viewer.setCam(0, 8, 5.2, 1.0, 30, 0, 0);
  }
  viewer.start();
  (window as any).__ready = true;
}
main().catch((e) => {
  console.error('FATAL', e);
  document.title = 'ERROR: ' + (e && e.message);
});
