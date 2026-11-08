import { describe, expect, it, vi } from 'vitest';
import { RunSaveSchema, type RunSave } from '@wb/shared';
import { Room, type ClearEvent } from '../../src/room';
import { Lockstep } from '../helpers/bot';
import { solveTutorial } from '../helpers/tutorialPlan';

vi.setConfig({ testTimeout: 60_000 });

type Priv = { owned: Record<string, number>; pickOrder: string[]; noteClear(): void; stageRec: { seed: number; defId: string } | null };
const priv = (r: Room) => r as unknown as Priv;

/** An escape-stage room with the host and (optionally) a second player, started and in the briefing. */
function started(seed: number, code = 'ABCD', players = 1): Room {
  const r = new Room(code, 2, seed, { escape: true, ghost: true });
  for (let i = 0; i < players; i++) r.join(`p${i}`, `P${i}`);
  for (let i = 1; i < players; i++) r.setReady(`p${i}`, true);
  expect(r.start('p0')).toEqual({ ok: true });
  return r;
}
/** Transport shortcut (the genuine clear is proven separately below): the stage was cleared; take its event, then go on. */
function clearByShortcut(r: Room): ClearEvent {
  r.phase = 'stage_complete';
  priv(r).noteClear();
  const [ev] = r.drainClears();
  expect(ev).toBeDefined();
  return ev!;
}
/** Plays `from` -> `to` by shortcut and returns the save the clear of stage `to - 1` produced. */
function playTo(r: Room, to: number): RunSave {
  let last: RunSave | null = null;
  while (r.stage < to) { last = clearByShortcut(r).save; expect(r.nextStage('p0')).toEqual({ ok: true }); }
  return last!;
}

describe('P6 C a genuinely cleared stage becomes a clear event', () => {
  it('the real tutorial clear reports stage, mode, time, score, players, deaths and a save that points at the NEXT stage', () => {
    const r = new Room('ABCD', 2, 99);
    r.join('p0', 'P0'); r.join('p1', 'P1'); r.setReady('p1', true);
    expect(r.start('p0').ok).toBe(true);
    const sim = new Lockstep(r);
    while (r.phase !== 'playing') sim.tick();
    expect(r.drainClears()).toEqual([]); // nothing before a clear
    solveTutorial(sim, 'p0');
    expect(r.phase).toBe('stage_complete');
    const [ev, ...rest] = r.drainClears();
    expect(rest).toEqual([]);
    expect(ev!.result).toMatchObject({ stage: 1, mode: 'easy', players: 2, deaths: 0 });
    expect(ev!.result.ticks).toBeGreaterThan(0);
    expect(ev!.result.score).toBeGreaterThan(0);
    expect(ev!.playerIds.sort()).toEqual(['p0', 'p1']);
    expect(ev!.hostId).toBe('p0');
    expect(ev!.save).toMatchObject({ stage: 2, mode: 'easy' });
    expect(RunSaveSchema.safeParse(ev!.save).success).toBe(true);
    expect(r.drainClears()).toEqual([]); // taken once
  });
  it('a clear event holds no seed of the current stage, no code, no safe', () => {
    const r = started(5);
    const ev = clearByShortcut(r);
    const raw = JSON.stringify(ev);
    expect(raw).not.toMatch(/code|safe|solution|keypad/i);
  });
});

describe('P6 C a team wipe saves nothing and never lowers anything', () => {
  it('a wiped team produces no clear event and no save update', () => {
    const r = new Room('ABCD', 2, 7, { escape: true, ghost: true, startStage: 3 });
    r.join('p0', 'P0');
    r.start('p0');
    for (let i = 0; i < 10 && r.phase !== 'playing'; i++) r.tick();
    const g = r.ghostSystem!;
    const sim = (r as unknown as { sim: { senses(): { id: string; x: number; y: number; roomId: string | null }[] } }).sim;
    for (let i = 0; i < 2500 && r.phase === 'playing'; i++) {
      if (i % 60 === 0) { const me = sim.senses()[0]!; g.placeForTest('g0', { room: me.roomId!, x: me.x - 60, y: me.y - 22, angle: 0, state: 'hunting' }); }
      r.submitInput('p0', i + 1, { moveX: 0, jump: false }); r.tick();
    }
    expect(['team_wiped', 'review']).toContain(r.phase);
    expect(r.drainClears()).toEqual([]);
    expect(r.drainSaveUpdates()).toEqual([]);
    expect(r.stage).toBe(3);
  });
});

describe('P6 C save and restore reproduce the same run', () => {
  it('a save taken at the clear of stage 5 restores in a NEW room to exactly the stage the first room played next (stage 6), upgrades included', () => {
    const a = started(424242, 'AAAA');
    priv(a).owned = { wide_beam: 1, quick_charge: 2 }; priv(a).pickOrder = ['wide_beam', 'quick_charge', 'quick_charge'];
    const save = playTo(a, 6); // the clear of stage 5
    expect(save).toMatchObject({ stage: 6, seedBase: 424242, mode: 'easy' });
    expect(save.variety.length).toBeGreaterThan(0);
    expect(save.upgrades).toEqual({ wide_beam: 1, quick_charge: 2 });
    expect(save.pickOrder).toEqual(['wide_beam', 'quick_charge', 'quick_charge']);
    const sixA = JSON.stringify(a.stageDef);
    const seedA = priv(a).stageRec!.seed;

    // a different room, different code, different random run seed: only the SAVE connects them
    const b = new Room('BBBB', 2, 1, { escape: true, ghost: true });
    b.join('h', 'Host');
    expect(b.restoreRun(JSON.parse(JSON.stringify(save)), 6)).toEqual({ ok: true });
    expect(b.stage).toBe(6);
    expect(b.snapshot().upgrades).toEqual(expect.arrayContaining([{ id: 'wide_beam', count: 1 }, { id: 'quick_charge', count: 2 }]));
    expect(b.start('h')).toEqual({ ok: true });
    expect(priv(b).stageRec!.seed).toBe(seedA);
    expect(JSON.stringify(b.stageDef)).toBe(sixA);
    expect(b.varietyRecords.map((r) => r.stage)).toEqual(expect.arrayContaining([5, 6]));

    // and the stage AFTER that is the same too (the history carried on)
    clearByShortcut(a); expect(a.nextStage('p0')).toEqual({ ok: true });
    b.phase = 'stage_complete'; expect(b.nextStage('h')).toEqual({ ok: true });
    expect(b.stage).toBe(7);
    expect(JSON.stringify(b.stageDef)).toBe(JSON.stringify(a.stageDef));
  });
  it('the history is part of the save (the P3F determinism note): restoring save + history reproduces stage 8 exactly', () => {
    const a = started(31337, 'AAAA');
    const save = playTo(a, 8);
    expect(save.variety.length).toBeGreaterThan(0);
    const c = new Room('CCCC', 2, 1, { escape: true, ghost: true });
    c.join('h', 'Host');
    expect(c.restoreRun(save, 8).ok).toBe(true);
    c.start('h');
    expect(JSON.stringify(c.stageDef)).toBe(JSON.stringify(a.stageDef));
  });
  it('restoring is lobby-only and refuses a run that has started', () => {
    const a = started(1, 'AAAA');
    const save = playTo(a, 3);
    expect(a.restoreRun(save, 3)).toEqual({ ok: false, error: 'A saved run can only be loaded before the run starts' });
    expect(a.newRun().ok).toBe(false);
  });
  it('"New run" goes back to stage 1, the original seed, no upgrades and no history, even after a continue', () => {
    const a = started(2024, 'AAAA');
    const save = playTo(a, 5);
    const b = new Room('BBBB', 2, 2024, { escape: true, ghost: true });
    b.join('h', 'Host');
    const first = (() => { const t = new Room('TTTT', 2, 2024, { escape: true, ghost: true }); t.join('h', 'H'); t.start('h'); return JSON.stringify(t.stageDef); })();
    b.restoreRun(save, 5);
    expect(b.stage).toBe(5);
    expect(b.newRun()).toEqual({ ok: true });
    expect(b.stage).toBe(1);
    expect(b.varietyRecords).toEqual([]);
    expect(b.snapshot().upgrades).toBeUndefined();
    b.start('h');
    expect(JSON.stringify(b.stageDef)).toBe(first); // the very stage 1 a fresh room with that seed plays
  });
});

describe('P6 C a tampered or foreign save is refused (the room is left untouched)', () => {
  const base = (): RunSave => ({ stage: 12, mode: 'intermediate', seedBase: 5, variety: [], upgrades: {}, pickOrder: [] });
  const fresh = () => { const r = new Room('ABCD', 2, 9, { escape: true }); r.join('h', 'Host'); return r; };
  it('ahead of the progress it belongs to, or a mode that is not unlocked', () => {
    const r = fresh();
    expect(r.restoreRun(base(), 11).ok).toBe(false); // stage 12 but only 11 reached
    expect(r.restoreRun({ ...base(), mode: 'hardcore' }, 19).ok).toBe(false);
    expect(r.restoreRun({ ...base(), stage: 9, mode: 'intermediate' }, 9).ok).toBe(false); // intermediate needs 10
    expect(r.restoreRun(base(), 12).ok).toBe(true);
  });
  it('malformed saves: wrong types, extra fields, a stage in the billions, impossible upgrades', () => {
    for (const bad of [null, 'x', {}, { ...base(), stage: 0 }, { ...base(), stage: 1e12 }, { ...base(), isAdmin: true }, { ...base(), upgrades: { wide_beam: 99 } }, { ...base(), mode: 'god' }, { ...base(), variety: 'x' }]) {
      const r = fresh();
      expect(r.restoreRun(bad, 1_000_000_000).ok, JSON.stringify(bad)).toBe(false);
      expect(r.stage).toBe(1);
      expect(r.difficulty).toBe('easy');
    }
  });
  it('a variety history that is not a valid history is refused and nothing is half-applied', () => {
    const r = fresh();
    expect(r.restoreRun({ ...base(), variety: [{ stage: 1, theme: 'moon' }] }, 12).ok).toBe(false);
    expect(r.stage).toBe(1);
  });
});

describe('P6 C who may choose which difficulty (the HOST’s unlocks)', () => {
  const lobby = () => { const r = new Room('ABCD', 2, 3, { escape: true }); r.join('h', 'Host'); r.join('g', 'Guest'); return r; };
  it('a guest host (floor 0) has only Easy, whatever a joiner has earned', () => {
    const r = lobby();
    expect(r.unlockBasis).toBe(1);
    expect(r.setDifficulty('h', 'intermediate')).toEqual({ ok: false, error: 'intermediate is locked' });
    expect(r.snapshot().highestStage).toBe(1);
  });
  it('a host who reached 10 / 20 may choose Intermediate / Hardcore; at 9 and 19 they may not (boundaries)', () => {
    for (const [floor, mode, ok] of [[9, 'intermediate', false], [10, 'intermediate', true], [11, 'intermediate', true], [19, 'hardcore', false], [20, 'hardcore', true], [21, 'hardcore', true], [1_000_000, 'hardcore', true]] as const) {
      const r = lobby();
      r.setHostFloor(floor);
      expect(r.setDifficulty('h', mode).ok, `${floor} ${mode}`).toBe(ok);
    }
  });
  it('only the current host chooses; a joiner cannot', () => {
    const r = lobby();
    r.setHostFloor(25);
    expect(r.setDifficulty('g', 'hardcore')).toEqual({ ok: false, error: 'Only the host can change difficulty' });
  });
  it('when a high-progress host leaves, the next host’s lower unlocks apply and a now-locked mode falls back', () => {
    const r = lobby();
    r.setHostFloor(25);
    expect(r.setDifficulty('h', 'hardcore').ok).toBe(true);
    r.leave('h'); // 'g' hosts now
    r.setHostFloor(0);
    expect(r.hostId).toBe('g');
    expect(r.difficulty).toBe('easy');
    r.setHostFloor(12);
    expect(r.setDifficulty('g', 'intermediate').ok).toBe(true);
    r.setHostFloor(0);
    expect(r.difficulty).toBe('easy');
  });
  it('a bad floor (negative, NaN, fractional) counts as a guest', () => {
    for (const f of [-5, NaN, Infinity, 3.5]) { const r = lobby(); r.setHostFloor(f); expect(r.unlockBasis).toBe(1); }
  });
  it('the run itself still unlocks modes for a guest room (in-session): reaching stage 10 in the room is enough for the next lobby of that room', () => {
    const r = new Room('ABCD', 2, 3, { escape: true, startStage: 10 });
    r.join('h', 'Host');
    expect(r.setDifficulty('h', 'intermediate').ok).toBe(true);
  });
});

describe('P6 C the draft settled after a clear rewrites the save', () => {
  it('advancing queues a save update with the upgrades the team owns now, pointing at the same next stage', () => {
    const r = started(11);
    const ev = clearByShortcut(r);
    priv(r).owned = { wide_beam: 1 }; priv(r).pickOrder = ['wide_beam']; // the draft result
    expect(r.nextStage('p0')).toEqual({ ok: true });
    const [u, ...more] = r.drainSaveUpdates();
    expect(more).toEqual([]);
    expect(u).toMatchObject({ stage: ev.save.stage, upgrades: { wide_beam: 1 }, pickOrder: ['wide_beam'] });
    expect(ev.save.upgrades).toEqual({});
  });
  it('the queues are bounded', () => {
    const r = started(12);
    for (let i = 0; i < 20; i++) { r.phase = 'stage_complete'; priv(r).noteClear(); }
    expect(r.drainClears().length).toBeLessThanOrEqual(8);
    for (let i = 0; i < 20; i++) { r.phase = 'stage_complete'; r.nextStage('p0'); }
    expect(r.drainSaveUpdates().length).toBeLessThanOrEqual(8);
  });
});

describe('P6 C endless: a huge stage', () => {
  it('a save at stage 1,000,000 restores and the room plays that stage', () => {
    const r = new Room('ABCD', 2, 8, { escape: true });
    r.join('h', 'Host');
    const save: RunSave = { stage: 1_000_000, mode: 'hardcore', seedBase: 4_000_000_000, variety: [], upgrades: {}, pickOrder: [] };
    expect(r.restoreRun(save, 1_000_000)).toEqual({ ok: true });
    expect(r.stage).toBe(1_000_000);
    expect(r.difficulty).toBe('hardcore');
    expect(r.start('h')).toEqual({ ok: true });
    expect(r.stageDef).not.toBeNull();
    expect(r.snapshot().highestStage).toBe(1_000_000);
  });
});
