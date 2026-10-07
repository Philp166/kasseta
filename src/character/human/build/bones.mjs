// Логические кости игры и свёртка весов MakeHuman (163 кости) на них.

import { GAME } from './fit.mjs';

const FINGERS = { thumb: '1', index: '2', middle: '3', ring: '4', pinky: '5' };

/** Список логических костей в порядке индексов skinIndex: [имя, родитель]. */
export function logicalBones() {
  const out = [['root', null], ['hips', 'root'], ['spine', 'hips'], ['chest', 'spine'], ['neck', 'chest'], ['head', 'neck']];
  for (const s of ['L', 'R']) {
    out.push([`shoulder${s}`, 'chest'], [`upperArm${s}`, `shoulder${s}`], [`lowerArm${s}`, `upperArm${s}`], [`hand${s}`, `lowerArm${s}`]);
    out.push([`upperLeg${s}`, 'hips'], [`lowerLeg${s}`, `upperLeg${s}`], [`foot${s}`, `lowerLeg${s}`], [`toe${s}`, `foot${s}`]);
    for (const f of Object.keys(FINGERS)) {
      out.push([`${f}1${s}`, `hand${s}`], [`${f}2${s}`, `${f}1${s}`], [`${f}3${s}`, `${f}2${s}`]);
    }
  }
  return out;
}

/** Имя логической кости для кости MakeHuman. */
export function logicalOf(mh) {
  const side = mh.endsWith('.L') ? 'L' : mh.endsWith('.R') ? 'R' : '';
  const n = mh.replace(/\.[LR]$/, '');
  if (n === 'root' || n === 'spine05') return 'hips';
  if (n.startsWith('pelvis')) return 'hips';
  if (n === 'spine04' || n === 'spine03') return 'spine';
  if (n === 'spine02' || n === 'spine01' || n.startsWith('breast')) return 'chest';
  if (n.startsWith('neck')) return 'neck';
  if (n === 'clavicle' || n === 'shoulder01') return 'shoulder' + side;
  if (n.startsWith('upperarm')) return 'upperArm' + side;
  if (n.startsWith('lowerarm')) return 'lowerArm' + side;
  if (n === 'wrist' || n.startsWith('metacarpal')) return 'hand' + side;
  let m = n.match(/^finger(\d)-(\d)$/);
  if (m) {
    const name = Object.keys(FINGERS).find((k) => FINGERS[k] === m[1]);
    return `${name}${m[2]}${side}`;
  }
  if (n.startsWith('upperleg')) return 'upperLeg' + side;
  if (n.startsWith('lowerleg')) return 'lowerLeg' + side;
  if (n === 'foot') return 'foot' + side;
  if (n.startsWith('toe')) return 'toe' + side;
  return 'head'; // голова, челюсть, язык, глаза, мимические кости
}

/** Свернуть веса MH на логические кости, оставить 4 сильнейших. Возвращает по вершинам {b: Int, w: Float} (до 4). */
export function collapseWeights(W, boneIndex) {
  return W.map((list) => {
    const acc = new Map();
    for (const [bone, w] of list) {
      const li = boneIndex.get(logicalOf(bone));
      acc.set(li, (acc.get(li) ?? 0) + w);
    }
    return acc;
  });
}

export function top4(map) {
  const arr = [...map.entries()].filter(([, w]) => w > 1e-5).sort((a, b) => b[1] - a[1]).slice(0, 4);
  const sum = arr.reduce((s, [, w]) => s + w, 0) || 1;
  const b = [0, 0, 0, 0], w = [0, 0, 0, 0];
  arr.forEach(([i, x], k) => { b[k] = i; w[k] = x / sum; });
  return { b, w };
}

/** Мировые позиции логических костей в позе покоя. */
export function restPositions(pf) {
  const mirror = (p, s) => [p[0] * (s === 'L' ? 1 : -1), p[1], p[2]];
  const pos = {
    root: [0, 0, 0], hips: GAME.hips, spine: GAME.spine, chest: GAME.chest, neck: GAME.neck, head: GAME.head,
  };
  for (const s of ['L', 'R']) {
    pos['shoulder' + s] = mirror(GAME.shoulder, s);
    pos['upperArm' + s] = mirror(GAME.upperArm, s);
    pos['lowerArm' + s] = mirror(GAME.lowerArm, s);
    pos['hand' + s] = mirror(GAME.hand, s);
    pos['upperLeg' + s] = mirror(GAME.upperLeg, s);
    pos['lowerLeg' + s] = mirror(GAME.lowerLeg, s);
    pos['foot' + s] = mirror(GAME.foot, s);
    pos['toe' + s] = mirror(GAME.toe, s);
    for (const [name, k] of Object.entries(FINGERS)) {
      for (let i = 1; i <= 3; i++) pos[`${name}${i}${s}`] = pf.xf[`finger${k}-${i}.${s}`].H.slice();
    }
  }
  return pos;
}

/** Кончики пальцев (мировые): для справки и для рук-ИК. */
export function fingerTips(pf) {
  const out = {};
  for (const s of ['L', 'R']) for (const [name, k] of Object.entries(FINGERS)) out[`${name}${s}`] = pf.xf[`finger${k}-3.${s}`].apply(pf.src[`finger${k}-3.${s}`].t);
  return out;
}
