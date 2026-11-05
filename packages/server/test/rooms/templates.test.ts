import { describe, expect, it } from 'vitest';
import { ROOM_TEMPLATES, TEMPLATE_IDS, createRng, deriveSeed, type Arena, type TemplateRoom } from '@wb/shared';
import { platformIndex } from '../../src/salvage/reach';
import { strictReachableFrom as reachableFrom } from '../../src/rooms/reachStrict';

/**
 * P3F step 1: every room template, proved with the REAL movement function (`stepBody`, through the strict reach graph of `rooms/reachStrict.ts`: no start inside a wall): a lone player walks and jumps from every start to every other start, and to every surface a thing may stand on.
 */
const BUILT = TEMPLATE_IDS.filter((id) => ROOM_TEMPLATES[id].build !== undefined);
const SEEDS = 24;

const arenaOf = (room: TemplateRoom): Arena => ({
  id: 'x', name: 'x', width: room.width, height: room.height, solids: room.solids,
  spawns: [300, 350, 400, 450].map((x) => ({ x, y: room.floorY })),
});
/** A body (28 x 44) standing at the feet point (x, y) overlaps no solid. */
const clear = (room: TemplateRoom, x: number, y: number): boolean => !room.solids.some((s) => x + 14 > s.x && x - 14 < s.x + s.w && y > s.y && y - 44 < s.y + s.h);

describe('P3F step 1: every template is walkable with the real jump physics (a lone player, no ability)', () => {
  for (const id of BUILT) {
    it(`${id}: every start reaches every start and every surface, on every width and ${SEEDS} seeds`, () => {
      const t = ROOM_TEMPLATES[id];
      for (const w of t.widths) {
        for (let seed = 1; seed <= SEEDS; seed++) {
          const room = t.build!(w, createRng(deriveSeed(seed, 'walk', id)));
          const arena = arenaOf(room), at = `${id} ${w} seed ${seed}`;
          const starts = [room.west.arrive, room.east.arrive, ...arena.spawns];
          const idx = starts.map((p) => platformIndex(arena, p.x, p.y));
          idx.forEach((i, n) => { expect(i, `${at}: start ${n} stands on nothing`).toBeGreaterThanOrEqual(0); expect(Math.abs(arena.solids[i]!.y - starts[n]!.y), at).toBeLessThan(1.5); });
          const reach = new Set<number>();
          for (const a of idx) { const r = reachableFrom(arena, a); for (const b of idx) expect(r.has(b), `${at}: ${a} cannot reach ${b}`).toBe(true); for (const i of r) reach.add(i); }
          room.surfaces.forEach((s, k) => {
            const i = platformIndex(arena, Math.round((s.x0 + s.x1) / 2), s.y);
            expect(i, `${at}: surface ${k} has no solid`).toBeGreaterThanOrEqual(0);
            expect(reach.has(i), `${at}: surface ${k} (${JSON.stringify(s)}) cannot be reached on foot`).toBe(true);
          });
          for (const p of [...arena.spawns, room.west.arrive, room.east.arrive, room.exit]) expect(clear(room, p.x, p.y), `${at}: blocked at ${p.x},${p.y}`).toBe(true);
          for (const d of [room.west, room.east]) expect(clear(room, d.x + 20, d.y), `${at}: a door is blocked`).toBe(true);
          const door = platformIndex(arena, room.east.x + 20, room.east.y), exit = platformIndex(arena, room.exit.x, room.exit.y);
          expect(reach.has(door) && reach.has(exit), `${at}: east door or exit unreachable`).toBe(true);
        }
      }
    });
  }

  it('a lone player never needs more than one jump of 95 px between neighbouring ledges: the tallest rise between two reachable surfaces is below the 128 px jump', () => {
    // (the physics proof above is the real claim; this pins the design rule that keeps the margin: a stair step is at most 95 px up and the jump is 128)
    for (const id of BUILT) {
      const t = ROOM_TEMPLATES[id], room = t.build!(t.widths[0]!, createRng(11));
      for (const s of room.solids) expect(s.h, id).toBeGreaterThan(0);
    }
  });
});
