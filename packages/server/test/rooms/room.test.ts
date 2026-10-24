import { describe, expect, it } from 'vitest';
import { GameSnapshotSchema, RoomLayoutSchema, type RoomLayout } from '@wb/shared';
import { Room } from '../../src/room';
import { DEMO_AT, DEMO_ROOM_IDS } from '../../src/rooms/demoStage';
import { expectOk, fetchItem, itemAct, setup, useDoor } from './flows';

const [R0, R1] = DEMO_ROOM_IDS;
let seq = 0;
function roomsRoom(n = 2): Room {
  const r = new Room('ABCD', 3, 7, { rooms: true });
  for (let i = 0; i < n; i++) r.join(`p${i}`, `P${i}`);
  for (let i = 1; i < n; i++) r.setReady(`p${i}`, true);
  expect(r.start('p0').ok).toBe(true);
  for (let i = 0; i < 10 && r.phase !== 'playing'; i++) r.tick();
  return r;
}
const roomIdOf = (r: Room, id: string) => r.gameSnapshot()!.players.find((p) => p.id === id)!.roomId;
function walk(r: Room, id: string, moveX: -1 | 1, ticks: number, until?: () => boolean): void {
  for (let i = 0; i < ticks; i++) { r.submitInput(id, ++seq, { moveX, jump: false }); r.tick(); if (until?.()) return; }
}

describe('P3D rooms through the real Room', () => {
  it('stage 1 of a rooms room is the dark multi-room demo; everyone starts in room 0 and each gets only that layout', () => {
    const r = roomsRoom(3);
    expect(r.stage).toBe(1);
    const snap = GameSnapshotSchema.parse(r.gameSnapshot());
    expect(snap.arenaId).toBe(R0);
    expect(snap.players.every((p) => p.roomId === R0)).toBe(true);
    const out = r.drainLayouts();
    expect(out.map((o) => o.playerId).sort()).toEqual(['p0', 'p1', 'p2']);
    for (const o of out) { expect(RoomLayoutSchema.safeParse(o.layout).success).toBe(true); expect(o.layout.roomId).toBe(R0); }
    expect(r.drainLayouts()).toEqual([]); // drained
    expect(r.consumeStageState()?.darkness?.ambient).toBeGreaterThan(0); // the demo stage is dark: ambient from stage and mode
  });

  it('a room without the flag is the ordinary stage 1: no room ids, no layouts', () => {
    const r = new Room('ABCD', 3, 7, {});
    r.join('p0', 'P0');
    expect(r.start('p0').ok).toBe(true);
    for (let i = 0; i < 10 && r.phase !== 'playing'; i++) r.tick();
    expect(r.gameSnapshot()!.players[0]!.roomId).toBeUndefined();
    expect(r.drainLayouts()).toEqual([]);
  });

  it('passing a door (opened with E, with a key) queues the new room\'s layout for THAT player only', () => {
    const p = setup(true, 2);
    p.room.drainLayouts();
    const a = p.bots[0]!;
    a.goTo(DEMO_AT.locker.x, DEMO_AT.locker.y);
    expectOk(itemAct(p, { action: 'open', stashId: 'demo_locker' }));
    expectOk(fetchItem(p, a, 'demo_key'));
    expectOk(useDoor(p, a, DEMO_AT.doorA.id));
    p.team.waitForRoom('p0', R1);
    expect(p.team.roomOf('p0')).toBe(R1);
    expect(p.team.roomOf('p1')).toBe(R0);
    const out = p.room.drainLayouts();
    expect(out).toHaveLength(1);
    expect(out[0]!.playerId).toBe('p0');
    const layout: RoomLayout = out[0]!.layout;
    expect(layout.roomId).toBe(R1);
    expect(layout.arena.height).toBe(1080);
    expect(layout.doors).toHaveLength(2);
  });

  it('stage content lives in the start room: from another room every stage action is refused as "not part of this run"', () => {
    const r = roomsRoom(1);
    walk(r, 'p0', 1, 400, () => roomIdOf(r, 'p0') === R1);
    const res = r.stageAction('p0', { kind: 'interact', entityId: 'sync_console' } as never);
    expect(res.ok).toBe(false);
  });

  it('restarting the stage (reset) sends everyone back to room 0 and re-queues the start layout', () => {
    const r = roomsRoom(2);
    walk(r, 'p0', 1, 400, () => roomIdOf(r, 'p0') === R1);
    r.drainLayouts();
    expect(r.resetArena('p0').ok).toBe(true);
    expect(r.gameSnapshot()!.players.every((p) => p.roomId === R0)).toBe(true);
    expect(r.drainLayouts().map((o) => o.layout.roomId)).toEqual([R0, R0]);
  });
});
