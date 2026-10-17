import { describe, expect, it } from 'vitest';
import { ARENA, DISASTER_IDS } from '@wb/shared';
import { StageDefSchema } from '../../src/systems/stageDef';
import { validateStageDef } from '../../src/systems/validate';
import { DISASTER_LIMITS } from '../../src/disasters/validate';
import { generateStageDef } from '../../src/disasters/generate';
import { getDisaster, listCandidateDisasters, listDisasters, withDisasterPool } from '../../src/disasters/registry';
import { CANDIDATE_IDS, candidate } from '../helpers/candidates';

const STAGES = [2, 3, 4, 7, 16, 33, 1_000, 1_000_000];

describe('the five disasters are all supported (selectable)', () => {
  it('every disaster id is selectable and none is left as a candidate', () => {
    expect(listDisasters().map((d) => d.id).sort()).toEqual([...DISASTER_IDS].sort());
    expect(listCandidateDisasters()).toEqual([]);
    for (const id of DISASTER_IDS) expect(getDisaster(id)?.id).toBe(id);
  });

  it('the game picks every one of them, deterministically per (stage, seed)', () => {
    const seen = new Set<string>();
    for (let seed = 1; seed <= 120; seed++) {
      const a = generateStageDef(2 + (seed % 9), seed), b = generateStageDef(2 + (seed % 9), seed);
      expect(a).toEqual(b);
      seen.add(a.disaster!.id);
    }
    expect([...seen].sort()).toEqual([...DISASTER_IDS].sort());
  });

  it('the test seam narrows the pool and always restores it, even when the callback throws', () => {
    withDisasterPool(['temporal_storm'], () => {
      expect(listDisasters().map((d) => d.id)).toEqual(['temporal_storm']);
      for (let seed = 1; seed <= 10; seed++) expect(generateStageDef(3, seed).disaster?.id).toBe('temporal_storm');
    });
    expect(() => withDisasterPool(['reality_fracture'], () => { throw new Error('boom'); })).toThrow('boom');
    expect(listDisasters().map((d) => d.id).sort()).toEqual([...DISASTER_IDS].sort());
  });
});

for (const id of CANDIDATE_IDS) {
  describe(`${id}: generator`, () => {
    const d = candidate(id);

    it('carries stable id/version and compatibility metadata, with no maximum stage', () => {
      expect(d.id).toBe(id);
      expect(d.version).toBe(1);
      expect(d.systems.length).toBeGreaterThan(0);
      expect(d.compat.minStage).toBe(2);
      expect(d.compat.maxPlayers).toBe(4);
      expect(d.compat.combinableWith).toEqual([]); // combinations are P3B
      expect('maxStage' in d.compat).toBe(false); // endless
    });

    it('is deterministic: same (stage, seed) => identical StageDef; the params are recorded on it', () => {
      for (const stage of STAGES) for (const seed of [1, 7, 4242]) {
        const a = d.generateStage(stage, seed), b = d.generateStage(stage, seed);
        expect(a).toEqual(b);
        expect(JSON.stringify(a)).toBe(JSON.stringify(b));
        expect(a.disaster!.params).toEqual(d.paramsFor(stage, seed));
        expect(a.disaster!.seed).toBe(seed);
      }
    });

    it('produces a fully parsed StageDef with this disaster id and a per-stage id', () => {
      for (const stage of STAGES) {
        const def = d.generateStage(stage, 99);
        expect(StageDefSchema.parse(def)).toEqual(def);
        expect(def.id).toBe(`${id}_${stage}`);
        expect(def.disaster!.id).toBe(id);
        expect(def.disaster!.version).toBe(d.version);
      }
    });

    it('every generated stage passes validateStageDef (stages x seeds)', () => {
      const bad: string[] = [];
      for (const stage of STAGES) for (let seed = 1; seed <= 25; seed++) {
        const errs = validateStageDef(d.generateStage(stage, seed), ARENA);
        if (errs.length) bad.push(`stage ${stage} seed ${seed}: ${errs.join('; ')}`);
      }
      expect(bad).toEqual([]);
    });

    it('different seeds give different stages', () => {
      const seen = new Set<string>();
      for (let seed = 1; seed <= 30; seed++) seen.add(JSON.stringify(d.generateStage(5, seed)));
      expect(seen.size).toBeGreaterThanOrEqual(20);
    });

    it('scaling is bounded: the tier is capped and every limit holds at absurd stage numbers', () => {
      const lo = d.generateStage(2, 5).disaster!, hi = d.generateStage(1_000_000, 5).disaster!;
      const huge = d.generateStage(Number.MAX_SAFE_INTEGER, 5).disaster!;
      expect(lo.params.tier).toBe(2);
      expect(hi.params.tier).toBe(5);
      expect(huge.params.tier).toBe(5);
      for (const m of [lo, hi, huge]) {
        expect(m.schedule.escalateAtTick).toBeGreaterThanOrEqual(DISASTER_LIMITS.minEscalateAtTick);
        expect(m.schedule.failAtTick - m.schedule.escalateAtTick).toBeGreaterThanOrEqual(DISASTER_LIMITS.minEscalationToFailTicks);
        expect(m.heat.perSecond).toBeLessThanOrEqual(DISASTER_LIMITS.maxHeatPerSecond);
        expect(m.heat.cap).toBeLessThanOrEqual(DISASTER_LIMITS.maxHeatCap);
        expect(m.failPenalty).toBeLessThanOrEqual(DISASTER_LIMITS.maxFailPenalty);
      }
    });

    it('every hazard has exactly one threat with a valid countermeasure, and the public text never names a hidden breakpoint', () => {
      for (const stage of [2, 9, 40]) {
        const def = d.generateStage(stage, 3);
        expect(def.disaster!.threats.map((t) => t.hazardId).sort()).toEqual(def.hazards.map((h) => h.id).sort());
        const text = [def.name, ...Object.values(def.disaster!.messages), ...def.disaster!.threats.flatMap((t) => [t.warning, t.repair])].join('\n').toLowerCase();
        for (const b of def.breakpoints) {
          expect(text).not.toContain(b.id.toLowerCase());
          expect(text).not.toContain(b.label.toLowerCase());
        }
      }
    });

    it('requiredTools are all in the stage loadout', () => {
      const def = d.generateStage(2, 1);
      for (const t of d.requiredTools) expect(def.loadout).toContain(t);
    });
  });
}

describe('validator additions for the step-3 disasters', () => {
  it('rejects a scan gate that deadlocks (breakpoint needs its own repair to be scannable)', () => {
    const def = structuredClone(candidate('reality_fracture').generateStage(2, 1));
    expect(validateStageDef(def, ARENA)).toEqual([]);
    def.objectives.find((o) => o.id === 'o_sync')!.prerequisites = ['o_root']; // the anchors would wait for the repair that waits for the anchors
    expect(validateStageDef(def, ARENA).some((e) => e.includes('deadlock'))).toBe(true);
  });

  it('rejects more repairs than the welder holds when there is no supply cache', () => {
    const def = structuredClone(candidate('cascading_power_failure').generateStage(33, 5)); // tier 5: four relays
    expect(def.breakpoints).toHaveLength(4);
    expect(validateStageDef(def, ARENA)).toEqual([]);
    def.entities = def.entities.filter((e) => e.kind !== 'supply_cache');
    expect(validateStageDef(def, ARENA).some((e) => e.includes('supply cache'))).toBe(true);
    const small = structuredClone(candidate('cascading_power_failure').generateStage(2, 5)); // two relays: no cache needed
    small.entities = small.entities.filter((e) => e.kind !== 'supply_cache');
    expect(validateStageDef(small, ARENA).some((e) => e.includes('supply cache'))).toBe(false);
  });
});

describe('cascading power failure: the chain', () => {
  const d = candidate('cascading_power_failure');
  it('grows with the tier, is capped at four relays, and each relay is scannable only after the previous one is mended', () => {
    const lengths = [2, 4, 16, 1_000_000].map((stage) => d.generateStage(stage, 3).breakpoints.length);
    expect(lengths).toEqual([2, 3, 4, 4]);
    const def = d.generateStage(16, 3);
    def.breakpoints.forEach((b, i) => expect(b.scanRequires).toEqual(i === 0 ? [] : [`o_root_${i}`]));
    expect(new Set(def.breakpoints.map((x) => `${x.x},${x.y}`)).size).toBe(def.breakpoints.length); // every relay has its own spot
  });
});
