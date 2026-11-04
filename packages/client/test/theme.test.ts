import { describe, expect, it } from 'vitest';
import { PROP_MAX_ALPHA, THEME_IDS, themeColourOk, themeLook, type PropKind, type PropPlacement, type ThemeId } from '@wb/shared';
import { lookFlags, roomDecor, slabLook } from '../src/ui/theme/themeLogic';
import { propPrims } from '../src/ui/theme/propArt';
import { boundsOf } from '../src/ui/theme/prims';

const KINDS: PropKind[] = ['bench', 'rack', 'monitor', 'pipe', 'bed', 'curtain', 'drip', 'cabinet', 'gear', 'crates', 'vent', 'girder', 'shelf', 'books', 'ladder', 'desk'];
const SIZE: Record<PropKind, [number, number]> = {
  bench: [120, 46], rack: [60, 90], monitor: [50, 36], pipe: [200, 14], bed: [130, 40], curtain: [70, 120], drip: [24, 100], cabinet: [56, 80],
  gear: [70, 70], crates: [80, 64], vent: [60, 40], girder: [220, 18], shelf: [90, 150], books: [70, 30], ladder: [34, 130], desk: [110, 50],
};
const place = (kind: PropKind, shade: 0 | 1 | 2 = 0): PropPlacement => ({ kind, x: 300, y: 600, w: SIZE[kind][0], h: SIZE[kind][1], shade, alpha: 0.3 });
const calmLook = (id: ThemeId) => themeLook(id, { reducedMotion: true, assist: false });
const look = (id: ThemeId) => themeLook(id, { reducedMotion: false, assist: false });

describe('P3F step 5: reduced-motion flag', () => {
  it('is on for the browser setting, ?reducemotion=1 or the older ?reduceflash=1, and off otherwise', () => {
    expect(lookFlags('', false).reducedMotion).toBe(false);
    expect(lookFlags('', true).reducedMotion).toBe(true);
    expect(lookFlags('?reducemotion=1', false).reducedMotion).toBe(true);
    expect(lookFlags('?reduceflash=1', false).reducedMotion).toBe(true);
    expect(lookFlags('?reducemotion=0', false).reducedMotion).toBe(false);
  });
});

describe('P3F step 5: prop art', () => {
  it('every kind draws something inside (about) its box, at an alpha no higher than the cap, in the theme\'s own colours', () => {
    for (const kind of KINDS) for (const id of THEME_IDS) {
      const p = place(kind, 2), ps = propPrims(id, p);
      expect(ps.length, kind).toBeGreaterThan(0);
      const b = boundsOf(ps);
      expect(b.x0, kind).toBeGreaterThanOrEqual(p.x - 8);
      expect(b.x1, kind).toBeLessThanOrEqual(p.x + p.w + 8);
      expect(b.y1, kind).toBeLessThanOrEqual(p.y + 8);
      expect(b.y0, kind).toBeGreaterThanOrEqual(p.y - p.h - 20);
      for (const q of ps) { expect(q.a).toBeLessThanOrEqual(PROP_MAX_ALPHA); expect(q.a).toBeGreaterThan(0); expect(themeColourOk(q.c)).toBe(true); }
    }
  });
  it('the brightness assist raises the alpha but never above the cap', () => {
    for (const kind of KINDS) {
      const p = { ...place(kind), alpha: 0.38 };
      for (const q of propPrims('lab', p, 1.4)) expect(q.a).toBeLessThanOrEqual(PROP_MAX_ALPHA);
    }
  });
  it('different kinds look different', () => {
    const shapes = new Set(KINDS.map((k) => JSON.stringify(propPrims('lab', place(k)))));
    expect(shapes.size).toBe(KINDS.length);
  });
});

describe('P3F step 5: a room\'s decor and the platforms', () => {
  const size = { w: 2240, h: 720, floorY: 680 };
  it('the same room under the same theme is drawn the same; another theme or setting draws something else', () => {
    for (const id of THEME_IDS) {
      const a = roomDecor(id, 'r0', 4, size, look(id)), b = roomDecor(id, 'r0', 4, size, look(id));
      expect(a).toEqual(b);
      expect(a.wash.color).toBeGreaterThanOrEqual(0);
      expect(a.placements.length).toBeGreaterThanOrEqual(3);
    }
    expect(roomDecor('lab', 'r0', 4, size, look('lab')).props).not.toEqual(roomDecor('factory', 'r0', 4, size, look('factory')).props);
    const assist = themeLook('lab', { reducedMotion: false, assist: true });
    expect(roomDecor('lab', 'r0', 4, size, assist).wash.alpha).toBeLessThanOrEqual(roomDecor('lab', 'r0', 4, size, look('lab')).wash.alpha);
  });
  it('the wash is faint and every prim is at most the cap, in every theme', () => {
    for (const id of THEME_IDS) {
      const d = roomDecor(id, 'room', 9, size, look(id));
      expect(d.wash.alpha).toBeLessThanOrEqual(0.15);
      for (const q of d.props) expect(q.a).toBeLessThanOrEqual(PROP_MAX_ALPHA);
    }
  });
  it('platform slabs take the theme palette, stay plain in the dark view, and keep the same rectangles (looks only)', () => {
    for (const id of THEME_IDS) {
      const lit = slabLook(id, false, look(id)), dark = slabLook(id, true, look(id));
      expect(lit.line).not.toBeNull();
      expect(dark.line).toBeNull();
      expect(themeColourOk(lit.fill) && themeColourOk(lit.edge)).toBe(true);
      expect(lit.edgeAlpha).toBeGreaterThan(0.5);
      expect(calmLook(id).motion).toBe(false);
    }
  });
});
