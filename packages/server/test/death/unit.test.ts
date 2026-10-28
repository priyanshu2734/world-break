import { describe, expect, it } from 'vitest';
import { SERVER_TICK_HZ, nextPlayerLife, type Difficulty } from '@wb/shared';
import { DEATH_TABLE, DeathSystem, deathTuning, type CarriedItem, type DeathHost, type DeathWho, type DroppedItem, type KillCause } from '../../src/death';

/** A scripted host: every effect is recorded, nothing is real. */
class FakeHost implements DeathHost {
  tick = 0;
  players: DeathWho[] = [];
  frozen = new Set<string>();
  carrying = new Map<string, CarriedItem[]>();
  left: string[] = [];
  dropAllCalls: string[] = [];
  said: string[] = [];
  /** When true `dropOne` never succeeds (the item system keeps refusing). */
  stuck = false;
  who(): DeathWho[] { return this.players; }
  freeze(id: string, on: boolean): void { if (on) this.frozen.add(id); else this.frozen.delete(id); }
  carried(id: string): CarriedItem[] { return [...(this.carrying.get(id) ?? [])]; }
  dropOne(id: string): { left: number; dropped: DroppedItem | null } {
    const list = this.carrying.get(id) ?? [];
    if (this.stuck || list.length === 0) return { left: list.length, dropped: null };
    const it = list.shift()!;
    const p = this.players.find((w) => w.id === id)!;
    return { left: list.length, dropped: { ...it, x: p.x, y: p.y, room: p.room } };
  }
  dropAll(id: string): void { this.dropAllCalls.push(id); this.carrying.set(id, []); }
  leaveHiding(id: string): void { this.left.push(id); }
  say(text: string): void { this.said.push(text); }
}

const who = (id: string, slot: number, o: Partial<DeathWho> = {}): DeathWho => ({ id, name: id.toUpperCase(), slot, room: 'r0', x: 100 + slot * 50, y: 680, connected: true, ...o });
const CAUSE: KillCause = { how: 'touch', ghost: 'g0', ghostKind: null, because: ['Caught A at tick 500'] };
const sec = (s: number): number => Math.round(s * SERVER_TICK_HZ);

function setup(ids: string[] = ['a', 'b'], difficulty: Difficulty = 'easy', stage = 2) {
  const host = new FakeHost();
  host.players = ids.map((id, i) => who(id, i));
  const sys = new DeathSystem({ difficulty, stage }, host);
  for (const id of ids) sys.addPlayer(id);
  host.tick = DEATH_TABLE.spawnGraceS * SERVER_TICK_HZ; // just past the spawn grace
  return { host, sys };
}

describe('P4 the table of death', () => {
  it('holds the numbers of GAMEPLAY.md section 8 and does not depend on the stage', () => {
    const t = deathTuning('easy', 1);
    expect(t.reviveWindowTicks).toBe(sec(45));
    expect(t.satiatedTicks).toBe(sec(8));
    expect(t.spawnGraceTicks).toBe(sec(20));
    expect(t.protectionTicks).toBe(sec(5));
    expect(t.contactTicks).toBeGreaterThanOrEqual(1);
    for (const stage of [1, 2, 20, 29, 1_000_000]) for (const d of ['easy', 'intermediate', 'hardcore'] as const) {
      const x = deathTuning(d, stage), y = deathTuning(d, 1);
      expect(x).toEqual(y);
    }
  });
  it('Hardcore has no revive window; Easy and Intermediate have one', () => {
    expect(deathTuning('hardcore').revivable).toBe(false);
    expect(deathTuning('hardcore').reviveWindowTicks).toBe(0);
    expect(deathTuning('easy').revivable).toBe(true);
    expect(deathTuning('intermediate').revivable).toBe(true);
  });
});

describe('P4 the kill: alive -> downed (Easy, Intermediate) or eliminated (Hardcore)', () => {
  it.each(['easy', 'intermediate'] as const)('%s: the player becomes a body for the window, frozen, out of hiding, and the event says what they carried', (d) => {
    const { host, sys } = setup(['a', 'b'], d);
    host.carrying.set('a', [{ itemId: 'k1', kind: 'access_key' }]);
    const r = sys.kill('a', CAUSE);
    expect(r).toEqual({ ok: true, life: 'downed' });
    expect(sys.lifeOf('a')).toBe('downed');
    expect(sys.isDead('a')).toBe(true);
    expect(sys.isBody('a')).toBe(true);
    expect(sys.isEliminated('a')).toBe(false);
    expect(sys.isAlive('b')).toBe(true);
    expect(host.frozen.has('a')).toBe(true);
    expect(host.left).toEqual(['a']);
    const ev = sys.events.at(-1)!;
    expect(ev).toMatchObject({ kind: 'killed', player: 'a', life: 'downed', tick: host.tick, cause: CAUSE, carrying: [{ itemId: 'k1', kind: 'access_key' }] });
    expect(sys.bodies()).toEqual([{ id: 'a', name: 'A', room: 'r0', x: 100, y: 680, reviveUntil: host.tick + sec(45) }]);
    expect(sys.deathOf('a')).toMatchObject({ tick: host.tick, room: 'r0', x: 100, y: 680 });
  });
  it('hardcore: straight to eliminated in the same tick, no body, no window', () => {
    const { host, sys } = setup(['a', 'b'], 'hardcore');
    expect(sys.kill('a', CAUSE)).toEqual({ ok: true, life: 'eliminated' });
    expect(sys.isEliminated('a')).toBe(true);
    expect(sys.isBody('a')).toBe(false);
    expect(sys.bodies()).toEqual([]);
    expect(host.frozen.has('a')).toBe(true);
    expect(sys.events.at(-1)).toMatchObject({ kind: 'killed', life: 'eliminated', reviveUntil: null });
  });
  it('refuses a kill of a player who is already dead (two ghosts, one tick = one death), unknown, in the spawn grace, or protected', () => {
    const { host, sys } = setup();
    expect(sys.kill('a', CAUSE).ok).toBe(true);
    expect(sys.kill('a', CAUSE)).toEqual({ ok: false, reason: 'not_alive' });
    expect(sys.kill('zzz', CAUSE)).toEqual({ ok: false, reason: 'unknown_player' });
    expect(sys.events.filter((e) => e.kind === 'killed')).toHaveLength(1);
    expect(sys.events.filter((e) => e.kind === 'kill_refused')).toHaveLength(2);
    host.tick = sec(20) - 1;
    expect(sys.kill('b', CAUSE)).toEqual({ ok: false, reason: 'spawn_grace' });
    expect(sys.canKill('b')).toBe(false);
    host.tick = sec(20);
    expect(sys.canKill('b')).toBe(true);
    expect(sys.kill('b', CAUSE).ok).toBe(true);
  });
  it('the spawn grace is the first 20 s of the stage and nothing else: tick 399 refused, tick 400 allowed', () => {
    const { host, sys } = setup(['a']);
    host.tick = 399;
    expect(sys.kill('a', CAUSE).ok).toBe(false);
    host.tick = 400;
    expect(sys.kill('a', CAUSE).ok).toBe(true);
  });
  it('two players killed on the same tick are both killed, in roster order, each with their own event', () => {
    const { host, sys } = setup(['a', 'b', 'c']);
    sys.kill('b', { ...CAUSE, ghost: 'g1' });
    sys.kill('a', CAUSE);
    const killed = sys.events.filter((e) => e.kind === 'killed');
    expect(killed.map((e) => e.kind === 'killed' && e.player)).toEqual(['b', 'a']);
    expect(killed.every((e) => e.tick === host.tick)).toBe(true);
    expect(sys.aliveIds()).toEqual(['c']);
    expect(sys.bodies().map((b) => b.id)).toEqual(['a', 'b']); // bodies list in roster order
  });
});

describe('P4 the window: downed -> eliminated, and every illegal step', () => {
  it('the body is revivable for exactly the window, then eliminated; the event is logged once; a spectator stays a spectator', () => {
    const { host, sys } = setup();
    sys.kill('a', CAUSE);
    const t0 = host.tick;
    host.tick = t0 + sec(45) - 1; sys.step();
    expect(sys.isBody('a')).toBe(true);
    host.tick = t0 + sec(45); sys.step();
    expect(sys.lifeOf('a')).toBe('eliminated');
    expect(sys.isDead('a')).toBe(true);
    expect(sys.events.filter((e) => e.kind === 'window_expired')).toHaveLength(1);
    for (let i = 0; i < 50; i++) { host.tick++; sys.step(); }
    expect(sys.events.filter((e) => e.kind === 'window_expired')).toHaveLength(1);
    expect(sys.lifeOf('a')).toBe('eliminated');
  });
  it('revive: only a body inside the window, only on Easy and Intermediate; it frees them with protection, and the transition table agrees', () => {
    const { host, sys } = setup();
    expect(sys.revive('a', 'b')).toEqual({ ok: false, reason: 'not_a_body' }); // alive
    sys.kill('a', CAUSE);
    host.tick += 10;
    expect(sys.revive('a', 'b')).toEqual({ ok: true });
    expect(sys.lifeOf('a')).toBe('alive');
    expect(host.frozen.has('a')).toBe(false);
    expect(sys.protectedUntil('a')).toBe(host.tick + sec(5));
    expect(sys.revive('a', 'b')).toEqual({ ok: false, reason: 'not_a_body' }); // twice
    const ev = sys.events.at(-1)!;
    expect(ev).toMatchObject({ kind: 'revived', player: 'a', by: 'b' });
    // an eliminated player never comes back
    sys.kill('b', CAUSE);
    host.tick += sec(45); sys.step();
    expect(sys.lifeOf('b')).toBe('eliminated');
    expect(sys.revive('b', 'a')).toEqual({ ok: false, reason: 'not_a_body' });
    expect(() => nextPlayerLife('eliminated', 'REVIVE')).toThrow();
    expect(() => nextPlayerLife('alive', 'REVIVE')).toThrow();
    expect(() => nextPlayerLife('alive', 'BLEED_OUT')).toThrow();
  });
  it('a revive after the window is refused even if step() has not run yet', () => {
    const { host, sys } = setup();
    sys.kill('a', CAUSE);
    host.tick += sec(45);
    expect(sys.revive('a', 'b')).toEqual({ ok: false, reason: 'window_over' });
  });
  it('hardcore has no revive at all', () => {
    const { sys } = setup(['a', 'b'], 'hardcore');
    sys.kill('a', CAUSE);
    expect(sys.revive('a', 'b')).toEqual({ ok: false, reason: 'no_revive_here' });
    expect(sys.isEliminated('a')).toBe(true);
  });
  it('protection after a revive: no kill for 5 s, then killable again', () => {
    const { host, sys } = setup();
    sys.kill('a', CAUSE);
    sys.revive('a', 'b');
    expect(sys.canKill('a')).toBe(false);
    expect(sys.kill('a', CAUSE)).toEqual({ ok: false, reason: 'protected' });
    host.tick += sec(5) - 1;
    expect(sys.canKill('a')).toBe(false);
    host.tick += 1;
    expect(sys.canKill('a')).toBe(true);
    expect(sys.kill('a', CAUSE).ok).toBe(true);
  });
});

describe('P4 items drop where the player dies', () => {
  it('one part per step until nothing is carried, each logged with the tick it fell and where', () => {
    const { host, sys } = setup();
    host.carrying.set('a', [{ itemId: 'k1', kind: 'access_key' }, { itemId: 'p1', kind: 'fuse' }]);
    sys.kill('a', CAUSE);
    expect(sys.dropping).toBe(true);
    host.tick++; sys.step();
    expect(sys.events.filter((e) => e.kind === 'item_dropped')).toHaveLength(1);
    expect(sys.dropping).toBe(true);
    host.tick++; sys.step();
    expect(sys.events.filter((e) => e.kind === 'item_dropped')).toHaveLength(2);
    expect(sys.dropping).toBe(false);
    const first = sys.events.find((e) => e.kind === 'item_dropped')!;
    expect(first).toMatchObject({ player: 'a', itemId: 'k1', x: 100, y: 680, relocated: false });
    expect(first.tick).toBeGreaterThan(sys.deathOf('a')!.tick);
  });
  it('a drop that never works does not loop forever: after the attempt limit everything is put down at once', () => {
    const { host, sys } = setup();
    host.carrying.set('a', [{ itemId: 'k1', kind: 'access_key' }]);
    host.stuck = true;
    sys.kill('a', CAUSE);
    for (let i = 0; i < DEATH_TABLE.dropAttempts + 5; i++) { host.tick++; sys.step(); }
    expect(host.dropAllCalls).toEqual(['a']);
    expect(sys.dropping).toBe(false);
    expect(sys.events.some((e) => e.kind === 'drops_forced')).toBe(true);
  });
  it('a relocated part is flagged in the log (it did not stay where the player fell)', () => {
    const { host, sys } = setup();
    host.carrying.set('a', [{ itemId: 'k1', kind: 'access_key' }]);
    host.dropOne = () => ({ left: 0, dropped: { itemId: 'k1', kind: 'access_key', x: 340, y: 680, room: 'r0' } });
    sys.kill('a', CAUSE);
    host.tick++; sys.step();
    expect(sys.events.find((e) => e.kind === 'item_dropped')).toMatchObject({ relocated: true, x: 340 });
  });
  it('a dead player who disconnects stays dead; the item system puts down what is left; they are not counted as able to act', () => {
    const { host, sys } = setup();
    host.carrying.set('a', [{ itemId: 'k1', kind: 'access_key' }]);
    sys.kill('a', CAUSE);
    sys.disconnect('a');
    expect(sys.dropping).toBe(false);
    expect(sys.lifeOf('a')).toBe('downed');
    expect(sys.events.at(-1)).toMatchObject({ kind: 'disconnected', player: 'a', life: 'downed' });
  });
});

describe('P4 who can still act', () => {
  it('noneAlive: everybody dead, or the living are all disconnected; a stray id is never dead', () => {
    const { host, sys } = setup();
    expect(sys.noneAlive()).toBe(false);
    sys.kill('a', CAUSE);
    expect(sys.noneAlive()).toBe(false);
    host.players[1]!.connected = false;
    expect(sys.noneAlive()).toBe(true);
    host.players[1]!.connected = true;
    sys.kill('b', CAUSE);
    expect(sys.noneAlive()).toBe(true);
    expect(sys.isDead('nobody')).toBe(false);
    expect(sys.lifeOf('nobody')).toBeUndefined();
  });
  it('an empty roster is not a wipe', () => {
    const host = new FakeHost();
    const sys = new DeathSystem({ difficulty: 'easy', stage: 2 }, host);
    expect(sys.noneAlive()).toBe(false);
  });
  it('a player who leaves the run is forgotten', () => {
    const { sys } = setup();
    sys.kill('a', CAUSE);
    sys.removePlayer('a');
    expect(sys.lifeOf('a')).toBeUndefined();
    expect(sys.bodies()).toEqual([]);
  });
  it('the event log is a bounded ring and every entry carries its tick', () => {
    const { host, sys } = setup(['a']);
    for (let i = 0; i < DEATH_TABLE.maxEvents + 50; i++) { host.tick++; sys.kill('zzz', CAUSE); }
    expect(sys.events.length).toBe(DEATH_TABLE.maxEvents);
    expect(sys.events.every((e) => typeof e.tick === 'number' && e.tick > 0)).toBe(true);
    expect(sys.events.at(-1)!.tick).toBe(host.tick); // the newest survives, the oldest fell off
  });
  it('lethality can be switched off for generator tests only, and a refused kill leaves everyone alive', () => {
    const { sys } = setup();
    sys.setLethal(false);
    expect(sys.canKill('a')).toBe(false);
    expect(sys.kill('a', CAUSE).ok).toBe(false);
    expect(sys.isAlive('a')).toBe(true);
    sys.setLethal(true);
    expect(sys.kill('a', CAUSE).ok).toBe(true);
  });
  it('the machine is the existing one: no kill ever skips a state it may not skip', () => {
    for (const d of ['easy', 'intermediate', 'hardcore'] as const) {
      const { sys } = setup(['a'], d);
      sys.kill('a', CAUSE);
      expect(['downed', 'eliminated']).toContain(sys.lifeOf('a'));
    }
  });
});
