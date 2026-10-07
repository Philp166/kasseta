// Студийное окружение для металла и кожи: без карты окружения PBR-металл выглядит чёрным.
// makeGearEnvironment(renderer) → текстура для scene.environment (PMREM). Тёплый ключ, холодный контур, тёмный «лес».

import * as THREE from 'three';

export function makeGearEnvironment(renderer: THREE.WebGLRenderer, o: { intensity?: number } = {}): THREE.Texture {
  const k = o.intensity ?? 1;
  const scene = new THREE.Scene();
  // купол с градиентом: небо — холодный серо-голубой, горизонт — тёмный, земля — почти чёрная
  const dome = new THREE.SphereGeometry(20, 48, 24);
  const cols: number[] = [];
  const pos = dome.getAttribute('position');
  const c = new THREE.Color();
  const top = new THREE.Color(0.30, 0.37, 0.48), hor = new THREE.Color(0.20, 0.19, 0.18), bot = new THREE.Color(0.045, 0.04, 0.035);
  for (let i = 0; i < pos.count; i++) {
    const y = pos.getY(i) / 20;
    if (y > 0) c.copy(hor).lerp(top, Math.pow(y, 0.7));
    else c.copy(hor).lerp(bot, Math.min(1, -y * 1.6));
    cols.push(c.r * k, c.g * k, c.b * k);
  }
  dome.setAttribute('color', new THREE.Float32BufferAttribute(cols, 3));
  scene.add(new THREE.Mesh(dome, new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.BackSide })));
  // софтбоксы
  const box = (w: number, h: number, col: THREE.Color, pos: THREE.Vector3) => {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ color: col, side: THREE.DoubleSide }));
    m.position.copy(pos);
    m.lookAt(0, 1, 0);
    scene.add(m);
  };
  box(9, 7, new THREE.Color(7.5 * k, 6.0 * k, 4.4 * k), new THREE.Vector3(7, 9, 8)); // тёплый ключ сверху-спереди-справа
  box(7, 9, new THREE.Color(1.6 * k, 2.1 * k, 3.4 * k), new THREE.Vector3(-9, 5, -8)); // холодный контур сзади-слева
  box(10, 3, new THREE.Color(1.8 * k, 1.5 * k, 1.2 * k), new THREE.Vector3(-8, 3, 7)); // тёплое заполнение слева-спереди
  box(6, 6, new THREE.Color(1.2 * k, 1.3 * k, 1.6 * k), new THREE.Vector3(0, 14, 0)); // верхний рассеянный
  const pmrem = new THREE.PMREMGenerator(renderer);
  const rt = pmrem.fromScene(scene, 0.035);
  pmrem.dispose();
  dome.dispose();
  return rt.texture;
}
