import { describe, expect, it } from 'vitest';
import type { DeathReview, DeathReviewMsg } from '@wb/shared';
import { REVIEW_SHOWN, coversScreen, fmtTick, killSummary, plainText, retryHint, reviewSections, showReview, teamLine, wipeHeadline } from '../src/ui/death/reviewLogic';

const review = (o: Partial<DeathReview> = {}): DeathReview => ({
  player: 'a', name: 'Ada', tick: 1260, life: 'downed', deaths: 1,
  cause: { how: 'touch', ghost: 'g0', ghostKind: 'wisp', because: ['Heard Ada running on appearing at tick 1304', 'Caught Ada at tick 1310'] },
  warnings: [{ tick: 300, text: 'The lights flickered.' }], noise: [{ tick: 1200, text: 'Heard Ada running at tick 1200' }], hiding: [{ tick: 1230, text: 'Tried to hide: nothing here.' }],
  rescues: [{ tick: 1300, text: 'Bo started reviving you.' }], carried: [{ label: 'Access Key' }],
  dropped: [{ tick: 1264, label: 'Access Key', room: 'r0', x: 100, y: 680, relocated: true }], ...o,
});
const msg = (o: Partial<DeathReviewMsg> = {}): DeathReviewMsg => ({ stage: 7, attempt: 1, wiped: true, yours: review(), team: [{ name: 'Ada', life: 'downed', diedAt: 1260 }, { name: 'Bo', life: 'alive', diedAt: null }], ...o });
const RAW_TICK = /\btick\b/i;

describe('P4 step 6: the review text (client)', () => {
  it('ticks are shown as m:ss on the stage clock', () => {
    expect(fmtTick(0)).toBe('0:00');
    expect(fmtTick(1260)).toBe('1:03');
    expect(fmtTick(20 * 60 * 5 + 20 * 9)).toBe('5:09');
    expect(fmtTick(-5)).toBe('0:00');
  });
  it('plain words: no raw tick anywhere, the ghost’s wording made readable, the player’s own name becomes "you"', () => {
    expect(plainText('Heard Ada running on appearing at tick 1304', 'Ada')).toBe('It heard you running as it appeared at 1:05');
    expect(plainText('Caught Ada at tick 1310', 'Ada')).toBe('It caught you at 1:05');
    expect(plainText('Opened the closet and found Ada at tick 800', 'Ada')).toBe('It opened the closet and found you at 0:40');
    expect(plainText('Heard Bo use a door at tick 400')).toBe('It heard Bo use a door at 0:20');
    expect(plainText('something at tick 20 and tick 40')).toBe('something at 0:01 and 0:02');
    expect(plainText('The lights flickered.')).toBe('The lights flickered.');
    // a name that is part of another word is left alone
    expect(plainText('Heard Adam running', 'Ada')).toBe('It heard Adam running');
    // and a name with regex characters cannot break it
    expect(() => plainText('Heard a.b running', 'a.b')).not.toThrow();
  });
  it('"what killed you and why" comes first: a short headline and one short reason line, with no raw tick', () => {
    const s = killSummary(review());
    expect(s.headline).toBe('A Wisp caught you.');
    expect(s.why).toBe('It heard you running as it appeared at 1:05.');
    expect(s.headline + s.why).not.toMatch(RAW_TICK);
    expect(killSummary(review({ cause: { how: 'opened_spot', ghost: 'g0', ghostKind: 'shade', because: ['Opened the closet and found Ada at tick 800'] } })))
      .toEqual({ headline: 'A Shade found you hiding.', why: 'It opened the closet and found you at 0:40.' });
    // two reasons are joined, only the last two are used, and a touch with no recorded reason still says when
    expect(killSummary(review({ cause: { how: 'touch', ghost: 'g0', ghostKind: 'howler', because: ['Heard Ada running at tick 100', 'Saw Ada at tick 200', 'Followed Ada at tick 300', 'Caught Ada at tick 310'] } })).why)
      .toBe('It saw you at 0:10, then it followed you at 0:15.');
    expect(killSummary(review({ cause: { how: 'touch', ghost: 'g0', ghostKind: null, because: [] } }))).toEqual({ headline: 'A ghost caught you.', why: 'It reached you at 1:03.' });
  });
  it('the body is short: only the last few lines of each part, empty parts left out, and nothing shows a raw tick', () => {
    const many = Array.from({ length: 9 }, (_, i) => ({ tick: 100 + i * 20, text: `Heard Ada running at tick ${100 + i * 20}` }));
    const s = reviewSections(review({ noise: many }));
    expect(s.map((x) => x.title)).toEqual(['Warnings you got', 'Noise you made', 'Your hiding attempts', 'You were carrying', 'Rescue attempts']);
    const noise = s.find((x) => x.title === 'Noise you made')!;
    expect(noise.lines).toHaveLength(REVIEW_SHOWN);
    expect(noise.lines.at(-1)).toBe('0:13  It heard you running at 0:13'); // the latest (tick 260)
    expect(s.flatMap((x) => x.lines).join('\n')).not.toMatch(RAW_TICK);
    expect(s.find((x) => x.title === 'You were carrying')!.lines).toEqual(['Access Key. It fell where you died (moved to a floor you can reach).']);
    expect(reviewSections(review({ warnings: [], noise: [], hiding: [], rescues: [], carried: [], dropped: [] }))).toEqual([]);
    expect(reviewSections(review({ dropped: [] })).find((x) => x.title === 'You were carrying')!.lines).toEqual(['Access Key.']);
  });
  it('the team line says who died when and who lived', () => {
    expect(teamLine(msg())).toBe('Ada died 1:03   ·   Bo lived');
  });
  it('the title: a banner during the wipe beat, the stage and attempt in the review, nothing otherwise', () => {
    expect(wipeHeadline('team_wiped', null)).toBe('THE TEAM IS WIPED');
    expect(wipeHeadline('death_review', msg())).toBe('STAGE 7 — ATTEMPT 2: WIPED');
    expect(wipeHeadline('death_review', null)).toBe('THE TEAM IS WIPED');
    for (const p of ['lobby', 'briefing', 'playing', 'stage_complete'] as const) expect(wipeHeadline(p, msg())).toBe('');
    expect(wipeHeadline(undefined, null)).toBe('');
  });
  it('the panel covers the whole screen from the wipe to the retry (the HUD has nothing to say then) and not before or after', () => {
    expect(coversScreen('team_wiped')).toBe(true);
    expect(coversScreen('death_review')).toBe(true);
    for (const p of ['lobby', 'briefing', 'playing', 'stage_complete'] as const) expect(coversScreen(p)).toBe(false);
    expect(coversScreen(undefined)).toBe(false);
  });
  it('the review body shows only in the review; the hint tells the host to retry and the others to wait, never in another phase', () => {
    expect(showReview('death_review')).toBe(true);
    expect(showReview('team_wiped')).toBe(false);
    expect(showReview('playing')).toBe(false);
    expect(retryHint('death_review', true, 7)).toBe('N  try stage 7 again on a new layout');
    expect(retryHint('death_review', false, 7)).toBe('Waiting for the host to try again…');
    expect(retryHint('team_wiped', true, 7)).toBe('');
    expect(retryHint('stage_complete', true, 7)).toBe('');
  });
});
