import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { io as connect, type Socket } from 'socket.io-client';
import type { Ack } from '@wb/shared';
import { createGameServer, type GameServer } from '../src/gateway';

let server: GameServer;
let port: number;
const clients: Socket[] = [];
const emit = <T extends object = object>(s: Socket, ev: string, p: unknown = {}) => new Promise<Ack<T>>((res) => s.emit(ev, p, res));
async function join(): Promise<{ s: Socket; phase: string }> {
  const s = connect(`http://localhost:${port}`, { transports: ['websocket'], forceNew: true });
  clients.push(s);
  const c = { s, phase: 'lobby' };
  s.on('room:state', (r: { phase: string }) => { c.phase = r.phase; });
  const ack = await emit(s, 'room:join', { name: 'T' });
  if (!ack.ok) throw new Error(ack.error);
  return c;
}
const until = async (pred: () => boolean, ms = 3000) => {
  const t0 = Date.now();
  while (!pred()) { if (Date.now() - t0 > ms) throw new Error('timeout'); await new Promise((r) => setTimeout(r, 10)); }
};

beforeEach(async () => { server = createGameServer({ briefingTicks: 3 }); port = await server.listen(0); });
afterEach(async () => { clients.splice(0).forEach((c) => c.disconnect()); await server.close(); });

describe('ability:use over real sockets', () => {
  it('refuses before joining a room', async () => {
    const s = connect(`http://localhost:${port}`, { transports: ['websocket'], forceNew: true });
    clients.push(s);
    expect(await emit(s, 'ability:use', { ability: 'momentum', targetId: 'self', dir: 'up' })).toEqual({ ok: false, error: 'Join a room first' });
  });
  it('rejects malformed, NaN-like, out-of-range and unknown-key payloads with Zod', async () => {
    const a = await join();
    const bad: unknown[] = [
      null, 'x', {}, { ability: 'teleport' },
      { ability: 'gravity_well', x: 1, y: 1 }, // no mode
      { ability: 'gravity_well', x: 1e9, y: 0, mode: 'flip' },
      { ability: 'gravity_well', x: 'a', y: 0, mode: 'flip' },
      { ability: 'freeze', targetId: 'Bad Id!' },
      { ability: 'freeze', targetId: 'ok_id', extra: 1 },
      { ability: 'momentum', targetId: 'self', dir: 'sideways' },
      { ability: 'duplicate', targetId: 'c' },
    ];
    for (const p of bad) expect(await emit(a.s, 'ability:use', p)).toEqual({ ok: false, error: 'Invalid ability request' });
  });
  it('a valid intent reaches the engine; stage 1 has no abilities so the verdict comes from the server', async () => {
    const a = await join();
    await emit(a.s, 'room:start');
    await until(() => a.phase === 'playing');
    expect(await emit(a.s, 'ability:use', { ability: 'momentum', targetId: 'self', dir: 'up' }))
      .toEqual({ ok: false, error: 'Reality abilities are not available in this stage.' });
  });
});
