import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { io as connect, type Socket } from 'socket.io-client';
import { StageStateSchema, type Ack, type StageState } from '@wb/shared';
import { createGameServer, type GameServer } from '../src/gateway';

let server: GameServer;
let port: number;
const clients: Socket[] = [];

interface C { s: Socket; id: string; states: StageState[]; raw: string[]; phase: string }
async function join(code?: string): Promise<C & { code: string }> {
  const s = connect(`http://localhost:${port}`, { transports: ['websocket'], forceNew: true });
  clients.push(s);
  const c: C = { s, id: '', states: [], raw: [], phase: 'lobby' };
  s.on('stage:state', (st: unknown) => { c.raw.push(JSON.stringify(st)); c.states.push(StageStateSchema.parse(st)); });
  s.on('room:state', (r: { phase: string }) => { c.phase = r.phase; });
  const ack = await new Promise<Ack<{ roomCode: string; playerId: string }>>((res) => s.emit('room:join', { name: 'T', roomCode: code }, res));
  if (!ack.ok) throw new Error(ack.error);
  c.id = ack.playerId;
  return Object.assign(c, { code: ack.roomCode });
}
const emit = <T extends object = object>(s: Socket, ev: string, p: unknown = {}) => new Promise<Ack<T>>((res) => s.emit(ev, p, res));
const act = (c: C, a: unknown) => emit<{ message: string }>(c.s, 'stage:action', a);
const until = async (pred: () => boolean, ms = 3000) => {
  const t0 = Date.now();
  while (!pred()) { if (Date.now() - t0 > ms) throw new Error('timeout'); await new Promise((r) => setTimeout(r, 10)); }
};
const last = (c: C) => c.states.at(-1)!;
const tools = (c: C, of: C) => last(c).players.find((p) => p.id === of.id)!.tools;

async function startThree(briefingTicksWait = true) {
  const a = await join();
  const b = await join(a.code); const c = await join(a.code);
  await emit(b.s, 'room:ready', { ready: true }); await emit(c.s, 'room:ready', { ready: true });
  await emit(a.s, 'room:start');
  if (briefingTicksWait) await until(() => [a, b, c].every((x) => x.phase === 'playing'));
  return { a, b, c, all: [a, b, c] };
}

beforeEach(async () => { server = createGameServer({ briefingTicks: 4 }); port = await server.listen(0); });
afterEach(async () => { clients.splice(0).forEach((c) => c.disconnect()); await server.close(); });

describe('stage state over real sockets', () => {
  it('delivers the initial stage state to every member, identical and schema-valid', async () => {
    const { all } = await startThree();
    await until(() => all.every((c) => c.states.length > 0));
    await new Promise((r) => setTimeout(r, 150));
    const a = all[0]!, b = all[1]!, c = all[2]!;
    expect(last(a)).toEqual(last(b));
    expect(last(b)).toEqual(last(c));
    expect(last(a).players.map((p) => p.id).sort()).toEqual([a.id, b.id, c.id].sort());
    expect(last(a).objectives).toHaveLength(4);
  });

  it('never sends hidden breakpoint data before it is revealed', async () => {
    const { all } = await startThree();
    await new Promise((r) => setTimeout(r, 300));
    for (const c of all) for (const raw of c.raw) for (const secret of ['bp_coupling', 'f_coupling', 'Cracked flux coupling']) expect(raw).not.toContain(secret);
  });

  it("one player's tool use becomes shared state for everyone (and only their own charges change)", async () => {
    const { a, b, c, all } = await startThree();
    await until(() => all.every((x) => x.states.length > 0));
    // slot 2 spawns at x=845: clue_panel is ~199px away, inside scanner radius
    const r = await act(c, { kind: 'use_tool', tool: 'phase_scanner' });
    expect(r.ok).toBe(true);
    await until(() => all.every((x) => last(x).clues.some((cl) => cl.id === 'clue_panel')));
    expect(last(a)).toEqual(last(b));
    expect(last(b)).toEqual(last(c));
    expect(tools(a, c).find((t) => t.tool === 'phase_scanner')!.charges).toBe(4);
    expect(tools(a, a).find((t) => t.tool === 'phase_scanner')!.charges).toBe(5);
    expect(last(a).feed.some((f) => f.tone === 'clue')).toBe(true);
  });

  it('state revisions only increase', async () => {
    const { c, all } = await startThree();
    await until(() => all.every((x) => x.states.length > 0));
    await act(c, { kind: 'use_tool', tool: 'phase_scanner' });
    await new Promise((r) => setTimeout(r, 200));
    for (const x of all) for (let i = 1; i < x.states.length; i++) expect(x.states[i]!.rev).toBeGreaterThan(x.states[i - 1]!.rev);
  });

  it('refuses a hidden target exactly like a nonexistent one (no oracle over the wire)', async () => {
    const { a, all } = await startThree();
    await until(() => all.every((x) => x.states.length > 0));
    const hidden = await act(a, { kind: 'use_tool', tool: 'flux_welder', targetId: 'bp_coupling' });
    await new Promise((r) => setTimeout(r, 200)); // the server rate-limits actions per player
    const nothing = await act(a, { kind: 'use_tool', tool: 'flux_welder', targetId: 'zzz_nothing' });
    expect(hidden).toEqual({ ok: false, error: 'Nothing there to repair.' });
    expect(hidden).toEqual(nothing);
  });

  it('validates payloads and membership', async () => {
    const { a, all } = await startThree();
    await until(() => all.every((x) => x.states.length > 0));
    for (const bad of [{ kind: 'bogus' }, { kind: 'use_tool', tool: 'laser' }, { kind: 'interact' }, { kind: 'interact', targetId: 'X Y' },
      { kind: 'interact', targetId: 'cache', extra: 1 }, 'x', null, { kind: 'use_tool', tool: 'phase_scanner', targetId: 5 }]) {
      expect(await act(a, bad)).toEqual({ ok: false, error: 'Invalid action' });
    }
    const outsider = connect(`http://localhost:${port}`, { transports: ['websocket'], forceNew: true });
    clients.push(outsider);
    const r = await new Promise<Ack>((res) => outsider.emit('stage:action', { kind: 'cancel' }, res));
    expect(r).toEqual({ ok: false, error: 'Join a room first' });
  });

  it('rejects stage actions during the briefing', async () => {
    const a = await join();
    await emit(a.s, 'room:start');
    const r = await act(a, { kind: 'use_tool', tool: 'phase_scanner' });
    expect(r).toEqual({ ok: false, error: 'No stage is running.' });
  });

  it('the server (not the client) decides results: an out-of-range interaction fails and changes nothing', async () => {
    const { a, all } = await startThree();
    await until(() => all.every((x) => x.states.length > 0));
    const before = last(a).rev;
    const r = await act(a, { kind: 'interact', targetId: 'sw_1' }); // slot 0 is nowhere near breaker 1
    expect(r).toEqual({ ok: false, error: 'Too far away.' });
    await new Promise((res) => setTimeout(res, 150));
    expect(last(a).entities.find((e) => e.id === 'sw_1')!.state).toBe('open');
    expect(last(a).rev).toBe(before);
  });

  it('arena reset gives everyone a fresh stage with a higher revision and nothing revealed', async () => {
    const { a, c, all } = await startThree();
    await until(() => all.every((x) => x.states.length > 0));
    await act(c, { kind: 'use_tool', tool: 'phase_scanner' });
    await until(() => last(a).clues.length > 0);
    const revBefore = last(a).rev;
    expect((await emit(a.s, 'game:reset')).ok).toBe(true);
    await until(() => last(a).rev > revBefore && last(a).clues.length === 0);
    expect(last(a)).toEqual(last(c));
    expect(tools(a, c).find((t) => t.tool === 'phase_scanner')!.charges).toBe(5);
  });
});
