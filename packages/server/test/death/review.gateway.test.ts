import { afterEach, describe, expect, it } from 'vitest';
import { io as connect, type Socket } from 'socket.io-client';
import { DeathReviewMsgSchema, type Ack, type DeathReviewMsg, type RoomSnapshot } from '@wb/shared';
import { createGameServer, type GameServer } from '../../src/gateway';
import type { GameSim } from '../../src/game';

let server: GameServer | null = null;
const clients: Socket[] = [];
afterEach(async () => { clients.splice(0).forEach((c) => c.disconnect()); await server?.close(); server = null; });

const emit = <T extends object = object>(s: Socket, ev: string, p: unknown = {}) => new Promise<Ack<T>>((res) => s.emit(ev, p, res));
function client(port: number) {
  const s = connect(`http://localhost:${port}`, { transports: ['websocket'], forceNew: true });
  clients.push(s);
  const c = { s, id: '', reviews: [] as DeathReviewMsg[], phases: [] as string[] };
  s.on('death:review', (d: unknown) => { c.reviews.push(DeathReviewMsgSchema.parse(d)); });
  s.on('room:state', (r: RoomSnapshot) => { c.phases.push(r.phase); });
  return c;
}
const until = async (pred: () => boolean, ms = 6000) => {
  const t0 = Date.now();
  while (!pred()) { if (Date.now() - t0 > ms) throw new Error('timeout'); await new Promise((r) => setTimeout(r, 10)); }
};

describe('P4 step 4: wipe, review and retry through the gateway', () => {
  it('after the wipe beat each player is sent their OWN review; only the host can retry; the same stage restarts on a new seed', async () => {
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
    const sim = (room as unknown as { sim: GameSim }).sim;
    const me = (id: string) => room.gameSnapshot()!.players.find((p) => p.id === id)!;
    sim.placeAt(a.id, 600, 680); sim.placeAt(b.id, 1500, 680);
    const killOne = (id: string) => {
      for (let i = 0; i < 1500 && !room.deathSystem!.isDead(id); i++) {
        if (i % 100 === 0) { const q = me(id); room.ghostSystem!.placeForTest('g0', { room: q.roomId!, x: q.x - 60, y: q.y - 22, angle: 0, state: 'hunting' }); }
        room.tick();
      }
      expect(room.deathSystem!.isDead(id)).toBe(true);
    };
    killOne(a.id);
    for (let i = 0; i < 100; i++) room.tick();
    killOne(b.id);
    for (let i = 0; i < 400 && room.phase === 'playing'; i++) room.tick();
    expect(room.phase).toBe('team_wiped');
    const firstSeed = room.stageRecord!.seed;
    // the gateway's own loop runs the wipe beat (3 s) and then sends the reviews
    await until(() => a.reviews.length > 0 && b.reviews.length > 0);
    expect(room.phase).toBe('death_review');
    expect(a.phases).toContain('death_review');
    expect(a.reviews[0]!.yours!.name).toBe('A');
    expect(b.reviews[0]!.yours!.name).toBe('B');
    expect(a.reviews[0]).toMatchObject({ stage: 2, attempt: 0, wiped: true });
    expect(JSON.stringify(a.reviews[0])).not.toContain('"player":"' + b.id + '"');
    // retry: refused for the non-host, accepted for the host
    expect(await emit(b.s, 'room:retry')).toEqual({ ok: false, error: 'Only the host can retry the stage' });
    expect((await emit(a.s, 'room:retry')).ok).toBe(true);
    expect(room.stage).toBe(2);
    expect(room.stageRecord!.attempt).toBe(1);
    expect(room.stageRecord!.seed).not.toBe(firstSeed);
    await until(() => room.phase === 'playing');
    expect(room.deathSystem!.lifeOf(a.id)).toBe('alive');
    expect(room.deathSystem!.lifeOf(b.id)).toBe('alive');
    expect(a.reviews).toHaveLength(1); // nothing more is sent after the retry
  });
});
