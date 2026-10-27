import { describe, expect, it } from 'vitest';
import {
  EVIDENCE_BY_TYPE, EVIDENCE_KINDS, GHOST_LOOK_SCALE, GHOST_TABLE, GHOST_TYPES, GhostCueSchema, GhostFxSchema, GhostPublicSchema, HOWLER_LIMITS, LIT, MAX_GHOSTS, TICK_DT,
  evidenceOwner, ghostCountForStage, ghostLineupForStage, ghostLookTier, ghostTuning, ghostTypesForStage, inFlashlightCone, inLitRegion, ghostPickFor, ghostSeedFor,
  type Difficulty,
} from '../src';

const MODES: Difficulty[] = ['easy', 'intermediate', 'hardcore'];
const STAGES = [1, 2, 7, 12, 100, 1_000_000];
const sec = (ticks: number) => ticks * TICK_DT;

describe('P3E step 5 tuning table: gun cooldown, respawn, ghost count (stages 1, 2, 7, 12, 100, 1,000,000)', () => {
  it('easy: the gun waits 30 s at stage 2 and +1 s per stage, capped at 90 s', () => {
    expect(sec(ghostTuning('easy', 1).gunCooldownTicks)).toBeCloseTo(30, 6);
    expect(sec(ghostTuning('easy', 2).gunCooldownTicks)).toBeCloseTo(30, 6);
    expect(sec(ghostTuning('easy', 7).gunCooldownTicks)).toBeCloseTo(35, 6);
    expect(sec(ghostTuning('easy', 12).gunCooldownTicks)).toBeCloseTo(40, 6);
    expect(sec(ghostTuning('easy', 100).gunCooldownTicks)).toBeCloseTo(90, 6);
    expect(sec(ghostTuning('easy', 1_000_000).gunCooldownTicks)).toBeCloseTo(90, 6);
  });
  it('easy: the respawn is 150 s at stage 2, -2 s per stage, floor 45 s', () => {
    expect(sec(ghostTuning('easy', 1).respawnTicks)).toBeCloseTo(150, 6);
    expect(sec(ghostTuning('easy', 2).respawnTicks)).toBeCloseTo(150, 6);
    expect(sec(ghostTuning('easy', 7).respawnTicks)).toBeCloseTo(140, 6);
    expect(sec(ghostTuning('easy', 12).respawnTicks)).toBeCloseTo(130, 6);
    expect(sec(ghostTuning('easy', 100).respawnTicks)).toBeCloseTo(45, 6);
    expect(sec(ghostTuning('easy', 1_000_000).respawnTicks)).toBeCloseTo(45, 6);
  });
  it('one ghost until stage 20, two from stage 20, never more, none on stage 1', () => {
    expect(STAGES.map(ghostCountForStage)).toEqual([0, 1, 1, 1, 2, 2]);
    for (const s of [19, 20, 21, 45, 1e9]) expect(ghostCountForStage(s)).toBeLessThanOrEqual(GHOST_TABLE.maxGhosts);
    expect(ghostCountForStage(19)).toBe(1);
    expect(ghostCountForStage(20)).toBe(2);
    expect(ghostTuning('easy', 25).ghostCount).toBe(2);
  });
  it('the modes scale how fast the curves move: harder = shorter respawn and longer cooldown, same floor and cap', () => {
    for (const s of [7, 12, 30]) {
      const e = ghostTuning('easy', s), i = ghostTuning('intermediate', s), h = ghostTuning('hardcore', s);
      expect(i.respawnTicks).toBeLessThanOrEqual(e.respawnTicks);
      expect(h.respawnTicks).toBeLessThanOrEqual(i.respawnTicks);
      expect(i.gunCooldownTicks).toBeGreaterThanOrEqual(e.gunCooldownTicks);
      expect(h.gunCooldownTicks).toBeGreaterThanOrEqual(i.gunCooldownTicks);
    }
    for (const m of MODES) { expect(sec(ghostTuning(m, 1_000_000).respawnTicks)).toBeCloseTo(45, 6); expect(sec(ghostTuning(m, 1_000_000).gunCooldownTicks)).toBeCloseTo(90, 6); }
  });
  it('the cooldown never shrinks and the respawn never grows with the stage; stage 100 equals stage 1,000,000; bad input is safe', () => {
    for (const m of MODES) {
      let prev = ghostTuning(m, 2);
      for (let s = 3; s <= 120; s++) {
        const t = ghostTuning(m, s);
        expect(t.gunCooldownTicks).toBeGreaterThanOrEqual(prev.gunCooldownTicks);
        expect(t.respawnTicks).toBeLessThanOrEqual(prev.respawnTicks);
        prev = t;
      }
      expect(ghostTuning(m, 100)).toEqual(ghostTuning(m, 1_000_000));
      for (const s of [0, -3, NaN, Infinity]) for (const v of Object.values(ghostTuning(m, s))) expect(Number.isFinite(v)).toBe(true);
    }
  });
});

describe('the lineup: which ghosts run on a stage', () => {
  it('stage 2-6 a Wisp alone, 7 the Shade alone, 12 the Howler alone, and at most 2 types ever', () => {
    expect(ghostLineupForStage(1)).toEqual([]);
    for (const s of [2, 3, 6]) expect(ghostLineupForStage(s)).toEqual(['wisp']);
    expect(ghostLineupForStage(7)).toEqual(['shade']);
    expect(ghostLineupForStage(12)).toEqual(['howler']);
  });
  it('before stage 20 exactly one ghost runs (the seed picks the type from the pair), from stage 20 two different types', () => {
    for (let s = 2; s < 20; s++) for (const pick of [0, 1]) {
      const l = ghostLineupForStage(s, pick);
      expect(l).toHaveLength(1);
      expect(ghostTypesForStage(s, pick)).toContain(l[0]);
    }
    for (const s of [20, 21, 35, 100, 1_000_000]) for (const pick of [0, 1]) {
      const l = ghostLineupForStage(s, pick);
      expect(l).toHaveLength(2);
      expect(new Set(l).size).toBe(2);
      expect(l.length).toBeLessThanOrEqual(MAX_GHOSTS);
    }
  });
  it('the pick is a pure function of the seed', () => {
    expect(ghostSeedFor(123, 9)).toBe(ghostSeedFor(123, 9));
    expect([ghostPickFor(4), ghostPickFor(5)]).toEqual([0, 1]);
  });
});

describe('look tiers: a stage 25 ghost looks bigger than a stage 2 ghost', () => {
  it('four tiers by stage, growing', () => {
    expect([2, 9, 10, 19, 20, 34, 35, 1_000_000].map(ghostLookTier)).toEqual([0, 0, 1, 1, 2, 2, 3, 3]);
    expect(ghostLookTier(NaN)).toBe(0);
    for (let i = 1; i < GHOST_LOOK_SCALE.length; i++) expect(GHOST_LOOK_SCALE[i]!).toBeGreaterThan(GHOST_LOOK_SCALE[i - 1]!);
    expect(GHOST_LOOK_SCALE[ghostLookTier(25)]!).toBeGreaterThanOrEqual(GHOST_LOOK_SCALE[ghostLookTier(2)]! * 1.5);
  });
});

describe('the flashlight cone (the Shade freezes in it)', () => {
  const eye = { x: 0, y: 0 }, R = 460;
  it('inside the cone and reach: lit; outside the angle, past the reach or behind: not', () => {
    expect(inFlashlightCone(eye, 0, { x: 300, y: 0 }, R)).toBe(true);
    expect(inFlashlightCone(eye, 0, { x: 300, y: 300 * Math.tan(LIT.coneHalf * 0.9) }, R)).toBe(true);
    expect(inFlashlightCone(eye, 0, { x: 300, y: 300 * Math.tan(LIT.coneHalf * 1.3) }, R)).toBe(false);
    expect(inFlashlightCone(eye, 0, { x: R, y: 0 }, R)).toBe(false);
    expect(inFlashlightCone(eye, 0, { x: -300, y: 0 }, R)).toBe(false);
  });
  it('is the cone only: the small always-on light (which `inLitRegion` also grants) does not freeze it', () => {
    const near = { x: -60, y: 0 };
    expect(inLitRegion(eye, 0, near, R)).toBe(true);
    expect(inFlashlightCone(eye, 0, near, R)).toBe(false);
  });
});

describe('evidence kinds', () => {
  it('every type has its own kinds, no overlap, and the owner is found from the kind', () => {
    const all = GHOST_TYPES.flatMap((t) => EVIDENCE_BY_TYPE[t]);
    expect(new Set(all).size).toBe(all.length);
    expect([...all].sort()).toEqual([...EVIDENCE_KINDS].sort());
    for (const t of GHOST_TYPES) for (const k of EVIDENCE_BY_TYPE[t]) expect(evidenceOwner(k)).toBe(t);
    expect(evidenceOwner('nope')).toBeNull();
  });
});

describe('contract additions are optional and bounded', () => {
  it('GhostPublic.lit, cue.warnKinds / gun / lightsOut and the fx message', () => {
    const g = { id: 'g0', kind: 'shade', x: 1, y: 2, angle: 0, state: 'roaming', room: 'r0' };
    expect(GhostPublicSchema.safeParse(g).success).toBe(true);
    expect(GhostPublicSchema.safeParse({ ...g, lit: true }).success).toBe(true);
    const cue = { tick: 1, warning: true, sounds: [] };
    expect(GhostCueSchema.safeParse(cue).success).toBe(true);
    expect(GhostCueSchema.safeParse({ ...cue, warnKinds: ['wisp', 'howler'], gun: { left: 100, total: 600 }, lightsOut: 80 }).success).toBe(true);
    expect(GhostCueSchema.safeParse({ ...cue, warnKinds: ['wisp', 'wisp', 'wisp'] }).success).toBe(false);
    expect(GhostCueSchema.safeParse({ ...cue, gun: { left: -1, total: 600 } }).success).toBe(false);
    const fx = { kind: 'dissolve', ghost: 'wisp', x: 1, y: 2, room: 'r0', tick: 5 };
    expect(GhostFxSchema.safeParse(fx).success).toBe(true);
    expect(GhostFxSchema.safeParse({ ...fx, kind: 'boom' }).success).toBe(false);
    expect(HOWLER_LIMITS.windupTicks * TICK_DT).toBeGreaterThanOrEqual(0.5);
  });
});
