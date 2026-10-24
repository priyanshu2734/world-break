import { describe, expect, it } from 'vitest';
import {
  LOCK_TYPES, ROOM_LIMITS, TUTORIAL_AMBIENT_MIN, ambientPercent, decoysForStage, hidingSpotsForStage, locksForStage, roomCountForStage, validateRoomGraph,
  visionRadius, type RoomDef, type RoomGraph,
} from '../src';

describe('escape stage tables (GAMEPLAY.md section 4)', () => {
  it('rooms by stage: 1-2: 1, 3-6: 2, 7-14: 3, 15-24: 4, 25-39: 5, 40+: 6', () => {
    const at: [number, number][] = [[1, 1], [2, 1], [3, 2], [6, 2], [7, 3], [14, 3], [15, 4], [24, 4], [25, 5], [39, 5], [40, 6], [41, 6]];
    for (const [stage, rooms] of at) expect(roomCountForStage(stage)).toBe(rooms);
  });
  it('stages 1, 10, 100 and 1,000,000: room count, ambient and reach for every mode', () => {
    expect([1, 10, 100, 1_000_000].map(roomCountForStage)).toEqual([1, 3, 6, 6]);
    expect([1, 10, 100, 1_000_000].map((s) => ambientPercent('easy', s))).toEqual([30, 21, 10, 10]);
    expect([1, 10, 100, 1_000_000].map((s) => ambientPercent('intermediate', s))).toEqual([20, 11, 5, 5]);
    expect([1, 10, 100, 1_000_000].map((s) => ambientPercent('hardcore', s))).toEqual([10, 2, 2, 2]);
    expect([1, 10, 100, 1_000_000].map((s) => visionRadius('easy', s))).toEqual([460, 451, 361, 340]);
  });
  it('the room count never exceeds the cap and never shrinks as stages rise', () => {
    let prev = 0;
    for (let s = 1; s <= 500; s++) { const n = roomCountForStage(s); expect(n).toBeGreaterThanOrEqual(prev); expect(n).toBeLessThanOrEqual(ROOM_LIMITS.maxRooms); prev = n; }
    expect(roomCountForStage(Number.NaN)).toBe(1);
    expect(roomCountForStage(-5)).toBe(1);
  });
  it('one new thing at a time: locks unlock in order, decoys start on stage 2, ghost spots after the tutorial', () => {
    expect(locksForStage(1)).toEqual(['key_item']);
    expect(locksForStage(2)).toEqual(['key_item', 'code']);
    expect(locksForStage(3)).toContain('power'); expect(locksForStage(3)).not.toContain('two_person');
    expect(locksForStage(6)).toContain('two_person'); expect(locksForStage(6)).not.toContain('safe');
    expect([...locksForStage(10)].sort()).toEqual([...LOCK_TYPES].sort());
    expect([1, 2, 7].map(decoysForStage)).toEqual([0, 1, 2]);
    expect([1, 2, 15].map(hidingSpotsForStage)).toEqual([0, 1, 2]);
    expect(TUTORIAL_AMBIENT_MIN).toBeGreaterThan(0.3); // brighter than any Easy stage 1
  });
});

describe('a gate: two doors of one room with a wall between them', () => {
  const arena = (id: string) => ({
    id, name: id, width: 1920, height: 720,
    solids: [{ x: 0, y: 680, w: 1920, h: 40 }, { x: 1380, y: 0, w: 40, h: 680 }],
    spawns: [300, 350, 400, 450].map((x) => ({ x, y: 680 })),
  });
  const gi = { id: 'g_in', x: 1340, y: 580, w: 40, h: 100, to: 'g', arrive: { x: 1560, y: 680 } };
  const go = { id: 'g_out', x: 1420, y: 580, w: 40, h: 100, to: 'g', arrive: { x: 1240, y: 680 } };
  const graph = (doors: RoomDef['doors']): RoomGraph => ({ start: 'g', rooms: [{ id: 'g', arena: arena('g'), doors }] });
  it('is a valid graph when both sides exist', () => { expect(validateRoomGraph(graph([gi, go]))).toEqual([]); });
  it('a lone door into its own room is still refused', () => {
    expect(validateRoomGraph(graph([gi])).join('|')).toMatch(/leads back into its own room/);
  });
  it('an arrival point beside the other side of the gate is refused (it would bounce)', () => {
    expect(validateRoomGraph(graph([{ ...gi, arrive: { x: 1470, y: 680 } }, go])).join('|')).toMatch(/would bounce straight back/);
  });
});
