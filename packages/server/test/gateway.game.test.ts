import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { io as connect, type Socket } from 'socket.io-client';
import { ARENA, GameSnapshotSchema, type Ack, type GameSnapshot, type RoomSnapshot } from '@wb/shared';
import { createGameServer, type GameServer } from '../src/gateway';

let server: GameServer;
let port: number;
const clients: Socket[] = [];

interface TestClient { s: Socket; id: string; last: GameSnapshot | null; room: RoomSnapshot | null }
async function join(code?: string, name = 'T'): Promise<TestClient & { code: string }> {
  const s = connect(`http://localhost:${port}`, { transports: ['websocket'], forceNew: true });
  clients.push(s);
  const c: TestClient = { s, id: '', last: null, room: null };
  s.on('game:snapshot', (g: unknown) => { c.last = GameSnapshotSchema.parse(g); }); // contract check on every snapshot
  s.on('room:state', (r: RoomSnapshot) => { c.room = r; });
  const ack = await new Promise<Ack<{ roomCode: string; playerId: string }>>((res) => s.emit('room:join', { name, roomCode: code }, res));
  if (!ack.ok) throw new Error(ack.error);
  c.id = ack.playerId;
  return Object.assign(c, { code: ack.roomCode });
}
const emit = (s: Socket, ev: string, p: unknown = {}) => new Promise<Ack>((res) => s.emit(ev, p, res));
const until = async (pred: () => boolean, ms = 3000) => {
  const t0 = Date.now();
  while (!pred()) { if (Date.now() - t0 > ms) throw new Error('timeout waiting for condition'); await new Promise((r) => setTimeout(r, 10)); }
};
const me = (c: TestClient, from: TestClient = c) => from.last?.players.find((p) => p.id === c.id);

async function startRun(n: number) {
  const host = await join(undefined, 'Host');
  const others: TestClient[] = [];
  for (let i = 1; i < n; i++) {
    const o = await join(host.code, `P${i}`);
    await emit(o.s, 'room:ready', { ready: true });
    others.push(o);
  }
  const all = [host, ...others];
  expect((await emit(host.s, 'room:start')).ok).toBe(true);
  await until(() => all.every((c) => c.last?.phase === 'playing'));
  return { host, others, all };
}

beforeEach(async () => { server = createGameServer({ briefingTicks: 4 }); port = await server.listen(0); });
afterEach(async () => { clients.splice(0).forEach((c) => c.disconnect()); await server.close(); });

describe('gameplay over real sockets', () => {
  it.each([1, 2, 3, 4])('starts and streams snapshots to every member with %i player(s)', async (n) => {
    const { all } = await startRun(n);
    for (const c of all) {
      expect(c.last!.players).toHaveLength(n);
      expect(c.last!.arenaId).toBe(ARENA.id);
      expect(c.last!.stage).toBe(1);
    }
    // each player sits at their own distinct spawn
    expect(new Set(all[0]!.last!.players.map((p) => p.x)).size).toBe(n);
  });

  it('streams at ~20 Hz', async () => {
    const { host } = await startRun(1);
    const t0 = host.last!.tick;
    await new Promise((r) => setTimeout(r, 1000));
    const ticks = host.last!.tick - t0;
    expect(ticks).toBeGreaterThanOrEqual(15);
    expect(ticks).toBeLessThanOrEqual(25);
  });

  it('server moves a player from input intents and every client sees the same position', async () => {
    const { host, others } = await startRun(2);
    const guest = others[0]!;
    const x0 = me(guest)!.x;
    let seq = 0;
    const timer = setInterval(() => guest.s.emit('game:input', { seq: seq++, moveX: 1, jump: false }), 50);
    await until(() => me(guest, host)!.x > x0 + 60);
    clearInterval(timer);
    await until(() => me(guest, host)!.vx === 0); // stops once inputs stop
    await new Promise((r) => setTimeout(r, 150));
    expect(me(guest, host)!.x).toBeCloseTo(me(guest)!.x, 1); // both clients agree
    expect(me(host)!.x).toBe(ARENA.spawns[0]!.x); // host untouched
  });

  it('rejects malformed and hostile input without moving the player', async () => {
    const { host } = await startRun(1);
    const x0 = me(host)!.x;
    for (const bad of [{ seq: 0, moveX: 99, jump: false }, { seq: -1, moveX: 1, jump: false }, { moveX: 1 }, 'x', null,
      { seq: 1, moveX: 1, jump: 'yes' }]) host.s.emit('game:input', bad);
    await new Promise((r) => setTimeout(r, 300));
    expect(me(host)!.x).toBe(x0);
  });

  it('cannot walk through the world boundary', async () => {
    const { host } = await startRun(1);
    let seq = 0;
    const timer = setInterval(() => host.s.emit('game:input', { seq: seq++, moveX: -1, jump: false }), 50);
    await until(() => me(host)!.x <= 14 + 0.01, 5000);
    await new Promise((r) => setTimeout(r, 300));
    clearInterval(timer);
    expect(me(host)!.x).toBe(14);
  });

  it('shows a disconnected teammate as disconnected and keeps simulating', async () => {
    const { host, others } = await startRun(3);
    const gone = others[1]!;
    gone.s.disconnect();
    await until(() => me(gone, host)?.connected === false);
    expect(host.last!.players).toHaveLength(3);
    const t = host.last!.tick;
    await until(() => host.last!.tick > t + 3);
  });

  it('reset: host-only, restores spawn state, bumps epoch, drops disconnected players', async () => {
    const { host, others } = await startRun(3);
    const [b, c] = others as [TestClient, TestClient];
    let seq = 0;
    const timer = setInterval(() => b.s.emit('game:input', { seq: seq++, moveX: 1, jump: true }), 50);
    await until(() => me(b, host)!.x > ARENA.spawns[1]!.x + 40);
    clearInterval(timer);
    c.s.disconnect();
    await until(() => me(c, host)?.connected === false);

    expect((await emit(b.s, 'game:reset')).ok).toBe(false); // not host
    expect((await emit(host.s, 'game:reset')).ok).toBe(true);
    await until(() => host.last!.epoch === 1 && host.last!.players.length === 2);
    await until(() => host.last!.tick <= 2);
    const p = me(b, host)!;
    expect(p.x).toBe(ARENA.spawns[1]!.x);
    expect(p.y).toBe(ARENA.spawns[1]!.y);
    expect(host.room!.players.map((x) => x.id).sort()).toEqual([host.id, b.id].sort());
  });

  it('deletes the room only when the last player disconnects mid-run', async () => {
    const { host, others } = await startRun(2);
    others[0]!.s.disconnect();
    await new Promise((r) => setTimeout(r, 150));
    expect(server.rooms.count).toBe(1);
    host.s.disconnect();
    await new Promise((r) => setTimeout(r, 150));
    expect(server.rooms.count).toBe(0);
  });
});
