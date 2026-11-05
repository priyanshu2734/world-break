import { describe, expect, it } from 'vitest';
import { GHOST_LIMITS, GHOST_TABLE, MAX_GHOSTS, ghostCountForStage, ghostLineupForStage, type GhostType } from '@wb/shared';
import { GhostSystem } from '../../src/ghost';
import { puppet, rig, run, tick } from './harness';

/** P3F step 4: the second ghost from stage 20: never more than two, each with its own warning, and the upgrades' effects on the warning and on hearing. */
describe('P3F step 4: two ghosts from stage 20', () => {
  it('the count is 1 until stage 19, 2 from stage 20, never more (stage 1,000,000 too), and the lineup has that many distinct types', () => {
    expect(ghostCountForStage(19)).toBe(1);
    for (const s of [20, 21, 99, 1_000_000]) {
      expect(ghostCountForStage(s)).toBe(2);
      for (const pick of [0, 1]) { const l = ghostLineupForStage(s, pick); expect(l.length).toBe(2); expect(new Set(l).size).toBe(2); }
    }
    expect(GHOST_TABLE.maxGhosts).toBe(2);
    expect(MAX_GHOSTS).toBe(2);
    for (let s = 2; s < 60; s++) expect(ghostLineupForStage(s, 0).length).toBeLessThanOrEqual(2);
  });
  it('the ghost system never runs a third ghost, even when asked for three types', () => {
    const r = rig({ stage: 20, seed: 3, types: ['wisp', 'shade', 'howler'], players: (g) => [puppet('p0', g.start, 300, 680, { hidden: true })] });
    expect(r.sys.snapshotActors().length).toBe(2);
  });
  it('two warnings never run at the same time: each ghost has its own, and each is the standard length', () => {
    for (const seed of [1, 2, 3, 4, 5]) {
      const r = rig({ stage: 22, seed, types: ghostLineupForStage(22, seed & 1), players: (g) => [puppet('p0', g.start, 300, 680, { hidden: true })] });
      const lengths = new Map<string, number>();
      let both = 0, kindsMax = 0, appeared = new Set<string>();
      run(r, 12000, () => {
        const w = r.sys.snapshotActors().filter((a) => a.state === 'warning');
        if (w.length > 1) both++;
        kindsMax = Math.max(kindsMax, r.sys.warnKinds().length);
        for (const a of r.sys.snapshotActors()) if (a.present) appeared.add(a.id);
        for (const a of w) lengths.set(a.id, Math.max(lengths.get(a.id) ?? 0, a.until - r.host.tick));
      });
      expect(both, `seed ${seed}`).toBe(0);
      expect(kindsMax).toBeLessThanOrEqual(1);
      expect(appeared.size, `seed ${seed}: both ghosts came`).toBe(2);
      for (const l of lengths.values()) expect(l).toBeGreaterThanOrEqual(GHOST_LIMITS.minWarningTicks);
    }
  });
});

describe('P3F step 4: the upgrades reach the ghost through its host', () => {
  function firstWarningLeft(shift: number, bonus = 0): number {
    const r = rig({ stage: 9, seed: 5, types: ['shade'], players: (g) => [puppet('p0', g.start, 300)] });
    const sys = new GhostSystem(
      { stage: 9, seed: 5, difficulty: 'easy', graph: r.graph, visionRadius: r.radius, types: ['shade'] },
      Object.assign(r.host, { warningShift: () => shift, warningBonus: (_k: GhostType) => bonus }),
    );
    for (let i = 0; i < 4000; i++) { r.host.tick++; sys.step(); if (sys.warning) return sys.snapshotActors()[0]!.until - r.host.tick; }
    throw new Error('no warning came');
  }
  it('a shorter warning (the hair trigger) is never below the 60-tick minimum, however large the shift', () => {
    expect(firstWarningLeft(0)).toBe(GHOST_LIMITS.warningTicks);
    expect(firstWarningLeft(-20)).toBe(GHOST_LIMITS.minWarningTicks);
    expect(firstWarningLeft(-500)).toBe(GHOST_LIMITS.minWarningTicks);
    expect(firstWarningLeft(30)).toBe(GHOST_LIMITS.warningTicks); // a shift never LENGTHENS (only a right journal entry does)
    expect(firstWarningLeft(-20, 40)).toBe(GHOST_LIMITS.warningTicks + 20); // the two add
  });
  it('soft steps shrink the range a ghost hears a noise from, loud lamp grows it', () => {
    function heard(share: number, dx: number): boolean {
      const r = rig({ stage: 3, seed: 7, types: ['wisp'], players: (g) => [puppet('p0', g.start, 300, 680, { hidden: true })] });
      const sys = new GhostSystem({ stage: 3, seed: 7, difficulty: 'easy', graph: r.graph, visionRadius: r.radius, types: ['wisp'] }, Object.assign(r.host, { hearingShare: () => share }));
      sys.placeForTest('g0', { room: r.graph.start, x: 700, y: 658, angle: 0 });
      sys.makeNoise({ room: r.graph.start, x: 700 + dx, y: 680, loud: 1, player: 'p0', name: 'P0', kind: 'drop' });
      return sys.events.some((e) => e.kind === 'heard');
    }
    // the farthest distance the noise still carries, found by scanning (the range depends on the stage tuning and the room's walls)
    const reach = (share: number): number => { let far = 0; for (let dx = 20; dx <= 600; dx += 10) if (heard(share, dx)) far = dx; return far; };
    const base = reach(1);
    expect(base).toBeGreaterThan(0);
    expect(reach(0.7)).toBeLessThan(base);
    expect(reach(0.7)).toBeGreaterThan(0);
    expect(reach(1.3)).toBeGreaterThan(base);
    tick; // (keeps the harness import used)
  });
});
