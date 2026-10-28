import { SERVER_TICK_HZ, type Difficulty } from '@wb/shared';

/**
 * P4: the ONE table of numbers of death (GAMEPLAY.md section 8). Seconds here, ticks in `deathTuning`. None of these grow with the stage: they are
 * fixed rules, not a difficulty curve (the stage already makes the ghost faster and the gun slower), so they hold at stage 1 and at stage 1,000,000.
 * They live here and not in shared `GHOST_TABLE` because P4 may not edit shared tables; a later phase may move them.
 */
export const DEATH_TABLE = {
  /** Easy and Intermediate: how long a body can be revived (45 s). Hardcore has no window at all. */
  reviveWindowS: 45,
  /** After a kill the ghost stands quiet this long (8 s), so the team can pick up what the dead player dropped without a second kill at the body. */
  satiatedS: 8,
  /** No kill in the first 20 s of a stage (the first appearance of a ghost is never earlier than this either, so this is a floor, not the usual case). */
  spawnGraceS: 20,
  /** After a revive: 5 s in which no ghost can kill the player. */
  protectionS: 5,
  /** A touch must last this long (0.3 s = 6 ticks): a ghost brushing past a sprinting player does not kill. */
  contactS: 0.3,
  /** The retry limit of the one-per-few-ticks drop of a dead player's items (the item system allows one intent every 4 ticks, so 80 attempts = 16 items). */
  dropAttempts: 80,
  /** Events kept per stage (a ring: the oldest fall off). */
  maxEvents: 300,
} as const;

export interface DeathTuning {
  /** Easy and Intermediate: a body (PlayerLife `downed`) for `reviveWindowTicks`. Hardcore: straight to `eliminated`. */
  revivable: boolean;
  reviveWindowTicks: number;
  satiatedTicks: number;
  spawnGraceTicks: number;
  protectionTicks: number;
  contactTicks: number;
  dropAttempts: number;
}

const ticks = (s: number): number => Math.round(s * SERVER_TICK_HZ);

/** `stage` is accepted so a caller never has to know the numbers do not depend on it (tests pin stages 1 and 1,000,000). */
export function deathTuning(difficulty: Difficulty, _stage = 1): DeathTuning {
  const T = DEATH_TABLE;
  const revivable = difficulty !== 'hardcore';
  return {
    revivable,
    reviveWindowTicks: revivable ? ticks(T.reviveWindowS) : 0,
    satiatedTicks: ticks(T.satiatedS),
    spawnGraceTicks: ticks(T.spawnGraceS),
    protectionTicks: ticks(T.protectionS),
    contactTicks: Math.max(1, ticks(T.contactS)),
    dropAttempts: T.dropAttempts,
  };
}

/**
 * P4 step 3: reviving. A teammate who carries the Revive Cell holds E next to a body for `holdTicks`; the same numbers on every stage and mode
 * (only Easy and Intermediate have a Revive Cell at all). Not a difficulty curve: pinned at stages 1 and 1,000,000 by a test.
 */
export const REVIVE = {
  /** E held for 3 s (60 ticks), without a break. */
  holdTicks: 60,
  /** How close (px) the reviver must stand to the body, and the vertical slack. */
  range: 70,
  dy: 60,
} as const;
