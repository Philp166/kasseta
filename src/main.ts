import { Character } from './character/character';
import { Viewer } from './viewer/viewer';
import { Game } from './game/game';
import { UI } from './game/ui';
import { debugSpear, debugBow } from './character/debugProps';
import { preloadHuman, humanReady } from './character/human/human';
import { bakeSkins } from './character/human/skin';
import { preloadShell } from './character/shell/shell';

const params = new URLSearchParams(location.search);
const mode = params.get('mode') ?? 'game';
const canvas = document.getElementById('view') as HTMLCanvasElement;

async function main() {
  if (!params.has('nohuman')) {
    await preloadHuman();
    if (humanReady()) await bakeSkins({ size: +(params.get('skin') ?? 1024) });
    // оболочка одежды из внешней модели — пока экспериментальная (нужна модель в A-позе): включается ?shell=1
    if (humanReady() && params.has('shell')) await preloadShell();
  }
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
    if (!params.has('noui')) {
      const ui = new UI(game);
      game.hooks.push((dt) => ui.update(dt));
      (window as any).__ui = ui;
    }
    game.start();
    (window as any).__game = game;
  }
  (window as any).__ready = true;
}
main().catch((e) => {
  console.error('FATAL', e);
  document.title = 'ERROR: ' + (e && e.message);
});
