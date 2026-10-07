export const FIT: any;
export const CLASS: Record<string, number>;
export function warp(x: number, y: number, z: number, F?: any): number[];
export function processShell(raw: { pos: Float32Array; nor?: Float32Array; uv: Float32Array; idx: Uint32Array; col: Float32Array }, F?: any): any;
export function weldedNormals(pos: Float32Array, idx: Uint32Array): Float32Array;
export function pushOut(pos: Float32Array, body: { pos: Float32Array; nor: Float32Array }, clearance?: number, range?: number): number;
