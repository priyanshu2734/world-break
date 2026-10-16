import { describe, expect, it } from 'vitest';
import { createRng, deriveSeed } from '../src/disasters/rng';

const seq = (seed: number, n: number) => { const r = createRng(seed); return Array.from({ length: n }, () => r.next()); };

describe('seeded PRNG', () => {
  it('matches the published mulberry32 reference value for seed 12345', () => {
    expect(createRng(12345).next()).toBe(0.9797282677609473);
  });
  it('same seed => identical sequence; different seed => different sequence', () => {
    expect(seq(42, 50)).toEqual(seq(42, 50));
    expect(seq(42, 50)).not.toEqual(seq(43, 50));
  });
  it('next() stays inside [0, 1)', () => {
    for (const v of seq(7, 5000)) { expect(v).toBeGreaterThanOrEqual(0); expect(v).toBeLessThan(1); }
  });
  it('normalises the seed to an unsigned 32-bit integer', () => {
    expect(createRng(-1).seed).toBe(4294967295);
    expect(seq(-1, 5)).toEqual(seq(4294967295, 5));
  });
  it('int() is inclusive on both ends and hits every value', () => {
    const r = createRng(1);
    const seen = new Set<number>();
    for (let i = 0; i < 500; i++) seen.add(r.int(3, 6));
    expect([...seen].sort()).toEqual([3, 4, 5, 6]);
    expect(createRng(5).int(9, 9)).toBe(9);
  });
  it('int() rejects non-integer and inverted ranges', () => {
    const r = createRng(1);
    expect(() => r.int(1.5, 4)).toThrow();
    expect(() => r.int(5, 4)).toThrow();
    expect(() => r.int(Number.NaN, 4)).toThrow();
  });
  it('pick() is deterministic and rejects an empty list', () => {
    const items = ['a', 'b', 'c', 'd'] as const;
    const a = createRng(9), b = createRng(9);
    for (let i = 0; i < 20; i++) expect(a.pick(items)).toBe(b.pick(items));
    expect(() => createRng(1).pick([])).toThrow();
  });
  it('shuffle() returns a permutation, never mutates its input, and is deterministic', () => {
    const input = [1, 2, 3, 4, 5, 6, 7, 8];
    const frozen = Object.freeze([...input]);
    const out = createRng(3).shuffle(frozen);
    expect([...out].sort((x, y) => x - y)).toEqual(input);
    expect(createRng(3).shuffle(frozen)).toEqual(out);
    expect(createRng(4).shuffle(frozen)).not.toEqual(out);
    expect(frozen).toEqual(input);
  });
  it('chance() clamps and respects the extremes', () => {
    const r = createRng(2);
    for (let i = 0; i < 100; i++) { expect(r.chance(0)).toBe(false); expect(r.chance(-3)).toBe(false); expect(r.chance(1)).toBe(true); expect(r.chance(9)).toBe(true); }
  });
  it('fork() is deterministic, label-sensitive, and does not consume the parent', () => {
    const parent = createRng(100);
    const before = parent.next();
    const p2 = createRng(100);
    p2.fork('x').next();
    expect(p2.next()).toBe(before); // forking did not advance the parent
    expect(createRng(100).fork('x').next()).toBe(createRng(100).fork('x').next());
    expect(createRng(100).fork('x').seed).not.toBe(createRng(100).fork('y').seed);
    expect(createRng(100).fork(1).seed).not.toBe(createRng(101).fork(1).seed);
  });
  it('is roughly uniform (coarse sanity check, not a statistical test)', () => {
    const buckets = new Array<number>(10).fill(0);
    const r = createRng(2024);
    for (let i = 0; i < 20000; i++) { const k = Math.floor(r.next() * 10); buckets[k] = (buckets[k] ?? 0) + 1; }
    for (const n of buckets) { expect(n).toBeGreaterThan(1700); expect(n).toBeLessThan(2300); }
  });
});

describe('deriveSeed', () => {
  it('is stable, an unsigned 32-bit integer, and order/part sensitive', () => {
    expect(deriveSeed('run', 5)).toBe(deriveSeed('run', 5));
    expect(deriveSeed('run', 5)).not.toBe(deriveSeed('run', 6));
    expect(deriveSeed('a', 1)).not.toBe(deriveSeed(1, 'a'));
    expect(deriveSeed('ab', 'c')).not.toBe(deriveSeed('a', 'bc')); // part boundaries matter
    for (const s of [deriveSeed(), deriveSeed('x'), deriveSeed(1_000_000, 'y')]) {
      expect(Number.isInteger(s)).toBe(true); expect(s).toBeGreaterThanOrEqual(0); expect(s).toBeLessThanOrEqual(0xffffffff);
    }
  });
  it('pinned values (guards against accidental changes to the derivation, which would change every stage)', () => {
    expect(deriveSeed('a', 1)).toBe(1745190376);
    expect(deriveSeed('a', 2)).toBe(1795523233);
    expect(deriveSeed(1, 'a')).toBe(1070472968);
  });
});
