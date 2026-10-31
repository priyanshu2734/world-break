import { describe, expect, it } from 'vitest';
import { SERVER_TICK_HZ, type DeathState, type GhostPing } from '@wb/shared';
import { PING_TTL_MS, SPECTATE_HINT, activePings, eyesId, headline, isSpectating, pingAlpha, pingWaitMs, reviveSeconds, switchKey, watchLine } from '../src/ui/death/spectateLogic';

const ds = (o: Partial<DeathState> = {}): DeathState => ({ tick: 100, life: 'downed', following: { id: 'b', name: 'Bea' }, watchable: [{ id: 'b', name: 'Bea' }, { id: 'c', name: 'Cy' }], pingReadyIn: 0, reviveLeft: 900, ...o });
const ping = (o: Partial<GhostPing> = {}): GhostPing => ({ tick: 5, room: 'r0', x: 100, y: 680, from: 'A', ...o });

describe('P4 spectator logic (client)', () => {
  it('only the dead spectate; the living, and no state at all, do not', () => {
    expect(isSpectating(ds({ life: 'downed' }))).toBe(true);
    expect(isSpectating(ds({ life: 'eliminated' }))).toBe(true);
    expect(isSpectating(ds({ life: 'alive' }))).toBe(false);
    expect(isSpectating(null)).toBe(false);
    expect(isSpectating(undefined)).toBe(false);
  });
  it('whose eyes: the followed teammate, null for the living or when nobody is left', () => {
    expect(eyesId(ds())).toBe('b');
    expect(eyesId(ds({ life: 'alive' }))).toBeNull();
    expect(eyesId(ds({ following: null }))).toBeNull();
    expect(eyesId(null)).toBeNull();
  });
  it('the revive countdown runs from when the state arrived, never below zero', () => {
    const d = ds({ reviveLeft: 10 * SERVER_TICK_HZ });
    expect(reviveSeconds(d, 1000, 1000)).toBe(10);
    expect(reviveSeconds(d, 4500, 1000)).toBe(7);
    expect(reviveSeconds(d, 99_000, 1000)).toBe(0);
    expect(reviveSeconds(d, 0, 1000)).toBe(10); // a clock that went back changes nothing
  });
  it('the headline: nothing for the living, a revive hint for a body with time left, plain words once the window is over or eliminated', () => {
    expect(headline(ds({ life: 'alive' }), 0, 0)).toBe('');
    expect(headline(null, 0, 0)).toBe('');
    expect(headline(ds({ reviveLeft: 20 * SERVER_TICK_HZ }), 0, 0)).toContain('(20 s)');
    expect(headline(ds({ reviveLeft: 0 }), 0, 0)).toBe('YOU ARE DEAD.');
    expect(headline(ds({ life: 'eliminated', reviveLeft: 0 }), 0, 0)).toBe('YOU ARE OUT. Watch your team.');
  });
  it('the watch line (step 6): whom they watch or that they fly, the room, the ping wait; nobody left is said plainly', () => {
    expect(watchLine(ds(), 0, 0)).toBe('Watching Bea   G  ghost here');
    expect(watchLine(ds({ pingReadyIn: 2 * SERVER_TICK_HZ }), 0, 0)).toContain('ghost here (2 s)');
    expect(watchLine(ds({ cam: { room: 'r1', x: 5, y: 5, free: true }, rooms: ['r0', 'r1', 'r2'] }), 0, 0)).toBe('Flying   Room 2 of 3   G  ghost here');
    expect(watchLine(ds({ cam: { room: 'r0', x: 5, y: 5, free: false }, rooms: ['r0', 'r1'] }), 0, 0)).toBe('Watching Bea   Room 1 of 2   G  ghost here');
    expect(watchLine(ds({ following: null, watchable: [] }), 0, 0)).toBe('Nobody is left to watch   G  ghost here');
    expect(watchLine(ds({ life: 'alive' }), 0, 0)).toBe('');
    expect(pingWaitMs(ds({ pingReadyIn: SERVER_TICK_HZ }), 500, 0)).toBe(500);
    expect(SPECTATE_HINT).toContain('G');
    expect(SPECTATE_HINT).toContain('fly');
  });
  it('arrow keys: left is the previous teammate, right the next, both or neither nothing', () => {
    expect(switchKey(true, false)).toBe('prev');
    expect(switchKey(false, true)).toBe('next');
    expect(switchKey(true, true)).toBeNull();
    expect(switchKey(false, false)).toBeNull();
  });
  it('pings: shown for 5 s, only in the room being drawn, faded at the end; none from the future', () => {
    const list = [{ ping: ping(), at: 1000 }, { ping: ping({ room: 'r1' }), at: 1000 }, { ping: ping(), at: 100 }];
    expect(PING_TTL_MS).toBe(5000);
    expect(activePings(list, 'r0', 2000).map((p) => p.age)).toEqual([1000, 1900]);
    expect(activePings(list, undefined, 2000)).toHaveLength(3);
    expect(activePings(list, 'r0', 6200)).toHaveLength(0); // 1000 + 5000 is over, 100 + 5000 is over
    expect(activePings([{ ping: ping(), at: 5000 }], 'r0', 4000)).toEqual([]);
    expect(pingAlpha(0)).toBe(1);
    expect(pingAlpha(1000)).toBe(1);
    expect(pingAlpha(3000)).toBeCloseTo(0.5, 5);
    expect(pingAlpha(PING_TTL_MS)).toBe(0);
  });
});
