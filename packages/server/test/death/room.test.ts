import { describe, expect, it } from 'vitest';
import type { Difficulty } from '@wb/shared';
import { Room } from '../../src/room';
import type { GameSim } from '../../src/game';

let seq = 0;
const SEED = 9; // stage 2: a key lies at x 950 and a closet at x 690 in the start room
function mk(players = 2, difficulty: Difficulty = 'easy', stage = 2): Room {
  const r = new Room('DETH', 3, SEED, { escape: true, ghost: true, startStage: stage });
  r.difficulty = difficulty;
  for (let i = 0; i < players; i++) r.join(`p${i}`, `P${i}`);
  for (let i = 1; i < players; i++) r.setReady(`p${i}`, true);
  expect(r.start('p0').ok).toBe(true);
  for (let i = 0; i < 10 && r.phase !== 'playing'; i++) r.tick();
  return r;
}
const sim = (r: Room) => (r as unknown as { sim: GameSim }).sim;
const at = (r: Room, id: string, x: number) => sim(r).placeAt(id, x, 680);
const me = (r: Room, id: string) => r.gameSnapshot()!.players.find((p) => p.id === id)!;
const roomOf = (r: Room, id = 'p0') => me(r, id).roomId!;
const input = (r: Room, id: string, moveX: number) => r.submitInput(id, ++seq, { moveX, jump: false });
const tick = (r: Room, n = 1) => { for (let i = 0; i < n; i++) r.tick(); };
/** Put the ghost on top of `id`, hunting, and run until they are dead or `max` ticks passed. */
function touch(r: Room, id: string, max = 1500): void {
  const g = r.ghostSystem!;
  for (let i = 0; i < max && !r.deathSystem!.isDead(id); i++) {
    if (i % 100 === 0) { const q = me(r, id); g.placeForTest('g0', { room: roomOf(r, id), x: q.x - 60, y: q.y - 22, angle: 0, state: 'hunting' }); }
    input(r, id, 0); tick(r);
  }
}
const placeGhostOn = (r: Room, id: string) => { const q = me(r, id); r.ghostSystem!.placeForTest('g0', { room: roomOf(r, id), x: q.x - 60, y: q.y - 22, angle: 0, state: 'hunting' }); };

describe('P4 spawn grace: no kill in the first 20 seconds of a stage', () => {
  it('a hunting ghost on top of a player for 19 seconds does not kill them', () => {
    const r = mk();
    at(r, 'p0', 600); at(r, 'p1', 300);
    for (let i = 0; i < 380; i++) { if (i % 20 === 0) placeGhostOn(r, 'p0'); input(r, 'p0', 0); tick(r); }
    expect(r.deathSystem!.isAlive('p0')).toBe(true);
    expect(r.deathSystem!.events.filter((e) => e.kind === 'killed')).toEqual([]);
  });
  it('and it does kill once the grace is over (a touch has to last, then it kills)', () => {
    const r = mk();
    at(r, 'p0', 600); at(r, 'p1', 300);
    touch(r, 'p0');
    expect(r.deathSystem!.isDead('p0')).toBe(true);
    expect(r.deathSystem!.deathOf('p0')!.tick).toBeGreaterThanOrEqual(400);
  });
});

describe('P4 touch is death, by mode', () => {
  it('easy: a body for the window, then eliminated', () => {
    const r = mk();
    at(r, 'p0', 600); at(r, 'p1', 1500);
    touch(r, 'p0');
    expect(r.deathSystem!.lifeOf('p0')).toBe('downed');
    const ev = r.deathSystem!.events.find((e) => e.kind === 'killed')!;
    expect(ev).toMatchObject({ kind: 'killed', player: 'p0', life: 'downed', cause: { how: 'touch', ghost: 'g0' } });
    expect(ev.kind === 'killed' && ev.cause.because.length).toBeGreaterThan(0);
  });
  it('hardcore: touch goes straight to eliminated', () => {
    const r = mk(2, 'hardcore');
    at(r, 'p0', 600); at(r, 'p1', 1500);
    touch(r, 'p0');
    expect(r.deathSystem!.lifeOf('p0')).toBe('eliminated');
    expect(r.deathSystem!.bodies()).toEqual([]);
  });
  it('a hidden player is never touched', () => {
    const r = mk();
    const spot = (r as unknown as { engine: { def: { escape: { hidingSpots: { x: number }[] } } } }).engine.def.escape.hidingSpots[0]!;
    at(r, 'p0', spot.x); at(r, 'p1', 300);
    expect(r.ghostAction('p0', { action: 'hide' }).ok).toBe(true);
    for (let i = 0; i < 700; i++) { if (i % 50 === 0) placeGhostOn(r, 'p0'); tick(r); }
    expect(r.deathSystem!.isAlive('p0')).toBe(true);
  });
});

describe('P4 the ghost is satiated after a kill', () => {
  it('it logs a satiated event, stands quiet for about 8 seconds, and a second player at the body is not killed in that time', () => {
    const r = mk(2);
    at(r, 'p0', 600); at(r, 'p1', 640);
    touch(r, 'p0');
    const tKill = r.deathSystem!.deathOf('p0')!.tick;
    const events = r.drainGhostEvents();
    expect(events.some((e) => e.kind === 'satiated')).toBe(true);
    // p1 stands right next to the body and the ghost: nothing happens for the satiated time
    const g = r.ghostSystem!;
    for (let i = 0; i < 150; i++) { const q = me(r, 'p1'); g.placeForTest('g0', { room: roomOf(r, 'p1'), x: q.x - 40, y: q.y - 22, angle: 0, state: 'hunting' }); input(r, 'p1', 0); tick(r); if (sim(r).tick - tKill > 150) break; }
    expect(r.deathSystem!.isAlive('p1')).toBe(true);
  });
});

describe('P4 what a dead player carries', () => {
  it('drops where they die and can be picked up by a teammate; it is not left in the dead player’s hands', () => {
    const r = mk(2);
    const key = r.peekStageState()!.items!.items.find((i) => i.kind === 'access_key')!;
    at(r, 'p0', key.x); tick(r, 25);
    expect(r.itemAction('p0', { action: 'pickup', itemId: key.id }).ok).toBe(true);
    tick(r, 15);
    at(r, 'p1', 300);
    touch(r, 'p0');
    tick(r, 40);
    const k = r.peekStageState()!.items!.items.find((i) => i.id === key.id)!;
    expect(k.state).toBe('in_world');
    expect(Math.abs(k.x - me(r, 'p0').x)).toBeLessThan(5);
    expect(r.deathSystem!.events.some((e) => e.kind === 'item_dropped' && e.itemId === key.id)).toBe(true);
    // a teammate takes it
    at(r, 'p1', k.x + 5); tick(r, 25);
    expect(r.itemAction('p1', { action: 'pickup', itemId: key.id })).toMatchObject({ ok: true });
  });
  it('a disconnect drops what the player carries the same way', () => {
    const r = mk(2);
    const key = r.peekStageState()!.items!.items.find((i) => i.kind === 'access_key')!;
    at(r, 'p0', key.x); tick(r, 25);
    r.itemAction('p0', { action: 'pickup', itemId: key.id });
    tick(r, 15);
    r.disconnect('p0');
    tick(r, 5);
    expect(r.peekStageState()!.items!.items.find((i) => i.id === key.id)!.state).toBe('in_world');
  });
});

describe('P4 a dead player can only watch: every control input is refused', () => {
  it('moving, items, stage actions and the ghost actions all say so, and the body does not move', () => {
    const r = mk(2);
    at(r, 'p0', 600); at(r, 'p1', 1500);
    touch(r, 'p0');
    const msg = 'You are dead. You can only watch.';
    const x0 = me(r, 'p0').x;
    expect(input(r, 'p0', 1)).toBe(false);
    tick(r, 20);
    expect(me(r, 'p0').x).toBe(x0);
    expect(r.itemAction('p0', { action: 'pickup', itemId: 'x' })).toEqual({ ok: false, error: msg });
    expect(r.ghostAction('p0', { action: 'hide' })).toEqual({ ok: false, error: msg });
    expect(r.ghostAction('p0', { action: 'fire' })).toEqual({ ok: false, error: msg });
    expect(r.ghostAction('p0', { action: 'leave' })).toEqual({ ok: false, error: msg });
  });
  it('a dead player reconnecting is still dead (the body stays where it fell)', () => {
    const r = mk(2);
    at(r, 'p0', 600); at(r, 'p1', 1500);
    touch(r, 'p0');
    r.disconnect('p0');
    tick(r, 10);
    expect(r.deathSystem!.isDead('p0')).toBe(true);
    expect(input(r, 'p0', 1)).toBe(false);
  });
});

describe('P4 the stage goes on while somebody is alive, and ends when nobody is', () => {
  it('two players: one dies, the stage continues', () => {
    const r = mk(2);
    at(r, 'p0', 600); at(r, 'p1', 1500);
    touch(r, 'p0');
    tick(r, 100);
    expect(r.phase).toBe('playing');
  });
  it('solo: the death is a TEAM_WIPE (team_wiped) once the dead player’s items are down', () => {
    const r = mk(1);
    at(r, 'p0', 600);
    touch(r, 'p0');
    for (let i = 0; i < 60 && r.phase === 'playing'; i++) tick(r);
    expect(r.phase).toBe('team_wiped');
  });
  it('all players dead: team_wiped', () => {
    const r = mk(2);
    at(r, 'p0', 600); at(r, 'p1', 700);
    touch(r, 'p0');
    touch(r, 'p1');
    for (let i = 0; i < 80 && r.phase === 'playing'; i++) tick(r);
    expect(r.phase).toBe('team_wiped');
  });
});
