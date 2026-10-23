import { describe, expect, it } from 'vitest';
import {
  AMBIENT_TABLE, DIFFICULTIES, LIGHT_REFERENCE_REACH, VISION_TABLE, ambientPercent, hasLineOfSight, occluders, pointVisible, segmentHitsBox,
  visionRadius, type Box, type RoomDef,
} from '../src';

const room: RoomDef = {
  id: 'r', doors: [{ id: 'd_mid', x: 900, y: 580, w: 40, h: 100, to: 'x', arrive: { x: 10, y: 680 } }],
  arena: {
    id: 'r', name: 'r', width: 1920, height: 720,
    solids: [{ x: 0, y: 680, w: 1920, h: 40 }, { x: 400, y: 560, w: 200, h: 20 }],
    spawns: [100, 150, 200, 250].map((x) => ({ x, y: 680 })),
  },
};
const none = new Set<string>();

describe('vision reach and ambient, by stage and mode', () => {
  it('stage 1 starts at the reference reach on Easy (the light as the maintainer already saw it)', () => {
    expect(visionRadius('easy', 1)).toBe(LIGHT_REFERENCE_REACH);
    expect(visionRadius('intermediate', 1)).toBe(430);
    expect(visionRadius('hardcore', 1)).toBe(400);
  });
  it('shrinks one px per stage and holds at the floor (stages 1, 10, 100 and 1,000,000)', () => {
    expect(visionRadius('easy', 10)).toBe(451);
    expect(visionRadius('intermediate', 10)).toBe(421);
    expect(visionRadius('hardcore', 10)).toBe(391);
    for (const d of DIFFICULTIES) {
      expect(visionRadius(d, 1_000)).toBe(VISION_TABLE[d].floor);
      expect(visionRadius(d, 1_000_000)).toBe(VISION_TABLE[d].floor);
    }
    expect(visionRadius('easy', 100)).toBe(361);
    expect(visionRadius('intermediate', 100)).toBe(331);
    expect(visionRadius('hardcore', 100)).toBe(301);
  });
  it('is monotone, bounded by [floor, base], and never below what makes a door and a key findable', () => {
    for (const d of DIFFICULTIES) {
      let prev = Infinity;
      for (let s = 1; s <= 400; s++) {
        const r = visionRadius(d, s);
        expect(r).toBeLessThanOrEqual(prev);
        expect(r).toBeGreaterThanOrEqual(VISION_TABLE[d].floor);
        expect(r).toBeLessThanOrEqual(VISION_TABLE[d].base);
        prev = r;
      }
      expect(VISION_TABLE[d].floor).toBeGreaterThan(200); // far more than the 70 px reach of E
    }
    for (let s = 1; s <= 60; s++) {
      expect(visionRadius('easy', s)).toBeGreaterThanOrEqual(visionRadius('intermediate', s));
      expect(visionRadius('intermediate', s)).toBeGreaterThanOrEqual(visionRadius('hardcore', s));
    }
  });
  it('ambient and reach move together: both are stage and mode parameters, same for everyone', () => {
    const rows = [1, 10, 100, 1_000_000].map((s) => DIFFICULTIES.map((d) => [d, s, ambientPercent(d, s), visionRadius(d, s)] as const));
    expect(rows[0]!.map((r) => [r[2], r[3]])).toEqual([[30, 460], [20, 430], [10, 400]]);
    expect(rows[3]!.map((r) => [r[2], r[3]])).toEqual(DIFFICULTIES.map((d) => [AMBIENT_TABLE[d].floor, VISION_TABLE[d].floor]));
  });
  it('treats garbage stage numbers as stage 1', () => {
    for (const s of [0, -3, Number.NaN]) expect(visionRadius('easy', s)).toBe(460);
  });
});

describe('line of sight', () => {
  const box: Box = { x: 100, y: 100, w: 50, h: 50 };
  it('a segment through a box is blocked; one beside it, past it, or ending before it is not', () => {
    expect(segmentHitsBox({ x: 0, y: 125 }, { x: 300, y: 125 }, box)).toBe(true);
    expect(segmentHitsBox({ x: 0, y: 50 }, { x: 300, y: 50 }, box)).toBe(false);
    expect(segmentHitsBox({ x: 0, y: 125 }, { x: 90, y: 125 }, box)).toBe(false);
    expect(segmentHitsBox({ x: 0, y: 0 }, { x: 300, y: 300 }, box)).toBe(true); // diagonal
    expect(segmentHitsBox({ x: 125, y: 0 }, { x: 125, y: 300 }, box)).toBe(true); // vertical
  });
  it('grazing an edge or standing on top does not block (an item on a platform is seen from above)', () => {
    expect(segmentHitsBox({ x: 0, y: 100 }, { x: 300, y: 100 }, box)).toBe(false);
    expect(segmentHitsBox({ x: 0, y: 150 }, { x: 300, y: 150 }, box)).toBe(false);
  });
  it('a solid between the eye and the target blocks; the floor does not block things lying on it', () => {
    const eye = { x: 500, y: 652 };
    expect(pointVisible(room, eye, { x: 700, y: 668 }, none, 460)).toBe(true); // on the floor, nothing between
    expect(pointVisible(room, eye, { x: 500, y: 548 }, none, 460)).toBe(false); // on the platform above: the platform is in the way
    expect(pointVisible(room, { x: 500, y: 520 }, { x: 500, y: 548 }, none, 460)).toBe(true); // from above it
  });
  it('a CLOSED door blocks sight, an open one does not, and a door is never hidden by itself', () => {
    const eye = { x: 800, y: 652 }, behind = { x: 1100, y: 668 };
    expect(pointVisible(room, eye, behind, none, 460)).toBe(false);
    expect(pointVisible(room, eye, behind, new Set(['d_mid']), 460)).toBe(true);
    expect(pointVisible(room, eye, { x: 920, y: 630 }, none, 460, 'd_mid')).toBe(true); // the door's own centre, ignoring itself
    expect(pointVisible(room, eye, { x: 920, y: 630 }, none, 460)).toBe(false);
    expect(occluders(room, none).length).toBe(3);
    expect(occluders(room, new Set(['d_mid'])).length).toBe(2);
  });
  it('radius is checked first and is inclusive', () => {
    const eye = { x: 100, y: 652 };
    expect(pointVisible(room, eye, { x: 560, y: 652 }, none, 460)).toBe(true);
    expect(pointVisible(room, eye, { x: 561, y: 652 }, none, 460)).toBe(false);
    expect(hasLineOfSight(eye, { x: 5000, y: 652 }, [])).toBe(true); // line of sight alone has no reach: the radius is the reach
  });
});
