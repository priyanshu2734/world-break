import { afterEach, describe, expect, it } from 'vitest';
import type { Socket } from 'socket.io-client';
import { AuthService } from '../../src/auth';
import { createGameServer, type GameServer } from '../../src/gateway';
import { MemoryProgressStore } from '../../src/store/memory';
import { ProgressService } from '../../src/store/service';
import { open, outcome } from './helpers';

const SITE = 'https://play.example.com';
let server: GameServer | null = null;
const sockets: Socket[] = [];
const mk = (port: number, origin?: string): Socket => { const s = open(port, origin ? { extraHeaders: { Origin: origin } } : {}); sockets.push(s); return s; };
afterEach(async () => { sockets.splice(0).forEach((s) => s.disconnect()); await server?.close(); server = null; });

const boot = async (enforce: boolean) => {
  const auth = new AuthService({ mode: 'dev', secret: 'test-secret-test-secret-test-secret-123', env: { NODE_ENV: 'test' } });
  server = createGameServer({ auth, progress: new ProgressService(new MemoryProgressStore()), publicOrigins: [SITE, 'https://alt.example.com'], enforceOrigins: enforce });
  return server.listen(0);
};
const login = (port: number, origin?: string) => fetch(`http://localhost:${port}/auth/login`, {
  method: 'POST', headers: { 'Content-Type': 'application/json', ...(origin ? { Origin: origin } : {}) }, body: JSON.stringify({ credential: 'Ann' }),
});

describe('P7 WebSocket origin check', () => {
  it('accepts the configured origins and a missing Origin header, refuses any other site', async () => {
    const port = await boot(true);
    expect(await outcome(mk(port, SITE))).toBe('connected');
    expect(await outcome(mk(port, 'https://alt.example.com'))).toBe('connected');
    expect(await outcome(mk(port))).toBe('connected'); // a non-browser client sends none
    expect(await outcome(mk(port, 'https://evil.example'))).not.toBe('connected');
    expect(await outcome(mk(port, 'http://play.example.com'))).not.toBe('connected'); // wrong scheme
    expect(await outcome(mk(port, 'null'))).not.toBe('connected');
  });
  it('is off when not enforced (development behind a proxy)', async () => {
    const port = await boot(false);
    expect(await outcome(mk(port, 'https://evil.example'))).toBe('connected');
  });
});

describe('P7 HTTP origin check and CORS', () => {
  it('refuses a state-changing call from another site, accepts the configured site', async () => {
    const port = await boot(true);
    const bad = await login(port, 'https://evil.example');
    expect(bad.status).toBe(403);
    expect(bad.headers.get('set-cookie')).toBeNull();
    const good = await login(port, SITE);
    expect(good.status).toBe(200);
    const none = await login(port); // curl and tests send no Origin
    expect(none.status).toBe(200);
  });
  it('echoes only a configured origin in Access-Control-Allow-Origin (never *)', async () => {
    const port = await boot(true);
    const alt = await fetch(`http://localhost:${port}/auth/config`, { headers: { Origin: 'https://alt.example.com' } });
    expect(alt.headers.get('access-control-allow-origin')).toBe('https://alt.example.com');
    expect(alt.headers.get('access-control-allow-credentials')).toBe('true');
    const evil = await fetch(`http://localhost:${port}/auth/config`, { headers: { Origin: 'https://evil.example' } });
    expect(evil.headers.get('access-control-allow-origin')).toBe(SITE); // the browser will not match this to the evil page
    expect(evil.headers.get('access-control-allow-origin')).not.toBe('*');
  });
  it('a DELETE of an account from another site is refused even with a valid token', async () => {
    const port = await boot(true);
    const ok = await login(port, SITE);
    const { token } = (await ok.json()) as { token: string };
    const del = await fetch(`http://localhost:${port}/auth/account`, { method: 'DELETE', headers: { Authorization: `Bearer ${token}`, Origin: 'https://evil.example' } });
    expect(del.status).toBe(403);
    const me = await fetch(`http://localhost:${port}/auth/me`, { headers: { Authorization: `Bearer ${token}` } });
    expect(me.status).toBe(200); // the account survived
  });
});
