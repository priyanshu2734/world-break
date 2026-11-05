import { createRng, deriveSeed } from '../disasters/rng';

/**
 * P3F step 4: the optional LOOT CACHE (risk and reward). A cache stands on the floor of one room from stage 13 on (always on 13, then half the stages). Nothing in the stage
 * needs it. Opening it pays one of three outcomes, fixed by the stage seed (so reloading cannot reroll it): extra score, a free upgrade, or a hazard (a loud crack that
 * every ghost in the room hears, and a small penalty). The outcome is never in the public state before the cache is opened.
 */
export const LOOT = {
  fromStage: 13,
  /** Share of the stages after `fromStage` that hold a cache. */
  chance: 0.5,
  /** Weights of the three outcomes (percent). */
  scorePct: 50, upgradePct: 25, hazardPct: 25,
  scorePoints: 150,
  hazardPenalty: 30,
  /** Loudness of the crack of a hazard (same scale as `NOISE_KIND_LOUDNESS`; a door is 0.6, a shot 1). */
  hazardLoud: 1,
  category: 'loot',
} as const;

export type LootOutcome = 'score' | 'upgrade' | 'hazard';

/** Does this stage hold a cache? Stage 13 always; after it a seeded half. The generator asks; the answer is a pure function of (stage, seed). */
export function lootOnStage(stage: number, seed: number): boolean {
  const s = Number.isFinite(stage) ? Math.floor(stage) : 0;
  if (s < LOOT.fromStage) return false;
  return s === LOOT.fromStage || createRng(deriveSeed(seed, 'loot', s)).chance(LOOT.chance);
}

/** What a cache pays. A pure function of the stage seed and the cache id. */
export function lootOutcome(seed: number, id: string): LootOutcome {
  const r = createRng(deriveSeed(seed, 'loot-outcome', id)).int(0, 99);
  return r < LOOT.scorePct ? 'score' : r < LOOT.scorePct + LOOT.upgradePct ? 'upgrade' : 'hazard';
}
