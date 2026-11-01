import { describe, expect, it } from 'vitest';
import { ROOM_LIMITS, ROOM_TEMPLATES, TEMPLATE_IDS, createRng, deriveSeed, roomCountForStage, templatePool, templateRoomFor, templatesForStage, type TemplateId } from '../src';

/** P3F step 1: the room templates are pure data. These tests need no physics: the walking proofs are in server/test/rooms/templates.test.ts. */
const BUILT = TEMPLATE_IDS.filter((id) => ROOM_TEMPLATES[id].build !== undefined);

describe('P3F step 1: the room templates', () => {
  it('there are at least 12 templates built from data, plus the tutorial room and the original hall', () => {
    expect(BUILT.length).toBeGreaterThanOrEqual(12);
    expect(TEMPLATE_IDS).toContain('tutorial');
    expect(TEMPLATE_IDS).toContain('hall');
    expect(new Set(TEMPLATE_IDS).size).toBe(TEMPLATE_IDS.length);
  });

  it('every template, width and seed builds a room inside the room limits (size, solids, doors and exit inside the room)', () => {
    for (const id of BUILT) {
      const t = ROOM_TEMPLATES[id];
      for (const w of t.widths) {
        for (let seed = 1; seed <= 30; seed++) {
          const room = t.build!(w, createRng(deriveSeed(seed, 'shape', id)));
          const at = `${id} ${w} seed ${seed}`;
          expect(room.width, at).toBe(w);
          expect(room.width, at).toBeGreaterThanOrEqual(ROOM_LIMITS.minWidth);
          expect(room.width, at).toBeLessThanOrEqual(ROOM_LIMITS.maxWidth);
          expect(room.height, at).toBeGreaterThanOrEqual(ROOM_LIMITS.minHeight);
          expect(room.height, at).toBeLessThanOrEqual(ROOM_LIMITS.maxHeight);
          expect(room.solids.length, at).toBeLessThanOrEqual(ROOM_LIMITS.maxSolidsPerRoom);
          for (const s of room.solids) {
            expect(s.x, at).toBeGreaterThanOrEqual(0);
            expect(s.y, at).toBeGreaterThanOrEqual(0);
            expect(s.x + s.w, at).toBeLessThanOrEqual(room.width);
            expect(s.y + s.h, at).toBeLessThanOrEqual(room.height);
          }
          for (const p of [room.west, room.east, room.west.arrive, room.east.arrive, room.exit]) {
            expect(p.x, at).toBeGreaterThan(0);
            expect(p.x, at).toBeLessThan(room.width);
            expect(p.y, at).toBeGreaterThan(0);
            expect(p.y, at).toBeLessThanOrEqual(room.height);
          }
          // every surface lies on top of a solid it names
          for (const s of room.surfaces) {
            const solid = room.solids[s.solid]!;
            expect(Math.abs(solid.y - s.y), at).toBeLessThan(1e-6);
            expect(s.x0, at).toBeGreaterThanOrEqual(solid.x - 1e-6);
            expect(s.x1, at).toBeLessThanOrEqual(solid.x + solid.w + 1e-6);
            expect(s.x1 - s.x0, at).toBeGreaterThanOrEqual(0);
          }
        }
      }
    }
  });

  it('a template is a pure function of its inputs: the same width and seed give the same room', () => {
    for (const id of BUILT) {
      const t = ROOM_TEMPLATES[id];
      const a = t.build!(t.widths[0]!, createRng(5)), b = t.build!(t.widths[0]!, createRng(5));
      expect(b).toEqual(a);
    }
  });

  it('REAL VERTICALITY: at least 9 templates hold a surface 285 px or more above their floor, 2 reach 475 px, and 8 are taller than the 720 px screen', () => {
    let high = 0, tall = 0, towering = 0;
    for (const id of BUILT) {
      const t = ROOM_TEMPLATES[id];
      let most = 0, height = 0;
      for (const w of t.widths) for (let seed = 1; seed <= 10; seed++) {
        const room = t.build!(w, createRng(deriveSeed(seed, 'shape', id)));
        height = Math.max(height, room.height);
        for (const s of room.surfaces) most = Math.max(most, room.floorY - s.y);
      }
      if (most >= 285) high++;
      if (most >= 475) towering++;
      if (height > 720) tall++;
    }
    expect(high).toBeGreaterThanOrEqual(9);
    expect(towering).toBeGreaterThanOrEqual(2);
    expect(tall).toBeGreaterThanOrEqual(8);
  });

  it('every template offers floor-kind spots for the bulky things and ledge spots for the small ones (or crate tops)', () => {
    for (const id of BUILT) {
      const t = ROOM_TEMPLATES[id], room = t.build!(t.widths[0]!, createRng(3));
      expect(room.surfaces.filter((s) => s.kind === 'floor').length, id).toBeGreaterThanOrEqual(1);
      expect(room.surfaces.length, id).toBeGreaterThanOrEqual(3);
    }
  });
});

describe('P3F step 1: which template a stage uses', () => {
  it('stage 1 is the tutorial room and stage 2 the original hall', () => {
    expect(templatePool(1)).toEqual(['tutorial']);
    expect(templatePool(2)).toEqual(['hall']);
    expect(templatesForStage(1, 9, 1)).toEqual(['tutorial']);
    expect(templatesForStage(2, 9, 1)).toEqual(['hall']);
  });

  it('NO STAGE USES THE PREVIOUS STAGE\'S TEMPLATE: not one room of stage N shares a template with any room of stage N-1 (stages 2 to 300, 12 seeds, and the same seed for both)', () => {
    for (let stage = 2; stage <= 300; stage++) {
      for (let seed = 1; seed <= 12; seed++) {
        const now = templatesForStage(stage, seed, roomCountForStage(stage));
        const before = templatesForStage(stage - 1, seed, roomCountForStage(stage - 1));
        for (const id of now) expect(before, `stage ${stage} seed ${seed}: ${id}`).not.toContain(id);
        // and not even with a different seed: the claim is true by construction (odd and even pools), not by luck
        for (const other of [seed + 100, seed * 7919]) for (const id of templatesForStage(stage - 1, other, roomCountForStage(stage - 1))) expect(now, `stage ${stage}`).not.toContain(id);
      }
    }
  });

  it('inside one stage the rooms get different templates while the pool has enough of them', () => {
    for (let stage = 3; stage <= 100; stage++) {
      for (let seed = 1; seed <= 5; seed++) {
        const count = roomCountForStage(stage), pool = templatePool(stage);
        const ids = templatesForStage(stage, seed, count);
        expect(ids.length).toBe(count);
        expect(new Set(ids).size, `stage ${stage} seed ${seed}`).toBe(Math.min(count, pool.length));
      }
    }
  });

  it('the pools grow with the stage, every template can appear, and the choice is deterministic', () => {
    const seen = new Set<TemplateId>();
    for (let stage = 3; stage <= 60; stage++) for (const id of templatePool(stage)) seen.add(id);
    for (const id of TEMPLATE_IDS) if (id !== 'tutorial') expect(seen.has(id), id).toBe(true);
    expect(templatePool(3).length).toBeGreaterThanOrEqual(2);
    expect(templatePool(40).length).toBeGreaterThanOrEqual(5);
    for (let seed = 1; seed <= 5; seed++) expect(templatesForStage(17, seed, 3)).toEqual(templatesForStage(17, seed, 3));
  });

  it('stage 1,000,000 and 999,999 work and never share a template; a bad stage number is treated as stage 1', () => {
    const a = templatesForStage(1_000_000, 7, 6), b = templatesForStage(999_999, 7, 6);
    expect(a.length).toBe(6);
    for (const id of a) expect(b).not.toContain(id);
    expect(templatePool(Number.NaN)).toEqual(['tutorial']);
    expect(templatePool(-5)).toEqual(['tutorial']);
  });

  it('templateRoomFor is deterministic, built from its own generator, and null for the two rooms the original plan builds', () => {
    expect(templateRoomFor(5, 11, 0, 'tutorial')).toBeNull();
    expect(templateRoomFor(5, 11, 0, 'hall')).toBeNull();
    for (const id of BUILT) expect(templateRoomFor(9, 4, 1, id)).toEqual(templateRoomFor(9, 4, 1, id));
    expect(templateRoomFor(9, 4, 1, 'tower')!.id).toBe('tower');
  });
});
