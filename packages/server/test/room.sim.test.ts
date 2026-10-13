import { describe, expect, it } from 'vitest';
import { ARENA } from '@wb/shared';
import { Room } from '../src/room';

const started = (n: number, briefingTicks = 3) => {
  const r = new Room('ABCD', briefingTicks);
  for (let i = 0; i < n; i++) r.join(`p${i}`, `P${i}`);
  for (let i = 1; i < n; i++) r.setReady(`p${i}`, true);
  expect(r.start('p0').ok).toBe(true);
  return r;
};
const toPlaying = (r: Room) => { for (let i = 0; i < 10 && r.phase !== 'playing'; i++) r.tick(); };

describe('Room simulation lifecycle', () => {
  it.each([1, 2, 3, 4])('runs a full lobby -> briefing -> playing flow with %i player(s)', (n) => {
    const r = started(n);
    expect(r.phase).toBe('briefing');
    expect(r.gameSnapshot()!.players).toHaveLength(n);
    toPlaying(r);
    expect(r.phase).toBe('playing');
    expect(r.gameSnapshot()!.briefingMs).toBe(0);
  });
  it('counts down the briefing in server ticks and reports the phase change once', () => {
    const r = started(1, 3);
    expect(r.gameSnapshot()!.briefingMs).toBe(150);
    expect(r.tick().phaseChanged).toBe(false);
    expect(r.tick().phaseChanged).toBe(false);
    expect(r.tick().phaseChanged).toBe(true);
    expect(r.tick().phaseChanged).toBe(false);
  });
  it('has no game snapshot in the lobby', () => {
    const r = new Room('ABCD'); r.join('p0', 'P0');
    expect(r.gameSnapshot()).toBeNull();
  });
  it('ignores input during briefing and while not playing, accepts it while playing', () => {
    const r = started(1);
    expect(r.submitInput('p0', 0, { moveX: 1, jump: false })).toBe(false);
    toPlaying(r);
    expect(r.submitInput('p0', 0, { moveX: 1, jump: false })).toBe(true);
    r.tick();
    expect(r.gameSnapshot()!.players[0]!.x).toBeGreaterThan(ARENA.spawns[0]!.x);
  });
  it('simulation time only advances while playing', () => {
    const r = started(1, 2);
    r.tick();
    expect(r.gameSnapshot()!.tick).toBe(0);
    toPlaying(r);
    for (let i = 0; i < 20; i++) r.tick();
    expect(r.gameSnapshot()!.simTimeMs).toBe(1000);
  });
  it('rejects joining once a run has started (P0 behaviour preserved)', () => {
    const r = started(1);
    expect(r.join('late', 'Late')).toEqual({ ok: false, error: 'Run already in progress' });
  });
});

describe('disconnects', () => {
  it('lobby disconnect removes the player (P0 behaviour preserved)', () => {
    const r = new Room('ABCD'); r.join('a', 'A'); r.join('b', 'B');
    r.disconnect('b');
    expect(r.size).toBe(1);
  });
  it('in-run disconnect keeps the player in the sim, flagged disconnected', () => {
    const r = started(3); toPlaying(r);
    r.disconnect('p2');
    const snap = r.gameSnapshot()!;
    expect(snap.players).toHaveLength(3);
    expect(snap.players.find((p) => p.id === 'p2')!.connected).toBe(false);
    expect(r.connectedCount).toBe(2);
    expect(r.submitInput('p2', 0, { moveX: 1, jump: false })).toBe(false);
  });
  it('migrates host to a connected player when the host drops mid-run', () => {
    const r = started(3); toPlaying(r);
    r.disconnect('p0');
    expect(r.hostId).toBe('p1');
    expect(r.connectedCount).toBe(2);
  });
  it('reports zero connected players when everyone leaves', () => {
    const r = started(2); toPlaying(r);
    r.disconnect('p0'); r.disconnect('p1');
    expect(r.connectedCount).toBe(0);
  });
});

describe('arena reset', () => {
  it('restores initial positions, keeps phase=playing, and drops disconnected players', () => {
    const r = started(3); toPlaying(r);
    const initial = r.gameSnapshot()!;
    let seq = 0;
    for (let i = 0; i < 25; i++) { r.submitInput('p1', seq++, { moveX: 1, jump: i === 2 }); r.tick(); }
    expect(r.gameSnapshot()!.players[1]!.x).not.toBe(initial.players[1]!.x);
    r.disconnect('p2');

    expect(r.resetArena('p0').ok).toBe(true);
    const snap = r.gameSnapshot()!;
    expect(r.phase).toBe('playing');
    expect(snap.tick).toBe(0);
    expect(snap.epoch).toBe(1);
    expect(snap.players.map((p) => p.id)).toEqual(['p0', 'p1']);
    for (const p of snap.players) {
      const sp = ARENA.spawns[p.slot]!;
      expect([p.x, p.y, p.vx, p.vy]).toEqual([sp.x, sp.y, 0, 0]);
    }
    expect(r.snapshot().players.map((p) => p.id)).toEqual(['p0', 'p1']);
  });
  it('is host-only and playing-only', () => {
    const r = started(2);
    expect(r.resetArena('p0')).toEqual({ ok: false, error: 'Arena can only be reset during play' });
    toPlaying(r);
    expect(r.resetArena('p1')).toEqual({ ok: false, error: 'Only the host can reset the arena' });
  });
  it('is repeatable and always returns to the same state', () => {
    const r = started(1); toPlaying(r);
    const a = r.gameSnapshot()!.players[0]!;
    for (let k = 0; k < 3; k++) {
      r.submitInput('p0', k * 100, { moveX: -1, jump: true }); r.tick(); r.tick();
      r.resetArena('p0');
      const b = r.gameSnapshot()!.players[0]!;
      expect([b.x, b.y]).toEqual([a.x, a.y]);
    }
  });
});
