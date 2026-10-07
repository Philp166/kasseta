// Временные «болванки» оружия для проверки хватов, пока не подключено детальное снаряжение.

import * as THREE from 'three';

export function debugSpear(): THREE.Group {
  const g = new THREE.Group();
  const mat = new THREE.MeshStandardMaterial({ color: 0x5b4330, roughness: 0.8 });
  const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.017, 0.02, 2.1, 8), mat);
  shaft.position.y = 0.05;
  const tip = new THREE.Mesh(new THREE.ConeGeometry(0.035, 0.28, 8), new THREE.MeshStandardMaterial({ color: 0x8c949c, roughness: 0.35, metalness: 0.9 }));
  tip.position.y = 1.24;
  const blade = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.2, 0.012), new THREE.MeshStandardMaterial({ color: 0x8c949c, roughness: 0.35, metalness: 0.9 }));
  blade.position.y = 1.12;
  g.add(shaft, tip, blade);
  g.traverse((o) => { o.castShadow = true; });
  return g;
}

/** Лук-болванка: вертикальная дуга, тетива со стороны −Z. */
export function debugBow(): THREE.Group {
  const g = new THREE.Group();
  const pts: THREE.Vector3[] = [];
  for (let i = 0; i <= 20; i++) {
    const t = (i / 20) * 2 - 1;
    pts.push(new THREE.Vector3(0, t * 0.72, 0.1 * (1 - t * t) - 0.05));
  }
  const curve = new THREE.CatmullRomCurve3(pts);
  g.add(new THREE.Mesh(new THREE.TubeGeometry(curve, 24, 0.016, 6), new THREE.MeshStandardMaterial({ color: 0x5b4330, roughness: 0.8 })));
  const stringGeo = new THREE.BufferGeometry().setFromPoints([pts[0], new THREE.Vector3(0, 0, -0.17), pts[20]]);
  g.add(new THREE.Line(stringGeo, new THREE.LineBasicMaterial({ color: 0xd8d0c0 })));
  g.traverse((o) => { o.castShadow = true; });
  return g;
}

/** Стрела-болванка: центр в середине древка, остриё на +Y. */
export function debugArrow(): THREE.Group {
  const g = new THREE.Group();
  const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.006, 0.006, 0.8, 5), new THREE.MeshStandardMaterial({ color: 0x8a6a46, roughness: 0.8 }));
  const head = new THREE.Mesh(new THREE.ConeGeometry(0.014, 0.07, 6), new THREE.MeshStandardMaterial({ color: 0x9aa0a6, roughness: 0.4, metalness: 0.9 }));
  head.position.y = 0.435;
  const fletch = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.12, 0.002), new THREE.MeshStandardMaterial({ color: 0xe6e0d0, roughness: 0.9 }));
  fletch.position.y = -0.33;
  g.add(shaft, head, fletch);
  g.traverse((o) => { o.castShadow = true; });
  return g;
}
