import { describe, expect, it } from 'vitest';
import { ROOM_LIMITS, RoomGraphSchema, RoomLayoutSchema, VIEW_HEIGHT, VIEW_WIDTH, layoutOf, validateRoomGraph, type RoomGraph } from '@wb/shared';
import { DEMO_GRAPH, DEMO_ROOM_IDS, ROOMS_DEMO_STAGE } from '../../src/rooms/demoStage';
import { StageEngine } from '../../src/systems/engine';
import { validateStageDef } from '../../src/systems/validate';

const clone = (): RoomGraph => structuredClone(DEMO_GRAPH);
const errorsOf = (mutate: (g: RoomGraph) => void): string[] => { const g = clone(); mutate(g); return validateRoomGraph(g); };

describe('P3D rooms: the demo graph', () => {
  it('passes the schema and the structural validator', () => {
    expect(RoomGraphSchema.safeParse(DEMO_GRAPH).success).toBe(true);
    expect(validateRoomGraph(DEMO_GRAPH)).toEqual([]);
  });
  it('every room is larger than the screen and within the documented limits', () => {
    expect(DEMO_GRAPH.rooms.length).toBeLessThanOrEqual(ROOM_LIMITS.maxRooms);
    for (const r of DEMO_GRAPH.rooms) {
      expect(r.arena.width > VIEW_WIDTH || r.arena.height > VIEW_HEIGHT).toBe(true);
      expect(r.arena.id).toBe(r.id);
      expect(r.doors.length).toBeLessThanOrEqual(ROOM_LIMITS.maxDoorsPerRoom);
    }
  });
  it('the stage definition validates and an engine can be built on its start room', () => {
    const start = DEMO_GRAPH.rooms.find((r) => r.id === DEMO_GRAPH.start)!;
    expect(validateStageDef(ROOMS_DEMO_STAGE, start.arena)).toEqual([]);
    expect(() => new StageEngine(ROOMS_DEMO_STAGE, ['p0'], { arena: start.arena })).not.toThrow();
  });
  it('the public layout holds walls and doorways only: no destination, no arrival point', () => {
    const l = layoutOf(DEMO_GRAPH.rooms[1]!);
    expect(RoomLayoutSchema.safeParse(l).success).toBe(true);
    expect(Object.keys(l).sort()).toEqual(['arena', 'doors', 'roomId']);
    for (const d of l.doors) expect(Object.keys(d).sort()).toEqual(['h', 'id', 'w', 'x', 'y']);
    expect(JSON.stringify(l)).not.toContain(DEMO_ROOM_IDS[0]!.replace('r0', 'r2')); // room 1's layout never names room 2
  });
});

describe('P3D rooms: the validator rejects every broken rule', () => {
  it('too many rooms, duplicate ids, unknown start', () => {
    expect(errorsOf((g) => { g.start = 'nope'; }).join('|')).toMatch(/start room nope does not exist/);
    expect(errorsOf((g) => { g.rooms[2]!.id = g.rooms[1]!.id; }).join('|')).toMatch(/duplicate room id/);
    const g = clone();
    for (let i = 0; i < 4; i++) g.rooms.push({ ...structuredClone(g.rooms[2]!), id: `x${i}`, arena: { ...structuredClone(g.rooms[2]!.arena), id: `x${i}` }, doors: [] });
    expect(validateRoomGraph(g).join('|')).toMatch(/room count 7/);
  });
  it('arena id must equal the room id; size limits; solids bounds; spawns on solids', () => {
    expect(errorsOf((g) => { g.rooms[0]!.arena.id = 'other'; }).join('|')).toMatch(/arena id must equal/);
    expect(errorsOf((g) => { g.rooms[0]!.arena.width = 800; }).join('|')).toMatch(/outside the limits/);
    expect(errorsOf((g) => { g.rooms[0]!.arena.solids[1]!.x = 5000; }).join('|')).toMatch(/leaves the room/);
    expect(errorsOf((g) => { g.rooms[2]!.arena.spawns[0]!.y = 500; }).join('|')).toMatch(/spawn 0 does not stand/);
  });
  it('doors: must stand on a solid, lead somewhere real, be reciprocal, and arrive on a solid away from the way back', () => {
    expect(errorsOf((g) => { g.rooms[0]!.doors[0]!.y -= 50; }).join('|')).toMatch(/does not stand on a solid/);
    expect(errorsOf((g) => { g.rooms[0]!.doors[0]!.to = 'nowhere'; }).join('|')).toMatch(/unknown room/);
    expect(errorsOf((g) => { g.rooms[2]!.doors = []; }).join('|')).toMatch(/has no door back/);
    expect(errorsOf((g) => { g.rooms[0]!.doors[0]!.arrive.y = 900; }).join('|')).toMatch(/arrival point does not stand/);
    expect(errorsOf((g) => { g.rooms[0]!.doors[0]!.arrive.x = 100; }).join('|')).toMatch(/would bounce straight back/);
    expect(errorsOf((g) => { g.rooms[0]!.doors[0]!.w = 200; }).join('|')).toMatch(/size 200x100 is outside/);
  });
  it('every room must be reachable from the start', () => {
    const g = clone();
    // cut room 2 off: remove the door into it and its way back, keeping the rest reciprocal
    g.rooms[1]!.doors = g.rooms[1]!.doors.filter((d) => d.to !== DEMO_ROOM_IDS[2]);
    g.rooms[2]!.doors = [];
    expect(validateRoomGraph(g).join('|')).toMatch(/cannot be reached from the start room/);
  });
});
