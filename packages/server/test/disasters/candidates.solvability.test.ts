import { describe, expect, it, vi } from 'vitest';
import { ARENA } from '@wb/shared';
import { getStageDef } from '../../src/systems/registry';
import { withDisasterPool } from '../../src/disasters/registry';
import { solveStage } from '../helpers/planner';
import { CANDIDATE_IDS, start, variantSeeds } from '../helpers/candidates';

// Real-physics runs: a few hundred ticks each, but there are many of them.
vi.setConfig({ testTimeout: 60_000 });

const STAGE = 2;

for (const id of CANDIDATE_IDS) {
  const variants = variantSeeds(id, STAGE);

  describe(`${id}: layout coverage`, () => {
    it('the search found all 8 layout variants (mirror x first breakpoint spot)', () => {
      expect(variants.map(([k]) => k)).toHaveLength(8);
    });
  });

  describe(`${id} is solvable through the real simulation`, () => {
    for (const [variant, runSeed] of variants) {
      it.each([1, 2, 3, 4])(`${variant}: one player clears it with %i player(s) in the room`, (n) => {
        const { room, sim, def } = start(id, runSeed, n, STAGE);
        expect(def.disaster!.id).toBe(id);
        const t0 = sim.ticks;
        solveStage(sim, 'p0', def); // teammates stand idle: nothing mandatory depends on them
        const elapsed = sim.ticks - t0;

        expect(room.phase).toBe('stage_complete'); // real STAGE_CLEAR transition
        const s = sim.state();
        expect(s.status).toBe('stabilized');
        expect(s.objectives.every((o) => o.status === 'complete')).toBe(true);
        expect(s.symptoms.every((x) => x.state === 'resolved')).toBe(true);
        expect(s.score.total).toBeGreaterThan(500);
        // a pulse may land while the player walks up to the console, but never more than a couple of times
        expect(s.score.breakdown.hazard ?? 0).toBeGreaterThanOrEqual(-2 * def.scoring.hazardHitPenalty);
        expect(elapsed).toBeLessThan(def.disaster!.schedule.escalateAtTick); // an ordinary run beats the escalation
        expect(s.score.breakdown.disaster).toBeUndefined(); // so it costs no heat and no failure penalty
      });
    }
  });

  describe(`${id}: cleanup and the next stage`, () => {
    const [[, runSeed]] = variants as [[string, number], ...[string, number][]];

    it('after the stage is cleared the disaster is cleaned up and nothing keeps changing', () => {
      const { room, sim, def } = start(id, runSeed, 3, STAGE);
      solveStage(sim, 'p0', def);
      expect(room.phase).toBe('stage_complete');
      const s = sim.state();
      expect(s.disaster).toMatchObject({ id, phase: 'cleanup', escalatesAtTick: null, failsAtTick: null });
      expect(s.disaster!.message).toBe(def.disaster!.messages.cleanup);
      for (const h of s.hazards) {
        const base = def.hazards.find((x) => x.id === h.id)!;
        expect(h.armed).toBe(false);
        expect(h.nextPulseTick).toBeNull();
        expect(h.r).toBe(base.r);
      }
      expect(s.feed.map((f) => f.text)).toEqual(expect.arrayContaining([def.disaster!.messages.resolved, def.disaster!.messages.cleanup]));
      const before = JSON.stringify(room.peekStageState());
      for (let i = 0; i < 300; i++) sim.tick();
      expect(JSON.stringify(room.peekStageState())).toBe(before); // a finished stage is frozen
    });

    it('advancing starts a fresh disaster with nothing left over from the last one', () => {
      const { room, sim, def } = start(id, runSeed, 3, STAGE);
      solveStage(sim, 'p0', def);
      const oldRev = sim.state().rev;

      expect(withDisasterPool([id], () => room.nextStage('p0'))).toEqual({ ok: true });
      expect(room.stage).toBe(STAGE + 1);
      expect(room.stageRecord!.stage).toBe(STAGE + 1);
      expect(room.stageRecord!.fallback).toBe(false);
      expect(room.stageRecord!.defId).toBe(`${id}_${STAGE + 1}`);
      const s = room.peekStageState()!;
      expect(s.rev).toBeGreaterThan(oldRev);
      expect(s.status).toBe('running');
      expect(s.tick).toBe(0);
      expect(s.score.total).toBe(0);
      expect(s.score.breakdown).toEqual({});
      expect(s.disaster).toMatchObject({ phase: 'warning', id });
      expect(s.hazards.every((h) => !h.armed && h.nextPulseTick === null)).toBe(true);
      expect(s.effects).toEqual([]);
      expect(s.breakpoints).toEqual([]); // the new stage's hidden faults are hidden again
      while (room.phase !== 'playing') sim.tick();
      const next = withDisasterPool([id], () => getStageDef(STAGE + 1, room.stageRecord!.seed));
      solveStage(sim, 'p0', next); // the next stage is solvable too, from the spawn the sim reset to
      expect(room.phase).toBe('stage_complete');
      expect(ARENA.spawns.length).toBe(4);
    });

    it('the same run seed replays the same stage and the same state (end-to-end determinism)', () => {
      const a = start(id, runSeed, 2, STAGE), b = start(id, runSeed, 2, STAGE);
      expect(a.room.stageRecord).toEqual(b.room.stageRecord);
      expect(a.def).toEqual(b.def);
      for (let i = 0; i < 400; i++) { a.sim.tick(); b.sim.tick(); }
      expect(JSON.stringify(a.sim.state())).toBe(JSON.stringify(b.sim.state()));
    });
  });
}
