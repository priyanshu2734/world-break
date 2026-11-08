import { afterEach, describe, expect, it } from 'vitest';
import type { RunSave, StageResult } from '@wb/shared';
import { MemoryProgressStore } from '../../src/store/memory';
import type { Room } from '../../src/room';
import { boot, client, emit, lastProfile, stop, until, wait, type Harness } from './helpers';

let h: Harness | null = null;
afterEach(async () => { await stop(h); h = null; });

const res = (stage: number, o: Partial<StageResult> = {}): StageResult => ({ stage, mode: 'easy', ticks: 900, score: 100, players: 1, deaths: 0, ...o });
const sv = (stage: number, o: Partial<RunSave> = {}): RunSave => ({ stage, mode: 'easy', seedBase: 4242, variety: [], upgrades: {}, pickOrder: [], ...o });

/** An account with `reached` as its highest stage (and optionally a save), and a session token for it. */
async function account(hh: Harness, name: string, reached = 1, save: RunSave | null = null) {
  const a = (await hh.progress.login('dev', name.toLowerCase(), name))!;
  if (reached > 1) await hh.store.recordClear(a.id, res(reached - 1), save, 5);
  else if (save) await hh.store.saveRun(a.id, save, 5);
  return { id: a.id, token: hh.auth.issue(a.id).token };
}
async function join(hh: Harness, name: string, o: { token?: string; code?: string } = {}) {
  const c = client(hh, o.token);
  await until(() => c.s.connected || c.err !== null);
  if (c.err) return { c, ok: false as const, error: c.err.message, code: '', id: '' };
  const r = await emit<{ roomCode: string; playerId: string }>(c.s, 'room:join', { name, ...(o.code ? { roomCode: o.code } : {}) });
  if (!r.ok) return { c, ok: false as const, error: r.error, code: '', id: '' };
  c.id = r.playerId;
  return { c, ok: true as const, error: '', code: r.roomCode, id: r.playerId };
}
const room = (hh: Harness, code: string): Room => hh.server.rooms.get(code)!;

describe('P6 C connecting: guests, accounts, forged tokens', () => {
  it('a guest plays with no account: guest profile, only Easy, name from the join request, nothing stored', async () => {
    h = await boot();
    const g = await join(h, 'Guesty');
    expect(g.ok).toBe(true);
    await until(() => lastProfile(g.c) !== undefined);
    expect(lastProfile(g.c)).toMatchObject({ signedIn: false, storage: 'guest', highestStage: 1, unlocked: ['easy'], save: null, rewards: [], room: { allowed: ['easy'], hostSave: null, choice: 'new', hostSignedIn: false } });
    expect((h.store as MemoryProgressStore).size).toBe(0);
    expect(room(h, g.code).snapshot().players[0]!.name).toBe('Guesty');
  });
  it('a signed-in player is named by the SERVER’s record, not by what the browser sends, and sees their own progress', async () => {
    h = await boot();
    const a = await account(h, 'Ann', 12);
    const s = await join(h, 'Pretender', { token: a.token });
    expect(s.ok).toBe(true);
    await until(() => lastProfile(s.c)?.signedIn === true);
    expect(lastProfile(s.c)).toMatchObject({ signedIn: true, name: 'Ann', highestStage: 12, unlocked: ['easy', 'intermediate'], storage: 'ok' });
    expect(room(h, s.code).snapshot().players[0]!.name).toBe('Ann');
  });
  it('a forged, altered or expired token is refused at the handshake; no token is a guest', async () => {
    h = await boot();
    const a = await account(h, 'Ann', 12);
    const [p, payload, sig] = a.token.split('.') as [string, string, string];
    const forged = Buffer.from(JSON.stringify({ ...JSON.parse(Buffer.from(payload, 'base64url').toString()), sub: 'someone-else' })).toString('base64url');
    for (const bad of [`${p}.${forged}.${sig}`, `${p}.${payload}.${sig.slice(0, -3)}abc`, 'garbage', 'wb1.a.b', `${a.token}x`]) {
      const r = await join(h, 'X', { token: bad });
      expect(r.ok, bad.slice(0, 20)).toBe(false);
      expect(r.error).toBe('invalid_session');
    }
    expect((await join(h, 'Fine')).ok).toBe(true);
  });
  it('a token for a deleted account plays as a guest (the server’s record is the truth)', async () => {
    h = await boot();
    const a = await account(h, 'Gone', 15);
    await h.store.deleteAccount(a.id);
    const r = await join(h, 'Ghosty', { token: a.token });
    expect(r.ok).toBe(true);
    await until(() => lastProfile(r.c) !== undefined);
    expect(lastProfile(r.c)).toMatchObject({ signedIn: false, unlocked: ['easy'] });
  });
  it('reconnect uses the session token: a new socket with the same token is the same account', async () => {
    h = await boot();
    const a = await account(h, 'Ann', 12);
    const first = await join(h, 'A', { token: a.token });
    first.c.s.disconnect();
    await until(() => h!.server.rooms.count === 0);
    const again = await join(h, 'A', { token: a.token });
    await until(() => lastProfile(again.c)?.signedIn === true);
    expect(lastProfile(again.c)).toMatchObject({ name: 'Ann', highestStage: 12 });
  });
  it('the same account cannot sit in one room twice', async () => {
    h = await boot();
    const a = await account(h, 'Ann');
    const one = await join(h, 'A', { token: a.token });
    const two = await join(h, 'A', { token: a.token, code: one.code });
    expect(two.ok).toBe(false);
    expect(two.error).toMatch(/already in that room/);
  });
  it('a socket cannot join twice', async () => {
    h = await boot();
    const g = await join(h, 'G');
    expect((await emit(g.c.s, 'room:join', { name: 'G2' })).ok).toBe(false);
  });
});

describe('P6 C multiplayer: the HOST’s unlocks and save rule the room', () => {
  it('a host who reached 15 offers Intermediate to everyone in the room; a guest joiner can join and sees the same modes', async () => {
    h = await boot();
    const a = await account(h, 'Hoster', 15);
    const host = await join(h, 'x', { token: a.token });
    const guest = await join(h, 'Guest', { code: host.code });
    expect(guest.ok).toBe(true);
    await until(() => lastProfile(guest.c)?.room?.hostSignedIn === true);
    expect(lastProfile(guest.c)!.room!.allowed).toEqual(['easy', 'intermediate']);
    expect(lastProfile(guest.c)).toMatchObject({ signedIn: false, storage: 'guest' }); // the guest's own profile stays a guest's
    expect((await emit(host.c.s, 'room:setDifficulty', { difficulty: 'intermediate' })).ok).toBe(true);
    expect((await emit(host.c.s, 'room:setDifficulty', { difficulty: 'hardcore' })).ok).toBe(false);
    expect((await emit(guest.c.s, 'room:setDifficulty', { difficulty: 'easy' })).ok).toBe(false); // not the host
  });
  it('a guest host has only Easy, even with a veteran joiner; the veteran keeps their own progress', async () => {
    h = await boot();
    const vet = await account(h, 'Vet', 30);
    const host = await join(h, 'GuestHost');
    const joiner = await join(h, 'x', { token: vet.token, code: host.code });
    expect(joiner.ok).toBe(true);
    await until(() => lastProfile(joiner.c)?.signedIn === true && lastProfile(joiner.c)?.room !== undefined);
    expect(lastProfile(joiner.c)).toMatchObject({ highestStage: 30, unlocked: ['easy', 'intermediate', 'hardcore'] });
    expect(lastProfile(joiner.c)!.room!.allowed).toEqual(['easy']);
    expect((await emit(host.c.s, 'room:setDifficulty', { difficulty: 'intermediate' })).ok).toBe(false);
  });
  it('a joiner with LOWER progress than the host joins fine', async () => {
    h = await boot();
    const hostA = await account(h, 'High', 25), low = await account(h, 'Low', 2);
    const host = await join(h, 'x', { token: hostA.token });
    const j = await join(h, 'x', { token: low.token, code: host.code });
    expect(j.ok).toBe(true);
    await until(() => lastProfile(j.c)?.signedIn === true);
    expect(lastProfile(j.c)).toMatchObject({ highestStage: 2, unlocked: ['easy'] });
    expect(lastProfile(j.c)!.room!.allowed).toEqual(['easy', 'intermediate', 'hardcore']);
  });
  it('when the host leaves in the lobby, the room follows the NEW host’s unlocks and a stale continue is dropped', async () => {
    h = await boot();
    const hostA = await account(h, 'High', 25, sv(25));
    const host = await join(h, 'x', { token: hostA.token });
    const guest = await join(h, 'G', { code: host.code });
    await until(() => lastProfile(host.c)?.room !== undefined);
    expect((await emit(host.c.s, 'run:choose', { choice: 'continue' })).ok).toBe(true);
    await until(() => room(h!, host.code).stage === 25);
    host.c.s.disconnect();
    await until(() => room(h!, guest.code).hostId === guest.id);
    await until(() => room(h!, guest.code).stage === 1);
    expect(room(h, guest.code).difficulty).toBe('easy');
    await until(() => lastProfile(guest.c)?.room?.allowed.length === 1);
    expect(lastProfile(guest.c)!.room).toMatchObject({ allowed: ['easy'], choice: 'new', hostSignedIn: false });
  });
});

describe('P6 C Continue stage N versus New run (a SERVER path)', () => {
  it('Continue loads the HOST’s save: stage, mode and run seed come from the server’s store, and the lobby reports it', async () => {
    h = await boot();
    const a = await account(h, 'Ann', 11, sv(11, { mode: 'intermediate', seedBase: 9001 }));
    const host = await join(h, 'x', { token: a.token });
    await until(() => lastProfile(host.c)?.save !== undefined && lastProfile(host.c)?.room !== undefined);
    expect(lastProfile(host.c)).toMatchObject({ save: { stage: 11, mode: 'intermediate' }, room: { hostSave: { stage: 11, mode: 'intermediate' }, choice: 'new' } });
    const r = await emit<{ message: string }>(host.c.s, 'run:choose', { choice: 'continue' });
    expect(r).toEqual({ ok: true, message: 'Continuing at stage 11.' });
    const rm = room(h, host.code);
    expect(rm.stage).toBe(11);
    expect(rm.difficulty).toBe('intermediate');
    expect(rm.snapshot().stage).toBe(11);
    await until(() => lastProfile(host.c)?.room?.choice === 'continue');
  });
  it('New run starts at stage 1 again, even after a continue; the account keeps its unlocks', async () => {
    h = await boot();
    const a = await account(h, 'Ann', 21, sv(21, { mode: 'hardcore' }));
    const host = await join(h, 'x', { token: a.token });
    await emit(host.c.s, 'run:choose', { choice: 'continue' });
    expect(room(h, host.code).stage).toBe(21);
    expect((await emit(host.c.s, 'run:choose', { choice: 'new' })).ok).toBe(true);
    expect(room(h, host.code).stage).toBe(1);
    expect(room(h, host.code).snapshot().highestStage).toBe(21); // the unlock basis is the host's progress
    expect((await emit(host.c.s, 'room:setDifficulty', { difficulty: 'hardcore' })).ok).toBe(true);
  });
  it('only the host may choose; a guest host has nothing to continue; no save means no continue', async () => {
    h = await boot();
    const a = await account(h, 'Ann', 11, sv(11));
    const host = await join(h, 'x', { token: a.token });
    const joiner = await join(h, 'J', { code: host.code });
    expect(await emit(joiner.c.s, 'run:choose', { choice: 'continue' })).toEqual({ ok: false, error: 'Only the host can choose how the run starts' });
    const gh = await join(h, 'Guesty');
    expect(await emit(gh.c.s, 'run:choose', { choice: 'continue' })).toEqual({ ok: false, error: 'Sign in to keep and continue a run.' });
    const b = await account(h, 'Nosave', 5);
    const nb = await join(h, 'x', { token: b.token });
    expect(await emit(nb.c.s, 'run:choose', { choice: 'continue' })).toEqual({ ok: false, error: 'There is no saved run to continue.' });
  });
  it('the client names only a choice: extra fields, a stage or a save in the request are refused', async () => {
    h = await boot();
    const a = await account(h, 'Ann', 11, sv(11));
    const host = await join(h, 'x', { token: a.token });
    for (const bad of [{ choice: 'continue', stage: 500 }, { choice: 'continue', save: sv(500) }, { choice: 'cheat' }, {}, null, 'continue']) {
      expect(await emit(host.c.s, 'run:choose', bad), JSON.stringify(bad)).toEqual({ ok: false, error: 'Invalid request' });
    }
    expect(room(h, host.code).stage).toBe(1);
  });
  it('a tampered save in the store (ahead of the account’s progress, or a mode it has not unlocked, or corrupt) is refused', async () => {
    h = await boot();
    const ahead = await account(h, 'Ahead', 5, sv(5));
    await h.store.saveRun(ahead.id, sv(50), 9);
    const hostA = await join(h, 'x', { token: ahead.token });
    expect(await emit(hostA.c.s, 'run:choose', { choice: 'continue' })).toEqual({ ok: false, error: 'The saved run could not be loaded.' });
    expect(room(h, hostA.code).stage).toBe(1);
    const mode = await account(h, 'Mode', 12);
    await h.store.saveRun(mode.id, sv(12, { mode: 'hardcore' }), 9);
    const hostB = await join(h, 'x', { token: mode.token });
    expect((await emit(hostB.c.s, 'run:choose', { choice: 'continue' })).ok).toBe(false);
    expect(room(h, hostB.code).difficulty).toBe('easy');
    const bad = await account(h, 'Corrupt', 8);
    (h.store as MemoryProgressStore).rawSave(bad.id, '{"stage": "lots"}');
    const hostC = await join(h, 'x', { token: bad.token });
    expect(await emit(hostC.c.s, 'run:choose', { choice: 'continue' })).toEqual({ ok: false, error: 'There is no saved run to continue.' });
  });
  it('a started run cannot be re-chosen', async () => {
    h = await boot();
    const a = await account(h, 'Ann', 11, sv(11));
    const host = await join(h, 'x', { token: a.token });
    expect((await emit(host.c.s, 'room:start')).ok).toBe(true);
    await until(() => room(h!, host.code).phase !== 'lobby');
    expect(await emit(host.c.s, 'run:choose', { choice: 'continue' })).toEqual({ ok: false, error: 'Not in lobby' });
  });
});

describe('P6 C clearing a stage writes progress', () => {
  /** The real clear event (built by the room at the moment of a clear) pushed through the real gateway loop. */
  async function clear(hh: Harness, code: string) {
    const rm = room(hh, code) as unknown as { phase: string; noteClear(): void };
    rm.phase = 'playing';
    rm.noteClear();
    await hh.progress.idle();
    await wait(60);
    await hh.progress.idle();
  }
  it('every SIGNED-IN player earns the result and the next stage; only the HOST’s save slot is written; a guest earns nothing stored', async () => {
    h = await boot();
    const a = await account(h, 'Hosty'), b = await account(h, 'Mate');
    const host = await join(h, 'x', { token: a.token });
    const mate = await join(h, 'x', { token: b.token, code: host.code });
    const guest = await join(h, 'Guest', { code: host.code });
    await emit(mate.c.s, 'room:ready', { ready: true }); await emit(guest.c.s, 'room:ready', { ready: true });
    expect((await emit(host.c.s, 'room:start')).ok).toBe(true);
    await until(() => room(h!, host.code).phase === 'briefing' || room(h!, host.code).phase === 'playing');
    await clear(h, host.code);
    expect((await h.store.getAccount(a.id))!.highestStage).toBe(2);
    expect((await h.store.getAccount(b.id))!.highestStage).toBe(2);
    expect((await h.store.listResults(a.id, 5))[0]).toMatchObject({ stage: 1, mode: 'easy', players: 3 });
    expect((await h.store.listResults(b.id, 5)).length).toBe(1);
    expect(await h.store.getRunSave(a.id)).toMatchObject({ stage: 2, mode: 'easy' });
    expect(await h.store.getRunSave(b.id)).toBeNull(); // not the host
    expect((h.store as MemoryProgressStore).size).toBe(2); // the guest is nowhere in the store
    await until(() => lastProfile(mate.c)?.highestStage === 2);
    expect(lastProfile(mate.c)).toMatchObject({ highestStage: 2, save: null });
    await until(() => lastProfile(host.c)?.save?.stage === 2);
  });
  it('clearing stage 9 reaches 10 and unlocks Intermediate for the next lobby; the profile says so', async () => {
    h = await boot();
    const a = await account(h, 'Ann', 9);
    const host = await join(h, 'x', { token: a.token });
    await emit(host.c.s, 'room:start');
    await until(() => room(h!, host.code).phase !== 'lobby');
    const rm = room(h, host.code) as unknown as { stage: number };
    rm.stage = 9;
    await clear(h, host.code);
    await until(() => lastProfile(host.c)?.highestStage === 10);
    expect(lastProfile(host.c)!.unlocked).toEqual(['easy', 'intermediate']);
    expect(lastProfile(host.c)!.rewards).toEqual(['trail_cyan']);
  });
  it('a failed attempt never lowers the stage: clearing an older stage again changes nothing', async () => {
    h = await boot();
    const a = await account(h, 'Ann', 20);
    const host = await join(h, 'x', { token: a.token });
    await emit(host.c.s, 'room:start');
    await until(() => room(h!, host.code).phase !== 'lobby');
    await clear(h, host.code); // the room is on stage 1
    expect((await h.store.getAccount(a.id))!.highestStage).toBe(20);
  });
  it('if the store goes down the run carries on, nothing throws, and the lobby profile says storage is down', async () => {
    const store = new (class extends MemoryProgressStore { down = false; override async recordClear(...a: Parameters<MemoryProgressStore['recordClear']>) { if (this.down) throw new Error('disk'); return super.recordClear(...a); } override async getAccount(id: string) { if (this.down) throw new Error('disk'); return super.getAccount(id); } })();
    h = await boot({ store });
    const a = await account(h, 'Ann', 3);
    const host = await join(h, 'x', { token: a.token });
    await emit(host.c.s, 'room:start');
    await until(() => room(h!, host.code).phase !== 'lobby');
    store.down = true;
    await clear(h, host.code);
    expect(room(h, host.code).phase).not.toBe('lobby'); // the game is unaffected
    expect(h.progress.available).toBe(false);
    store.down = false;
  });
});

describe('P6 C storage down at connect: the game still starts, guest-like', () => {
  it('a valid token while the store is unreachable plays as a guest and the profile says storage is down', async () => {
    const store = new (class extends MemoryProgressStore { down = false; override async getAccount(id: string) { if (this.down) throw new Error('disk'); return super.getAccount(id); } })();
    h = await boot({ store });
    const a = await account(h, 'Ann', 12);
    store.down = true;
    const r = await join(h, 'Annie', { token: a.token });
    expect(r.ok).toBe(true);
    await until(() => lastProfile(r.c) !== undefined);
    expect(lastProfile(r.c)).toMatchObject({ signedIn: false, storage: 'down', unlocked: ['easy'], save: null });
    expect(room(h, r.code).snapshot().players[0]!.name).toBe('Annie'); // the browser’s name, because the server could not vouch for the account
    expect(await emit(r.c.s, 'room:start')).toMatchObject({ ok: true });
  });
  it('no store configured at all: everybody is a guest and nothing breaks', async () => {
    h = await boot({ store: null, mode: 'off' });
    const g = await join(h, 'G');
    await until(() => lastProfile(g.c) !== undefined);
    expect(lastProfile(g.c)!.signedIn).toBe(false);
    expect((await emit(g.c.s, 'room:start')).ok).toBe(true);
  });
});

describe('P6 C deleting an account while connected', () => {
  it('live sockets of that account fall back to guests and the lobby is told', async () => {
    h = await boot();
    const a = await account(h, 'Ann', 15);
    const host = await join(h, 'x', { token: a.token });
    await until(() => lastProfile(host.c)?.signedIn === true);
    const del = await fetch(`http://localhost:${h.port}/auth/account`, { method: 'DELETE', headers: { Authorization: `Bearer ${a.token}` } });
    expect(del.status).toBe(200);
    await until(() => lastProfile(host.c)?.signedIn === false);
    expect(lastProfile(host.c)).toMatchObject({ unlocked: ['easy'], save: null });
    await until(() => room(h!, host.code).unlockBasis === 1);
  });
});

describe('P6 C dev flags: ?ghost=N', () => {
  const tryGhost = async (hh: Harness) => { const c = client(hh); await until(() => c.s.connected); return emit<{ roomCode: string; playerId: string }>(c.s, 'room:join', { name: 'D', ghost: 5 }); };
  it('is refused unless DEV_FLAGS is on', async () => {
    h = await boot();
    const r = await tryGhost(h);
    expect(r.ok).toBe(false);
    expect(r).toMatchObject({ error: expect.stringMatching(/Dev flags are disabled/) });
    expect(h.server.rooms.count).toBe(0);
  });
  it('works when dev flags are on (outside production) and starts that stage', async () => {
    h = await boot({ devFlags: true });
    const r = await tryGhost(h);
    expect(r.ok).toBe(true);
    expect(room(h, r.ok ? r.roomCode : '').stage).toBe(5);
  });
  it('is NEVER honoured in production, even when dev flags are asked for', async () => {
    const before = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';
    try {
      h = await boot({ devFlags: true, mode: 'off', env: { NODE_ENV: 'production' } });
      const r = await tryGhost(h);
      expect(r.ok).toBe(false);
      expect(h.server.rooms.count).toBe(0);
    } finally { if (before === undefined) delete process.env.NODE_ENV; else process.env.NODE_ENV = before; }
  });
  it('joining an existing room with the flag is refused too (no bypass)', async () => {
    h = await boot();
    const host = await join(h, 'H');
    const c = client(h); await until(() => c.s.connected);
    expect((await emit(c.s, 'room:join', { name: 'D', roomCode: host.code, ghost: 9 })).ok).toBe(false);
  });
});
