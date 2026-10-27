import { describe, expect, it } from 'vitest';
import { GHOST_CUE, GhostCueSchema, cueBand } from '@wb/shared';
import { Room } from '../../src/room';
import { puppet, rig, run, tick } from './harness';

const MINUTE = 20 * 60;

/** One room (stage 2: floor, a wall at x 1380), a listener on the floor, one ghost placed by hand at distance dx on the same floor. */
function cueRig(dx: number, listenerX = 300) {
  const r = rig({ stage: 2, seed: 7, players: (g) => [puppet('p0', g.start, listenerX, 680, { hidden: true })] });
  r.sys.placeForTest('g0', { room: r.graph.start, x: listenerX + dx, y: 658, angle: 0 });
  const p = r.host.puppets[0]!;
  return { r, p, cue: () => r.sys.cueFor(p.roomId, p.x, p.y) };
}

describe('P3E ghost cues: what a player can hear', () => {
  it('buckets by distance and gives left or right, for a ghost the listener cannot see', () => {
    for (const [dx, band] of [[120, 1], [-240, 1], [400, 2], [-480, 2], [700, 3], [790, 3]] as const) {
      const { cue } = cueRig(dx, 900);
      const c = cue();
      expect(c.sounds.length, `dx ${dx}`).toBe(1);
      expect(c.sounds[0]!.band).toBe(band);
      expect(c.sounds[0]!.dir).toBe(dx < 0 ? -1 : 1);
    }
  });
  it('out of earshot (beyond the last bucket) a ghost makes no sound for the listener', () => {
    const { cue } = cueRig(GHOST_CUE.bands[2] + 80, 300);
    expect(cue().sounds).toEqual([]);
    expect(cueBand(GHOST_CUE.bands[2] + 80)).toBe(0);
  });
  it('through walls: a ghost on the other side of the gate wall is heard though it is not in view', () => {
    // listener at 1200, ghost in the alcove at 1500: the wall (x 1380 to 1420) is between them; the view would never show it
    const { cue } = cueRig(300, 1200);
    expect(cue().sounds.length).toBe(1);
    expect(cue().sounds[0]!.band).toBe(2);
  });
  it('a ghost in another room is not heard, and a listener outside every room hears no ghost', () => {
    const r = rig({ stage: 3, seed: 7, players: (g) => [puppet('p0', g.start, 300)] });
    const [r0, r1] = r.graph.rooms;
    r.sys.placeForTest('g0', { room: r1!.id, x: 400, y: 640 });
    expect(r.sys.cueFor(r0!.id, 300, 680).sounds).toEqual([]);
    expect(r.sys.cueFor(r1!.id, 300, 680).sounds.length).toBe(1);
    expect(r.sys.cueFor(null, 300, 680).sounds).toEqual([]);
  });
  it('a cue is valid protocol data and never carries a position', () => {
    const { cue } = cueRig(300);
    const c = { tick: 5, ...cue() };
    expect(GhostCueSchema.safeParse(c).success).toBe(true);
    const json = JSON.stringify(c);
    expect(json).not.toMatch(/"(x|y)":/);
    expect(Object.keys(c.sounds[0]!).sort()).toEqual(['band', 'dir', 'id', 'kind', 'moving', 'state']);
  });
  it('the sound reports the state: roaming, hunting, stunned (a stunned ghost does not move)', () => {
    const { r, cue } = cueRig(300);
    expect(cue().sounds[0]!.state).toBe('roaming');
    r.sys.stun('g0', 'p0');
    tick(r);
    expect(cue().sounds[0]!.state).toBe('stunned');
    expect(cue().sounds[0]!.moving).toBe(false);
  });
  it('a moving ghost is reported as moving, a searching or waiting one is not', () => {
    const r = rig({ stage: 2, seed: 3, players: (g) => [puppet('p0', g.start, 300, 680, { hidden: true })] });
    r.sys.placeForTest('g0', { room: r.graph.start, x: 900, y: 640 });
    const p = r.host.puppets[0]!;
    let moving = 0, still = 0;
    run(r, 3000, () => { const s = r.sys.cueFor(p.roomId, p.x, p.y).sounds[0]; if (s) { if (s.moving) moving++; else still++; } });
    expect(moving).toBeGreaterThan(50);
    expect(still).toBeGreaterThan(5); // it stops to look around
  });
});

describe('P3E ghost cues: the warning is heard by everyone', () => {
  it('during a WARNING every listener gets warning = true, in any room, and no sound (the ghost is not there yet)', () => {
    const r = rig({ stage: 3, seed: 5, players: (g) => [puppet('p0', g.start, 300), puppet('p1', g.rooms[1]!.id, 400)] });
    let warned = 0;
    run(r, 20 * MINUTE, () => {
      const w = r.sys.warning;
      const states = r.sys.snapshotActors().map((a) => a.state);
      expect(w).toBe(states.includes('warning'));
      for (const p of r.host.puppets) {
        const c = r.sys.cueFor(p.roomId, p.x, p.y);
        expect(c.warning).toBe(w);
        if (w) { warned++; expect(c.sounds).toEqual([]); }
      }
    });
    expect(warned).toBeGreaterThan(100);
  });
});

describe('P3E ghost cues through the Room', () => {
  const mk = (stage: number, ghost: boolean) => {
    const r = new Room('CUE1', 3, 7, { escape: true, ghost, startStage: stage });
    r.join('p0', 'P0');
    r.start('p0');
    for (let i = 0; i < 10 && r.phase !== 'playing'; i++) r.tick();
    return r;
  };
  it('no cue on stage 1 or without the ghost option', () => {
    expect(mk(1, true).ghostCue('p0')).toBeNull();
    expect(mk(2, false).ghostCue('p0')).toBeNull();
  });
  it('a cue on stage 2 is valid protocol data, carries the room tick, and hears a ghost the snapshot does not show', () => {
    const r = mk(2, true);
    const me = r.gameSnapshot()!.players[0]!;
    r.ghostSystem!.placeForTest('g0', { room: me.roomId!, x: me.x + 600, y: 640 }); // far enough to be out of vision (460) but within earshot (800)
    const c = r.ghostCue('p0')!;
    expect(GhostCueSchema.safeParse(c).success).toBe(true);
    expect(c.sounds[0]).toMatchObject({ band: 3, dir: 1, kind: 'wisp' });
    expect(r.viewFor('p0')!.snapshot.ghosts).toBeUndefined(); // not seen ...
    expect(c.tick).toBe(r.gameSnapshot()!.tick);              // ... but heard
  });
});
