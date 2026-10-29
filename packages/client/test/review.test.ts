import { describe, expect, it } from 'vitest';
import type { DeathReview, DeathReviewMsg } from '@wb/shared';
import { fmtTick, retryHint, reviewSections, showReview, teamLine, wipeHeadline } from '../src/ui/death/reviewLogic';

const review = (o: Partial<DeathReview> = {}): DeathReview => ({
  player: 'a', name: 'Ada', tick: 1260, life: 'downed', deaths: 1,
  cause: { how: 'touch', ghost: 'g0', ghostKind: 'wisp', because: ['Heard Ada running at tick 1200', 'Caught Ada at tick 1260'] },
  warnings: [{ tick: 300, text: 'The lights flickered.' }], noise: [{ tick: 1200, text: 'Heard Ada running' }], hiding: [{ tick: 1230, text: 'Tried to hide: nothing here.' }],
  rescues: [{ tick: 1300, text: 'Bo started reviving you.' }], carried: [{ label: 'Access Key' }],
  dropped: [{ tick: 1264, label: 'Access Key', room: 'r0', x: 100, y: 680, relocated: true }], ...o,
});
const msg = (o: Partial<DeathReviewMsg> = {}): DeathReviewMsg => ({ stage: 7, attempt: 1, wiped: true, yours: review(), team: [{ name: 'Ada', life: 'downed', diedAt: 1260 }, { name: 'Bo', life: 'alive', diedAt: null }], ...o });

describe('P4 step 4: the review text (client)', () => {
  it('ticks are shown as m:ss on the stage clock', () => {
    expect(fmtTick(0)).toBe('0:00');
    expect(fmtTick(1260)).toBe('1:03');
    expect(fmtTick(20 * 60 * 5 + 20 * 9)).toBe('5:09');
    expect(fmtTick(-5)).toBe('0:00');
  });
  it('the sections follow the questions a person asks, with the time of death first, and every line the server wrote', () => {
    const s = reviewSections(review());
    expect(s.map((x) => x.title)).toEqual(['You died at 1:03', 'Warnings you got', 'Noise you made', 'Your hiding attempts', 'You were carrying', 'Dropped where you fell', 'Rescue attempts']);
    expect(s[0]!.lines).toEqual(['A ghost touched you.', 'Heard Ada running at tick 1200', 'Caught Ada at tick 1260']);
    expect(s[1]!.lines).toEqual(['0:15  The lights flickered.']);
    expect(s[5]!.lines).toEqual(['1:03  Access Key (moved to the nearest floor you can reach)']);
    expect(s[6]!.lines).toEqual(['1:05  Bo started reviving you.']);
  });
  it('empty sections are left out, and a ghost that opened the hiding place is said so', () => {
    const s = reviewSections(review({ warnings: [], noise: [], hiding: [], rescues: [], carried: [], dropped: [], cause: { how: 'opened_spot', ghost: 'g0', ghostKind: null, because: [] } }));
    expect(s).toEqual([{ title: 'You died at 1:03', lines: ['The ghost opened your hiding place.'] }]);
  });
  it('the team line says who died when and who lived', () => {
    expect(teamLine(msg())).toBe('Ada died 1:03   ·   Bo lived');
  });
  it('the headline: a banner during the wipe beat, the stage and attempt in the review, nothing otherwise', () => {
    expect(wipeHeadline('team_wiped', null)).toBe('THE TEAM IS WIPED');
    expect(wipeHeadline('death_review', msg())).toBe('STAGE 7 — ATTEMPT 2: WIPED');
    expect(wipeHeadline('death_review', null)).toBe('THE TEAM IS WIPED');
    for (const p of ['lobby', 'briefing', 'playing', 'stage_complete'] as const) expect(wipeHeadline(p, msg())).toBe('');
    expect(wipeHeadline(undefined, null)).toBe('');
  });
  it('the panel shows only in the review; the hint tells the host to retry and the others to wait, never in another phase', () => {
    expect(showReview('death_review')).toBe(true);
    expect(showReview('team_wiped')).toBe(false);
    expect(showReview('playing')).toBe(false);
    expect(retryHint('death_review', true, 7)).toBe('N  try stage 7 again on a new layout');
    expect(retryHint('death_review', false, 7)).toBe('Waiting for the host to try again…');
    expect(retryHint('team_wiped', true, 7)).toBe('');
    expect(retryHint('stage_complete', true, 7)).toBe('');
  });
});
