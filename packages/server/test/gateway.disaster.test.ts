import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { io as connect, type Socket } from 'socket.io-client';
import { DisasterPublicSchema, GameSnapshotSchema, RoomSnapshotSchema, StageStateSchema, type Ack, type StageState } from '@wb/shared';
import { createGameServer, type GameServer } from '../src/gateway';
import { getStageDef } from '../src/systems/registry';

let server: GameServer;
let port: number;
const clients: Socket[] = [];

interface C { s: Socket; id: string; states: StageState[]; raw: string[]; phase: string; roomStage: number; gameStage: number }
async function join(code?: string): Promise<C & { code: string }> {
  const s = connect(`http://localhost:${port}`, { transports: ['websocket'], forceNew: true });
  clients.push(s);
  const c: C = { s, id: '', states: [], raw: [], phase: 'lobby', roomStage: 0, gameStage: 0 };
  s.on('stage:state', (st: unknown) => { c.raw.push(JSON.stringify(st)); c.states.push(StageStateSchema.parse(st)); });
  s.on('room:state', (r: unknown) => { const p = RoomSnapshotSchema.parse(r); c.phase = p.phase; c.roomStage = p.stage; });
  s.on('game:snapshot', (g: unknown) => { c.gameStage = GameSnapshotSchema.parse(g).stage; });
  const ack = await new Promise<Ack<{ roomCode: string; playerId: string }>>((res) => s.emit('room:join', { name: 'T', roomCode: code }, res));
  if (!ack.ok) throw new Error(ack.error);
  c.id = ack.playerId;
  return Object.assign(c, { code: ack.roomCode });
}
const emit = <T extends object = object>(s: Socket, ev: string, p: unknown = {}) => new Promise<Ack<T>>((res) => s.emit(ev, p, res));
const until = async (pred: () => boolean, ms = 4000) => {
  const t0 = Date.now();
  while (!pred()) { if (Date.now() - t0 > ms) throw new Error('timeout'); await new Promise((r) => setTimeout(r, 10)); }
};
const last = (c: C) => c.states.at(-1)!;

beforeEach(async () => { server = createGameServer({ briefingTicks: 4 }); port = await server.listen(0); });
afterEach(async () => { clients.splice(0).forEach((x) => x.disconnect()); await server.close(); });

describe('disaster warnings over real sockets', () => {
  it('3 clients receive the same public disaster state on stage 2, and nothing hidden', async () => {
    const a = await join();
    const b = await join(a.code), c = await join(a.code);
    const all = [a, b, c];
    await emit(b.s, 'room:ready', { ready: true }); await emit(c.s, 'room:ready', { ready: true });
    await emit(a.s, 'room:start');
    await until(() => all.every((x) => x.phase === 'playing' && x.states.length > 0));
    expect(last(a).disaster).toBeUndefined(); // stage 1 is the hand-authored tutorial

    const room = server.rooms.get(a.code)!;
    room.phase = 'stage_complete'; // lifecycle shortcut: the genuine clear is proven in the solvability tests
    expect(await emit(a.s, 'room:nextStage')).toEqual({ ok: true });
    await until(() => all.every((x) => x.roomStage === 2 && x.gameStage === 2 && x.phase === 'playing' && last(x).disaster !== undefined));
    await new Promise((r) => setTimeout(r, 200));

    expect(last(a)).toEqual(last(b));
    expect(last(b)).toEqual(last(c));
    const d = DisasterPublicSchema.parse(last(a).disaster);
    expect(d).toMatchObject({ id: 'reactor_overload', phase: 'warning' });
    expect(d.message.length).toBeGreaterThan(20);
    expect(d.threats).toHaveLength(1);
    expect(d.threats[0]).toMatchObject({ hazardId: 'hz_arc', countermeasure: 'shield_projector' });
    expect(last(a).hazards.map((h) => h.id)).toContain('hz_arc');

    // every hazard on the wire has a threat entry (a readable warning + countermeasure + repair path)
    for (const h of last(a).hazards) expect(d.threats.some((t) => t.hazardId === h.id)).toBe(true);

    // hidden data and seeds never appear on the wire
    const rec = room.stageRecord!;
    const def = getStageDef(2, rec.seed);
    const secrets = ['bp_valve', 'f_valve', 'Seized coolant valve', def.breakpoints[0]!.id];
    const seed = String(rec.seed);
    for (const x of all) for (const raw of x.raw.slice(-3)) {
      for (const secret of secrets) expect(raw).not.toContain(secret);
      if (seed.length >= 8) expect(raw).not.toContain(seed);
    }
    for (const x of all) for (let i = 1; i < x.states.length; i++) expect(x.states[i]!.rev).toBeGreaterThan(x.states[i - 1]!.rev);
  });
});
