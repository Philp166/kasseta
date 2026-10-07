import { Character } from './character/character';
import { Viewer } from './viewer/viewer';
import { Game } from './game/game';
import { debugSpear, debugBow } from './character/debugProps';

const params = new URLSearchParams(location.search);
const mode = params.get('mode') ?? 'game';
const canvas = document.getElementById('view') as HTMLCanvasElement;

async function main() {
  if (mode === 'viewer') {
    const character = new Character();
    const viewer = new Viewer(canvas, character);
    viewer.setCam(0, 8, 5.2, 0.95);
    viewer.start();
    (window as any).__v = viewer;
    (window as any).__c = character;
    (window as any).__dbg = { debugSpear, debugBow };
  } else {
    const game = await Game.create(canvas);
    game.start();
    (window as any).__game = game;
  }
  (window as any).__ready = true;
}
main().catch((e) => {
  console.error('FATAL', e);
  document.title = 'ERROR: ' + (e && e.message);
});
