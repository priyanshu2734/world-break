import type Phaser from 'phaser';
import type { Prim } from './prims';

/** Draw primitives onto a Phaser Graphics (the only place the theme and evidence art touch Phaser). */
export function drawPrims(g: Phaser.GameObjects.Graphics, ps: readonly Prim[], dx = 0, dy = 0): void {
  for (const p of ps) {
    if (p.t === 'rect') { if (p.line) g.lineStyle(1, p.c, p.a).strokeRect(p.x + dx, p.y + dy, p.w, p.h); else g.fillStyle(p.c, p.a).fillRect(p.x + dx, p.y + dy, p.w, p.h); }
    else if (p.t === 'line') g.lineStyle(p.w, p.c, p.a).lineBetween(p.x1 + dx, p.y1 + dy, p.x2 + dx, p.y2 + dy);
    else if (p.line) g.lineStyle(1, p.c, p.a).strokeCircle(p.x + dx, p.y + dy, p.r);
    else g.fillStyle(p.c, p.a).fillCircle(p.x + dx, p.y + dy, p.r);
  }
}
