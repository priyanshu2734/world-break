export const MIN_PLAYERS = 1;
export const MAX_PLAYERS = 4;
export const SERVER_TICK_HZ = 20;
export const ROOM_CODE_LENGTH = 4;
export const ROOM_CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

/** Highest stage a team must have reached to unlock each difficulty. */
export const DIFFICULTY_UNLOCK_STAGE = {
  easy: 1,
  intermediate: 10,
  hardcore: 20,
} as const;
