import { describe, expect, it, vi } from 'vitest';
import { ARENA, deriveSeed } from '@wb/shared';
import { Room } from '../../src/room';
import { getStageDef } from '../../src/systems/registry';
import { generateDisasterStage, withDisasterPool } from '../../src/disasters/registry';
import { Lockstep, goTo, wait, type Script } from '../helpers/bot';
import { solveStage } from '../helpers/planner';

// Real-physics runs: a few hundred ticks each, but there are many of them.
vi.setConfig({ testTimeout: 60_000 });

const STAGE = 2;

/** One run seed per layout variant (mirror x breakpoint spot), found by asking the generator the Room will use. */
const VARIANTS = (() => {
  const found = new Map<string, number>();
  for (let runSeed = 1; runSeed <= 400 && found.size < 8; runSeed++) {
    const p = withDisasterPool(['reactor_overload'], () => generateDisasterStage(STAGE, deriveSeed(runSeed, 'stage', STAGE))).disaster!.params;
    const key = `${p.mirror ? 'mirrored' : 'normal'}/spot${p.breakpointSpot}`;
    if (!found.has(key)) found.set(key, runSeed);
  }
  return [...found].sort(([a], [b]) => a.localeCompare(b));
})();

/** The pool holds all five disasters now: pin it to reactor overload while the Room builds (and rebuilds) the stage. */
const reactorOnly = <T>(fn: () => T): T => withDisasterPool(['reactor_overload'], fn);

function start(runSeed: number, n: number) {
  return reactorOnly(() => startPinned(runSeed, n));
}
function startPinned(runSeed: number, n: number) {
  const room = new Room('ABCD', 2, runSeed);
  room.stage = STAGE; // begin directly on a generated stage
  const ids = Array.from({ length: n }, (_, i) => `p${i}`);
  ids.forEach((id, i) => room.join(id, `P${i}`));
  ids.slice(1).forEach((id) => room.setReady(id, true));
  expect(room.start('p0').ok).toBe(true);
  const sim = new Lockstep(room);
  while (room.phase !== 'playing') sim.tick();
  const rec = room.stageRecord!;
  expect(rec.fallback).toBe(false); // the generator, not the fallback, produced this stage
  expect(rec.defId).toBe(`reactor_overload_${STAGE}`);
  return { room, sim, ids, def: getStageDef(STAGE, rec.seed) };
}

describe('reactor overload: layout coverage', () => {
  it('the search found all 8 layout variants', () => {
    expect(VARIANTS.map(([k]) => k)).toHaveLength(8);
  });
});

describe('reactor overload is solvable through the real simulation', () => {
  for (const [variant, runSeed] of VARIANTS) {
    it.each([1, 2, 3, 4])(`${variant}: one player clears it with %i player(s) in the room`, (n) => {
      const { room, sim, def } = start(runSeed, n);
      expect(def.disaster!.id).toBe('reactor_overload');
      const t0 = sim.ticks;
      solveStage(sim, 'p0', def); // teammates stand idle: nothing mandatory depends on them
      const elapsed = sim.ticks - t0;

      expect(room.phase).toBe('stage_complete'); // real STAGE_CLEAR transition
      const s = sim.state();
      expect(s.status).toBe('stabilized');
      expect(s.objectives.every((o) => o.status === 'complete')).toBe(true);
      expect(s.symptoms.every((x) => x.state === 'resolved')).toBe(true);
      expect(s.score.total).toBeGreaterThan(500);
      expect(s.score.breakdown.hazard).toBeUndefined(); // the shield absorbed every discharge
      expect(elapsed).toBeLessThan(def.disaster!.schedule.escalateAtTick); // an ordinary run beats the escalation
      // lifecycle ended cleanly, nothing is left armed
      expect(s.disaster!.phase).toBe('cleanup');
      expect(s.hazards.every((h) => !h.armed && h.nextPulseTick === null)).toBe(true);
    });
  }
});

describe('reactor overload: lifecycle through the real Room', () => {
  const [[, runSeed]] = VARIANTS as [[string, number], ...[string, number][]];

  it('an idle team watches the disaster escalate and fail, but the stage stays completable (soft failure)', () => {
    const { room, sim, def } = start(runSeed, 2);
    const sched = def.disaster!.schedule;
    sim.run({ p0: wait(sched.failAtTick - sim.ticks + 10) }, 30_000);
    expect(room.phase).toBe('playing');
    expect(sim.state().disaster!.phase).toBe('failed');
    expect(sim.state().score.breakdown.disaster).toBeLessThan(0);
    // the arc is wider and faster than its base definition while the disaster is failing
    expect(sim.state().hazards[0]!.r).toBeGreaterThan(def.hazards[0]!.r);

    solveStage(sim, 'p0', def);
    expect(room.phase).toBe('stage_complete');
    expect(sim.state().disaster!.phase).toBe('cleanup');
    expect(sim.state().hazards.every((h) => !h.armed && h.r === def.hazards[0]!.r)).toBe(true);
  });

  it('wrong targets never win: decoy panel, a lone breaker and a locked console change nothing that matters', () => {
    const { room, sim, def } = start(runSeed, 2);
    const panel = def.entities.find((e) => e.id === 'temp_panel')!;
    const sw4 = def.entities.find((e) => e.id === 'sw_4')!;
    sim.run({
      p0: (function* (): Script {
        yield* goTo(() => sim.body('p0'), panel.x, panel.y);
        sim.do('p0', { kind: 'use_tool', tool: 'flux_welder', targetId: 'temp_panel' });
        yield* wait(60);
        yield* goTo(() => sim.body('p0'), sw4.x, sw4.y);
        sim.do('p0', { kind: 'interact', targetId: 'sw_4' });
        yield* wait(3000);
      })(),
    });
    expect(room.phase).toBe('playing');
    const s = sim.state();
    expect(s.objectives.find((o) => o.id === 'o_root')!.status).toBe('active');
    expect(s.objectives.find((o) => o.id === 'o_final')!.status).toBe('locked');
    expect(s.breakpoints).toEqual([]); // never investigated: still hidden
    expect(s.symptoms.find((x) => x.id === 's_arcs')!.state).toBe('active');
    expect(['active', 'escalated']).toContain(s.disaster!.phase);
    // and the console itself refuses
    const core = def.entities.find((e) => e.id === 'core')!;
    sim.run({ p0: goTo(() => sim.body('p0'), core.x, core.y) });
    expect(room.stageAction('p0', { kind: 'interact', targetId: 'core' }).ok).toBe(false);
  });

  it('clearing the stage and advancing starts a fresh disaster with nothing left over from the last one', () => {
    const { room, sim, def } = start(runSeed, 3);
    solveStage(sim, 'p0', def);
    expect(room.phase).toBe('stage_complete');
    const oldRev = sim.state().rev;

    expect(reactorOnly(() => room.nextStage('p0'))).toEqual({ ok: true });
    expect(room.stage).toBe(STAGE + 1);
    expect(room.stageRecord!.stage).toBe(STAGE + 1);
    expect(room.stageRecord!.fallback).toBe(false);
    const s = room.peekStageState()!;
    expect(s.rev).toBeGreaterThan(oldRev);
    expect(s.status).toBe('running');
    expect(s.tick).toBe(0);
    expect(s.score.total).toBe(0);
    expect(s.score.breakdown).toEqual({});
    expect(s.disaster).toMatchObject({ phase: 'warning', id: 'reactor_overload' });
    expect(s.hazards.every((h) => !h.armed && h.nextPulseTick === null)).toBe(true);
    expect(s.effects).toEqual([]);
    expect(s.breakpoints).toEqual([]); // the new stage's hidden fault is hidden again
    while (room.phase !== 'playing') sim.tick();
    const next = reactorOnly(() => getStageDef(STAGE + 1, room.stageRecord!.seed));
    solveStage(sim, 'p0', next); // the next stage is solvable too, from the spawn the sim reset to
    expect(room.phase).toBe('stage_complete');
    expect(ARENA.spawns.length).toBe(4);
  });
});
