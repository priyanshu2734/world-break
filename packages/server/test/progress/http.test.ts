import { afterEach, describe, expect, it } from 'vitest';
import { AuthSessionSchema, type Profile } from '@wb/shared';
import { MemoryProgressStore } from '../../src/store/memory';
import { boot, login, stop, type Harness } from './helpers';

let h: Harness | null = null;
afterEach(async () => { await stop(h); h = null; });
const url = (p: string) => `http://localhost:${h!.port}${p}`;
const json = (b: unknown) => ({ method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b) });

describe('P6 C sign-in over HTTP (dev provider)', () => {
  it('config tells the client the mode; login returns the server’s own token, an httpOnly cookie and the account’s profile', async () => {
    h = await boot();
    expect(await (await fetch(url('/auth/config'))).json()).toEqual({ mode: 'dev' });
    const { res, body } = await login(h, 'Ann');
    expect(res.status).toBe(200);
    const s = AuthSessionSchema.parse(body);
    expect(s.profile).toMatchObject({ signedIn: true, name: 'Ann', highestStage: 1, unlocked: ['easy'], rewards: [], save: null, storage: 'ok' });
    expect(h.auth.verify(s.token)).not.toBeNull();
    const cookie = res.headers.get('set-cookie')!;
    expect(cookie).toMatch(/^wb_session=wb1\./);
    expect(cookie).toMatch(/HttpOnly/);
    expect(cookie).toMatch(/SameSite=Strict/);
    expect(cookie).not.toMatch(/Secure/); // not production
    expect(res.headers.get('cache-control')).toBe('no-store');
  });
  it('the token contains nothing but an account id: no name, stage or unlock', async () => {
    h = await boot();
    const { token } = await login(h, 'Ann');
    const payload = JSON.parse(Buffer.from(token.split('.')[1]!, 'base64url').toString());
    expect(Object.keys(payload).sort()).toEqual(['exp', 'iat', 'sub']);
  });
  it('the same name signs into the same account every time; another name is another account', async () => {
    h = await boot();
    const a = await login(h, 'Ann'), b = await login(h, 'Ann'), c = await login(h, 'Bo');
    expect(h.auth.verify(a.token)).toBe(h.auth.verify(b.token));
    expect(h.auth.verify(a.token)).not.toBe(h.auth.verify(c.token));
    expect((h.store as MemoryProgressStore).size).toBe(2);
  });
  it('refuses bad credentials, bad bodies, wrong content type, GET, and does not leak details', async () => {
    h = await boot();
    expect((await fetch(url('/auth/login'), json({ credential: '' }))).status).toBe(400);
    expect((await fetch(url('/auth/login'), json({ credential: '!!!' }))).status).toBe(401);
    expect((await fetch(url('/auth/login'), json({ credential: 'a', extra: 1 }))).status).toBe(400);
    expect((await fetch(url('/auth/login'), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{nope' })).status).toBe(400);
    expect((await fetch(url('/auth/login'), { method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: 'a' })).status).toBe(415);
    expect((await fetch(url('/auth/login'), json({ credential: 'x'.repeat(9000) }))).status).toBe(400);
    expect((await fetch(url('/auth/login'))).status).toBe(404);
    const bad = await fetch(url('/auth/login'), json({ credential: '!!!' }));
    expect(await bad.json()).toEqual({ error: 'Sign-in failed.' });
  });
  it('a body over 8 KB is refused', async () => {
    h = await boot();
    const r = await fetch(url('/auth/login'), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ credential: 'a', pad: 'x'.repeat(20_000) }) });
    expect(r.status).toBe(400);
  });
  it('is rate limited per address', async () => {
    h = await boot();
    let limited = 0;
    for (let i = 0; i < 40; i++) if ((await fetch(url('/auth/login'), json({ credential: '!!!' }))).status === 429) limited++;
    expect(limited).toBeGreaterThan(5);
  });
  it('with sign-in off, login does not exist and the config says so (guests only)', async () => {
    h = await boot({ mode: 'off' });
    expect(await (await fetch(url('/auth/config'))).json()).toEqual({ mode: 'off' });
    expect((await fetch(url('/auth/login'), json({ credential: 'Ann' }))).status).toBe(404);
  });
  it('answers CORS preflights for the configured browser origin, with credentials', async () => {
    h = await boot();
    const r = await fetch(url('/auth/login'), { method: 'OPTIONS' });
    expect(r.status).toBe(204);
    expect(r.headers.get('access-control-allow-origin')).toBe('http://localhost:5173');
    expect(r.headers.get('access-control-allow-credentials')).toBe('true');
  });
  it('storage down at sign-in: a clear 503 that still tells the player they can play as a guest', async () => {
    h = await boot({ store: null });
    const r = await fetch(url('/auth/login'), json({ credential: 'Ann' }));
    expect(r.status).toBe(503);
    expect(((await r.json()) as { error: string }).error).toMatch(/guest/);
  });
});

describe('P6 C session: me, refresh, logout', () => {
  it('/auth/me works with the Bearer token or the cookie, not with junk', async () => {
    h = await boot();
    const { token, res } = await login(h, 'Ann');
    const bearer = await fetch(url('/auth/me'), { headers: { Authorization: `Bearer ${token}` } });
    expect(((await bearer.json()) as { profile: Profile }).profile.name).toBe('Ann');
    const cookie = res.headers.get('set-cookie')!.split(';')[0]!;
    expect((await fetch(url('/auth/me'), { headers: { Cookie: cookie } })).status).toBe(200);
    expect((await fetch(url('/auth/me'), { headers: { Authorization: 'Bearer junk' } })).status).toBe(401);
    expect((await fetch(url('/auth/me'))).status).toBe(401);
    expect((await fetch(url('/auth/me'), { headers: { Cookie: 'wb_session=wb1.a.b' } })).status).toBe(401);
  });
  it('refresh issues a new token for a valid Bearer token only (a cookie alone cannot trigger it)', async () => {
    h = await boot();
    const { token, res } = await login(h, 'Ann');
    const r = await fetch(url('/auth/refresh'), { method: 'POST', headers: { Authorization: `Bearer ${token}` } });
    expect(r.status).toBe(200);
    const next = AuthSessionSchema.parse(await r.json());
    expect(h.auth.verify(next.token)).toBe(h.auth.verify(token));
    const cookie = res.headers.get('set-cookie')!.split(';')[0]!;
    expect((await fetch(url('/auth/refresh'), { method: 'POST', headers: { Cookie: cookie } })).status).toBe(401);
    expect((await fetch(url('/auth/refresh'), { method: 'POST' })).status).toBe(401);
  });
  it('logout clears the cookie', async () => {
    h = await boot();
    const r = await fetch(url('/auth/logout'), { method: 'POST' });
    expect(r.headers.get('set-cookie')).toMatch(/Max-Age=0/);
  });
  it('an expired token is refused (the clock moves, not the test)', async () => {
    h = await boot();
    const { token } = await login(h, 'Ann');
    const exp = JSON.parse(Buffer.from(token.split('.')[1]!, 'base64url').toString()).exp as number;
    expect(h.auth.verify(token)).not.toBeNull();
    const later = new (h.auth.constructor as typeof import('../../src/auth').AuthService)({ mode: 'dev', secret: 'test-secret-test-secret-test-secret-123', env: { NODE_ENV: 'test' }, nowMs: () => (exp + 5) * 1000 });
    expect(later.verify(token)).toBeNull();
  });
});

describe('P6 C delete my account and data', () => {
  it('needs the Bearer token (a cookie alone is refused, so another site cannot trigger it)', async () => {
    h = await boot();
    const { res } = await login(h, 'Ann');
    const cookie = res.headers.get('set-cookie')!.split(';')[0]!;
    expect((await fetch(url('/auth/account'), { method: 'DELETE', headers: { Cookie: cookie } })).status).toBe(401);
    expect((await fetch(url('/auth/account'), { method: 'DELETE' })).status).toBe(401);
    expect((h.store as MemoryProgressStore).size).toBe(1);
  });
  it('removes the account, its results and its save; the token stops working; signing in again starts from scratch', async () => {
    h = await boot();
    const { token } = await login(h, 'Ann');
    const id = h.auth.verify(token)!;
    h.progress.recordClear(id, { stage: 24, mode: 'easy', ticks: 10, score: 10, players: 1, deaths: 0 }, { stage: 25, mode: 'easy', seedBase: 1, variety: [], upgrades: {}, pickOrder: [] });
    await h.progress.idle();
    expect((await h.store.getAccount(id))!.highestStage).toBe(25);
    const del = await fetch(url('/auth/account'), { method: 'DELETE', headers: { Authorization: `Bearer ${token}` } });
    expect(del.status).toBe(200);
    expect(del.headers.get('set-cookie')).toMatch(/Max-Age=0/);
    expect(await h.store.getAccount(id)).toBeNull();
    expect(await h.store.getRunSave(id)).toBeNull();
    expect(await h.store.listResults(id, 10)).toEqual([]);
    expect((await fetch(url('/auth/me'), { headers: { Authorization: `Bearer ${token}` } })).status).toBe(401); // the token names an account that is gone
    expect((await fetch(url('/auth/refresh'), { method: 'POST', headers: { Authorization: `Bearer ${token}` } })).status).toBe(401);
    expect((await fetch(url('/auth/account'), { method: 'DELETE', headers: { Authorization: `Bearer ${token}` } })).status).toBe(404);
    const again = AuthSessionSchema.parse((await login(h, 'Ann')).body);
    expect(again.profile.highestStage).toBe(1);
  });
});
