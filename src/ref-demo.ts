// Просмотр внешней модели-референса (GLB): ?src=/.tmp/trellis/ref.glb. Для проверок: window.__r.sheet(views, w, h, cols).
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { classify, CLASS_COLORS } from './character/shell/classify.mjs';

const params = new URLSearchParams(location.search);
const src = params.get('src') ?? '/.tmp/trellis/ref.glb';
const canvas = document.getElementById('view') as HTMLCanvasElement;
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = +(params.get('exp') ?? 3.2);
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x0d1117);
const camera = new THREE.PerspectiveCamera(30, 1, 0.01, 50);
const controls = new OrbitControls(camera, canvas);
scene.add(new THREE.HemisphereLight(0x9fb2c8, 0x2a2420, 1.0));
const key = new THREE.DirectionalLight(0xffe2c4, 3.0); key.position.set(2.5, 3.5, 3); scene.add(key);
const rim = new THREE.DirectionalLight(0x9ec3ff, 1.8); rim.position.set(-3, 2.6, -3.2); scene.add(rim);
const fill = new THREE.DirectionalLight(0xb9a68e, 0.6); fill.position.set(-2.5, 1.2, 2.5); scene.add(fill);

const state: { model: THREE.Object3D | null } = { model: null };
function setCam(az: number, el: number, dist: number, ty: number, fov = 30, tx = 0, tz = 0) {
  const a = (az * Math.PI) / 180, e = (el * Math.PI) / 180;
  camera.fov = fov; camera.updateProjectionMatrix();
  controls.target.set(tx, ty, tz);
  camera.position.set(tx + Math.sin(a) * Math.cos(e) * dist, ty + Math.sin(e) * dist, tz + Math.cos(a) * Math.cos(e) * dist);
  camera.lookAt(controls.target); controls.update();
}
function resize() { renderer.setSize(innerWidth, innerHeight, false); camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix(); }
addEventListener('resize', resize); resize();

function sheet(views: number[][], tw = 480, th = 720, cols = views.length): string {
  const rows = Math.ceil(views.length / cols);
  const out = document.createElement('canvas'); out.width = tw * cols; out.height = th * rows;
  const ctx = out.getContext('2d')!;
  renderer.setSize(tw, th, false);
  views.forEach((v, k) => {
    setCam(v[0], v[1], v[2], v[3], v[4] ?? 30, v[5] ?? 0, v[6] ?? 0);
    camera.aspect = tw / th; camera.updateProjectionMatrix();
    renderer.render(scene, camera);
    ctx.drawImage(renderer.domElement, (k % cols) * tw, Math.floor(k / cols) * th);
  });
  resize();
  return out.toDataURL('image/png');
}

/** Ортографические виды с координатной сеткой (для замеров): view = 'front' (XY, смотрим из +Z), 'side' (ZY, из +X), 'back'. */
function ortho(view: string, cx: number, cy: number, halfH: number, w = 900, h = 1100, step = 0.05, lines: number[][][] = []): string {
  const aspect = w / h;
  const cam = new THREE.OrthographicCamera(-halfH * aspect, halfH * aspect, halfH, -halfH, 0.01, 20);
  const pos = view === 'side' ? [5, cy, cx] : view === 'back' ? [cx, cy, -5] : [cx, cy, 5];
  cam.position.set(pos[0], pos[1], pos[2]);
  cam.up.set(0, 1, 0);
  cam.lookAt(view === 'side' ? 0 : cx, cy, view === 'side' ? cx : 0);
  cam.updateProjectionMatrix();
  renderer.setSize(w, h, false);
  renderer.render(scene, cam);
  const out = document.createElement('canvas'); out.width = w; out.height = h;
  const g = out.getContext('2d')!;
  g.drawImage(renderer.domElement, 0, 0);
  // сетка: горизонтальная ось экрана = x (front/back, back зеркален) или z (side, вправо = -z)
  const sx = (u: number) => w / 2 + ((view === 'back' ? -(u - cx) : view === 'side' ? -(u - cx) : (u - cx)) / (halfH * aspect)) * (w / 2);
  const sy = (v: number) => h / 2 - ((v - cy) / halfH) * (h / 2);
  g.font = '12px sans-serif';
  for (let u = Math.ceil((cx - halfH * aspect) / step) * step; u < cx + halfH * aspect; u += step) {
    const major = Math.abs(Math.round(u / 0.1) * 0.1 - u) < 1e-6;
    g.strokeStyle = major ? 'rgba(80,255,120,0.45)' : 'rgba(80,255,120,0.15)'; g.beginPath(); g.moveTo(sx(u), 0); g.lineTo(sx(u), h); g.stroke();
    if (major) { g.fillStyle = '#6f6'; g.fillText(u.toFixed(1), sx(u) + 2, 12); }
  }
  for (let v = Math.ceil((cy - halfH) / step) * step; v < cy + halfH; v += step) {
    const major = Math.abs(Math.round(v / 0.1) * 0.1 - v) < 1e-6;
    g.strokeStyle = major ? 'rgba(255,200,80,0.45)' : 'rgba(255,200,80,0.15)'; g.beginPath(); g.moveTo(0, sy(v)); g.lineTo(w, sy(v)); g.stroke();
    if (major) { g.fillStyle = '#fc6'; g.fillText(v.toFixed(1), 2, sy(v) - 2); }
  }
  // ломаные (в координатах модели): рисуем поверх (для проверки положения суставов)
  const proj = (p: number[]): [number, number] => {
    const u = view === 'side' ? p[2] : p[0];
    return [sx(u), sy(p[1])];
  };
  lines.forEach((ln, li) => {
    g.strokeStyle = ['#ff3030', '#30a0ff', '#ffe030', '#ff30ff'][li % 4]; g.lineWidth = 3;
    g.beginPath(); ln.forEach((p, i) => { const [a, b] = proj(p); if (i) g.lineTo(a, b); else g.moveTo(a, b); }); g.stroke();
    ln.forEach((p) => { const [a, b] = proj(p); g.beginPath(); g.arc(a, b, 5, 0, 7); g.fillStyle = g.strokeStyle; g.fill(); });
  });
  resize();
  return out.toDataURL('image/png');
}

new GLTFLoader().load(src, (g) => {
  const m = g.scene;
  scene.add(m);
  if (params.has('flags')) {
    // окраска вершин по классам вырезаемых частей
    m.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh) return;
      const geo = mesh.geometry as THREE.BufferGeometry;
      const pos = geo.getAttribute('position').array as Float32Array;
      const uv = geo.getAttribute('uv').array as Float32Array;
      const mat = mesh.material as THREE.MeshStandardMaterial;
      const img = mat.map!.image as ImageBitmap | HTMLImageElement;
      const cv = document.createElement('canvas'); cv.width = (img as any).width; cv.height = (img as any).height;
      const cx = cv.getContext('2d')!; cx.drawImage(img as CanvasImageSource, 0, 0);
      const data = cx.getImageData(0, 0, cv.width, cv.height).data;
      const n = pos.length / 3;
      const col = new Float32Array(n * 3);
      for (let i = 0; i < n; i++) {
        const x = Math.min(cv.width - 1, Math.max(0, Math.floor(uv[i * 2] * cv.width)));
        const y = Math.min(cv.height - 1, Math.max(0, Math.floor((1 - uv[i * 2 + 1]) * cv.height)));
        const o2 = (y * cv.width + x) * 4;
        col[i * 3] = data[o2] / 255; col[i * 3 + 1] = data[o2 + 1] / 255; col[i * 3 + 2] = data[o2 + 2] / 255;
      }
      const cls = classify(pos, col);
      const colors = new Float32Array(n * 3);
      const counts = new Array(8).fill(0);
      for (let i = 0; i < n; i++) {
        const k = cls[i]; counts[k]++;
        const cc = CLASS_COLORS[k];
        // оставляемое — исходный цвет текстуры, вырезаемое — яркий цвет класса
        if (k === 0) { colors[i * 3] = col[i * 3]; colors[i * 3 + 1] = col[i * 3 + 1]; colors[i * 3 + 2] = col[i * 3 + 2]; }
        else { colors[i * 3] = cc[0]; colors[i * 3 + 1] = cc[1]; colors[i * 3 + 2] = cc[2]; }
      }
      geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
      const flat = new THREE.MeshBasicMaterial({ vertexColors: true });
      mesh.material = flat;
      console.log('classes', JSON.stringify(counts));
    });
  }
  state.model = m;
  const box = new THREE.Box3().setFromObject(m);
  console.log('bbox', JSON.stringify(box.min.toArray()), JSON.stringify(box.max.toArray()));
  (window as any).__r = { sheet, ortho, setCam, scene, camera, renderer, model: m, THREE };
  (window as any).__ready = true;
  const loop = () => { controls.update(); renderer.render(scene, camera); requestAnimationFrame(loop); };
  setCam(0, 6, 3.2, 0, 30);
  requestAnimationFrame(loop);
}, undefined, (e) => { console.error('load error', e); document.title = 'ERROR'; });
