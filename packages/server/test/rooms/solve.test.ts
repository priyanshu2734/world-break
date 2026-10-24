import { describe, expect, it } from 'vitest';
import { LOCK_TYPES, roomCountForStage, type LockType } from '@wb/shared';
import { Room } from '../../src/room';
import { advanceTo, currentDef, newRun, solveStage } from './solver';

/** Real physics, real Room API, real input: these tests PLAY the generated stages. */
const SLOW = 240_000;

describe('P3D: every generated stage is solvable by one player, within two hand slots (real physics)', () => {
  it('the tutorial and the first stages, over many run seeds', () => {
    for (let runSeed = 3; runSeed < 3 + 40 * 8; runSeed += 8) for (const stage of [1, 2, 3, 4, 5, 6]) { // 40 run seeds x 6 stages = 240 stages played
      const { room, ids } = newRun(1, runSeed);
      const def = advanceTo(room, ids, stage);
      const st = solveStage(room, ids, def);
      expect(room.phase).toBe('stage_complete');
      expect(st.maxSlots).toBeLessThanOrEqual(2);
      expect(def.rooms!.rooms.length).toBe(roomCountForStage(stage));
    }
  }, SLOW);

  it('stages across the whole table, from 1 to 6 rooms, including stage 1,000,000', () => {
    const table = [7, 9, 10, 12, 14, 15, 20, 24, 25, 32, 39, 40, 41, 100, 1_000, 1_000_000];
    for (const stage of table) for (const runSeed of [5, 13, 29, 41, 53, 67]) { // 16 stages x 6 run seeds = 96 stages played
      const { room, ids } = newRun(1, runSeed);
      const def = advanceTo(room, ids, stage);
      const st = solveStage(room, ids, def);
      expect(room.phase).toBe('stage_complete');
      expect(st.maxSlots).toBeLessThanOrEqual(2);
      expect(def.rooms!.rooms.length).toBe(roomCountForStage(stage));
    }
  }, SLOW);

  it('every one of the five lock types is solved, alone, on generated stages', () => {
    const solved = new Set<LockType>();
    for (let runSeed = 100; runSeed < 160 && solved.size < LOCK_TYPES.length; runSeed++) {
      const { room, ids } = newRun(1, runSeed);
      const def = advanceTo(room, ids, 12 + (runSeed % 30));
      solveStage(room, ids, def);
      expect(room.phase).toBe('stage_complete');
      for (const l of def.escape!.links) solved.add(l.lock.type);
    }
    expect([...solved].sort()).toEqual([...LOCK_TYPES].sort());
  }, SLOW);
});

describe('P3D: and by two to four players', () => {
  it('2, 3 and 4 players: the lead solves while everyone follows through every door (co-op), over several stages', () => {
    for (const players of [2, 3, 4]) for (const stage of [1, 2, 3, 6, 8, 12, 15, 25, 40]) for (const runSeed of [5, 21, 37]) { // 81 co-op stages played
      const { room, ids } = newRun(players, runSeed);
      const def = advanceTo(room, ids, stage);
      const st = solveStage(room, ids, def, { coop: true });
      expect(room.phase).toBe('stage_complete');
      expect(st.maxSlots).toBeLessThanOrEqual(2);
    }
  }, SLOW);

  it('a two-person lock is lit by two different players at once on generated stages', () => {
    let coopTwoPerson = 0;
    for (let runSeed = 200; runSeed < 280 && coopTwoPerson < 3; runSeed++) {
      const { room, ids } = newRun(2, runSeed);
      const def = advanceTo(room, ids, 12 + (runSeed % 28));
      if (!def.escape!.links.some((l) => l.lock.type === 'two_person')) continue;
      solveStage(room, ids, def, { coop: true });
      expect(room.phase).toBe('stage_complete');
      coopTwoPerson++;
    }
    expect(coopTwoPerson).toBeGreaterThanOrEqual(3);
  }, SLOW);

  it('the others never need to reach the exit: one player reaching it clears the stage and everybody continues', () => {
    const { room, ids } = newRun(3, 61);
    const def = advanceTo(room, ids, 6);
    solveStage(room, ids, def); // p1 and p2 never moved from room 0
    expect(room.phase).toBe('stage_complete');
    expect(room.gameSnapshot()!.players.filter((p) => p.roomId === def.rooms!.start).length).toBeGreaterThanOrEqual(2);
    expect(room.nextStage('p0')).toEqual({ ok: true });
    expect(room.gameSnapshot()!.players.length).toBe(3);
  }, SLOW);
});

describe('P3D: the endless loop is the generator', () => {
  it('stage after stage through the real STAGE_CLEAR transition, each one generated, each with its table room count', () => {
    const { room, ids } = newRun(2, 77);
    const seen: string[] = [];
    for (let stage = 1; stage <= 8; stage++) {
      expect(room.stage).toBe(stage);
      const def = currentDef(room);
      expect(def.id).toBe(`escape_${stage}`);
      expect(def.rooms!.rooms.length).toBe(roomCountForStage(stage));
      seen.push(def.rooms!.start);
      solveStage(room, ids, def, { coop: stage % 2 === 0 });
      expect(room.phase).toBe('stage_complete');
      expect(room.nextStage('p0')).toEqual({ ok: true });
      for (let i = 0; i < 20 && room.phase !== 'playing'; i++) room.tick();
      expect(room.phase).toBe('playing');
    }
    expect(new Set(seen).size).toBe(8); // eight different stages
  }, SLOW);

  it('jumping to stage 1,000,000 keeps going: generated, valid, playable, and the next one too', () => {
    const { room, ids } = newRun(1, 5);
    const def = advanceTo(room, ids, 1_000_000);
    expect(room.stage).toBe(1_000_000);
    expect(def.rooms!.rooms.length).toBe(6);
    solveStage(room, ids, def);
    expect(room.nextStage('p0')).toEqual({ ok: true });
    expect(room.stage).toBe(1_000_001);
    expect(currentDef(room).id).toBe('escape_1000001');
  }, SLOW);

  it('a reset of the arena replays the SAME generated stage', () => {
    const { room, ids } = newRun(1, 9);
    const a = currentDef(room);
    expect(room.resetArena('p0').ok).toBe(true);
    expect(JSON.stringify(currentDef(room))).toBe(JSON.stringify(a));
    expect(room.gameSnapshot()!.players[0]!.roomId).toBe(a.rooms!.start);
    expect(ids.length).toBe(1);
  });
});

describe('P3D: ESCAPE_STAGES off restores the previous behaviour', () => {
  it('without the escape option stage 1 is the old tutorial and no room ids appear', () => {
    const r = new Room('ABCD', 4, 7, {});
    r.join('p0', 'P0');
    expect(r.start('p0').ok).toBe(true);
    for (let i = 0; i < 20 && r.phase !== 'playing'; i++) r.tick();
    expect(r.stageRecord!.defId).not.toMatch(/^escape_/);
    expect(r.restrictsViews).toBe(false);
    expect(r.gameSnapshot()!.players[0]!.roomId).toBeUndefined();
  });
  it('with the option the same room plays the generated tutorial', () => {
    const { room } = newRun(1, 7);
    expect(room.stageRecord!.defId).toBe('escape_1');
    expect(room.restrictsViews).toBe(true);
  });
});
