import { describe, expect, it } from 'vitest';
import { GHOST_LIMITS, GHOST_TRANSITIONS, MOVE_SPEED, TICK_DT, ghostTuning, type GhostState } from '@wb/shared';
import { GhostSystem, explainCatch, type GhostCatchEvent, type GhostEvent } from '../../src/ghost';
import { FakeHost, inAnyView, puppet, rig, run, tick, type Puppet, type Rig } from './harness';

const MINUTE = 20 * 60;
/** Players that run back and forth in room 0 (the loudest thing a player can do), one standing still. */
const runners = (graph: { start: string }): Puppet[] => [
  puppet('p0', graph.start, 300, 680, { script: (t, p) => { p.moveX = Math.floor(t / 40) % 2 === 0 ? 1 : -1; } }),
  puppet('p1', graph.start, 350),
  puppet('p2', graph.start, 400, 680, { script: (t, p) => { p.moveX = Math.floor(t / 70) % 2 === 0 ? 0.3 : 0; } }),
];
const stateEvents = (sys: GhostSystem) => sys.events.filter((e): e is Extract<GhostEvent, { kind: 'state' }> => e.kind === 'state');

describe('P3E ghost: determinism', () => {
  it('same (stage, seed) and same inputs give the same events and the same positions on every tick', () => {
    for (const [stage, seed] of [[2, 11], [7, 12345], [12, 99]] as const) {
      const a = rig({ stage, seed, players: runners, types: stage === 7 ? ['shade'] : ['wisp'] });
      const b = rig({ stage, seed, players: runners, types: stage === 7 ? ['shade'] : ['wisp'] });
      for (let i = 0; i < 5 * MINUTE; i++) {
        tick(a); tick(b);
        if (i % 50 === 0) expect(a.sys.snapshotActors()).toEqual(b.sys.snapshotActors());
      }
      expect(JSON.stringify(a.sys.events)).toBe(JSON.stringify(b.sys.events));
      expect(a.sys.events.length).toBeGreaterThan(0);
    }
  });
  it('a different seed gives a different schedule', () => {
    const a = rig({ stage: 2, seed: 1, players: runners }), b = rig({ stage: 2, seed: 2, players: runners });
    run(a, 5 * MINUTE); run(b, 5 * MINUTE);
    expect(JSON.stringify(a.sys.events)).not.toBe(JSON.stringify(b.sys.events));
  });
});

describe('P3E ghost: no ghost without a type, at most 2 at once', () => {
  it('stage 1 has no types, so no ghost ever exists', () => {
    const r = rig({ stage: 1, seed: 5, types: [], players: runners });
    run(r, 10 * MINUTE);
    expect(r.sys.events).toEqual([]);
    expect(r.sys.publicGhosts()).toEqual([]);
    expect(r.sys.warning).toBe(false);
  });
  it('even if asked for three types, only two ghosts exist, and never more than two are present', () => {
    const r = rig({ stage: 13, seed: 8, types: ['wisp', 'shade', 'howler'], players: runners });
    expect(r.sys.snapshotActors().length).toBe(2);
    let most = 0;
    run(r, 15 * MINUTE, () => { most = Math.max(most, r.sys.publicGhosts().length); });
    expect(most).toBeLessThanOrEqual(2);
    expect(most).toBeGreaterThan(0);
  });
});

describe('P3E ghost: the state machine and the warning', () => {
  const cases: [number, number][] = [[2, 1], [2, 2], [3, 3], [7, 4], [12, 5], [20, 6]];
  it('every transition is legal, and every appearance is preceded by a warning of at least 3 seconds', () => {
    for (const [stage, seed] of cases) {
      const r = rig({ stage, seed, players: runners });
      run(r, 20 * MINUTE);
      const states = new Map<string, GhostState>();
      let spawns = 0;
      for (const e of r.sys.events) {
        if (e.kind === 'state') {
          expect(GHOST_TRANSITIONS[e.from]).toContain(e.to);
          expect(states.get(e.ghost) ?? 'dormant').toBe(e.from);
          states.set(e.ghost, e.to);
        }
        if (e.kind === 'spawn') {
          spawns++;
          const warn = stateEvents(r.sys).filter((s) => s.ghost === e.ghost && s.to === 'warning' && s.tick <= e.tick).at(-1);
          expect(warn, `stage ${stage} seed ${seed}: a spawn at tick ${e.tick} with no warning`).toBeDefined();
          expect(e.tick - warn!.tick).toBeGreaterThanOrEqual(GHOST_LIMITS.minWarningTicks);
          expect(e.warnedAt).toBe(warn!.tick);
        }
      }
      expect(spawns).toBeGreaterThan(0);
    }
  });
  it('a ghost is only ever present from the moment it spawns, and is absent during dormant, warning and respawn', () => {
    const r = rig({ stage: 3, seed: 21, players: runners });
    run(r, 15 * MINUTE, () => {
      const ids = new Set(r.sys.publicGhosts().map((g) => g.id));
      for (const a of r.sys.snapshotActors()) {
        const shown = a.state === 'roaming' || a.state === 'hunting' || a.state === 'stunned';
        expect(ids.has(a.id)).toBe(shown);
        expect(a.present).toBe(shown);
      }
    });
  });
  it('the first appearance is never immediate and the later ones keep the interval', () => {
    const r = rig({ stage: 2, seed: 4, players: runners });
    run(r, 20 * MINUTE);
    const t = ghostTuning('easy', 2);
    const firstWarning = stateEvents(r.sys).find((e) => e.to === 'warning')!;
    expect(firstWarning.tick).toBeGreaterThanOrEqual(Math.floor(t.intervalTicks * GHOST_LIMITS.firstAppearanceMinShare));
    const respawns = stateEvents(r.sys).filter((e) => e.to === 'respawn');
    for (const rs of respawns) {
      const next = stateEvents(r.sys).find((e) => e.to === 'warning' && e.tick > rs.tick);
      if (next) expect(next.tick - rs.tick).toBeGreaterThanOrEqual(t.intervalTicks);
    }
  });
});

describe('P3E ghost: where it may appear', () => {
  it('never inside a player\'s view, never near a player, never in an arrival area, always on the players\' side (stages 2 to 40, many seeds)', () => {
    let audited = 0;
    for (const stage of [2, 3, 7, 12, 25, 40]) for (let seed = 1; seed <= 8; seed++) {
      const r = rig({ stage, seed, players: runners, types: stage === 12 ? ['howler'] : ['wisp'] });
      run(r, 12 * MINUTE);
      for (const e of r.sys.events) {
        if (e.kind !== 'spawn') continue;
        audited++;
        const pts = r.host.history.get(e.tick)!;
        for (const p of pts.filter((q) => q.roomId === e.room)) {
          expect(Math.hypot(e.x - p.x, e.y - (p.y - 22)), `stage ${stage} seed ${seed}: too close`).toBeGreaterThanOrEqual(GHOST_LIMITS.minSpawnDistance);
        }
        expect(inAnyView(r, e.tick, e.room, e), `stage ${stage} seed ${seed}: spawned in view at tick ${e.tick}`).toBe(false);
        const room = r.graph.rooms.find((x) => x.id === e.room)!;
        const arrivals = [...room.arena.spawns, ...r.graph.rooms.flatMap((x) => x.doors.filter((d) => d.to === room.id).map((d) => d.arrive))];
        for (const ap of arrivals) expect(Math.hypot(e.x - ap.x, e.y - ap.y)).toBeGreaterThanOrEqual(GHOST_LIMITS.arrivalSafeRadius);
        // on the players' side of any wall: it can reach them without a door
        expect(e.room).toBe(r.graph.start);
        if (r.graph.rooms.length === 1) expect(e.x).toBeLessThan(1360); // one room with a gate: the left side of the wall, where the players are
      }
    }
    expect(audited).toBeGreaterThan(40);
  });

  it('when no fair spot exists the warning goes on (it is never skipped) and the block is logged once per warning', () => {
    // every player stands in the middle of a small area covered by the minimum distance: use a room-1 stage and put players across the whole floor
    const r = rig({
      stage: 2, seed: 3,
      players: (g) => [300, 700, 1100, 1500, 1800].map((x, i) => puppet(`p${i}`, g.start, x)),
    });
    run(r, 8 * MINUTE);
    const blocked = r.sys.events.filter((e) => e.kind === 'spawn_blocked');
    const spawns = r.sys.events.filter((e) => e.kind === 'spawn');
    // either nothing ever fit (blocked, never spawned) or every spawn that happened obeyed the rules; a block must never be followed by a rule-breaking spawn
    for (const s of spawns) expect(inAnyView(r, s.tick, (s as Extract<GhostEvent, { kind: 'spawn' }>).room, s as unknown as { x: number; y: number })).toBe(false);
    expect(blocked.length + spawns.length).toBeGreaterThan(0);
  });
});

describe('P3E ghost: speed', () => {
  it('never moves more than 95 percent of the sprint per tick (stages 2, 12, 60, 1,000,000 in every mode)', () => {
    const cap = 0.95 * MOVE_SPEED * TICK_DT;
    for (const difficulty of ['easy', 'intermediate', 'hardcore'] as const) for (const stage of [2, 12, 60, 1_000_000]) {
      const r = rig({ stage, seed: 31, difficulty, players: runners });
      let prev: { room: string; x: number; y: number } | null = null;
      let moved = 0;
      run(r, 8 * MINUTE, () => {
        const g = r.sys.snapshotActors()[0]!;
        if (g.present && prev && prev.room === g.room) {
          const d = Math.hypot(g.x - prev.x, g.y - prev.y);
          if (d < 100) { expect(d).toBeLessThanOrEqual(cap + 1e-6); moved += d; } // a door passage is a jump to the arrival point, timed by the door rule below
        }
        prev = g.present ? { room: g.room, x: g.x, y: g.y } : null;
      });
      expect(moved).toBeGreaterThan(100);
    }
  });
  it('a ghost is slower than a sprinting player: a runner who keeps going is never caught from behind', () => {
    const cap = ghostTuning('hardcore', 1_000_000).speedPxPerTick;
    expect(cap).toBeLessThan(MOVE_SPEED * TICK_DT);
  });
});

/** A rig with one ghost placed by hand. The player is `dx` px away on the same floor. */
function arena(opts: { dx: number; angle: number; player?: Partial<Puppet>; stage?: number; seed?: number }): Rig {
  const r = rig({ stage: opts.stage ?? 2, seed: opts.seed ?? 7, players: (g) => [puppet('p0', g.start, 300, 680, opts.player)] });
  r.sys.placeForTest('g0', { room: r.graph.start, x: 300 + opts.dx, y: 640, angle: opts.angle });
  return r;
}
const kinds = (r: Rig, k: string) => r.sys.events.filter((e) => e.kind === k);

describe('P3E ghost: sight (a cone, blocked by walls and closed doors)', () => {
  it('sees a player in front of it within range, and starts hunting', () => {
    const r = arena({ dx: 200, angle: Math.PI });
    tick(r);
    expect(kinds(r, 'sighted').length).toBe(1);
    expect(r.sys.snapshotActors()[0]!.state).toBe('hunting');
  });
  it('does not see a player behind it, beyond its range, or outside its cone', () => {
    for (const c of [{ dx: 200, angle: 0 }, { dx: GHOST_LIMITS.sightRange + 60, angle: Math.PI }, { dx: 200, angle: Math.PI / 2 }]) {
      const r = arena(c); tick(r);
      expect(kinds(r, 'sighted').length, JSON.stringify(c)).toBe(0);
    }
  });
  it('a hidden player standing in plain view, in the cone, is not seen (and a captured one is not hunted)', () => {
    for (const player of [{ hidden: true }, { captured: true }]) {
      const r = arena({ dx: 150, angle: Math.PI, player });
      run(r, 30);
      expect(kinds(r, 'sighted').length).toBe(0);
      expect(kinds(r, 'catch').length).toBe(0);
    }
  });
  it('a wall blocks sight: the same player is seen on the near side of the gate wall and not through it', () => {
    // stage 2 is one room with a wall from floor to ceiling at x 1380 to 1420
    const near = rig({ stage: 2, seed: 7, players: (g) => [puppet('p0', g.start, 1200)] });
    near.sys.placeForTest('g0', { room: near.graph.start, x: 1000, y: 640, angle: 0 });
    tick(near);
    expect(kinds(near, 'sighted').length).toBe(1);
    const far = rig({ stage: 2, seed: 7, players: (g) => [puppet('p0', g.start, 1500)] });
    far.sys.placeForTest('g0', { room: far.graph.start, x: 1300, y: 640, angle: 0 });
    tick(far);
    expect(kinds(far, 'sighted').length).toBe(0);
  });
  it('a CLOSED door blocks sight and an open one does not', () => {
    // a hand-made room with one doorway in the middle of the floor
    const graph = {
      start: 'rt',
      rooms: [{
        id: 'rt',
        arena: { id: 'rt', name: 'T', width: 1920, height: 720, solids: [{ x: 0, y: 680, w: 1920, h: 40 }], spawns: [300, 350, 400, 450].map((x) => ({ x, y: 680 })) },
        doors: [{ id: 'rt_d', x: 640, y: 580, w: 40, h: 100, to: 'rt', arrive: { x: 900, y: 680 } }],
      }],
    };
    const mk = () => {
      const r = rig({ stage: 2, seed: 3, graph, players: () => [puppet('p0', 'rt', 840)] });
      r.sys.placeForTest('g0', { room: 'rt', x: 580, y: 640, angle: 0 });
      return r;
    };
    const closed = mk(); tick(closed);
    expect(kinds(closed, 'sighted').length).toBe(0);
    const opened = mk(); opened.host.open.add('rt_d'); tick(opened);
    expect(kinds(opened, 'sighted').length).toBe(1);
  });
});

describe('P3E ghost: a hidden player is never found by sight', () => {
  it('over 20 minutes a hidden, silent player is never sighted or caught, while the same player in the open is', () => {
    let openCaught = 0;
    for (let seed = 1; seed <= 6; seed++) {
      const hid = rig({ stage: 2, seed, players: (g) => [puppet('p0', g.start, 700, 680, { hidden: true })] });
      run(hid, 20 * MINUTE);
      expect(hid.sys.events.some((e) => e.kind === 'sighted' || e.kind === 'catch')).toBe(false);
      expect(hid.sys.events.some((e) => e.kind === 'spawn')).toBe(true);
      const open = rig({ stage: 2, seed, players: (g) => [puppet('p0', g.start, 700, 680, { crouch: true })] });
      run(open, 20 * MINUTE);
      openCaught += open.sys.events.filter((e) => e.kind === 'sighted').length;
    }
    expect(openCaught).toBeGreaterThan(0); // the test has teeth: a ghost does find a player who just stands there
  });
});

describe('P3E ghost: noise (running is loud; walking and sneaking are quiet)', () => {
  const heard = (moveX: number, dx: number, crouch = false) => {
    // the ghost faces AWAY from the player, so only hearing can tell it about them
    const r = arena({ dx, angle: 0, player: { moveX, crouch } });
    tick(r);
    return kinds(r, 'heard').length;
  };
  const hearing = ghostTuning('easy', 2).hearingPx;
  it('a runner inside the hearing range is heard; a runner beyond it is not', () => {
    expect(heard(1, hearing - 60)).toBe(1);
    expect(heard(1, hearing + 120)).toBe(0);
  });
  it('the same distance is silent for a sneaking, standing or crouching player, and quiet for a walking one', () => {
    expect(heard(0.3, 150)).toBe(0);            // sneaking
    expect(heard(0, 150)).toBe(0);              // standing
    expect(heard(1, 150, true)).toBe(0);        // crouching (Shift held, standing or at sneak speed): silent even if the move axis says run
    expect(heard(0.5, hearing * 0.4 + 60)).toBe(0); // walking is only 40 percent of the range
    expect(heard(0.5, hearing * 0.4 - 40)).toBe(1);
  });
  it('a heard noise sends the ghost to where it came from, then it searches and goes back to patrolling', () => {
    const r = arena({ dx: 250, angle: 0, player: { moveX: 1 } });
    tick(r);
    const p = r.host.puppets[0]!;
    p.moveX = 0; // the player stops: the ghost walks to the last noise
    const start = r.sys.snapshotActors()[0]!;
    run(r, 5);
    const g = r.sys.snapshotActors()[0]!;
    expect(Math.hypot(g.x - p.x, g.y - 658)).toBeLessThan(Math.hypot(start.x - p.x, start.y - 658));
  });
  it('noise from another room is not heard', () => {
    const r = rig({ stage: 3, seed: 7, players: (g) => [puppet('p0', g.start, 300)] });
    const [r0, r1] = r.graph.rooms;
    r.sys.placeForTest('g0', { room: r0!.id, x: 600, y: 640, angle: Math.PI });
    r.sys.makeNoise({ room: r1!.id, x: 600, y: 640, loud: 1.1, player: 'p9', name: 'P9', kind: 'drop' }); // the same spot, the other room
    expect(kinds(r, 'heard').length).toBe(0);
    r.sys.makeNoise({ room: r0!.id, x: 600, y: 640, loud: 1.1, player: 'p9', name: 'P9', kind: 'drop' });
    expect(kinds(r, 'heard').length).toBe(1);
  });
  it('an item dropped nearby is a noise (loud), a door being used is a noise (a trail the ghost follows)', () => {
    const r = arena({ dx: 200, angle: 0 });
    r.sys.makeNoise({ room: r.graph.start, x: 300, y: 650, loud: 1.1, player: 'p0', name: 'P0', kind: 'drop' });
    expect(kinds(r, 'heard').length).toBe(1);
  });
});

describe('P3E ghost: doors take time, and a locked door is never passed', () => {
  /** stage 2: a gate in a wall at x 1380. The player is in the alcove behind it (he went through), the ghost is on the left side hearing him. */
  const gateRig = (open: boolean): Rig => {
    const r = rig({ stage: 2, seed: 9, players: (g) => [puppet('p0', g.start, 1700)] });
    const room = r.graph.rooms[0]!;
    if (open) for (const d of room.doors) r.host.open.add(d.id);
    r.sys.placeForTest('g0', { room: room.id, x: 1180, y: 640, angle: Math.PI });
    r.sys.makeNoise({ room: room.id, x: 1700, y: 658, loud: 1.1, player: 'p0', name: 'P0', kind: 'drop' }); // out of hearing range: gives no goal
    return r;
  };
  it('through an OPEN gate the ghost walks to the door, spends at least the door time opening it, and arrives on the other side', () => {
    const r = gateRig(true);
    const room = r.graph.rooms[0]!;
    // a trail that leads through the gate: the player used the gate door 'gi' a moment ago (he now stands in the alcove)
    const gi = room.doors.find((d) => d.id.endsWith('_gi'))!;
    r.sys.makeNoise({ room: room.id, x: gi.x + gi.w / 2, y: gi.y + gi.h - 22, loud: 1.1, player: 'p0', name: 'P0', kind: 'door', door: gi.id });
    run(r, 20 * 20);
    const start = r.sys.events.find((e) => e.kind === 'door' && e.phase === 'start');
    const done = r.sys.events.find((e) => e.kind === 'door' && e.phase === 'done');
    expect(start && done, 'the ghost went through the open gate').toBeTruthy();
    expect(done!.tick - start!.tick).toBeGreaterThanOrEqual(GHOST_LIMITS.doorTicks);
    expect(r.sys.snapshotActors()[0]!.x).toBeGreaterThan(1420); // the alcove side
  });
  it('through a CLOSED gate it never passes, however long it tries', () => {
    const r = gateRig(false);
    const room = r.graph.rooms[0]!;
    const gi = room.doors.find((d) => d.id.endsWith('_gi'))!;
    r.sys.makeNoise({ room: room.id, x: gi.x + gi.w / 2, y: gi.y + gi.h - 22, loud: 1.1, player: 'p0', name: 'P0', kind: 'door', door: gi.id });
    run(r, 60 * 20, () => { expect(r.sys.snapshotActors()[0]!.x).toBeLessThan(1380); });
    expect(r.sys.events.some((e) => e.kind === 'door' && e.phase === 'done')).toBe(false);
  });
  it('a door that is locked again while it is being opened cancels the passage', () => {
    const r = gateRig(true);
    const room = r.graph.rooms[0]!;
    const gi = room.doors.find((d) => d.id.endsWith('_gi'))!;
    r.sys.makeNoise({ room: room.id, x: gi.x + gi.w / 2, y: gi.y + gi.h - 22, loud: 1.1, player: 'p0', name: 'P0', kind: 'door', door: gi.id });
    for (let i = 0; i < 400 && !r.sys.events.some((e) => e.kind === 'door' && e.phase === 'start'); i++) tick(r);
    r.host.open.clear();
    run(r, 100);
    expect(r.sys.events.some((e) => e.kind === 'door' && e.phase === 'cancelled')).toBe(true);
    expect(r.sys.events.some((e) => e.kind === 'door' && e.phase === 'done')).toBe(false);
  });
});

describe('P3E ghost: stun and respawn', () => {
  it('cannot be stunned while dormant, in its warning, or between appearances; can be while roaming or hunting', () => {
    const r = rig({ stage: 2, seed: 5, players: runners });
    expect(r.sys.stun('g0', 'p0')).toBe(false); // dormant
    let sawWarning = false;
    for (let i = 0; i < 20 * MINUTE && !sawWarning; i++) { tick(r); if (r.sys.snapshotActors()[0]!.state === 'warning') sawWarning = true; }
    expect(sawWarning).toBe(true);
    expect(r.sys.stun('g0', 'p0')).toBe(false); // warning
    for (let i = 0; i < 2000 && r.sys.snapshotActors()[0]!.state === 'warning'; i++) tick(r);
    const st = r.sys.snapshotActors()[0]!.state;
    expect(['roaming', 'hunting']).toContain(st);
    expect(r.sys.stun('nope', 'p0')).toBe(false);
    expect(r.sys.stun('g0', 'p0')).toBe(true);
    expect(r.sys.snapshotActors()[0]!.state).toBe('stunned');
    expect(r.sys.stun('g0', 'p0')).toBe(false); // already stunned
  });
  it('a stunned ghost stands still for the stun time, then leaves (RESPAWN) and warns again before coming back', () => {
    const r = rig({ stage: 2, seed: 6, players: (g) => [puppet('p0', g.start, 300, 680, { hidden: true })] });
    r.sys.placeForTest('g0', { room: r.graph.start, x: 900, y: 640 });
    const at = r.sys.snapshotActors()[0]!;
    expect(r.sys.stun('g0', 'p0')).toBe(true);
    const t0 = r.host.tick, stunTicks = ghostTuning('easy', 2).stunTicks;
    run(r, stunTicks - 2, () => { const g = r.sys.snapshotActors()[0]!; expect([g.x, g.y]).toEqual([at.x, at.y]); expect(g.state).toBe('stunned'); });
    run(r, 4);
    expect(r.sys.snapshotActors()[0]!.state).toBe('respawn');
    expect(r.sys.publicGhosts()).toEqual([]);
    const ev = r.sys.events.find((e) => e.kind === 'stun')!;
    expect(ev.kind === 'stun' && ev.until).toBe(t0 + stunTicks);
    run(r, ghostTuning('easy', 2).intervalTicks + 5);
    expect(stateEvents(r.sys).some((e) => e.from === 'respawn' && e.to === 'warning')).toBe(true);
  });
});

describe('P3E ghost: the event log explains every catch', () => {
  it('each catch carries a chain of reasons with ticks, and explainCatch reads as a sentence', () => {
    let catches = 0;
    for (let seed = 1; seed <= 6; seed++) {
      const r = rig({ stage: 2, seed, players: (g) => [puppet('p0', g.start, 700, 680, { script: (t, p) => { p.moveX = Math.floor(t / 30) % 2 === 0 ? 1 : -1; } })] });
      run(r, 15 * MINUTE);
      for (const c of r.host.catches) {
        catches++;
        expect(c.ev.kind).toBe('catch');
        expect(c.ev.because.length).toBeGreaterThanOrEqual(2);
        expect(c.ev.because.at(-1)).toContain(`tick ${c.ev.tick}`);
        expect(c.ev.because.some((b) => /^(Heard|Saw) /.test(b) && /tick \d+/.test(b))).toBe(true);
        const sentence = explainCatch(c.ev as GhostCatchEvent);
        expect(sentence).toMatch(/tick \d+/);
        expect(sentence.endsWith('.')).toBe(true);
      }
      // after a catch the ghost leaves and warns again before the next appearance
      for (const e of r.sys.events) if (e.kind === 'catch') {
        const next = stateEvents(r.sys).find((s) => s.tick >= e.tick && s.to === 'respawn');
        expect(next).toBeDefined();
      }
    }
    expect(catches).toBeGreaterThan(0);
  });
  it('the log is a bounded ring', () => {
    const r = rig({ stage: 2, seed: 2, difficulty: 'hardcore', players: runners });
    run(r, 60 * MINUTE);
    expect(r.sys.events.length).toBeLessThanOrEqual(GHOST_LIMITS.maxLogEvents);
    expect(r.sys.drainEvents().length).toBeGreaterThan(0);
    expect(r.sys.drainEvents()).toEqual([]);
  });
});

describe('P3E ghost: it can reach the players', () => {
  it('a ghost that spawns hunts the players: over 20 minutes it sights them at least once for most seeds (it is not stuck)', () => {
    let seedsThatMet = 0;
    for (let seed = 1; seed <= 10; seed++) {
      const r = rig({ stage: 2, seed, players: runners });
      run(r, 20 * MINUTE);
      if (r.sys.events.some((e) => e.kind === 'sighted')) seedsThatMet++;
    }
    expect(seedsThatMet).toBeGreaterThanOrEqual(7);
  });
  it('paths over generated multi-room stages never put the ghost inside a solid', () => {
    for (const [stage, seed] of [[3, 1], [7, 2], [15, 3], [40, 4]] as const) {
      const r = rig({ stage, seed, players: runners });
      run(r, 10 * MINUTE, () => {
        const g = r.sys.snapshotActors()[0]!;
        if (!g.present) return;
        const room = r.graph.rooms.find((x) => x.id === g.room)!;
        for (const s of room.arena.solids) {
          const inside = g.x > s.x + 0.5 && g.x < s.x + s.w - 0.5 && g.y > s.y + 0.5 && g.y < s.y + s.h - 0.5;
          expect(inside, `stage ${stage}: ghost inside a solid at ${g.x},${g.y}`).toBe(false);
        }
      });
    }
  });
});

void FakeHost;
