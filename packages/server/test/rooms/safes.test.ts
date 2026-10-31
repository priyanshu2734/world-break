import { describe, expect, it } from 'vitest';
import { ITEM_LIMITS, type Difficulty } from '@wb/shared';
import { generateEscapeStage } from '../../src/rooms/generate';
import { validateEscape } from '../../src/rooms/escapeValidate';
import type { StageDef } from '../../src/systems/stageDef';
import { drill } from '../death/drill';

/**
 * P4 step 6: safes. Every safe (the one a door needs, MANDATORY, and the optional one that holds the Pulse Gun) is solvable from inside its own room: its pages lie in
 * that room at random spots of it, they spell the combination, and what it holds is one genuine part of one hand.
 */
const STAGES = [6, 10, 12, 15, 20, 21, 24, 29, 50, 1_000_000];
const SEEDS = Array.from({ length: 16 }, (_, i) => i + 1);
const DIFFS: Difficulty[] = ['easy', 'intermediate', 'hardcore'];
const errsOf = (def: StageDef): string[] => validateEscape(def.escape!, def.rooms!, def);
const mandatory = (def: StageDef) => def.escape!.safes.filter((s) => def.escape!.links.some((l) => l.lock.type === 'safe' && l.lock.safeId === s.id));
const optional = (def: StageDef) => def.escape!.safes.filter((s) => !def.escape!.links.some((l) => l.lock.type === 'safe' && l.lock.safeId === s.id));

describe('P4 step 6: every page of a safe lies in the safe’s own room, at a random spot of it', () => {
  it('on every generated stage of the grid, every difficulty: all pages are in the safe’s room, on a standable spot, and spell the combination', () => {
    let safes = 0, pages = 0;
    for (const difficulty of DIFFS) for (const stage of STAGES) for (const seed of SEEDS) {
      const def = generateEscapeStage(stage, seed, { ghost: true, difficulty });
      expect(errsOf(def), `${difficulty} stage ${stage} seed ${seed}`).toEqual([]);
      for (const s of def.escape!.safes) {
        safes++;
        const ps = s.clueIds.map((id) => def.escape!.clues.find((c) => c.id === id)!);
        for (const p of ps) { pages++; expect(p.room, `${s.id} page ${p.id}`).toBe(s.room); }
        expect(ps.map((p) => p.text.match(/[0-9]/g)?.join('') ?? '').join('')).toBe(s.code);
        expect(new Set(s.clueIds).size).toBe(s.clueIds.length);
      }
    }
    expect(safes).toBeGreaterThan(300);
    expect(pages).toBeGreaterThanOrEqual(safes * 3);
  });
  it('the spots are random: across seeds the pages of a safe lie in many different places, and not all in a row at the same x', () => {
    const xs = new Set<number>();
    for (const seed of SEEDS) for (const s of generateEscapeStage(20, seed, { ghost: true }).escape!.safes) for (const id of s.clueIds) xs.add(generateEscapeStage(20, seed, { ghost: true }).escape!.clues.find((c) => c.id === id)!.x);
    expect(xs.size).toBeGreaterThan(12);
  });
  it('without the ghost option a safe door’s pages are in its room too (the rule is the stage’s, not the ghost’s)', () => {
    let n = 0;
    for (const stage of [10, 12, 20, 29]) for (const seed of SEEDS) {
      const def = generateEscapeStage(stage, seed);
      for (const s of mandatory(def)) { n++; for (const id of s.clueIds) expect(def.escape!.clues.find((c) => c.id === id)!.room).toBe(s.room); }
    }
    expect(n).toBeGreaterThan(5);
  });
});

describe('P4 step 6: safes are sometimes mandatory and sometimes optional', () => {
  it('a mandatory safe (a door needs it) holds the key that opens that door; the optional safe holds the Pulse Gun and no door needs it; both occur', () => {
    let mand = 0, opt = 0, stagesWithMand = 0, stagesWithOpt = 0, both = 0, total = 0;
    for (const stage of [10, 12, 15, 20, 21, 24, 29, 50]) for (const seed of SEEDS) {
      const def = generateEscapeStage(stage, seed, { ghost: true });
      total++;
      const m = mandatory(def), o = optional(def);
      for (const s of m) { mand++; expect(def.items!.find((i) => i.id === s.contains)!.kind).toBe('access_key'); }
      for (const s of o) { opt++; expect(def.items!.find((i) => i.id === s.contains)!.kind).toBe('pulse_gun'); }
      if (m.length > 0) stagesWithMand++;
      if (o.length > 0) stagesWithOpt++;
      if (m.length > 0 && o.length > 0) both++;
    }
    expect(mand).toBeGreaterThan(10);
    expect(opt).toBeGreaterThan(50);
    expect(stagesWithMand).toBeLessThan(total);   // not every stage: "sometimes"
    expect(stagesWithOpt).toBeLessThan(total + 1);
    expect(both).toBeGreaterThan(3);
  });
  it('a stage with a mandatory safe cannot be finished without opening it: its door has no other way, and its key lies nowhere else', () => {
    for (const stage of [10, 12, 20, 29]) for (const seed of SEEDS) {
      const def = generateEscapeStage(stage, seed, { ghost: true });
      for (const s of mandatory(def)) {
        const keys = def.items!.filter((i) => i.kind === 'access_key' && i.id === s.contains);
        expect(keys).toHaveLength(1);
        expect(keys[0]!.hidden?.reveal).toBe('interact');
        const link = def.escape!.links.find((l) => l.lock.type === 'safe' && l.lock.safeId === s.id)!;
        expect(link.doors.length).toBeGreaterThan(0);
      }
    }
  });
});

describe('P4 step 6: a mandatory safe is solved from inside its own room, solo, within 2 slots', () => {
  it('a lone player clears every grid stage that has a mandatory safe, never holding more than 2 parts', () => {
    let withSafe = 0, runs = 0;
    const bad: string[] = [];
    for (const stage of [10, 12, 15, 20, 21, 24, 29]) for (let seed = 1; seed <= 12; seed++) {
      const r = drill(stage, seed, 1, {});
      runs++;
      if (r.mandatorySafes > 0) withSafe++;
      if (!r.cleared || r.maxSlots > ITEM_LIMITS.carrySlots || r.error) bad.push(`stage ${stage} seed ${seed} (${r.mandatorySafes} mandatory safes): ${r.error || `slots ${r.maxSlots}`}`);
    }
    expect(bad).toEqual([]);
    expect(withSafe).toBeGreaterThanOrEqual(5); // the check really covered stages whose way out goes through a safe
    expect(runs).toBe(7 * 12);
  }, 600_000);
});

describe('P4 step 6: the validator refuses every way of breaking the rule', () => {
  const base = () => {
    for (let seed = 1; seed < 80; seed++) { const def = generateEscapeStage(12, seed, { ghost: true }); if (mandatory(def).length > 0) return def; }
    throw new Error('no stage with a mandatory safe');
  };
  it('a page in another room is rejected', () => {
    const def = base(), s = mandatory(def)[0]!;
    const other = def.rooms!.rooms.find((r) => r.id !== s.room)!;
    const floor = other.arena.solids.find((x) => x.w >= 300)!;
    const moved: StageDef = { ...def, escape: { ...def.escape!, clues: def.escape!.clues.map((c) => (c.id === s.clueIds[1] ? { ...c, room: other.id, x: floor.x + 100, y: floor.y } : c)) } };
    expect(errsOf(moved).join(' ')).toContain('not in the safe');
    expect(errsOf(def)).toEqual([]);
  });
  it('pages that do not spell the combination, a safe with no pages, and a safe whose key is a decoy are rejected', () => {
    const def = base(), s = mandatory(def)[0]!;
    const wrong: StageDef = { ...def, escape: { ...def.escape!, safes: def.escape!.safes.map((x) => (x.id === s.id ? { ...x, code: x.code === '000' ? '111' : '000' } : x)) } };
    expect(errsOf(wrong).join(' ')).toContain('do not spell');
    const none: StageDef = { ...def, escape: { ...def.escape!, safes: def.escape!.safes.map((x) => (x.id === s.id ? { ...x, clueIds: [] } : x)) } };
    expect(errsOf(none).join(' ')).toContain('no pages');
    const decoy: StageDef = { ...def, items: def.items!.map((i) => (i.id === s.contains ? { ...i, decoy: true } : i)) };
    expect(errsOf(decoy).length).toBeGreaterThan(0);
  });
  it('a mandatory safe that holds something that opens nothing, or two hands of it, is rejected', () => {
    const def = base(), s = mandatory(def)[0]!;
    const fuse: StageDef = { ...def, items: def.items!.map((i) => (i.id === s.contains ? { ...i, kind: 'fuse' as const } : i)) };
    expect(errsOf(fuse).join(' ')).toMatch(/must hold the key|genuine access_key/);
    const big: StageDef = { ...def, items: def.items!.map((i) => (i.id === s.contains ? { ...i, slots: 3 as never } : i)) };
    expect(errsOf(big).length).toBeGreaterThan(0);
  });
});
