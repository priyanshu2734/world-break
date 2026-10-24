import { describe, expect, it } from 'vitest';
import {
  ITEM_LIMITS, ROOM_LIMITS, StageStateSchema, TUTORIAL_AMBIENT_MIN, VIEW_WIDTH, ambientFor, locksForStage, roomCountForStage, validateRoomGraph, type Difficulty,
} from '@wb/shared';
import { attemptEscapeStage, generateEscapeStage, generateEscapeStageDetailed } from '../../src/rooms/generate';
import { validateEscape } from '../../src/rooms/escapeValidate';
import { StageEngine } from '../../src/systems/engine';
import { validateStageDef } from '../../src/systems/validate';
import type { StageDef } from '../../src/systems/stageDef';

const STAGES = [1, 2, 3, 4, 5, 6, 7, 9, 10, 12, 14, 15, 20, 24, 25, 39, 40, 41, 100, 1_000, 1_000_000];
const SEEDS = Array.from({ length: 40 }, (_, i) => (i + 1) * 7919);
const startArena = (d: StageDef) => d.rooms!.rooms.find((r) => r.id === d.rooms!.start)!.arena;

describe('P3D escape generator: every stage, every seed', () => {
  it('the FIRST attempt is valid for every tested stage and seed (a retry would be hiding a bug)', () => {
    for (const stage of STAGES) for (const seed of SEEDS) {
      const d = attemptEscapeStage(stage, seed, 0);
      expect(validateStageDef(d, startArena(d))).toEqual([]);
      expect(generateEscapeStageDetailed(stage, seed).attempts).toBe(1);
    }
  });

  it('room count, door count and size follow the stage table, at most 6 rooms, every room bigger than the screen', () => {
    for (const stage of STAGES) for (const seed of SEEDS.slice(0, 8)) {
      const d = generateEscapeStage(stage, seed), g = d.rooms!;
      expect(g.rooms.length).toBe(roomCountForStage(stage));
      expect(g.rooms.length).toBeLessThanOrEqual(ROOM_LIMITS.maxRooms);
      expect(validateRoomGraph(g)).toEqual([]);
      expect(d.escape!.links.length).toBe(g.rooms.length === 1 ? 1 : g.rooms.length - 1);
      for (const r of g.rooms) expect(r.arena.width).toBeGreaterThan(VIEW_WIDTH);
      expect(d.id).toBe(`escape_${stage}`);
      expect(d.objectives).toEqual([]);
      expect(d.dark).toBe(true);
    }
  });

  it('a different lock on every door: never the same type twice in a row, and only types the stage may use', () => {
    const seen = new Set<string>();
    for (const stage of STAGES) for (const seed of SEEDS) {
      const types = generateEscapeStage(stage, seed).escape!.links.map((l) => l.lock.type);
      for (let i = 1; i < types.length; i++) expect(types[i]).not.toBe(types[i - 1]);
      for (const t of types) { expect(locksForStage(stage)).toContain(t); seen.add(t); }
    }
    expect([...seen].sort()).toEqual(['code', 'key_item', 'power', 'safe', 'two_person']); // all five do occur
  });

  it('stage 1 is the tutorial: one room, one gate, one hidden key in a visible locker, an exit, high ambient, nothing else', () => {
    for (const seed of SEEDS) {
      const d = generateEscapeStage(1, seed);
      expect(d.rooms!.rooms.length).toBe(1);
      expect(d.escape!.links.map((l) => l.lock.type)).toEqual(['key_item']);
      const room = d.rooms!.rooms[0]!;
      expect(room.doors.length).toBe(2); // the two sides of one gate
      expect(room.doors.every((x) => x.to === room.id)).toBe(true);
      expect(d.items!.length).toBe(1);
      const key = d.items![0]!;
      expect(key.kind).toBe('access_key');
      expect(key.decoy).toBeUndefined();
      expect(key.hidden?.reveal).toBe('interact');
      expect(d.stashes!.length).toBe(1);
      expect(d.stashes![0]!.id).toBe(key.hidden!.stashId); // a locker you can see, with the key inside
      expect(d.escape!.clues).toEqual([]); expect(d.escape!.keypads).toEqual([]); expect(d.escape!.switches).toEqual([]); expect(d.escape!.safes).toEqual([]);
      expect(d.escape!.hidingSpots ?? []).toEqual([]);
      expect(d.ambientMin).toBe(TUTORIAL_AMBIENT_MIN);
      expect(room.arena.solids.length).toBe(2); // floor and the wall the gate is set into: nothing to climb
      expect(d.escape!.exit.x).toBeGreaterThan(room.doors[1]!.x); // the exit is behind the gate
      // the locker is in view from every spawn slot at the smallest vision reach (Hardcore, 300 px floor): a container is the first lesson
      for (const spawn of room.arena.spawns) expect(Math.abs(d.stashes![0]!.x - spawn.x)).toBeLessThanOrEqual(400);
    }
  });

  it('from stage 2 on there are decoys, hiding spots for the ghost, and clues; stage 1 has none of them', () => {
    let decoyParts = 0, noise = 0, hiding = 0;
    for (const stage of [2, 3, 5, 7, 12, 30, 40]) for (const seed of SEEDS.slice(0, 10)) {
      const d = generateEscapeStage(stage, seed);
      decoyParts += (d.items ?? []).filter((i) => i.decoy === true).length;
      noise += d.escape!.clues.filter((c) => /noise/.test(c.id)).length;
      hiding += d.escape!.hidingSpots?.length ?? 0;
      for (const r of d.rooms!.rooms) expect((d.escape!.hidingSpots ?? []).some((h) => h.room === r.id)).toBe(true); // every room has one
      expect((d.items ?? []).length).toBeLessThanOrEqual(ITEM_LIMITS.maxItemsPerStage);
    }
    expect(decoyParts).toBeGreaterThan(0); expect(noise).toBeGreaterThan(0); expect(hiding).toBeGreaterThan(0);
  });

  it('every decoy is a cracked look-alike of a part some lock needs; every genuine part has one', () => {
    for (const stage of [2, 8, 40]) for (const seed of SEEDS.slice(0, 10)) {
      const d = generateEscapeStage(stage, seed);
      for (const i of d.items ?? []) if (i.decoy) { expect(i.tell).toBe(true); expect(['access_key', 'battery']).toContain(i.kind); }
      const needsKey = d.escape!.links.some((l) => l.lock.type === 'key_item'), needsBattery = d.escape!.links.some((l) => l.lock.type === 'power');
      if (needsKey) expect((d.items ?? []).some((i) => i.kind === 'access_key' && i.decoy)).toBe(true);
      if (needsBattery) expect((d.items ?? []).some((i) => i.kind === 'battery' && i.decoy)).toBe(true);
    }
  });

  it('is deterministic in (stage, seed), differs between seeds and stages, and ids never repeat between seeds', () => {
    for (const stage of [1, 2, 9, 40]) {
      const a = JSON.stringify(generateEscapeStage(stage, 12345)), b = JSON.stringify(generateEscapeStage(stage, 12345));
      expect(a).toBe(b);
      expect(JSON.stringify(generateEscapeStage(stage, 12346))).not.toBe(a);
    }
    expect(JSON.stringify(generateEscapeStage(9, 5))).not.toBe(JSON.stringify(generateEscapeStage(10, 5)));
    const ids = new Set(SEEDS.map((s) => generateEscapeStage(5, s).rooms!.start));
    expect(ids.size).toBe(SEEDS.length); // a new room id per seed: a client never reuses a stale layout
  });

  it('stage 1,000,000 is generated like any other: 6 rooms, 5 locks, valid', () => {
    const d = generateEscapeStage(1_000_000, 99);
    expect(d.rooms!.rooms.length).toBe(6);
    expect(d.escape!.links.length).toBe(5);
    expect(validateStageDef(d, startArena(d))).toEqual([]);
    expect(() => generateEscapeStage(0, 1)).toThrow(/Invalid stage/);
    expect(() => generateEscapeStage(1.5, 1)).toThrow(/Invalid stage/);
  });
});

describe('P3D escape generator: ambient and what the engine publishes', () => {
  const modes: Difficulty[] = ['easy', 'intermediate', 'hardcore'];
  it('the published ambient is the stage table value at stages 1, 10, 100 and 1,000,000 (the tutorial is never darker than its minimum)', () => {
    for (const stage of [1, 10, 100, 1_000_000]) for (const difficulty of modes) {
      const d = generateEscapeStage(stage, 3);
      const st = StageStateSchema.parse(new StageEngine(d, ['p0'], { arena: startArena(d), difficulty, stage }).state());
      const table = ambientFor(difficulty, stage);
      expect(st.darkness?.ambient).toBe(stage === 1 ? Math.max(table, TUTORIAL_AMBIENT_MIN) : table);
    }
  });
  it('nothing private reaches the public state of a generated stage: no codes, no note text, no hiding spots', () => {
    for (const stage of [2, 12, 40]) for (const seed of SEEDS.slice(0, 6)) {
      const d = generateEscapeStage(stage, seed);
      const json = JSON.stringify(new StageEngine(d, ['p0'], { arena: startArena(d), stage }).state());
      for (const c of d.escape!.clues) expect(json).not.toContain(c.text);
      for (const l of d.escape!.links) if (l.lock.type === 'code') expect(json).not.toContain(`"${l.lock.code}"`);
      for (const s of d.escape!.safes) expect(json).not.toContain(`"${s.code}"`);
      expect(json).not.toContain('hiding');
    }
  });
});

describe('P3D escape validator: the gate and the placeholders', () => {
  const clone = (): StageDef => structuredClone(generateEscapeStage(1, 1));
  const errs = (d: StageDef) => validateEscape(d.escape!, d.rooms!, d);
  it('a part placed beyond the gate (where a lone player cannot reach it before opening) is refused', () => {
    const d = clone();
    d.items![0]!.x = 1700; d.stashes![0]!.x = 1700;
    expect(errs(d).join('|')).toMatch(/only 0 access_key on its near side/);
  });
  it('a hiding spot that floats is refused', () => {
    const d = structuredClone(generateEscapeStage(3, 1));
    d.escape!.hidingSpots![0]!.y = 300;
    expect(errs(d).join('|')).toMatch(/hiding spot .* does not stand on a solid/);
  });
});
