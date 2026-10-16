import { describe, expect, it, vi } from 'vitest';
import { ARENA, GameSnapshotSchema, RoomSnapshotSchema, StageStateSchema } from '@wb/shared';
import { Room } from '../src/room';
import { getStageDef } from '../src/systems/registry';
import { validateStageDef } from '../src/systems/validate';
import { fallbackStageDef } from '../src/disasters/fallback';
import { Lockstep } from './helpers/bot';
import { solveTutorial } from './helpers/tutorialPlan';

// Genuine real-physics clears of the tutorial take a few seconds of CPU.
vi.setConfig({ testTimeout: 30_000 });

const SLUG = /^[a-z][a-z0-9_]*$/;
const NOT_COMPLETE = { ok: false, error: 'There is no completed stage to advance from' };
const NOT_HOST = { ok: false, error: 'Only the host can start the next stage' };

function startRoom(n: number, seed?: number) {
  const room = new Room('ABCD', 2, seed);
  const ids = Array.from({ length: n }, (_, i) => `p${i}`);
  ids.forEach((id, i) => room.join(id, `P${i}`));
  ids.slice(1).forEach((id) => room.setReady(id, true));
  expect(room.start('p0').ok).toBe(true);
  const sim = new Lockstep(room);
  return { room, sim, ids };
}
function playingRoom(n: number, seed?: number) {
  const r = startRoom(n, seed);
  while (r.room.phase !== 'playing') r.sim.tick();
  return r;
}
/** Genuinely clears the tutorial through the real simulation. */
function clearedRoom(n: number, seed?: number) {
  const r = playingRoom(n, seed);
  solveTutorial(r.sim, 'p0');
  expect(r.room.phase).toBe('stage_complete');
  return r;
}
/** Transport/lifecycle shortcut: pretend the current stage was cleared (the genuine clear is proven separately). */
function advanceByShortcut(room: Room) {
  room.phase = 'stage_complete';
  return room.nextStage('p0');
}

describe('Room.nextStage (endless stage loop)', () => {
  it('is refused outside stage_complete (lobby, briefing, playing)', () => {
    const lobby = new Room('ABCD', 2);
    lobby.join('p0', 'P0');
    expect(lobby.nextStage('p0')).toEqual(NOT_COMPLETE);

    const { room, sim } = startRoom(1);
    expect(room.phase).toBe('briefing');
    expect(room.nextStage('p0')).toEqual(NOT_COMPLETE);
    while (room.phase !== 'playing') sim.tick();
    expect(room.nextStage('p0')).toEqual(NOT_COMPLETE);
    expect(room.stage).toBe(1);
  });

  it('is host-only', () => {
    const { room } = clearedRoom(2);
    expect(room.nextStage('p1')).toEqual(NOT_HOST);
    expect(room.nextStage('ghost')).toEqual(NOT_HOST);
    expect(room.phase).toBe('stage_complete');
    expect(room.stage).toBe(1);
  });

  it('after a genuine clear: briefing -> playing on stage 2 with a fresh, higher-revision stage state', () => {
    const { room, sim } = clearedRoom(2);
    const oldRev = room.peekStageState()!.rev;
    const epoch0 = room.gameSnapshot()!.epoch;

    expect(room.nextStage('p0')).toEqual({ ok: true });
    expect(room.phase).toBe('briefing');
    expect(room.stage).toBe(2);
    expect(room.highestStage).toBe(2);
    expect(RoomSnapshotSchema.parse(room.snapshot()).stage).toBe(2);

    const snap = GameSnapshotSchema.parse(room.gameSnapshot());
    expect(snap.stage).toBe(2);
    expect(snap.phase).toBe('briefing');
    expect(snap.tick).toBe(0);
    expect(snap.epoch).toBe(epoch0 + 1);
    const p0 = snap.players.find((p) => p.id === 'p0')!;
    expect(p0.x).toBe(ARENA.spawns[0]!.x);
    expect(p0.y).toBe(ARENA.spawns[0]!.y);

    const st = StageStateSchema.parse(room.consumeStageState());
    expect(st.stageId).not.toBe('tutorial_cold_start');
    expect(st.status).toBe('running');
    expect(st.rev).toBeGreaterThan(oldRev);
    expect(st.players.map((p) => p.id)).toEqual(['p0', 'p1']);

    while (room.phase !== 'playing') sim.tick();
    expect(room.stageAction('p0', { kind: 'use_tool', tool: 'phase_scanner' }).ok).toBe(true);
  });

  it('drops players who disconnected during the finished stage', () => {
    const { room } = clearedRoom(3);
    room.disconnect('p2');
    expect(room.nextStage('p0')).toEqual({ ok: true });
    expect(room.snapshot().players.map((p) => p.id)).toEqual(['p0', 'p1']);
    expect(room.gameSnapshot()!.players.map((p) => p.id)).toEqual(['p0', 'p1']);
    expect(room.peekStageState()!.players.map((p) => p.id)).toEqual(['p0', 'p1']);
  });

  it('reaches a very large stage number and keeps going (no stage is the last)', () => {
    const { room, sim } = clearedRoom(1);
    room.stage = 999_999; // jump the counter; the genuine clear above proves the transition itself
    expect(room.nextStage('p0')).toEqual({ ok: true });
    expect(room.stage).toBe(1_000_000);
    expect(room.highestStage).toBe(1_000_000);
    expect(RoomSnapshotSchema.parse(room.snapshot()).stage).toBe(1_000_000);
    expect(GameSnapshotSchema.parse(room.gameSnapshot()).stage).toBe(1_000_000);
    expect(room.stageRecord!.stage).toBe(1_000_000);
    expect(room.stageRecord!.defId).toMatch(SLUG);
    expect(StageStateSchema.parse(room.consumeStageState()).status).toBe('running');

    while (room.phase !== 'playing') sim.tick();
    expect(room.stageAction('p0', { kind: 'use_tool', tool: 'phase_scanner' }).ok).toBe(true);

    expect(advanceByShortcut(room)).toEqual({ ok: true });
    expect(room.stage).toBe(1_000_001);
    expect(room.phase).toBe('briefing');
  });

  it('walks many stages in a row without ever refusing', () => {
    const { room } = playingRoom(2);
    for (let expected = 2; expected <= 40; expected++) {
      expect(advanceByShortcut(room)).toEqual({ ok: true });
      expect(room.stage).toBe(expected);
      expect(room.stageRecord!.defId).toMatch(SLUG);
      while (room.phase !== 'playing') room.tick();
    }
    expect(room.highestStage).toBe(40);
  });

  it('records the stage seed server-side: deterministic per run seed and stage, different across both', () => {
    const a = playingRoom(1, 777).room, b = playingRoom(1, 777).room, c = playingRoom(1, 778).room;
    advanceByShortcut(a); advanceByShortcut(b); advanceByShortcut(c);
    expect(a.stageRecord!.seed).toBe(b.stageRecord!.seed);
    expect(a.stageRecord!.seed).not.toBe(c.stageRecord!.seed);
    const seed2 = a.stageRecord!.seed;
    while (a.phase !== 'playing') a.tick();
    advanceByShortcut(a);
    expect(a.stageRecord!.seed).not.toBe(seed2); // stage 3 has its own seed
    // the seed never appears in anything a client can receive
    const publicJson = JSON.stringify([a.snapshot(), a.gameSnapshot(), a.peekStageState()]);
    expect(publicJson).not.toContain(String(a.stageRecord!.seed));
  });

  it('resetArena on a later stage rebuilds the SAME stage (same seed, same definition)', () => {
    const { room, sim } = playingRoom(1);
    advanceByShortcut(room);
    while (room.phase !== 'playing') sim.tick();
    const before = { ...room.stageRecord! };
    const stageId = room.peekStageState()!.stageId;
    expect(room.resetArena('p0')).toEqual({ ok: true });
    expect(room.stageRecord).toEqual(before);
    expect(room.peekStageState()!.stageId).toBe(stageId);
    expect(room.stage).toBe(2);
  });
});

describe('stage definitions are available for every stage number', () => {
  it('stage 1 is the hand-authored tutorial', () => {
    expect(getStageDef(1).id).toBe('tutorial_cold_start');
  });
  it.each([2, 3, 10, 20, 100, 12_345, 1_000_000, 2 ** 31])('stage %i resolves and passes validateStageDef', (n) => {
    const def = getStageDef(n, 4242);
    expect(def.id).toMatch(SLUG);
    expect(def.id.length).toBeLessThanOrEqual(40);
    expect(validateStageDef(def, ARENA)).toEqual([]);
  });
  it('fallbackStageDef validates and has a distinct id per stage', () => {
    const a = fallbackStageDef(5), b = fallbackStageDef(6);
    expect(validateStageDef(a, ARENA)).toEqual([]);
    expect(a.id).not.toBe(b.id);
  });
  it('rejects only invalid stage numbers, never "too high" ones', () => {
    for (const bad of [0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, 2 ** 60]) expect(() => getStageDef(bad)).toThrow();
    expect(() => getStageDef(Number.MAX_SAFE_INTEGER)).not.toThrow();
  });
});
