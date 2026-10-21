import { describe, expect, it } from 'vitest';
import {
  ARENA, TICK_DT, VIEW_HEIGHT, VIEW_WIDTH, spawnBody, stepBody, type Arena, type GamePlayer, type InputIntent, type PlayerBody, type RoomLayout,
} from '@wb/shared';
import { LocalPredictor } from '../src/sim/prediction';
import { arenaForRoom, cameraScroll, pickArena, roomsRequested, toScreen } from '../src/ui/roomMath';

const TICK_MS = TICK_DT * 1000;

/** A room bigger than the screen, in both directions, like the demo's room 1. */
const big: Arena = {
  id: 'test.big', name: 'Big', width: 2400, height: 1080,
  solids: [{ x: 0, y: 1040, w: 2400, h: 40 }, { x: 300, y: 940, w: 260, h: 20 }, { x: 700, y: 840, w: 260, h: 20 }, { x: 1100, y: 740, w: 260, h: 20 }],
  spawns: [{ x: 200, y: 1040 }, { x: 240, y: 1040 }, { x: 280, y: 1040 }, { x: 320, y: 1040 }],
};
const layoutOf = (arena: Arena): RoomLayout => ({ roomId: arena.id, arena: { ...arena, solids: [...arena.solids], spawns: [...arena.spawns] }, doors: [] });
const asPlayer = (b: PlayerBody, ack: number, roomId?: string): GamePlayer => ({
  id: 'me', name: 'Me', slot: 0, x: b.x, y: b.y, vx: b.vx, vy: b.vy, facing: b.facing, grounded: b.grounded, connected: true, ack,
  ...(roomId ? { roomId } : {}),
});

describe('P3D rooms: choosing the arena for a room id', () => {
  const layouts = new Map<string, RoomLayout>([[big.id, layoutOf(big)]]);
  it('built-in arenas win; a layout from the server supplies the rest; unknown is unknown', () => {
    expect(arenaForRoom(ARENA.id, layouts)).toBe(ARENA);
    expect(arenaForRoom(big.id, layouts)!.height).toBe(1080);
    expect(arenaForRoom('not.sent.yet', layouts)).toBeUndefined();
  });
  it('without a room id the stage arena is used exactly as before (unknown ids fall back to Relay Platform 01)', () => {
    expect(pickArena(undefined, ARENA.id, layouts)).toBe(ARENA);
    expect(pickArena(undefined, 'whatever', layouts)).toBe(ARENA);
  });
  it('with a room id the player\'s own room is used and nothing is guessed while its layout is missing', () => {
    expect(pickArena(big.id, ARENA.id, layouts)!.id).toBe(big.id);
    expect(pickArena('other.room', ARENA.id, layouts)).toBeUndefined();
  });
  it('?rooms=1 is the only way to ask for the demo', () => {
    expect(roomsRequested('?rooms=1')).toBe(true);
    for (const q of ['', '?rooms=0', '?rooms=true', '?room=1', '?lab=1']) expect(roomsRequested(q)).toBe(false);
  });
});

describe('P3D rooms: camera follow', () => {
  it('a room no bigger than the screen never scrolls (the pre-P3D look)', () => {
    for (const f of [{ x: 0, y: 0 }, { x: 640, y: 360 }, { x: 1280, y: 720 }]) expect(cameraScroll(f, { width: 1280, height: 720 })).toEqual({ x: 0, y: 0 });
  });
  it('centres on the player and stops at the room edges', () => {
    const room = { width: 2400, height: 1080 };
    expect(cameraScroll({ x: 1200, y: 540 }, room)).toEqual({ x: 560, y: 180 });
    expect(cameraScroll({ x: 10, y: 10 }, room)).toEqual({ x: 0, y: 0 });
    expect(cameraScroll({ x: 2390, y: 1070 }, room)).toEqual({ x: room.width - VIEW_WIDTH, y: room.height - VIEW_HEIGHT });
  });
  it('always shows the player: the focus stays inside the view for every position in the room', () => {
    const room = { width: 3200, height: 1440 };
    for (let x = 0; x <= room.width; x += 97) for (let y = 0; y <= room.height; y += 89) {
      const c = cameraScroll({ x, y }, room);
      expect(x - c.x).toBeGreaterThanOrEqual(0); expect(x - c.x).toBeLessThanOrEqual(VIEW_WIDTH);
      expect(y - c.y).toBeGreaterThanOrEqual(0); expect(y - c.y).toBeLessThanOrEqual(VIEW_HEIGHT);
      expect(Number.isInteger(c.x) && Number.isInteger(c.y)).toBe(true);
    }
  });
  it('world to screen subtracts the scroll', () => { expect(toScreen({ x: 700, y: 900 }, { x: 560, y: 180 })).toEqual({ x: 140, y: 720 }); });
});

describe('P3D rooms: client prediction in a room arena matches the shared movement function (parity)', () => {
  const scripted = (i: number): InputIntent => ({ moveX: i % 80 < 55 ? 1 : -1, jump: i % 31 === 4 });

  it('predicting in the room\'s arena equals stepBody on that arena, tick for tick', () => {
    const p = new LocalPredictor(() => {});
    p.setArena(big);
    const ref = spawnBody(big.spawns[0]!.x, big.spawns[0]!.y);
    p.start(asPlayer(ref, -1, big.id), 0);
    for (let i = 0; i < 400; i++) {
      const input = scripted(i);
      p.advance(TICK_MS, input);
      stepBody(ref, input, big);
      const got = p.predicted()!;
      expect(got.x).toBeCloseTo(ref.x, 6); expect(got.y).toBeCloseTo(ref.y, 6);
    }
  });

  it('the room arena really differs: the same inputs on the default arena end somewhere else', () => {
    const a = spawnBody(big.spawns[0]!.x, big.spawns[0]!.y), b = spawnBody(big.spawns[0]!.x, big.spawns[0]!.y);
    for (let i = 0; i < 200; i++) { stepBody(a, scripted(i), big); stepBody(b, scripted(i), ARENA); }
    expect(Math.abs(a.y - b.y) + Math.abs(a.x - b.x)).toBeGreaterThan(1);
  });

  it('reconciling against the server in a room arena produces no correction (server = stepBody on the room arena)', () => {
    const p = new LocalPredictor(() => {});
    p.setArena(big);
    const server = spawnBody(big.spawns[0]!.x, big.spawns[0]!.y);
    p.start(asPlayer(server, -1, big.id), 0);
    for (let i = 0; i < 60; i++) p.advance(TICK_MS, scripted(i));
    const before = p.render()!;
    for (let i = 0; i < 40; i++) stepBody(server, scripted(i), big); // the server has applied seq 0..39
    p.reconcile(asPlayer(server, 39, big.id), 0);
    const after = p.render()!;
    expect(after.x).toBeCloseTo(before.x, 4); expect(after.y).toBeCloseTo(before.y, 4);
  });

  it('after a door moves the body, stop + setArena + start continues cleanly in the new room (no replay of old-room inputs)', () => {
    const p = new LocalPredictor(() => {});
    p.setArena(ARENA);
    p.start(asPlayer(spawnBody(ARENA.spawns[0]!.x, ARENA.spawns[0]!.y), -1), 0);
    for (let i = 0; i < 10; i++) p.advance(TICK_MS, { moveX: 1, jump: false });
    expect(p.pendingCount).toBe(10);
    // the server teleports the player into `big` at its arrival point; the client does what GameScene does on a room change
    p.setArena(big); p.stop();
    const arrival = spawnBody(200, 1040);
    p.start(asPlayer(arrival, 9, big.id), 0);
    expect(p.pendingCount).toBe(0);
    const ref = spawnBody(200, 1040);
    for (let i = 0; i < 100; i++) { p.advance(TICK_MS, scripted(i)); stepBody(ref, scripted(i), big); }
    expect(p.predicted()!.x).toBeCloseTo(ref.x, 6); expect(p.predicted()!.y).toBeCloseTo(ref.y, 6);
  });
});
