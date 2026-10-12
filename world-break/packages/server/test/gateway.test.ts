import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { io as connect, type Socket } from 'socket.io-client';
import type { Ack, RoomSnapshot } from '@wb/shared';
import { createGameServer, type GameServer } from '../src/gateway';

let server: GameServer;
let port: number;
const clients: Socket[] = [];

const client = () => {
  const s = connect(`http://localhost:${port}`, { transports: ['websocket'], forceNew: true });
  clients.push(s);
  return s;
};
const emit = <T = object>(s: Socket, ev: string, payload: unknown) =>
  new Promise<Ack<T extends object ? T : object>>((res) => s.emit(ev, payload, res));
const nextState = (s: Socket, pred: (r: RoomSnapshot) => boolean = () => true) =>
  new Promise<RoomSnapshot>((res) => {
    const h = (snap: RoomSnapshot) => { if (pred(snap)) { s.off('room:state', h); res(snap); } };
    s.on('room:state', h);
  });

beforeEach(async () => { server = createGameServer(); port = await server.listen(0); });
afterEach(async () => { clients.splice(0).forEach((c) => c.disconnect()); await server.close(); });

describe('socket gateway (real sockets)', () => {
  it('lets two real clients share a room and start a run', async () => {
    const a = client(); const b = client();
    const ja = await emit<{ roomCode: string }>(a, 'room:join', { name: 'Ada' });
    expect(ja.ok).toBe(true);
    const code = (ja as { roomCode: string }).roomCode;

    const twoPlayers = nextState(a, (s) => s.players.length === 2);
    const jb = await emit(b, 'room:join', { name: 'Bo', roomCode: code });
    expect(jb.ok).toBe(true);
    expect((await twoPlayers).players.map((p) => p.name)).toEqual(['Ada', 'Bo']);

    expect((await emit(a, 'room:start', {})).ok).toBe(false); // Bo not ready
    await emit(b, 'room:ready', { ready: true });
    const briefing = nextState(b, (s) => s.phase === 'briefing');
    expect((await emit(a, 'room:start', {})).ok).toBe(true);
    expect((await briefing).phase).toBe('briefing');
  });

  it('rejects malformed payloads and locked difficulty, and non-host start', async () => {
    const a = client(); const b = client();
    expect((await emit(a, 'room:join', { name: '' })).ok).toBe(false);
    const ja = (await emit<{ roomCode: string }>(a, 'room:join', { name: 'Ada' })) as { roomCode: string };
    await emit(b, 'room:join', { name: 'Bo', roomCode: ja.roomCode });
    expect((await emit(a, 'room:setDifficulty', { difficulty: 'hardcore' })).ok).toBe(false);
    expect((await emit(b, 'room:start', {})).ok).toBe(false);
  });

  it('requires joining before acting and removes empty rooms on disconnect', async () => {
    const a = client();
    expect((await emit(a, 'room:ready', { ready: true })).ok).toBe(false);
    await emit(a, 'room:join', { name: 'Ada' });
    expect(server.rooms.count).toBe(1);
    a.disconnect();
    await new Promise((r) => setTimeout(r, 100));
    expect(server.rooms.count).toBe(0);
  });
});
