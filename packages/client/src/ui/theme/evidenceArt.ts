import { COLOR } from '../../palette';
import type { EvidenceKind } from '@wb/shared';
import { circle, line, rect, type Prim } from './prims';

/**
 * P3F step 5: the look of a ghost's traces (evidence markers). Original procedural art, drawn from lines and circles.
 * Before it is examined every trace looks the same (a faint smudge with a cyan ring: "interactive"), so the picture cannot tell the type; after the team examined it, it shows
 * what it is (its glyph, from the journal) and a green tick ("done"). The glyph box is 60 px wide and 50 px tall, standing on the line `y`.
 */
export const GLYPH_W = 60, GLYPH_H = 54;
const PALE = 0xdfe9f2, WET = 0x6f8fa6, DUST = 0xc9c2b8, SMUDGE = 0xb9a7ff;

export function glyphPrims(kind: EvidenceKind, x: number, y: number): Prim[] {
  switch (kind) {
    case 'cold_breath': return [circle(x - 10, y - 10, 5, PALE, 0.5), circle(x + 2, y - 22, 8, PALE, 0.42), circle(x - 4, y - 38, 10, PALE, 0.32), circle(x + 12, y - 30, 5, PALE, 0.4)];
    case 'faint_whisper': return [...[-18, -9, 0, 9, 18].map((dx, i) => line(x + dx, y - 25 - (3 - Math.abs(i - 2)) * 4, x + dx, y - 25 + (3 - Math.abs(i - 2)) * 4, PALE, 0.7, 2)), circle(x, y - 25, 24, PALE, 0.25, true)];
    case 'wet_footprints': return [circle(x - 12, y - 8, 6, WET, 0.75), ...[-16, -12, -8].map((dx) => circle(x + dx, y - 18, 2, WET, 0.75)), circle(x + 10, y - 22, 6, WET, 0.75), ...[6, 10, 14].map((dx) => circle(x + dx, y - 32, 2, WET, 0.75))];
    case 'single_dead_lamp': return [line(x, y, x, y - 34, DUST, 0.8, 3), rect(x - 12, y - 46, 24, 12, DUST, 0.8), line(x - 8, y - 44, x + 8, y - 36, 0x2a2f36, 0.9, 2), line(x + 8, y - 44, x - 8, y - 36, 0x2a2f36, 0.9, 2)];
    case 'scratched_walls': return [-14, 0, 14].map((dx) => line(x + dx - 6, y - 44, x + dx + 8, y - 4, DUST, 0.85, 3)).concat([line(x - 18, y - 30, x + 20, y - 24, DUST, 0.5, 1)]);
    case 'cracked_glass': return [circle(x, y - 24, 4, PALE, 0.9), ...Array.from({ length: 7 }, (_, i) => { const a = (i / 7) * Math.PI * 2 + 0.3, r = 18 + (i % 3) * 4; return line(x, y - 24, x + Math.cos(a) * r, y - 24 + Math.sin(a) * r * 0.9, PALE, 0.8, 1); }), circle(x, y - 24, 14, PALE, 0.35, true)];
  }
}

/** An unexamined trace: the same smudge for every type. */
export function smudgePrims(x: number, y: number): Prim[] {
  return [circle(x - 10, y - 6, 8, SMUDGE, 0.22), circle(x + 8, y - 10, 11, SMUDGE, 0.2), circle(x - 2, y - 20, 9, SMUDGE, 0.16), circle(x + 14, y - 4, 5, SMUDGE, 0.2)];
}

/**
 * The whole marker. `kind` is what the team learned by examining (null = not examined, or not known on this screen). The ring pulses unless `calm` (reduced motion).
 * `pulse` is the ring's alpha share (0.7 to 1), 1 when calm.
 */
export function evidencePrims(kind: EvidenceKind | null, examined: boolean, x: number, y: number, ms: number, calm: boolean): Prim[] {
  const pulse = calm ? 1 : 0.85 + 0.15 * Math.sin(ms / 420);
  if (!examined) return [...smudgePrims(x, y), circle(x, y - 22, 24, COLOR.cyan, 0.8 * pulse, true)];
  const body = kind !== null ? glyphPrims(kind, x, y) : smudgePrims(x, y);
  // the tick: green = done
  return [...body, line(x + 16, y - 46, x + 21, y - 41, COLOR.green, 0.95, 2), line(x + 21, y - 41, x + 29, y - 52, COLOR.green, 0.95, 2)];
}
