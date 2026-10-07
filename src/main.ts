import { Character } from './character/character';
import { Viewer } from './viewer/viewer';

const canvas = document.getElementById('view') as HTMLCanvasElement;
const character = new Character();
const viewer = new Viewer(canvas, character);
viewer.setCam(0, 8, 5.2, 0.95);
viewer.start();
(window as any).__v = viewer;
(window as any).__c = character;
(window as any).__ready = true;
