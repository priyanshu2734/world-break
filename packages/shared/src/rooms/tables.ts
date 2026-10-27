import type { Difficulty } from '../difficulty';
import { MOVE_SPEED, TICK_DT } from '../sim';
import type { LockType } from './escape';
import { ROOM_LIMITS } from './limits';

/**
 * P3D step 5: the stage tables of the escape generator (GAMEPLAY.md section 4). Pure and bounded: nothing here grows with the stage
 * number beyond the caps, so the game is endless without ever making a stage bigger than the 6-room cap.
 */

/** Rooms in the chain for a stage: 1-2: 1, 3-6: 2, 7-14: 3, 15-24: 4, 25-39: 5, 40+: 6 (the hard cap). */
export function roomCountForStage(stage: number): number {
  const s = Number.isFinite(stage) ? Math.max(1, Math.floor(stage)) : 1;
  if (s <= 2) return 1;
  if (s <= 6) return 2;
  if (s <= 14) return 3;
  if (s <= 24) return 4;
  if (s <= 39) return 5;
  return ROOM_LIMITS.maxRooms;
}

/** The lock types a stage may use (teach one thing at a time): key first, then code, power, two-person, safe. */
export function locksForStage(stage: number): readonly LockType[] {
  const s = Number.isFinite(stage) ? Math.max(1, Math.floor(stage)) : 1;
  if (s <= 1) return ['key_item'];
  if (s <= 2) return ['key_item', 'code'];
  if (s <= 5) return ['key_item', 'code', 'power'];
  if (s <= 9) return ['key_item', 'code', 'power', 'two_person'];
  return ['key_item', 'code', 'power', 'two_person', 'safe'];
}

/** Decoys (a cracked look-alike key or battery, a note with no digits) start on stage 2; stage 1 has none. */
export function decoysForStage(stage: number): number {
  const s = Number.isFinite(stage) ? Math.max(1, Math.floor(stage)) : 1;
  return s <= 1 ? 0 : s <= 6 ? 1 : 2;
}

/** Ghost hiding spots per room (placeholders for P3E; inert in P3D): none on the tutorial, then 1 to 2 per room. */
export function hidingSpotsForStage(stage: number): number {
  const s = Number.isFinite(stage) ? Math.max(1, Math.floor(stage)) : 1;
  return s <= 1 ? 0 : s <= 14 ? 1 : 2;
}

/** The tutorial is lit more than any other stage: its ambient is never below this fraction, whatever the mode. */
export const TUTORIAL_AMBIENT_MIN = 0.45;

// ---------------------------------------------------------------------------------------------------------------------------
// P3E: THE GHOST TUNING TABLE. Every number of the ghost that scales with the stage or the mode lives here, and nowhere else
// (docs/GHOST.md mirrors it). Pure and bounded: each curve is linear in the (mode-scaled) stage and then stops at its cap, so stage
// 1,000,000 is the same stage as stage 100. Times are SERVER TICKS (20 Hz); the table is written in seconds and converted.
// ---------------------------------------------------------------------------------------------------------------------------

/** How fast the curves move per mode (GAMEPLAY.md section 6: "Mode scales severity (how fast the curves move), stage scales complexity"). */
export const GHOST_MODE_RATE: Readonly<Record<Difficulty, number>> = { easy: 1, intermediate: 1.5, hardcore: 2 };

export const GHOST_TABLE = {
  /** Stages 1 and 2 sit on the starting values; the curves start moving after stage 2 (`progress` below). */
  flatUntilStage: 2,
  /** Ghost speed as a share of the player's sprint (`MOVE_SPEED`): 70 percent, +0.5 percent per stage, never above 95 percent. */
  speedStart: 0.70, speedPerStage: 0.005, speedCap: 0.95,
  /** Seconds between a ghost leaving and its next WARNING: 120 s down to a floor of 40 s. */
  intervalStartS: 120, intervalDropS: 1.5, intervalFloorS: 40,
  /** Seconds a hit from the Pulse Gun stuns it: 150 s down to a floor of 45 s. */
  stunStartS: 150, stunDropS: 2, stunFloorS: 45,
  /** P3E step 5, Pulse Gun v2: seconds before the (reusable) gun can fire again: 30 s, +1 s per stage (the mode scales how fast), capped at 90 s. */
  gunCooldownStartS: 30, gunCooldownPerStageS: 1, gunCooldownCapS: 90,
  /** P3E step 5: seconds a ghost destroyed by the gun stays gone before its WARNING: 150 s, -2 s per stage, floor 45 s. */
  respawnStartS: 150, respawnDropS: 2, respawnFloorS: 45,
  /** P3E step 5: one ghost at a time until this stage, then two, and never more than `maxGhosts`. */
  secondGhostFromStage: 20, maxGhosts: 2,
  /** Hearing range in px for a RUNNING player (quieter sounds are a fraction of it): small at first, grows to a cap. */
  hearingStartPx: 300, hearingPerStagePx: 5, hearingCapPx: 560,
  /** Hiding spots per room: 4 at the start, one fewer every `hidingStagesPerSpot` progress points, never fewer than 1. */
  hidingStart: 4, hidingFloor: 1, hidingStagesPerSpot: 8,
} as const;

/** `stage` made safe (an integer of at least 1) and scaled by the mode: how far along the curves this stage is. Stage 1 and 2 are 0. */
export function ghostProgress(difficulty: Difficulty, stage: number): number {
  const s = Number.isFinite(stage) ? Math.max(1, Math.floor(stage)) : 1;
  return Math.max(0, s - GHOST_TABLE.flatUntilStage) * GHOST_MODE_RATE[difficulty];
}

export interface GhostTuning {
  /** Share of the player's sprint speed (0.70 to 0.95). */
  speedFrac: number;
  /** The same speed in px per server tick (what the server moves the ghost by). */
  speedPxPerTick: number;
  /** Ticks between a ghost leaving and its next warning. */
  intervalTicks: number;
  /** Ticks a Pulse Gun hit stuns it. */
  stunTicks: number;
  /** P3E step 5: ticks the Pulse Gun needs between two shots (30 s at stage 2, +1 s per stage, cap 90 s). */
  gunCooldownTicks: number;
  /** P3E step 5: ticks a ghost destroyed by the gun stays gone before its warning (150 s, -2 s per stage, floor 45 s). */
  respawnTicks: number;
  /** P3E step 5: ghosts at once (1, or 2 from stage 20). */
  ghostCount: number;
  /** Hearing range of a RUNNING player, px. */
  hearingPx: number;
  /** Hiding spots a room should hold at this stage (the generator reads it in P3E step 5). */
  hidingSpotsPerRoom: number;
}

export function ghostTuning(difficulty: Difficulty, stage: number): GhostTuning {
  const T = GHOST_TABLE, p = ghostProgress(difficulty, stage);
  const speedFrac = Math.min(T.speedCap, T.speedStart + T.speedPerStage * p);
  const seconds = (start: number, drop: number, floor: number) => Math.max(floor, start - drop * p);
  return {
    speedFrac,
    speedPxPerTick: speedFrac * MOVE_SPEED * TICK_DT,
    intervalTicks: Math.round(seconds(T.intervalStartS, T.intervalDropS, T.intervalFloorS) / TICK_DT),
    stunTicks: Math.round(seconds(T.stunStartS, T.stunDropS, T.stunFloorS) / TICK_DT),
    gunCooldownTicks: Math.round(Math.min(T.gunCooldownCapS, T.gunCooldownStartS + T.gunCooldownPerStageS * p) / TICK_DT),
    respawnTicks: Math.round(seconds(T.respawnStartS, T.respawnDropS, T.respawnFloorS) / TICK_DT),
    ghostCount: ghostCountForStage(stage),
    hearingPx: Math.min(T.hearingCapPx, T.hearingStartPx + T.hearingPerStagePx * p),
    hidingSpotsPerRoom: Math.max(T.hidingFloor, T.hidingStart - Math.floor(p / T.hidingStagesPerSpot)),
  };
}

/** Ghosts alive at once: none on stage 1, one until `secondGhostFromStage`, then two. Never more (the table's `maxGhosts`). */
export function ghostCountForStage(stage: number): number {
  const s = Number.isFinite(stage) ? Math.floor(stage) : 1;
  return s < 2 ? 0 : s >= GHOST_TABLE.secondGhostFromStage ? GHOST_TABLE.maxGhosts : 1;
}

/** No ghost on stage 1 (the tutorial): it starts on stage 2 (GAMEPLAY.md section 6). */
export function ghostPresentOnStage(stage: number): boolean {
  return Number.isFinite(stage) && Math.floor(stage) >= 2;
}
