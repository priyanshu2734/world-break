import { ARENA, VIEW_HEIGHT, VIEW_WIDTH, getArena, type Arena, type RoomLayout } from '@wb/shared';

/** `?rooms=1` asks the server for the multi-room demo stage when it creates the room (dev flag; the server needs ESCAPE_STAGES on). */
export function roomsRequested(search: string): boolean { return new URLSearchParams(search).get('rooms') === '1'; }

/**
 * The arena for a room id: a built-in arena (Relay Platform 01, the Ability Lab) or the layout the server sent for that room.
 * `undefined` = not known yet (the server sends the layout of a room before, or together with, the first snapshot that names it).
 */
export function arenaForRoom(id: string, layouts: ReadonlyMap<string, RoomLayout>): Arena | undefined {
  return getArena(id) ?? layouts.get(id)?.arena;
}

/** The arena the local player should be simulated in: their room when the snapshot names one, else the stage arena. */
export function pickArena(roomId: string | undefined, stageArenaId: string, layouts: ReadonlyMap<string, RoomLayout>): Arena | undefined {
  if (roomId !== undefined) return arenaForRoom(roomId, layouts);
  return getArena(stageArenaId) ?? ARENA;
}

/**
 * Top-left of the camera for a focus point (the player's chest). The camera centres on the focus and stops at the room's edges,
 * so a room no bigger than the screen never scrolls. Whole pixels, so platform edges do not shimmer.
 */
export function cameraScroll(
  focus: { x: number; y: number },
  room: { width: number; height: number },
  view: { w: number; h: number } = { w: VIEW_WIDTH, h: VIEW_HEIGHT },
): { x: number; y: number } {
  const clamp = (v: number, hi: number) => Math.round(Math.min(Math.max(v, 0), Math.max(0, hi)));
  return { x: clamp(focus.x - view.w / 2, room.width - view.w), y: clamp(focus.y - view.h / 2, room.height - view.h) };
}

/** World to screen, for things drawn in screen space (the dark layer). */
export function toScreen(p: { x: number; y: number }, scroll: { x: number; y: number }): { x: number; y: number } {
  return { x: p.x - scroll.x, y: p.y - scroll.y };
}
