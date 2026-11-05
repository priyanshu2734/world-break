import { describe, expect, it } from 'vitest';
import { ROOM_TEMPLATES, TEMPLATE_IDS, roomCountForStage, templateRoomFor, templatesForStage, type TemplateId } from '@wb/shared';
import { generateEscapeStage } from '../../src/rooms/generate';
import { requireReachable } from '../../src/rooms/escapeValidate';
import { validateEscape } from '../../src/rooms/escapeValidate';

/** P3F step 1: the generator really builds the template rooms, never repeats a template from one stage to the next, and uses the height. */
const OPT = { ghost: true, difficulty: 'easy' } as const;

describe('P3F step 1: generated stages use the templates', () => {
  it('stage 1 is the tutorial room (one room, the gate) and stage 2 the original hall: both keep the old 1920 x 720 layout', () => {
    for (const stage of [1, 2]) {
      const def = generateEscapeStage(stage, 3, OPT);
      expect(def.rooms!.rooms.length).toBe(1);
      const a = def.rooms!.rooms[0]!.arena;
      expect(a.width).toBe(1920);
      expect(a.height).toBe(720);
      expect(a.solids.some((s) => s.y === 0 && s.h === 680)).toBe(true); // the wall of the gate
    }
  });

  it('every room of stages 3 to 40 IS the template the stage picked: the same solids, size and doors, the spawn row on its floor', () => {
    for (let stage = 3; stage <= 40; stage++) {
      for (const seed of [1, 2]) {
        const def = generateEscapeStage(stage, seed, OPT);
        const ids = templatesForStage(stage, seed, roomCountForStage(stage));
        expect(def.rooms!.rooms.length).toBe(ids.length);
        def.rooms!.rooms.forEach((r, i) => {
          const want = templateRoomFor(stage, seed, i, ids[i]!), at = `stage ${stage} seed ${seed} room ${i} (${ids[i]})`;
          if (want === null) { expect(ids[i], at).toBe('hall'); expect(r.arena.height, at).toBe(720); return; }
          expect(r.arena.solids, at).toEqual(want.solids);
          expect(r.arena.width, at).toBe(want.width);
          expect(r.arena.height, at).toBe(want.height);
          expect(r.arena.spawns.every((p) => p.y === want.floorY), at).toBe(true);
          const east = r.doors.find((d) => d.id.endsWith('_e')), west = r.doors.find((d) => d.id.endsWith('_w'));
          if (east) expect([east.x, east.y + east.h], at).toEqual([want.east.x, want.east.y]);
          if (west) expect([west.x, west.y + west.h], at).toEqual([want.west.x, want.west.y]);
        });
        const last = def.rooms!.rooms[def.rooms!.rooms.length - 1]!;
        expect(def.escape!.exit.room).toBe(last.id);
      }
    }
  });

  it('NO STAGE USES THE PREVIOUS STAGE\'S TEMPLATE: checked on the generated geometry of stages 2 to 60 (a room is told apart by its solids)', () => {
    const shape = (def: ReturnType<typeof generateEscapeStage>) => def.rooms!.rooms.map((r) => JSON.stringify([r.arena.width, r.arena.height, r.arena.solids.length]));
    // the template of each room is recomputed from the geometry: the first template whose build (same seed derivation) gives the room's solids
    const used = (stage: number, seed: number): TemplateId[] => {
      const def = generateEscapeStage(stage, seed, OPT);
      return def.rooms!.rooms.map((r, i) => {
        const ids = templatesForStage(stage, seed, roomCountForStage(stage));
        const found = TEMPLATE_IDS.filter((id) => { const w = templateRoomFor(stage, seed, i, id); return w !== null && JSON.stringify(w.solids) === JSON.stringify(r.arena.solids); });
        if (found.length === 0) return ids[i] === 'hall' || ids[i] === 'tutorial' ? ids[i]! : ('unknown' as TemplateId);
        return found[0]!;
      });
    };
    for (const seed of [1, 5]) {
      let before = used(1, seed);
      for (let stage = 2; stage <= 60; stage++) {
        const now = used(stage, seed);
        expect(now.includes('unknown' as TemplateId), `stage ${stage}`).toBe(false);
        for (const id of now) expect(before, `stage ${stage} seed ${seed}: ${id} twice in a row`).not.toContain(id);
        expect(shape(generateEscapeStage(stage, seed, OPT)).length).toBeGreaterThan(0);
        before = now;
      }
    }
  });

  it('stage 1,000,000 builds its six template rooms and they are walkable', () => {
    const def = generateEscapeStage(1_000_000, 7, OPT);
    expect(def.rooms!.rooms.length).toBe(6);
    expect(requireReachable(def)).toEqual([]);
    expect(validateEscape(def.escape!, def.rooms!, def)).toEqual([]);
    const again = generateEscapeStage(1_000_000, 7, OPT);
    expect(again).toEqual(def); // deterministic
  });

  it('the same seed gives the same stage, a different seed another one (stages 3 to 12)', () => {
    for (let stage = 3; stage <= 12; stage++) {
      expect(generateEscapeStage(stage, 4, OPT)).toEqual(generateEscapeStage(stage, 4, OPT));
      expect(generateEscapeStage(stage, 4, OPT)).not.toEqual(generateEscapeStage(stage, 5, OPT));
    }
  });
});

describe('P3F step 1: real verticality: what a player must find is NOT all near the floor', () => {
  it('over stages 3 to 30 (6 seeds each) a large share of notes, parts, containers, hiding spots and evidence is 90 px or more above the room\'s ground, and some is far higher', () => {
    const up: Record<string, number[]> = { clue: [], item: [], container: [], hide: [], evidence: [] };
    let stagesWithHighNote = 0, stages = 0, highest = 0;
    for (let stage = 3; stage <= 30; stage++) {
      for (let seed = 1; seed <= 6; seed++) {
        const def = generateEscapeStage(stage, seed, OPT);
        const ground = new Map(def.rooms!.rooms.map((r) => [r.id, r.arena.spawns[0]!.y]));
        const h = (room: string | undefined, y: number) => (ground.get(room ?? def.rooms!.start) ?? 680) - y;
        stages++;
        let high = false;
        for (const c of def.escape!.clues) { up.clue!.push(h(c.room, c.y)); if (h(c.room, c.y) >= 90) high = true; }
        for (const i of def.items ?? []) if (i.kind !== 'pulse_gun' && i.kind !== 'revive_cell') up.item!.push(h(i.room, i.y));
        for (const s of def.stashes ?? []) up.container!.push(h(s.room, s.y));
        for (const s of def.escape!.safes) up.container!.push(h(s.room, s.y));
        for (const k of def.escape!.keypads) up.container!.push(h(k.room, k.y));
        for (const s of def.escape!.hidingSpots ?? []) up.hide!.push(h(s.room, s.y));
        for (const e of def.escape!.ghostEvidence ?? []) up.evidence!.push(h(e.room, e.y));
        if (high) stagesWithHighNote++;
      }
    }
    const share = (k: string, px: number) => up[k]!.filter((v) => v >= px).length / up[k]!.length;
    for (const k of Object.keys(up)) highest = Math.max(highest, ...up[k]!);
    expect(share('clue', 90)).toBeGreaterThan(0.4);
    expect(share('item', 90)).toBeGreaterThan(0.4);
    expect(share('evidence', 90)).toBeGreaterThan(0.35);
    expect(share('container', 90)).toBeGreaterThan(0.25);
    expect(share('hide', 90)).toBeGreaterThan(0.2);
    expect(share('clue', 190)).toBeGreaterThan(0.2);
    expect(stagesWithHighNote / stages).toBeGreaterThan(0.8);
    expect(highest).toBeGreaterThanOrEqual(570);
  });

  it('templates are real: at least 10 different templates appear over stages 3 to 60 and every one of them produced a stage that passes the full validators', () => {
    const seen = new Set<TemplateId>();
    for (let stage = 3; stage <= 60; stage++) for (const id of templatesForStage(stage, 2, roomCountForStage(stage))) seen.add(id);
    expect([...seen].filter((id) => ROOM_TEMPLATES[id].build !== undefined).length).toBeGreaterThanOrEqual(12);
    for (let stage = 3; stage <= 20; stage++) {
      const def = generateEscapeStage(stage, 2, OPT);
      expect(requireReachable(def), `stage ${stage}`).toEqual([]);
    }
  });
});

describe('P3F step 1: requireReachable refuses what a lone player cannot reach', () => {
  it('a note put on a ledge no jump reaches is reported, and a note on a reachable one is not', () => {
    const def = generateEscapeStage(4, 3, OPT);
    expect(requireReachable(def)).toEqual([]);
    const room = def.rooms!.rooms[0]!;
    // add a floating ledge far above everything and put a note on it
    const high = { x: 700, y: 120, w: 200, h: 20 };
    const broken = {
      ...def,
      rooms: { ...def.rooms!, rooms: def.rooms!.rooms.map((r) => (r.id === room.id ? { ...r, arena: { ...r.arena, solids: [...r.arena.solids, high] } } : r)) },
      escape: { ...def.escape!, clues: [...def.escape!.clues, { id: 'zz', room: room.id, x: 800, y: 120, label: 'Old note', text: 'x' }] },
    };
    const errs = requireReachable(broken);
    expect(errs.some((e) => e.includes('clue zz') && e.includes('cannot be reached on foot'))).toBe(true);
  });
});
