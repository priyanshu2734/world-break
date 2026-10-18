import { afterEach, describe, expect, it } from 'vitest';
import { io as connect, type Socket } from 'socket.io-client';
import { ABILITY_LAB_ARENA, GameSnapshotSchema, type Ack, type RoomSnapshot } from '@wb/shared';
import { createGameServer, type GameServer } from '../src/gateway';
import { loadConfig } from '../src/config';

let server: GameServer | null = null;
const clients: Socket[] = [];
afterEach(async () => { clients.splice(0).forEach((c) => c.disconnect()); await server?.close(); server = null; });

const boot = async (abilityLab?: boolean) => {
  server = createGameServer({ briefingTicks: 3, ...(abilityLab === undefined ? {} : { abilityLab }) });
  return server.listen(0);
};
const emit = <T extends object = object>(s: Socket, ev: string, p: unknown = {}) => new Promise<Ack<T>>((res) => s.emit(ev, p, res));
function client(port: number) {
  const s = connect(`http://localhost:${port}`, { transports: ['websocket'], forceNew: true });
  clients.push(s);
  const c = { s, room: null as RoomSnapshot | null, arenaId: '' };
  s.on('room:state', (r: RoomSnapshot) => { c.room = r; });
  s.on('game:snapshot', (g: unknown) => { c.arenaId = GameSnapshotSchema.parse(g).arenaId; }); // contract check on every snapshot
  return c;
}
const until = async (pred: () => boolean, ms = 3000) => {
  const t0 = Date.now();
  while (!pred()) { if (Date.now() - t0 > ms) throw new Error('timeout'); await new Promise((r) => setTimeout(r, 10)); }
};

describe('opening the Ability Lab through the gateway', () => {
  it('is refused with a clear message when the server flag is off (default)', async () => {
    const port = await boot();
    const a = client(port);
    const r = await emit(a.s, 'room:join', { name: 'A', lab: true });
    expect(r).toEqual({ ok: false, error: 'The Ability Lab is not enabled on this server (start it with ABILITY_LAB=1).' });
  });
  it('creates a Lab room when the flag is on and the client asks for it; the room advertises it', async () => {
    const port = await boot(true);
    const a = client(port);
    const r = await emit<{ roomCode: string }>(a.s, 'room:join', { name: 'A', lab: true });
    expect(r.ok).toBe(true);
    await until(() => a.room !== null);
    expect(a.room!.lab).toBe(true);
    // a second player joins the same room by code (lab flag not needed) and sees the Lab too
    const b = client(port);
    const code = (r as { roomCode: string }).roomCode;
    expect((await emit(b.s, 'room:join', { name: 'B', roomCode: code })).ok).toBe(true);
    await until(() => b.room?.lab === true);
    // start it: the live game runs on the Lab arena
    await emit(b.s, 'room:ready', { ready: true });
    expect((await emit(a.s, 'room:start')).ok).toBe(true);
    await until(() => a.arenaId !== '');
    expect(a.arenaId).toBe(ABILITY_LAB_ARENA.id);
  });
  it('without the lab flag a room is a normal room even on a lab-enabled server', async () => {
    const port = await boot(true);
    const a = client(port);
    expect((await emit(a.s, 'room:join', { name: 'A' })).ok).toBe(true);
    await until(() => a.room !== null);
    expect(a.room!.lab).toBeUndefined();
    const b = client(port);
    expect((await emit(b.s, 'room:join', { name: 'B', lab: false })).ok).toBe(true);
    await until(() => b.room !== null);
    expect(b.room!.lab).toBeUndefined();
  });
  it('the flag only matters when creating: joining an existing room by code ignores it, even when the server flag is off', async () => {
    const port = await boot(false);
    const a = client(port);
    const r = await emit<{ roomCode: string }>(a.s, 'room:join', { name: 'A' });
    const b = client(port);
    expect((await emit(b.s, 'room:join', { name: 'B', roomCode: (r as { roomCode: string }).roomCode, lab: true })).ok).toBe(true);
    await until(() => b.room !== null);
    expect(b.room!.lab).toBeUndefined();
  });
  it('rejects a malformed flag', async () => {
    const port = await boot(true);
    const a = client(port);
    expect(await emit(a.s, 'room:join', { name: 'A', lab: 'yes' })).toEqual({ ok: false, error: 'Invalid join request' });
  });
});

describe('ABILITY_LAB environment variable', () => {
  it('accepts only 0 or 1, and is absent by default', () => {
    expect(loadConfig({}).ABILITY_LAB).toBeUndefined();
    expect(loadConfig({ ABILITY_LAB: '1' }).ABILITY_LAB).toBe('1');
    expect(loadConfig({ ABILITY_LAB: '0' }).ABILITY_LAB).toBe('0');
    expect(() => loadConfig({ ABILITY_LAB: 'yes' })).toThrow();
  });
});
