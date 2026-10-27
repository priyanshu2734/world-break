import { describe, expect, it } from 'vitest';
import { GHOST_TYPES, TICK_DT, type GhostCue, type GhostFx, type GhostType } from '@wb/shared';
import { CROWN_SPIKES, ghostShape, mixColor } from '../src/ui/ghost/ghostLook';
import { SoundScheduler } from '../src/ui/ghost/soundScheduler';
import { cueIndicator } from '../src/ui/ghost/cueMath';
import { brokenLightScale, lightsOutActive } from '../src/ui/ghost/flicker';
import { DISSOLVE_MS, RETURN_WINDOW_MS, SCREAM_FX_MS, cooldownFraction, cooldownLeftMs, fxProgress, gunPrompt, liveFx, returnLine } from '../src/ui/ghost/gunLogic';

const area = (pts: { x: number; y: number }[]) => {
  const xs = pts.map((p) => p.x), ys = pts.map((p) => p.y);
  return (Math.max(...xs) - Math.min(...xs)) * (Math.max(...ys) - Math.min(...ys));
};
const cue = (o: Partial<GhostCue> = {}): GhostCue => ({ tick: 1, warning: false, sounds: [], ...o });

describe('look tiers: the stage changes how a ghost looks', () => {
  it('a stage 25 ghost is clearly bigger and more menacing than a stage 2 ghost, for every type', () => {
    for (const kind of GHOST_TYPES) {
      const small = ghostShape(kind, 2, 'roaming', 0), big = ghostShape(kind, 25, 'roaming', 0);
      expect(big.scale).toBeGreaterThanOrEqual(small.scale * 1.5);
      expect(big.scale * Math.sqrt(area(big.body))).toBeGreaterThan(1.5 * Math.sqrt(area(small.body)));
      expect(big.extras.length).toBeGreaterThan(small.extras.length - (kind === 'howler' ? 0 : 0));
      expect(big.eyes[0]!.r).toBeGreaterThan(small.eyes[0]!.r);
      expect(big.tier).toBe(2);
      expect(small.tier).toBe(0);
    }
  });
  it('the tiers only ever grow with the stage', () => {
    for (const kind of GHOST_TYPES) {
      let prev = 0;
      for (const s of [2, 9, 10, 19, 20, 34, 35, 100]) { const sc = ghostShape(kind, s, 'roaming', 0).scale; expect(sc).toBeGreaterThanOrEqual(prev); prev = sc; }
    }
    expect(CROWN_SPIKES).toEqual([0, 0, 3, 5]);
  });
  it('each type has its own silhouette, colour and eyes', () => {
    const shapes = (['wisp', 'shade', 'howler'] as GhostType[]).map((k) => ghostShape(k, 7, 'roaming', 0));
    expect(new Set(shapes.map((s) => s.tint)).size).toBe(3);
    expect(new Set(shapes.map((s) => s.body.length)).size).toBeGreaterThanOrEqual(2);
    const shade = shapes[1]!, howler = shapes[2]!, wisp = shapes[0]!;
    expect(area(shade.body)).toBeGreaterThan(area(wisp.body)); // the Shade is a tall figure
    expect(shade.rim).not.toBeNull(); // dark: it needs a rim to be seen
    expect(howler.extras.length).toBeGreaterThanOrEqual(2); // long arms
    expect(howler.eyeColor).toBe(0xff3b30);
  });
  it('a Shade in the light is frozen and shown differently; a stunned ghost does not bob', () => {
    const free = ghostShape('shade', 7, 'roaming', 0, false), lit = ghostShape('shade', 7, 'roaming', 0, true);
    expect(free.still).toBe(false);
    expect(lit.still).toBe(true);
    expect(lit.eyeColor).not.toBe(free.eyeColor);
    expect(ghostShape('wisp', 2, 'stunned', 0).still).toBe(true);
  });
  it('colours mix without leaving range', () => {
    expect(mixColor(0x000000, 0xffffff, 0.5)).toBe(0x808080);
    expect(mixColor(0x123456, 0xabcdef, 0)).toBe(0x123456);
    expect(mixColor(0x123456, 0xabcdef, 5)).toBe(0xabcdef);
  });
});

describe('gun cooldown, dissolve and return line', () => {
  it('counts the recharge down from the moment the cue arrived', () => {
    const gun = { left: 600, total: 600 };
    expect(cooldownLeftMs(gun, 1000, 1000)).toBe(600 * TICK_DT * 1000);
    expect(cooldownLeftMs(gun, 1000, 1000 + 10_000)).toBe(20_000);
    expect(cooldownLeftMs(gun, 1000, 1000 + 99_000)).toBe(0);
    expect(cooldownLeftMs({ left: 0 }, 0, 5)).toBe(0);
    expect(cooldownLeftMs(undefined, 0, 5)).toBe(0);
  });
  it('the indicator drains from full (just fired) to empty (ready)', () => {
    const gun = { total: 600 };
    expect(cooldownFraction(gun, 30_000)).toBe(1);
    expect(cooldownFraction(gun, 15_000)).toBeCloseTo(0.5, 6);
    expect(cooldownFraction(gun, 0)).toBe(0);
    expect(cooldownFraction(undefined, 5000)).toBe(0);
  });
  it('the prompt says READY or the seconds left, and stays silent for a hidden or caught player', () => {
    const free = { hiddenIn: null, caught: null };
    expect(gunPrompt(true, free, 0)).toMatch(/READY/);
    expect(gunPrompt(true, free, 12_300)).toBe('PULSE GUN: recharging 13 s');
    expect(gunPrompt(true, { hiddenIn: 'h', caught: null }, 0)).toBeNull();
    expect(gunPrompt(false, free, 0)).toBeNull();
  });
  it('effects fade out; a dissolve lasts longer than a scream ring', () => {
    const fx = (kind: GhostFx['kind']) => ({ at: 0, fx: { kind } });
    expect(liveFx([fx('dissolve'), fx('scream')], SCREAM_FX_MS - 1)).toHaveLength(2);
    expect(liveFx([fx('dissolve'), fx('scream')], SCREAM_FX_MS + 1).map((f) => f.fx.kind)).toEqual(['dissolve']);
    expect(liveFx([fx('dissolve'), fx('scream')], DISSOLVE_MS + 1)).toHaveLength(0);
    expect(fxProgress(0, 1000)).toBe(0);
    expect(fxProgress(500, 1000)).toBe(0.5);
    expect(fxProgress(5000, 1000)).toBe(1);
  });
  it('the respawn warning is spelled out only after a dissolve, while the warning is on, and not forever', () => {
    expect(returnLine(true, 5000)).toMatch(/COMING BACK/);
    expect(returnLine(false, 5000)).toBeNull();
    expect(returnLine(true, null)).toBeNull();
    expect(returnLine(true, RETURN_WINDOW_MS + 1)).toBeNull();
  });
});

describe('each type has its own warning, sound and counter text', () => {
  it('the visual cue names the warning in its own words', () => {
    const texts = (['wisp', 'shade', 'howler'] as GhostType[]).map((k) => cueIndicator(cue({ warning: true, warnKinds: [k] })));
    expect(new Set(texts).size).toBe(3);
    expect(cueIndicator(cue({ warning: true }))).toBe('Something is coming...');
    expect(cueIndicator(cue({ sounds: [{ id: 'g0', kind: 'howler', band: 2, dir: 0, state: 'hunting', moving: false, screaming: true }] }))).toMatch(/crouch/i);
  });
  it('the warning whisper carries the type, and a scream sounds once per wind-up', () => {
    const s = new SoundScheduler();
    expect(s.tick(cue({ warning: true, warnKinds: ['shade'] }), 0, 10)).toEqual([{ kind: 'whisper', type: 'shade' }]);
    const t = new SoundScheduler();
    expect(t.tick(cue({ warning: true }), 0, 10)).toEqual([{ kind: 'whisper' }]);
    const sc = new SoundScheduler();
    const screaming = cue({ sounds: [{ id: 'g0', kind: 'howler', band: 1, dir: -1, state: 'hunting', moving: false, screaming: true }] });
    const a = sc.tick(screaming, 0, 10).filter((e) => e.kind === 'scream');
    const b = sc.tick(screaming, 0, 60).filter((e) => e.kind === 'scream');
    expect(a).toHaveLength(1);
    expect(b).toHaveLength(0);
    sc.tick(cue({ sounds: [{ ...screaming.sounds[0]!, screaming: false }] }), 0, 100);
    expect(sc.tick(screaming, 0, 150).filter((e) => e.kind === 'scream')).toHaveLength(1); // the next wind-up screams again
  });
});

describe('a Howler broke the lights', () => {
  it('half light with an unsteady wobble, steady when reduced, and 1 when the lights are fine', () => {
    expect(brokenLightScale(false, 123, false)).toBe(1);
    expect(brokenLightScale(true, 0, true)).toBe(0.55);
    for (let ms = 0; ms < 5000; ms += 37) { const v = brokenLightScale(true, ms, false); expect(v).toBeGreaterThan(0.35); expect(v).toBeLessThan(0.7); }
  });
  it('the darkness counts down from the cue arrival', () => {
    expect(lightsOutActive(200, 1000, 1000 + 9_000)).toBe(true); // 200 ticks = 10 s
    expect(lightsOutActive(200, 1000, 1000 + 10_500)).toBe(false);
    expect(lightsOutActive(0, 0, 1)).toBe(false);
    expect(lightsOutActive(undefined, 0, 1)).toBe(false);
  });
});
