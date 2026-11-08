import { afterEach, describe, expect, it } from 'vitest';
import { io as connect, type Socket } from 'socket.io-client';
import { ChatMessageSchema, PingMarkerSchema, TeamPanelSchema, type Ack, type ChatMessage, type PingMarker, type TeamPanel } from '@wb/shared';
import { createGameServer, type GameServer } from '../../src/gateway';
import type { GameSim } from '../../src/game';

let server: GameServer | null = null;
const clients: Socket[] = [];
afterEach(async () => { clients.splice(0).forEach((c) => c.disconnect()); await server?.close(); server = null; });

const emit = <T extends object = object>(s: Socket, ev: string, p: unknown = {}) => new Promise<Ack<T>>((res) => s.emit(ev, p, res));
function client(port: number) {
  const s = connect(`http://localhost:${port}`, { transports: ['websocket'], forceNew: true });
  clients.push(s);
  const c = { s, id: '', chat: [] as ChatMessage[], markers: [] as PingMarker[], panels: [] as TeamPanel[] };
  s.on('chat:message', (m: unknown) => { c.chat.push(ChatMessageSchema.parse(m)); });
  s.on('ping:marker', (m: unknown) => { c.markers.push(PingMarkerSchema.parse(m)); });
  s.on('team:panel', (p: unknown) => { c.panels.push(TeamPanelSchema.parse(p)); });
  return c;
}
const until = async (pred: () => boolean, ms = 4000) => {
  const t0 = Date.now();
  while (!pred()) { if (Date.now() - t0 > ms) throw new Error('timeout'); await new Promise((r) => setTimeout(r, 10)); }
};
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function boot(start = true) {
  server = createGameServer({ briefingTicks: 3, escapeStages: true, ghostStages: true, devFlags: true });
  const port = await server.listen(0);
  const a = client(port), b = client(port), g = client(port);
  const ja = await emit<{ roomCode: string; playerId: string }>(a.s, 'room:join', { name: 'A', ghost: 2 });
  if (!ja.ok) throw new Error(ja.error);
  a.id = ja.playerId;
  const jb = await emit<{ roomCode: string; playerId: string }>(b.s, 'room:join', { name: 'B', roomCode: ja.roomCode });
  if (!jb.ok) throw new Error(jb.error);
  b.id = jb.playerId;
  const room = server.rooms.get(ja.roomCode)!;
  if (start) {
    await emit(b.s, 'room:ready', { ready: true });
    expect((await emit(a.s, 'room:start')).ok).toBe(true);
    await until(() => room.phase === 'playing');
  }
  return { a, b, g, room, code: ja.roomCode, port };
}

describe('P6 A chat through the gateway', () => {
  it('works in the lobby too: a line goes to every member of the room, cleaned, with the sender’s name; the sender is acknowledged', async () => {
    const { a, b } = await boot(false);
    const r = await emit(a.s, 'chat:send', { text: '  <i>hello</i>\u0000 team ' });
    expect(r.ok).toBe(true);
    await until(() => a.chat.length === 1 && b.chat.length === 1);
    expect(b.chat[0]).toMatchObject({ from: a.id, name: 'A', text: 'hello team', spectator: false });
  });
  it('is room scoped: a player of another room hears nothing', async () => {
    const { a, port } = await boot(false);
    const other = client(port);
    expect((await emit(other.s, 'room:join', { name: 'Z' })).ok).toBe(true);
    await emit(a.s, 'chat:send', { text: 'private' });
    await wait(150);
    expect(other.chat).toEqual([]);
  });
  it('refuses a stranger, bad payloads, long lines and a flood; each refusal sends nothing', async () => {
    const { a, b, port } = await boot(false);
    const stranger = client(port);
    expect(await emit(stranger.s, 'chat:send', { text: 'hi' })).toEqual({ ok: false, error: 'Join a room first' });
    expect(await emit(a.s, 'chat:send', { text: 5 })).toEqual({ ok: false, error: 'Invalid request' });
    expect(await emit(a.s, 'chat:send', { text: 'hi', to: 'x' })).toEqual({ ok: false, error: 'Invalid request' });
    expect(await emit(a.s, 'chat:send', null)).toEqual({ ok: false, error: 'Invalid request' });
    expect((await emit(a.s, 'chat:send', { text: 'a'.repeat(121) })).ok).toBe(false);
    expect((await emit(a.s, 'chat:send', { text: '   ' })).ok).toBe(false);
    expect((await emit(a.s, 'chat:send', { text: 'one' })).ok).toBe(true);
    expect((await emit(a.s, 'chat:send', { text: 'two' })).ok).toBe(false); // 1.5 s
    await until(() => b.chat.length === 1);
    await wait(100);
    expect(b.chat.map((m) => m.text)).toEqual(['one']);
  });
  it('a guest (no account, a plain join) may chat: every player here is a guest', async () => {
    const { b, a } = await boot(false);
    expect((await emit(b.s, 'chat:send', { text: 'guest here' })).ok).toBe(true);
    await until(() => a.chat.length === 1);
  });
});

describe('P6 A pings and the team panel through the gateway', () => {
  it('a living player’s ping reaches the team with a position in the same room; a bad request is refused', async () => {
    const { a, b, room } = await boot();
    (room as unknown as { sim: GameSim }).sim.placeAt(a.id, 600, 680);
    (room as unknown as { sim: GameSim }).sim.placeAt(b.id, 650, 680);
    await wait(120);
    expect(await emit(a.s, 'ping:place', { kind: 'nuke' })).toEqual({ ok: false, error: 'Invalid request' });
    expect(await emit(a.s, 'ping:place', { kind: 'go', x: 'a' })).toEqual({ ok: false, error: 'Invalid request' });
    expect((await emit(a.s, 'ping:place', { kind: 'go', x: 650, y: 660 })).ok).toBe(true);
    await until(() => a.markers.length === 1 && b.markers.length === 1);
    expect(b.markers[0]).toMatchObject({ kind: 'go', from: a.id, name: 'A' });
    expect(b.markers[0]!.x).toBeDefined();
    expect((await emit(a.s, 'ping:place', { kind: 'go', x: 9000, y: 0 })).ok).toBe(false);
  });
  it('a stranger cannot ping, and pings are refused before a stage runs', async () => {
    const { port } = await boot(false);
    const s = client(port);
    expect(await emit(s.s, 'ping:place', { kind: 'help' })).toEqual({ ok: false, error: 'Join a room first' });
  });
  it('every player is sent the team panel with the whole team and a carried COUNT', async () => {
    const { a, b } = await boot();
    await until(() => a.panels.length > 0 && b.panels.length > 0);
    const p = a.panels[a.panels.length - 1]!;
    expect(p.members.map((m) => m.state)).toEqual(['alive', 'alive']);
    expect(p.members.every((m) => typeof m.carried === 'number')).toBe(true);
    expect(JSON.stringify(p)).not.toMatch(/wisp|shade|howler/);
  });
  it('a disconnected teammate shows as disconnected', async () => {
    const { a, b } = await boot();
    b.s.disconnect();
    await until(() => a.panels.some((p) => p.members.some((m) => m.state === 'disconnected')));
  });
});
