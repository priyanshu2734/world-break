import { describe, expect, it } from 'vitest';
import { AMBIENT_TABLE, DIFFICULTIES, StageStateSchema, ambientFor, ambientPercent, type Difficulty } from '../src';

describe('ambient brightness table (stage and mode, never a player setting)', () => {
  it('starts at the base on stage 1', () => {
    expect(ambientPercent('easy', 1)).toBe(30);
    expect(ambientPercent('intermediate', 1)).toBe(20);
    expect(ambientPercent('hardcore', 1)).toBe(10);
  });
  it('loses one point per stage and stops at the floor (stages 1, 10, 100, 1,000,000)', () => {
    expect(ambientPercent('easy', 10)).toBe(21);
    expect(ambientPercent('intermediate', 10)).toBe(11);
    expect(ambientPercent('hardcore', 10)).toBe(2); // 10 - 9 = 1, held at the floor of 2
    for (const d of DIFFICULTIES) {
      expect(ambientPercent(d, 100)).toBe(AMBIENT_TABLE[d].floor);
      expect(ambientPercent(d, 1_000_000)).toBe(AMBIENT_TABLE[d].floor);
    }
  });
  it('is monotone non-increasing in the stage, brighter on easier modes, and always inside [floor, base]', () => {
    for (const d of DIFFICULTIES) {
      let prev = Infinity;
      for (let s = 1; s <= 60; s++) {
        const a = ambientPercent(d, s);
        expect(a).toBeLessThanOrEqual(prev);
        expect(a).toBeGreaterThanOrEqual(AMBIENT_TABLE[d].floor);
        expect(a).toBeLessThanOrEqual(AMBIENT_TABLE[d].base);
        prev = a;
      }
    }
    for (let s = 1; s <= 40; s++) {
      expect(ambientPercent('easy', s)).toBeGreaterThanOrEqual(ambientPercent('intermediate', s));
      expect(ambientPercent('intermediate', s)).toBeGreaterThanOrEqual(ambientPercent('hardcore', s));
    }
  });
  it('treats garbage stage numbers as stage 1 and returns a 0..1 fraction', () => {
    const d: Difficulty = 'easy';
    for (const s of [0, -5, Number.NaN, Number.POSITIVE_INFINITY * 0]) expect(ambientPercent(d, s)).toBe(30);
    expect(ambientPercent(d, 3.9)).toBe(28);
    expect(ambientFor('easy', 1)).toBeCloseTo(0.3);
  });
});

describe('public stage state: darkness is an optional additive field', () => {
  it('accepts a fraction in 0..1 and rejects anything else', () => {
    const shape = StageStateSchema.shape.darkness;
    expect(shape.safeParse(undefined).success).toBe(true);
    expect(shape.safeParse({ ambient: 0.3 }).success).toBe(true);
    expect(shape.safeParse({ ambient: 1.2 }).success).toBe(false);
    expect(shape.safeParse({ ambient: -0.1 }).success).toBe(false);
  });
});
