import { describe, expect, it } from 'vitest';
import {
  GHOST_TYPES, PING_LIMITS, PingMarkerSchema, TeamPanelSchema, POINT_HEIGHT, roomById, visionRadius,
  type Difficulty, type GhostPublic, type PingMarker, type RoomGraph,
} from '@wb/shared';
import { Room } from '../../src/room';
import type { GameSim } from '../../src/game';
import type { StageEngine } from '../../src/systems/engine';
import { restrictedView } from '../../src/rooms/view';
import { makeSeer } from '../../src/social';

function mk(players = 3, stage = 2, difficulty: Difficulty = 'easy'): Room {
  const r = new Room('PING', 3, 9, { escape: true, ghost: true, startStage: stage });
  r.difficulty = difficulty;
  for (let i = 0; i < players; i++) r.join(`p${i}`, `P${i}`);
  for (let i = 1; i < players; i++) r.setReady(`p${i}`, true);
  expect(r.start('p0')).toEqual({ ok: true });
  for (let i = 0; i < 10 && r.phase !== 'playing'; i++) r.tick();
  return r;
}
const sim = (r: Room) => (r as unknown as { sim: GameSim }).sim;
const engine = (r: Room) => (r as unknown as { engine: StageEngine }).engine;
const graph = (r: Room): RoomGraph => engine(r).def.rooms!;
const me = (r: Room, id: string) => r.gameSnapshot()!.players.find((p) => p.id === id)!;
const tick = (r: Room, n = 1) => { for (let i = 0; i < n; i++) r.tick(); };
const at = (r: Room, id: string, x: number) => sim(r).placeAt(id, x, 680);
/** Move a player through the first door of their room (the same path the escape runtime uses). */
const through = (r: Room, id: string): void => {
  const g = graph(r), room = roomById(g, me(r, id).roomId!)!;
  expect(sim(r).sendThrough(id, room.doors[0]!.id)).toBe(true);
};
const markers = (r: Room) => r.drainPingMarkers();

describe('P6 A vision parity: a ping can only be placed where restrictedView would show the pinger something', () => {
  it('makeSeer agrees with restrictedView for a ghost at the same point, over a grid of points, with and without an aim', () => {
    const r = mk(2);
    at(r, 'p0', 600); tick(r, 2);
    const snapshot = r.gameSnapshot()!, stage = r.peekStageState()!, g = graph(r);
    const p = me(r, 'p0'), room = roomById(g, p.roomId!)!;
    const proto = r.ghostSystem!.publicGhosts()[0] as GhostPublic | undefined;
    const base: GhostPublic = proto ?? ({ id: 'g0', kind: 'wisp', state: 'roaming', x: 0, y: 0, room: room.id, angle: 0 } as unknown as GhostPublic);
    const open = new Set((stage.escape?.doors ?? []).filter((d) => d.open).map((d) => d.id));
    const radius = visionRadius('easy', 2);
    let agree = 0, seenCount = 0, hiddenCount = 0;
    for (const aim of [null, 0, Math.PI / 2, Math.PI]) {
      const see = makeSeer(room, { x: p.x, y: p.y }, open, radius, aim);
      for (let dx = -440; dx <= 440; dx += 40) for (let dy = -240; dy <= 120; dy += 40) {
        const x = p.x + dx, y = p.y + dy;
        const ghost = { ...base, x, y, room: room.id } as GhostPublic;
        const view = restrictedView({ snapshot, stage, graph: g, radius, ghosts: [ghost] }, { eyes: 'p0', self: 'p0', ...(aim === null ? {} : { aim }) });
        const inView = (view.snapshot.ghosts ?? []).length > 0;
        expect(see(x, y), `aim ${aim} point ${dx},${dy}`).toBe(inView);
        agree++; if (inView) seenCount++; else hiddenCount++;
      }
    }
    expect(agree).toBeGreaterThan(300);
    expect(seenCount).toBeGreaterThan(20);   // the grid really contains visible points
    expect(hiddenCount).toBeGreaterThan(20); // ... and hidden ones
    expect(POINT_HEIGHT.ghost).toBe(0);      // the parity above relies on this: a ghost is a floor-level point
  });
});

describe('P6 A placing a ping through the real Room', () => {
  it('a point in view is accepted and every living teammate is told; a point far outside the radius is refused and tells nobody', () => {
    const r = mk(3);
    at(r, 'p0', 600); at(r, 'p1', 700); at(r, 'p2', 900); tick(r, 2);
    const p = me(r, 'p0');
    expect(r.placePing('p0', { kind: 'go', x: p.x + 60, y: p.y - 20 })).toEqual({ ok: true, message: 'Pinged.' });
    const out = markers(r);
    expect(out.map((o) => o.to).sort()).toEqual(['p0', 'p1', 'p2']);
    for (const o of out) { expect(PingMarkerSchema.safeParse(o.marker).success).toBe(true); expect(o.marker.kind).toBe('go'); expect(o.marker.x).toBeCloseTo(p.x + 60); }
    tick(r, PING_LIMITS.cooldownTicks);
    const far = r.placePing('p0', { kind: 'go', x: p.x + 5000, y: p.y });
    expect(far).toEqual({ ok: false, error: 'You can only ping what you can see.' });
    expect(markers(r)).toEqual([]);
  });
  it('a point behind a wall or a closed door is refused (a ping never shows a teammate what the pinger could not see)', () => {
    const r = mk(2);
    at(r, 'p0', 600); tick(r, 2);
    const g = graph(r), room = roomById(g, me(r, 'p0').roomId!)!;
    const p = me(r, 'p0');
    const solid = room.arena.solids.find((s) => s.w > 8 && s.h > 8 && Math.abs(s.x - p.x) < 900);
    expect(solid).toBeDefined();
    // find a floor point on the far side of a solid from the pinger that the real view hides, and check the ping agrees with the view
    let refused = 0;
    for (let tries = 0; tries < 40 && refused < 3; tries++) {
      const x = p.x + (tries % 2 ? 1 : -1) * (80 + tries * 25), y = p.y - 10;
      const see = makeSeer(room, { x: p.x, y: p.y }, new Set(), visionRadius('easy', 2), null);
      const rr = r.placePing('p0', { kind: 'danger', x, y });
      if (!see(x, y)) { expect(rr.ok, `hidden point ${x},${y}`).toBe(false); refused++; }
      tick(r, PING_LIMITS.cooldownTicks);
      markers(r);
    }
    expect(refused).toBeGreaterThan(0);
  });
  it('a teammate in ANOTHER room is told the room and who, and never a position', () => {
    const r = mk(3, 3); // stage 3 has two rooms (stage 2 has one)
    at(r, 'p0', 600); at(r, 'p1', 650); at(r, 'p2', 700); tick(r, 2);
    through(r, 'p2'); tick(r, 2);
    expect(me(r, 'p2').roomId).not.toBe(me(r, 'p0').roomId);
    const p = me(r, 'p0');
    expect(r.placePing('p0', { kind: 'door', x: p.x + 50, y: p.y - 10 }).ok).toBe(true);
    const out = markers(r);
    const far = out.find((o) => o.to === 'p2')!.marker, near = out.find((o) => o.to === 'p1')!.marker;
    expect(far.x).toBeUndefined(); expect(far.y).toBeUndefined();
    expect(far.room).toBe(me(r, 'p0').roomId);
    expect(near.x).toBeDefined();
    expect(JSON.stringify(far)).not.toContain(String(Math.round(p.x + 50)));
  });
  it('rate limited: an immediate second ping is refused, and after the cooldown it is accepted; markers expire', () => {
    const r = mk(2);
    at(r, 'p0', 600); tick(r, 2);
    expect(r.placePing('p0', { kind: 'help' }).ok).toBe(true);
    expect(r.placePing('p0', { kind: 'help' }).ok).toBe(false);
    tick(r, PING_LIMITS.cooldownTicks);
    expect(r.placePing('p0', { kind: 'help' }).ok).toBe(true);
    const board = (r as unknown as { pingBoard: { active: unknown[]; expire(t: number): void } }).pingBoard;
    expect(board.active.length).toBe(2);
    board.expire(sim(r).tick + PING_LIMITS.ttlTicks + 1);
    expect(board.active.length).toBe(0);
  });
  it('an unknown kind or a stranger is refused at the edge of the room', () => {
    const r = mk(2);
    expect(r.placePing('nobody', { kind: 'help' }).ok).toBe(false);
    const lobby = new Room('LOBB', 3, 9, { escape: true, ghost: true });
    lobby.join('p0', 'P0');
    expect(lobby.placePing('p0', { kind: 'help' })).toEqual({ ok: false, error: 'No stage is running.' });
  });
  it('a new stage clears the board', () => {
    const r = mk(2);
    at(r, 'p0', 600); tick(r, 2);
    r.placePing('p0', { kind: 'help' });
    const board = (r as unknown as { pingBoard: { active: unknown[] } }).pingBoard;
    expect(board.active.length).toBe(1);
    (r as unknown as { bindGhost(e: StageEngine): void }).bindGhost(engine(r));
    expect(board.active.length).toBe(0);
  });
});

describe('P6 A spectators and the dead', () => {
  function kill(r: Room, id: string): void {
    const rid = (): string => me(r, id).roomId!;
    for (let i = 0; i < 1500 && !r.deathSystem!.isDead(id); i++) {
      if (i % 100 === 0) { const q = me(r, id); r.ghostSystem!.placeForTest('g0', { room: rid(), x: q.x - 60, y: q.y - 22, angle: 0, state: 'hunting' }); }
      r.submitInput(id, i + 1, { moveX: 0, jump: false }); tick(r);
    }
    expect(r.deathSystem!.isDead(id)).toBe(true);
  }
  it('a dead player cannot place a ping, and is sent none; the existing ghost-here ping is unchanged', () => {
    const r = mk(3);
    at(r, 'p0', 600); at(r, 'p1', 700); at(r, 'p2', 1500); tick(r, 2);
    kill(r, 'p0'); tick(r, 3);
    expect(r.placePing('p0', { kind: 'help' }).ok).toBe(false);
    expect(r.placePing('p0', { kind: 'go', x: 0, y: 0 }).ok).toBe(false);
    tick(r, PING_LIMITS.cooldownTicks);
    const p1 = me(r, 'p1');
    expect(r.placePing('p1', { kind: 'help' }).ok).toBe(true);
    const to = markers(r).map((o) => o.to);
    expect(to).not.toContain('p0');
    expect(to).toContain('p1');
    expect(p1.id).toBe('p1');
  });
  it('a dead player may chat (marked as a spectator) and the living may chat', () => {
    const r = mk(3);
    at(r, 'p0', 600); at(r, 'p1', 700); at(r, 'p2', 1500); tick(r, 2);
    kill(r, 'p0'); tick(r, 3);
    expect(r.chat('p0', 'ghost is by the left door', 10_000).ok).toBe(true);
    expect(r.chat('p1', 'ok thanks', 10_000).ok).toBe(true);
    const msgs = r.drainChat();
    expect(msgs.map((m) => [m.from, m.spectator])).toEqual([['p0', true], ['p1', false]]);
    expect(r.drainChat()).toEqual([]);
  });
  it('a dead player still holds nothing to leak: their view has no code, safe, door, clue, item or exit, and the chat message adds nothing to that', () => {
    const r = mk(3);
    at(r, 'p0', 600); at(r, 'p1', 700); at(r, 'p2', 1500); tick(r, 2);
    kill(r, 'p0'); tick(r, 3);
    const v = r.viewFor('p0')!;
    expect(v.stage.escape).toBeUndefined();
    expect(v.stage.items).toBeUndefined();
    expect(v.stage.clues).toEqual([]);
    r.chat('p0', 'hello', 1000);
    expect(JSON.stringify(r.drainChat())).not.toMatch(/code|safe|keypad/i);
  });
});

describe('P6 A ghost pings never name the ghost type (from the identify stage on)', () => {
  it('stage 8: “Ghost near” on a ghost in view is a position and a kind, and nothing else; the whole marker holds no type', () => {
    const r = mk(2, 8);
    at(r, 'p0', 600); tick(r, 2);
    const p = me(r, 'p0');
    r.ghostSystem!.placeForTest('g0', { room: p.roomId!, x: p.x + 90, y: p.y - 22, angle: 0, state: 'roaming' });
    const rr = r.placePing('p0', { kind: 'ghost' });
    expect(rr.ok, JSON.stringify(rr)).toBe(true);
    const out = markers(r);
    expect(out.length).toBe(2);
    for (const o of out) {
      const raw = JSON.stringify(o.marker);
      for (const g of GHOST_TYPES) expect(raw, `type ${g}`).not.toContain(g);
      expect(Object.keys(o.marker).sort()).toEqual(['from', 'id', 'kind', 'name', 'room', 'slot', 'ttl', 'x', 'y']);
    }
  });
  it('a ghost the pinger can neither see nor hear cannot be pinged', () => {
    const r = mk(2, 8);
    at(r, 'p0', 600); tick(r, 2);
    r.ghostSystem!.placeForTest('g0', { room: me(r, 'p0').roomId!, x: me(r, 'p0').x + 4000, y: 680, angle: 0, state: 'roaming' });
    const rr = r.placePing('p0', { kind: 'ghost' });
    // far, out of view; whether it is heard depends on the distance bands: either way no position of the ghost is ever used
    if (!rr.ok) expect(rr.error).toBe('You neither see nor hear a ghost.');
    else { const m = markers(r).find((o) => o.to === 'p0')!.marker; expect(m.x).toBeCloseTo(me(r, 'p0').x, 0); }
  });
});

describe('P6 A the team panel', () => {
  it('lists every teammate with a state, a carried COUNT and the journal summary, and validates against the schema', () => {
    const r = mk(3, 8);
    at(r, 'p0', 600); at(r, 'p1', 700); tick(r, 2);
    const panel = r.teamPanel('p0')!;
    expect(TeamPanelSchema.safeParse(panel).success).toBe(true);
    expect(panel.members.map((m) => [m.id, m.state])).toEqual([['p0', 'alive'], ['p1', 'alive'], ['p2', 'alive']]);
    for (const m of panel.members) expect(typeof m.carried).toBe('number');
    expect(panel.journal).toBeDefined();
    const raw = JSON.stringify(panel);
    for (const g of GHOST_TYPES) expect(raw).not.toContain(g);
    for (const k of ['itemId', 'kind', 'key_', 'code']) expect(raw).not.toContain(k);
  });
  it('shows hiding, dead, spectating and disconnected', () => {
    const r = mk(4);
    at(r, 'p0', 600); tick(r, 2);
    r.disconnect('p3');
    const dead = (r.deathSystem as unknown as { rt: Map<string, { life: string }> }).rt;
    dead.get('p2')!.life = 'eliminated';
    dead.get('p1')!.life = 'downed';
    const hidden = new Set(['p0']);
    (r.catchSystem as unknown as { hiddenIn: Map<string, unknown> }).hiddenIn.set('p0', { spot: 'x' });
    expect(hidden.has('p0')).toBe(true);
    const st = Object.fromEntries(r.teamPanel('p0')!.members.map((m) => [m.id, m.state]));
    expect(st).toEqual({ p0: 'hiding', p1: 'dead', p2: 'spectating', p3: 'disconnected' });
  });
  it('a dead viewer is sent names and states only: no carried count and no journal', () => {
    const r = mk(3, 8);
    at(r, 'p0', 600); tick(r, 2);
    (r.deathSystem as unknown as { rt: Map<string, { life: string }> }).rt.get('p0')!.life = 'eliminated';
    const panel = r.teamPanel('p0')!;
    expect(panel.journal).toBeUndefined();
    expect(JSON.stringify(panel)).not.toContain('carried');
  });
  it('is null when no stage is running, and for a stranger', () => {
    const lobby = new Room('LOBB', 3, 9, { escape: true, ghost: true });
    lobby.join('p0', 'P0');
    expect(lobby.teamPanel('p0')).toBeNull();
    expect(mk(2).teamPanel('nobody')).toBeNull();
  });
});

export type { PingMarker };
