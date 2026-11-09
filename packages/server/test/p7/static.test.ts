import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { gunzipSync } from 'node:zlib';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createGameServer, type GameServer } from '../../src/gateway';
import { open, outcome, raw, tempDir } from './helpers';

const INDEX = '<!doctype html><title>t</title><div id="game"></div>';
const BIG_JS = 'console.log("world-break");\n'.repeat(200);

let server: GameServer | null = null;
let tmp: ReturnType<typeof tempDir> | null = null;
let port = 0;

beforeEach(async () => {
  tmp = tempDir('wb-static-');
  mkdirSync(join(tmp.dir, 'dist', 'assets'), { recursive: true });
  writeFileSync(join(tmp.dir, 'dist', 'index.html'), INDEX);
  writeFileSync(join(tmp.dir, 'dist', 'assets', 'app-1a2b3c.js'), BIG_JS);
  writeFileSync(join(tmp.dir, 'dist', 'favicon.ico'), 'ico');
  writeFileSync(join(tmp.dir, 'dist', '.env'), 'SECRET=do-not-serve');
  writeFileSync(join(tmp.dir, 'secret.txt'), 'outside the web root');
  server = createGameServer({ staticDir: join(tmp.dir, 'dist'), csp: 'enforce', publicOrigins: ['http://localhost:3001'] });
  port = await server.listen(0);
});
afterEach(async () => { await server?.close(); server = null; tmp?.remove(); tmp = null; });

describe('P7 static client serving', () => {
  it('serves the page at / with no-cache, the right type and the security headers', async () => {
    const r = await raw(port, '/');
    expect(r.status).toBe(200);
    expect(r.body.toString()).toBe(INDEX);
    expect(r.headers['content-type']).toBe('text/html; charset=utf-8');
    expect(r.headers['cache-control']).toBe('no-cache');
    expect(r.headers['x-content-type-options']).toBe('nosniff');
    expect(String(r.headers['content-security-policy'])).toMatch(/default-src 'self'/);
    expect(r.headers['x-frame-options']).toBe('DENY');
  });
  it('caches hashed assets for a year (immutable) and other files for an hour', async () => {
    const a = await raw(port, '/assets/app-1a2b3c.js');
    expect(a.status).toBe(200);
    expect(a.headers['cache-control']).toBe('public, max-age=31536000, immutable');
    expect(a.headers['content-type']).toBe('text/javascript; charset=utf-8');
    expect(a.body.toString()).toBe(BIG_JS);
    const f = await raw(port, '/favicon.ico');
    expect(f.status).toBe(200);
    expect(f.headers['cache-control']).toBe('public, max-age=3600');
  });
  it('gzips large text files for clients that accept it, and sends them plain otherwise', async () => {
    const z = await raw(port, '/assets/app-1a2b3c.js', { headers: { 'Accept-Encoding': 'gzip' } });
    expect(z.headers['content-encoding']).toBe('gzip');
    expect(gunzipSync(z.body).toString()).toBe(BIG_JS);
    expect(z.body.length).toBeLessThan(BIG_JS.length);
    const p = await raw(port, '/assets/app-1a2b3c.js');
    expect(p.headers['content-encoding']).toBeUndefined();
  });
  it('answers a repeat request with 304 when the ETag matches, and HEAD without a body', async () => {
    const first = await raw(port, '/assets/app-1a2b3c.js');
    const etag = String(first.headers.etag);
    expect(etag).toMatch(/^W\//);
    const again = await raw(port, '/assets/app-1a2b3c.js', { headers: { 'If-None-Match': etag } });
    expect(again.status).toBe(304);
    const head = await raw(port, '/', { method: 'HEAD' });
    expect(head.status).toBe(200);
    expect(head.body.length).toBe(0);
  });
  it('SPA fallback: a path without an extension that matches no file gets the page; a missing file with an extension is a real 404', async () => {
    const route = await raw(port, '/some/client/route');
    expect(route.status).toBe(200);
    expect(route.body.toString()).toBe(INDEX);
    expect(route.headers['cache-control']).toBe('no-cache');
    const hash = await raw(port, '/?x=1');
    expect(hash.status).toBe(200);
    const missing = await raw(port, '/assets/missing-abc.js');
    expect(missing.status).toBe(404);
    expect(missing.body.toString()).not.toContain('<div id="game">');
  });
  it('does not leave the web root: encoded and plain traversal, backslashes, NUL bytes and dotfiles are refused', async () => {
    for (const p of ['/%2e%2e/secret.txt', '/..%2fsecret.txt', '/assets/../../secret.txt', '/..\\secret.txt', '/%00.html', '/.env', '/assets/.env', '/%2eenv']) {
      const r = await raw(port, p);
      expect([400, 404]).toContain(r.status);
      expect(r.body.toString()).not.toContain('outside the web root');
      expect(r.body.toString()).not.toContain('do-not-serve');
    }
  });
  it('accepts only GET and HEAD', async () => {
    expect((await raw(port, '/', { method: 'POST' })).status).toBe(405);
    expect((await raw(port, '/', { method: 'DELETE' })).status).toBe(405);
  });
  it('does not shadow the API: /auth/* is answered by the auth handler and /socket.io still connects', async () => {
    const a = await raw(port, '/auth/nope');
    expect(a.status).toBe(404);
    expect(a.headers['content-type']).toBe('application/json');
    expect(await outcome(open(port))).toBe('connected');
  });
  it('a server without a client directory serves no pages', async () => {
    const bare = createGameServer({});
    const p = await bare.listen(0);
    try { expect((await raw(p, '/')).status).toBe(404); } finally { await bare.close(); }
  });
});
