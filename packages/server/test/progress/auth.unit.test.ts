import { generateKeyPairSync, sign as cryptoSign, type KeyObject } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { AuthService, DevAuthProvider, GoogleAuthProvider, MAX_TOKEN_LENGTH, signToken, verifyToken, type Jwk } from '../../src/auth';
import { effectiveAuthMode, loadConfig } from '../../src/config';

const SECRET = 'unit-test-secret-unit-test-secret-123';
const NOW = 1_800_000_000;
const claims = { sub: 'acct-1', iat: NOW, exp: NOW + 3600 };

describe('P6 C session token', () => {
  it('a genuine token verifies and names only the account', () => {
    const t = signToken(SECRET, claims);
    expect(verifyToken(SECRET, t, NOW + 10)).toEqual(claims);
    expect(Object.keys(verifyToken(SECRET, t, NOW + 10)!).sort()).toEqual(['exp', 'iat', 'sub']); // no stage, score or unlock flag exists to edit
  });
  it('is refused when expired, from the future, or with an absurd lifetime', () => {
    expect(verifyToken(SECRET, signToken(SECRET, claims), NOW + 3600)).toBeNull();
    expect(verifyToken(SECRET, signToken(SECRET, { ...claims, iat: NOW + 1000, exp: NOW + 4600 }), NOW)).toBeNull();
    expect(verifyToken(SECRET, signToken(SECRET, { sub: 'a', iat: NOW, exp: NOW + 10 * 24 * 3600 }), NOW + 1)).toBeNull();
    expect(verifyToken(SECRET, signToken(SECRET, { sub: 'a', iat: NOW, exp: NOW - 5 }), NOW - 10)).toBeNull();
  });
  it('a forged token is refused: wrong secret, altered payload, altered signature, stripped signature', () => {
    const t = signToken(SECRET, claims);
    expect(verifyToken('another-secret-another-secret-123', t, NOW + 1)).toBeNull();
    const [p, payload, sig] = t.split('.') as [string, string, string];
    const forged = Buffer.from(JSON.stringify({ ...claims, sub: 'someone-else' })).toString('base64url');
    expect(verifyToken(SECRET, `${p}.${forged}.${sig}`, NOW + 1)).toBeNull();
    expect(verifyToken(SECRET, `${p}.${payload}.${sig.slice(0, -2)}AA`, NOW + 1)).toBeNull();
    expect(verifyToken(SECRET, `${p}.${payload}.`, NOW + 1)).toBeNull();
    expect(verifyToken(SECRET, `${p}.${payload}`, NOW + 1)).toBeNull();
  });
  it('is never trusting about shape: non-strings, junk, wrong prefix, extra claims, a huge token', () => {
    for (const bad of [undefined, null, 5, {}, [], '', 'abc', 'a.b.c', 'wb2.x.y', 'x'.repeat(MAX_TOKEN_LENGTH + 1)]) expect(verifyToken(SECRET, bad, NOW)).toBeNull();
    const extra = signToken(SECRET, { ...claims, admin: true } as unknown as typeof claims);
    expect(verifyToken(SECRET, extra, NOW + 1)).toBeNull();
  });
  it('AuthService issues short-lived tokens it can verify, and refuses its own expired ones', () => {
    let now = NOW * 1000;
    const a = new AuthService({ mode: 'dev', secret: SECRET, ttlSeconds: 120, env: { NODE_ENV: 'test' }, nowMs: () => now });
    const { token, expiresAt } = a.issue('acct-9');
    expect(a.verify(token)).toBe('acct-9');
    expect(expiresAt).toBe(now + 120_000);
    now += 121_000;
    expect(a.verify(token)).toBeNull();
    expect(a.verify('garbage')).toBeNull();
  });
  it('the ttl is clamped to between a minute and a day', () => {
    expect(new AuthService({ mode: 'off', ttlSeconds: 1, env: {} }).ttlSeconds).toBe(60);
    expect(new AuthService({ mode: 'off', ttlSeconds: 10 ** 9, env: {} }).ttlSeconds).toBe(86400);
  });
});

describe('P6 C production rules', () => {
  it('the dev provider is refused when NODE_ENV=production (provider and service)', () => {
    expect(() => new DevAuthProvider({ NODE_ENV: 'production' })).toThrow(/production/);
    expect(() => new AuthService({ mode: 'dev', secret: SECRET, env: { NODE_ENV: 'production' } })).toThrow();
    expect(() => new DevAuthProvider({ NODE_ENV: 'development' })).not.toThrow();
  });
  it('config refuses AUTH_MODE=dev in production, a missing secret in production, and google without a client id', () => {
    expect(() => loadConfig({ NODE_ENV: 'production', AUTH_MODE: 'dev', AUTH_SESSION_SECRET: 'x'.repeat(40) })).toThrow(/production/);
    expect(() => loadConfig({ NODE_ENV: 'production', AUTH_MODE: 'google', GOOGLE_CLIENT_ID: 'id' })).toThrow(/SECRET/);
    expect(() => loadConfig({ NODE_ENV: 'production', AUTH_MODE: 'google', GOOGLE_CLIENT_ID: 'id', AUTH_SESSION_SECRET: 'short' })).toThrow();
    expect(() => loadConfig({ AUTH_MODE: 'google' })).toThrow(/GOOGLE_CLIENT_ID/);
    expect(loadConfig({ NODE_ENV: 'production', AUTH_MODE: 'google', GOOGLE_CLIENT_ID: 'id', AUTH_SESSION_SECRET: 'x'.repeat(40) }).AUTH_MODE).toBe('google');
    expect(() => loadConfig({ NODE_ENV: 'production' })).not.toThrow(); // guests only needs no secret
  });
  it('a production service with sign-in on needs a 32+ character secret', () => {
    expect(() => new AuthService({ mode: 'google', googleClientId: 'id', env: { NODE_ENV: 'production' } })).toThrow(/SECRET/);
    expect(() => new AuthService({ mode: 'google', googleClientId: 'id', secret: 'x'.repeat(32), env: { NODE_ENV: 'production' } })).not.toThrow();
  });
  it('the default mode is google only when a client id is set, otherwise guests only', () => {
    expect(effectiveAuthMode({ AUTH_MODE: undefined, GOOGLE_CLIENT_ID: undefined })).toBe('off');
    expect(effectiveAuthMode({ AUTH_MODE: undefined, GOOGLE_CLIENT_ID: 'x' })).toBe('google');
    expect(effectiveAuthMode({ AUTH_MODE: 'dev', GOOGLE_CLIENT_ID: 'x' })).toBe('dev');
  });
});

describe('P6 C dev provider', () => {
  const p = new DevAuthProvider({ NODE_ENV: 'test' });
  it('turns a name into a stable subject and a clean display name', async () => {
    expect(await p.verify('Ann Lee')).toEqual({ provider: 'dev', subject: 'ann-lee', displayName: 'Ann Lee' });
    expect((await p.verify('  ANN   LEE '))!.subject).toBe('ann-lee');
    expect((await p.verify('<b>Bo</b>'))!.displayName).not.toMatch(/[<>]/);
  });
  it('refuses an empty or symbol-only name and never throws', async () => {
    for (const bad of ['', '   ', '<<>>', '!!!', '\u0000\u0001']) expect(await p.verify(bad), JSON.stringify(bad)).toBeNull();
    expect((await p.verify('x'.repeat(500)))!.displayName.length).toBeLessThanOrEqual(16);
  });
});

// ---- Google: tested with locally generated keys; NOT run against the real Google ----
const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url');
function makeGoogle(now = NOW * 1000) {
  const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const jwk = { ...(publicKey.export({ format: 'jwk' }) as Jwk), kid: 'k1', alg: 'RS256', use: 'sig' } as Jwk;
  let fetched = 0;
  const provider = new GoogleAuthProvider('client-123', async () => { fetched++; return { keys: [jwk] }; }, () => now);
  const idToken = (payload: Record<string, unknown>, o: { key?: KeyObject; header?: Record<string, unknown> } = {}) => {
    const h = b64({ alg: 'RS256', kid: 'k1', typ: 'JWT', ...(o.header ?? {}) }), body = b64(payload);
    return `${h}.${body}.${cryptoSign('RSA-SHA256', Buffer.from(`${h}.${body}`), o.key ?? privateKey).toString('base64url')}`;
  };
  const good = { iss: 'https://accounts.google.com', aud: 'client-123', exp: NOW + 600, sub: '109876', name: 'Gina Google', email: 'gina@example.com' };
  return { provider, idToken, good, fetched: () => fetched };
}
describe('P6 C Google ID token verification (local keys)', () => {
  it('accepts a genuine token, keeps only the subject and the name (the email is never read)', async () => {
    const g = makeGoogle();
    const id = await g.provider.verify(g.idToken(g.good));
    expect(id).toEqual({ provider: 'google', subject: '109876', displayName: 'Gina Google' });
    expect(JSON.stringify(id)).not.toContain('example.com');
  });
  it('accepts both issuer spellings and caches the keys', async () => {
    const g = makeGoogle();
    expect(await g.provider.verify(g.idToken({ ...g.good, iss: 'accounts.google.com' }))).not.toBeNull();
    expect(await g.provider.verify(g.idToken(g.good))).not.toBeNull();
    expect(g.fetched()).toBe(1);
  });
  it('refuses: another app’s audience, another issuer, expired, no subject, wrong key, alg none, unknown kid, junk', async () => {
    const g = makeGoogle();
    const other = generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey;
    const cases: string[] = [
      g.idToken({ ...g.good, aud: 'someone-elses-app' }), g.idToken({ ...g.good, iss: 'https://evil.example' }), g.idToken({ ...g.good, exp: NOW - 100 }),
      g.idToken({ ...g.good, sub: '' }), g.idToken({ ...g.good, sub: undefined }), g.idToken(g.good, { key: other }), g.idToken(g.good, { header: { alg: 'none' } }),
      g.idToken(g.good, { header: { kid: 'unknown' } }), g.idToken(g.good, { header: { alg: 'HS256' } }), 'not.a.jwt', 'abc', '', 'a.b', `${b64({ alg: 'none' })}.${b64(g.good)}.`,
    ];
    for (const c of cases) expect(await g.provider.verify(c), c.slice(0, 40)).toBeNull();
    expect(await g.provider.verify('x'.repeat(5000))).toBeNull();
  });
  it('a tampered payload (valid signature of the old one) is refused', async () => {
    const g = makeGoogle();
    const [h, , s] = g.idToken(g.good).split('.') as [string, string, string];
    expect(await g.provider.verify(`${h}.${b64({ ...g.good, sub: 'admin' })}.${s}`)).toBeNull();
  });
  it('needs a client id and survives a failing key fetch', async () => {
    expect(() => new GoogleAuthProvider('')).toThrow();
    const failing = new GoogleAuthProvider('c', async () => { throw new Error('network'); });
    expect(await failing.verify('a.b.c')).toBeNull();
  });
});
