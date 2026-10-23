import type { Difficulty } from '../difficulty';
import { LIGHT_REFERENCE_REACH } from './limits';
import type { RoomDef } from './schemas';

/**
 * P3D step 4: what a player can see. Pure functions, shared by the server (which decides what is PUBLISHED to a player) and the
 * client (which sizes the light to match). A thing is in view when it is in the viewer's own room, within `visionRadius` of the
 * viewer's eye, and the straight line from the eye to it crosses no solid and no CLOSED door. Rooms never see into each other: a
 * room is its own space, so another room (and everything in it) is never in view.
 */
export const VISION_TABLE: Readonly<Record<Difficulty, { readonly base: number; readonly floor: number }>> = {
  easy: { base: LIGHT_REFERENCE_REACH, floor: 340 },
  intermediate: { base: 430, floor: 320 },
  hardcore: { base: 400, floor: 300 },
};
export const VISION_DROP_PER_STAGE = 1;

/** Vision (and flashlight) reach in px for a stage: shrinks by one px per stage from the mode's base, never below its floor. */
export function visionRadius(difficulty: Difficulty, stage: number): number {
  const t = VISION_TABLE[difficulty];
  const s = Number.isFinite(stage) ? Math.max(1, Math.floor(stage)) : 1;
  return Math.max(t.floor, t.base - (s - 1) * VISION_DROP_PER_STAGE);
}

/** Height of the eye above the feet (chest), the same point the flashlight starts from. */
export const EYE_HEIGHT = 28;

/**
 * Height above the floor of the point a thing is seen at (the same numbers the server uses to decide what to publish and what an
 * action may touch, so "visible" means one thing everywhere).
 */
export const POINT_HEIGHT = { player: 28, item: 12, stash: 20, keypad: 40, safe: 25, clue: 12, switch: 8, exit: 50 } as const;

export interface Pt { x: number; y: number }
export interface Box { x: number; y: number; w: number; h: number }

/** Does the segment a-b pass through the INTERIOR of the box? Grazing an edge does not count (Liang-Barsky on a box shrunk by 0.5 px). */
export function segmentHitsBox(a: Pt, b: Pt, box: Box): boolean {
  const e = 0.5;
  const minX = box.x + e, maxX = box.x + box.w - e, minY = box.y + e, maxY = box.y + box.h - e;
  if (minX >= maxX || minY >= maxY) return false;
  let t0 = 0, t1 = 1;
  const dx = b.x - a.x, dy = b.y - a.y;
  const clip = (p: number, q: number): boolean => {
    if (p === 0) return q >= 0; // parallel: inside the slab or never
    const r = q / p;
    if (p < 0) { if (r > t1) return false; if (r > t0) t0 = r; } else { if (r < t0) return false; if (r < t1) t1 = r; }
    return true;
  };
  return clip(-dx, a.x - minX) && clip(dx, maxX - a.x) && clip(-dy, a.y - minY) && clip(dy, maxY - a.y) && t0 <= t1;
}

/** Everything that blocks sight in a room: its solids and its closed doors (a door the target itself belongs to is ignored). */
export function occluders(room: RoomDef, openDoorIds: ReadonlySet<string>, ignoreDoorId?: string): Box[] {
  const out: Box[] = room.arena.solids.map((s) => ({ x: s.x, y: s.y, w: s.w, h: s.h }));
  for (const d of room.doors) if (!openDoorIds.has(d.id) && d.id !== ignoreDoorId) out.push({ x: d.x, y: d.y, w: d.w, h: d.h });
  return out;
}

export function hasLineOfSight(eye: Pt, target: Pt, blockers: readonly Box[]): boolean {
  for (const b of blockers) if (segmentHitsBox(eye, target, b)) return false;
  return true;
}

/** Is `target` (a point in `room`) in view of an eye in the same room? Radius first (cheap), then line of sight. */
export function pointVisible(room: RoomDef, eye: Pt, target: Pt, openDoorIds: ReadonlySet<string>, radius: number, ignoreDoorId?: string): boolean {
  if (Math.hypot(target.x - eye.x, target.y - eye.y) > radius) return false;
  return hasLineOfSight(eye, target, occluders(room, openDoorIds, ignoreDoorId));
}
