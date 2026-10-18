import { describe, expect, it } from 'vitest';
import {
  MOMENTUM_DRIFT_TICKS, MOMENTUM_IMPULSE, TICK_DT, WELL_GRAVITY, type GravityZone, type ImpulseEvent, type InputIntent, type WorldPublic,
} from '@wb/shared';
import { GameSim } from '../../src/game';
// Prediction lives in the client package; it only depends on @wb/shared, so the parity test can drive it directly.
import { LocalPredictor } from '../../../client/src/sim/prediction';

const TICK_MS = TICK_DT * 1000;
const PID = 'p0';
const lcg = (seed: number) => () => (seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 2 ** 32;

type Planned = { tick: number; zone?: Omit<GravityZone, 'id' | 'startTick' | 'expiresTick'> & { life: number }; impulse?: { dvx: number; dvy: number; cancel: boolean } };

/** A random event schedule: zones (flip / reduce / wind) and impulses, all within the documented bounds. */
function schedule(r: () => number, ticks: number): Planned[] {
  const out: Planned[] = [];
  for (let t = 5; t < ticks; t++) {
    if (r() < 0.025) {
      const k = r();
      out.push({ tick: t, zone: {
        ownerId: 'o', x: r() * 900, y: r() * 360, w: 320, h: 320, gx: k < 0.2 ? (r() - 0.5) * 3600 : 0,
        gy: k < 0.5 ? WELL_GRAVITY.flip : WELL_GRAVITY.reduce, life: 40 + Math.floor(r() * 80),
      } });
    }
    if (r() < 0.04) out.push({ tick: t, impulse: { dvx: (r() - 0.5) * 2 * MOMENTUM_IMPULSE, dvy: (r() - 0.5) * 2 * MOMENTUM_IMPULSE, cancel: r() < 0.15 } });
  }
  return out;
}
const randomInput = (r: () => number): InputIntent => ({ moveX: r() < 0.3 ? 0 : r() < 0.5 ? 1 : r() < 0.7 ? -1 : r() * 2 - 1, jump: r() < 0.15 });

function inject(sim: GameSim, plan: Planned[], tick: number) {
  for (const p of plan) if (p.tick === tick) {
    if (p.zone) sim.world.addZone({ ownerId: p.zone.ownerId, x: p.zone.x, y: p.zone.y, w: p.zone.w, h: p.zone.h, gx: p.zone.gx, gy: p.zone.gy, durationTicks: p.zone.life });
    if (p.impulse) sim.world.addImpulse({ playerId: PID, ...p.impulse, driftTicks: MOMENTUM_DRIFT_TICKS });
  }
}
/** The full event list as the client would eventually see it (same numbers the server created). */
function fullWorld(plan: Planned[]): WorldPublic {
  const zones: GravityZone[] = [], impulses: ImpulseEvent[] = [];
  plan.forEach((p, i) => {
    if (p.zone) zones.push({ id: `z${i}`, ownerId: p.zone.ownerId, x: p.zone.x, y: p.zone.y, w: p.zone.w, h: p.zone.h, gx: p.zone.gx, gy: p.zone.gy, startTick: p.tick, expiresTick: p.tick + p.zone.life });
    if (p.impulse) impulses.push({ id: `i${i}`, tick: p.tick, playerId: PID, dvx: p.impulse.dvx, dvy: p.impulse.dvy, cancel: p.impulse.cancel, driftTicks: MOMENTUM_DRIFT_TICKS });
  });
  return { zones, impulses, props: [] };
}
const mk = () => new GameSim([{ id: PID, name: 'P', slot: 0 }, { id: 'p1', name: 'Q', slot: 1 }]);

describe('server step vs client prediction: same function, same data', () => {
  it.each([1, 2, 3, 4, 5])('lockstep, seed %i: 2500 ticks of random input and random zones/impulses match BIT-FOR-BIT', (seed) => {
    const r = lcg(seed * 7919);
    const plan = schedule(r, 2500);
    const sim = mk();
    const init = sim.snapshot('playing', 0, 1).players[0]!;
    const pred = new LocalPredictor((q, input) => { sim.queueInput(PID, q, input); });
    pred.start(init, 0, { tick: 0, playerId: PID, world: fullWorld(plan) });
    let zoneTicks = 0, impulseTicks = 0;
    for (let t = 0; t < 2500; t++) {
      inject(sim, plan, t);
      pred.advance(TICK_MS, randomInput(r)); // sends the intent (queued on the server) and predicts it
      sim.step();
      const server = sim.positionOf(PID)!, mine = pred.predicted()!;
      expect(mine.x).toBe(server.x);
      expect(mine.y).toBe(server.y);
      if (sim.world.activeZones(sim.tick).length) zoneTicks++;
      if (sim.world.publicState()?.impulses.length) impulseTicks++;
    }
    expect(zoneTicks).toBeGreaterThan(300); // the zones were really active for a large part of the run
    expect(impulseTicks).toBeGreaterThan(300);
  });

  it('without world data the predictor is the pre-P3B predictor (default path)', () => {
    const r = lcg(42);
    const sim = mk();
    const pred = new LocalPredictor((q, input) => { sim.queueInput(PID, q, input); });
    pred.start(sim.snapshot('playing', 0, 1).players[0]!, 0);
    for (let t = 0; t < 1500; t++) {
      pred.advance(TICK_MS, randomInput(r)); sim.step();
      expect(pred.predicted()!.x).toBe(sim.positionOf(PID)!.x);
      expect(pred.predicted()!.y).toBe(sim.positionOf(PID)!.y);
    }
  });

  it.each([2, 3, 5])('with %i ticks of latency and a reconcile on every snapshot, prediction stays within rounding of the server', (lag) => {
    const r = lcg(777 + lag);
    const plan = schedule(r, 2000);
    const sim = mk();
    const inFlight: { at: number; seq: number; input: InputIntent }[] = [];
    const headAt: { x: number; y: number }[] = [];
    const serverAt: { x: number; y: number }[] = [];
    const eventTicks = plan.map((p) => p.tick);
    let compared = 0, worst = 0, off = 0;
    const sendPred = new LocalPredictor((q, input) => { inFlight.push({ at: sim.tick + lag, seq: q, input }); });
    sendPred.start(sim.snapshot('playing', 0, 1).players[0]!, 0, { tick: 0, playerId: PID });
    for (let t = 0; t < 2000; t++) {
      // the client side: predict + send. Silent for the first `lag` ticks so the server queue is never empty.
      const input = t < lag ? { moveX: 0, jump: false } : randomInput(r);
      sendPred.advance(TICK_MS, input);
      // the server side: deliver what has arrived, inject events, step, publish a snapshot
      for (const m of inFlight.filter((x) => x.at <= sim.tick)) sim.queueInput(PID, m.seq, m.input);
      inFlight.splice(0, inFlight.length, ...inFlight.filter((x) => x.at > sim.tick));
      inject(sim, plan, t);
      sim.step();
      serverAt.push({ x: sim.positionOf(PID)!.x, y: sim.positionOf(PID)!.y });
      const snap = sim.snapshot('playing', 0, 1);
      sendPred.reconcile(snap.players[0]!, snap.epoch, { tick: snap.tick, playerId: PID, world: snap.world });
      headAt.push({ x: sendPred.predicted()!.x, y: sendPred.predicted()!.y });
      // the head after the reconcile at iteration T has applied the inputs the server will apply up to iteration T+lag
      const T = t - lag;
      if (T >= lag + 1) {
        const unforeseen = eventTicks.some((et) => et > T && et <= t); // an event created after that snapshot cannot be predicted
        if (!unforeseen) {
          const dx = Math.abs(headAt[T]!.x - serverAt[t]!.x), dy = Math.abs(headAt[T]!.y - serverAt[t]!.y);
          worst = Math.max(worst, dx, dy); compared++;
          if (Math.max(dx, dy) > 0.1) off++;
        }
      }
    }
    expect(compared).toBeGreaterThan(300);
    // Snapshots publish positions rounded to 0.01. Almost always that is all that separates them (< 0.1 px). Very rarely a body
    // hovers exactly on a zone/collision edge and the rounding decides WHICH sub-step it crosses it: one sub-step of gravity,
    // a few px at most, far below SNAP_DISTANCE (100), and corrected by the next snapshot. The bit-exact lockstep tests above
    // prove the function and data are identical; this test only bounds the effect of rounding under latency.
    expect(off / compared).toBeLessThan(0.02);
    expect(worst).toBeLessThan(5);
  });

  it('a late-arriving zone is corrected by the server, never trusted: after the next reconcile the head is the server state', () => {
    const sim = mk();
    const pred = new LocalPredictor((q, input) => { sim.queueInput(PID, q, input); });
    pred.start(sim.snapshot('playing', 0, 1).players[0]!, 0, { tick: 0, playerId: PID });
    for (let t = 0; t < 20; t++) { pred.advance(TICK_MS, { moveX: 0, jump: false }); sim.step(); }
    sim.world.addZone({ ownerId: 'o', x: 0, y: 360, w: 320, h: 360, gx: 0, gy: WELL_GRAVITY.flip, durationTicks: 100 });
    for (let t = 0; t < 30; t++) { pred.advance(TICK_MS, { moveX: 0, jump: false }); sim.step(); } // the client does not know the zone yet
    expect(Math.abs(pred.predicted()!.y - sim.positionOf(PID)!.y)).toBeGreaterThan(50);
    const snap = sim.snapshot('playing', 0, 1);
    pred.reconcile(snap.players[0]!, snap.epoch, { tick: snap.tick, playerId: PID, world: snap.world });
    expect(Math.abs(pred.predicted()!.y - sim.positionOf(PID)!.y)).toBeLessThan(0.01);
  });
});
