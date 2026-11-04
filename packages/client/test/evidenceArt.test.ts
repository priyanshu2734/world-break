import { describe, expect, it } from 'vitest';
import { EVIDENCE_KINDS } from '@wb/shared';
import { COLOR } from '../src/palette';
import { GLYPH_H, GLYPH_W, evidencePrims, glyphPrims, smudgePrims } from '../src/ui/theme/evidenceArt';
import { boundsOf, type Prim } from '../src/ui/theme/prims';

const X = 500, Y = 680;
const colourOf = (p: Prim): number => p.c;

describe('P3F step 5: evidence markers', () => {
  it('an unexamined trace looks the same whatever it is (the picture never tells the type) and carries the cyan "interactive" ring', () => {
    const a = evidencePrims(null, false, X, Y, 0, true);
    for (const k of EVIDENCE_KINDS) expect(evidencePrims(k, false, X, Y, 0, true)).toEqual(a);
    expect(a.some((p) => colourOf(p) === COLOR.cyan)).toBe(true);
    expect(a.some((p) => colourOf(p) === COLOR.green)).toBe(false);
  });
  it('an examined trace shows its own glyph and the green "done" tick; the six glyphs are all different', () => {
    const shapes = new Set<string>();
    for (const k of EVIDENCE_KINDS) {
      const ps = evidencePrims(k, true, X, Y, 0, true);
      expect(ps.some((p) => colourOf(p) === COLOR.green)).toBe(true);
      expect(ps.some((p) => colourOf(p) === COLOR.cyan)).toBe(false);
      shapes.add(JSON.stringify(glyphPrims(k, X, Y)));
    }
    expect(shapes.size).toBe(EVIDENCE_KINDS.length);
    expect(evidencePrims(null, true, X, Y, 0, true).length).toBeGreaterThan(smudgePrims(X, Y).length); // examined but the kind is not known here: the smudge plus the tick
  });
  it('every marker stays inside its 60 x 54 box above the floor line', () => {
    const cases: Prim[][] = [evidencePrims(null, false, X, Y, 0, true), ...EVIDENCE_KINDS.map((k) => evidencePrims(k, true, X, Y, 0, true))];
    for (const ps of cases) {
      const b = boundsOf(ps);
      expect(b.x0).toBeGreaterThanOrEqual(X - GLYPH_W / 2 - 2);
      expect(b.x1).toBeLessThanOrEqual(X + GLYPH_W / 2 + 2);
      expect(b.y0).toBeGreaterThanOrEqual(Y - GLYPH_H - 2);
      expect(b.y1).toBeLessThanOrEqual(Y + 4);
    }
  });
  it('the ring pulses with time, unless reduced motion asks for a steady one', () => {
    const at = (ms: number, calm: boolean) => JSON.stringify(evidencePrims(null, false, X, Y, ms, calm));
    expect(at(0, true)).toBe(at(1234, true));
    expect(at(0, false)).not.toBe(at(700, false));
  });
  it('colour language: glyph colours are never red, amber or green (only the tick is green, only the ring cyan)', () => {
    for (const k of EVIDENCE_KINDS) for (const p of glyphPrims(k, X, Y)) {
      expect([COLOR.danger, COLOR.amber, COLOR.green, COLOR.cyan]).not.toContain(colourOf(p));
      expect(p.a).toBeLessThanOrEqual(1);
    }
  });
});
