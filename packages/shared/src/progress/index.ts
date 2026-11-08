import { z } from 'zod';
import { DifficultySchema, isDifficultyUnlocked, unlockedDifficulties, type Difficulty } from '../difficulty';
import { UPGRADES, UPGRADE_IDS } from '../draft';
import { VarietyHistorySchema } from '../variety/save';

/**
 * P6 workstream C: what an account keeps, as data and pure functions shared by server and client (docs/PROGRESSION.md).
 * The server decides every number here; a browser never submits a stage, score, unlock flag or save.
 * `phases.ts` and `difficulty.ts` stay frozen: unlocks are always `isDifficultyUnlocked` / `unlockedDifficulties`.
 */

/** A cosmetic is granted at every milestone stage (10, 20, 30 ...). They carry no gameplay power. */
export const REWARD_EVERY = 10;
export const COSMETIC_IDS = [
  'trail_cyan', 'trail_amber', 'trail_violet', 'halo_ring', 'halo_shard', 'visor_scan',
  'visor_wide', 'badge_relay', 'badge_breaker', 'spark_gold', 'spark_ember', 'aura_void',
] as const;
export type CosmeticId = (typeof COSMETIC_IDS)[number];
export const CosmeticIdSchema = z.enum(COSMETIC_IDS);

/** The milestone stages reached so far (every multiple of REWARD_EVERY up to `highest`), as a count. Safe for a huge stage: it is arithmetic. */
export function milestonesReached(highest: number): number {
  return Number.isSafeInteger(highest) && highest >= REWARD_EVERY ? Math.floor(highest / REWARD_EVERY) : 0;
}
/** The cosmetics earned by reaching `highest` (milestone k grants cosmetic k, cycling; at most `COSMETIC_IDS.length` distinct ids, in a stable order). */
export function rewardsFor(highest: number): CosmeticId[] {
  const k = Math.min(milestonesReached(highest), COSMETIC_IDS.length);
  return COSMETIC_IDS.slice(0, k);
}
/** The cosmetic a given milestone stage grants for the first time, or null (not a milestone, or all twelve are already granted). */
export function rewardAtStage(stage: number): CosmeticId | null {
  if (!Number.isSafeInteger(stage) || stage < REWARD_EVERY || stage % REWARD_EVERY !== 0) return null;
  return COSMETIC_IDS[stage / REWARD_EVERY - 1] ?? null;
}

/** The largest stage number a schema accepts: a sanity bound against absurd input, not a last stage (the game is endless). */
export const STAGE_NUMBER_LIMIT = 1_000_000_000;
export const StageNumberSchema = z.number().int().min(1).max(STAGE_NUMBER_LIMIT);

/** One cleared stage as the server records it for a signed-in player. */
export const StageResultSchema = z.object({
  stage: StageNumberSchema,
  mode: DifficultySchema,
  /** Server ticks the stage took (20 per second). */
  ticks: z.number().int().min(0).max(100_000_000),
  score: z.number().int().min(0).max(1_000_000_000),
  players: z.number().int().min(1).max(4),
  deaths: z.number().int().min(0).max(1000),
}).strict();
export type StageResult = z.infer<typeof StageResultSchema>;

const UpgradeCounts = z.record(z.enum(UPGRADE_IDS), z.number().int().min(0).max(8));
/**
 * The run save slot, written ONLY when a stage is cleared. `stage` is the stage the run will play next, `seedBase` the run seed (every stage seed derives
 * from it), `variety` is `Room.varietyRecords` (a later stage depends on what the stages before it used), `upgrades` and `pickOrder` are the drafted
 * upgrades the team owns (P3F step 4: they carry from stage to stage; Hardcore costs the newest on a wipe, which is never saved).
 */
export const RunSaveSchema = z.object({
  stage: StageNumberSchema,
  mode: DifficultySchema,
  seedBase: z.number().int().min(0).max(0xffffffff),
  variety: VarietyHistorySchema,
  upgrades: UpgradeCounts,
  pickOrder: z.array(z.enum(UPGRADE_IDS)).max(64),
}).strict().superRefine((s, ctx) => {
  for (const id of UPGRADE_IDS) if ((s.upgrades[id] ?? 0) > UPGRADES[id].max) ctx.addIssue({ code: 'custom', message: `too many ${id}` });
});
export type RunSave = z.infer<typeof RunSaveSchema>;

export const STORAGE_STATES = ['ok', 'down', 'guest'] as const;
export type StorageState = (typeof STORAGE_STATES)[number];

/** Sent to ONE player: who they are to the server, what they have earned, and what this lobby can do for them. */
export const ProfileSchema = z.object({
  signedIn: z.boolean(),
  name: z.string().max(32).optional(),
  highestStage: StageNumberSchema,
  unlocked: z.array(DifficultySchema).max(3),
  rewards: z.array(CosmeticIdSchema).max(COSMETIC_IDS.length),
  /** This player's own save slot (what "Continue" would start if THEY host). */
  save: z.object({ stage: StageNumberSchema, mode: DifficultySchema }).nullable(),
  /** `guest`: signed out, nothing is saved. `down`: signed in but the store is unavailable, so the game runs guest-like and nothing is saved. */
  storage: z.enum(STORAGE_STATES),
  /** The room: modes the HOST's unlocks allow, the host's save (if the host is signed in), and what the host chose to start. */
  room: z.object({
    allowed: z.array(DifficultySchema).min(1).max(3),
    hostSave: z.object({ stage: StageNumberSchema, mode: DifficultySchema }).nullable(),
    choice: z.enum(['new', 'continue']),
    hostSignedIn: z.boolean(),
  }).optional(),
}).strict();
export type Profile = z.infer<typeof ProfileSchema>;

export const RunChoiceSchema = z.object({ choice: z.enum(['new', 'continue']) }).strict();
export type RunChoice = z.infer<typeof RunChoiceSchema>;

/** The profile a guest sees: nothing saved, only Easy, no rewards. */
export function guestProfile(): Profile {
  return { signedIn: false, highestStage: 1, unlocked: unlockedDifficulties(1), rewards: [], save: null, storage: 'guest' };
}

/** What a stage-N progress value unlocks, for display (the server enforces with `isDifficultyUnlocked`). */
export function unlockedFor(highest: number): Difficulty[] { return unlockedDifficulties(highest); }
export { isDifficultyUnlocked };

// ---- auth wire format (HTTP, docs/PROGRESSION.md) ----
export const AuthConfigSchema = z.object({
  mode: z.enum(['off', 'google', 'dev']),
  googleClientId: z.string().max(256).optional(),
});
export type AuthConfig = z.infer<typeof AuthConfigSchema>;
export const AuthLoginSchema = z.object({ credential: z.string().min(1).max(4096) }).strict();
export const AuthSessionSchema = z.object({ token: z.string().min(1).max(2048), expiresAt: z.number().int().min(0), profile: ProfileSchema });
export type AuthSession = z.infer<typeof AuthSessionSchema>;
