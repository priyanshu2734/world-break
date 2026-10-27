import { describe, expect, it } from 'vitest';
import { HOWLER_LIMITS, ghostTuning, visionRadius, type GhostType } from '@wb/shared';
import { GhostSystem, type GhostCatchEvent, type GhostHost } from '../../src/ghost';
import { generateEscapeStage } from '../../src/rooms/generate';
import { FakeHost, puppet, tick, type Puppet, type Rig } from './harness';

/** A host that also records screams (the Room breaks the lights on one). */
class ScreamHost extends FakeHost {
  screams: { ghost: string; room: string; x: number; y: number; tick: number }[] = [];
  onScream(ev: { ghost: string; room: string; x: number; y: number; tick: number }): void { this.screams.push(ev); }
}
type MkRig = Rig & { host: ScreamHost };
function mk(stage: number, seed: number, types: GhostType[], players: Puppet[] | ((start: string) => Puppet[])): MkRig {
  const graph = generateEscapeStage(stage, seed).rooms!;
  const ps = typeof players === 'function' ? players(graph.start) : players;
  const host = new ScreamHost(ps.map((p) => ({ ...p, roomId: p.roomId === '@start' ? graph.start : p.roomId })));
  const radius = visionRadius('easy', stage);
  const sys = new GhostSystem({ stage, seed, difficulty: 'easy', graph, visionRadius: radius, types }, host as GhostHost);
  return { sys, host, graph, stage, seed, radius };
}
const at = (r: MkRig, kind: 'roaming' | 'hunting', x: number, angle: number, id = 'g0') => r.sys.placeForTest(id, { room: r.graph.start, x, y: 640, angle, state: kind });
const ghostPos = (r: MkRig) => { const g = r.sys.snapshotActors()[0]!; return { x: g.x, y: g.y }; };
const steps = (r: MkRig, n: number) => { for (let i = 0; i < n; i++) tick(r); };

describe('Shade: moves ONLY while no flashlight cone is on it', () => {
  const setup = (aim: number | null, extra: Partial<Puppet> = {}) => {
    const r = mk(7, 5, ['shade'], (start) => [puppet('p0', start, 300, 680, { aim, facing: 1, ...extra })]);
    const d = Math.min(300, r.radius * 0.5);
    at(r, 'roaming', 300 + d, Math.PI);
    return { r, d };
  };
  it('lit by a cone: it does not move at all, and is shown as lit', () => {
    const { r } = setup(0);
    const p0 = ghostPos(r);
    steps(r, 120);
    expect(ghostPos(r)).toEqual(p0);
    expect(r.sys.publicGhosts()[0]!.lit).toBe(true);
  });
  it('not lit (the player looks the other way): it moves', () => {
    const { r } = setup(Math.PI);
    const p0 = ghostPos(r);
    steps(r, 120);
    expect(ghostPos(r)).not.toEqual(p0);
    expect(r.sys.publicGhosts()[0]?.lit).toBeUndefined();
  });
  it('lit only while the light stays on it: turn away and it moves, turn back and it freezes again', () => {
    const { r } = setup(0);
    const p = r.host.puppets[0]!;
    steps(r, 20);
    const frozen = ghostPos(r);
    p.aim = Math.PI; steps(r, 40);
    const moved = ghostPos(r);
    expect(moved).not.toEqual(frozen);
    p.aim = Math.atan2(moved.y - 652, moved.x - 300); steps(r, 40);
    const again = ghostPos(r);
    steps(r, 20);
    expect(ghostPos(r)).toEqual(again);
  });
  it('a hiding or caught player holds no light; a player in another room does not light it', () => {
    for (const extra of [{ hidden: true }, { captured: true }] as const) {
      const { r } = setup(0, extra);
      const p0 = ghostPos(r);
      steps(r, 60);
      expect(ghostPos(r)).not.toEqual(p0);
    }
    const r = mk(7, 5, ['shade'], (start) => [puppet('p0', start, 300, 680, { aim: 0 }), puppet('p1', 'elsewhere', 300, 680, { aim: 0 })]);
    expect(r.sys.snapshotActors()).toHaveLength(1);
  });
  it('the other types are not slowed by light', () => {
    const r = mk(2, 5, ['wisp'], (start) => [puppet('p0', start, 300, 680, { aim: 0 })]);
    at(r, 'roaming', 300 + Math.min(300, r.radius * 0.5), Math.PI);
    const p0 = ghostPos(r);
    steps(r, 60);
    expect(ghostPos(r)).not.toEqual(p0);
  });
});

describe('Howler: a scream, telegraphed, that breaks the lights and alerts it (crouching counters it)', () => {
  const sight = (aliveCrouch: boolean) => {
    const r = mk(12, 3, ['howler'], (start) => [puppet('p0', start, 400, 680, { crouch: aliveCrouch }), puppet('p1', start, 330, 680, { crouch: true })]);
    at(r, 'roaming', 700, Math.PI);
    return r;
  };
  it('on sighting it stops and WINDS UP (the cue says screaming) for the telegraph, then screams once', () => {
    const r = sight(false);
    let windup = -1, scream = -1, screamingCue = false;
    for (let i = 0; i < 80 && scream < 0; i++) {
      tick(r);
      const ev = r.sys.events.filter((e) => e.kind === 'scream');
      if (windup < 0 && ev.some((e) => e.kind === 'scream' && e.phase === 'windup')) windup = r.host.tick;
      if (ev.some((e) => e.kind === 'scream' && e.phase === 'scream')) scream = r.host.tick;
      if (r.sys.cueFor(r.graph.start, 400, 680).sounds.some((s) => s.screaming === true)) screamingCue = true;
    }
    expect(windup).toBeGreaterThan(0);
    expect(scream - windup).toBeGreaterThanOrEqual(HOWLER_LIMITS.windupTicks - 1);
    expect(screamingCue).toBe(true);
    expect(r.host.screams).toHaveLength(1);
    expect(r.host.screams[0]!.room).toBe(r.graph.start);
    expect(r.sys.drainFx().some((f) => f.kind === 'scream')).toBe(true);
  });
  it('it stands still during the wind-up (a fair moment to react)', () => {
    const r = sight(false);
    tick(r);
    const p = ghostPos(r);
    let moved = false;
    for (let i = 0; i < HOWLER_LIMITS.windupTicks - 3; i++) { tick(r); if (ghostPos(r).x !== p.x) moved = true; }
    expect(moved).toBe(false);
  });
  it('the scream tells it where the nearest player who is NOT crouching is; a crouching player is not revealed', () => {
    const loud = sight(false);
    for (let i = 0; i < 60; i++) tick(loud);
    const a = loud.sys.events.find((e) => e.kind === 'scream' && e.phase === 'scream');
    expect(a && a.kind === 'scream' ? a.alerted : 'none').toBe('p0');
    const quiet = sight(true);
    for (let i = 0; i < 60; i++) tick(quiet);
    const b = quiet.sys.events.find((e) => e.kind === 'scream' && e.phase === 'scream');
    expect(b && b.kind === 'scream' ? b.alerted : 'none').toBeNull();
  });
  it('it screams again only after the cooldown', () => {
    const r = sight(false);
    for (let i = 0; i < HOWLER_LIMITS.cooldownTicks - 40; i++) tick(r);
    expect(r.host.screams.length).toBeLessThanOrEqual(1);
  });
  it('another ghost anywhere comes to the scream (a Wisp goes to look)', () => {
    const graph = generateEscapeStage(13, 4).rooms!;
    const host = new ScreamHost([puppet('p0', graph.start, 400), puppet('p1', graph.start, 330, 680, { crouch: true })]);
    const sys = new GhostSystem({ stage: 13, seed: 4, difficulty: 'easy', graph, visionRadius: visionRadius('easy', 13), types: ['howler', 'wisp'] }, host);
    sys.placeForTest('g0', { room: graph.start, x: 700, y: 640, angle: Math.PI, state: 'roaming' });
    sys.placeForTest('g1', { room: graph.start, x: 1500, y: 640, angle: 0, state: 'roaming' });
    const r: Rig = { sys, host, graph, stage: 13, seed: 4, radius: visionRadius('easy', 13) };
    const x0 = sys.snapshotActors()[1]!.x;
    for (let i = 0; i < 80; i++) tick(r);
    expect(sys.snapshotActors()[1]!.x).toBeLessThan(x0 - 20); // it walked toward the scream
  });
});

describe('a ghost destroyed by the gun', () => {
  const setup = () => mk(2, 9, ['wisp'], (start) => [puppet('p0', start, 300)]);
  it('dissolves: absent at once, an effect and an event, back only after the respawn timer, through its WARNING', () => {
    const r = setup();
    at(r, 'roaming', 800, Math.PI);
    expect(r.sys.destroy('g0', 'p0')).toBe(true);
    expect(r.sys.publicGhosts()).toEqual([]);
    expect(r.sys.drainFx()).toMatchObject([{ kind: 'dissolve', ghost: 'wisp' }]);
    const ev = r.sys.events.find((e) => e.kind === 'destroy');
    const t0 = r.host.tick, need = ghostTuning('easy', 2).respawnTicks;
    expect(ev && ev.kind === 'destroy' ? ev.returnsAt - t0 : 0).toBe(need);
    let warned = -1;
    for (let i = 0; i < need + 200; i++) {
      tick(r);
      if (r.sys.warning && warned < 0) warned = r.host.tick - t0;
      if (r.host.tick - t0 < need - 1) expect(r.sys.publicGhosts()).toEqual([]);
    }
    expect(warned).toBe(need);
  });
  it('is deterministic: the same hit on the same tick gives the same return tick and place', () => {
    const run = () => {
      const r = setup();
      at(r, 'roaming', 800, Math.PI);
      r.sys.destroy('g0', 'p0');
      for (let i = 0; i < ghostTuning('easy', 2).respawnTicks + 300; i++) tick(r);
      return JSON.stringify(r.sys.events.filter((e) => e.kind === 'spawn' || e.kind === 'destroy'));
    };
    expect(run()).toBe(run());
  });
  it('cannot be hit in its warning, absent, or twice', () => {
    const r = setup();
    expect(r.sys.destroy('g0', 'p0')).toBe(false); // dormant
    at(r, 'roaming', 800, 0);
    expect(r.sys.destroy('g0', 'p0')).toBe(true);
    expect(r.sys.destroy('g0', 'p0')).toBe(false); // already gone
  });
});

describe('two players in one hiding spot are both found when the ghost opens it', () => {
  it('both are caught', () => {
    const graph = generateEscapeStage(2, 9).rooms!;
    const catches: string[] = [];
    class H extends FakeHost {
      override onCatch(id: string, ev: GhostCatchEvent): void { catches.push(id); super.onCatch(id, ev); }
      occupantsOf(): string[] { return ['p0', 'p1']; }
    }
    const spot = { id: 's', room: graph.start, x: 600, y: 680, kind: 'closet' as const };
    const host = new H([puppet('p0', graph.start, 600, 680, { hidden: true }), puppet('p1', graph.start, 600, 680, { hidden: true })]);
    const sys = new GhostSystem({ stage: 2, seed: 9, difficulty: 'easy', graph, visionRadius: visionRadius('easy', 2), types: ['wisp'], hidingSpots: [spot] }, host);
    const r: Rig = { sys, host, graph, stage: 2, seed: 9, radius: visionRadius('easy', 2) };
    sys.placeForTest('g0', { room: graph.start, x: 800, y: 640, state: 'roaming' });
    sys.makeNoise({ room: graph.start, x: 640, y: 660, loud: 1.1, player: 'p0', name: 'P0', kind: 'drop' });
    for (let i = 0; i < 600 && catches.length < 2; i++) tick(r);
    expect(catches.sort()).toEqual(['p0', 'p1']);
  });
});
