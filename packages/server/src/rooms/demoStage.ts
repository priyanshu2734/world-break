import { ARENA, type RoomArena, type RoomDef, type RoomGraph } from '@wb/shared';
import { StageDefSchema, type StageDef } from '../systems/stageDef';
import type { EscapeSpec } from './escapeSpec';
import { bareEscapeStage } from './stageBase';

/**
 * P3D developer stages. Both are dark, have no objectives and no hazards, and are cleared by reaching the exit.
 *
 *   ROOMS_DEMO_STAGE   (/?rooms=1)  three rooms, a mini escape: a key from a locker (with a cracked look-alike key lying around) opens
 *                                   the first door; a 4-digit code found on a high platform opens the second; the exit is in room 2.
 *   LOCK_SAMPLER_STAGE (/?rooms=2)  six rooms, one door of each lock type in a row: key, code, power, two-person, safe. It exists to
 *                                   play every lock and to prove the 6-room cap.
 * Step 5 replaces hand-authoring with the seeded generator; these stay as fixtures for tests and playtests.
 */
export const DEMO_ROOM_IDS = ['rooms_demo.r0', 'rooms_demo.r1', 'rooms_demo.r2'] as const;
const [R0, R1, R2] = DEMO_ROOM_IDS;

// ----------------------------------------------------------------------------------------------------------- the 3-room mini escape
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

/** Where things are in the mini escape (used by the playtest notes and by tests that walk it). */
export const DEMO_AT = {
  locker: { room: R0, x: 420, y: 680 },
  decoyKey: { room: R0, x: 760, y: 680 },
  doorA: { id: 'rooms_demo.r0_e', room: R0, x: 1860, y: 680 },
  clue: { room: R1, x: 1230, y: 740 },
  keypad: { room: R1, x: 2120, y: 1040 },
  doorB: { id: 'rooms_demo.r1_e', room: R1, x: 2320, y: 1040 },
  exit: { room: R2, x: 1700, y: 680 },
} as const;
export const DEMO_CODE = '4815';

const bare = bareEscapeStage;

const demoEscape: EscapeSpec = {
  exit: DEMO_AT.exit,
  links: [
    { doors: ['rooms_demo.r0_e', 'rooms_demo.r1_w'], lock: { type: 'key_item' } },
    { doors: ['rooms_demo.r1_e', 'rooms_demo.r2_w'], lock: { type: 'code', keypadId: 'demo_keypad', code: DEMO_CODE, clueIds: ['demo_log'] } },
  ],
  keypads: [{ id: 'demo_keypad', room: R1, x: DEMO_AT.keypad.x, y: DEMO_AT.keypad.y }],
  safes: [],
  clues: [
    { id: 'demo_log', room: R1, x: DEMO_AT.clue.x, y: DEMO_AT.clue.y, label: 'Scorched log', text: 'A scorched maintenance log. Only four numbers survive: 4 8 1 5.' },
    { id: 'demo_stain', room: R0, x: 1000, y: 680, label: 'Stained note', text: 'Coffee rings and a doodle of a key. Nothing useful.' },
  ],
  switches: [],
};

export const ROOMS_DEMO_STAGE: StageDef = StageDefSchema.parse({
  ...bare('rooms_demo', 'Rooms (dev demo)', DEMO_GRAPH),
  stashes: [{ id: 'demo_locker', kind: 'locker', label: 'Locker', x: DEMO_AT.locker.x, y: DEMO_AT.locker.y, room: R0 }],
  items: [
    { id: 'demo_key', kind: 'access_key', x: DEMO_AT.locker.x, y: DEMO_AT.locker.y, room: R0, hidden: { container: 'locker', reveal: 'interact', stashId: 'demo_locker' } },
    { id: 'demo_key_cracked', kind: 'access_key', x: DEMO_AT.decoyKey.x, y: DEMO_AT.decoyKey.y, room: R0, decoy: true, tell: true },
  ],
  escape: demoEscape,
});

// ------------------------------------------------------------------------------------------------------------- the 6-room lock sampler
export const SAMPLER_IDS = [0, 1, 2, 3, 4, 5].map((n) => `sampler.r${n}`);

const flat = (n: number, platforms: { x: number; y: number; w: number }[]): RoomArena => ({
  id: SAMPLER_IDS[n]!, name: `Sampler room ${n}`, width: 1920, height: 720,
  solids: [{ x: 0, y: 680, w: 1920, h: 40 }, ...platforms.map((p) => ({ ...p, h: 20 }))],
  spawns: [300, 350, 400, 450].map((x) => ({ x, y: 680 })),
});
const samplerRooms = [
  flat(0, [{ x: 500, y: 590, w: 260 }]),
  flat(1, [{ x: 900, y: 590, w: 260 }]),
  flat(2, [{ x: 800, y: 580, w: 260 }, { x: 1250, y: 490, w: 240 }]),
  flat(3, [{ x: 1000, y: 580, w: 260 }]),
  flat(4, [{ x: 1350, y: 590, w: 260 }]),
  flat(5, [{ x: 700, y: 590, w: 260 }]),
];
const samplerDoor = (n: number, side: 'e' | 'w') => (side === 'e'
  ? east(`sampler.r${n}_e`, 1840, 680, SAMPLER_IDS[n + 1]!, { x: 200, y: 680 })
  : west(`sampler.r${n}_w`, 680, SAMPLER_IDS[n - 1]!, { x: 1740, y: 680 }));
export const SAMPLER_GRAPH: RoomGraph = {
  start: SAMPLER_IDS[0]!,
  rooms: samplerRooms.map((arena, n) => ({
    id: arena.id, arena,
    doors: [...(n > 0 ? [samplerDoor(n, 'w')] : []), ...(n < 5 ? [samplerDoor(n, 'e')] : [])],
  })),
};
export const SAMPLER_CODE = '2749';
export const SAMPLER_COMBO = '358';
export const SAMPLER_AT = {
  locker: { room: SAMPLER_IDS[0]!, x: 420, y: 680 },
  keypad: { room: SAMPLER_IDS[1]!, x: 1700, y: 680 },
  codeClue: { room: SAMPLER_IDS[1]!, x: 700, y: 680 },
  battery: { room: SAMPLER_IDS[2]!, x: 900, y: 580 },
  switchA: { room: SAMPLER_IDS[3]!, x: 900, y: 680 },
  switchB: { room: SAMPLER_IDS[3]!, x: 1500, y: 680 },
  safe: { room: SAMPLER_IDS[4]!, x: 1000, y: 680 },
  safeClues: [{ x: 500, y: 680 }, { x: 1300, y: 680 }, { x: 1450, y: 590 }],
  exit: { room: SAMPLER_IDS[5]!, x: 1700, y: 680 },
} as const;

const samplerEscape: EscapeSpec = {
  exit: SAMPLER_AT.exit,
  links: [
    { doors: ['sampler.r0_e', 'sampler.r1_w'], lock: { type: 'key_item' } },
    { doors: ['sampler.r1_e', 'sampler.r2_w'], lock: { type: 'code', keypadId: 'smp_keypad', code: SAMPLER_CODE, clueIds: ['smp_code_clue'] } },
    { doors: ['sampler.r2_e', 'sampler.r3_w'], lock: { type: 'power' } },
    { doors: ['sampler.r3_e', 'sampler.r4_w'], lock: { type: 'two_person', switchA: 'smp_sw_a', switchB: 'smp_sw_b' } },
    { doors: ['sampler.r4_e', 'sampler.r5_w'], lock: { type: 'safe', safeId: 'smp_safe' } },
  ],
  keypads: [{ id: 'smp_keypad', room: SAMPLER_AT.keypad.room, x: SAMPLER_AT.keypad.x, y: SAMPLER_AT.keypad.y }],
  safes: [{ id: 'smp_safe', room: SAMPLER_AT.safe.room, x: SAMPLER_AT.safe.x, y: SAMPLER_AT.safe.y, code: SAMPLER_COMBO, clueIds: ['smp_s1', 'smp_s2', 'smp_s3'], contains: 'smp_key_safe' }],
  clues: [
    { id: 'smp_code_clue', room: SAMPLER_AT.codeClue.room, x: SAMPLER_AT.codeClue.x, y: SAMPLER_AT.codeClue.y, label: 'Wall scrawl', text: 'Scrawled on the wall: 2 7 4 9.' },
    { id: 'smp_s1', room: SAMPLER_AT.safe.room, x: SAMPLER_AT.safeClues[0]!.x, y: SAMPLER_AT.safeClues[0]!.y, label: 'Torn page 1', text: 'Torn page: the first number of the safe is 3.' },
    { id: 'smp_s2', room: SAMPLER_AT.safe.room, x: SAMPLER_AT.safeClues[1]!.x, y: SAMPLER_AT.safeClues[1]!.y, label: 'Torn page 2', text: 'Torn page: the second number is 5.' },
    { id: 'smp_s3', room: SAMPLER_AT.safe.room, x: SAMPLER_AT.safeClues[2]!.x, y: SAMPLER_AT.safeClues[2]!.y, label: 'Torn page 3', text: 'Torn page: and the last number is 8.' },
  ],
  switches: [
    { id: 'smp_sw_a', room: SAMPLER_AT.switchA.room, x: SAMPLER_AT.switchA.x, y: SAMPLER_AT.switchA.y },
    { id: 'smp_sw_b', room: SAMPLER_AT.switchB.room, x: SAMPLER_AT.switchB.x, y: SAMPLER_AT.switchB.y },
  ],
};

export const LOCK_SAMPLER_STAGE: StageDef = StageDefSchema.parse({
  ...bare('lock_sampler', 'Lock sampler (dev)', SAMPLER_GRAPH),
  stashes: [{ id: 'smp_locker', kind: 'locker', label: 'Locker', x: SAMPLER_AT.locker.x, y: SAMPLER_AT.locker.y, room: SAMPLER_IDS[0]! }],
  items: [
    { id: 'smp_key', kind: 'access_key', x: SAMPLER_AT.locker.x, y: SAMPLER_AT.locker.y, room: SAMPLER_IDS[0]!, hidden: { container: 'locker', reveal: 'interact', stashId: 'smp_locker' } },
    { id: 'smp_key_cracked', kind: 'access_key', x: 760, y: 680, room: SAMPLER_IDS[0]!, decoy: true, tell: true },
    { id: 'smp_battery', kind: 'battery', x: SAMPLER_AT.battery.x, y: SAMPLER_AT.battery.y, room: SAMPLER_AT.battery.room },
    { id: 'smp_key_safe', kind: 'access_key', x: SAMPLER_AT.safe.x, y: SAMPLER_AT.safe.y, room: SAMPLER_AT.safe.room, hidden: { container: 'locker', reveal: 'interact' } },
  ],
  escape: samplerEscape,
});
