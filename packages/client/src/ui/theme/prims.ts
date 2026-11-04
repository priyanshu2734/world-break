/** P3F step 5: drawing primitives as plain data (so the look of props and evidence markers is unit-tested without Phaser). Colours are 0xRRGGBB. */
export type Prim =
  | { t: 'rect'; x: number; y: number; w: number; h: number; c: number; a: number; line?: boolean }
  | { t: 'line'; x1: number; y1: number; x2: number; y2: number; c: number; a: number; w: number }
  | { t: 'circle'; x: number; y: number; r: number; c: number; a: number; line?: boolean };

export const rect = (x: number, y: number, w: number, h: number, c: number, a: number, line = false): Prim => ({ t: 'rect', x, y, w, h, c, a, ...(line ? { line } : {}) });
export const line = (x1: number, y1: number, x2: number, y2: number, c: number, a: number, w = 1): Prim => ({ t: 'line', x1, y1, x2, y2, c, a, w });
export const circle = (x: number, y: number, r: number, c: number, a: number, outline = false): Prim => ({ t: 'circle', x, y, r, c, a, ...(outline ? { line: true } : {}) });

/** The bounding box of a list of primitives. */
export function boundsOf(ps: readonly Prim[]): { x0: number; y0: number; x1: number; y1: number } {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  const add = (x: number, y: number) => { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); };
  for (const p of ps) {
    if (p.t === 'rect') { add(p.x, p.y); add(p.x + p.w, p.y + p.h); }
    else if (p.t === 'line') { add(p.x1, p.y1); add(p.x2, p.y2); }
    else { add(p.x - p.r, p.y - p.r); add(p.x + p.r, p.y + p.r); }
  }
  return { x0, y0, x1, y1 };
}
