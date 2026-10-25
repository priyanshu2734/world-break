/**
 * P3E step 2: URL flags for trying the ghost in a browser (client only; the server decides everything).
 *   ?ghost=1       create a ghost-enabled escape run starting at stage 2 (the first stage that can have a ghost)
 *   ?ghost=N       start at stage N (2 to 99; 7 = the Shade, 12 = the Howler when those are built)
 *   ?reduceflash=1 no flicker: the WARNING light change becomes a slow gentle dim
 *   ?mute=1        start with the ghost sounds muted (M toggles in game)
 * Only the host's join creates the room, so the flag is sent only when no room code is given (the session handles that).
 */
export const GHOST_MIN_STAGE = 2;
export const GHOST_MAX_STAGE = 99;

/** The stage to start at, or null when the ghost flag is absent or invalid. `?ghost=1` means "on, from the first possible stage". */
export function ghostRequested(search: string): number | null {
  const raw = new URLSearchParams(search).get('ghost');
  if (raw === null || !/^\d{1,3}$/.test(raw.trim())) return null;
  const n = Number(raw);
  if (n < 1) return null;
  return Math.min(GHOST_MAX_STAGE, Math.max(GHOST_MIN_STAGE, n));
}

export interface GhostClientFlags { reduceFlash: boolean; muted: boolean }
export function ghostFlags(search: string): GhostClientFlags {
  const q = new URLSearchParams(search);
  return { reduceFlash: q.get('reduceflash') === '1', muted: q.get('mute') === '1' };
}
