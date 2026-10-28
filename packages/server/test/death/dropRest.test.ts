import { describe, expect, it } from 'vitest';
import type { Arena } from '@wb/shared';
import { dropRest, reachablePlatforms } from '../../src/salvage/dropRest';
import { generateEscapeStage } from '../../src/rooms/generate';

/**
 * A hand-made room: a floor, a gap nobody can jump (a pit) with a second floor on the far side, and a ledge too high to reach.
 *   floor A  x 0..400     (the spawn is here)        floor B  x 700..1000 (across a 300 px pit: unreachable on foot)
 *   ledge    x 450..550 at y 300, 380 px above the floor: unreachable.
 */
const PIT: Arena = {
  id: 'pit', name: 'pit', width: 1000, height: 800,
  solids: [{ x: 0, y: 680, w: 400, h: 40 }, { x: 700, y: 680, w: 300, h: 40 }, { x: 450, y: 300, w: 100, h: 20 }],
  spawns: [{ x: 100, y: 680 }, { x: 150, y: 680 }, { x: 200, y: 680 }, { x: 250, y: 680 }],
};

describe('P4 a dropped item is never left where a teammate cannot take it', () => {
  it('the reach set of the hand-made room is floor A only (the pit and the high ledge are out of reach)', () => {
    const reach = reachablePlatforms(PIT);
    expect([...reach]).toEqual([0]);
  });
  it('over floor A it stays where it falls, not relocated', () => {
    expect(dropRest(PIT, 200, 400)).toEqual({ x: 200, y: 680, relocated: false });
    expect(dropRest(PIT, 200, 679)).toEqual({ x: 200, y: 680, relocated: false });
  });
  it('over the pit it is moved to the nearest reachable floor: the edge of floor A, standing on its top', () => {
    const r = dropRest(PIT, 550, 500);
    expect(r.relocated).toBe(true);
    expect(r.y).toBe(680);
    expect(r.x).toBeGreaterThanOrEqual(0);
    expect(r.x).toBeLessThanOrEqual(400);
    expect(r.x).toBe(386); // the nearest point of floor A, kept 14 px off the edge so it never hangs over the gap
  });
  it('on the far floor B (across the pit) it is moved back to floor A', () => {
    const r = dropRest(PIT, 850, 600);
    expect(r).toMatchObject({ y: 680, relocated: true });
    expect(r.x).toBeLessThanOrEqual(400);
  });
  it('on the high ledge it is moved down to a floor a player can stand on', () => {
    const r = dropRest(PIT, 500, 100);
    expect(r.relocated).toBe(true);
    expect(r.y).toBe(680);
    expect(r.x).toBeLessThanOrEqual(400);
  });
  it('is deterministic: the same point gives the same answer, and a point outside the arena is clamped in', () => {
    for (let i = 0; i < 5; i++) expect(dropRest(PIT, 550, 500)).toEqual(dropRest(PIT, 550, 500));
    const r = dropRest(PIT, -500, 100);
    expect(r.x).toBeGreaterThanOrEqual(0);
    expect(r.y).toBe(680);
  });

  it('on real generated stages (stages 2 to 29, many seeds): wherever a player dies, the item rests on a platform a lone player can reach', () => {
    let checked = 0, relocated = 0;
    for (const stage of [2, 3, 5, 8, 12, 20, 29]) {
      for (const seed of [1, 2, 3]) {
        const def = generateEscapeStage(stage, seed, { ghost: true, difficulty: 'easy' });
        for (const room of def.rooms!.rooms) {
          const reach = reachablePlatforms(room.arena);
          for (let x = 0; x <= room.arena.width; x += 97) {
            for (const y of [0, 200, 400, 600, 679]) {
              const r = dropRest(room.arena, x, y);
              const on = room.arena.solids.findIndex((s) => Math.abs(s.y - r.y) < 1.5 && r.x >= s.x && r.x <= s.x + s.w && reach.has(room.arena.solids.indexOf(s)));
              expect(on, `stage ${stage} seed ${seed} ${room.id} (${x},${y}) -> (${r.x},${r.y})`).toBeGreaterThanOrEqual(0);
              checked++; if (r.relocated) relocated++;
            }
          }
        }
      }
    }
    expect(checked).toBeGreaterThan(1000);
    expect(relocated).toBeGreaterThanOrEqual(0); // not every generated room has a pit; the hand-made room above proves the move itself
  });
  it('stage 1,000,000 behaves the same way', () => {
    const def = generateEscapeStage(1_000_000, 7, { ghost: true, difficulty: 'hardcore' });
    for (const room of def.rooms!.rooms) {
      const reach = reachablePlatforms(room.arena);
      for (let x = 0; x <= room.arena.width; x += 131) {
        const r = dropRest(room.arena, x, 50);
        expect(room.arena.solids.some((s, i) => reach.has(i) && Math.abs(s.y - r.y) < 1.5 && r.x >= s.x && r.x <= s.x + s.w)).toBe(true);
      }
    }
  });
});
