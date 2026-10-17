import { describe, expect, it } from 'vitest';
import { ARENA } from '@wb/shared';
import { validateStageDef } from '../../src/systems/validate';
import { DISASTER_LIMITS } from '../../src/disasters/validate';
import { generateDisasterStage } from '../../src/disasters/registry';
import { BREAKPOINT_SPOTS, REACTOR_OVERLOAD, ReactorOverloadParamsSchema } from '../../src/disasters/reactorOverload';

const json = (stage: number, seed: number) => JSON.stringify(generateDisasterStage(stage, seed));

describe('reactor overload generator: determinism', () => {
  it('same seed + same stage => identical StageDef (twice, and across fresh calls)', () => {
    for (const [stage, seed] of [[2, 1], [7, 123456789], [1_000_000, 4294967295]] as const) {
      expect(generateDisasterStage(stage, seed)).toEqual(generateDisasterStage(stage, seed));
      expect(json(stage, seed)).toBe(json(stage, seed));
    }
  });

  it('different seeds produce different stages', () => {
    const seen = new Set<string>();
    for (let seed = 1; seed <= 30; seed++) seen.add(json(6, seed));
    expect(seen.size).toBeGreaterThanOrEqual(25);
    expect(json(6, 1)).not.toBe(json(6, 2));
  });

  it('different stages with the same seed differ (at least by id)', () => {
    expect(generateDisasterStage(3, 9).id).not.toBe(generateDisasterStage(4, 9).id);
  });

  it('every layout variant (mirror x breakpoint spot) is reachable from some seed', () => {
    const variants = new Set<string>();
    for (let seed = 1; seed <= 200; seed++) {
      const p = generateDisasterStage(2, seed).disaster!.params;
      variants.add(`${p.mirror ? 'm' : 'n'}${p.breakpointSpot}`);
    }
    expect(variants.size).toBe(2 * BREAKPOINT_SPOTS.length);
  });

  it('records id, version, seed and validated params in the server-side stage record', () => {
    const def = generateDisasterStage(9, 31337);
    expect(def.disaster).toMatchObject({ id: 'reactor_overload', version: 1, seed: 31337 });
    expect(ReactorOverloadParamsSchema.parse(def.disaster!.params)).toEqual(def.disaster!.params);
    expect(REACTOR_OVERLOAD.paramsFor(9, 31337)).toEqual(def.disaster!.params);
  });
});

describe('reactor overload generator: validity and bounds', () => {
  const STAGES = [2, 3, 4, 7, 8, 15, 16, 31, 100, 12_345, 1_000_000, 2 ** 40, Number.MAX_SAFE_INTEGER];
  it.each(STAGES)('stage %i: every seed yields a def that passes validateStageDef', (stage) => {
    for (let seed = 0; seed < 25; seed++) {
      const def = generateDisasterStage(stage, seed);
      expect(validateStageDef(def, ARENA), `stage ${stage} seed ${seed}`).toEqual([]);
      expect(def.id.length).toBeLessThanOrEqual(40);
    }
  });

  it('difficulty is bounded: past tier 5 the parameters stop growing with the stage number', () => {
    for (const seed of [1, 2, 3]) {
      expect(REACTOR_OVERLOAD.paramsFor(16, seed)).toEqual(REACTOR_OVERLOAD.paramsFor(1_000_000_000, seed));
    }
    expect((REACTOR_OVERLOAD.paramsFor(2, 1) as { tier: number }).tier).toBe(2);
    expect((REACTOR_OVERLOAD.paramsFor(4, 1) as { tier: number }).tier).toBe(3);
    expect((REACTOR_OVERLOAD.paramsFor(16, 1) as { tier: number }).tier).toBe(5);
  });

  it('later tiers are harder in bounded ways (more heat, faster arcs), never unbounded', () => {
    const lo = generateDisasterStage(2, 5).disaster!, hi = generateDisasterStage(1_000_000, 5).disaster!;
    expect(hi.heat.perSecond).toBeGreaterThan(lo.heat.perSecond);
    expect(hi.heat.perSecond).toBeLessThanOrEqual(DISASTER_LIMITS.maxHeatPerSecond);
    expect(hi.heat.cap).toBeLessThanOrEqual(DISASTER_LIMITS.maxHeatCap);
    expect(hi.failPenalty).toBeLessThanOrEqual(DISASTER_LIMITS.maxFailPenalty);
    expect(hi.schedule.escalateAtTick).toBeGreaterThanOrEqual(DISASTER_LIMITS.minEscalateAtTick);
  });

  it('gives the team time: warning first, then escalation, then failure, with the fairness gaps', () => {
    for (let seed = 0; seed < 60; seed++) {
      const s = generateDisasterStage(2 + (seed % 20), seed).disaster!.schedule;
      expect(s.activateAtTick).toBeLessThan(s.escalateAtTick);
      expect(s.escalateAtTick - s.activateAtTick).toBeGreaterThan(1000);
      expect(s.failAtTick - s.escalateAtTick).toBeGreaterThanOrEqual(DISASTER_LIMITS.minEscalationToFailTicks);
    }
  });

  it('every hazard has a readable warning, a valid countermeasure and a repair path', () => {
    const def = generateDisasterStage(3, 8);
    expect(def.hazards.length).toBeGreaterThan(0);
    for (const h of def.hazards) {
      const t = def.disaster!.threats.filter((x) => x.hazardId === h.id);
      expect(t).toHaveLength(1);
      expect(t[0]!.warning.trim().length).toBeGreaterThan(10);
      expect(t[0]!.repair.trim().length).toBeGreaterThan(10);
      expect(def.loadout).toContain(t[0]!.countermeasure);
    }
    expect(def.disaster!.threats[0]!.countermeasure).toBe('shield_projector');
  });

  it('public text never names the hidden breakpoint or its failure', () => {
    for (let seed = 0; seed < 20; seed++) {
      const d = generateDisasterStage(2, seed).disaster!;
      const text = JSON.stringify([d.name, d.messages, d.threats]).toLowerCase();
      for (const secret of ['bp_valve', 'f_valve', 'seized coolant valve']) expect(text).not.toContain(secret);
    }
  });

  it('places the hidden breakpoint on a platform, mirrored consistently with the console', () => {
    for (let seed = 1; seed <= 40; seed++) {
      const def = generateDisasterStage(2, seed);
      const mirror = def.disaster!.params.mirror === true;
      const core = def.entities.find((e) => e.id === 'core')!;
      expect(core.x).toBe(mirror ? 810 : 470);
      expect(def.hazards[0]!.x).toBe(core.x);
      const bp = def.breakpoints[0]!;
      expect(ARENA.solids.some((s) => s.y === bp.y && bp.x >= s.x && bp.x <= s.x + s.w)).toBe(true);
    }
  });
});
