import { describe, expect, it } from 'vitest';
import { CATCH_LIMITS, ghostTuning, roomById, visionRadius, type RoomGraph } from '@wb/shared';
import { GhostSystem, type GhostCatchEvent, type GhostEvent, type GhostHost, type GhostPlayer, type HidingSpotDef } from '../../src/ghost';
import { generateEscapeStage } from '../../src/rooms/generate';

/** A one-room stage 2 with a hiding spot placed by hand; players are scripted. The ghost is placed by hand too (spawn rules are tested elsewhere). */
class Host implements GhostHost {
  tick = 0;
  puppets: GhostPlayer[];
  catches: { tick: number; player: string; ev: GhostCatchEvent }[] = [];
  hiddenIn = new Map<string, string>();
  constructor(puppets: GhostPlayer[]) { this.puppets = puppets; }
  players(): GhostPlayer[] { return this.puppets; }
  openDoorIds(): ReadonlySet<string> { return new Set(); }
  onCatch(playerId: string, ev: GhostCatchEvent): void {
    this.catches.push({ tick: this.tick, player: playerId, ev });
    const p = this.puppets.find((x) => x.id === playerId);
    if (p) { p.captured = true; p.hidden = false; this.hiddenIn.delete(playerId); }
  }
  occupantOf(spotId: string): string | null { for (const [p, s] of this.hiddenIn) if (s === spotId) return p; return null; }
}

const pup = (id: string, roomId: string, x: number, o: Partial<GhostPlayer> = {}): GhostPlayer =>
  ({ id, name: id.toUpperCase(), roomId, x, y: 680, connected: true, moveX: 0, crouch: false, aim: null, facing: 1, hidden: false, captured: false, ...o });

function build(seed: number, spotsAt: number[], players: (graph: RoomGraph) => GhostPlayer[]) {
  const stage = 2;
  const graph = generateEscapeStage(stage, 11).rooms!;
  const room = graph.start;
  const spots: HidingSpotDef[] = spotsAt.map((x, i) => ({ id: `${room}_h${i}`, room, x, y: 680, kind: i % 2 === 0 ? 'closet' : 'vent' }));
  const host = new Host(players(graph));
  const sys = new GhostSystem({ stage, seed, difficulty: 'easy', graph, visionRadius: visionRadius('easy', stage), types: ['wisp'], hidingSpots: spots }, host);
  const events: GhostEvent[] = [];
  const step = (n = 1) => {
    for (let i = 0; i < n; i++) {
      for (const p of host.puppets) p.x = Math.max(14, p.x + Math.sign(p.moveX) * Math.min(1, Math.abs(p.moveX)) * 13);
      host.tick++;
      sys.step();
      events.push(...sys.drainEvents());
    }
  };
  return { sys, host, graph, room, spots, events, step };
}
const kinds = (ev: GhostEvent[], k: GhostEvent['kind']) => ev.filter((e) => e.kind === k);
const SEEDS = Array.from({ length: 24 }, (_, i) => i + 1);

describe('P3E a hidden player is not seen, not heard, not found by chance', () => {
  it('a hidden player right in front of the ghost is never caught or sighted, for a minute', () => {
    for (const seed of SEEDS.slice(0, 8)) {
      const w = build(seed, [], (g) => [pup('p0', g.start, 640, { hidden: true })]);
      w.sys.placeForTest('g0', { room: w.room, x: 600, y: 658, angle: 0 });
      w.step(1200);
      expect(kinds(w.events, 'catch'), `seed ${seed}`).toEqual([]);
      expect(kinds(w.events, 'sighted'), `seed ${seed}`).toEqual([]);
      expect(w.host.catches).toEqual([]);
    }
  });
  it('a hidden player makes no noise even when the move axis says run', () => {
    const w = build(3, [], (g) => [pup('p0', g.start, 700, { hidden: true, moveX: 1 })]);
    w.sys.placeForTest('g0', { room: w.room, x: 500, y: 658, angle: 0 });
    w.step(10);
    expect(kinds(w.events, 'heard')).toEqual([]);
  });
  it('the same player in the open at the same spot IS seen (so the tests above are not vacuous)', () => {
    let caught = 0;
    for (const seed of SEEDS.slice(0, 8)) {
      const w = build(seed, [], (g) => [pup('p0', g.start, 640)]);
      w.sys.placeForTest('g0', { room: w.room, x: 600, y: 658, angle: 0 });
      w.step(400);
      if (w.host.catches.length > 0) caught++;
    }
    expect(caught).toBe(8);
  });
});

describe('P3E the ghost checks a hiding place near a noise (telegraphed, never a cheat)', () => {
  /** p0 ran to x 700 and made noise, the ghost is nearby; a spot lies within reach of the noise. */
  const noisy = (seed: number, hideIn: boolean) => {
    const w = build(seed, [760], (g) => [pup('p0', g.start, 700, { moveX: 1 })]);
    w.sys.placeForTest('g0', { room: w.room, x: 520, y: 658, angle: Math.PI }); // facing away: it hears the running but does not see the runner
    w.step(1); // the ghost hears the running
    const p = w.host.puppets[0]!;
    p.moveX = 0;
    if (hideIn) { p.hidden = true; w.host.hiddenIn.set('p0', w.spots[0]!.id); p.x = 760; }
    return w;
  };
  it('it sometimes goes to the spot, stands there for the telegraph (the cue says inspecting), then opens it and catches who is inside', () => {
    let inspected = 0, found = 0;
    for (const seed of SEEDS) {
      const w = noisy(seed, true);
      let inspectingTicks = 0;
      for (let i = 0; i < 900; i++) {
        w.step(1);
        const c = w.sys.cueFor(w.room, 100, 680).sounds[0];
        if (c?.inspecting) inspectingTicks++;
      }
      const starts = w.events.filter((e) => e.kind === 'inspect' && e.phase === 'start');
      if (starts.length === 0) continue;
      inspected++;
      expect(inspectingTicks, `seed ${seed}`).toBeGreaterThanOrEqual(CATCH_LIMITS.inspectTicks);
      const f = w.events.find((e) => e.kind === 'inspect' && e.phase === 'found');
      if (f) {
        found++;
        const startTick = starts[0]!.tick;
        expect(f.tick - startTick, `seed ${seed}`).toBeGreaterThanOrEqual(CATCH_LIMITS.inspectTicks);
        expect(w.host.catches.map((c) => c.player)).toEqual(['p0']);
        expect(w.host.catches[0]!.ev.because.join(' ')).toMatch(/Heard P0 running.*Opened the closet and found P0/);
      }
    }
    expect(inspected).toBeGreaterThan(5);   // "may": a seeded chance, not always
    expect(inspected).toBeLessThan(SEEDS.length);
    expect(found).toBe(inspected);          // an occupied spot that is checked is always found (no luck on the ghost's side)
  });
  it('an empty spot is opened just the same and nobody is caught (it never knows who is inside)', () => {
    let empties = 0;
    for (const seed of SEEDS) {
      const w = noisy(seed, false);
      w.host.puppets[0]!.x = 1500; // the player slipped away behind the gate wall
      w.step(900);
      const e = w.events.filter((x) => x.kind === 'inspect' && x.phase === 'empty');
      empties += e.length;
      expect(w.events.filter((x) => x.kind === 'inspect' && x.phase === 'found')).toEqual([]);
    }
    expect(empties).toBeGreaterThan(3);
  });
  it('a hider who steps out during the telegraph is not found inside (the spot is empty when it opens)', () => {
    let tested = 0;
    for (const seed of SEEDS) {
      const w = noisy(seed, true);
      let left = false;
      for (let i = 0; i < 900 && !left; i++) {
        w.step(1);
        if (w.sys.cueFor(w.room, 100, 680).sounds[0]?.inspecting) {
          const p = w.host.puppets[0]!;
          p.hidden = false; w.host.hiddenIn.clear(); p.x = 1500; // out and away (behind the gate wall, out of sight)
          left = true; tested++;
        }
      }
      if (!left) continue;
      w.step(100);
      expect(w.events.filter((e) => e.kind === 'inspect' && e.phase === 'found'), `seed ${seed}`).toEqual([]);
    }
    expect(tested).toBeGreaterThan(3);
  });
  it('no noise, no inspection: a quiet world with spots everywhere never makes the ghost open one', () => {
    for (const seed of SEEDS.slice(0, 6)) {
      const w = build(seed, [500, 800, 1100], (g) => [pup('p0', g.start, 1500, { hidden: true })]);
      w.sys.placeForTest('g0', { room: w.room, x: 400, y: 658, angle: 0 });
      w.step(1500);
      expect(w.events.filter((e) => e.kind === 'inspect'), `seed ${seed}`).toEqual([]);
    }
  });
  it('a spot farther than the inspect radius from the noise is not checked', () => {
    for (const seed of SEEDS.slice(0, 10)) {
      const w = build(seed, [700 + CATCH_LIMITS.inspectRadius + 150], (g) => [pup('p0', g.start, 700, { moveX: 1 })]);
      w.sys.placeForTest('g0', { room: w.room, x: 400, y: 658, angle: 0 });
      w.step(1);
      w.host.puppets[0]!.moveX = 0; w.host.puppets[0]!.x = 1500;
      w.step(600);
      expect(w.events.filter((e) => e.kind === 'inspect'), `seed ${seed}`).toEqual([]);
    }
  });
  it('the same spot is not checked again within the re-inspect time', () => {
    for (const seed of SEEDS) {
      const w = noisy(seed, false);
      w.host.puppets[0]!.x = 1500;
      w.step(900);
      const starts = w.events.filter((e) => e.kind === 'inspect' && e.phase === 'start');
      for (let i = 1; i < starts.length; i++) expect(starts[i]!.tick - starts[i - 1]!.tick).toBeGreaterThanOrEqual(CATCH_LIMITS.reinspectTicks);
    }
  });
  it('it is deterministic: the same seed and script give the same log', () => {
    const go = () => { const w = noisy(5, true); w.step(900); return JSON.stringify(w.events); };
    expect(go()).toBe(go());
  });
});

describe('P3E hunted players cannot hide', () => {
  it('watching() is true only while a hunting ghost has just seen the player', () => {
    const w = build(2, [], (g) => [pup('p0', g.start, 640), pup('p1', g.start, 1500)]);
    expect(w.sys.watching('p0')).toBe(false);
    w.sys.placeForTest('g0', { room: w.room, x: 540, y: 658, angle: 0 });
    w.step(3);
    expect(w.sys.snapshotActors()[0]!.state).toBe('hunting');
    expect(w.sys.watching('p0')).toBe(true);
    expect(w.sys.watching('p1')).toBe(false);
  });
  it('it stops once the ghost has lost sight for a second', () => {
    const w = build(2, [], (g) => [pup('p0', g.start, 640)]);
    w.sys.placeForTest('g0', { room: w.room, x: 540, y: 658, angle: 0 });
    w.step(3);
    expect(w.sys.watching('p0')).toBe(true);
    w.host.puppets[0]!.hidden = true;
    w.step(25);
    expect(w.sys.watching('p0')).toBe(false);
  });
  it('tuning sanity for the tests: the telegraph is not shorter than the warning rule of two seconds', () => {
    expect(CATCH_LIMITS.inspectTicks).toBeGreaterThanOrEqual(40);
    void ghostTuning; void roomById;
  });
});
