import { describe, expect, it } from 'vitest';
import { CATCH_LIMITS, ESCAPE_LIMITS, ghostTuning, hidingSpotsForStage, type Difficulty } from '@wb/shared';
import { generateEscapeStage } from '../../src/rooms/generate';
import { validateEscape } from '../../src/rooms/escapeValidate';
import { Room } from '../../src/room';
import type { GameSim } from '../../src/game';

/**
 * P4 step 6: hiding spots follow the ghost tuning table (4 per room at the start, falling to 1), the generator uses THAT table (`ghostTuning`), not the older
 * `hidingSpotsForStage` placeholder, and a spot holds up to two players.
 */
const STAGES = [2, 10, 24, 50, 1_000_000];
const DIFFS: Difficulty[] = ['easy', 'intermediate', 'hardcore'];
const SEEDS = Array.from({ length: 12 }, (_, i) => i + 1);
const perRoom = (def: ReturnType<typeof generateEscapeStage>): number[] => def.rooms!.rooms.map((r) => (def.escape!.hidingSpots ?? []).filter((h) => h.room === r.id).length);

describe('P4 step 6: the tuning table itself', () => {
  it('starts at 4 spots per room, never rises with the stage, and ends at 1 on every difficulty (and at stage 1,000,000)', () => {
    for (const d of DIFFS) {
      let prev = Infinity;
      for (let stage = 2; stage <= 120; stage++) {
        const n = ghostTuning(d, stage).hidingSpotsPerRoom;
        expect(n).toBeLessThanOrEqual(prev);
        expect(n).toBeGreaterThanOrEqual(1);
        prev = n;
      }
      expect(ghostTuning(d, 2).hidingSpotsPerRoom).toBe(4);
      expect(ghostTuning(d, 50).hidingSpotsPerRoom).toBe(1);
      expect(ghostTuning(d, 1_000_000).hidingSpotsPerRoom).toBe(1);
    }
    // the table is slower on Easy than on Hardcore
    expect(ghostTuning('easy', 21).hidingSpotsPerRoom).toBeGreaterThan(ghostTuning('hardcore', 21).hidingSpotsPerRoom);
  });
});

describe('P4 step 6: the generator places exactly what the table says, per room, at stages 2, 10, 24, 50 and 1,000,000', () => {
  it('every room of every generated stage holds min(table value, the stage’s cap) spots, on every difficulty and seed', () => {
    let rooms = 0;
    const seen = new Map<string, Set<number>>();
    for (const d of DIFFS) for (const stage of STAGES) for (const seed of SEEDS) {
      const def = generateEscapeStage(stage, seed, { ghost: true, difficulty: d });
      const want = Math.max(1, Math.min(ghostTuning(d, stage).hidingSpotsPerRoom, Math.floor(ESCAPE_LIMITS.maxHidingSpots / def.rooms!.rooms.length)));
      for (const n of perRoom(def)) { rooms++; expect(n, `${d} stage ${stage} seed ${seed}`).toBe(want); }
      expect(validateEscape(def.escape!, def.rooms!, def)).toEqual([]);
      (seen.get(`${d}:${stage}`) ?? seen.set(`${d}:${stage}`, new Set()).get(`${d}:${stage}`)!).add(perRoom(def)[0]!);
    }
    expect(rooms).toBeGreaterThan(500);
    // and the numbers really are the table's: stage 2 holds 4 in its room, stage 50 and 1,000,000 hold 1 in each of theirs
    expect([...seen.get('easy:2')!]).toEqual([4]);
    expect([...seen.get('easy:50')!]).toEqual([1]);
    expect([...seen.get('hardcore:1000000')!]).toEqual([1]);
    expect([...seen.get('easy:10')!]).toEqual([3]);
    expect([...seen.get('hardcore:10')!]).toEqual([2]);
    expect([...seen.get('easy:24')!]).toEqual([2]);
    expect([...seen.get('hardcore:24')!]).toEqual([1]);
  });
  it('the generator uses the tuning table and NOT the older placeholder: wherever the two disagree the stage follows the table; without the ghost the old rule is untouched', () => {
    let disagree = 0;
    for (const d of DIFFS) for (const stage of STAGES) {
      const table = ghostTuning(d, stage).hidingSpotsPerRoom, old = hidingSpotsForStage(stage);
      if (table === old) continue;
      disagree++;
      for (const seed of SEEDS.slice(0, 4)) {
        const def = generateEscapeStage(stage, seed, { ghost: true, difficulty: d });
        const want = Math.min(table, Math.floor(ESCAPE_LIMITS.maxHidingSpots / def.rooms!.rooms.length));
        for (const n of perRoom(def)) { expect(n).toBe(want); expect(n).not.toBe(old); }
      }
    }
    expect(disagree).toBeGreaterThanOrEqual(10); // the five stages x three difficulties: the placeholder agrees with the table only in a few cells
    // the stage 1,000,000 and stage 50 placeholder says 2; the table says 1
    expect(hidingSpotsForStage(50)).toBe(2);
    expect(ghostTuning('easy', 50).hidingSpotsPerRoom).toBe(1);
    // a run WITHOUT the ghost keeps the placeholder (its stages are what they always were)
    for (const seed of SEEDS.slice(0, 6)) for (const n of perRoom(generateEscapeStage(50, seed))) expect(n).toBeLessThanOrEqual(hidingSpotsForStage(50));
  });
  it('hiding spots never take a slot an item needs: every spot stands on the floor, clear of every item, clue and other spot', () => {
    for (const d of DIFFS) for (const stage of STAGES) for (const seed of SEEDS.slice(0, 6)) {
      const def = generateEscapeStage(stage, seed, { ghost: true, difficulty: d });
      const spots = def.escape!.hidingSpots ?? [];
      for (const h of spots) {
        for (const o of spots) if (o !== h && o.room === h.room) expect(Math.abs(o.x - h.x)).toBeGreaterThanOrEqual(130);
        for (const i of def.items ?? []) if (i.room === h.room && i.y === h.y) expect(Math.abs(i.x - h.x), `${h.id} vs ${i.id}`).toBeGreaterThanOrEqual(60);
        for (const c of def.escape!.clues) if (c.room === h.room && c.y === h.y) expect(Math.abs(c.x - h.x), `${h.id} vs ${c.id}`).toBeGreaterThanOrEqual(60);
      }
    }
  });
});

describe('P4 step 6: through the Room (the difficulty reaches the generator) and a spot holds two players', () => {
  const sim = (r: Room) => (r as unknown as { sim: GameSim }).sim;
  const defOf = (r: Room) => (r as unknown as { engine: { def: ReturnType<typeof generateEscapeStage> } }).engine.def;
  function mk(stage: number, difficulty: Difficulty, players = 1, seed = 9): Room {
    const r = new Room('DETH', 3, seed, { escape: true, ghost: true, startStage: stage });
    r.difficulty = difficulty;
    for (let i = 0; i < players; i++) r.join(`p${i}`, `P${i}`);
    for (let i = 1; i < players; i++) r.setReady(`p${i}`, true);
    expect(r.start('p0').ok).toBe(true);
    for (let i = 0; i < 10 && r.phase !== 'playing'; i++) r.tick();
    return r;
  }
  it('a Room built for each stage and difficulty holds the table’s number of spots per room', () => {
    for (const d of DIFFS) for (const stage of STAGES) {
      const r = mk(stage, d);
      const def = defOf(r);
      const want = Math.max(1, Math.min(ghostTuning(d, stage).hidingSpotsPerRoom, Math.floor(ESCAPE_LIMITS.maxHidingSpots / def.rooms!.rooms.length)));
      expect(perRoom(def), `${d} stage ${stage}`).toEqual(def.rooms!.rooms.map(() => want));
      expect(r.stageRecord!.fallback).toBe(false);
    }
  });
  it('a spot holds up to two players: the first two hide in the same spot, the third is told it is full, and when one comes out the third can hide', () => {
    expect(CATCH_LIMITS.spotCapacity).toBe(2);
    const r = mk(2, 'easy', 3);
    const spot = defOf(r).escape!.hidingSpots![0]!;
    for (const id of ['p0', 'p1', 'p2']) sim(r).placeAt(id, spot.x, spot.y);
    for (let i = 0; i < 5; i++) r.tick();
    const h0 = r.ghostAction('p0', { action: 'hide' });
    for (let i = 0; i < 40; i++) r.tick(); // a hide or leave may be repeated only after a short wait (the server answers "Too fast.")
    const h1 = r.ghostAction('p1', { action: 'hide' });
    expect(h0, JSON.stringify(h0)).toMatchObject({ ok: true });
    expect(h1, JSON.stringify(h1)).toMatchObject({ ok: true });
    for (let i = 0; i < 40; i++) r.tick();
    const third = r.ghostAction('p2', { action: 'hide' });
    expect(third.ok).toBe(false);
    expect(r.catchSystem!.occupantsOf(spot.id)).toEqual(['p0', 'p1']);
    for (let i = 0; i < 40; i++) r.tick();
    const lv = r.ghostAction('p0', { action: 'leave' });
    for (let i = 0; i < 40; i++) r.tick(); expect(lv, JSON.stringify(lv)).toMatchObject({ ok: true });
    const h2 = r.ghostAction('p2', { action: 'hide' }); expect(h2, JSON.stringify(h2)).toMatchObject({ ok: true });
    expect(r.catchSystem!.occupantsOf(spot.id).sort()).toEqual(['p1', 'p2']);
  });
});
