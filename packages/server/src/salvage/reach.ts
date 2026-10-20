import { spawnBody, stepBody, PLAYER_WIDTH, type Arena, type PlayerBody } from '@wb/shared';
import { surfaceBelow } from './rest';

/**
 * Which platforms can ONE player walk or jump between, unaided (no abilities, no crates)? Answered by running the REAL shared
 * physics (`stepBody`) from sampled start points, so the validator and the game can never disagree about a jump.
 * Used by the stage validator (P3C): every mandatory part and target must be reachable for a lone player.
 * This is a lower bound: a move that needs a long run-up or pixel-perfect timing may be missing from the graph (an author then has to
 * declare an ability gate or move the item). A move in the graph is always possible.
 */
const START_STEP = 16; // px between sampled start points along a platform
const RUN_UP_TICKS = [0, 4, 8]; // ticks of running before the jump
const MAX_TICKS = 50;
const LAND_SLACK = PLAYER_WIDTH / 2; // feet may overhang a platform edge by half the body

export interface PlatformGraph { readonly edges: ReadonlyArray<ReadonlySet<number>> }

const cache = new WeakMap<Arena, PlatformGraph>();

function platformUnder(arena: Arena, b: PlayerBody): number {
  return arena.solids.findIndex((s) => Math.abs(s.y - b.y) < 1.5 && b.x >= s.x - LAND_SLACK && b.x <= s.x + s.w + LAND_SLACK);
}

/** Directed graph: edges[a] holds every platform a player standing on `a` can land on. */
export function platformGraph(arena: Arena): PlatformGraph {
  const hit = cache.get(arena);
  if (hit) return hit;
  const edges = arena.solids.map(() => new Set<number>());
  arena.solids.forEach((from, a) => {
    for (let x = from.x; x <= from.x + from.w + 1e-9; x += START_STEP) {
      for (const dir of [-1, 1] as const) {
        for (const jump of [false, true]) {
          for (const runUp of jump ? RUN_UP_TICKS : [0]) {
            const body = spawnBody(Math.min(x, from.x + from.w), from.y);
            stepBody(body, { moveX: 0, jump: false }, arena); // settle onto the platform
            let airborne = false;
            for (let t = 0; t < MAX_TICKS; t++) {
              stepBody(body, { moveX: dir, jump: jump && t === runUp }, arena);
              if (!body.grounded) { airborne = true; continue; }
              if (!airborne) continue;
              const landed = platformUnder(arena, body);
              if (landed >= 0 && landed !== a) edges[a]!.add(landed);
              break;
            }
          }
        }
      }
    }
  });
  const g: PlatformGraph = { edges };
  cache.set(arena, g);
  return g;
}

/** Platforms reachable from `start` (inclusive). */
export function reachableFrom(arena: Arena, start: number): Set<number> {
  const g = platformGraph(arena);
  const seen = new Set<number>([start]);
  const queue = [start];
  while (queue.length > 0) {
    const a = queue.pop()!;
    for (const b of g.edges[a] ?? []) if (!seen.has(b)) { seen.add(b); queue.push(b); }
  }
  return seen;
}

/** Index of the platform an item or target at (x, y) rests on, or -1. */
export function platformIndex(arena: Arena, x: number, y: number): number {
  const s = surfaceBelow(arena, x, y);
  return s ? arena.solids.indexOf(s as never) : -1;
}
