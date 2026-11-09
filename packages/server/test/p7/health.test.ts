import { afterEach, describe, expect, it } from 'vitest';
import { createGameServer, type GameServer } from '../../src/gateway';
import { ack, open, outcome, raw, until } from './helpers';

let server: GameServer | null = null;
afterEach(async () => { await server?.close(); server = null; });

describe('P7 /healthz', () => {
  it('answers 200 with a tiny JSON body that holds no secrets and no player data', async () => {
    server = createGameServer({ briefingTicks: 3 });
    const port = await server.listen(0);
    const s = open(port);
    await outcome(s);
    const joined = await ack<{ ok: boolean; roomCode?: string }>(s, 'room:join', { name: 'Zelda' });
    expect(joined.ok).toBe(true);
    const r = await raw(port, '/healthz');
    expect(r.status).toBe(200);
    expect(r.headers['content-type']).toBe('application/json');
    expect(r.headers['cache-control']).toBe('no-store');
    const body = JSON.parse(r.body.toString()) as Record<string, unknown>;
    expect(Object.keys(body).sort()).toEqual(['status', 'storage', 'uptimeSeconds']);
    expect(body.status).toBe('ok');
    expect(body.storage).toBe('off'); // no progress store configured here
    expect(r.body.toString()).not.toContain('Zelda');
    expect(r.body.toString()).not.toContain(joined.roomCode ?? 'no-room');
    s.disconnect();
  });
  it('supports HEAD', async () => {
    server = createGameServer({});
    const port = await server.listen(0);
    const r = await raw(port, '/healthz', { method: 'HEAD' });
    expect(r.status).toBe(200);
    expect(r.body.length).toBe(0);
  });
  it('turns 503 while draining so the host stops routing here, and new players are refused', async () => {
    server = createGameServer({});
    const port = await server.listen(0);
    const early = open(port);
    expect(await outcome(early)).toBe('connected');
    server.drain();
    const r = await raw(port, '/healthz');
    expect(r.status).toBe(503);
    expect(JSON.parse(r.body.toString())).toMatchObject({ status: 'draining' });
    expect(await outcome(open(port))).toBe('server_restarting');
    const j = await ack<{ ok: boolean; error?: string }>(early, 'room:join', { name: 'Late' });
    expect(j.ok).toBe(false);
    expect(server.stats().draining).toBe(true);
    early.disconnect();
    await until(() => server!.stats().connections === 0);
  });
  it('is not charged against the HTTP rate limit (a host polls it often)', async () => {
    server = createGameServer({ limits: { httpPerMinutePerIp: 10 } });
    const port = await server.listen(0);
    for (let i = 0; i < 60; i++) expect((await raw(port, '/healthz')).status).toBe(200);
  });
});
