import { describe, expect, it } from 'vitest';
import { ARENA, MOVE_SPEED, TICK_DT } from '@wb/shared';
import { BACKLOG_TRIM_TO, GameSim, MAX_INPUT_BACKLOG, MAX_REPEAT_TICKS } from '../src/game';

const mk = (n = 2) => new GameSim(Array.from({ length: n }, (_, i) => ({ id: `p${i}`, name: `P${i}`, slot: i })));
const R = { moveX: 1, jump: false };

describe('GameSim', () => {
  it('places each player at their slot spawn', () => {
    const s = mk(4).snapshot('playing', 0, 1);
    expect(s.players.map((p) => [p.x, p.y])).toEqual(ARENA.spawns.map((sp) => [sp.x, sp.y]));
    expect(s.players.map((p) => p.slot)).toEqual([0, 1, 2, 3]);
  });
  it('applies exactly one queued input per tick', () => {
    const sim = mk(1);
    sim.queueInput('p0', 0, R); sim.queueInput('p0', 1, R);
    sim.step();
    expect(sim.snapshot('playing', 0, 1).players[0]!.ack).toBe(0);
    sim.step();
    const p = sim.snapshot('playing', 0, 1).players[0]!;
    expect(p.ack).toBe(1);
    expect(p.x).toBeCloseTo(ARENA.spawns[0]!.x + 2 * MOVE_SPEED * TICK_DT, 1);
  });
  it('rejects out-of-order and duplicate seq numbers', () => {
    const sim = mk(1);
    expect(sim.queueInput('p0', 5, R)).toBe(true);
    expect(sim.queueInput('p0', 5, R)).toBe(false);
    expect(sim.queueInput('p0', 3, R)).toBe(false);
    expect(sim.queueInput('nobody', 9, R)).toBe(false);
  });
  it('clamps hostile movement values server-side (client cannot speed-hack)', () => {
    const sim = mk(1);
    sim.queueInput('p0', 0, { moveX: 1000, jump: false });
    sim.step();
    expect(sim.snapshot('playing', 0, 1).players[0]!.x).toBeCloseTo(ARENA.spawns[0]!.x + MOVE_SPEED * TICK_DT, 1);
  });
  it('trims a runaway input backlog instead of growing latency forever', () => {
    const sim = mk(1);
    for (let i = 0; i < 50; i++) sim.queueInput('p0', i, R);
    sim.step();
    const ack = sim.snapshot('playing', 0, 1).players[0]!.ack;
    expect(ack).toBeGreaterThanOrEqual(50 - MAX_INPUT_BACKLOG); // stale inputs dropped, newest window kept
    expect(MAX_INPUT_BACKLOG).toBeGreaterThan(BACKLOG_TRIM_TO);
  });
  it('does not drop a client catch-up burst (5 ticks in one frame)', () => {
    const sim = mk(1);
    for (let i = 0; i < 5; i++) sim.queueInput('p0', i, R);
    for (let i = 0; i < 5; i++) sim.step();
    expect(sim.snapshot('playing', 0, 1).players[0]!.ack).toBe(4); // every input applied, in order
  });
  it('stale input decays to neutral: a silent client cannot run forever', () => {
    const sim = mk(1);
    sim.queueInput('p0', 0, R);
    for (let i = 0; i < 1 + MAX_REPEAT_TICKS; i++) sim.step();
    const moved = sim.snapshot('playing', 0, 1).players[0]!.x;
    for (let i = 0; i < 20; i++) sim.step();
    expect(sim.snapshot('playing', 0, 1).players[0]!.x).toBe(moved);
  });
  it('disconnected players stay visible, flagged, and stop accepting input', () => {
    const sim = mk(2);
    sim.setConnected('p1', false);
    expect(sim.queueInput('p1', 0, R)).toBe(false);
    const p = sim.snapshot('playing', 0, 1).players.find((x) => x.id === 'p1')!;
    expect(p.connected).toBe(false);
  });
  it('reset restores the exact initial state and bumps epoch', () => {
    const sim = mk(2);
    const initial = sim.snapshot('playing', 0, 1);
    for (let i = 0; i < 30; i++) { sim.queueInput('p0', i, { moveX: 1, jump: i === 3 }); sim.step(); }
    expect(sim.snapshot('playing', 0, 1).players[0]!.x).not.toBe(initial.players[0]!.x);
    sim.reset();
    const after = sim.snapshot('playing', 0, 1);
    expect(after.tick).toBe(0);
    expect(after.epoch).toBe(initial.epoch + 1);
    expect(after.players.map(({ ack, ...p }) => p)).toEqual(initial.players.map(({ ack, ...p }) => p));
  });
  it('snapshot contains only the public projection', () => {
    const s = mk(1).snapshot('playing', 0, 1);
    expect(Object.keys(s.players[0]!).sort()).toEqual(
      ['ack', 'connected', 'facing', 'grounded', 'id', 'name', 'slot', 'vx', 'vy', 'x', 'y']);
  });
});
