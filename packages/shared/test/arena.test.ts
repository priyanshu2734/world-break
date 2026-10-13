import { describe, expect, it } from 'vitest';
import {
  ARENA, MAX_PLAYERS, PLAYER_HEIGHT, PLAYER_WIDTH, cloneBody, spawnBody, stepBody, type PlayerBody, type Rect,
} from '../src';

const HW = PLAYER_WIDTH / 2;

/** Index of the solid the body is standing on, or -1. */
function standingOn(b: PlayerBody): number {
  if (!b.grounded) return -1;
  return ARENA.solids.findIndex((r) => Math.abs(b.y - r.y) < 1e-6 && b.x + HW > r.x && b.x - HW < r.x + r.w);
}

describe('arena authoring', () => {
  it('has exactly one stable spawn per player slot, all distinct', () => {
    expect(ARENA.spawns).toHaveLength(MAX_PLAYERS);
    expect(new Set(ARENA.spawns.map((s) => s.x)).size).toBe(MAX_PLAYERS);
  });
  it('spawns stand on solid ground, inside bounds, and overlap no solid', () => {
    for (const s of ARENA.spawns) {
      const b = spawnBody(s.x, s.y);
      expect(standingOn({ ...b })).toBeGreaterThanOrEqual(0);
      expect(s.x - HW).toBeGreaterThanOrEqual(0);
      expect(s.x + HW).toBeLessThanOrEqual(ARENA.width);
      const stable = cloneBody(b);
      stepBody(stable, { moveX: 0, jump: false });
      expect(stable.y).toBe(s.y); // a spawn is a fixed point of the simulation
      expect(stable.x).toBe(s.x);
    }
  });
  it('every spawn has full jump headroom (regression: spawns once sat under platforms)', () => {
    const ideal = 100; // px; a full jump apex is ~122px
    for (const s of ARENA.spawns) {
      const b = spawnBody(s.x, s.y);
      let minY = b.y;
      stepBody(b, { moveX: 0, jump: true });
      for (let i = 0; i < 30; i++) { minY = Math.min(minY, b.y); stepBody(b, { moveX: 0, jump: false }); }
      expect(s.y - minY).toBeGreaterThan(ideal);
    }
  });
  it('keeps all solids inside the world and non-degenerate', () => {
    for (const r of ARENA.solids as readonly Rect[]) {
      expect(r.w).toBeGreaterThan(0); expect(r.h).toBeGreaterThan(0);
      expect(r.x).toBeGreaterThanOrEqual(0); expect(r.x + r.w).toBeLessThanOrEqual(ARENA.width);
      expect(r.y).toBeGreaterThanOrEqual(PLAYER_HEIGHT); expect(r.y + r.h).toBeLessThanOrEqual(ARENA.height);
    }
  });

  it('every platform is reachable from spawn using the REAL movement rules', () => {
    // Explore: from each platform try walking/jumping left/right from sample x positions, record where we land.
    const reached = new Set<number>();
    const queue: number[] = [];
    const start = standingOn(spawnBody(ARENA.spawns[0]!.x, ARENA.spawns[0]!.y));
    reached.add(start); queue.push(start);
    while (queue.length) {
      const from = queue.shift()!;
      const r = ARENA.solids[from]!;
      for (let sx = r.x + 4; sx <= r.x + r.w - 4; sx += 8) {
        for (const dir of [-1, 1]) {
          for (const jump of [true, false]) {
            const b = spawnBody(sx, r.y);
            for (let t = 0; t < 45; t++) {
              stepBody(b, { moveX: dir, jump: jump && t < 1 });
              const on = standingOn(b);
              if (on >= 0 && on !== from && !reached.has(on)) { reached.add(on); queue.push(on); }
            }
          }
        }
      }
    }
    expect([...reached].sort()).toEqual(ARENA.solids.map((_, i) => i));
  });
});
