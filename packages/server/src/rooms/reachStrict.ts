import { PLAYER_HEIGHT, PLAYER_WIDTH, spawnBody, stepBody, type Arena, type PlayerBody } from '@wb/shared';
import { canonicalArena } from './arenaKey';

/**
 * P3F step 1: the STRICT platform graph. Same idea as `salvage/reach.ts` (run the real movement function from sampled start points and see where a player lands), with one
 * difference that matters in rooms with walls and tall blocks: a start point whose body box overlaps another solid is NOT a start (the body would stand inside a wall, and
 * the physics pushes it out onto the wall's top, which makes a jump that no player can make). Everything in this graph is a move a player can really do.
 * It is still a lower bound (a move needing a long run-up or pixel timing may be missing); a move in the graph is always possible.
 */
const START_STEP = 16, RUN_UP_TICKS = [0, 4, 8], MAX_TICKS = 50, LAND_SLACK = PLAYER_WIDTH / 2, HALF = PLAYER_WIDTH / 2;
/** A sampled run or jump cannot carry a body further than this sideways (50 ticks at 13 px, plus the slack): a start with no edge and no other platform inside it lands on the same platform. */
const REACH_X = 50 * 13 + 40;
/** A jump (about 0.76 s at 260 px/s, after at most 8 ticks of run-up) cannot cover more than this sideways. */
const JUMP_X = 340;

export interface StrictGraph { readonly edges: ReadonlyArray<ReadonlySet<number>> }
const cache = new WeakMap<Arena, StrictGraph>();

const platformUnder = (arena: Arena, b: PlayerBody): number =>
  arena.solids.findIndex((s) => Math.abs(s.y - b.y) < 1.5 && b.x >= s.x - LAND_SLACK && b.x <= s.x + s.w + LAND_SLACK);

/** Does a body standing with its feet at (x, y) overlap any solid? */
const inSolid = (arena: Arena, x: number, y: number): boolean =>
  arena.solids.some((s) => x + HALF > s.x && x - HALF < s.x + s.w && y > s.y && y - PLAYER_HEIGHT < s.y + s.h);

export function strictGraph(given: Arena): StrictGraph {
  const arena = canonicalArena(given);
  const hit = cache.get(arena);
  if (hit) return hit;
  const edges = arena.solids.map(() => new Set<number>());
  arena.solids.forEach((from, a) => {
    for (let x = from.x; x <= from.x + from.w + 1e-9; x += START_STEP) {
      const sx = Math.min(x, from.x + from.w);
      if (inSolid(arena, sx, from.y)) continue;
      for (const dir of [-1, 1] as const) {
        // nothing to find in this direction unless another platform lies within what a run (walking off an edge) or a jump can cover
        const other = (d: number) => arena.solids.some((o, k) => k !== a && (dir === 1 ? o.x + o.w >= sx && o.x <= sx + d : o.x <= sx && o.x + o.w >= sx - d));
        const canWalk = Math.abs((dir === 1 ? from.x + from.w : from.x) - sx) <= REACH_X && other(REACH_X), canJump = other(JUMP_X);
        if (!canWalk && !canJump) continue;
        for (const jump of [false, true]) {
          if (jump ? !canJump : !canWalk) continue;
          for (const runUp of jump ? RUN_UP_TICKS : [0]) {
            const body = spawnBody(sx, from.y);
            stepBody(body, { moveX: 0, jump: false }, arena);
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
  const g: StrictGraph = { edges };
  cache.set(arena, g);
  return g;
}

/** Platforms reachable from `start` (inclusive) over the strict graph. */
export function strictReachableFrom(arena: Arena, start: number): Set<number> {
  const g = strictGraph(arena), seen = new Set<number>([start]), queue = [start];
  while (queue.length > 0) for (const b of g.edges[queue.pop()!] ?? []) if (!seen.has(b)) { seen.add(b); queue.push(b); }
  return seen;
}
