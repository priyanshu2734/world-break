import { describe, expect, it } from 'vitest';
import { GHOST_LIMITS, IDENTIFY_FROM_STAGE, JOURNAL, PUBLIC_GHOST_KINDS, type GhostType } from '@wb/shared';
import { GhostSystem } from '../../src/ghost';
import { puppet, rig, run } from './harness';

/** P3F step 3: from stage 7 the ghost's type is not in anything a client is sent; a correct journal entry lengthens that type's warning. */
const TYPES: GhostType[] = ['wisp', 'shade', 'howler'];

describe('P3F step 3: the type is masked from stage 7', () => {
  for (const stage of [IDENTIFY_FROM_STAGE, 8, 50, 1_000_000]) {
    it(`stage ${stage}: public ghosts, cue sounds and warning kinds say "unknown"`, () => {
      for (const type of TYPES) {
        const r = rig({ stage, seed: 11, types: [type], players: (g) => [puppet('p0', g.start, 300)] });
        r.sys.placeForTest('g0', { room: r.graph.start, x: 700, y: 658, angle: 0 });
        const pub = r.sys.publicGhosts();
        expect(pub.length).toBe(1);
        expect(pub[0]!.kind).toBe('unknown');
        const cue = r.sys.cueFor(r.graph.start, 300, 680);
        expect(cue.sounds[0]!.kind).toBe('unknown');
        expect(JSON.stringify([pub, cue])).not.toContain(type);
      }
    });
  }
  it('before stage 7 the type is still named', () => {
    const r = rig({ stage: IDENTIFY_FROM_STAGE - 1, seed: 11, types: ['shade'], players: (g) => [puppet('p0', g.start, 300)] });
    r.sys.placeForTest('g0', { room: r.graph.start, x: 700, y: 658, angle: 0 });
    expect(r.sys.publicGhosts()[0]!.kind).toBe('shade');
  });
  it('warning kinds and fx are masked too, and only the allowed public kinds ever appear', () => {
    const r = rig({ stage: 9, seed: 5, types: ['howler'], players: (g) => [puppet('p0', g.start, 300)] });
    let seen = false;
    run(r, 3000, () => { if (r.sys.warning) { seen = true; expect(r.sys.warnKinds()).toEqual(['unknown']); } });
    expect(seen).toBe(true);
    for (const fx of r.sys.drainFx()) expect(PUBLIC_GHOST_KINDS).toContain(fx.ghost);
    // the server's own view keeps the real type (tests, debug)
    expect(r.sys.snapshotActors()[0]!.kind).toBe('howler');
  });
});

describe('P3F step 3: a correct entry lengthens the warning', () => {
  function firstWarningLeft(bonus: number): number {
    const r = rig({ stage: 9, seed: 5, types: ['shade'], players: (g) => [puppet('p0', g.start, 300)] });
    const sys = new GhostSystem(
      { stage: 9, seed: 5, difficulty: 'easy', graph: r.graph, visionRadius: r.radius, types: ['shade'] },
      Object.assign(r.host, { warningBonus: (k: GhostType) => (k === 'shade' ? bonus : 0) }),
    );
    for (let i = 0; i < 4000; i++) {
      r.host.tick++;
      sys.step();
      if (sys.warning) { const a = sys.snapshotActors()[0]!; return a.until - r.host.tick; }
    }
    throw new Error('no warning came');
  }
  it('the warning is the standard length without a bonus, and longer by exactly the bonus with one', () => {
    expect(firstWarningLeft(0)).toBe(GHOST_LIMITS.warningTicks);
    expect(firstWarningLeft(JOURNAL.warningBonusTicks)).toBe(GHOST_LIMITS.warningTicks + JOURNAL.warningBonusTicks);
  });
  it('a negative bonus never shortens the warning', () => {
    expect(firstWarningLeft(-500)).toBe(GHOST_LIMITS.warningTicks);
  });
});
