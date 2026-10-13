import { describe, expect, it } from 'vitest';
import {
  ARENA, MOVE_SPEED, TICK_DT, spawnBody, stepBody, type GamePlayer, type InputIntent, type PlayerBody,
} from '@wb/shared';
import { LocalPredictor, MAX_CATCHUP_TICKS, SNAP_DISTANCE } from '../src/sim/prediction';

const TICK_MS = TICK_DT * 1000;
const asPlayer = (b: PlayerBody, ack: number): GamePlayer => ({
  id: 'me', name: 'Me', slot: 0, x: b.x, y: b.y, vx: b.vx, vy: b.vy, facing: b.facing,
  grounded: b.grounded, connected: true, ack,
});
const RIGHT: InputIntent = { moveX: 1, jump: false };
const spawn = () => asPlayer(spawnBody(ARENA.spawns[0]!.x, ARENA.spawns[0]!.y), -1);

describe('LocalPredictor', () => {
  it('sends one intent per fixed tick with strictly increasing seq', () => {
    const sent: number[] = [];
    const p = new LocalPredictor((seq) => sent.push(seq));
    p.start(spawn(), 0);
    for (let i = 0; i < 10; i++) p.advance(TICK_MS / 2, RIGHT); // 5 ticks worth
    expect(sent).toEqual([0, 1, 2, 3, 4]);
  });
  it('predicts movement with the same rules as the server', () => {
    const p = new LocalPredictor(() => {});
    p.start(spawn(), 0);
    p.advance(TICK_MS * 4, RIGHT);
    expect(p.predicted()!.x).toBeCloseTo(ARENA.spawns[0]!.x + 4 * MOVE_SPEED * TICK_DT, 5);
  });
  it('does nothing until started and after stop()', () => {
    const sent: number[] = [];
    const p = new LocalPredictor((s) => sent.push(s));
    p.advance(1000, RIGHT);
    expect(sent).toEqual([]);
    p.start(spawn(), 0); p.stop(); p.advance(1000, RIGHT);
    expect(sent).toEqual([]);
    expect(p.render()).toBeNull();
  });
  it('bounds catch-up after a stall (hidden tab) to MAX_CATCHUP_TICKS', () => {
    const sent: number[] = [];
    const p = new LocalPredictor((s) => sent.push(s));
    p.start(spawn(), 0);
    p.advance(60_000, RIGHT);
    expect(sent).toHaveLength(MAX_CATCHUP_TICKS);
  });
  it('reconcile drops acknowledged inputs and keeps the rest', () => {
    const p = new LocalPredictor(() => {});
    p.start(spawn(), 0);
    for (let i = 0; i < 6; i++) p.advance(TICK_MS, RIGHT); // seq 0..5
    const server = spawnBody(ARENA.spawns[0]!.x, ARENA.spawns[0]!.y);
    for (let i = 0; i < 3; i++) stepBody(server, RIGHT); // server applied 0..2
    p.reconcile(asPlayer(server, 2), 0);
    expect(p.pendingCount).toBe(3);
  });
  it('a correct prediction produces no visible correction', () => {
    const p = new LocalPredictor(() => {});
    p.start(spawn(), 0);
    p.advance(TICK_MS * 5, RIGHT);
    const before = p.render()!;
    const server = spawnBody(ARENA.spawns[0]!.x, ARENA.spawns[0]!.y);
    for (let i = 0; i < 3; i++) stepBody(server, RIGHT);
    p.reconcile(asPlayer(server, 2), 0);
    const after = p.render()!;
    expect(after.x).toBeCloseTo(before.x, 4);
    expect(after.y).toBeCloseTo(before.y, 4);
  });
  it('a misprediction is corrected toward the server and smoothed (no visual pop)', () => {
    const p = new LocalPredictor(() => {});
    p.start(spawn(), 0);
    p.advance(TICK_MS * 5, RIGHT);
    const renderedBefore = p.render()!.x;
    // server says we were shoved 30px back (authoritative disagreement)
    const server = spawnBody(ARENA.spawns[0]!.x - 30, ARENA.spawns[0]!.y);
    p.reconcile(asPlayer(server, -1), 0); // nothing acked: replay all 5
    expect(p.predicted()!.x).toBeLessThan(ARENA.spawns[0]!.x + 5 * MOVE_SPEED * TICK_DT - 29); // truth adopted
    expect(p.render()!.x).toBeCloseTo(renderedBefore, 3); // but the screen did not jump
    p.advance(1000, { moveX: 0, jump: false });
    expect(Math.abs(p.render()!.x - p.predicted()!.x)).toBeLessThan(2); // error decayed away
  });
  it('snaps (no smoothing) when the error exceeds SNAP_DISTANCE', () => {
    const p = new LocalPredictor(() => {});
    p.start(spawn(), 0);
    p.advance(TICK_MS * 2, RIGHT);
    const far = spawnBody(ARENA.spawns[0]!.x + SNAP_DISTANCE + 400, ARENA.spawns[0]!.y);
    p.reconcile(asPlayer(far, -1), 0);
    expect(p.render()!.x).toBeGreaterThan(ARENA.spawns[0]!.x + SNAP_DISTANCE);
  });
  it('a new epoch (arena reset) discards pending inputs and resyncs', () => {
    const p = new LocalPredictor(() => {});
    p.start(spawn(), 0);
    p.advance(TICK_MS * 8, RIGHT);
    p.reconcile(spawn(), 1);
    expect(p.pendingCount).toBe(0);
    expect(p.predicted()!.x).toBe(ARENA.spawns[0]!.x);
  });
  it('seq stays monotonic across a reset so the server never rejects it as a replay', () => {
    const sent: number[] = [];
    const p = new LocalPredictor((s) => sent.push(s));
    p.start(spawn(), 0);
    p.advance(TICK_MS * 3, RIGHT);
    p.reconcile(spawn(), 1);
    p.advance(TICK_MS * 3, RIGHT);
    expect(sent).toEqual([0, 1, 2, 3, 4, 5]);
  });
});

describe('prediction vs. delayed authoritative server (loopback)', () => {
  it('lossless link: every reconciliation is a zero-correction, and the client settles exactly on the server', () => {
    const LATENCY_TICKS = 3; // each way
    const serverBody = spawnBody(ARENA.spawns[1]!.x, ARENA.spawns[1]!.y);
    const toServer: { at: number; seq: number; input: InputIntent }[] = [];
    const toClient: { at: number; player: GamePlayer }[] = [];
    let ack = -1;
    let now = 0;
    const p = new LocalPredictor((seq, input) => toServer.push({ at: now + LATENCY_TICKS, seq, input }));
    p.start(asPlayer(serverBody, -1), 0);

    let maxCorrection = 0;
    let reconciles = 0;
    const deliver = () => {
      const arrived = toServer.filter((m) => m.at <= now);
      toServer.splice(0, arrived.length);
      for (const m of arrived) { stepBody(serverBody, m.input); ack = m.seq; } // server: one input per tick
      toClient.push({ at: now + LATENCY_TICKS, player: asPlayer(serverBody, ack) });
      for (const m of toClient.filter((c) => c.at <= now)) {
        toClient.splice(toClient.indexOf(m), 1);
        const before = p.predicted()!;
        p.reconcile(m.player, 0);
        const after = p.predicted()!;
        maxCorrection = Math.max(maxCorrection, Math.abs(before.x - after.x) + Math.abs(before.y - after.y));
        reconciles++;
      }
    };

    for (now = 0; now < 400; now++) {
      // scripted player: run right, hop every 23 ticks, reverse halfway (hits platforms/walls/bounds)
      p.advance(TICK_MS, { moveX: now < 200 ? 1 : -1, jump: now % 23 === 0 });
      deliver();
    }
    for (let i = 0; i < 12; i++) { now++; deliver(); } // let everything in flight land; client sends no more

    expect(reconciles).toBeGreaterThan(300);
    expect(maxCorrection).toBeLessThan(1e-9); // prediction == server whenever nothing is lost
    expect(p.pendingCount).toBe(0);
    const head = p.predicted()!;
    expect(head.x).toBe(serverBody.x);
    expect(head.y).toBe(serverBody.y);
    expect(head.vy).toBe(serverBody.vy);
  });
});
