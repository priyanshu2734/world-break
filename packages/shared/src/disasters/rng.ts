/**
 * Small deterministic PRNG for authoritative code (stage generation, escalation schedules).
 *
 * Rules: no Math.random / Date.now anywhere near authoritative state. Same seed => same sequence, on every
 * platform (integer maths only: Math.imul and unsigned shifts). A seed is any 32-bit integer; use
 * `deriveSeed` to build one from several parts (run seed, stage number, disaster id, ...).
 */

export interface Rng {
  /** The 32-bit seed this generator started from. */
  readonly seed: number;
  /** Uniform float in [0, 1). */
  next(): number;
  /** Uniform integer in [minInclusive, maxInclusive]. Throws on a non-integer or inverted range. */
  int(minInclusive: number, maxInclusive: number): number;
  /** True with probability p (clamped to [0, 1]). */
  chance(p: number): boolean;
  /** Uniform element. Throws on an empty list. */
  pick<T>(items: readonly T[]): T;
  /** Fisher-Yates over a COPY. The input is never mutated. */
  shuffle<T>(items: readonly T[]): T[];
  /** An independent generator whose seed depends only on this generator's seed and the label. */
  fork(label: string | number): Rng;
}

/** FNV-1a (32-bit) over the parts joined with a separator that cannot appear inside a part's own text. */
export function deriveSeed(...parts: ReadonlyArray<string | number>): number {
  let h = 0x811c9dc5;
  const text = parts.map((p) => String(p)).join('\u001f');
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** mulberry32. Fast, tiny, and good enough for gameplay scheduling (not for security). */
export function createRng(seed: number): Rng {
  const start = seed >>> 0;
  let a = start;

  const next = (): number => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };

  const rng: Rng = {
    seed: start,
    next,
    int(minInclusive, maxInclusive) {
      if (!Number.isInteger(minInclusive) || !Number.isInteger(maxInclusive) || maxInclusive < minInclusive) {
        throw new Error(`rng.int: invalid range [${minInclusive}, ${maxInclusive}]`);
      }
      return minInclusive + Math.floor(next() * (maxInclusive - minInclusive + 1));
    },
    chance(p) {
      return next() < Math.max(0, Math.min(1, p));
    },
    pick<T>(items: readonly T[]): T {
      if (items.length === 0) throw new Error('rng.pick: empty list');
      return items[Math.floor(next() * items.length)] as T;
    },
    shuffle<T>(items: readonly T[]): T[] {
      const out = [...items];
      for (let i = out.length - 1; i > 0; i--) {
        const j = Math.floor(next() * (i + 1));
        const tmp = out[i] as T;
        out[i] = out[j] as T;
        out[j] = tmp;
      }
      return out;
    },
    fork(label) {
      return createRng(deriveSeed(start, 'fork', label));
    },
  };
  return rng;
}
