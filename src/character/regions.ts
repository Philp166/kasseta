// Регионы тела для системы повреждений. Каждая кость относится к одному региону;
// веса скиннинга вершины превращаются в веса регионов (атрибуты aRegA/aRegB для шейдера).

import { Rig } from './rig';

export const REGIONS = ['head', 'torso', 'armL', 'armR', 'legL', 'legR'] as const;
export type Region = (typeof REGIONS)[number];
export const REGION_INDEX: Record<Region, number> = { head: 0, torso: 1, armL: 2, armR: 3, legL: 4, legR: 5 };

export function regionOfBoneName(n: string): Region | null {
  if (n === 'root') return null;
  if (n === 'head' || n === 'neck' || n.startsWith('hair') || n.startsWith('ear')) return 'head';
  if (/^(shoulder|upperArm|lowerArm|hand)L$/.test(n)) return 'armL';
  if (/^(shoulder|upperArm|lowerArm|hand)R$/.test(n)) return 'armR';
  if (/^(upperLeg|lowerLeg|foot|toe)L$/.test(n)) return 'legL';
  if (/^(upperLeg|lowerLeg|foot|toe)R$/.test(n)) return 'legR';
  return 'torso'; // hips, spine, chest, подол, накидка, обереги, ремни
}

export function buildRegionMap(rig: Rig): Int8Array {
  const arr = new Int8Array(rig.list.length).fill(-1);
  rig.list.forEach((b, i) => {
    const r = regionOfBoneName(b.name);
    arr[i] = r ? REGION_INDEX[r] : -1;
  });
  return arr;
}
