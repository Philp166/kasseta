// Материалы персонажа и общие патчи шейдеров.

import * as THREE from 'three';

/** Мех: нормаль не переворачивается на обратной стороне пряди — освещение ровное, без «шипов». */
export function patchNoFlip(mat: THREE.MeshStandardMaterial): void {
  const prev = mat.onBeforeCompile;
  mat.onBeforeCompile = (shader, renderer) => {
    prev?.call(mat, shader, renderer);
    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <normal_fragment_begin>',
      THREE.ShaderChunk.normal_fragment_begin.replace('float faceDirection = gl_FrontFacing ? 1.0 : - 1.0;', 'float faceDirection = 1.0;'),
    );
  };
  mat.customProgramCacheKey = () => 'noflip';
}
