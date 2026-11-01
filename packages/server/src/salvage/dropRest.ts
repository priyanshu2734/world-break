import { PLAYER_HEIGHT, type Arena, type Rect } from '@wb/shared';
import { platformIndex } from './reach';
import { strictReachableFrom as reachableFrom } from '../rooms/reachStrict';
import { canonicalArena } from '../rooms/arenaKey';
import { clampX, restY, surfaceBelow } from './rest';

/**
 * P4: where an item released at (x, y) comes to rest, with the rule that a dropped item is NEVER left where a teammate cannot take it.
 *
 * The old rule (`restY`) lets an item fall to the first platform at or below the point, or to the arena's bottom edge when nothing is under it.
 * Over a pit (or on a ledge no lone player can reach) that is a spot nobody can walk to, and a part the stage needs would be lost for good.
 * So an item rests where it falls ONLY when that platform is reachable on foot for one player starting from the room's spawn slots
 * (the same physics-based graph the validators use). Otherwise it is moved to the NEAREST reachable platform, standing on its top surface.
 *
 * P3F step 1: the rule now also knows WALLS and GATES.
 *   * A platform is cut where a solid stands on it and reaches up past a body (a gate wall from floor to ceiling, a crate): the pieces are what is
 *     reachable, so a floor with a closed gate wall across it is TWO floors, and only the spawn side counts. An item is therefore never moved across a
 *     closed gate (the wall is not a door; the gate's own doors are the only way over it, and a dropped item does not use them).
 *   * A point INSIDE a solid (the thickness of a wall, the body of a crate) is not a place an item can rest: it is relocated like any other bad spot.
 *   * A dropper who stands on (or above) a piece that a wall cut off (the alcove behind an OPEN gate) keeps what they drop there: the gate being open is the only
 *     way they got there.
 * `reachablePlatforms` (below) keeps its old meaning (platform level, walls ignored); the new rule is the stricter `reachablePieces`.
 *
 * Pure and deterministic: a function of the arena and the point, no randomness, no clock. Ties go to the lowest platform index.
 */
export interface DropRest { x: number; y: number; /** true when the item did not stay where it fell. */ relocated: boolean }

/** Keep a relocated item this far from a platform's edge so it never hangs over the gap. */
const EDGE_MARGIN = 14;
/** Pieces narrower than this cannot hold anything. */
const MIN_PIECE = 8;
/** A piece stops this far short of the wall or crate that cut it, so no sampled start of the reach graph lies inside the solid (half a body, plus one px). */
const CUT_INSET = 15;

const reachCache = new WeakMap<Arena, ReadonlySet<number>>();

/** Indices of the platforms a lone player can stand on, walking and jumping from the room's spawn slots (empty if no spawn stands on a platform). Walls are ignored (see `reachablePieces`). */
export function reachablePlatforms(given: Arena): ReadonlySet<number> {
  const arena = canonicalArena(given);
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

/** The arena with every platform cut where a solid stands on it and reaches past a body's head; `parent[i]` is the solid of the ORIGINAL arena that piece i came from. */
export interface Pieces { arena: Arena; parent: readonly number[] }

const piecesCache = new WeakMap<Arena, Pieces>();

/** Does `w` stand in the way of a body walking along the top of `p`? (It overlaps the platform in x, rises above its top and reaches down into the body's height.) */
const blocksWalking = (p: Rect, w: Rect): boolean =>
  w !== p && w.x < p.x + p.w && w.x + w.w > p.x && w.y < p.y && w.y + w.h > p.y - PLAYER_HEIGHT;

export function piecesOf(given: Arena): Pieces {
  const arena = canonicalArena(given);
  const hit = piecesCache.get(arena);
  if (hit) return hit;
  const solids: Rect[] = [];
  const parent: number[] = [];
  arena.solids.forEach((p, i) => {
    const cutters = arena.solids.filter((w) => blocksWalking(p, w)).sort((a, b) => a.x - b.x);
    if (cutters.length === 0) { solids.push(p); parent.push(i); return; }
    let at = p.x;
    const emit = (x0: number, x1: number) => { if (x1 - x0 >= MIN_PIECE) { solids.push({ x: x0, y: p.y, w: x1 - x0, h: p.h }); parent.push(i); } };
    for (const c of cutters) { emit(at, Math.min(c.x - CUT_INSET, p.x + p.w)); at = Math.max(at, c.x + c.w + CUT_INSET); }
    emit(at, p.x + p.w);
  });
  const out: Pieces = { arena: { ...arena, solids }, parent };
  piecesCache.set(arena, out);
  return out;
}

/** Indices (into `piecesOf(arena).arena.solids`) of the pieces a lone player reaches on foot from the spawn slots, a wall in the way counted. */
export function reachablePieces(given: Arena): ReadonlySet<number> {
  const arena = canonicalArena(given);
  const { arena: a } = piecesOf(arena);
  const out = new Set<number>();
  for (const sp of arena.spawns) {
    const start = platformIndex(a, sp.x, sp.y);
    if (start < 0) continue;
    for (const i of reachableFrom(a, start)) out.add(i);
  }
  return out;
}

/** A solid at least this thick is a body (a wall, a crate, a deck), not a ledge or a floor slab: a point inside one is no place a thing can rest. (A point inside a thin ledge falls through it, as before.) */
const BODY_MIN_H = 60;
/** True when (x, y) is strictly inside a wall, crate or deck (not on its top face). */
export const insideBody = (arena: Arena, x: number, y: number): boolean =>
  arena.solids.some((s) => s.h >= BODY_MIN_H && x > s.x && x < s.x + s.w && y > s.y + 2 && y < s.y + s.h - 1);

export function dropRest(arena: Arena, x: number, y: number): DropRest {
  const cx = clampX(arena, x);
  const plain = reachablePlatforms(arena);
  // a room with no walkable platform at all keeps the old rule (there is nothing better to offer)
  if (plain.size === 0) return { x: cx, y: restY(arena, cx, y), relocated: false };
  const { arena: a, parent } = piecesOf(arena);
  const reach = new Set(reachablePieces(arena));
  const body = insideBody(arena, cx, y);
  let under = body ? null : surfaceBelow(a, cx, y);
  // The band right beside a wall or crate (where a body cannot stand but a part may lie) belongs to the piece next to it.
  if (!body && !under) {
    const level = surfaceBelow(arena, cx, y), levelIdx = level ? arena.solids.indexOf(level as never) : -1;
    if (levelIdx >= 0) a.solids.forEach((s, k) => { if (!under && parent[k] === levelIdx && cx >= s.x - CUT_INSET && cx <= s.x + s.w + CUT_INSET) under = s; });
  }
  // A part released over a piece a wall cut off (the alcove behind an OPEN gate) stays there: whoever released it is in that alcove, so the way is open. (Over the wall itself,
  // or inside it, there is no such piece: the part goes back to the near side.)
  if (under) {
    const k = a.solids.indexOf(under as never);
    if (k >= 0 && !reach.has(k) && plain.has(parent[k]!)) for (const i of reachableFrom(a, k)) if (plain.has(parent[i]!)) reach.add(i);
  }
  if (under && reach.has(a.solids.indexOf(under as never))) return { x: cx, y: under.y, relocated: false };
  let best = -1, bestD = Infinity, bestX = cx;
  a.solids.forEach((s, i) => {
    if (!reach.has(i)) return;
    const m = Math.min(EDGE_MARGIN, s.w / 2);
    const px = Math.max(s.x + m, Math.min(s.x + s.w - m, cx));
    const d = Math.hypot(px - cx, s.y - y);
    if (d < bestD - 1e-9) { best = i; bestD = d; bestX = px; }
  });
  if (best < 0) return { x: cx, y: restY(arena, cx, y), relocated: false };
  const s = a.solids[best]!;
  return { x: bestX, y: s.y, relocated: true };
}
