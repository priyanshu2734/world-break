import { describe, expect, it } from 'vitest';
import type { GhostCue, GhostCueSound } from '@wb/shared';
import { ghostFlags, ghostRequested } from '../src/ui/ghost/ghostParam';
import { CUE_STALE_MS, cueIndicator, footstepPeriodMs, heartbeatGain, heartbeatPeriodMs, nearest, panFor, soundGain } from '../src/ui/ghost/cueMath';
import { SoundScheduler, type SoundEvent } from '../src/ui/ghost/soundScheduler';
import { FLICKER_MIN, FLICKER_SLOT_MS, flickerLevel, lightScale } from '../src/ui/ghost/flicker';
import { ghostLook, smoothToward, wispOutline } from '../src/ui/ghost/ghostLook';

const snd = (o: Partial<GhostCueSound> = {}): GhostCueSound => ({ id: 'g0', kind: 'wisp', band: 2, dir: 1, state: 'roaming', moving: true, ...o });
const cue = (sounds: GhostCueSound[], warning = false): GhostCue => ({ tick: 1, warning, sounds });

describe('?ghost flag', () => {
  it('maps to a start stage of at least 2; absent or invalid is null', () => {
    expect(ghostRequested('?ghost=1')).toBe(2);
    expect(ghostRequested('?ghost=7')).toBe(7);
    expect(ghostRequested('?x=1&ghost=12')).toBe(12);
    expect(ghostRequested('?ghost=500')).toBe(99);
    for (const s of ['', '?ghost', '?ghost=0', '?ghost=-3', '?ghost=abc', '?ghost=1.5', '?ghosts=1', '?ghost=1e3']) expect(ghostRequested(s)).toBeNull();
  });
  it('reads the reduce-flash and mute flags only for 1', () => {
    expect(ghostFlags('?reduceflash=1&mute=1')).toEqual({ reduceFlash: true, muted: true });
    expect(ghostFlags('?reduceflash=yes')).toEqual({ reduceFlash: false, muted: false });
  });
});

describe('cue maths', () => {
  it('nearer is louder, the heartbeat is faster and louder, and a hunt is faster again', () => {
    expect(soundGain(1)).toBeGreaterThan(soundGain(2));
    expect(soundGain(2)).toBeGreaterThan(soundGain(3));
    expect(heartbeatPeriodMs(1, false)).toBeLessThan(heartbeatPeriodMs(2, false));
    expect(heartbeatPeriodMs(2, false)).toBeLessThan(heartbeatPeriodMs(3, false));
    expect(heartbeatGain(1, false)).toBeGreaterThan(heartbeatGain(3, false));
    expect(heartbeatPeriodMs(2, true)).toBeLessThan(heartbeatPeriodMs(2, false));
    expect(heartbeatGain(3, true)).toBeGreaterThan(heartbeatGain(3, false));
    expect(footstepPeriodMs('wisp', true)).toBeLessThan(footstepPeriodMs('wisp', false));
  });
  it('pan follows the direction and stays inside -1..1', () => {
    expect(panFor(-1)).toBeLessThan(0);
    expect(panFor(1)).toBeGreaterThan(0);
    expect(panFor(0)).toBe(0);
    for (const d of [-1, 0, 1] as const) expect(Math.abs(panFor(d))).toBeLessThanOrEqual(1);
  });
  it('the visual cue says where and how near, and says nothing when nothing is heard', () => {
    expect(cueIndicator(null)).toBe('');
    expect(cueIndicator(cue([]))).toBe('');
    expect(cueIndicator(cue([], true))).toMatch(/coming/);
    expect(cueIndicator(cue([snd({ band: 1, dir: -1 })]))).toMatch(/^◀ .*very close/);
    expect(cueIndicator(cue([snd({ band: 3, dir: 1 })]))).toMatch(/far.*▶$/);
    expect(cueIndicator(cue([snd({ state: 'hunting' })]))).toMatch(/HUNTING/);
  });
  it('nearest picks the lowest band', () => {
    expect(nearest([])).toBeNull();
    expect(nearest([snd({ id: 'a', band: 3 }), snd({ id: 'b', band: 1 })])?.id).toBe('b');
  });
});

const run = (sch: SoundScheduler, c: GhostCue | null, from: number, to: number, step = 50): SoundEvent[] => {
  const out: SoundEvent[] = [];
  // the server re-sends a cue at least once a second, so the cue is never older than 1 s here
  for (let t = from; t <= to; t += step) out.push(...sch.tick(c, from + Math.floor((t - from) / 1000) * 1000, t));
  return out;
};
const count = (e: SoundEvent[], k: SoundEvent['kind']) => e.filter((x) => x.kind === k).length;

describe('sound scheduler', () => {
  it('silent with no cue, an empty cue, or a stale cue', () => {
    expect(run(new SoundScheduler(), null, 0, 3000)).toEqual([]);
    expect(run(new SoundScheduler(), cue([]), 0, 3000)).toEqual([]);
    const sch = new SoundScheduler();
    expect(sch.tick(cue([snd()]), 0, CUE_STALE_MS + 1)).toEqual([]);
  });
  it('WARNING: only whispers, one at once and then about every 1.8 s, and nothing else', () => {
    const ev = run(new SoundScheduler(), cue([], true), 0, 5500);
    expect(count(ev, 'whisper')).toBe(4); // 0, 1800, 3600, 5400
    expect(ev.every((e) => e.kind === 'whisper')).toBe(true);
  });
  it('a moving ghost makes footsteps and a heartbeat; the nearer it is the more beats', () => {
    const far = run(new SoundScheduler(), cue([snd({ band: 3 })]), 0, 6000);
    const near = run(new SoundScheduler(), cue([snd({ band: 1 })]), 0, 6000);
    expect(count(far, 'step')).toBeGreaterThan(5);
    expect(count(near, 'beat')).toBeGreaterThan(count(far, 'beat'));
    const step = near.find((e): e is Extract<SoundEvent, { kind: 'step' }> => e.kind === 'step')!;
    expect(step.pan).toBeGreaterThan(0);
    expect(step.gain).toBe(soundGain(1));
  });
  it('a stunned or still ghost makes no footsteps but the heartbeat stays', () => {
    for (const s of [snd({ state: 'stunned', moving: false }), snd({ moving: false })]) {
      const ev = run(new SoundScheduler(), cue([s]), 0, 4000);
      expect(count(ev, 'step')).toBe(0);
      expect(count(ev, 'beat')).toBeGreaterThan(2);
    }
  });
  it('after a long stall it does not replay a backlog', () => {
    const sch = new SoundScheduler();
    sch.tick(cue([snd()]), 0, 0);
    const ev = sch.tick(cue([snd()]), 1000, 1500);
    expect(count(ev, 'beat')).toBeLessThanOrEqual(1);
    expect(count(ev, 'step')).toBeLessThanOrEqual(1);
  });
  it('the same cue stream gives the same events (deterministic)', () => {
    const a = run(new SoundScheduler(), cue([snd({ band: 2 })]), 0, 4000);
    const b = run(new SoundScheduler(), cue([snd({ band: 2 })]), 0, 4000);
    expect(a).toEqual(b);
  });
});

describe('flicker', () => {
  it('stays in range, dips but never goes dark, changes no faster than a slot, and is deterministic', () => {
    let dims = 0, prev = flickerLevel(0, false), changes = 0;
    for (let t = 0; t < 20000; t += 10) {
      const v = flickerLevel(t, false);
      expect(v).toBeGreaterThanOrEqual(FLICKER_MIN);
      expect(v).toBeLessThanOrEqual(1);
      if (v < 1) dims++;
      if (v !== prev) changes++;
      prev = v;
      expect(flickerLevel(t, false)).toBe(v);
    }
    expect(dims).toBeGreaterThan(100);
    expect(changes).toBeLessThanOrEqual(Math.ceil(20000 / FLICKER_SLOT_MS) + 1);
  });
  it('reduced mode is a slow gentle dim: never below 0.7 and no jump between frames', () => {
    let prev = flickerLevel(0, true);
    for (let t = 16; t < 10000; t += 16) {
      const v = flickerLevel(t, true);
      expect(v).toBeGreaterThanOrEqual(0.7);
      expect(Math.abs(v - prev)).toBeLessThan(0.02);
      prev = v;
    }
  });
  it('no effect outside a warning, and a bad clock is safe', () => {
    expect(lightScale(false, 1234, false)).toBe(1);
    expect(flickerLevel(NaN, false)).toBe(1);
  });
});

describe('ghost look', () => {
  it('a stunned ghost is dimmer than a hunting one, and values are valid', () => {
    for (const s of ['roaming', 'hunting', 'stunned'] as const) {
      const l = ghostLook(s, 1000);
      expect(l.glowAlpha).toBeGreaterThan(0); expect(l.glowAlpha).toBeLessThan(1);
      expect(l.bodyAlpha).toBeGreaterThan(0); expect(l.bodyAlpha).toBeLessThanOrEqual(1);
    }
    expect(ghostLook('stunned', 0).bodyAlpha).toBeLessThan(ghostLook('hunting', 0).bodyAlpha);
    expect(ghostLook('stunned', 500).bob).toBe(0);
  });
  it('the outline has the requested point count and finite coordinates', () => {
    const o = wispOutline(123, 18);
    expect(o).toHaveLength(18);
    expect(o.every((p) => Number.isFinite(p.x) && Number.isFinite(p.y))).toBe(true);
  });
  it('smoothing approaches without overshoot and snaps a bad start', () => {
    let c = 0;
    for (let i = 0; i < 100; i++) { c = smoothToward(c, 100, 16); expect(c).toBeLessThanOrEqual(100); }
    expect(c).toBeGreaterThan(95);
    expect(smoothToward(NaN, 5, 16)).toBe(5);
  });
});
