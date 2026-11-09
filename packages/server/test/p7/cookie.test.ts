import { afterEach, describe, expect, it } from 'vitest';
import { AuthService } from '../../src/auth';
import { createGameServer, type GameServer } from '../../src/gateway';
import { MemoryProgressStore } from '../../src/store/memory';
import { ProgressService } from '../../src/store/service';

let server: GameServer | null = null;
afterEach(async () => { await server?.close(); server = null; });

describe('P7 session cookie flags', () => {
  it('a production service sets HttpOnly, Secure and SameSite=Strict (and a dev one does not set Secure)', async () => {
    const prod = new AuthService({ mode: 'google', googleClientId: 'id', secret: 'q8Zr2LmV5xTn0cYb7HdW3uKe9PaJf4Gs', env: { NODE_ENV: 'production' }, jwks: async () => ({ keys: [] }) });
    server = createGameServer({ auth: prod, progress: new ProgressService(new MemoryProgressStore()) });
    const port = await server.listen(0);
    const res = await fetch(`http://localhost:${port}/auth/logout`, { method: 'POST' });
    expect(res.status).toBe(200);
    const cookie = res.headers.get('set-cookie') ?? '';
    expect(cookie).toMatch(/HttpOnly/);
    expect(cookie).toMatch(/Secure/);
    expect(cookie).toMatch(/SameSite=Strict/);
    expect(cookie).toMatch(/Max-Age=0/);
  });
});
