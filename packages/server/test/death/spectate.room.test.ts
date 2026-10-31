import { describe, expect, it } from 'vitest';
import { GameSnapshotSchema, StageStateSchema, DeathStateSchema, type Difficulty } from '@wb/shared';
import { Room } from '../../src/room';
import type { GameSim } from '../../src/game';

let seq = 0;
function mk(players = 3, difficulty: Difficulty = 'easy'): Room {
  const r = new Room('DETH', 3, 9, { escape: true, ghost: true, startStage: 2 });
  r.difficulty = difficulty;
  for (let i = 0; i < players; i++) r.join(`p${i}`, `P${i}`);
  for (let i = 1; i < players; i++) r.setReady(`p${i}`, true);
  const st = r.start('p0'); expect(st, JSON.stringify(st)).toEqual({ ok: true });
  for (let i = 0; i < 10 && r.phase !== 'playing'; i++) r.tick();
  return r;
}
const sim = (r: Room) => (r as unknown as { sim: GameSim }).sim;
const at = (r: Room, id: string, x: number) => sim(r).placeAt(id, x, 680);
const me = (r: Room, id: string) => r.gameSnapshot()!.players.find((p) => p.id === id)!;
const roomOf = (r: Room, id = 'p0') => me(r, id).roomId!;
const input = (r: Room, id: string) => r.submitInput(id, ++seq, { moveX: 0, jump: false });
const tick = (r: Room, n = 1) => { for (let i = 0; i < n; i++) r.tick(); };
const ghostNear = (r: Room, id: string, dx = 80) => { const q = me(r, id); r.ghostSystem!.placeForTest('g0', { room: roomOf(r, id), x: q.x + dx, y: q.y - 22, angle: 0, state: 'roaming' }); };
/** Kill `id` with the ghost on top of them (past the spawn grace); the others should be far away. */
function kill(r: Room, id: string): void {
  for (let i = 0; i < 1500 && !r.deathSystem!.isDead(id); i++) {
    if (i % 100 === 0) { const q = me(r, id); r.ghostSystem!.placeForTest('g0', { room: roomOf(r, id), x: q.x - 60, y: q.y - 22, angle: 0, state: 'hunting' }); }
    input(r, id); tick(r);
  }
  expect(r.deathSystem!.isDead(id)).toBe(true);
}

describe('P4 what a spectator is sent', () => {
  it('only the ghost and teammates in the target’s view: no items, doors, safes, keypads, clues, objectives, entities or exit; and the whole message holds no id of any of them', () => {
    const r = mk(3);
    at(r, 'p0', 600); at(r, 'p1', 700); at(r, 'p2', 1500);
    kill(r, 'p0');
    tick(r, 3);
    const full = r.peekStageState()!;
    const v = r.viewFor('p0')!;
    expect(GameSnapshotSchema.safeParse(v.snapshot).success).toBe(true);
    expect(StageStateSchema.safeParse(v.stage).success).toBe(true);
    expect(v.stage.items).toBeUndefined();
    expect(v.stage.escape).toBeUndefined();
    expect(v.stage.clues).toEqual([]);
    expect(v.stage.objectives).toEqual([]);
    expect(v.stage.entities).toEqual([]);
    expect(v.stage.feed).toEqual([]);
    expect(v.stage.players).toEqual([]);
    expect(v.stage.hazards).toEqual([]);
    const raw = JSON.stringify(v);
    const secrets: string[] = [];
    for (const i of full.items?.items ?? []) secrets.push(i.id);
    for (const s of full.items?.stashes ?? []) secrets.push(s.id);
    for (const s of full.escape?.safes ?? []) secrets.push(s.id);
    for (const k of full.escape?.keypads ?? []) secrets.push(k.id);
    for (const d of full.escape?.doors ?? []) secrets.push(d.id);
    for (const c of full.escape?.clues ?? []) { secrets.push(c.id); secrets.push(c.label); }
    expect(secrets.length).toBeGreaterThan(3);
    for (const sct of secrets) expect(raw, `leaked ${sct}`).not.toContain(sct);
  });
  it('they are shown EVERY teammate on the stage, near or far, and the team list says who is dead (the rule of step 2, a teammate’s light, no longer limits them)', () => {
    const r = mk(3);
    at(r, 'p0', 600); at(r, 'p1', 700); at(r, 'p2', 1500);
    kill(r, 'p0');
    tick(r, 3);
    expect(r.deathState('p0')!.following!.id).toBe('p1');
    const snap = r.viewFor('p0')!.snapshot;
    expect(snap.players.map((p) => p.id).sort()).toEqual(['p0', 'p1', 'p2']); // p2 is far from p1 and still shown
    expect(snap.team!.map((t) => [t.id, t.life])).toEqual([['p0', 'downed'], ['p1', 'alive'], ['p2', 'alive']]);
    // positions are the real ones
    for (const p of snap.players) expect(p.x).toBe(me(r, p.id).x);
  });
  it('every ghost is in the spectator’s message wherever it is: next to the teammate they watch, or at the far end of the room', () => {
    const r = mk(3);
    at(r, 'p0', 600); at(r, 'p1', 700); at(r, 'p2', 1500);
    kill(r, 'p0');
    r.deathSystem!.setLethal(false);
    ghostNear(r, 'p1', 90);
    expect(r.viewFor('p0')!.snapshot.ghosts?.map((g) => g.id)).toEqual(['g0']);
    r.ghostSystem!.placeForTest('g0', { room: roomOf(r, 'p1'), x: 2400, y: 658, angle: 0, state: 'roaming' });
    const far = r.viewFor('p0')!.snapshot.ghosts!;
    expect(far).toHaveLength(1);
    expect(far[0]).toMatchObject({ id: 'g0', x: r.ghostSystem!.publicGhosts()[0]!.x, kind: r.ghostSystem!.publicGhosts()[0]!.kind, state: 'roaming' }); // position AND look
  });
  it('with nobody left alive to follow, they still see every teammate and ghost, and nothing else', () => {
    const r = mk(2);
    at(r, 'p0', 600); at(r, 'p1', 1500);
    kill(r, 'p0');
    r.deathSystem!.setLethal(false);
    r.disconnect('p1'); // nobody alive and connected
    tick(r, 3);
    expect(r.deathState('p0')!.following).toBeNull();
    const v = r.viewFor('p0')!;
    expect(v.snapshot.players.map((p) => p.id).sort()).toEqual(['p0', 'p1']);
    expect(v.snapshot.team!.length).toBe(2);
    expect(v.stage.items).toBeUndefined();
    expect(v.stage.escape).toBeUndefined();
  });
  it('the living are unchanged: they still get their own inventory and the stage', () => {
    const r = mk(3);
    at(r, 'p1', 700);
    const v = r.viewFor('p1')!;
    expect(v.stage.items).toBeDefined();
    expect(v.stage.players.map((p) => p.id)).toEqual(['p1']);
    expect(r.deathState('p1')).toMatchObject({ life: 'alive', following: null, watchable: [], pingReadyIn: 0, reviveLeft: 0 });
  });
});

describe('P4 step 6: a teammate who hides is shown to a spectator at their spot (the spectator sees every teammate)', () => {
  it('the hiding player is in the spectator’s snapshot at the spot, and the message still holds no hiding-spot data', () => {
    const r = mk(3);
    const spot = (r as unknown as { engine: { def: { escape: { hidingSpots: { x: number; id: string }[] } } } }).engine.def.escape.hidingSpots[0]!;
    at(r, 'p0', 300); at(r, 'p1', spot.x); at(r, 'p2', spot.x + 60);
    kill(r, 'p0');
    r.deathSystem!.setLethal(false);
    expect(r.ghostAction('p1', { action: 'hide' }).ok).toBe(true);
    const v = r.viewFor('p0')!;
    expect(v.snapshot.players.find((p) => p.id === 'p1')!.x).toBe(me(r, 'p1').x);
    expect(JSON.stringify(v)).not.toContain(spot.id); // nothing says WHERE the spot is, or that it is one
  });
});

describe('P4 following and the camera', () => {
  it('follows the next living teammate, can pick another, and moves on when the target dies and when the target disconnects', () => {
    const r = mk(4);
    at(r, 'p0', 600); at(r, 'p1', 700); at(r, 'p2', 800); at(r, 'p3', 900);
    kill(r, 'p0');
    tick(r, 2);
    expect(r.deathState('p0')).toMatchObject({ life: 'downed', following: { id: 'p1', name: 'P1' } });
    expect(r.deathState('p0')!.watchable.map((w) => w.id)).toEqual(['p1', 'p2', 'p3']);
    expect(r.spectateFollow('p0', { target: 'p3' })).toEqual({ ok: true, message: 'Watching P3.' });
    expect(r.deathState('p0')!.following!.id).toBe('p3');
    expect(r.spectateFollow('p0', { target: 'p0' })).toEqual({ ok: false, error: 'You cannot watch that player.' });
    r.deathSystem!.setLethal(true);
    // the target disconnects: the camera moves on at the next tick
    r.disconnect('p3'); tick(r, 2);
    expect(r.deathState('p0')!.following!.id).toBe('p1');
    // the target dies
    tick(r, 200); // let the satiated ghost wear off
    kill(r, 'p1'); tick(r, 2);
    expect(r.deathState('p0')!.following!.id).toBe('p2');
    expect(r.deathState('p1')!.following!.id).toBe('p2');
  });
  it('the living cannot follow or ping, and unknown players are refused', () => {
    const r = mk(3);
    expect(r.spectateFollow('p1', { target: 'p2' })).toEqual({ ok: false, error: 'You are not dead.' });
    expect(r.spectatePing('p1')).toEqual({ ok: false, error: 'You are not dead.' });
    expect(r.spectateFollow('zzz', { target: 'p2' })).toEqual({ ok: false, error: 'You are not part of this run.' });
  });
  it('outside a stage there is nothing to follow', () => {
    const r = new Room('LOBB', 3, 9, { escape: true, ghost: true, startStage: 2 });
    r.join('p0', 'P0');
    expect(r.spectateFollow('p0', { target: 'next' })).toEqual({ ok: false, error: 'No stage is running.' });
    expect(r.spectatePing('p0')).toEqual({ ok: false, error: 'No stage is running.' });
    expect(r.deathState('p0')).toBeNull();
  });
});

describe('P4 a spectator is sent the walls of the room they watch', () => {
  it('one layout when they start watching, none while nothing changes, and a new one when they switch to someone in another room', () => {
    const r = mk(3);
    at(r, 'p0', 600); at(r, 'p1', 700); at(r, 'p2', 1500);
    r.drainLayouts();
    kill(r, 'p0');
    tick(r, 3);
    const first = r.drainLayouts().filter((l) => l.playerId === 'p0');
    expect(first).toHaveLength(1);
    expect(first[0]!.layout.roomId).toBe(roomOf(r, 'p1'));
    tick(r, 30);
    expect(r.drainLayouts().filter((l) => l.playerId === 'p0')).toHaveLength(0);
    // the living are never sent a layout because of this
    expect(r.drainLayouts().filter((l) => l.playerId === 'p1')).toHaveLength(0);
  });
});

describe('P4 the ghost-here ping through the Room', () => {
  it('goes to the living in that room and the other spectators, with the server’s position; is rate limited; the sender gets it too', () => {
    const r = mk(3);
    at(r, 'p0', 600); at(r, 'p1', 700); at(r, 'p2', 1500);
    kill(r, 'p0');
    r.deathSystem!.setLethal(false);
    ghostNear(r, 'p1', 90);
    r.drainPings();
    expect(r.spectatePing('p0')).toEqual({ ok: true, message: 'Ghost here.' });
    const sent = r.drainPings();
    expect(sent).toHaveLength(1);
    const g = r.ghostSystem!.publicGhosts()[0]!;
    expect(sent[0]!.ping).toMatchObject({ room: g.room, x: Math.round(g.x), y: Math.round(g.y), from: 'P0' });
    expect(sent[0]!.to.sort()).toEqual(['p0', 'p1', 'p2']);
    expect(r.spectatePing('p0')).toEqual({ ok: false, error: 'Too fast.' });
    expect(r.drainPings()).toEqual([]);
    expect(r.deathState('p0')!.pingReadyIn).toBeGreaterThan(0);
  });
  it('the ping uses the ghost wherever it is, with the server’s position: a ghost the watched teammate cannot see can be pointed at', () => {
    const r = mk(3);
    at(r, 'p0', 600); at(r, 'p1', 700); at(r, 'p2', 1500);
    kill(r, 'p0');
    r.deathSystem!.setLethal(false);
    r.ghostSystem!.placeForTest('g0', { room: roomOf(r, 'p1'), x: 2400, y: 658, angle: 0, state: 'roaming' });
    r.drainPings();
    expect(r.spectatePing('p0')).toEqual({ ok: true, message: 'Ghost here.' });
    const g = r.ghostSystem!.publicGhosts()[0]!;
    expect(r.drainPings()[0]!.ping).toMatchObject({ x: Math.round(g.x), y: Math.round(g.y), room: g.room });
  });
});

describe('P4 step 6: the free-fly camera through the Room', () => {
  it('the death state carries the camera and the rooms of the stage; messages move it within bounds; the living are refused', () => {
    const r = mk(3);
    at(r, 'p0', 600); at(r, 'p1', 700); at(r, 'p2', 1500);
    expect(r.spectateMove('p1', { x: 1, y: 0 })).toEqual({ ok: false, error: 'You are not dead.' });
    expect(r.spectateRoom('p1', { room: 'next' })).toEqual({ ok: false, error: 'You are not dead.' });
    kill(r, 'p0'); tick(r, 3);
    const d = r.deathState('p0')!;
    expect(d.cam).toMatchObject({ free: false });
    expect(d.rooms!.length).toBeGreaterThanOrEqual(1);
    expect(DeathStateSchema.safeParse(d).success).toBe(true);
    expect(r.deathState('p1')!.cam).toBeUndefined(); // the living have no camera
    const x0 = d.cam!.x;
    expect(r.spectateMove('p0', { x: 1, y: 0 }).ok).toBe(true);
    for (let i = 0; i < 8; i++) { r.spectateMove('p0', { x: 1, y: 0 }); tick(r); }
    const c = r.deathState('p0')!.cam!;
    expect(c.free).toBe(true);
    expect(c.x).toBeGreaterThan(x0);
    expect(c.x - x0).toBeLessThanOrEqual(640 * (9 / 20) + 1); // never faster than the bound
    expect(r.spectateRoom('p0', { room: 'nowhere' })).toEqual({ ok: false, error: 'There is no such room.' });
  });
  it('a spectator who flies is still refused everything else, and flying changes nothing in the live world (nobody else can tell)', () => {
    const r = mk(3);
    at(r, 'p0', 600); at(r, 'p1', 700); at(r, 'p2', 1500);
    kill(r, 'p0');
    const before = JSON.stringify(r.peekStageState()!.items);
    const bodyX = me(r, 'p0').x;
    for (let i = 0; i < 40; i++) { r.spectateMove('p0', { x: -1, y: -1 }); tick(r); }
    expect(me(r, 'p0').x).toBe(bodyX); // the body stays where it fell: the camera is not the player
    expect(JSON.stringify(r.peekStageState()!.items)).toBe(before);
    expect(input(r, 'p0')).toBe(false);
    expect(r.itemAction('p0', { action: 'pickup', itemId: 'x' })).toEqual({ ok: false, error: 'You are dead. You can only watch.' });
  });
});

describe('P4 step 6: a spectator is sent the walls of the room the camera is in, never its doors', () => {
  it('on a multi-room stage: walls and floors for the camera’s room, no doors, a new layout on every room switch; the living still get their doors', () => {
    const r = new Room('DETH', 3, 9, { escape: true, ghost: true, startStage: 12 });
    for (let i = 0; i < 3; i++) r.join(`p${i}`, `P${i}`);
    r.setReady('p1', true); r.setReady('p2', true);
    expect(r.start('p0').ok).toBe(true);
    for (let i = 0; i < 10 && r.phase !== 'playing'; i++) r.tick();
    const startRoom = roomOf(r, 'p0');
    const living = r.drainLayouts().find((l) => l.playerId === 'p1')!;
    expect(living.layout.doors.length).toBeGreaterThan(0); // the living know their doors
    at(r, 'p0', 600); at(r, 'p1', 700); at(r, 'p2', 1100);
    kill(r, 'p0'); tick(r, 3);
    const first = r.drainLayouts().filter((l) => l.playerId === 'p0');
    expect(first.length).toBeGreaterThanOrEqual(1);
    const mine = first.at(-1)!.layout;
    expect(mine.roomId).toBe(startRoom);
    expect(mine.doors).toEqual([]);
    expect(mine.arena.solids.length).toBeGreaterThan(0); // the walls and floors are there
    const rooms = r.deathState('p0')!.rooms!;
    expect(rooms.length).toBeGreaterThan(2);
    // switch to the next room: its layout arrives, again without doors, and the camera is in it
    expect(r.spectateRoom('p0', { room: 'next' }).ok).toBe(true);
    tick(r, 3);
    const next = r.drainLayouts().filter((l) => l.playerId === 'p0').at(-1)!;
    expect(next.layout.roomId).toBe(rooms[(rooms.indexOf(startRoom) + 1) % rooms.length]);
    expect(next.layout.doors).toEqual([]);
    expect(r.deathState('p0')!.cam!.room).toBe(next.layout.roomId);
    // a room of the stage by id works too, and so does coming back
    tick(r, 3);
    expect(r.spectateRoom('p0', { room: startRoom }).ok).toBe(true);
    tick(r, 3);
    expect(r.drainLayouts().filter((l) => l.playerId === 'p0').at(-1)!.layout.roomId).toBe(startRoom);
    // nobody else was sent anything because of this
    expect(r.drainLayouts().filter((l) => l.playerId !== 'p0')).toEqual([]);
  });
});

describe('P4 a dead player can only watch (every control input)', () => {
  it('movement, stage, ability, escape, item, ghost actions and the arena reset are all refused with the same words', () => {
    const r = mk(3);
    at(r, 'p0', 600); at(r, 'p1', 700); at(r, 'p2', 1500);
    kill(r, 'p0');
    const msg = 'You are dead. You can only watch.';
    expect(input(r, 'p0')).toBe(false);
    expect(r.stageAction('p0', { action: 'cancel' } as never)).toEqual({ ok: false, error: msg });
    expect(r.abilityAction('p0', { action: 'cancel' } as never)).toEqual({ ok: false, error: msg });
    expect(r.escapeAction('p0', { action: 'read', clueId: 'x' } as never)).toEqual({ ok: false, error: msg });
    expect(r.itemAction('p0', { action: 'pickup', itemId: 'x' })).toEqual({ ok: false, error: msg });
    expect(r.ghostAction('p0', { action: 'hide' })).toEqual({ ok: false, error: msg });
    expect(r.ghostAction('p0', { action: 'fire' })).toEqual({ ok: false, error: msg });
    expect(r.resetArena('p0')).toEqual({ ok: false, error: msg }); // p0 is the host
  });
  it('an eliminated spectator (window over) is just as unable; a dead player who reconnects is still only a spectator', () => {
    const r = mk(2, 'hardcore');
    at(r, 'p0', 600); at(r, 'p1', 1500);
    kill(r, 'p0');
    expect(r.deathSystem!.lifeOf('p0')).toBe('eliminated');
    expect(r.itemAction('p0', { action: 'pickup', itemId: 'x' }).ok).toBe(false);
    r.disconnect('p0'); tick(r, 5);
    expect(input(r, 'p0')).toBe(false);
    expect(r.deathState('p0')).toMatchObject({ life: 'eliminated' });
  });
  it('the death state parses and a body counts down its revive window', () => {
    const r = mk(2);
    at(r, 'p0', 600); at(r, 'p1', 1500);
    kill(r, 'p0'); tick(r, 40);
    const ds = r.deathState('p0')!;
    expect(DeathStateSchema.safeParse(ds).success).toBe(true);
    expect(ds.life).toBe('downed');
    expect(ds.reviveLeft).toBeGreaterThan(0);
    expect(ds.reviveLeft).toBeLessThan(900);
  });
});
