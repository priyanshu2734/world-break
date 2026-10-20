import type { Arena } from '@wb/shared';

/** Tolerance (px) for a point that is a hair below a surface (feet sunk by rounding). */
const REST_SLACK = 2;

/** The solid whose top surface is the first one at or below (x, y), or null if there is none under x. */
export function surfaceBelow(arena: Arena, x: number, y: number): { x: number; y: number; w: number; h: number } | null {
  let best: { x: number; y: number; w: number; h: number } | null = null;
  for (const s of arena.solids) {
    if (x < s.x || x > s.x + s.w || s.y < y - REST_SLACK) continue;
    if (best === null || s.y < best.y) best = s;
  }
  return best;
}

/**
 * Deterministic resting height of an item released at (x, y): the top of the first platform at or below it.
 * Pure function of the arena (no physics, no randomness). Falls to the arena bottom if nothing is under x.
 */
export function restY(arena: Arena, x: number, y: number): number {
  const s = surfaceBelow(arena, x, y);
  return s ? s.y : arena.height;
}

/** Clamp to the arena's width (a released item never leaves the arena sideways). */
export const clampX = (arena: Arena, x: number): number => Math.max(0, Math.min(arena.width, x));

/** True if (x, y) is a feet position standing on a platform surface. */
export function hasFooting(arena: Arena, x: number, y: number): boolean {
  return arena.solids.some((s) => Math.abs(s.y - y) < 1.5 && x >= s.x && x <= s.x + s.w);
}
