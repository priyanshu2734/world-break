import { afterEach, describe, expect, it } from 'vitest';
import { io as connect, type Socket } from 'socket.io-client';
import { GameSnapshotSchema, RoomLayoutSchema, type Ack, type RoomLayout } from '@wb/shared';
import { createGameServer, type GameServer } from '../src/gateway';
import { DEMO_AT, DEMO_ROOM_IDS } from '../src/rooms/demoStage';

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
  const c = { s, id: '', layouts: [] as RoomLayout[], roomId: undefined as string | undefined, x: undefined as number | undefined, raw: [] as string[] };
  s.on('room:layout', (l: unknown) => { c.raw.push(JSON.stringify(l)); c.layouts.push(RoomLayoutSchema.parse(l)); });
  s.on('game:snapshot', (g: unknown) => {
    const snap = GameSnapshotSchema.parse(g);
    const me = snap.players.find((p) => p.id === c.id);
    c.roomId = me?.roomId; c.x = me?.x;
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

  it('the lock sampler (rooms: 2) is created with the six-room stage; only 1 and 2 are valid variants', async () => {
    const port = await boot(true);
    const a = client(port), b = client(port), c = client(port);
    expect((await emit(a.s, 'room:join', { name: 'A', rooms: 2 })).ok).toBe(true);
    await emit(a.s, 'room:start');
    await until(() => a.layouts.length === 1);
    expect(a.layouts[0]!.roomId).toBe('sampler.r0');
    expect(await emit(b.s, 'room:join', { name: 'B', rooms: 3 })).toEqual({ ok: false, error: 'Invalid join request' });
    expect(await emit(c.s, 'room:join', { name: 'C', rooms: false })).toMatchObject({ ok: true });
  });

  it('rejects a malformed flag', async () => {
    const port = await boot(true);
    const a = client(port);
    expect(await emit(a.s, 'room:join', { name: 'A', rooms: 'yes' })).toEqual({ ok: false, error: 'Invalid join request' });
  });

  it('a player who opens a door with E is sent the next room\'s layout, alone; the other player never receives it', async () => {
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

    // A walks to the locker, takes the key, walks to the door and opens it with E. Real time, real inputs.
    let seq = 0, moveX = 0;
    const timer = setInterval(() => a.s.emit('game:input', { seq: seq++, moveX, jump: false }), 50);
    const walkTo = async (x: number) => {
      for (;;) {
        await until(() => a.x !== undefined, 2000);
        if (Math.abs(a.x! - x) < 25) break;
        moveX = a.x! < x ? 1 : -1;
        await new Promise((r) => setTimeout(r, 25));
      }
      moveX = 0;
      await new Promise((r) => setTimeout(r, 250));
    };
    try {
      await walkTo(DEMO_AT.locker.x);
      expect((await emit(a.s, 'item:action', { action: 'open', stashId: 'demo_locker' })).ok).toBe(true);
      await new Promise((r) => setTimeout(r, 300));
      expect((await emit(a.s, 'item:action', { action: 'pickup', itemId: 'demo_key' })).ok).toBe(true);
      await walkTo(DEMO_AT.doorA.x);
      const locked = await emit(b.s, 'escape:action', { action: 'use_door', doorId: DEMO_AT.doorA.id });
      expect(locked.ok).toBe(false); // B is far from the door
      const opened = await emit(a.s, 'escape:action', { action: 'use_door', doorId: DEMO_AT.doorA.id });
      expect(opened.ok).toBe(true);
      await until(() => a.roomId === R1, 3000);
    } finally { clearInterval(timer); }
    await until(() => a.layouts.length === 2);
    expect(a.layouts[1]!.roomId).toBe(R1);
    expect(b.layouts).toHaveLength(1); // B stayed in room 0 and was told nothing about room 1
    expect(b.raw.join('')).not.toContain(R1);
    expect(b.roomId).toBe(R0);
  }, 30000);

  it('rejects a malformed escape request and answers one before the game starts', async () => {
    const port = await boot(true);
    const a = client(port);
    expect(await emit(a.s, 'escape:action', { action: 'read', clueId: 'x' })).toEqual({ ok: false, error: 'Join a room first' });
    await emit(a.s, 'room:join', { name: 'A', rooms: true });
    expect(await emit(a.s, 'escape:action', { action: 'teleport' })).toEqual({ ok: false, error: 'Invalid escape request' });
    expect(await emit(a.s, 'escape:action', { action: 'read', clueId: 'demo_log' })).toEqual({ ok: false, error: 'No stage is running.' });
  });
});
