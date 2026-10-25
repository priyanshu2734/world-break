import { describe, expect, it } from 'vitest';
import {
  AIM_STEPS, GAIT_LIMITS, GHOST_LIMITS, GHOST_STATES, GHOST_TABLE, GHOST_TRANSITIONS, GameInputSchema, GameSnapshotSchema, GhostPublicSchema, MAX_GHOSTS, MOVE_SPEED, NOISE_LOUDNESS,
  TICK_DT, aimAngle, angleDiff, gaitOf, ghostPresentOnStage, ghostProgress, ghostTuning, ghostTypesForStage, inLitRegion, quantiseAim,
  type Difficulty,
} from '../src';

const MODES: Difficulty[] = ['easy', 'intermediate', 'hardcore'];
const STAGES = [1, 2, 7, 12, 100, 1_000_000];

describe('P3E ghost tuning table (one table, with caps)', () => {
  it('stages 1 and 2 sit on the starting values in every mode', () => {
    for (const m of MODES) for (const s of [1, 2]) {
      const t = ghostTuning(m, s);
      expect(t.speedFrac).toBeCloseTo(0.7, 10);
      expect(t.intervalTicks).toBe(120 / TICK_DT);
      expect(t.stunTicks).toBe(150 / TICK_DT);
      expect(t.hearingPx).toBe(GHOST_TABLE.hearingStartPx);
      expect(t.hidingSpotsPerRoom).toBe(4);
    }
  });

  it('speed: 70 percent plus 0.5 percent per stage, never above 95 percent of the sprint', () => {
    expect(ghostTuning('easy', 7).speedFrac).toBeCloseTo(0.7 + 0.005 * 5, 10);
    expect(ghostTuning('easy', 12).speedFrac).toBeCloseTo(0.7 + 0.005 * 10, 10);
    for (const m of MODES) for (const s of STAGES) {
      const t = ghostTuning(m, s);
      expect(t.speedFrac).toBeLessThanOrEqual(0.95);
      expect(t.speedPxPerTick).toBeLessThanOrEqual(0.95 * MOVE_SPEED * TICK_DT + 1e-9);
    }
    expect(ghostTuning('easy', 100).speedFrac).toBe(0.95);
    expect(ghostTuning('hardcore', 1_000_000).speedFrac).toBe(0.95);
  });

  it('interval falls to a floor of 40 s, stun to a floor of 45 s, hearing grows to a cap, hiding spots fall to 1', () => {
    for (const m of MODES) {
      let prev = ghostTuning(m, 2);
      for (const s of [3, 7, 12, 30, 100, 1_000_000]) {
        const t = ghostTuning(m, s);
        expect(t.intervalTicks).toBeLessThanOrEqual(prev.intervalTicks);
        expect(t.stunTicks).toBeLessThanOrEqual(prev.stunTicks);
        expect(t.hearingPx).toBeGreaterThanOrEqual(prev.hearingPx);
        expect(t.hidingSpotsPerRoom).toBeLessThanOrEqual(prev.hidingSpotsPerRoom);
        prev = t;
      }
      const end = ghostTuning(m, 1_000_000);
      expect(end.intervalTicks).toBe(40 / TICK_DT);
      expect(end.stunTicks).toBe(45 / TICK_DT);
      expect(end.hearingPx).toBe(GHOST_TABLE.hearingCapPx);
      expect(end.hidingSpotsPerRoom).toBe(1);
    }
  });

  it('stage 100 and stage 1,000,000 are the same (every curve has stopped at its cap)', () => {
    for (const m of MODES) expect(ghostTuning(m, 100)).toEqual(ghostTuning(m, 1_000_000));
  });

  it('a harder mode moves the curves faster, never past the caps', () => {
    for (const s of [7, 12, 30]) {
      const e = ghostTuning('easy', s), i = ghostTuning('intermediate', s), h = ghostTuning('hardcore', s);
      expect(i.speedFrac).toBeGreaterThanOrEqual(e.speedFrac);
      expect(h.speedFrac).toBeGreaterThanOrEqual(i.speedFrac);
      expect(h.intervalTicks).toBeLessThanOrEqual(e.intervalTicks);
    }
    expect(ghostProgress('hardcore', 12)).toBeGreaterThan(ghostProgress('easy', 12));
  });

  it('every number is finite and sensible at the tested stages, and bad input does not break it', () => {
    for (const m of MODES) for (const s of [...STAGES, 0, -5, NaN, Infinity, 2.7]) {
      const t = ghostTuning(m, s);
      for (const v of Object.values(t)) expect(Number.isFinite(v)).toBe(true);
      expect(t.intervalTicks).toBeGreaterThanOrEqual(40 / TICK_DT);
      expect(t.hidingSpotsPerRoom).toBeGreaterThanOrEqual(1);
    }
  });

  it('there is no ghost on stage 1; it starts on stage 2', () => {
    expect(ghostPresentOnStage(1)).toBe(false);
    expect(ghostPresentOnStage(2)).toBe(true);
    expect(ghostPresentOnStage(1_000_000)).toBe(true);
    expect(ghostTypesForStage(1)).toEqual([]);
  });
});

describe('P3E ghost types by stage', () => {
  it('Wisp from stage 2, Shade ALONE at stage 7, Howler ALONE at stage 12; never more than 2 types', () => {
    expect(ghostTypesForStage(2)).toEqual(['wisp']);
    expect(ghostTypesForStage(6)).toEqual(['wisp']);
    expect(ghostTypesForStage(7)).toEqual(['shade']);
    expect(ghostTypesForStage(8)).toEqual(['wisp', 'shade']);
    expect(ghostTypesForStage(12)).toEqual(['howler']);
    for (const s of [2, 3, 7, 11, 12, 13, 45, 100, 1_000_000]) for (const pick of [0, 1]) {
      const t = ghostTypesForStage(s, pick);
      expect(t.length).toBeLessThanOrEqual(MAX_GHOSTS);
      expect(new Set(t).size).toBe(t.length);
    }
  });
});

describe('P3E state machine data', () => {
  it('every state has a transition list and the flow is DORMANT, WARNING, ROAMING, HUNTING, STUNNED, RESPAWN', () => {
    for (const s of GHOST_STATES) expect(GHOST_TRANSITIONS[s]).toBeDefined();
    expect(GHOST_TRANSITIONS.dormant).toEqual(['warning']);
    expect(GHOST_TRANSITIONS.warning).toEqual(['roaming']); // a ghost can never skip from warning to hunting, and cannot be stunned in it
    expect(GHOST_TRANSITIONS.respawn).toEqual(['warning']); // every later appearance is preceded by the warning too
    expect(GHOST_TRANSITIONS.stunned).toEqual(['respawn']);
  });
  it('the warning lasts at least 3 seconds', () => {
    expect(GHOST_LIMITS.minWarningTicks).toBe(3 / TICK_DT);
    expect(GHOST_LIMITS.warningTicks).toBeGreaterThanOrEqual(GHOST_LIMITS.minWarningTicks);
  });
});

describe('P3E aim and gait', () => {
  it('the aim angle is quantised to 0..255 and round-trips within one step', () => {
    for (const a of [0, 0.5, 1, Math.PI, -Math.PI / 2, 3 * Math.PI, -7, 100]) {
      const q = quantiseAim(a);
      expect(Number.isInteger(q) && q >= 0 && q < AIM_STEPS).toBe(true);
      expect(Math.abs(angleDiff(aimAngle(q), a))).toBeLessThanOrEqual(Math.PI / AIM_STEPS + 1e-9);
    }
    expect(quantiseAim(NaN)).toBe(0);
    expect(quantiseAim(Infinity)).toBe(0);
  });
  it('the input schema takes an optional aim and sneak, and refuses a bad aim; the old shape still parses', () => {
    expect(GameInputSchema.safeParse({ seq: 1, moveX: 0, jump: false }).success).toBe(true);
    expect(GameInputSchema.safeParse({ seq: 1, moveX: 0, jump: false, aim: 255, sneak: true }).success).toBe(true);
    for (const bad of [-1, 256, 1.5, NaN, '3']) expect(GameInputSchema.safeParse({ seq: 1, moveX: 0, jump: false, aim: bad }).success).toBe(false);
    expect(GameInputSchema.safeParse({ seq: 1, moveX: 0, jump: false, sneak: 'yes' }).success).toBe(false);
  });
  it('how loud a move is comes from the move axis: standing is silent, sneaking and walking are quiet, running is loud', () => {
    expect(gaitOf(0)).toBe('still');
    expect(gaitOf(GAIT_LIMITS.sneakMax)).toBe('sneak');
    expect(gaitOf(-0.5)).toBe('walk');
    expect(gaitOf(1)).toBe('run');
    expect(gaitOf(NaN)).toBe('still');
    expect(NOISE_LOUDNESS.run).toBeGreaterThan(NOISE_LOUDNESS.walk);
    expect(NOISE_LOUDNESS.walk).toBeGreaterThan(NOISE_LOUDNESS.sneak);
    expect(NOISE_LOUDNESS.still).toBe(0);
  });
  it('the lit region is the small light plus the cone', () => {
    const eye = { x: 500, y: 600 };
    expect(inLitRegion(eye, 0, { x: 560, y: 600 }, 460)).toBe(true);       // inside the small light, any direction
    expect(inLitRegion(eye, Math.PI, { x: 560, y: 600 }, 460)).toBe(true);
    expect(inLitRegion(eye, 0, { x: 800, y: 600 }, 460)).toBe(true);       // in the cone
    expect(inLitRegion(eye, Math.PI, { x: 800, y: 600 }, 460)).toBe(false); // behind the player
    expect(inLitRegion(eye, 0, { x: 800, y: 800 }, 460)).toBe(false);      // beside the cone
    expect(inLitRegion(eye, 0, { x: 1000, y: 600 }, 460)).toBe(false);     // beyond the reach
  });
});

describe('P3E protocol additions are additive', () => {
  const player = { id: 'a', name: 'A', slot: 0, x: 1, y: 2, vx: 0, vy: 0, facing: 1, grounded: true, connected: true, ack: 0 };
  const base = { tick: 1, simTimeMs: 50, epoch: 0, phase: 'playing', briefingMs: 0, stage: 2, arenaId: 'x', players: [player] };
  it('a snapshot without ghosts still parses; with at most two valid ghosts it parses', () => {
    expect(GameSnapshotSchema.safeParse(base).success).toBe(true);
    const g = { id: 'g0', kind: 'wisp', x: 1, y: 2, angle: 0.5, state: 'roaming', room: 'r' };
    expect(GhostPublicSchema.safeParse(g).success).toBe(true);
    expect(GameSnapshotSchema.safeParse({ ...base, ghosts: [g, { ...g, id: 'g1' }] }).success).toBe(true);
    expect(GameSnapshotSchema.safeParse({ ...base, ghosts: [g, g, g] }).success).toBe(false);
    expect(GhostPublicSchema.safeParse({ ...g, state: 'warning' }).success).toBe(false); // an absent ghost has no public state
  });
});

import { GHOST_CUE, GhostCueSchema, cueBand, cueDir } from '../src';

describe('P3E ghost cue buckets (the documented sound exception is coarse and bounded)', () => {
  it('distance buckets: 1 near, 2 middle, 3 far, 0 out of earshot', () => {
    const [a, b, c] = GHOST_CUE.bands;
    expect([0, a, a + 1, b, b + 1, c, c + 1, 5000, NaN, Infinity].map(cueBand)).toEqual([1, 1, 2, 2, 3, 3, 0, 0, 0, 0]);
  });
  it('direction: left, ahead inside the deadzone, right', () => {
    expect(cueDir(-200)).toBe(-1);
    expect(cueDir(200)).toBe(1);
    expect(cueDir(GHOST_CUE.deadzone)).toBe(0);
    expect(cueDir(-GHOST_CUE.deadzone)).toBe(0);
    expect(cueDir(NaN)).toBe(0);
  });
  it('a cue carries no position: only buckets, a direction, the type, the state and whether it moves; at most 2 sounds', () => {
    const sound = { id: 'g0', kind: 'wisp', band: 2, dir: -1, state: 'hunting', moving: true };
    expect(GhostCueSchema.safeParse({ tick: 3, warning: false, sounds: [sound] }).success).toBe(true);
    expect(GhostCueSchema.safeParse({ tick: 3, warning: true, sounds: [] }).success).toBe(true);
    expect(GhostCueSchema.safeParse({ tick: 3, warning: false, sounds: [sound, sound, sound] }).success).toBe(false);
    expect(GhostCueSchema.safeParse({ tick: 3, warning: false, sounds: [{ ...sound, band: 0 }] }).success).toBe(false);
    expect(GhostCueSchema.safeParse({ tick: 3, warning: false, sounds: [{ ...sound, state: 'warning' }] }).success).toBe(false);
    // an extra x or y is stripped by the schema (and the server never builds one)
    const parsed = GhostCueSchema.parse({ tick: 3, warning: false, sounds: [{ ...sound, x: 10, y: 20 }] });
    expect(JSON.stringify(parsed)).not.toContain('"x"');
  });
});
