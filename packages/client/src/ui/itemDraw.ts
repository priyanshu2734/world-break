import type Phaser from 'phaser';
import type { MarkerShape } from './itemView';

/** Draws one part silhouette centred on (x, y). `s` is the half-size in px. Outline only plus a soft fill, so shapes read on any background. */
export function drawShape(g: Phaser.GameObjects.Graphics, shape: MarkerShape, x: number, y: number, s: number, color: number, fill = 0.25): void {
  g.fillStyle(0x04101a, 1);
  g.lineStyle(2, color, 1);
  const poly = (pts: { x: number; y: number }[]) => { g.fillPoints(pts, true); g.fillStyle(color, fill).fillPoints(pts, true); g.strokePoints(pts, true); };
  switch (shape) {
    case 'bar': poly([{ x: x - s, y: y - s * 0.4 }, { x: x + s, y: y - s * 0.4 }, { x: x + s, y: y + s * 0.4 }, { x: x - s, y: y + s * 0.4 }]); g.lineBetween(x, y - s * 0.4, x, y + s * 0.4); break;
    case 'ring': g.fillCircle(x, y, s).fillStyle(color, fill).fillCircle(x, y, s).strokeCircle(x, y, s); g.strokeCircle(x, y, s * 0.45); break;
    case 'hex': poly([0, 1, 2, 3, 4, 5].map((i) => ({ x: x + s * Math.cos(Math.PI / 3 * i), y: y + s * Math.sin(Math.PI / 3 * i) }))); break;
    case 'spoke': g.fillCircle(x, y, s).fillStyle(color, fill).fillCircle(x, y, s).strokeCircle(x, y, s); g.lineBetween(x - s, y, x + s, y).lineBetween(x, y - s, x, y + s); break;
    case 'triangle': poly([{ x, y: y - s }, { x: x + s, y: y + s * 0.8 }, { x: x - s, y: y + s * 0.8 }]); break;
    case 'cell': poly([{ x: x - s * 0.55, y: y - s * 0.8 }, { x: x + s * 0.55, y: y - s * 0.8 }, { x: x + s * 0.55, y: y + s }, { x: x - s * 0.55, y: y + s }]); g.strokeRect(x - s * 0.2, y - s, s * 0.4, s * 0.2); break;
    case 'cross': poly([
      { x: x - s * 0.3, y: y - s }, { x: x + s * 0.3, y: y - s }, { x: x + s * 0.3, y: y - s * 0.3 }, { x: x + s, y: y - s * 0.3 }, { x: x + s, y: y + s * 0.3 }, { x: x + s * 0.3, y: y + s * 0.3 },
      { x: x + s * 0.3, y: y + s }, { x: x - s * 0.3, y: y + s }, { x: x - s * 0.3, y: y + s * 0.3 }, { x: x - s, y: y + s * 0.3 }, { x: x - s, y: y - s * 0.3 }, { x: x - s * 0.3, y: y - s * 0.3 },
    ]); break;
    case 'block': poly([{ x: x - s, y: y - s }, { x: x + s, y: y - s }, { x: x + s, y: y + s }, { x: x - s, y: y + s }]); g.strokeRect(x - s * 0.5, y - s * 0.5, s, s); break;
  }
}
