import { ARENA, type RoomArena, type RoomDef, type RoomGraph } from '@wb/shared';
import { StageDefSchema, type StageDef } from '../systems/stageDef';
import { HUNT_STAGE } from '../systems/stages/hunt';

/**
 * P3D step 2: a hand-authored three-room chain for developers (`/?rooms=1`, server ESCAPE_STAGES on). It exists to prove rooms,
 * camera follow, doors and the room id in snapshots before locks, the exit and the generator arrive (steps 3 and 5).
 *
 *   room 0 (1920x720)  --east door-->  room 1 (2400x1080, taller than the screen)  --east door-->  room 2 (1920x720)
 *
 * Room 0 is the salvage-hunt arena stretched to the east, so the hunt's items and entities (the stage content) stay valid there.
 * Doors stand on the floor at both ends of every room and open freely. This stage has no exit and cannot be cleared.
 */
export const DEMO_ROOM_IDS = ['rooms_demo.r0', 'rooms_demo.r1', 'rooms_demo.r2'] as const;
const [R0, R1, R2] = DEMO_ROOM_IDS;

const room0: RoomArena = {
  id: R0, name: 'Demo room 0', width: 1920, height: 720,
  solids: [{ x: 0, y: 680, w: 1920, h: 40 }, ...ARENA.solids.slice(1), { x: 1350, y: 590, w: 260, h: 20 }, { x: 1600, y: 500, w: 200, h: 20 }],
  spawns: ARENA.spawns.map((s) => ({ ...s })),
};
const room1: RoomArena = {
  id: R1, name: 'Demo room 1', width: 2400, height: 1080,
  solids: [
    { x: 0, y: 1040, w: 2400, h: 40 },
    { x: 300, y: 940, w: 260, h: 20 }, { x: 700, y: 840, w: 260, h: 20 }, { x: 1100, y: 740, w: 260, h: 20 },
    { x: 1500, y: 840, w: 260, h: 20 }, { x: 1900, y: 940, w: 260, h: 20 },
  ],
  spawns: [1000, 1040, 1080, 1120].map((x) => ({ x, y: 1040 })),
};
const room2: RoomArena = {
  id: R2, name: 'Demo room 2', width: 1920, height: 720,
  solids: [{ x: 0, y: 680, w: 1920, h: 40 }, { x: 500, y: 590, w: 260, h: 20 }, { x: 900, y: 500, w: 300, h: 20 }, { x: 1400, y: 590, w: 260, h: 20 }],
  spawns: [200, 250, 300, 350].map((x) => ({ x, y: 680 })),
};

const west = (id: string, floorY: number, to: string, arrive: { x: number; y: number }) => ({ id, x: 60, y: floorY - 100, w: 40, h: 100, to, arrive });
const east = (id: string, x: number, floorY: number, to: string, arrive: { x: number; y: number }) => ({ id, x, y: floorY - 100, w: 40, h: 100, to, arrive });

export const DEMO_GRAPH: RoomGraph = {
  start: R0,
  rooms: [
    { id: R0, arena: room0, doors: [east('rooms_demo.r0_e', 1840, 680, R1, { x: 200, y: 1040 })] },
    { id: R1, arena: room1, doors: [west('rooms_demo.r1_w', 1040, R0, { x: 1740, y: 680 }), east('rooms_demo.r1_e', 2300, 1040, R2, { x: 200, y: 680 })] },
    { id: R2, arena: room2, doors: [west('rooms_demo.r2_w', 680, R1, { x: 2200, y: 1040 })] },
  ] satisfies RoomDef[],
};

/** The salvage hunt's content in room 0, dark, with two more rooms behind the door. */
export const ROOMS_DEMO_STAGE: StageDef = StageDefSchema.parse({
  ...structuredClone(HUNT_STAGE),
  id: 'rooms_demo',
  name: 'Rooms (dev demo)',
  arenaId: R0,
  dark: true,
  rooms: DEMO_GRAPH,
});
