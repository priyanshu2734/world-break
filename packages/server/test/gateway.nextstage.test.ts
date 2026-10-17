import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { io as connect, type Socket } from 'socket.io-client';
import { GameSnapshotSchema, RoomSnapshotSchema, StageStateSchema, type Ack, type StageState } from '@wb/shared';
import { createGameServer, type GameServer } from '../src/gateway';

let server: GameServer;
let port: number;
const clients: Socket[] = [];

interface C { s: Socket; id: string; states: StageState[]; phase: string; roomStage: number; gameStage: number; gamePhase: string }
async function join(code?: string): Promise<C & { code: string }> {
  const s = connect(`http://localhost:${port}`, { transports: ['websocket'], forceNew: true });
  clients.push(s);
  const c: C = { s, id: '', states: [], phase: 'lobby', roomStage: 0, gameStage: 0, gamePhase: '' };
  s.on('stage:state', (st: unknown) => { c.states.push(StageStateSchema.parse(st)); });
  s.on('room:state', (r: unknown) => { const p = RoomSnapshotSchema.parse(r); c.phase = p.phase; c.roomStage = p.stage; });
  s.on('game:snapshot', (g: unknown) => { const p = GameSnapshotSchema.parse(g); c.gameStage = p.stage; c.gamePhase = p.phase; });
  const ack = await new Promise<Ack<{ roomCode: string; playerId: string }>>((res) => s.emit('room:join', { name: 'T', roomCode: code }, res));
  if (!ack.ok) throw new Error(ack.error);
  c.id = ack.playerId;
  return Object.assign(c, { code: ack.roomCode });
}
const emit = <T extends object = object>(s: Socket, ev: string, p: unknown = {}) => new Promise<Ack<T>>((res) => s.emit(ev, p, res));
const until = async (pred: () => boolean, ms = 4000) => {
  const t0 = Date.now();
  while (!pred()) { if (Date.now() - t0 > ms) throw new Error('timeout'); await new Promise((r) => setTimeout(r, 10)); }
};
const last = (c: C) => c.states.at(-1)!;

async function startThree() {
  const a = await join();
  const b = await join(a.code); const c = await join(a.code);
  await emit(b.s, 'room:ready', { ready: true }); await emit(c.s, 'room:ready', { ready: true });
  await emit(a.s, 'room:start');
  await until(() => [a, b, c].every((x) => x.phase === 'playing' && x.states.length > 0));
  return { a, b, c, all: [a, b, c] };
}

beforeEach(async () => { server = createGameServer({ briefingTicks: 4 }); port = await server.listen(0); });
afterEach(async () => { clients.splice(0).forEach((x) => x.disconnect()); await server.close(); });

describe('room:nextStage over real sockets', () => {
  it('is refused while the stage is still running', async () => {
    const { a } = await startThree();
    expect(await emit(a.s, 'room:nextStage')).toEqual({ ok: false, error: 'There is no completed stage to advance from' });
  });

  it('is host-only; the host advances all three clients to stage 2 with identical state', async () => {
    const { a, b, c, all } = await startThree();
    const room = server.rooms.get(a.code)!;
    const revBefore = last(a).rev;
    room.phase = 'stage_complete'; // lifecycle shortcut: the genuine clear is proven in room.nextstage.test.ts

    expect(await emit(b.s, 'room:nextStage')).toEqual({ ok: false, error: 'Only the host can start the next stage' });
    expect(room.phase).toBe('stage_complete');

    expect(await emit(a.s, 'room:nextStage')).toEqual({ ok: true });
    await until(() => all.every((x) => x.roomStage === 2 && x.gameStage === 2 && x.phase === 'playing' && x.gamePhase === 'playing'));
    await until(() => all.every((x) => last(x).stageId !== 'tutorial_cold_start'));
    await new Promise((r) => setTimeout(r, 200)); // let the last reliable state land everywhere

    expect(last(a)).toEqual(last(b));
    expect(last(b)).toEqual(last(c));
    expect(last(a).rev).toBeGreaterThan(revBefore);
    expect(last(a).status).toBe('running');
    expect(last(a).players.map((p) => p.id).sort()).toEqual([a.id, b.id, c.id].sort());
    for (const x of all) for (let i = 1; i < x.states.length; i++) expect(x.states[i]!.rev).toBeGreaterThan(x.states[i - 1]!.rev);
  });

  it('never leaks the stage seed or run seed on the wire', async () => {
    const { a, all } = await startThree();
    const room = server.rooms.get(a.code)!;
    room.phase = 'stage_complete';
    await emit(a.s, 'room:nextStage');
    await until(() => all.every((x) => x.roomStage === 2 && x.phase === 'playing'));
    const seed = String(room.stageRecord!.seed);
    if (seed.length >= 8) for (const x of all) expect(JSON.stringify(x.states)).not.toContain(seed); // short seeds could collide with other numbers
  });
});
