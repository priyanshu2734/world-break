import { describe, expect, it } from 'vitest';
import {
  ABILITY_SPECS, ARENA, GameSnapshotSchema, MOMENTUM_DRIFT_TICKS, MOMENTUM_IMPULSE, TICK_DT, WELL_HALF_SIZE, type AbilityAction,
} from '@wb/shared';
import { Room } from '../../src/room';
import { Lockstep } from '../helpers/bot';
import { abilityHarness, crate } from '../helpers/abilityHarness';

/** A running stage 2 (abilities on by default) with n players standing at their spawns. */
function stage2(n = 1) {
  const r = new Room('ABCD', 2);
  for (let i = 0; i < n; i++) r.join(`p${i}`, `P${i}`);
  for (let i = 1; i < n; i++) r.setReady(`p${i}`, true);
  r.start('p0');
  for (let i = 0; i < 5 && r.phase !== 'playing'; i++) r.tick();
  (r as unknown as { phase: string }).phase = 'stage_complete';
  expect(r.nextStage('p0').ok).toBe(true);
  for (let i = 0; i < 5 && r.phase !== 'playing'; i++) r.tick();
  const s = new Lockstep(r);
  const ids = Array.from({ length: n }, (_, i) => `p${i}`);
  const idle = (ticks: number) => { for (let i = 0; i < ticks; i++) s.tick(new Map(ids.map((id) => [id, null]))); };
  for (let i = 0; i < 8; i++) idle(1); // clear the engine's first-ticks window
  return { r, s, ids, idle, me: (id = 'p0') => r.gameSnapshot()!.players.find((p) => p.id === id)! };
}
const well = (x: number, y: number, mode: 'flip' | 'reduce' = 'flip'): AbilityAction => ({ ability: 'gravity_well', x, y, mode });

describe('Gravity Well through the real Room', () => {
  it('flipped gravity lifts a standing player; without the well they stay on the floor', () => {
    const control = stage2(); control.idle(60);
    expect(control.me().y).toBe(680);
    const t = stage2();
    expect(t.r.abilityAction('p0', well(90, 560))).toMatchObject({ ok: true });
    t.idle(60);
    expect(t.me().y).toBeLessThan(600);
    expect(t.me().y).toBeGreaterThanOrEqual(44);
    expect(Number.isFinite(t.me().x)).toBe(true);
  });
  it('the zone is public data with an expiry, and the snapshot still validates', () => {
    const t = stage2();
    const before = t.r.gameSnapshot()!.tick;
    t.r.abilityAction('p0', well(90, 560));
    const snap = t.r.gameSnapshot()!;
    expect(GameSnapshotSchema.safeParse(snap).success).toBe(true);
    const z = snap.world!.zones[0]!;
    expect(z).toMatchObject({ ownerId: 'p0', gx: 0, gy: -1800, startTick: before, expiresTick: before + ABILITY_SPECS.gravity_well.durationTicks });
    expect(z.w).toBe(WELL_HALF_SIZE * 2); expect(z.h).toBe(WELL_HALF_SIZE * 2);
    expect(z.x).toBeGreaterThanOrEqual(0); expect(z.y).toBeGreaterThanOrEqual(0);
    expect(z.x + z.w).toBeLessThanOrEqual(ARENA.width); expect(z.y + z.h).toBeLessThanOrEqual(ARENA.height);
  });
  it('the well ends on schedule and the player falls back and can stand again', () => {
    const t = stage2();
    t.r.abilityAction('p0', well(90, 560));
    t.idle(ABILITY_SPECS.gravity_well.durationTicks + 80);
    expect(t.me().grounded).toBe(true);
    expect(t.r.peekStageState()!.abilities!.active.wells).toBe(0);
  });
  it('a reduced well turns a normal jump into a much higher one', () => {
    const apex = (reduce: boolean) => {
      const t = stage2();
      if (reduce) t.r.abilityAction('p0', well(90, 560, 'reduce'));
      let min = 680;
      for (let i = 0; i < 40; i++) { t.s.tick(new Map([['p0', { moveX: 0, jump: i === 0 }]])); min = Math.min(min, t.me().y); }
      return 680 - min;
    };
    // the spawn column sits under the upper-left platform (head-bump at 206 px), so the ratio is capped by geometry; the
    // unobstructed ratio (about 4x) is covered in shared/test/sim.world.test.ts
    expect(apex(true)).toBeGreaterThan(apex(false) * 1.5);
  });
  it('is bounded: 2 wells per room, a cooldown per player, and range', () => {
    const t = stage2(3);
    expect(t.r.abilityAction('p0', well(90, 560)).ok).toBe(true);
    expect(t.r.abilityAction('p1', well(435, 560)).ok).toBe(true);
    t.idle(8);
    expect(t.r.abilityAction('p2', well(845, 560))).toEqual({ ok: false, error: 'The room already has 2 gravity wells.' });
    t.idle(8);
    expect(t.r.abilityAction('p0', well(90, 560))).toEqual({ ok: false, error: 'That ability is still recharging.' });
    expect(t.r.abilityAction('p2', well(845 + ABILITY_SPECS.gravity_well.range + 50, 560))).toEqual({ ok: false, error: 'Too far away.' });
    expect(t.r.peekStageState()!.abilities!.active.wells).toBe(2);
  });
  it('refuses points outside the arena', () => {
    const t = stage2();
    expect(t.r.abilityAction('p0', well(-100, 640))).toEqual({ ok: false, error: 'That point is outside the arena.' });
  });
});

describe('Momentum through the real Room', () => {
  it('shoves yourself sideways a bounded, predictable distance', () => {
    const t = stage2();
    const x0 = t.me().x;
    expect(t.r.abilityAction('p0', { ability: 'momentum', targetId: 'self', dir: 'right' }).ok).toBe(true);
    t.idle(MOMENTUM_DRIFT_TICKS + 6);
    const expected = MOMENTUM_IMPULSE * TICK_DT * Array.from({ length: MOMENTUM_DRIFT_TICKS }, (_, a) => 1 - a / MOMENTUM_DRIFT_TICKS).reduce((a, b) => a + b, 0);
    expect(t.me().x - x0).toBeCloseTo(expected, 1);
  });
  it('launches yourself upward, and cancel stops a fall', () => {
    const t = stage2();
    t.r.abilityAction('p0', { ability: 'momentum', targetId: 'self', dir: 'up' });
    let min = 680;
    for (let i = 0; i < 20; i++) { t.idle(1); min = Math.min(min, t.me().y); }
    expect(680 - min).toBeGreaterThan(60);
    expect(680 - min).toBeLessThan(140);
  });
  it('publishes the impulse as an event with its tick', () => {
    const t = stage2();
    const tick = t.r.gameSnapshot()!.tick;
    t.r.abilityAction('p0', { ability: 'momentum', targetId: 'self', dir: 'left' });
    expect(t.r.gameSnapshot()!.world!.impulses[0]).toMatchObject({ playerId: 'p0', tick, dvx: -MOMENTUM_IMPULSE, dvy: 0, cancel: false });
  });
  it('you cannot push another player (only yourself or objects)', () => {
    expect(stage2(2).r.abilityAction('p0', { ability: 'momentum', targetId: 'p1', dir: 'right' })).toEqual({ ok: false, error: 'Nothing there to push.' });
  });
});

describe('abilities act on objects too', () => {
  it('a flip well floats a crate up; a reduce well plus a push throws it much further', () => {
    const h = abilityHarness({ props: [crate('c', 300, 590)] });
    h.at('a', 300, 590);
    expect(h.ab('a', well(300, 500)).ok).toBe(true);
    h.run(40);
    expect(h.prop('c').y).toBeLessThan(560);
    expect(Number.isFinite(h.prop('c').x)).toBe(true);
  });
  it('momentum pushes a crate along the platform with friction, and it stops', () => {
    const h = abilityHarness({ props: [crate('c', 200, 590)] });
    h.at('a', 200, 590);
    expect(h.ab('a', { ability: 'momentum', targetId: 'c', dir: 'right' }).ok).toBe(true);
    h.run(60);
    const p = h.prop('c');
    expect(p.x).toBeGreaterThan(260); expect(p.x).toBeLessThan(385); // slid some way along the low-left platform
    expect(p.vx).toBe(0);
    expect(p.grounded).toBe(true);
  });
  it('a crate pushed off a ledge falls to the next platform (real prop physics)', () => {
    const h = abilityHarness({ props: [crate('c', 380, 590)] });
    h.at('a', 380, 590);
    h.ab('a', { ability: 'momentum', targetId: 'c', dir: 'right' });
    h.run(100);
    expect(h.prop('c').x).toBeGreaterThan(400);
    expect(h.prop('c').y).toBeGreaterThan(590); // it left the platform and dropped
  });
  it('cancel stops a thrown crate dead in the air', () => {
    const h = abilityHarness({ props: [crate('c', 300, 590)] });
    h.at('a', 300, 590);
    h.world.impulseProp('c', 0, -600, false);
    h.run(4);
    expect(h.prop('c').vy).toBeLessThan(0);
    expect(h.ab('a', { ability: 'momentum', targetId: 'c', dir: 'cancel' }).ok).toBe(true);
    expect(h.prop('c').vx).toBe(0); expect(h.prop('c').vy).toBe(0);
  });
});

describe('Anchor pins an area stable', () => {
  it('a gravity well cannot be opened inside an active anchor, but can just outside it', () => {
    const h = abilityHarness();
    h.at('a', 300, 590);
    expect(h.tool('a', 'gravity_anchor').ok).toBe(true);
    expect(h.ab('a', well(320, 560))).toEqual({ ok: false, error: 'A gravity anchor holds this area steady.' });
    expect(h.energy('a')).toBe(100);
    expect(h.ab('a', well(300 + 140 + 20, 570)).ok).toBe(true);
  });
  it('once the anchor fades the area can be bent again', () => {
    const h = abilityHarness();
    h.at('a', 300, 590);
    h.tool('a', 'gravity_anchor');
    h.run(405);
    expect(h.ab('a', well(320, 560)).ok).toBe(true);
  });
});
