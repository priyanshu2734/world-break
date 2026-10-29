import { afterEach, describe, expect, it } from 'vitest';
import { io as connect, type Socket } from 'socket.io-client';
import { DeathStateSchema, GhostPingSchema, GameSnapshotSchema, type Ack, type DeathState, type GhostPing, type GameSnapshot } from '@wb/shared';
import { createGameServer, type GameServer } from '../../src/gateway';
import type { GameSim } from '../../src/game';

let server: GameServer | null = null;
const clients: Socket[] = [];
afterEach(async () => { clients.splice(0).forEach((c) => c.disconnect()); await server?.close(); server = null; });

const emit = <T extends object = object>(s: Socket, ev: string, p: unknown = {}) => new Promise<Ack<T>>((res) => s.emit(ev, p, res));
function client(port: number) {
  const s = connect(`http://localhost:${port}`, { transports: ['websocket'], forceNew: true });
  clients.push(s);
  const c = { s, id: '', states: [] as DeathState[], pings: [] as GhostPing[], snaps: [] as GameSnapshot[] };
  s.on('death:state', (d: unknown) => { c.states.push(DeathStateSchema.parse(d)); });
  s.on('ghost:ping', (p: unknown) => { c.pings.push(GhostPingSchema.parse(p)); });
  s.on('game:snapshot', (g: unknown) => { c.snaps.push(GameSnapshotSchema.parse(g)); });
  return c;
}
const until = async (pred: () => boolean, ms = 4000) => {
  const t0 = Date.now();
  while (!pred()) { if (Date.now() - t0 > ms) throw new Error('timeout'); await new Promise((r) => setTimeout(r, 10)); }
};

async function boot() {
  server = createGameServer({ briefingTicks: 3, escapeStages: true, ghostStages: true });
  const port = await server.listen(0);
  const a = client(port), b = client(port);
  const ja = await emit<{ roomCode: string; playerId: string }>(a.s, 'room:join', { name: 'A', ghost: 2 });
  if (!ja.ok) throw new Error(ja.error);
  a.id = ja.playerId;
  const jb = await emit<{ roomCode: string; playerId: string }>(b.s, 'room:join', { name: 'B', roomCode: ja.roomCode });
  if (!jb.ok) throw new Error(jb.error);
  b.id = jb.playerId;
  await emit(b.s, 'room:ready', { ready: true });
  expect((await emit(a.s, 'room:start')).ok).toBe(true);
  const room = server.rooms.get(ja.roomCode)!;
  await until(() => room.phase === 'playing');
  return { a, b, room };
}

describe('P4 spectating through the gateway', () => {
  it('a dead player is told they are dead and whom they watch; can follow and ping over the socket; the living get the ping; the living are refused', async () => {
    const { a, b, room } = await boot();
    const sim = (room as unknown as { sim: GameSim }).sim;
    sim.placeAt(a.id, 600, 680); sim.placeAt(b.id, 700, 680);
    const me = (id: string) => room.gameSnapshot()!.players.find((p) => p.id === id)!;
    for (let i = 0; i < 1500 && !room.deathSystem!.isDead(a.id); i++) {
      if (i % 100 === 0) { const q = me(a.id); room.ghostSystem!.placeForTest('g0', { room: q.roomId!, x: q.x - 60, y: q.y - 22, angle: 0, state: 'hunting' }); }
      room.tick();
    }
    expect(room.deathSystem!.isDead(a.id)).toBe(true);
    await until(() => a.states.some((s) => s.life === 'downed' && s.following?.id === b.id));
    const last = a.states.at(-1)!;
    expect(last.watchable.map((w) => w.id)).toEqual([b.id]);
    expect(b.states.at(-1)?.life ?? 'alive').toBe('alive');

    // follow: refused for yourself and for the living caller; accepted for a teammate
    expect(await emit(a.s, 'spectate:follow', { target: a.id })).toEqual({ ok: false, error: 'You cannot watch that player.' });
    expect(await emit(a.s, 'spectate:follow', { target: 'next' })).toEqual({ ok: true, message: 'Watching B.' });
    expect(await emit(a.s, 'spectate:follow', { bogus: 1 })).toEqual({ ok: false, error: 'Invalid request' });
    expect(await emit(b.s, 'spectate:follow', { target: 'next' })).toEqual({ ok: false, error: 'You are not dead.' });
    expect(await emit(b.s, 'spectate:ping')).toEqual({ ok: false, error: 'You are not dead.' });

    // ping: B sees the ghost, A pings, B receives it with the server's position
    room.deathSystem!.setLethal(false);
    const q = me(b.id);
    room.ghostSystem!.placeForTest('g0', { room: q.roomId!, x: q.x + 90, y: q.y - 22, angle: 0, state: 'roaming' });
    const r = await emit(a.s, 'spectate:ping');
    expect(r).toEqual({ ok: true, message: 'Ghost here.' });
    await until(() => b.pings.length > 0 && a.pings.length > 0);
    expect(b.pings[0]).toMatchObject({ room: q.roomId, from: 'A' });
    expect(await emit(a.s, 'spectate:ping')).toEqual({ ok: false, error: 'Too fast.' });

    // what the dead player's snapshot holds: no stage secrets
    await until(() => a.snaps.length > 0);
    expect(a.snaps.at(-1)!.players.length).toBeLessThanOrEqual(2);
  });
});
