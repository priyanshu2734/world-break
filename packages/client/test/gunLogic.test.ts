import { describe, expect, it } from 'vitest';
import { GUN_LIMITS, TICK_DT, type GhostPublic, type ItemsPublic } from '@wb/shared';
import { SHOT_SHOW_MS, aimLine, boltAt, canFire, carriesGun, flashAlpha, gunPrompt, liveShots, stunnedGhosts } from '../src/ui/ghost/gunLogic';

const items = (carrier: string | null, kind: 'pulse_gun' | 'access_key' = 'pulse_gun'): Pick<ItemsPublic, 'items'> => ({
  items: [{ id: 'g', kind, label: 'x', slots: 1, state: carrier ? 'carried' : 'in_world', x: 0, y: 0, carrierId: carrier, targetId: null }],
});

describe('P3E step 4 gun view', () => {
  it('knows who carries the gun', () => {
    expect(carriesGun(items('p0'), 'p0')).toBe(true);
    expect(carriesGun(items('p1'), 'p0')).toBe(false);
    expect(carriesGun(items(null), 'p0')).toBe(false);
    expect(carriesGun(items('p0', 'access_key'), 'p0')).toBe(false);
    expect(carriesGun(undefined, 'p0')).toBe(false);
  });
  it('the aim line is exactly the gun range long', () => {
    const l = aimLine({ x: 100, y: 500 }, Math.PI / 3);
    expect(Math.hypot(l.to.x - l.from.x, l.to.y - l.from.y)).toBeCloseTo(GUN_LIMITS.rangePx, 6);
    expect(l.from.y).toBe(500 - GUN_LIMITS.eyeHeight);
  });
  it('the bolt moves speedPx per tick and stops at range', () => {
    const shot = { x: 0, y: 0, angle: 0, rangePx: GUN_LIMITS.rangePx, speedPx: GUN_LIMITS.speedPx };
    expect(boltAt(shot, 0)).toEqual({ x: 0, y: 0, done: false });
    expect(boltAt(shot, TICK_DT * 1000 * 2).x).toBeCloseTo(2 * GUN_LIMITS.speedPx, 6);
    const end = boltAt(shot, 99999);
    expect(end.x).toBeCloseTo(GUN_LIMITS.rangePx, 6);
    expect(end.done).toBe(true);
    expect(boltAt(shot, -50).x).toBe(0);
  });
  it('flash fades and old shots are dropped', () => {
    expect(flashAlpha(0)).toBe(1);
    expect(flashAlpha(GUN_LIMITS.flashTicks * TICK_DT * 1000)).toBe(0);
    const shots = [{ at: 0 }, { at: 1000 }];
    expect(liveShots(shots, SHOT_SHOW_MS + 10)).toEqual([{ at: 1000 }].filter((s) => SHOT_SHOW_MS + 10 - s.at <= SHOT_SHOW_MS));
    expect(liveShots(shots, 10)).toHaveLength(2);
  });
  it('the prompt and the click are silent for a hidden or caught player or without a gun', () => {
    const free = { hiddenIn: null, caught: null };
    expect(gunPrompt(true, free)).toMatch(/click/);
    expect(gunPrompt(false, free)).toBeNull();
    expect(gunPrompt(true, { hiddenIn: 'h', caught: null })).toBeNull();
    expect(gunPrompt(true, { hiddenIn: null, caught: { secondsLeft: 5 } })).toBeNull();
    expect(canFire(true, free, 0)).toBe(true);
    expect(canFire(true, free, 2)).toBe(false);
    expect(canFire(false, free, 0)).toBe(false);
    expect(canFire(true, { hiddenIn: 'h', caught: null }, 0)).toBe(false);
    expect(canFire(true, null, 0)).toBe(true);
  });
  it('only a stunned ghost gets the tag', () => {
    const g = (state: GhostPublic['state']): GhostPublic => ({ id: state, kind: 'wisp', x: 0, y: 0, angle: 0, state, room: 'r0' });
    expect(stunnedGhosts([g('roaming'), g('stunned'), g('hunting')]).map((x) => x.state)).toEqual(['stunned']);
  });
});
