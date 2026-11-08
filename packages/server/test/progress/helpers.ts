import { io as connect, type Socket } from 'socket.io-client';
import type { Ack, Profile } from '@wb/shared';
import { AuthService } from '../../src/auth';
import { createGameServer, type GameServer } from '../../src/gateway';
import { MemoryProgressStore } from '../../src/store/memory';
import { ProgressService } from '../../src/store/service';
import type { ProgressStore } from '../../src/store/types';

export const emit = <T extends object = object>(s: Socket, ev: string, p: unknown = {}) => new Promise<Ack<T>>((res) => s.emit(ev, p, res));
export const until = async (pred: () => boolean, ms = 4000) => {
  const t0 = Date.now();
  while (!pred()) { if (Date.now() - t0 > ms) throw new Error('timeout'); await new Promise((r) => setTimeout(r, 10)); }
};
export const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

export interface Harness { server: GameServer; port: number; auth: AuthService; progress: ProgressService; store: MemoryProgressStore | ProgressStore; clients: Socket[] }
export async function boot(o: { store?: ProgressStore | null; secret?: string; mode?: 'dev' | 'off'; devFlags?: boolean; env?: NodeJS.ProcessEnv } = {}): Promise<Harness> {
  const store = o.store === undefined ? new MemoryProgressStore() : o.store;
  const auth = new AuthService({ mode: o.mode ?? 'dev', secret: o.secret ?? 'test-secret-test-secret-test-secret-123', env: o.env ?? { NODE_ENV: 'test' } });
  const progress = new ProgressService(store, { queue: { baseDelayMs: 0, maxDelayMs: 0 } });
  const server = createGameServer({ briefingTicks: 3, escapeStages: true, ghostStages: true, auth, progress, ...(o.devFlags !== undefined ? { devFlags: o.devFlags } : {}) });
  const port = await server.listen(0);
  return { server, port, auth, progress, store: store ?? new MemoryProgressStore(), clients: [] };
}
export async function stop(h: Harness | null): Promise<void> { h?.clients.splice(0).forEach((c) => c.disconnect()); await h?.server.close(); }

export function client(h: Harness, token?: string): { s: Socket; profiles: Profile[]; err: Error | null; id: string } {
  const s = connect(`http://localhost:${h.port}`, { transports: ['websocket'], forceNew: true, reconnection: false, ...(token ? { auth: { token } } : {}) });
  h.clients.push(s);
  const c = { s, profiles: [] as Profile[], err: null as Error | null, id: '' };
  s.on('profile:state', (p: Profile) => { c.profiles.push(p); });
  s.on('connect_error', (e) => { c.err = e; });
  return c;
}
export const lastProfile = (c: { profiles: Profile[] }): Profile | undefined => c.profiles[c.profiles.length - 1];

/** Sign in over HTTP with the dev provider; returns the session token. */
export async function login(h: Harness, name: string): Promise<{ token: string; res: Response; body: { token?: string; profile?: Profile } }> {
  const res = await fetch(`http://localhost:${h.port}/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ credential: name }) });
  const body = (await res.json()) as { token?: string; profile?: Profile };
  return { token: body.token ?? '', res, body };
}
