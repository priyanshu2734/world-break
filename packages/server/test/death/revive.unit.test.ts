import { describe, expect, it } from 'vitest';
import { GUN_LIMITS } from '@wb/shared';
import { PulseGun, type GunHost } from '../../src/ghost';
import { DEATH_TABLE, DeathSystem, REVIVE, ReviveSystem, type CarriedItem, type DeathHost, type DeathWho, type DroppedItem, type KillCause, type ReviveBody, type ReviveHost, type Reviver } from '../../src/death';

class FakeRevive implements ReviveHost {
  tick = 1000;
  folks: Reviver[] = [];
  deadBodies: ReviveBody[] = [];
  cell = new Set<string>();
  canWindow = true;
  revived: { body: string; by: string }[] = [];
  spent: string[] = [];
  said: string[] = [];
  people(): Reviver[] { return this.folks; }
  bodies(): ReviveBody[] { return this.deadBodies; }
  carriesCell(id: string): boolean { return this.cell.has(id); }
  spendCell(id: string): boolean { if (!this.cell.has(id)) return false; this.cell.delete(id); this.spent.push(id); return true; }
  canRevive(): boolean { return this.canWindow; }
  revive(body: string, by: string): { ok: boolean } { this.revived.push({ body, by }); return { ok: true }; }
  say(text: string): void { this.said.push(text); }
}
const person = (id: string, x: number, o: Partial<Reviver> = {}): Reviver => ({ id, room: 'r0', x, y: 680, use: true, connected: true, alive: true, hidden: false, ...o });
const body = (id: string, x: number, o: Partial<ReviveBody> = {}): ReviveBody => ({ id, name: id.toUpperCase(), room: 'r0', x, y: 680, ...o });
function setup(): { h: FakeRevive; sys: ReviveSystem } {
  const h = new FakeRevive();
  h.folks = [person('r', 500)];
  h.deadBodies = [body('b', 540)];
  h.cell.add('r');
  return { h, sys: new ReviveSystem(h) };
}
const hold = (h: FakeRevive, sys: ReviveSystem, n: number) => { for (let i = 0; i < n; i++) { h.tick++; sys.step(); } };

describe('P4 step 3: the revive hold', () => {
  it('3 seconds of E next to a body, carrying the cell: the cell is spent and the body comes back, said once', () => {
    const { h, sys } = setup();
    hold(h, sys, REVIVE.holdTicks - 1);
    expect(h.revived).toEqual([]);
    expect(sys.progress()).toEqual([{ reviver: 'r', body: 'b', progress: (REVIVE.holdTicks - 1) / REVIVE.holdTicks }]);
    hold(h, sys, 1);
    expect(h.revived).toEqual([{ body: 'b', by: 'r' }]);
    expect(h.spent).toEqual(['r']);
    expect(h.said).toEqual(['B is back on their feet.']);
    expect(sys.progress()).toEqual([]);
    hold(h, sys, 5);
    expect(h.revived).toHaveLength(1); // the cell is gone: nothing more happens
  });
  it('letting go of E, stepping out of reach, or a break of one tick starts it over', () => {
    const { h, sys } = setup();
    hold(h, sys, 40);
    h.folks[0]!.use = false; hold(h, sys, 1);
    expect(sys.progress()).toEqual([]);
    h.folks[0]!.use = true; hold(h, sys, 59);
    expect(h.revived).toEqual([]);
    h.folks[0]!.x = 500 + REVIVE.range + 80; hold(h, sys, 1); // beyond reach of the body at 540
    expect(sys.progress()).toEqual([]);
    h.folks[0]!.x = 500; hold(h, sys, REVIVE.holdTicks);
    expect(h.revived).toHaveLength(1);
  });
  it('wrong target: nothing happens without the cell, in another room, too high, hidden, disconnected, or when the reviver is themselves dead', () => {
    for (const mutate of [
      (h: FakeRevive) => h.cell.clear(),
      (h: FakeRevive) => { h.folks[0]!.room = 'r1'; },
      (h: FakeRevive) => { h.folks[0]!.y = 680 - REVIVE.dy - 10; },
      (h: FakeRevive) => { h.folks[0]!.hidden = true; },
      (h: FakeRevive) => { h.folks[0]!.connected = false; },
      (h: FakeRevive) => { h.folks[0]!.alive = false; },
    ]) {
      const { h, sys } = setup();
      mutate(h);
      hold(h, sys, REVIVE.holdTicks * 2);
      expect(h.revived).toEqual([]);
      expect(h.spent).toEqual([]);
      expect(sys.progress()).toEqual([]);
    }
  });
  it('an alive teammate is never a target: only bodies are listed', () => {
    const { h, sys } = setup();
    h.deadBodies = []; // the teammate next to the reviver is alive, so the death system lists no body
    hold(h, sys, REVIVE.holdTicks * 2);
    expect(h.revived).toEqual([]);
    expect(h.spent).toEqual([]);
  });
  it('a body that can no longer be revived (window over, Hardcore) spends nothing', () => {
    const { h, sys } = setup();
    h.canWindow = false;
    hold(h, sys, REVIVE.holdTicks * 2);
    expect(h.revived).toEqual([]);
    expect(h.spent).toEqual([]);
    expect(h.cell.has('r')).toBe(true);
  });
  it('one reviver per body, and the nearer body wins when two are in reach', () => {
    const { h, sys } = setup();
    h.folks = [person('r', 500), person('s', 505)];
    h.cell.add('s');
    hold(h, sys, REVIVE.holdTicks);
    expect(h.revived).toEqual([{ body: 'b', by: 'r' }]); // r came first; s did not take the same body
    expect(h.spent).toEqual(['r']);
    const t = setup();
    t.h.deadBodies = [body('far', 560), body('near', 520)];
    hold(t.h, t.sys, REVIVE.holdTicks);
    expect(t.h.revived).toEqual([{ body: 'near', by: 'r' }]);
  });
  it('two bodies, one cell: one comes back, the other stays a body', () => {
    const { h, sys } = setup();
    h.deadBodies = [body('b1', 520), body('b2', 530)];
    hold(h, sys, REVIVE.holdTicks * 3);
    expect(h.revived).toHaveLength(1);
    expect(h.spent).toEqual(['r']);
  });
  it('the numbers are fixed (3 s, 70 px), the same at stage 1 and stage 1,000,000', () => {
    expect(REVIVE.holdTicks).toBe(60);
    expect(REVIVE.range).toBe(70);
  });
  it('a player who leaves the run is forgotten', () => {
    const { h, sys } = setup();
    hold(h, sys, 10);
    sys.remove('r');
    h.folks = [];
    hold(h, sys, 1);
    expect(sys.progress()).toEqual([]);
  });
});

class DHost implements DeathHost {
  tick = DEATH_TABLE.spawnGraceS * 20;
  players: DeathWho[] = [{ id: 'a', name: 'A', slot: 0, room: 'r0', x: 100, y: 680, connected: true }];
  carrying: CarriedItem[] = [];
  dropAllCalls = 0;
  frozen = new Set<string>();
  who(): DeathWho[] { return this.players; }
  freeze(id: string, on: boolean): void { if (on) this.frozen.add(id); else this.frozen.delete(id); }
  carried(): CarriedItem[] { return [...this.carrying]; }
  dropOne(): { left: number; dropped: DroppedItem | null } { return { left: this.carrying.length, dropped: null }; }
  dropAll(): void { this.dropAllCalls++; this.carrying = []; }
  leaveHiding(): void { /* nothing */ }
  say(): void { /* nothing */ }
}
const CAUSE: KillCause = { how: 'touch', ghost: 'g0', ghostKind: null, because: [] };

describe('P4 step 3: the death system side of a revive', () => {
  it('canRevive is true only for a body inside its window on Easy and Intermediate; it changes nothing', () => {
    for (const [d, want] of [['easy', true], ['intermediate', true], ['hardcore', false]] as const) {
      const h = new DHost(), s = new DeathSystem({ difficulty: d, stage: 2 }, h);
      s.addPlayer('a');
      expect(s.canRevive('a')).toBe(false); // alive
      s.kill('a', CAUSE);
      expect(s.canRevive('a')).toBe(want);
      if (want) { h.tick += DEATH_TABLE.reviveWindowS * 20; expect(s.canRevive('a')).toBe(false); expect(s.lifeOf('a')).toBe('downed'); } // window over, not yet stepped: still not revivable
    }
    expect(new DeathSystem({ difficulty: 'easy', stage: 2 }, new DHost()).canRevive('zzz')).toBe(false);
  });
  it('a revive puts down anything still in the hands (a drop in progress) so they come back with EMPTY hands, and stops the drop', () => {
    const h = new DHost(), s = new DeathSystem({ difficulty: 'easy', stage: 2 }, h);
    s.addPlayer('a');
    h.carrying = [{ itemId: 'k1', kind: 'access_key' }, { itemId: 'f1', kind: 'fuse' }];
    s.kill('a', CAUSE);
    expect(s.dropping).toBe(true);
    expect(s.revive('a', 'b')).toEqual({ ok: true });
    expect(h.dropAllCalls).toBe(1);
    expect(h.carrying).toEqual([]);
    expect(s.dropping).toBe(false);
    expect(h.frozen.has('a')).toBe(false);
    expect(s.protectedUntil('a')).toBe(h.tick + DEATH_TABLE.protectionS * 20);
  });
  it('with nothing in the hands there is nothing to put down', () => {
    const h = new DHost(), s = new DeathSystem({ difficulty: 'easy', stage: 2 }, h);
    s.addPlayer('a'); s.kill('a', CAUSE); s.revive('a', 'b');
    expect(h.dropAllCalls).toBe(0);
  });
});

describe('P4 the Pulse Gun of a dead player (cooldown belongs to the gun, not to the shooter)', () => {
  it('a gun that was fired just before its owner died is still recharging in the hands of the teammate who picks it up', () => {
    class Two implements GunHost {
      tick = 0; cooldownTicks = 600;
      shooter(id: string) { return id === 'a' || id === 'b' ? { room: 'r0', x: 100, y: 680, aim: 0, name: id.toUpperCase(), connected: true } : undefined; }
      carries(): boolean { return true; }
      trace(): { hit: string | null; blocked: boolean } { return { hit: null, blocked: false }; }
      destroy(): boolean { return false; }
      noise(): void { /* nothing */ }
      say(): void { /* nothing */ }
      log(): void { /* nothing */ }
      playerIds(): string[] { return ['a', 'b']; }
      sees(): boolean { return true; }
    }
    const h = new Two(), g = new PulseGun(h);
    expect(g.fire('a').ok).toBe(true);
    h.tick += 100; // a dies; b picks the gun up
    const r = g.fire('b');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain('recharging');
    h.tick += 500; expect(g.fire('b').ok).toBe(true);
    expect(GUN_LIMITS.rangePx).toBeGreaterThan(0);
  });
});
