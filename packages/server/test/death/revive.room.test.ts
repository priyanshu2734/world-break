import { describe, expect, it } from 'vitest';
import type { Difficulty } from '@wb/shared';
import { Room } from '../../src/room';
import type { GameSim } from '../../src/game';
import { REVIVE } from '../../src/death';

let seq = 0;
const STAGE = 2;
function build(seed: number, players: number, difficulty: Difficulty): Room {
  const r = new Room('DETH', 3, seed, { escape: true, ghost: true, startStage: STAGE });
  r.difficulty = difficulty;
  for (let i = 0; i < players; i++) r.join(`p${i}`, `P${i}`);
  for (let i = 1; i < players; i++) r.setReady(`p${i}`, true);
  expect(r.start('p0').ok).toBe(true);
  for (let i = 0; i < 10 && r.phase !== 'playing'; i++) r.tick();
  return r;
}
/** A run whose Revive Cell lies in the START room (so a test can reach it without opening a door). Found by trying run seeds: deterministic. */
function mk(players = 3, difficulty: Difficulty = 'easy'): Room {
  for (let seed = 1; seed < 200; seed++) {
    const r = build(seed, players, difficulty);
    const cell = r.peekStageState()!.items!.items.find((i) => i.kind === 'revive_cell');
    if (difficulty === 'hardcore') return r;
    if (cell && cell.roomId === roomOf(r, 'p0')) return r;
  }
  throw new Error('no run seed has the cell in the start room');
}
const sim = (r: Room) => (r as unknown as { sim: GameSim }).sim;
const at = (r: Room, id: string, x: number) => sim(r).placeAt(id, x, 680);
const me = (r: Room, id: string) => r.gameSnapshot()!.players.find((p) => p.id === id)!;
const roomOf = (r: Room, id = 'p0') => me(r, id).roomId!;
const idle = (r: Room, id: string, use = false) => r.submitInput(id, ++seq, { moveX: 0, jump: false }, { use });
const tick = (r: Room, n = 1) => { for (let i = 0; i < n; i++) r.tick(); };
const itemsOf = (r: Room) => r.peekStageState()!.items!.items;
const cellOf = (r: Room) => itemsOf(r).find((i) => i.kind === 'revive_cell')!;
function kill(r: Room, id: string): void {
  for (let i = 0; i < 1500 && !r.deathSystem!.isDead(id); i++) {
    if (i % 100 === 0) { const q = me(r, id); r.ghostSystem!.placeForTest('g0', { room: roomOf(r, id), x: q.x - 60, y: q.y - 22, angle: 0, state: 'hunting' }); }
    idle(r, id); tick(r);
  }
  expect(r.deathSystem!.isDead(id)).toBe(true);
}
/** p1 picks up the cell (standing at it), then everyone else is moved. Returns the cell id. */
function takeCell(r: Room, by = 'p1'): string {
  const c = cellOf(r);
  at(r, by, c.x); tick(r, 25);
  expect(r.itemAction(by, { action: 'pickup', itemId: c.id }).ok).toBe(true);
  tick(r, 15);
  expect(itemsOf(r).find((i) => i.id === c.id)!.carrierId).toBe(by);
  return c.id;
}
/** Hold E for `n` ticks as `id`. */
const holdE = (r: Room, id: string, n: number) => { for (let i = 0; i < n; i++) { idle(r, id, true); tick(r); } };

describe('P4 step 3: reviving through the Room (Easy)', () => {
  it('a teammate carries the cell to the body and holds E for 3 s: the player comes back at the body with 5 s of protection and empty hands; their dropped items stay where they fell; the cell is spent', () => {
    const r = mk(3);
    at(r, 'p2', 1500);
    // p0 picks up the key and is killed with it in their hands
    const key = itemsOf(r).find((i) => i.kind === 'access_key')!;
    at(r, 'p0', key.x); tick(r, 25);
    r.itemAction('p0', { action: 'pickup', itemId: key.id }); tick(r, 15);
    const cellId = takeCell(r, 'p1');
    at(r, 'p0', 600);
    kill(r, 'p0'); tick(r, 40);
    const bodyX = me(r, 'p0').x;
    const keyAt = itemsOf(r).find((i) => i.id === key.id)!;
    expect(keyAt.state).toBe('in_world');
    const d = r.deathSystem!;
    expect(d.isBody('p0')).toBe(true);
    // p1 walks to the body (placed, as the other tests do), holds E
    at(r, 'p1', bodyX + 40);
    holdE(r, 'p1', REVIVE.holdTicks - 1);
    expect(d.isBody('p0')).toBe(true);
    expect(r.deathState('p1')!.reviving).toMatchObject({ id: 'p0', name: 'P0' });
    expect(r.deathState('p0')!.beingRevived).toBeGreaterThan(0.9);
    holdE(r, 'p1', 1);
    expect(d.lifeOf('p0')).toBe('alive');
    expect(Math.abs(me(r, 'p0').x - bodyX)).toBeLessThan(2);
    expect(d.protectedUntil('p0')).toBe(sim(r).tick + 100);
    expect(d.canKill('p0')).toBe(false);
    // empty hands; the key is where it fell, not in their hands; the cell is gone from p1's
    tick(r, 5);
    const it = itemsOf(r);
    expect(it.filter((i) => i.carrierId === 'p0')).toEqual([]);
    const k2 = it.find((i) => i.id === key.id)!;
    expect(k2.state).toBe('in_world');
    expect(k2.x).toBe(keyAt.x);
    expect(it.find((i) => i.id === cellId)?.state ?? 'gone').not.toBe('carried');
    expect(it.filter((i) => i.carrierId === 'p1')).toEqual([]);
    // they can act again, and the revived state is told to them
    expect(idle(r, 'p0')).toBe(true);
    expect(r.deathState('p0')).toMatchObject({ life: 'alive', following: null, reviving: null, beingRevived: null });
    expect(d.events.some((e) => e.kind === 'revived' && e.player === 'p0' && e.by === 'p1')).toBe(true);
  });
  it('they are back in the stage for good: the revived player can pick up what lies there, and a second death of theirs is a new death', () => {
    const r = mk(3);
    at(r, 'p2', 1500);
    takeCell(r, 'p1');
    at(r, 'p0', 600); kill(r, 'p0'); tick(r, 10);
    at(r, 'p1', 640); holdE(r, 'p1', REVIVE.holdTicks);
    expect(r.deathSystem!.isAlive('p0')).toBe(true);
    const key = itemsOf(r).find((i) => i.kind === 'access_key')!;
    at(r, 'p0', key.x); tick(r, 40);
    expect(r.itemAction('p0', { action: 'pickup', itemId: key.id }).ok).toBe(true);
  });
});

describe('P4 step 3: what does not revive', () => {
  it('no cell in the hands: holding E next to a body does nothing', () => {
    const r = mk(3);
    at(r, 'p2', 1500); at(r, 'p0', 600); kill(r, 'p0'); tick(r, 10);
    at(r, 'p1', 640);
    holdE(r, 'p1', REVIVE.holdTicks * 2);
    expect(r.deathSystem!.isBody('p0')).toBe(true);
    expect(r.deathState('p1')!.reviving).toBeNull();
  });
  it('wrong target: the cell next to a LIVING teammate, or too far from the body, or a hold broken by letting go, revives nobody and spends nothing', () => {
    const r = mk(3);
    at(r, 'p2', 1500);
    const cellId = takeCell(r, 'p1');
    at(r, 'p0', 600); kill(r, 'p0'); tick(r, 10);
    r.deathSystem!.setLethal(false); // these checks are about the revive rules; a roaming ghost must not kill the reviver in the middle
    const stillMine = () => itemsOf(r).find((i) => i.id === cellId)!.carrierId === 'p1';
    at(r, 'p1', 600 + REVIVE.range + 60); holdE(r, 'p1', REVIVE.holdTicks * 2); // too far
    expect(r.deathSystem!.isBody('p0')).toBe(true); expect(stillMine()).toBe(true);
    at(r, 'p1', 640); holdE(r, 'p1', REVIVE.holdTicks - 5); // let go early
    idle(r, 'p1', false); tick(r, 3);
    holdE(r, 'p1', REVIVE.holdTicks - 5);
    expect(r.deathSystem!.isBody('p0')).toBe(true); expect(stillMine()).toBe(true);
    at(r, 'p1', 1500 - 40); holdE(r, 'p1', REVIVE.holdTicks * 2); // next to the living p2
    expect(r.deathSystem!.isAlive('p2')).toBe(true); expect(stillMine()).toBe(true);
  });
  it('after the window the body is eliminated: the cell revives nobody and is not spent; a dead player cannot revive anyone', () => {
    const r = mk(3);
    at(r, 'p2', 1500);
    const cellId = takeCell(r, 'p1');
    at(r, 'p0', 600); kill(r, 'p0');
    r.deathSystem!.setLethal(false); // the window runs out with nobody to be killed in the meantime
    for (let i = 0; i < 1000 && r.deathSystem!.isBody('p0'); i++) { idle(r, 'p1'); tick(r); }
    expect(r.deathSystem!.lifeOf('p0')).toBe('eliminated');
    at(r, 'p1', 640); holdE(r, 'p1', REVIVE.holdTicks * 2);
    expect(r.deathSystem!.lifeOf('p0')).toBe('eliminated');
    expect(itemsOf(r).find((i) => i.id === cellId)!.carrierId).toBe('p1');
  });
  it('a body cannot be revived by someone who is dead too, and an eliminated spectator stays one', () => {
    const r = mk(3);
    at(r, 'p2', 1500);
    const cellId = takeCell(r, 'p1');
    at(r, 'p0', 600); kill(r, 'p0');
    // p1 dies holding the cell: it drops at p1's body and p1 can no longer revive anyone
    r.deathSystem!.setLethal(true);
    for (let i = 0; i < 400; i++) { idle(r, 'p2'); tick(r); } // the ghost is satiated for a while
    at(r, 'p1', 700); kill(r, 'p1'); tick(r, 40);
    expect(itemsOf(r).find((i) => i.id === cellId)!.state).toBe('in_world');
    expect(idle(r, 'p1', true)).toBe(false);
    expect(r.deathSystem!.isDead('p0')).toBe(true);
  });
});

describe('P4 step 3: revive with the ghost on the body, and two deaths on one tick', () => {
  it('the ghost stands on the body: the revive still works, and the revived player is not touched until the protection is over', () => {
    const r = mk(3);
    at(r, 'p2', 1500);
    takeCell(r, 'p1');
    at(r, 'p0', 600); kill(r, 'p0'); tick(r, 10);
    at(r, 'p1', 640);
    const bodyAt = () => me(r, 'p0');
    const stand = () => { const q = bodyAt(); r.ghostSystem!.placeForTest('g0', { room: roomOf(r, 'p0'), x: q.x - 20, y: q.y - 22, angle: 0, state: 'hunting' }); };
    for (let i = 0; i < REVIVE.holdTicks && r.deathSystem!.isBody('p0'); i++) { if (i % 20 === 0) stand(); idle(r, 'p1', true); tick(r); }
    expect(r.deathSystem!.isAlive('p0')).toBe(true);
    const until = r.deathSystem!.protectedUntil('p0');
    expect(until).toBeGreaterThan(sim(r).tick);
    while (sim(r).tick < until) { stand(); idle(r, 'p0'); idle(r, 'p1'); tick(r); expect(r.deathSystem!.isAlive('p0')).toBe(true); }
    // protection over, the ghost still on them: they can die again (a NEW death, at or after the end of the protection)
    for (let i = 0; i < 600 && r.deathSystem!.isAlive('p0'); i++) { if (i % 20 === 0) stand(); idle(r, 'p0'); tick(r); }
    const killed = r.deathSystem!.events.filter((e) => e.kind === 'killed' && e.player === 'p0');
    expect(killed).toHaveLength(2);
    expect(killed[1]!.tick).toBeGreaterThanOrEqual(until);
  });
  it('two players die on the same tick: both are bodies, one cell brings back exactly one (the nearer), the other stays a body', () => {
    const r2 = mk(4);
    const cause = { how: 'touch' as const, ghost: 'g0', ghostKind: null, because: ['test'] };
    at(r2, 'p3', 1500);
    const c2 = takeCell(r2, 'p1');
    at(r2, 'p0', 600); at(r2, 'p2', 560);
    tick(r2, 420);
    const d2 = r2.deathSystem!;
    expect(d2.kill('p0', cause).ok).toBe(true);
    expect(d2.kill('p2', cause).ok).toBe(true);
    const ks = d2.events.filter((e) => e.kind === 'killed');
    expect(ks.map((e) => e.tick)).toEqual([ks[0]!.tick, ks[0]!.tick]);
    at(r2, 'p1', 630);
    holdE(r2, 'p1', REVIVE.holdTicks * 3);
    expect(d2.isAlive('p0')).toBe(true);   // 30 px away: the nearer
    expect(d2.isBody('p2')).toBe(true);    // 70 px away: not revived, there was one cell
    expect(itemsOf(r2).find((i) => i.id === c2)?.state ?? 'gone').not.toBe('carried');
  });
});

describe('P4 step 3: hidden information and Hardcore', () => {
  it('the Revive Cell is in nobody’s view but the living players near it: not in a spectator’s message, and the revive progress is told to the reviver and the body only', () => {
    const r = mk(3);
    at(r, 'p2', 1500);
    const cellId = takeCell(r, 'p1');
    at(r, 'p0', 600); kill(r, 'p0'); tick(r, 5);
    expect(JSON.stringify(r.viewFor('p0'))).not.toContain(cellId);
    at(r, 'p1', 640);
    holdE(r, 'p1', 30);
    expect(r.deathState('p1')!.reviving!.progress).toBeGreaterThan(0.3);
    expect(r.deathState('p0')!.beingRevived).toBeGreaterThan(0.3);
    expect(r.deathState('p2')!.reviving ?? null).toBeNull();
    expect(r.deathState('p2')!.beingRevived ?? null).toBeNull();
    // the dead player's state never shows where the cell is
    expect(JSON.stringify(r.deathState('p0'))).not.toContain(cellId);
  });
  it('Hardcore: there is no Revive Cell on the stage and a death is final', () => {
    const r = mk(2, 'hardcore');
    expect(itemsOf(r).some((i) => i.kind === 'revive_cell')).toBe(false);
    at(r, 'p0', 600); at(r, 'p1', 1500);
    kill(r, 'p0');
    expect(r.deathSystem!.lifeOf('p0')).toBe('eliminated');
    expect(r.deathSystem!.canRevive('p0')).toBe(false);
    expect(r.deathSystem!.revive('p0', 'p1')).toEqual({ ok: false, reason: 'no_revive_here' });
  });
  it('dropped things count nothing against the 2-slot rule: a teammate with full hands cannot pick a dead player’s key up until they put something down', () => {
    const r = mk(3);
    at(r, 'p2', 1500);
    const key = itemsOf(r).find((i) => i.kind === 'access_key')!;
    at(r, 'p0', key.x); tick(r, 25);
    r.itemAction('p0', { action: 'pickup', itemId: key.id }); tick(r, 15);
    kill(r, 'p0'); tick(r, 40);
    const dropped = itemsOf(r).find((i) => i.id === key.id)!;
    expect(dropped.state).toBe('in_world');
    // p1 holds the cell (1 slot): the key (1 slot) still fits: dropped items are free to take, and p0's hands hold nothing now
    const cellId = takeCell(r, 'p1');
    at(r, 'p1', dropped.x); tick(r, 25);
    expect(r.itemAction('p1', { action: 'pickup', itemId: key.id }).ok).toBe(true);
    expect(itemsOf(r).filter((i) => i.carrierId === 'p0')).toEqual([]);
    expect(itemsOf(r).find((i) => i.id === cellId)!.carrierId).toBe('p1');
  });
});
