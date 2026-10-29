import type { Arena } from '@wb/shared';
import { platformIndex, reachableFrom } from './reach';
import { clampX, restY, surfaceBelow } from './rest';

/**
 * P4: where an item released at (x, y) comes to rest, with the rule that a dropped item is NEVER left where a teammate cannot take it.
 *
 * The old rule (`restY`) lets an item fall to the first platform at or below the point, or to the arena's bottom edge when nothing is under it.
 * Over a pit (or on a ledge no lone player can reach) that is a spot nobody can walk to, and a part the stage needs would be lost for good.
 * So an item rests where it falls ONLY when that platform is reachable on foot for one player starting from the room's spawn slots
 * (the same physics-based graph the validators use). Otherwise it is moved to the NEAREST reachable platform, standing on its top surface.
 *
 * Pure and deterministic: a function of the arena and the point, no randomness, no clock. Ties go to the lowest platform index.
 */
export interface DropRest { x: number; y: number; /** true when the item did not stay where it fell. */ relocated: boolean }

/** Keep a relocated item this far from a platform's edge so it never hangs over the gap. */
const EDGE_MARGIN = 14;

const reachCache = new WeakMap<Arena, ReadonlySet<number>>();

/** Indices of the platforms a lone player can stand on, walking and jumping from the room's spawn slots (empty if no spawn stands on a platform). */
export function reachablePlatforms(arena: Arena): ReadonlySet<number> {
  const hit = reachCache.get(arena);
  if (hit) return hit;
  const out = new Set<number>();
  for (const sp of arena.spawns) {
    const start = platformIndex(arena, sp.x, sp.y);
    if (start < 0) continue;
    for (const i of reachableFrom(arena, start)) out.add(i);
  }
  reachCache.set(arena, out);
  return out;
}

export function dropRest(arena: Arena, x: number, y: number): DropRest {
  const cx = clampX(arena, x);
  const reach = reachablePlatforms(arena);
  // a room with no walkable platform at all keeps the old rule (there is nothing better to offer)
  if (reach.size === 0) return { x: cx, y: restY(arena, cx, y), relocated: false };
  const under = surfaceBelow(arena, cx, y);
  if (under && reach.has(arena.solids.indexOf(under as never))) return { x: cx, y: under.y, relocated: false };
  let best = -1, bestD = Infinity, bestX = cx;
  arena.solids.forEach((s, i) => {
    if (!reach.has(i)) return;
    const m = Math.min(EDGE_MARGIN, s.w / 2);
    const px = Math.max(s.x + m, Math.min(s.x + s.w - m, cx));
    const d = Math.hypot(px - cx, s.y - y);
    if (d < bestD - 1e-9) { best = i; bestD = d; bestX = px; }
  });
  const s = arena.solids[best]!;
  return { x: bestX, y: s.y, relocated: true };
}
