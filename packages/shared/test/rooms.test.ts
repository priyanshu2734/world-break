import { describe, expect, it } from 'vitest';
import { PLAYER_HEIGHT, PLAYER_WIDTH, ROOM_LIMITS, RoomGraphSchema, RoomLayoutSchema, bodyInDoor, doorAt, layoutOf, validateRoomGraph, type RoomDef, type RoomGraph } from '../src';

const arena = (id: string) => ({
  id, name: id, width: 1920, height: 720,
  solids: [{ x: 0, y: 680, w: 1920, h: 40 }],
  spawns: [100, 150, 200, 250].map((x) => ({ x, y: 680 })),
});
const door = (id: string, x: number, to: string, arriveX: number) => ({ id, x, y: 580, w: 40, h: 100, to, arrive: { x: arriveX, y: 680 } });
const a: RoomDef = { id: 'a', arena: arena('a'), doors: [door('a_e', 1800, 'b', 300)] };
const b: RoomDef = { id: 'b', arena: arena('b'), doors: [door('b_w', 60, 'a', 1700)] };
const two = (): RoomGraph => structuredClone({ start: 'a', rooms: [a, b] });

describe('shared rooms module', () => {
  it('a minimal two-room chain is valid', () => {
    expect(RoomGraphSchema.safeParse(two()).success).toBe(true);
    expect(validateRoomGraph(two())).toEqual([]);
  });
  it('limits table', () => {
    expect(ROOM_LIMITS.maxRooms).toBe(6);
    expect(ROOM_LIMITS.minWidth).toBeGreaterThan(1280); // every room is bigger than the 1280-wide screen
  });
  it('door overlap uses the player body box and is strict at the edges', () => {
    const d = { x: 1000, y: 580, w: 40, h: 100 };
    expect(bodyInDoor({ x: 1020, y: 680 }, d)).toBe(true);
    expect(bodyInDoor({ x: 1000 - PLAYER_WIDTH / 2, y: 680 }, d)).toBe(false); // just touching the left edge
    expect(bodyInDoor({ x: 1040 + PLAYER_WIDTH / 2, y: 680 }, d)).toBe(false);
    expect(bodyInDoor({ x: 1020, y: 580 - 1 + 0 }, d)).toBe(false); // feet at the door's top: standing on something above it
    expect(bodyInDoor({ x: 1020, y: 580 + PLAYER_HEIGHT + 1 + 100 }, d)).toBe(false); // body entirely below
  });
  it('doorAt returns the first matching door in authored order', () => {
    const r: RoomDef = { ...a, doors: [door('x', 500, 'b', 300), door('y', 500, 'b', 300)] };
    expect(doorAt(r, { x: 520, y: 680 })?.id).toBe('x');
    expect(doorAt(r, { x: 100, y: 680 })).toBeNull();
  });
  it('the public layout is bounded and carries nothing about where doors lead', () => {
    const l = layoutOf(a);
    expect(RoomLayoutSchema.safeParse(l).success).toBe(true);
    expect(JSON.stringify(l)).not.toContain('"to"');
    expect(JSON.stringify(l)).not.toContain('arrive');
    expect(RoomLayoutSchema.safeParse({ ...l, doors: Array.from({ length: 4 }, (_, i) => ({ id: `d${i}`, x: 0, y: 0, w: 40, h: 100 })) }).success).toBe(false);
  });
  it('the schema rejects rooms outside the size limits and more than 6 rooms', () => {
    const g = two();
    g.rooms[0]!.arena.width = 1000;
    expect(RoomGraphSchema.safeParse(g).success).toBe(false);
    const many = two();
    many.rooms = Array.from({ length: 7 }, (_, i) => ({ id: `r${i}`, arena: arena(`r${i}`), doors: [] }));
    expect(RoomGraphSchema.safeParse(many).success).toBe(false);
  });
});
