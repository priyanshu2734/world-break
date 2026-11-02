import { describe, expect, it } from 'vitest';
import {
  GOAL_NOTE, METHOD_WORDS, PUZZLE_FROM_STAGE, PUZZLE_TYPES, SYMBOLS, breakerClue, glyphClue, legendClue, leverClue, methodWordIn, parseBreaker, parseGlyphs, parseLegend, parseLever,
  parseWiring, puzzleChance, puzzlesForStage, symbolCode, wiringClue, needText, ANY_LOCK_TYPES,
} from '../src';

describe('P3F step 2: puzzle words and tables', () => {
  it('every type has an introduction stage and a refusal text; the pool grows with the stage and never shrinks', () => {
    for (const t of PUZZLE_TYPES) { expect(PUZZLE_FROM_STAGE[t]).toBeGreaterThanOrEqual(6); expect(needText(t)).toMatch(/^Locked\./); }
    let before = 0;
    for (let s = 1; s <= 40; s++) { const n = puzzlesForStage(s).length; expect(n).toBeGreaterThanOrEqual(before); before = n; }
    expect(ANY_LOCK_TYPES.length).toBe(13);
  });
  it('the chance rises in steps of 1.25 points from stage 6 and stops at 75 percent', () => {
    expect(puzzleChance(6)).toBeCloseTo(0.4, 10);
    expect(puzzleChance(7)).toBeCloseTo(0.4125, 10);
    expect(puzzleChance(34)).toBe(0.75);
    expect(puzzleChance(35)).toBe(0.75);
    expect(puzzleChance(Number.NaN)).toBe(0);
  });
  it('every clue builder round-trips through its parser, and an old (SUPERSEDED) page is never accepted', () => {
    for (const order of [[0, 1, 2], [2, 0, 1], [3, 1, 0, 2]]) { expect(parseLever(leverClue(order).text)).toEqual(order); expect(parseLever(leverClue(order, true).text)).toBeNull(); }
    for (const t of [[true, false, true], [false, false, true, true]]) { expect(parseBreaker(breakerClue(t).text)).toEqual(t); expect(parseBreaker(breakerClue(t, true).text)).toBeNull(); }
    for (let r = 0; r < 4; r++) { expect(parseWiring(wiringClue(r).text)).toBe(r); expect(parseWiring(wiringClue(r, true).text)).toBeNull(); }
    const legend = Object.fromEntries(SYMBOLS.map((s, i) => [s, (i * 3) % 10]));
    expect(parseLegend(legendClue(legend).text)).toEqual(legend);
    expect(parseGlyphs(glyphClue(['moon', 'eye', 'key', 'bell']).text)).toEqual(['moon', 'eye', 'key', 'bell']);
    expect(symbolCode(['moon', 'eye'], { moon: 4, eye: 7 })).toBe('47');
    expect(symbolCode(['moon', 'sun'], { moon: 4 })).toBeNull();
  });
  it('no builder or goal note contains an instruction verb, and the verb list catches one', () => {
    const texts = [leverClue([0, 1, 2]).text, leverClue([0, 1, 2], true).text, breakerClue([true, false, true]).text, wiringClue(1).text, glyphClue(['moon']).text, legendClue({ moon: 1 }).text, ...Object.values(GOAL_NOTE).map((g) => g!.text)];
    for (const t of texts) expect(methodWordIn(t), t).toBeNull();
    expect(methodWordIn('Pull the second lever, then wait.')).toBe('pull');
    expect(METHOD_WORDS.length).toBeGreaterThanOrEqual(20);
  });
  it('labels fit the 24 character limit of a clue', () => {
    for (const l of [leverClue([0]).label, leverClue([0], true).label, breakerClue([true]).label, breakerClue([true], true).label, wiringClue(0).label, wiringClue(0, true).label, glyphClue([]).label, legendClue({}).label, ...Object.values(GOAL_NOTE).map((g) => g!.label)]) expect(l.length).toBeLessThanOrEqual(24);
  });
});
