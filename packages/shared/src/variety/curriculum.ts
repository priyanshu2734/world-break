import type { Rng } from '../disasters/rng';
import { createRng, deriveSeed } from '../disasters/rng';
import { ghostLineupForStage, ghostPickFor, type GhostType } from '../ghost';
import type { AnyLockType } from '../rooms/escape';

/**
 * P3F step 4: the CURRICULUM (docs/HOOK.md, "Curriculum v1") and the NEWNESS weighting that follows it.
 *
 * Stages 1 to 15 introduce something new each stage. `lock` is the lock a stage is GUARANTEED to feature (the generator forces it on one door and the validator
 * refuses a stage that lacks it). From stage 16 the generator picks with a newness score: what was used in the last three stages is avoided.
 * Pure data and pure functions: nothing here reads a clock or a random source other than the seeded generator it is given.
 */
export interface CurriculumRow {
  stage: number;
  /** What is new, in the words of docs/HOOK.md. */
  fresh: string;
  /** The lock this stage features (null: the stage draws freely among the locks it may use). */
  lock: AnyLockType | null;
  /** True where the thing that is new is built in P3F; false where it belongs to another phase (so nothing pretends otherwise). */
  built: boolean;
}

export const CURRICULUM: readonly CurriculumRow[] = [
  { stage: 1, fresh: 'Tutorial: locker key, door, exit', lock: 'key_item', built: true },
  { stage: 2, fresh: 'First ghost (Wisp) and the flicker warning; a hiding place. Its one door keeps the seeded lock the stage always had (stages 1 and 2 are exempt from the curriculum and the no-repeat rule, so old seeds keep their stage)', lock: null, built: true },
  { stage: 3, fresh: 'Code lock and notes, a decoy note', lock: 'code', built: true },
  { stage: 4, fresh: 'Pulse Gun in a safe: stun the ghost', lock: null, built: true },
  { stage: 5, fresh: 'Two-person lock (a solo route exists), 2 rooms', lock: 'two_person', built: true },
  { stage: 6, fresh: 'Battery and power lock', lock: 'power', built: true },
  { stage: 7, fresh: 'Shade ghost (frozen by your flashlight); ghosts are no longer named; breaker panel', lock: 'breaker_panel', built: true },
  { stage: 8, fresh: 'Pressure plates (vertical puzzle). The gravity pickup is a P3B ability and is not part of P3F', lock: 'pressure_plates', built: true },
  { stage: 9, fresh: 'Flashlight sensor puzzle. A lights-out room and the flare item are not built in P3F', lock: 'flashlight_sensor', built: true },
  { stage: 10, fresh: 'MAJOR BREACH: 3 rooms, a safe. The mini-boss Wisp and the new flashlight are not built in P3F', lock: 'safe', built: true },
  { stage: 11, fresh: 'Lever-sequence lock. The spark hazard is a disaster and is not built in P3F', lock: 'lever_sequence', built: true },
  { stage: 12, fresh: 'Howler ghost (scream breaks lights); tool key', lock: 'tool_key', built: true },
  { stage: 13, fresh: 'Optional loot cache (risk and reward); timed switch', lock: 'timed_switch', built: true },
  { stage: 14, fresh: 'Symbol match across two rooms (talk to your team)', lock: 'symbol_match', built: true },
  { stage: 15, fresh: 'Wiring choice. The first disaster layer is not built in P3F', lock: 'wiring', built: true },
];

/** The row of a stage from 1 to 15, or null (from stage 16 the weighted variety applies). */
export function curriculumRow(stage: number): CurriculumRow | null {
  const s = Number.isFinite(stage) ? Math.floor(stage) : 0;
  return CURRICULUM[s - 1] ?? null;
}
/** The lock a stage must feature. */
export function featuredLock(stage: number): AnyLockType | null { return curriculumRow(stage)?.lock ?? null; }
/** The last stage that has a curriculum row. */
export const CURRICULUM_LAST_STAGE = 15;

// ------------------------------------------------------------------------------------------------------------------ the themes
/** The visual themes (step 5 draws them). Chosen by the seed and the newness score; a theme never changes physics. */
export const THEME_IDS = ['lab', 'hospital', 'factory', 'library'] as const;
export type ThemeId = (typeof THEME_IDS)[number];

// ------------------------------------------------------------------------------------------------------------------ history and newness
/** What one finished stage used. The Room records one per stage generated and hands the last `HISTORY_KEEP` to the generator. */
export interface VarietyRecord {
  stage: number;
  /** The lock types of the stage's doors, in order. */
  locks: readonly string[];
  templates: readonly string[];
  ghosts: readonly GhostType[];
  theme: ThemeId;
}
/** Oldest first. */
export type VarietyHistory = readonly VarietyRecord[];
export const HISTORY_KEEP = 3;

/** The newest `HISTORY_KEEP` records. */
export function trimHistory(h: VarietyHistory): VarietyHistory { return h.slice(-HISTORY_KEEP); }

/** How recently, and how often, an item was used: the newest record counts `HISTORY_KEEP`, the one before it one less, and so on. 0 = not in the history. */
export function newnessScore(item: string, history: VarietyHistory, of: (r: VarietyRecord) => readonly string[]): number {
  let score = 0;
  trimHistory(history).forEach((r, i, all) => { const weight = HISTORY_KEEP - (all.length - 1 - i); score += weight * of(r).filter((x) => x === item).length; });
  return score;
}

/** Items ordered from freshest to stalest (stable: ties keep their order). */
export function freshestFirst<T extends string>(items: readonly T[], history: VarietyHistory, of: (r: VarietyRecord) => readonly string[]): T[] {
  return items.map((x, i) => ({ x, i, s: newnessScore(x, history, of) })).sort((a, b) => a.s - b.s || a.i - b.i).map((e) => e.x);
}

/** One uniform pick among the FRESHEST candidates. With an empty history every candidate ties, and this is exactly `rng.pick(items)` (one draw). */
export function newnessPick<T extends string>(rng: Rng, items: readonly T[], history: VarietyHistory, of: (r: VarietyRecord) => readonly string[]): T {
  const scores = items.map((x) => newnessScore(x, history, of));
  const best = Math.min(...scores);
  return rng.pick(items.filter((_, i) => scores[i] === best));
}

export const locksOf = (r: VarietyRecord): readonly string[] => r.locks;
export const templatesOf = (r: VarietyRecord): readonly string[] => r.templates;
export const ghostsOf = (r: VarietyRecord): readonly string[] => r.ghosts;
export const themeOf = (r: VarietyRecord): readonly string[] => [r.theme];

/** The theme of a stage: never the previous stage's, freshest first, seeded. Stage 1 is the lab. */
export function themeForStage(stage: number, seed: number, history: VarietyHistory = []): ThemeId {
  if (stage <= 1) return 'lab';
  const last = trimHistory(history).at(-1)?.theme;
  const pool = THEME_IDS.filter((t) => t !== last);
  return newnessPick(createRng(deriveSeed(seed, 'theme', stage)), pool, history, themeOf);
}

/**
 * Which of the two seeded lineups a stage runs (`ghostLineupForStage` takes a pick bit). The seed's own bit decides, unless that would put the SAME ghost
 * types on two stages in a row and the other bit would not: then the other one.
 */
export function ghostPickWith(stage: number, ghostSeed: number, history: VarietyHistory = []): number {
  const base = ghostPickFor(ghostSeed);
  const last = trimHistory(history).at(-1);
  if (!last || last.stage !== stage - 1) return base;
  const key = (l: readonly string[]): string => [...l].sort().join(',');
  const prev = key(last.ghosts);
  if (key(ghostLineupForStage(stage, base)) === prev && key(ghostLineupForStage(stage, 1 - base)) !== prev) return 1 - base;
  return base;
}
