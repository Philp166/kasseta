// Студийный просмотрщик: тёмный фон, ключевой и контровой свет, орбитальная камера.
// Для проверок снаружи (Playwright) выставляется window.__v.

import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { Character } from '../character/character';

export class Viewer {
  renderer: THREE.WebGLRenderer;
  scene = new THREE.Scene();
  camera: THREE.PerspectiveCamera;
  controls: OrbitControls;
  character: Character;
  key: THREE.DirectionalLight;
  private last = performance.now();
  onTick: Array<(dt: number) => void> = [];
  /** Крутить анимацию и физику персонажа в цикле просмотра. */
  animate = true;

  constructor(canvas: HTMLCanvasElement, character: Character) {
    this.character = character;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    this.scene.background = new THREE.Color(0x0d1117);
    this.scene.fog = new THREE.Fog(0x0d1117, 6, 18);
    this.camera = new THREE.PerspectiveCamera(30, 1, 0.05, 80);
    this.controls = new OrbitControls(this.camera, canvas);
    this.controls.target.set(0, 1.0, 0);
    this.controls.enableDamping = true;

    const hemi = new THREE.HemisphereLight(0x8fa2b8, 0x2a2420, 0.9);
    this.scene.add(hemi);
    this.key = new THREE.DirectionalLight(0xffe2c4, 3.2);
    this.key.position.set(2.5, 3.5, 3.0);
    this.key.castShadow = true;
    this.key.shadow.mapSize.set(2048, 2048);
    const sc = this.key.shadow.camera;
    sc.left = -1.6; sc.right = 1.6; sc.top = 2.4; sc.bottom = -0.4; sc.near = 0.5; sc.far = 12;
    this.key.shadow.bias = -0.0004;
    this.key.shadow.normalBias = 0.01;
    this.scene.add(this.key);
    const rim = new THREE.DirectionalLight(0x9ec3ff, 2.2);
    rim.position.set(-3, 2.6, -3.2);
    this.scene.add(rim);
    const fill = new THREE.DirectionalLight(0xb9a68e, 0.5);
    fill.position.set(-2.5, 1.2, 2.5);
    this.scene.add(fill);

    const floor = new THREE.Mesh(
      new THREE.CircleGeometry(4, 64),
      new THREE.MeshStandardMaterial({ color: 0x1a1d22, roughness: 0.95 }),
    );
    floor.rotation.x = -Math.PI / 2;
    floor.receiveShadow = true;
    this.scene.add(floor);

    this.scene.add(character.group);
    this.resize();
    window.addEventListener('resize', () => this.resize());
  }

  resize() {
    const w = window.innerWidth, h = window.innerHeight;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  /** Поставить камеру: азимут (0 = спереди), высота над горизонтом, дистанция, высота цели. */
  setCam(azimuthDeg: number, elevDeg: number, dist: number, targetY = 1.0, fov = 30) {
    const az = (azimuthDeg * Math.PI) / 180, el = (elevDeg * Math.PI) / 180;
    this.camera.fov = fov;
    this.camera.updateProjectionMatrix();
    this.controls.target.set(0, targetY, 0);
    this.camera.position.set(
      Math.sin(az) * Math.cos(el) * dist,
      targetY + Math.sin(el) * dist,
      Math.cos(az) * Math.cos(el) * dist,
    );
    this.camera.lookAt(this.controls.target);
    this.controls.update();
  }

  render() {
    this.renderer.render(this.scene, this.camera);
  }

  /**
   * Лист ракурсов в один PNG (data URL): каждая плитка — своя камера.
   * views: [азимут, высота камеры, дистанция, высота цели, fov?, подпись?]
   */
  sheet(views: Array<[number, number, number, number, number?]>, tileW = 480, tileH = 720, cols = views.length): string {
    const rows = Math.ceil(views.length / cols);
    const out = document.createElement('canvas');
    out.width = tileW * cols;
    out.height = tileH * rows;
    const ctx = out.getContext('2d')!;
    const prevAspect = this.camera.aspect;
    this.renderer.setSize(tileW, tileH, false);
    this.camera.aspect = tileW / tileH;
    views.forEach((v, k) => {
      this.setCam(v[0], v[1], v[2], v[3], v[4] ?? 30);
      this.camera.aspect = tileW / tileH;
      this.camera.updateProjectionMatrix();
      this.renderer.render(this.scene, this.camera);
      ctx.drawImage(this.renderer.domElement, (k % cols) * tileW, Math.floor(k / cols) * tileH);
    });
    this.camera.aspect = prevAspect;
    this.resize();
    return out.toDataURL('image/png');
  }

  /** Серия кадров: на каждой плитке своя поза (poseFn(k)), камера одна. */
  sheetSeq(count: number, view: [number, number, number, number, number?], tileW: number, tileH: number, cols: number, poseFn: (k: number) => void): string {
    const rows = Math.ceil(count / cols);
    const out = document.createElement('canvas');
    out.width = tileW * cols;
    out.height = tileH * rows;
    const ctx = out.getContext('2d')!;
    const prevAspect = this.camera.aspect;
    this.renderer.setSize(tileW, tileH, false);
    this.setCam(view[0], view[1], view[2], view[3], view[4] ?? 30);
    this.camera.aspect = tileW / tileH;
    this.camera.updateProjectionMatrix();
    for (let k = 0; k < count; k++) {
      poseFn(k);
      this.character.group.updateMatrixWorld(true);
      this.renderer.render(this.scene, this.camera);
      ctx.drawImage(this.renderer.domElement, (k % cols) * tileW, Math.floor(k / cols) * tileH);
    }
    this.camera.aspect = prevAspect;
    this.resize();
    return out.toDataURL('image/png');
  }

  start() {
    const loop = () => {
      const now = performance.now();
      const dt = Math.min((now - this.last) / 1000, 0.1);
      this.last = now;
      if (this.animate) this.character.update(dt);
      for (const f of this.onTick) f(dt);
      this.controls.update();
      this.render();
      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
  }
}
