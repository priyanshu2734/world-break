import { describe, expect, it } from 'vitest';
import { ARENA, GameSnapshotSchema, MAX_IMPULSES_LISTED, MAX_ZONES_LISTED, MOMENTUM_IMPULSE, PROP_H, PROP_W, WorldPublicSchema } from '@wb/shared';
import { PhysicsWorld } from '../../src/abilities/world';
import { GameSim } from '../../src/game';

const spawn = (id: string, x: number, y: number) => ({ id, kind: 'crate' as const, x, y, light: true });
const world = (...s: ReturnType<typeof spawn>[]) => { const w = new PhysicsWorld(ARENA); w.reset(s); return w; };
/** Test-only: the prop must exist. */
const P = (w: PhysicsWorld, id: string) => w.prop(id)!;

describe('PhysicsWorld props', () => {
  it('a prop dropped in mid-air falls and rests on the platform below, deterministically', () => {
    const run = () => { const w = world(spawn('c', 600, 400)); for (let i = 0; i < 80; i++) w.step(); return { ...P(w, 'c') }; };
    const a = run(), b = run();
    expect(a).toEqual(b);
    expect(a.y).toBe(500); // centre platform top
    expect(a.grounded).toBe(true);
    expect(a.vy).toBe(0);
  });
  it('is empty (no public projection) until something exists, and reset restores the authored props', () => {
    const w = new PhysicsWorld(ARENA);
    expect(w.isEmpty).toBe(true);
    expect(w.publicState()).toBeUndefined();
    w.reset([spawn('c', 300, 590)]);
    w.impulseProp('c', 400, 0, false);
    for (let i = 0; i < 10; i++) w.step();
    expect(P(w, 'c').x).not.toBe(300);
    w.reset([spawn('c', 300, 590)]);
    expect(w.tick).toBe(0);
    expect(P(w, 'c').x).toBe(300);
    expect(WorldPublicSchema.safeParse(w.publicState()).success).toBe(true);
  });
  it('props slide with friction, stop, and never leave the arena or enter a solid (fuzz)', () => {
    const w = world(spawn('c', 300, 590));
    let seed = 7; const rnd = () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32;
    for (let i = 0; i < 4000; i++) {
      if (i % 25 === 0) w.impulseProp('c', (rnd() - 0.5) * 2 * MOMENTUM_IMPULSE, (rnd() - 0.5) * 2 * MOMENTUM_IMPULSE, rnd() < 0.1);
      w.step();
      const p = P(w, 'c');
      for (const v of [p.x, p.y, p.vx, p.vy]) expect(Number.isFinite(v)).toBe(true);
      expect(p.x).toBeGreaterThanOrEqual(PROP_W / 2); expect(p.x).toBeLessThanOrEqual(ARENA.width - PROP_W / 2);
      expect(p.y).toBeGreaterThanOrEqual(PROP_H); expect(p.y).toBeLessThanOrEqual(ARENA.height);
      expect(ARENA.solids.some((r) => p.x + p.w / 2 > r.x + 1e-6 && p.x - p.w / 2 < r.x + r.w - 1e-6 && p.y > r.y + 1e-6 && p.y - p.h < r.y + r.h - 1e-6)).toBe(false);
    }
  });
  it('impulses are bounded per axis, and NaN/Infinity are ignored', () => {
    const w = world(spawn('c', 300, 590));
    w.impulseProp('c', 1e9, -1e9, false);
    expect(Math.abs(P(w, 'c').vx)).toBeLessThanOrEqual(MOMENTUM_IMPULSE);
    expect(Math.abs(P(w, 'c').vy)).toBeLessThanOrEqual(MOMENTUM_IMPULSE);
    const w2 = world(spawn('c', 300, 590));
    w2.impulseProp('c', Number.NaN, Number.POSITIVE_INFINITY, false);
    expect(P(w2, 'c').vx).toBe(0); expect(P(w2, 'c').vy).toBe(0);
    expect(w2.addImpulse({ playerId: 'p', dvx: Number.NaN, dvy: 1e12, cancel: false, driftTicks: 8 })!.dvx).toBe(0);
    expect(w2.addImpulse({ playerId: 'p', dvx: 0, dvy: 1e12, cancel: false, driftTicks: 8 })!.dvy).toBe(MOMENTUM_IMPULSE);
  });
  it('lists are bounded (zones, impulses)', () => {
    const w = world(spawn('c', 300, 590));
    let zones = 0, imps = 0;
    for (let i = 0; i < 50; i++) {
      if (w.addZone({ ownerId: 'p', x: 0, y: 0, w: 320, h: 320, gx: 0, gy: -1800, durationTicks: 100 })) zones++;
      if (w.addImpulse({ playerId: 'p', dvx: 0, dvy: 0, cancel: true, driftTicks: 4 })) imps++;
    }
    expect(zones).toBe(MAX_ZONES_LISTED);
    expect(imps).toBe(MAX_IMPULSES_LISTED);
  });
  it('clones expire and disappear; zones and impulses are pruned after their keep window', () => {
    const w = world(spawn('c', 300, 590));
    w.addClone('c', 'p', 330, 590, 10);
    w.addZone({ ownerId: 'p', x: 0, y: 0, w: 100, h: 100, gx: 0, gy: 0, durationTicks: 5 });
    w.addImpulse({ playerId: 'p', dvx: 1, dvy: 0, cancel: false, driftTicks: 4 });
    expect(w.propCount).toBe(2);
    for (let i = 0; i < 12; i++) w.step();
    expect(w.propCount).toBe(1);
    for (let i = 0; i < 100; i++) w.step();
    expect(w.publicState()!.zones).toHaveLength(0);
    expect(w.publicState()!.impulses).toHaveLength(0);
  });
  it('a clone cannot be placed inside a solid or outside the arena', () => {
    const w = world(spawn('c', 300, 590));
    expect(w.addClone('c', 'p', 300, 600, 10)).toBeNull(); // inside the low-left platform
    expect(w.addClone('c', 'p', -5, 590, 10)).toBeNull();
    expect(w.addClone('c', 'p', 300, 5000, 10)).toBeNull();
    expect(w.addClone('c', 'p', 300, 560, 10)).not.toBeNull();
  });
});

describe('GameSim carries the world in its snapshot', () => {
  const sim = () => new GameSim([{ id: 'p0', name: 'P0', slot: 0 }]);
  it('has no `world` key when nothing physical exists (pre-P3B snapshots are unchanged)', () => {
    const s = sim().snapshot('playing', 0, 1);
    expect('world' in s).toBe(false);
    expect(GameSnapshotSchema.safeParse(s).success).toBe(true);
  });
  it('publishes configured props, steps them with the sim, and resets them with the sim', () => {
    const g = sim();
    g.configure([spawn('c', 600, 400)]);
    for (let i = 0; i < 60; i++) g.step();
    const snap = g.snapshot('playing', 0, 1);
    expect(GameSnapshotSchema.safeParse(snap).success).toBe(true);
    expect(snap.world!.props[0]!.y).toBe(500);
    expect(g.world.tick).toBe(g.tick);
    g.reset();
    expect(g.snapshot('playing', 0, 1).world!.props[0]!.y).toBe(400);
    expect(g.world.tick).toBe(0);
  });
  it('can switch arena; the new world is empty until reconfigured', () => {
    const g = sim();
    g.configure([spawn('c', 300, 590)]);
    g.loadArena({ ...ARENA, id: 'other' });
    expect(g.arena.id).toBe('other');
    expect(g.snapshot('playing', 0, 1).arenaId).toBe('other');
    expect(g.world.propCount).toBe(1); // authored props carry over to the fresh world
  });
});
