import { describe, expect, it } from 'vitest';
import { assertDeployable, isStrongSecret, loadConfig, publicOrigins } from '../../src/config';

const SECRET = 'q8Zr2LmV5xTn0cYb7HdW3uKe9PaJf4Gs';
const prod = (extra: NodeJS.ProcessEnv = {}) => ({ NODE_ENV: 'production', PUBLIC_ORIGIN: 'https://play.example.com', ...extra });
const deploy = (env: NodeJS.ProcessEnv) => assertDeployable(loadConfig(env), env);

describe('P7 production configuration', () => {
  it('accepts a complete guests-only production config (no secret needed when sign-in is off)', () => {
    expect(() => deploy(prod())).not.toThrow();
  });
  it('accepts a complete production config with Google sign-in', () => {
    expect(() => deploy(prod({ AUTH_MODE: 'google', GOOGLE_CLIENT_ID: 'id.apps.example', AUTH_SESSION_SECRET: SECRET }))).not.toThrow();
  });
  it('refuses AUTH_MODE=dev', () => {
    expect(() => deploy(prod({ AUTH_MODE: 'dev', AUTH_SESSION_SECRET: SECRET }))).toThrow(/AUTH_MODE=dev/);
  });
  it('refuses DEV_FLAGS=1 (it used to be ignored with a warning)', () => {
    expect(() => deploy(prod({ DEV_FLAGS: '1' }))).toThrow(/DEV_FLAGS/);
    expect(() => deploy(prod({ DEV_FLAGS: '0' }))).not.toThrow();
  });
  it('refuses a missing or weak session secret when sign-in is on', () => {
    const g = { AUTH_MODE: 'google', GOOGLE_CLIENT_ID: 'id' };
    expect(() => deploy(prod(g))).toThrow(/AUTH_SESSION_SECRET/);
    expect(() => deploy(prod({ ...g, AUTH_SESSION_SECRET: 'a'.repeat(40) }))).toThrow(/AUTH_SESSION_SECRET/);
    expect(() => deploy(prod({ ...g, AUTH_SESSION_SECRET: 'change-me-change-me-change-me-change-me' }))).toThrow(/AUTH_SESSION_SECRET/);
    expect(() => deploy(prod({ ...g, AUTH_SESSION_SECRET: 'short-but-valid-length' }))).toThrow(/AUTH_SESSION_SECRET/);
  });
  it('refuses a secret that is set but weak even when sign-in is off', () => {
    expect(() => deploy(prod({ AUTH_SESSION_SECRET: 'x'.repeat(40) }))).toThrow(/weak/);
  });
  it('requires an explicit https public origin (http only for localhost), and no wildcard', () => {
    expect(() => deploy({ NODE_ENV: 'production' })).toThrow(/PUBLIC_ORIGIN/);
    expect(() => deploy(prod({ PUBLIC_ORIGIN: 'http://play.example.com' }))).toThrow(/https/);
    expect(() => deploy(prod({ PUBLIC_ORIGIN: '*' }))).toThrow(/PUBLIC_ORIGIN/);
    expect(() => deploy(prod({ PUBLIC_ORIGIN: 'http://localhost:3001' }))).not.toThrow();
    expect(() => deploy({ NODE_ENV: 'production', CORS_ORIGIN: 'https://play.example.com' })).not.toThrow(); // the older name still works
  });
  it('lists every problem at once and never prints a secret', () => {
    const weak = `secret-${'a'.repeat(40)}`;
    const env = prod({ DEV_FLAGS: '1', AUTH_MODE: 'google', GOOGLE_CLIENT_ID: 'id', AUTH_SESSION_SECRET: weak, PUBLIC_ORIGIN: 'http://play.example.com' });
    let msg = '';
    try { deploy(env); } catch (e) { msg = e instanceof Error ? e.message : ''; }
    expect(msg).toMatch(/DEV_FLAGS/);
    expect(msg).toMatch(/AUTH_SESSION_SECRET/);
    expect(msg).toMatch(/https/);
    expect(msg).not.toContain(weak);
    expect(msg).not.toContain('a'.repeat(20));
  });
  it('is a no-op outside production', () => {
    expect(() => deploy({ DEV_FLAGS: '1', AUTH_MODE: 'dev' })).not.toThrow();
  });
});

describe('P7 configuration values', () => {
  it('has safe defaults and validates the new variables', () => {
    const c = loadConfig({});
    expect(c).toMatchObject({ TRUST_PROXY: 0, CSP_MODE: 'enforce', MAX_CONNECTIONS: 400, MAX_CONNECTIONS_PER_IP: 12, MAX_ROOMS: 120 });
    expect(() => loadConfig({ TRUST_PROXY: '9' })).toThrow();
    expect(() => loadConfig({ CSP_MODE: 'maybe' })).toThrow();
    expect(() => loadConfig({ MAX_ROOMS: '0' })).toThrow();
  });
  it('PUBLIC_ORIGIN wins over CORS_ORIGIN and may list several origins', () => {
    expect(publicOrigins(loadConfig({ PUBLIC_ORIGIN: 'https://a.example, https://b.example', CORS_ORIGIN: 'http://x.example' }))).toEqual(['https://a.example', 'https://b.example']);
    expect(publicOrigins(loadConfig({ CORS_ORIGIN: 'http://x.example' }))).toEqual(['http://x.example']);
    expect(publicOrigins(loadConfig({}))).toEqual(['http://localhost:5173']);
  });
  it('isStrongSecret', () => {
    expect(isStrongSecret(SECRET)).toBe(true);
    expect(isStrongSecret(undefined)).toBe(false);
    expect(isStrongSecret('a'.repeat(64))).toBe(false);
    expect(isStrongSecret('replace-with-a-long-random-string-0123')).toBe(false);
  });
});
