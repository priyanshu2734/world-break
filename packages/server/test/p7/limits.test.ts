import { afterEach, describe, expect, it } from 'vitest';
import type { Socket } from 'socket.io-client';
import { createGameServer, type GameServer } from '../../src/gateway';
import { ack, open, outcome, raw, sleep, until } from './helpers';

let server: GameServer | null = null;
const sockets: Socket[] = [];
const mk = (port: number, headers?: Record<string, string>): Socket => { const s = open(port, headers ? { extraHeaders: headers } : {}); sockets.push(s); return s; };
afterEach(async () => { sockets.splice(0).forEach((s) => s.disconnect()); await server?.close(); server = null; });

describe('P7 connection caps', () => {
  it('caps connections per address, and frees the slot when one disconnects', async () => {
    server = createGameServer({ limits: { maxConnectionsPerIp: 2 } });
    const port = await server.listen(0);
    const a = mk(port), b = mk(port);
    expect(await outcome(a)).toBe('connected');
    expect(await outcome(b)).toBe('connected');
    expect(await outcome(mk(port))).toBe('too_many_connections');
    a.disconnect();
    await until(() => server!.stats().connections === 1);
    expect(await outcome(mk(port))).toBe('connected');
  });
  it('caps connections globally', async () => {
    server = createGameServer({ limits: { maxConnections: 2 } });
    const port = await server.listen(0);
    expect(await outcome(mk(port))).toBe('connected');
    expect(await outcome(mk(port))).toBe('connected');
    expect(await outcome(mk(port))).toBe('server_busy');
  });
  it('without trusted proxies a client cannot dodge the per-address cap by sending X-Forwarded-For', async () => {
    server = createGameServer({ trustProxy: 0, limits: { maxConnectionsPerIp: 1 } });
    const port = await server.listen(0);
    expect(await outcome(mk(port, { 'X-Forwarded-For': '1.1.1.1' }))).toBe('connected');
    expect(await outcome(mk(port, { 'X-Forwarded-For': '2.2.2.2' }))).toBe('too_many_connections');
  });
  it('behind one trusted proxy each forwarded address has its own cap', async () => {
    server = createGameServer({ trustProxy: 1, limits: { maxConnectionsPerIp: 1 } });
    const port = await server.listen(0);
    expect(await outcome(mk(port, { 'X-Forwarded-For': '1.1.1.1' }))).toBe('connected');
    expect(await outcome(mk(port, { 'X-Forwarded-For': '2.2.2.2' }))).toBe('connected');
    expect(await outcome(mk(port, { 'X-Forwarded-For': '1.1.1.1' }))).toBe('too_many_connections');
  });
});

describe('P7 room and join limits', () => {
  it('stops creating rooms at the global cap but still lets people join an existing room', async () => {
    server = createGameServer({ limits: { maxRooms: 1 } });
    const port = await server.listen(0);
    const a = mk(port), b = mk(port), c = mk(port);
    await Promise.all([outcome(a), outcome(b), outcome(c)]);
    const first = await ack<{ ok: boolean; roomCode?: string }>(a, 'room:join', { name: 'A' });
    expect(first.ok).toBe(true);
    const second = await ack<{ ok: boolean; error?: string }>(b, 'room:join', { name: 'B' });
    expect(second.ok).toBe(false);
    expect(second.error).toMatch(/full/);
    const third = await ack<{ ok: boolean }>(c, 'room:join', { name: 'C', roomCode: first.roomCode });
    expect(third.ok).toBe(true);
  });
  it('limits join attempts per address per minute', async () => {
    server = createGameServer({ limits: { joinsPerMinutePerIp: 3 } }); // burst = 3
    const port = await server.listen(0);
    const results: string[] = [];
    for (let i = 0; i < 6; i++) {
      const s = mk(port);
      await outcome(s);
      const r = await ack<{ ok: boolean; error?: string }>(s, 'room:join', { name: `P${i}` });
      results.push(r.ok ? 'ok' : r.error ?? '');
    }
    expect(results.slice(0, 3)).toEqual(['ok', 'ok', 'ok']);
    expect(results.slice(3).every((r) => /Too many join attempts/.test(r))).toBe(true);
  });
});

describe('P7 per-event limits', () => {
  it('refuses events over the budget with an ack (the handler does not run) and the budget refills', async () => {
    server = createGameServer({ limits: { eventLimits: true } });
    const port = await server.listen(0);
    const s = mk(port);
    await outcome(s);
    const replies: string[] = [];
    await Promise.all(Array.from({ length: 20 }, () => ack<{ ok: boolean; error?: string }>(s, 'ping:place', {}).then((r) => { replies.push(r.error ?? 'ok'); })));
    expect(replies.filter((r) => r === 'Slow down.').length).toBeGreaterThanOrEqual(10); // burst for ping:place is 6
    expect(replies.filter((r) => r === 'Join a room first').length).toBeGreaterThanOrEqual(1);
    await sleep(700); // 4 per second refill
    const later = await ack<{ ok: boolean; error?: string }>(s, 'ping:place', {});
    expect(later.error).toBe('Join a room first');
  });
  it('disconnects a socket that floods', async () => {
    server = createGameServer({ limits: { eventLimits: true } });
    const port = await server.listen(0);
    const s = mk(port);
    await outcome(s);
    let reason = '';
    s.on('disconnect', (r: string) => { reason = r; });
    for (let i = 0; i < 600; i++) s.emit(`junk:${i}`, { i });
    await until(() => reason !== '');
    expect(reason).toBe('io server disconnect');
    await until(() => server!.stats().connections === 0);
  });
  it('a normal burst of game input is not limited', async () => {
    server = createGameServer({ limits: { eventLimits: true } });
    const port = await server.listen(0);
    const s = mk(port);
    await outcome(s);
    let dropped = false;
    s.on('disconnect', () => { dropped = true; });
    for (let i = 0; i < 100; i++) s.emit('game:input', { seq: i + 1, moveX: 1, jump: false });
    await sleep(150);
    expect(dropped).toBe(false);
  });
  it('closes a connection that sends an oversized message (16 KB cap)', async () => {
    server = createGameServer({ limits: { eventLimits: true } });
    const port = await server.listen(0);
    const s = mk(port);
    await outcome(s);
    let reason = '';
    s.on('disconnect', (r: string) => { reason = r; });
    s.emit('chat:send', { text: 'x'.repeat(100_000) });
    await until(() => reason !== '');
    expect(reason).not.toBe('');
  });
});

describe('P7 HTTP rate limit', () => {
  it('answers 429 with Retry-After when one address sends too many page or API requests', async () => {
    server = createGameServer({ limits: { httpPerMinutePerIp: 60 } }); // burst = 20
    const port = await server.listen(0);
    const statuses: number[] = [];
    let retry: unknown;
    for (let i = 0; i < 60; i++) {
      const r = await raw(port, '/nothing-here');
      statuses.push(r.status);
      if (r.status === 429) retry = r.headers['retry-after'];
    }
    expect(statuses.slice(0, 20).every((x) => x === 404)).toBe(true);
    expect(statuses).toContain(429);
    expect(retry).toBe('30');
  });
  it('the /auth routes have their own per-address limit', async () => {
    server = createGameServer({});
    const port = await server.listen(0);
    const statuses: number[] = [];
    for (let i = 0; i < 90; i++) statuses.push((await raw(port, '/auth/config')).status);
    expect(statuses).toContain(429);
    expect(statuses[0]).toBe(200);
  });
});
