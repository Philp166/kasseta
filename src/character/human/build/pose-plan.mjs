// План позы: какие цели у каких костей MakeHuman. Использует PoseFit (fit.mjs).

import { v3, m3, deg } from './lin.mjs';
import { GAME } from './fit.mjs';

const mir = (p, sx) => [p[0] * sx, p[1], p[2]];
const along = (a, b, t) => v3.lerp(a, b, t);

export const POSE_DEFAULTS = {
  // сгибание пальцев (градусы) по фалангам: проксимальная, средняя, дистальная
  flex: { thumb: [10, 14, 10], index: [16, 24, 12], middle: [22, 30, 14], ring: [28, 34, 16], pinky: [34, 38, 18] },
  forearmTwist: [0.22, 0.6],
  handFlex: 7,          // наклон кисти вперёд, градусы
  thumbOffset: 20,      // угол большого пальца от указательного, градусы
  spreadKeep: 0.3,      // доля исходного «веера» пальцев
};

/**
 * @param pf PoseFit
 * @param ctx { head: {dy,dz}, torsoMap(p)->p, yHip, ySh }
 */
export function planPose(pf, ctx, opts = {}) {
  const O = { ...POSE_DEFAULTS, ...opts };
  const S = pf.src;
  const done = new Set();
  const fit = (n, args) => { pf.fit(n, args); done.add(n); };
  const inh = (n) => { pf.inherit(n); done.add(n); };

  // ---- Позвоночник и таз: вертикальная карта ----
  const tm = ctx.torsoMap;
  for (const n of ['root', 'spine05', 'spine04', 'spine03', 'spine02', 'spine01']) {
    fit(n, { head: tm(S[n].h), tail: tm(S[n].t) });
  }
  inh('breast.L'); inh('breast.R');

  // ---- Шея и голова ----
  const headJoint = S['head'].h;
  const headT = v3.add(headJoint, [0, ctx.head.dy, ctx.head.dz]);
  const nk = ['neck01', 'neck02', 'neck03'];
  const pts = [S.neck01.h, S.neck02.h, S.neck03.h, S.neck03.t];
  const cum = [0]; for (let i = 1; i < 4; i++) cum.push(cum[i - 1] + v3.dist(pts[i], pts[i - 1]));
  const T0 = tm(pts[0]);
  const tg = pts.map((_, i) => (i === 0 ? T0 : i === 3 ? headT : along(T0, headT, cum[i] / cum[3])));
  nk.forEach((n, i) => fit(n, { head: tg[i], tail: tg[i + 1] }));
  // голова: поворота нет, только сдвиг по ориентирам (глаза/подбородок/макушка)
  pf.frame('head', { head: headT, R: m3.I() }); done.add('head');
  // всё, что внутри головы, наследует (лицо, челюсть, язык, глаза)
  const inSub = (root) => {
    const kids = Object.keys(pf.bones).filter((k) => pf.bones[k].parent === root);
    for (const k of kids) { if (!done.has(k)) { inh(k); } inSub(k); }
  };
  inSub('head');

  // ---- Ноги и руки (обе стороны) ----
  for (const sx of [1, -1]) {
    const L = sx > 0 ? '.L' : '.R';
    const dyA = [0, ctx.ankleDy || 0, 0];
    const hip = mir(GAME.upperLeg, sx), knee = mir(GAME.lowerLeg, sx), ankle = v3.add(mir(GAME.foot, sx), dyA), toe = v3.add(mir(GAME.toe, sx), dyA);

    // таз → бедро
    fit('pelvis' + L, { head: tm(S['pelvis' + L].h), tail: hip });
    const u1 = v3.dist(S['upperleg01' + L].h, S['upperleg01' + L].t), u2 = v3.dist(S['upperleg02' + L].h, S['upperleg02' + L].t);
    fit('upperleg01' + L, { head: hip, tail: along(hip, knee, u1 / (u1 + u2)) });
    fit('upperleg02' + L, { tail: knee });
    const l1 = v3.dist(S['lowerleg01' + L].h, S['lowerleg01' + L].t), l2 = v3.dist(S['lowerleg02' + L].h, S['lowerleg02' + L].t);
    fit('lowerleg01' + L, { head: knee, tail: along(knee, ankle, l1 / (l1 + l2)) });
    fit('lowerleg02' + L, { tail: ankle });
    // стопа: репер (ось пятка→плюсна, поперечная ось) → параллельно, подошва горизонтально
    const mt = ['1', '2', '3', '4', '5'].map((k) => S[`toe${k}-1${L}`].h);
    const C = mt.reduce((a, p) => v3.add(a, p), [0, 0, 0]).map((x) => x / 5);
    const aSrc = v3.sub(C, S['foot' + L].h);
    const lSrc = v3.sub(mt[4], mt[0]);                  // от большого пальца к мизинцу
    const aTgt = v3.sub(toe, ankle);
    const lTgt = [sx, 0, 0];
    const Rf = m3.frameAlign(v3.norm(aSrc), lSrc, v3.norm(aTgt), lTgt);
    // масштаб стопы вдоль оси — к целевой длине (до плюсны)
    const sf = Math.min(1.08, Math.max(0.8, v3.len(aTgt) / v3.len(aSrc)));
    const xfFoot = pf.frame('foot' + L, { head: ankle, R: Rf });
    xfFoot.a = v3.norm(aSrc); xfFoot.s = sf; xfFoot.M = null; done.add('foot' + L);
    pf.report.push({ bone: 'foot' + L, scale: sf, len: v3.len(aSrc), lenT: v3.len(aTgt) });
    inSub('foot' + L);

    // ключица → плечо
    const sh = mir(GAME.shoulder, sx), ua = mir(GAME.upperArm, sx), el = mir(GAME.lowerArm, sx), wr = mir(GAME.hand, sx);
    const c1 = v3.dist(S['clavicle' + L].h, S['clavicle' + L].t), c2 = v3.dist(S['shoulder01' + L].h, S['shoulder01' + L].t);
    const clT = along(sh, ua, c1 / (c1 + c2));
    fit('clavicle' + L, { head: sh, tail: clT });
    fit('shoulder01' + L, { tail: ua });
    const a1 = v3.dist(S['upperarm01' + L].h, S['upperarm01' + L].t), a2 = v3.dist(S['upperarm02' + L].h, S['upperarm02' + L].t);
    fit('upperarm01' + L, { head: ua, tail: along(ua, el, a1 / (a1 + a2)) });
    fit('upperarm02' + L, { tail: el });

    // предплечье: сначала без скручивания, чтобы измерить нужное скручивание кисти
    const f1 = v3.dist(S['lowerarm01' + L].h, S['lowerarm01' + L].t), f2 = v3.dist(S['lowerarm02' + L].h, S['lowerarm02' + L].t);
    const midT = along(el, wr, f1 / (f1 + f2));
    // репер кисти: исходный
    const Wh = S['wrist' + L].h;
    const mcp = ['2', '3', '4', '5'].map((k) => S[`finger${k}-1${L}`].h);
    const mcpC = mcp.reduce((a, p) => v3.add(a, p), [0, 0, 0]).map((x) => x / 4);
    const aH = v3.norm(v3.sub(mcpC, Wh));
    const tH = v3.sub(mcp[0], mcp[3]);                  // от мизинца к указательному (в сторону большого пальца)
    const dFa = v3.norm(v3.sub(wr, el));
    const hf = deg(O.handFlex);
    const aHT = v3.norm([dFa[0], dFa[1], dFa[2] + Math.tan(hf) * Math.abs(dFa[1])]);
    const RH = m3.frameAlign(aH, tH, aHT, [0, 0, 1]);
    // скручивание: насколько кисть повёрнута вокруг оси предплечья относительно «нескрученного» предплечья
    // пробное предплечье
    const backup = { l1: pf.xf['lowerarm01' + L], l2: pf.xf['lowerarm02' + L] };
    fit('lowerarm01' + L, { head: el, tail: midT });
    fit('lowerarm02' + L, { tail: wr });
    const Rfa0 = pf.xf['lowerarm02' + L].R;
    const twist = m3.twistAngle(m3.mul(RH, m3.T(Rfa0)), dFa);
    pf.report.push({ bone: 'forearmTwist' + L, scale: twist * 180 / Math.PI, len: 0, lenT: 0 });
    // окончательное предплечье со скручиванием по длине
    const [k1, k2] = O.forearmTwist;
    fit('lowerarm01' + L, { head: el, tail: midT, roll: twist * k1 });
    fit('lowerarm02' + L, { tail: wr, roll: twist * (k2 - k1) });
    void backup;
    pf.frame('wrist' + L, { head: wr, R: RH }); done.add('wrist' + L);

    // пястные кости — жёстко с кистью
    for (const k of ['1', '2', '3', '4']) inh(`metacarpal${k}${L}`);

    // пальцы: сведение (меньше «веера»), приведение большого пальца, затем сгибание вокруг оси u = a × n (к ладони)
    const aT = aHT, tT = [0, 0, 1];
    const tOrt = v3.norm(v3.sub(tT, v3.mul(aT, v3.dot(aT, tT))));
    const nPalm = sx > 0 ? v3.cross(aT, tOrt) : v3.cross(tOrt, aT);   // ладонь: к бедру
    const uAxis = v3.norm(v3.cross(aT, nPalm));
    const wx = pf.xf['wrist' + L];
    const fdir = (k) => v3.norm(v3.sub(wx.apply(S[`finger${k}-3${L}`].t), wx.apply(S[`finger${k}-1${L}`].h)));
    const dMid = fdir('3');
    const fingers = { thumb: '1', index: '2', middle: '3', ring: '4', pinky: '5' };
    for (const [name, k] of Object.entries(fingers)) {
      let swing = m3.I();
      if (name === 'thumb') {
        const dIx = fdir('2');
        const side = v3.norm(v3.add(v3.mul(tOrt, 0.8), v3.mul(nPalm, 0.6)));
        const ang = deg(O.thumbOffset);
        const goal = v3.norm(v3.add(v3.mul(dIx, Math.cos(ang)), v3.mul(side, Math.sin(ang))));
        swing = m3.between(fdir('1'), goal);
      } else if (name !== 'middle') {
        const dk = fdir(k);
        const c = Math.max(-1, Math.min(1, v3.dot(dk, dMid)));
        const axis = v3.cross(dk, dMid);
        if (v3.len(axis) > 1e-6) swing = m3.axisAngle(axis, Math.acos(c) * (1 - O.spreadKeep));
      }
      O.flex[name].forEach((ang, i) => {
        const b = `finger${k}-${i + 1}${L}`;
        const flex = m3.axisAngle(uAxis, deg(ang));
        pf.localRotate(b, i === 0 ? m3.mul(flex, swing) : flex); done.add(b);
      });
    }
  }

  // всё остальное, что не задано — наследует родителя
  for (const n of pf.order) if (!done.has(n)) { pf.inherit(n); done.add(n); }
}
