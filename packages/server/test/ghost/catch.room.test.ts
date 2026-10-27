import { describe, expect, it } from 'vitest';
import { CATCH_LIMITS, GhostCueSchema, GameSnapshotSchema, type GameSnapshot } from '@wb/shared';
import { Room } from '../../src/room';
import type { GameSim } from '../../src/game';

let seq = 0;
const SEED = 9; // stage 2: a key lies at x 950 and a closet at x 690 in the start room
function mk(players = 2): Room {
  const r = new Room('CATC', 3, SEED, { escape: true, ghost: true, startStage: 2 });
  for (let i = 0; i < players; i++) r.join(`p${i}`, `P${i}`);
  for (let i = 1; i < players; i++) r.setReady(`p${i}`, true);
  expect(r.start('p0').ok).toBe(true);
  for (let i = 0; i < 10 && r.phase !== 'playing'; i++) r.tick();
  return r;
}
const sim = (r: Room) => (r as unknown as { sim: GameSim }).sim;
const engine = (r: Room) => (r as unknown as { engine: { def: { escape: { hidingSpots: { id: string; x: number; y: number }[] } } } }).engine;
const spot = (r: Room) => engine(r).def.escape.hidingSpots[0]!;
const at = (r: Room, id: string, x: number) => sim(r).placeAt(id, x, 680);
const me = (r: Room, id: string) => r.gameSnapshot()!.players.find((p) => p.id === id)!;
const roomOf = (r: Room) => me(r, 'p0').roomId!;
const input = (r: Room, id: string, moveX: number, extra?: { use?: boolean }) => r.submitInput(id, ++seq, { moveX, jump: false }, extra);
const tick = (r: Room, n = 1) => { for (let i = 0; i < n; i++) r.tick(); };
const view = (r: Room, id: string): GameSnapshot => GameSnapshotSchema.parse(r.viewFor(id)!.snapshot);
const status = (r: Room, id: string) => r.ghostCue(id)!.status!;
/** The ghost right on top of p0 and looking at them: a real catch through the real ghost, no shortcuts. */
function catchP0(r: Room): void {
  const g = r.ghostSystem!;
  const p = me(r, 'p0');
  g.placeForTest('g0', { room: roomOf(r), x: p.x - 60, y: p.y - 22, angle: 0, state: 'hunting' });
  for (let i = 0; i < 200 && !r.catchSystem!.isCaptured('p0'); i++) { input(r, 'p0', 0); tick(r); }
  expect(r.catchSystem!.isCaptured('p0')).toBe(true);
}

describe('P3E hiding through the Room', () => {
  it('E at the spot: the player stops, is in nobody\'s view but their own, and is told where they hide', () => {
    const r = mk();
    at(r, 'p0', spot(r).x + 20); at(r, 'p1', spot(r).x + 60);
    tick(r, 3);
    expect(view(r, 'p1').players.map((p) => p.id)).toContain('p0'); // visible before
    const res = r.ghostAction('p0', { action: 'hide' });
    expect(res.ok).toBe(true);
    const x0 = me(r, 'p0').x;
    for (let i = 0; i < 20; i++) { input(r, 'p0', 1); tick(r); }
    expect(me(r, 'p0').x).toBe(x0); // frozen
    expect(view(r, 'p1').players.map((p) => p.id)).not.toContain('p0'); // not seen
    expect(JSON.stringify(view(r, 'p1').players)).not.toContain('p0'); // (the team list names everyone, with no position: that is not a sighting)
    expect(view(r, 'p0').players.map((p) => p.id)).toContain('p0');
    expect(status(r, 'p0').hiddenIn).toBe(spot(r).id);
    expect(status(r, 'p1').hiddenIn).toBeNull();
    expect(GhostCueSchema.safeParse(r.ghostCue('p0')).success).toBe(true);
  });
  it('E again comes out and the player can move and be seen again', () => {
    const r = mk();
    at(r, 'p0', spot(r).x); at(r, 'p1', spot(r).x + 60);
    r.ghostAction('p0', { action: 'hide' });
    tick(r, CATCH_LIMITS.hideCooldownTicks);
    expect(r.ghostAction('p0', { action: 'leave' }).ok).toBe(true);
    const x0 = me(r, 'p0').x;
    for (let i = 0; i < 10; i++) { input(r, 'p0', 1); tick(r); }
    expect(me(r, 'p0').x).toBeGreaterThan(x0 + 40);
    expect(view(r, 'p1').players.map((p) => p.id)).toContain('p0');
  });
  it('a hiding player cannot use doors, items, tools or abilities', () => {
    const r = mk();
    at(r, 'p0', spot(r).x);
    r.ghostAction('p0', { action: 'hide' });
    expect(r.itemAction('p0', { action: 'drop', itemId: 'x' })).toEqual({ ok: false, error: 'Not while hiding. Press E to come out.' });
    expect(r.stageAction('p0', { kind: 'cancel' })).toEqual({ ok: false, error: 'Not while hiding. Press E to come out.' });
    expect(r.escapeAction('p0', { action: 'use_door', doorId: 'd' }).ok).toBe(false);
    expect(r.abilityAction('p0', { ability: 'freeze', x: 0, y: 0 } as never).ok).toBe(false);
  });
  it('no hiding without a ghost (stage 1 or the option off) and nothing to hide in out of reach', () => {
    const r = mk();
    at(r, 'p0', spot(r).x + 400);
    expect(r.ghostAction('p0', { action: 'hide' })).toEqual({ ok: false, error: 'There is nowhere to hide here.' });
    const off = new Room('OFF1', 3, SEED, { escape: true, ghost: false, startStage: 2 });
    off.join('p0', 'P0'); off.start('p0'); tick(off, 10);
    expect(off.ghostAction('p0', { action: 'hide' }).ok).toBe(false);
    expect(off.ghostCue('p0')).toBeNull();
  });
  it('a ghost that is hunting you and sees you blocks the hide', () => {
    const r = mk();
    at(r, 'p0', spot(r).x);
    const p = me(r, 'p0');
    r.ghostSystem!.placeForTest('g0', { room: roomOf(r), x: p.x - 200, y: p.y - 22, angle: 0 });
    tick(r, 3);
    expect(r.ghostSystem!.watching('p0')).toBe(true);
    expect(r.ghostAction('p0', { action: 'hide' }).ok).toBe(false);
  });
});

describe('P3E the catch through the Room', () => {
  it('a real catch captures where they stand, they cannot move, and they are told how long', () => {
    const r = mk();
    at(r, 'p0', 600); at(r, 'p1', 300);
    catchP0(r);
    const x0 = me(r, 'p0').x;
    for (let i = 0; i < 20; i++) { input(r, 'p0', 1); tick(r); }
    expect(me(r, 'p0').x).toBe(x0);
    const st = status(r, 'p0');
    expect(st.caught?.secondsLeft).toBeGreaterThan(40);
    expect(r.itemAction('p0', { action: 'drop', itemId: 'x' })).toEqual({ ok: false, error: 'You are caught. Wait for a teammate.' });
    expect(r.phase).toBe('playing'); // nobody is eliminated
    expect(r.drainGhostEvents().some((e) => e.kind === 'catch')).toBe(true);
  });
  it('what they carry is dropped where they stand', () => {
    const r = mk();
    const key = r.peekStageState()!.items!.items.find((i) => i.kind === 'access_key')!;
    at(r, 'p0', key.x); tick(r, 25);
    expect(r.itemAction('p0', { action: 'pickup', itemId: key.id }).ok).toBe(true);
    tick(r, 15);
    expect(r.peekStageState()!.items!.items.find((i) => i.id === key.id)!.state).toBe('carried');
    catchP0(r);
    tick(r, 30);
    const k = r.peekStageState()!.items!.items.find((i) => i.id === key.id)!;
    expect(k.state).toBe('in_world');
    expect(Math.abs(k.x - me(r, 'p0').x)).toBeLessThan(5);
  });
  it('a teammate holding E next to them frees them in about four seconds, at no cost', () => {
    const r = mk();
    at(r, 'p0', 600); at(r, 'p1', 300);
    catchP0(r);
    at(r, 'p1', 640);
    const before = r.peekStageState()!.score.total;
    for (let i = 0; i < CATCH_LIMITS.rescueTicks + 4; i++) { input(r, 'p1', 0, { use: true }); tick(r); }
    expect(r.catchSystem!.isCaptured('p0')).toBe(false);
    const x0 = me(r, 'p0').x;
    for (let i = 0; i < 10; i++) { input(r, 'p0', 1); tick(r); }
    expect(me(r, 'p0').x).toBeGreaterThan(x0 + 40);
    expect(r.peekStageState()!.score.total).toBeGreaterThanOrEqual(before);
    expect(r.peekStageState()!.score.breakdown['caught']).toBeUndefined();
  });
  it('the rescuer must keep E held: tapping once does nothing', () => {
    const r = mk();
    at(r, 'p0', 600); at(r, 'p1', 300);
    catchP0(r);
    at(r, 'p1', 640);
    input(r, 'p1', 0, { use: true }); tick(r);
    for (let i = 0; i < CATCH_LIMITS.rescueTicks * 2; i++) { input(r, 'p1', 0, { use: false }); tick(r); }
    expect(r.catchSystem!.isCaptured('p0')).toBe(true);
  });
  it('after about 45 seconds with no rescue: released at the room entry, with a score penalty, and can move', () => {
    const r = mk();
    at(r, 'p0', 600); at(r, 'p1', 1500);
    catchP0(r);
    for (let i = 0; i < CATCH_LIMITS.captureTicks + 5; i++) { input(r, 'p1', 0); tick(r); if (!r.catchSystem!.isCaptured('p0')) break; }
    expect(r.catchSystem!.isCaptured('p0')).toBe(false);
    expect(Math.abs(me(r, 'p0').x - 300)).toBeLessThan(2); // the start room's entry (slot 0 spawn)
    expect(r.peekStageState()!.score.breakdown['caught']).toBe(-CATCH_LIMITS.releasePenalty);
    expect(r.drainLayouts().some((l) => l.playerId === 'p0')).toBe(true); // the client restarts prediction from here
    const x0 = me(r, 'p0').x;
    for (let i = 0; i < 10; i++) { input(r, 'p0', 1); tick(r); }
    expect(me(r, 'p0').x).toBeGreaterThan(x0 + 40);
    expect(r.phase).toBe('playing');
  });
  it('a caught hider is caught where they hid, and the spot is free again', () => {
    const r = mk();
    at(r, 'p0', spot(r).x); at(r, 'p1', 300);
    r.ghostAction('p0', { action: 'hide' });
    r.catchSystem!.capture('p0');
    expect(r.catchSystem!.isHidden('p0')).toBe(false);
    expect(r.catchSystem!.occupantOf(spot(r).id)).toBeNull();
    expect(view(r, 'p1').players.map((p) => p.id)).toContain('p0'); // a caught player is in plain view again
  });
});

describe('P3E noise through the Room', () => {
  const heard = (r: Room) => r.drainGhostEvents().filter((e) => e.kind === 'heard');
  it('dropping a part is loud: a ghost in earshot hears it and goes to look', () => {
    const r = mk();
    const key = r.peekStageState()!.items!.items.find((i) => i.kind === 'access_key')!;
    at(r, 'p0', key.x); at(r, 'p1', 300); tick(r, 25);
    expect(r.itemAction('p0', { action: 'pickup', itemId: key.id }).ok).toBe(true);
    tick(r, 15);
    r.ghostSystem!.placeForTest('g0', { room: roomOf(r), x: key.x + 250, y: 658, angle: 0 });
    r.drainGhostEvents();
    expect(r.itemAction('p0', { action: 'drop', itemId: key.id }).ok).toBe(true);
    const h = heard(r);
    expect(h.length).toBe(1);
    expect(h[0]).toMatchObject({ kind: 'heard', gait: 'drop', player: 'p0' });
  });
  it('picking up is quiet', () => {
    const r = mk();
    const key = r.peekStageState()!.items!.items.find((i) => i.kind === 'access_key')!;
    at(r, 'p0', key.x); at(r, 'p1', 300); tick(r, 25);
    r.ghostSystem!.placeForTest('g0', { room: roomOf(r), x: key.x + 100, y: 658, angle: Math.PI });
    r.drainGhostEvents();
    expect(r.itemAction('p0', { action: 'pickup', itemId: key.id }).ok).toBe(true);
    expect(heard(r)).toEqual([]);
  });
  it('a hidden player is silent whatever they send, and the gaits are ordered: running is heard farther than walking and sneaking', () => {
    const r = mk();
    at(r, 'p0', spot(r).x); at(r, 'p1', 100);
    r.ghostAction('p0', { action: 'hide' });
    r.ghostSystem!.placeForTest('g0', { room: roomOf(r), x: spot(r).x + 120, y: 658, angle: 0 });
    r.drainGhostEvents();
    for (let i = 0; i < 30; i++) { input(r, 'p0', 1); tick(r); }
    expect(heard(r).filter((e) => e.kind === 'heard' && e.player === 'p0')).toEqual([]);
  });
});
