import { describe, expect, it } from 'vitest';
import { ARENA, ARENA_ID, DISASTER_IDS, TOOL_IDS } from '@wb/shared';
import { StageDefSchema } from '../../src/systems/stageDef';
import { validateStageDef } from '../../src/systems/validate';
import { generateStageDef } from '../../src/disasters/generate';
import { disastersForStage, generateDisasterStage, getDisaster, listCandidateDisasters, listDisasters } from '../../src/disasters/registry';
import { REACTOR_OVERLOAD } from '../../src/disasters/reactorOverload';

describe('disaster registry', () => {
  it('registers all five disasters as supported (tests confirmed on the maintainer machine), none left as a candidate', () => {
    expect(listDisasters().map((d) => d.id).sort()).toEqual([...DISASTER_IDS].sort());
    expect(getDisaster('reactor_overload')).toBe(REACTOR_OVERLOAD);
    for (const id of DISASTER_IDS) expect(getDisaster(id)?.id).toBe(id);
    expect(listCandidateDisasters()).toEqual([]);
  });

  it('carries stable id/version and compatibility metadata, with no maximum stage', () => {
    const d = REACTOR_OVERLOAD;
    expect(d.id).toBe('reactor_overload');
    expect(d.version).toBe(1);
    expect(d.systems).toEqual(['reactor', 'power_grid']);
    for (const t of d.requiredTools) expect(TOOL_IDS).toContain(t);
    expect(d.compat).toEqual({ minStage: 2, minPlayers: 1, maxPlayers: 4, arenaIds: [ARENA_ID], combinableWith: [], conflictsWith: [] });
    expect('maxStage' in d.compat).toBe(false); // endless
  });

  it('offers disasters from stage 2 on, for every stage number', () => {
    expect(disastersForStage(1)).toEqual([]);
    for (const n of [2, 3, 10, 1_000_000, Number.MAX_SAFE_INTEGER]) expect(disastersForStage(n).map((d) => d.id).sort()).toEqual([...DISASTER_IDS].sort());
  });

  it('refuses to generate stage 1 (hand-authored) and invalid stage numbers', () => {
    for (const bad of [1, 0, -5, 2.5, Number.NaN, Number.POSITIVE_INFINITY, 2 ** 60]) expect(() => generateDisasterStage(bad, 1)).toThrow();
  });

  it('generateStageDef returns the disaster stage for N >= 2 and never throws for a valid stage', () => {
    for (const n of [2, 3, 50, 999_999, 1_000_000]) {
      const def = generateStageDef(n, 77);
      expect(DISASTER_IDS).toContain(def.disaster?.id);
      expect(def.id).toBe(`${def.disaster?.id}_${n}`);
    }
  });

  it('the pick is deterministic per (stage, seed) and every disaster is picked by some seed', () => {
    const seen = new Set<string>();
    for (let seed = 1; seed <= 200; seed++) {
      const a = generateDisasterStage(2, seed), b = generateDisasterStage(2, seed);
      expect(a).toEqual(b);
      seen.add(a.disaster!.id);
    }
    expect([...seen].sort()).toEqual([...DISASTER_IDS].sort());
  });

  it('the generated StageDef is a fully parsed StageDef that passes validateStageDef', () => {
    const def = generateDisasterStage(5, 4242);
    expect(StageDefSchema.parse(def)).toEqual(def);
    expect(validateStageDef(def, ARENA)).toEqual([]);
  });
});
