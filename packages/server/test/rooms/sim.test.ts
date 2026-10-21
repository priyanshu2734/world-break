import { describe, expect, it } from 'vitest';
import { ARENA, GamePlayerSchema, GameSnapshotSchema, NEUTRAL_INPUT, ROOM_LIMITS, TICK_DT, spawnBody, stepBody, type InputIntent, type RoomGraph } from '@wb/shared';
import { GameSim } from '../../src/game';
import { DEMO_GRAPH, DEMO_ROOM_IDS } from '../../src/rooms/demoStage';

const [R0, R1, R2] = DEMO_ROOM_IDS;
const graph = (): RoomGraph => structuredClone(DEMO_GRAPH);
const startArena = DEMO_GRAPH.rooms[0]!.arena;
const RIGHT: InputIntent = { moveX: 1, jump: false };
const LEFT: InputIntent = { moveX: -1, jump: false };

function newSim(n = 1): GameSim {
  const sim = new GameSim(Array.from({ length: n }, (_, i) => ({ id: `p${i}`, name: `P${i}`, slot: i })), startArena);
  sim.loadRooms(graph());
  sim.reset();
  return sim;
}
let seq = 0;
/** Drive one player for `ticks` ticks (others idle), like the gateway would. */
function drive(sim: GameSim, id: string, input: InputIntent, ticks: number, stop?: () => boolean): void {
  for (let i = 0; i < ticks; i++) {
    sim.queueInput(id, ++seq, input);
    sim.step();
    if (stop?.()) return;
  }
}
const roomOf = (sim: GameSim, id: string) => sim.snapshot('playing', 0, 1).players.find((p) => p.id === id)!.roomId;

describe('P3D rooms: GameSim with a room graph', () => {
  it('puts every player in the start room at its slot spawn, and the snapshot says so', () => {
    const sim = newSim(3);
    const snap = GameSnapshotSchema.parse(sim.snapshot('playing', 0, 1));
    expect(snap.arenaId).toBe(R0);
    for (const p of snap.players) { expect(p.roomId).toBe(R0); expect(p.x).toBe(startArena.spawns[p.slot]!.x); expect(p.y).toBe(startArena.spawns[p.slot]!.y); }
  });

  it('a single-arena sim never writes a roomId (the pre-P3D snapshot is byte-identical)', () => {
    const sim = new GameSim([{ id: 'p0', name: 'P0', slot: 0 }], ARENA);
    const p = sim.snapshot('playing', 0, 1).players[0]!;
    expect('roomId' in p).toBe(false);
    expect(Object.keys(GamePlayerSchema.parse(p)).includes('roomId')).toBe(false);
    sim.loadRooms(graph()); sim.loadRooms(null); // entering and leaving a chain restores that
    expect('roomId' in sim.snapshot('playing', 0, 1).players[0]!).toBe(false);
  });

  it('walking through the east door moves the player to the next room at the door\'s arrival point', () => {
    const sim = newSim();
    drive(sim, 'p0', RIGHT, 400, () => roomOf(sim, 'p0') !== R0);
    expect(roomOf(sim, 'p0')).toBe(R1);
    const t = sim.drainTransitions();
    expect(t).toEqual([{ playerId: 'p0', from: R0, to: R1, doorId: 'rooms_demo.r0_e' }]);
    const p = sim.snapshot('playing', 0, 1).players[0]!;
    expect(p.x).toBe(200); expect(p.y).toBe(1040);
    expect(sim.drainTransitions()).toEqual([]); // drained
  });

  it('a player cannot bounce straight back: arrival is clear of the way back and the cooldown holds', () => {
    const sim = newSim();
    drive(sim, 'p0', RIGHT, 400, () => roomOf(sim, 'p0') !== R0);
    sim.drainTransitions();
    drive(sim, 'p0', NEUTRAL_INPUT, ROOM_LIMITS.doorCooldownTicks + 5);
    expect(roomOf(sim, 'p0')).toBe(R1);
    expect(sim.drainTransitions()).toEqual([]);
  });

  it('the whole chain can be walked out and back along the floors (real physics)', () => {
    const sim = newSim();
    drive(sim, 'p0', RIGHT, 400, () => roomOf(sim, 'p0') === R1);
    drive(sim, 'p0', RIGHT, 400, () => roomOf(sim, 'p0') === R2);
    expect(roomOf(sim, 'p0')).toBe(R2);
    drive(sim, 'p0', LEFT, 400, () => roomOf(sim, 'p0') === R1);
    drive(sim, 'p0', LEFT, 400, () => roomOf(sim, 'p0') === R0);
    expect(roomOf(sim, 'p0')).toBe(R0);
    expect(sim.drainTransitions().map((t) => t.to)).toEqual([R1, R2, R1, R0]);
  });

  it('players are in rooms independently; each steps in its own room\'s arena', () => {
    const sim = newSim(2);
    drive(sim, 'p0', RIGHT, 400, () => roomOf(sim, 'p0') === R1);
    expect(roomOf(sim, 'p0')).toBe(R1);
    expect(roomOf(sim, 'p1')).toBe(R0);
    // p0 now falls/stands on room 1's floor (y 1040), which does not exist in room 0
    drive(sim, 'p0', NEUTRAL_INPUT, 30);
    const [a, b] = sim.snapshot('playing', 0, 1).players;
    expect(a!.y).toBe(1040); expect(b!.y).toBe(680);
  });

  it('a door gate (the hook for step 3 locks) can keep a door shut', () => {
    const sim = newSim();
    sim.doorGate = () => false;
    drive(sim, 'p0', RIGHT, 300);
    expect(roomOf(sim, 'p0')).toBe(R0);
    sim.doorGate = (doorId, playerId) => doorId === 'rooms_demo.r0_e' && playerId === 'p0';
    drive(sim, 'p0', LEFT, 40, () => roomOf(sim, 'p0') === R1); // the player ran past the 40px door to the wall; walking back into it uses it
    expect(roomOf(sim, 'p0')).toBe(R1);
  });

  it('reset brings everyone back to the start room spawns with a new epoch', () => {
    const sim = newSim(2);
    drive(sim, 'p0', RIGHT, 400, () => roomOf(sim, 'p0') === R1);
    const epoch = sim.epoch;
    sim.reset();
    expect(sim.epoch).toBe(epoch + 1);
    for (const p of sim.snapshot('playing', 0, 1).players) { expect(p.roomId).toBe(R0); expect(p.x).toBe(startArena.spawns[p.slot]!.x); }
    expect(sim.drainTransitions()).toEqual([]);
  });
});

describe('P3D rooms: per-room parity with the shared movement function', () => {
  it('the server\'s step equals stepBody on the player\'s room arena, bit for bit, across a door passage', () => {
    // A scripted run: walk right, jump on the way, through the door, then walk and jump around room 1.
    const script: InputIntent[] = [];
    for (let i = 0; i < 160; i++) script.push({ moveX: 1, jump: i % 37 === 5 });
    for (let i = 0; i < 160; i++) script.push({ moveX: i % 90 < 60 ? 1 : -1, jump: i % 29 === 3 });

    const sim = newSim();
    // the reference: one body stepped with the same shared function, switching arenas where the server does
    let ref = spawnBody(startArena.spawns[0]!.x, startArena.spawns[0]!.y);
    let refArena = startArena;
    let crossed = false;
    for (const input of script) {
      sim.queueInput('p0', ++seq, input);
      sim.step();
      stepBody(ref, input, refArena);
      const t = sim.drainTransitions();
      if (t.length > 0) { // the door moved the body: the reference follows the documented rule (arrival point, new room's arena)
        const door = DEMO_GRAPH.rooms[0]!.doors[0]!;
        ref = spawnBody(door.arrive.x, door.arrive.y);
        refArena = DEMO_GRAPH.rooms[1]!.arena;
        crossed = true;
      }
      const p = sim.snapshot('playing', 0, 1).players[0]!;
      expect(p.x).toBeCloseTo(ref.x, 1); expect(p.y).toBeCloseTo(ref.y, 1);
      expect(p.vx).toBeCloseTo(ref.vx, 1); expect(p.vy).toBeCloseTo(ref.vy, 1);
    }
    expect(crossed).toBe(true);
    expect(TICK_DT).toBeGreaterThan(0);
  });
});
