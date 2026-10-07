export const CLASS: Record<string, number>;
export const CLASS_COLORS: number[][];
export const VOL: any;
export function segParam(p: number[], a: number[], b: number[]): { d: number; t: number };
export function isSkin(r: number, g: number, b: number): boolean;
export function classify(pos: Float32Array, col: Float32Array, vol?: any): Uint8Array;
