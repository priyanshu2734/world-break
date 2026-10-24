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
