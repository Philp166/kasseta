// Реестр предметов снаряжения: имя → сборщик (THREE.Group с userData.sockets).

import * as THREE from 'three';
import { buildSpear } from './spear';
import { buildBow } from './bow';
import { buildArrow } from './arrow';
import { buildQuiver } from './quiver';
import { buildKnife } from './knife';
import { buildPouch } from './pouch';
import { buildFangCluster, buildMedallion } from './amulets';

export const GEAR: Record<string, () => THREE.Group> = {
  spear: buildSpear,
  bow: buildBow,
  arrow: () => buildArrow('hunter'),
  quiver: () => buildQuiver(),
  knife: buildKnife,
  pouch: buildPouch,
  fangs: () => buildFangCluster(),
  medallion: buildMedallion,
};

export { buildSpear, buildBow, buildArrow, buildQuiver, buildKnife, buildPouch, buildFangCluster, buildMedallion };
