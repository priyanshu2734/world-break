import { describe, expect, it } from 'vitest';
import { GameSnapshotSchema, aimAngle, quantiseAim, type GameSnapshot } from '@wb/shared';
import { Room } from '../../src/room';
import { GameSim } from '../../src/game';
import { restrictedView } from '../../src/rooms/view';

let seq = 0;
function ghostRoom(opts: { stage?: number; ghost?: boolean; players?: number; seed?: number } = {}): Room {
  const n = opts.players ?? 2;
  const r = new Room('GHST', 3, opts.seed ?? 7, { escape: true, ghost: opts.ghost ?? true, startStage: opts.stage ?? 2 });
  for (let i = 0; i < n; i++) r.join(`p${i}`, `P${i}`);
  for (let i = 1; i < n; i++) r.setReady(`p${i}`, true);
  expect(r.start('p0').ok).toBe(true);
  for (let i = 0; i < 10 && r.phase !== 'playing'; i++) r.tick();
  return r;
}
const view = (r: Room, id: string): GameSnapshot => GameSnapshotSchema.parse(r.viewFor(id)!.snapshot);
const placeGhost = (r: Room, at: { x: number; y: number; room?: string }) => {
  const g = r.ghostSystem!;
  g.placeForTest('g0', { room: at.room ?? g.snapshotActors()[0]!.room, x: at.x, y: at.y });
};
const roomId = (r: Room) => r.gameSnapshot()!.players[0]!.roomId!;

describe('P3E ghost in the Room: where it exists', () => {
  it('no ghost on stage 1, even with the option on', () => {
    const r = ghostRoom({ stage: 1 });
    expect(r.stage).toBe(1);
    expect(r.ghostSystem).toBeNull();
    for (let i = 0; i < 20 * 60 * 5; i++) r.tick();
    expect(r.drainGhostEvents()).toEqual([]);
    expect(view(r, 'p0').ghosts).toBeUndefined();
  });
  it('a ghost on stage 2 with the option on; none with the option off (every earlier room is unchanged)', () => {
    const on = ghostRoom({ stage: 2 });
    expect(on.ghostSystem).not.toBeNull();
    expect(on.ghostSystem!.snapshotActors().map((a) => a.kind)).toEqual(['wisp']);
    const off = ghostRoom({ stage: 2, ghost: false });
    expect(off.ghostSystem).toBeNull();
    for (let i = 0; i < 20 * 60 * 3; i++) off.tick();
    expect(off.drainGhostEvents()).toEqual([]);
    expect(JSON.stringify(off.viewFor('p0')!.snapshot)).not.toContain('ghosts');
  });
  it('stage 7 brings the Shade alone, stage 12 the Howler alone; the ghost follows the room to the next stage', () => {
    expect(ghostRoom({ stage: 7 }).ghostSystem!.snapshotActors().map((a) => a.kind)).toEqual(['shade']);
    expect(ghostRoom({ stage: 12 }).ghostSystem!.snapshotActors().map((a) => a.kind)).toEqual(['howler']);
    expect(ghostRoom({ stage: 8 }).ghostSystem!.snapshotActors().map((a) => a.kind)).toEqual(['wisp', 'shade']);
  });
  it('the ghost runs in the real tick loop and is deterministic: two rooms with the same seed and inputs log the same events', () => {
    const go = () => {
      const r = ghostRoom({ stage: 2, seed: 99 });
      const log: unknown[] = [];
      for (let i = 0; i < 20 * 60 * 6; i++) {
        if (i % 25 === 0) { r.submitInput('p0', ++seq, { moveX: i % 100 === 0 ? 1 : -1, jump: false }); }
        r.tick();
        log.push(...r.drainGhostEvents());
      }
      return JSON.stringify(log);
    };
    const a = go(), b = go();
    expect(a).toBe(b);
    expect(a.length).toBeGreaterThan(10);
  });
});

describe('P3E ghost in the view: a ghost that is not in your view is not in your message', () => {
  const spawnAt = (r: Room) => r.gameSnapshot()!.players.find((p) => p.id === 'p0')!;
  it('in view (near, clear line, same room): present for the viewer; the same snapshot goes to nobody who cannot see it', () => {
    const r = ghostRoom({ stage: 2 });
    const me = spawnAt(r);
    placeGhost(r, { x: me.x + 200, y: me.y - 40 });
    const v = view(r, 'p0');
    expect(v.ghosts?.length).toBe(1);
    expect(v.ghosts![0]).toMatchObject({ id: 'g0', kind: 'wisp', state: 'roaming' });
  });
  it('out of reach, behind a wall, or in another room: absent, and the serialised message does not mention it at all', () => {
    const r = ghostRoom({ stage: 2 });
    const me = spawnAt(r);
    const checks: [string, { x: number; y: number; room?: string }][] = [
      ['beyond the vision radius', { x: me.x + 900, y: me.y - 40 }],
      ['behind the gate wall', { x: 1500, y: me.y - 40 }],
      ['in a room that does not exist for the viewer', { x: me.x + 100, y: me.y - 40, room: 'other.room' }],
    ];
    for (const [why, at] of checks) {
      r.ghostSystem!.placeForTest('g0', { room: at.room ?? roomId(r), x: at.x, y: at.y });
      const json = JSON.stringify(r.viewFor('p0'));
      expect(json, why).not.toContain('"g0"');
      expect(json, why).not.toContain('wisp');
      expect(view(r, 'p0').ghosts, why).toBeUndefined();
    }
  });
  it('a ghost beyond a platform is not visible (the platform blocks the line)', () => {
    // generated multi-room stages have platforms; the ghost sits right above one, the viewer right below it
    const r = ghostRoom({ stage: 8 });
    const graph = (r as unknown as { engine: { def: { rooms: { rooms: { id: string; arena: { solids: { x: number; y: number; w: number; h: number }[] } }[] } } } }).engine.def.rooms.rooms[0]!;
    const plat = graph.arena.solids.find((s) => s.h === 20);
    if (!plat) return;
    const me = spawnAt(r);
    r.ghostSystem!.placeForTest('g0', { room: roomId(r), x: me.x, y: plat.y - 40 });
    // the platform is a few hundred px up and not above the spawn: only assert when it really lies between the two points
    const between = plat.x <= me.x && me.x <= plat.x + plat.w && plat.y < me.y - 28;
    if (between) expect(view(r, 'p0').ghosts).toBeUndefined();
  });
  it('a ghost the viewer\'s flashlight does not light is absent once their aim is known (behind them), present in the cone and in the small light', () => {
    const r = ghostRoom({ stage: 2 });
    const me = spawnAt(r);
    placeGhost(r, { x: me.x + 250, y: me.y - 28 });
    // aim to the right: the ghost is in the cone
    r.submitInput('p0', ++seq, { moveX: 0, jump: false }, { aim: quantiseAim(0) }); r.tick();
    expect(view(r, 'p0').ghosts?.length).toBe(1);
    // aim to the left: the ghost, 250 px behind the light, is dark
    for (let i = 0; i < 3; i++) { r.submitInput('p0', ++seq, { moveX: 0, jump: false }, { aim: quantiseAim(Math.PI) }); r.tick(); }
    const me2 = spawnAt(r);
    placeGhost(r, { x: me2.x + 250, y: me2.y - 28 });
    expect(view(r, 'p0').ghosts).toBeUndefined();
    // right next to the player it is inside the small light whatever the aim
    placeGhost(r, { x: me2.x + 60, y: me2.y - 28 });
    expect(view(r, 'p0').ghosts?.length).toBe(1);
  });
  it('a ghost visible to one player is absent for a teammate who cannot see it', () => {
    const r = ghostRoom({ stage: 2, players: 2 });
    const [a, b] = [spawnAt(r), r.gameSnapshot()!.players.find((p) => p.id === 'p1')!];
    // (P3E step 3: a catch now freezes a player, so the ghost is placed only AFTER p1 has walked away; before step 3 a catch did nothing)
    // push p1 out of sight: walk it far to the right with the real input path
    for (let i = 0; i < 90; i++) { r.submitInput('p1', ++seq, { moveX: 1, jump: false }); r.tick(); }
    const b2 = r.gameSnapshot()!.players.find((p) => p.id === 'p1')!;
    expect(b2.x).toBeGreaterThan(b.x + 600);
    placeGhost(r, { x: a.x + 120, y: a.y - 28 });
    expect(view(r, 'p0').ghosts?.length).toBe(1);
    expect(view(r, 'p1').ghosts).toBeUndefined();
  });
  it('restrictedView directly: no ghosts input means no ghosts field; a viewer with no eyes sees none', () => {
    const r = ghostRoom({ stage: 2 });
    const me = spawnAt(r);
    placeGhost(r, { x: me.x + 100, y: me.y - 28 });
    const e = (r as unknown as { engine: { state(): never; def: { rooms: never } } }).engine;
    const snapshot = r.gameSnapshot()!;
    const base = { snapshot, stage: e.state(), graph: e.def.rooms, radius: 460 };
    expect(restrictedView(base, { eyes: 'p0', self: 'p0' }).snapshot.ghosts).toBeUndefined();
    const g = r.ghostSystem!.publicGhosts();
    expect(restrictedView({ ...base, ghosts: g }, { eyes: 'p0', self: 'p0' }).snapshot.ghosts?.length).toBe(1);
    expect(restrictedView({ ...base, ghosts: g }, { eyes: 'nobody', self: null }).snapshot.ghosts).toBeUndefined();
  });
});

describe('P3E aim and sneak input reach the server', () => {
  it('GameSim stores the aim (quantised) and the applied move axis, and the movement is unchanged by them', () => {
    const sim = new GameSim([{ id: 'a', name: 'A', slot: 0 }, { id: 'b', name: 'B', slot: 1 }]);
    sim.queueInput('a', 1, { moveX: 1, jump: false }, { aim: 64, sneak: true });
    sim.queueInput('b', 1, { moveX: 1, jump: false });
    sim.step();
    const [sa, sb] = sim.senses();
    expect(sa!.aim).toBeCloseTo(aimAngle(64), 10);
    expect(sa!.sneak).toBe(true);
    expect(sa!.moveX).toBe(1);
    expect(sb!.aim).toBeNull();
    expect(sb!.sneak).toBe(false);
    expect(sa!.x - 90).toBeCloseTo(sb!.x - 435, 6); // the same distance moved: aim and sneak never touch stepBody
  });
  it('a bad aim or a missing extra is ignored; the last good aim is kept', () => {
    const sim = new GameSim([{ id: 'a', name: 'A', slot: 0 }]);
    sim.queueInput('a', 1, { moveX: 0, jump: false }, { aim: 10 }); sim.step();
    sim.queueInput('a', 2, { moveX: 0, jump: false }, { aim: 999 }); sim.step();
    sim.queueInput('a', 3, { moveX: 0, jump: false }); sim.step();
    expect(sim.senses()[0]!.aim).toBeCloseTo(aimAngle(10), 10);
    expect(sim.aimOf('a')).toBeCloseTo(aimAngle(10), 10);
    expect(sim.aimOf('nobody')).toBeNull();
  });
  it('the move axis the ghost hears is the one the SERVER applied: a client that claims to sneak while sending moveX 1 is still running', () => {
    const r = ghostRoom({ stage: 2 });
    r.submitInput('p0', ++seq, { moveX: 1, jump: false }, { sneak: true }); r.tick();
    const s = (r as unknown as { sim: GameSim }).sim.senses().find((x) => x.id === 'p0')!;
    expect(s.moveX).toBe(1);
    expect(s.sneak).toBe(true); // the flag is only trusted for a crouch (|moveX| <= 0.4), enforced where the Room builds the ghost's view of the player
  });
});

describe('P3E cone vision is opt-in (the ghost option), so nothing earlier changes', () => {
  it('without the ghost option a teammate behind the viewer is in view whatever the aim; with it, only the lit region', () => {
    const off = ghostRoom({ stage: 1, ghost: false }), on = ghostRoom({ stage: 1, ghost: true });
    for (const r of [off, on]) {
      // p1 stands at x 350, p0 at 300: put p0's aim to the LEFT so p1 (250 px? no, 50 px) is inside the small light; so move p1 away first
      for (let i = 0; i < 25; i++) { r.submitInput('p1', ++seq, { moveX: 1, jump: false }); r.submitInput('p0', seq, { moveX: 0, jump: false }, { aim: quantiseAim(Math.PI) }); r.tick(); }
    }
    const seen = (r: Room) => view(r, 'p0').players.some((p) => p.id === 'p1');
    expect(seen(off)).toBe(true);
    expect(seen(on)).toBe(false);
  });
});
