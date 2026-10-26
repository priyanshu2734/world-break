import { describe, expect, it } from 'vitest';
import { CATCH_LIMITS, type GhostCue, type GhostStatus, type HidingSpotPublic } from '@wb/shared';
import { WARNING_TIP, canMove, captiveInReach, hidePrompt, modeOf, nearestSpot, onEPressed, shouldShowTip, spotWord } from '../src/ui/ghost/hideLogic';
import { SoundScheduler, type SoundEvent } from '../src/ui/ghost/soundScheduler';
import { cueIndicator } from '../src/ui/ghost/cueMath';

const spot = (id: string, x: number, kind: HidingSpotPublic['kind'] = 'closet'): HidingSpotPublic => ({ id, x, y: 680, kind });
const status = (o: Partial<GhostStatus> = {}): GhostStatus => ({ spots: [], hiddenIn: null, caught: null, captives: [], ...o });

describe('first warning line', () => {
  it('is exactly the agreed words, shown once, only while a warning plays', () => {
    expect(WARNING_TIP).toBe('The lights flicker. Something is near.');
    expect(shouldShowTip(true, false)).toBe(true);
    expect(shouldShowTip(true, true)).toBe(false);
    expect(shouldShowTip(false, false)).toBe(false);
  });
});

describe('nearest hiding spot', () => {
  const me = { x: 500, y: 680 };
  it('picks the nearest in reach, none out of reach, and ignores a different floor', () => {
    expect(nearestSpot(me, [spot('a', 540), spot('b', 520)])?.id).toBe('b');
    expect(nearestSpot(me, [spot('a', 500 + CATCH_LIMITS.hideRange + 1)])).toBeNull();
    expect(nearestSpot({ x: 500, y: 300 }, [spot('a', 500)])).toBeNull();
    expect(nearestSpot(me, [])).toBeNull();
  });
});

describe('caught teammate in reach', () => {
  const where = new Map([['a', { x: 560, y: 680 }], ['b', { x: 900, y: 680 }]]);
  it('finds the near one, not the far one, not one that is not drawn', () => {
    const caps = [{ id: 'a', progress: 0.2 }, { id: 'b', progress: 0 }, { id: 'c', progress: 0 }];
    expect(captiveInReach({ x: 520, y: 680 }, caps, where)?.id).toBe('a');
    expect(captiveInReach({ x: 520 - CATCH_LIMITS.rescueRange - 40, y: 680 }, caps, where)).toBeNull();
    expect(captiveInReach({ x: 900, y: 680 }, [{ id: 'c', progress: 0 }], where)).toBeNull();
  });
});

describe('modes and what E does', () => {
  it('free, hidden, caught', () => {
    expect(modeOf(null)).toBe('free');
    expect(modeOf(status())).toBe('free');
    expect(modeOf(status({ hiddenIn: 'x' }))).toBe('hidden');
    expect(modeOf(status({ caught: { secondsLeft: 30 } }))).toBe('caught');
    expect(modeOf(status({ hiddenIn: 'x', caught: { secondsLeft: 3 } }))).toBe('caught');
  });
  it('only a free player moves', () => {
    expect(canMove(null)).toBe(true);
    expect(canMove(status({ hiddenIn: 'x' }))).toBe(false);
    expect(canMove(status({ caught: { secondsLeft: 3 } }))).toBe(false);
  });
  it('E: hide at a spot, leave when hidden, nothing when caught, nothing on a tap next to a caught teammate or when something else uses E', () => {
    const s = spot('a', 500);
    expect(onEPressed({ status: status(), spot: s, captive: false, otherUse: false })).toBe('hide');
    expect(onEPressed({ status: status(), spot: null, captive: false, otherUse: false })).toBe('none');
    expect(onEPressed({ status: status(), spot: s, captive: true, otherUse: false })).toBe('none');
    expect(onEPressed({ status: status(), spot: s, captive: false, otherUse: true })).toBe('none');
    expect(onEPressed({ status: status({ hiddenIn: 'a' }), spot: s, captive: false, otherUse: false })).toBe('leave');
    expect(onEPressed({ status: status({ caught: { secondsLeft: 9 } }), spot: s, captive: false, otherUse: false })).toBe('none');
    expect(onEPressed({ status: null, spot: s, captive: false, otherUse: false })).toBe('hide'); // no status yet: the server decides
  });
  it('words', () => { expect(spotWord('closet')).toBe('closet'); expect(spotWord('vent')).toBe('vent'); });
});

describe('prompts', () => {
  it('say what to do in each situation', () => {
    expect(hidePrompt({ status: status(), spot: spot('a', 1, 'vent'), captive: null, captiveName: '' })).toBe('E  hide in the vent');
    expect(hidePrompt({ status: status(), spot: null, captive: null, captiveName: '' })).toBe('');
    expect(hidePrompt({ status: status({ hiddenIn: 'a' }), spot: null, captive: null, captiveName: '' })).toMatch(/E to come out/);
    expect(hidePrompt({ status: status(), spot: spot('a', 1), captive: { id: 'b', progress: 0.5 }, captiveName: 'Ada' })).toBe('Hold E to free Ada  50%');
    expect(hidePrompt({ status: status(), spot: null, captive: { id: 'b', progress: 0 }, captiveName: 'Ada' })).toBe('Hold E to free Ada');
    expect(hidePrompt({ status: status({ caught: { secondsLeft: 31 } }), spot: null, captive: null, captiveName: '' })).toMatch(/CAUGHT.*holding E.*31 s/);
  });
});

describe('the knock of an inspecting ghost', () => {
  const cue = (inspecting: boolean): GhostCue => ({ tick: 1, warning: false, sounds: [{ id: 'g0', kind: 'wisp', band: 2, dir: 1, state: 'roaming', moving: false, ...(inspecting ? { inspecting: true } : {}) }] });
  const run = (c: GhostCue): SoundEvent[] => {
    const sch = new SoundScheduler(), out: SoundEvent[] = [];
    for (let t = 0; t <= 3000; t += 50) out.push(...sch.tick(c, Math.floor(t / 1000) * 1000, t));
    return out;
  };
  it('knocks about twice a second while it checks, and not otherwise', () => {
    const k = run(cue(true)).filter((e) => e.kind === 'knock');
    expect(k.length).toBeGreaterThanOrEqual(5);
    expect(k.length).toBeLessThanOrEqual(8);
    expect(run(cue(false)).filter((e) => e.kind === 'knock')).toEqual([]);
  });
  it('the text cue says it is checking a hiding place', () => {
    expect(cueIndicator(cue(true))).toMatch(/checking a hiding place/);
  });
});
