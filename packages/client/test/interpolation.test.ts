import { describe, expect, it } from 'vitest';
import type { GamePlayer, GameSnapshot } from '@wb/shared';
import { SnapshotBuffer } from '../src/net/interpolation';

const pl = (id: string, x: number, y = 680, over: Partial<GamePlayer> = {}): GamePlayer => ({
  id, name: id, slot: 0, x, y, vx: 0, vy: 0, facing: 1, grounded: true, connected: true, ack: 0, ...over,
});
const snap = (tick: number, players: GamePlayer[], epoch = 0): GameSnapshot => ({
  tick, simTimeMs: tick * 50, epoch, phase: 'playing', briefingMs: 0, stage: 1, arenaId: 'a', players,
});

describe('SnapshotBuffer', () => {
  it('interpolates linearly between two snapshots', () => {
    const b = new SnapshotBuffer();
    b.push(1000, snap(1, [pl('a', 100)]));
    b.push(1050, snap(2, [pl('a', 200)]));
    expect(b.sample(1025).get('a')!.x).toBeCloseTo(150, 5);
    expect(b.sample(1012.5).get('a')!.x).toBeCloseTo(125, 5);
  });
  it('holds the latest state instead of extrapolating past the newest snapshot', () => {
    const b = new SnapshotBuffer();
    b.push(1000, snap(1, [pl('a', 100)]));
    b.push(1050, snap(2, [pl('a', 200)]));
    expect(b.sample(5000).get('a')!.x).toBe(200);
  });
  it('uses the oldest snapshot before the buffer starts and handles a single snapshot', () => {
    const b = new SnapshotBuffer();
    expect(b.sample(0).size).toBe(0);
    b.push(1000, snap(1, [pl('a', 100)]));
    expect(b.sample(0).get('a')!.x).toBe(100);
    expect(b.sample(9999).get('a')!.x).toBe(100);
  });
  it('picks the right pair across more than two snapshots', () => {
    const b = new SnapshotBuffer();
    [0, 100, 200, 300].forEach((x, i) => b.push(1000 + i * 50, snap(i, [pl('a', x)])));
    expect(b.sample(1062.5).get('a')!.x).toBeCloseTo(125, 5); // between 100 and 200
    expect(b.sample(1125).get('a')!.x).toBeCloseTo(250, 5); // between 200 and 300
  });
  it('never blends a teleport (reset) — snaps to the new position', () => {
    const b = new SnapshotBuffer();
    b.push(1000, snap(1, [pl('a', 100)]));
    b.push(1050, snap(2, [pl('a', 900)]));
    expect(b.sample(1025).get('a')!.x).toBe(900);
  });
  it('clears history on a new epoch and ignores out-of-order ticks', () => {
    const b = new SnapshotBuffer();
    b.push(1000, snap(5, [pl('a', 100)]));
    b.push(1050, snap(3, [pl('a', 999)])); // stale
    expect(b.latest!.tick).toBe(5);
    b.push(1100, snap(0, [pl('a', 50)], 1)); // reset
    expect(b.sample(0).get('a')!.x).toBe(50);
  });
  it('accepts repeated ticks (briefing sends the same tick many times)', () => {
    const b = new SnapshotBuffer();
    b.push(1000, snap(0, [pl('a', 100)]));
    b.push(1050, snap(0, [pl('a', 100)]));
    expect(b.sample(1025).get('a')!.x).toBe(100);
  });
  it('shows players that appear mid-buffer and carries connection state', () => {
    const b = new SnapshotBuffer();
    b.push(1000, snap(1, [pl('a', 100)]));
    b.push(1050, snap(2, [pl('a', 110), pl('b', 500, 680, { connected: false })]));
    const s = b.sample(1025);
    expect(s.get('b')!.x).toBe(500);
    expect(s.get('b')!.connected).toBe(false);
  });
  it('bounds memory', () => {
    const b = new SnapshotBuffer(5);
    for (let i = 0; i < 50; i++) b.push(i, snap(i, [pl('a', i)]));
    expect(b.sample(0).get('a')!.x).toBe(45);
  });
});
