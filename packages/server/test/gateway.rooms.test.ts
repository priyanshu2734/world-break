import { afterEach, describe, expect, it } from 'vitest';
import { io as connect, type Socket } from 'socket.io-client';
import { GameSnapshotSchema, RoomLayoutSchema, type Ack, type RoomLayout } from '@wb/shared';
import { createGameServer, type GameServer } from '../src/gateway';
import { DEMO_ROOM_IDS } from '../src/rooms/demoStage';

const [R0, R1] = DEMO_ROOM_IDS;
let server: GameServer | null = null;
const clients: Socket[] = [];
afterEach(async () => { clients.splice(0).forEach((c) => c.disconnect()); await server?.close(); server = null; });

const boot = async (escapeStages?: boolean) => {
  server = createGameServer({ briefingTicks: 3, ...(escapeStages === undefined ? {} : { escapeStages }) });
  return server.listen(0);
};
const emit = <T extends object = object>(s: Socket, ev: string, p: unknown = {}) => new Promise<Ack<T>>((res) => s.emit(ev, p, res));
function client(port: number) {
  const s = connect(`http://localhost:${port}`, { transports: ['websocket'], forceNew: true });
  clients.push(s);
  const c = { s, id: '', layouts: [] as RoomLayout[], roomId: undefined as string | undefined, raw: [] as string[] };
  s.on('room:layout', (l: unknown) => { c.raw.push(JSON.stringify(l)); c.layouts.push(RoomLayoutSchema.parse(l)); });
  s.on('game:snapshot', (g: unknown) => {
    const snap = GameSnapshotSchema.parse(g);
    c.roomId = snap.players.find((p) => p.id === c.id)?.roomId;
  });
  return c;
}
const until = async (pred: () => boolean, ms = 3000) => {
  const t0 = Date.now();
  while (!pred()) { if (Date.now() - t0 > ms) throw new Error('timeout'); await new Promise((r) => setTimeout(r, 10)); }
};

describe('P3D rooms through the gateway', () => {
  it('the demo is refused unless escape stages are enabled', async () => {
    const port = await boot();
    const a = client(port);
    expect(await emit(a.s, 'room:join', { name: 'A', rooms: true })).toEqual({ ok: false, error: 'Escape stages are not enabled on this server (ESCAPE_STAGES is 0).' });
  });

  it('rejects a malformed flag', async () => {
    const port = await boot(true);
    const a = client(port);
    expect(await emit(a.s, 'room:join', { name: 'A', rooms: 'yes' })).toEqual({ ok: false, error: 'Invalid join request' });
  });

  it('a player walking through a door is sent the next room\'s layout, alone; the other player never receives it', async () => {
    const port = await boot(true);
    const a = client(port), b = client(port);
    const ja = await emit<{ roomCode: string; playerId: string }>(a.s, 'room:join', { name: 'A', rooms: true });
    expect(ja.ok).toBe(true);
    a.id = (ja as { playerId: string }).playerId;
    const jb = await emit<{ playerId: string }>(b.s, 'room:join', { name: 'B', roomCode: (ja as { roomCode: string }).roomCode });
    b.id = (jb as { playerId: string }).playerId;
    await emit(b.s, 'room:ready', { ready: true });
    expect((await emit(a.s, 'room:start')).ok).toBe(true);
    await until(() => a.layouts.length === 1 && b.layouts.length === 1);
    expect(a.layouts[0]!.roomId).toBe(R0);
    expect(b.layouts[0]!.roomId).toBe(R0);
    await until(() => a.roomId === R0 && b.roomId === R0);

    let seq = 0;
    const timer = setInterval(() => a.s.emit('game:input', { seq: seq++, moveX: 1, jump: false }), 50);
    try { await until(() => a.roomId === R1, 12000); } finally { clearInterval(timer); }
    await until(() => a.layouts.length === 2);
    expect(a.layouts[1]!.roomId).toBe(R1);
    expect(b.layouts).toHaveLength(1); // B stayed in room 0 and was told nothing about room 1
    expect(b.raw.join('')).not.toContain(R1);
    expect(b.roomId).toBe(R0);
  }, 20000);
});
