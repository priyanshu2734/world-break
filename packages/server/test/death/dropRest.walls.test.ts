import { describe, expect, it } from 'vitest';
import type { Arena } from '@wb/shared';
import { Room } from '../../src/room';
import type { GameSim } from '../../src/game';
import { dropRest, piecesOf, reachablePieces, reachablePlatforms } from '../../src/salvage/dropRest';
import { generateEscapeStage } from '../../src/rooms/generate';

/**
 * P3F step 1: `dropRest` knows walls and gates. The hand-made room is the gate room of stages 1 and 2 in miniature: one floor, and a wall from floor to ceiling across it
 * (the gate). A part is NEVER left on, in or beyond a closed gate's wall, whatever the point it is released at.
 */
const GATE: Arena = {
  id: 'gate', name: 'gate', width: 1920, height: 720,
  solids: [{ x: 0, y: 680, w: 1920, h: 40 }, { x: 1380, y: 0, w: 40, h: 680 }],
  spawns: [300, 350, 400, 450].map((x) => ({ x, y: 680 })),
};
/** A floor with a crate (90 px) on it: crossing it is a jump, and the part may rest on either side or on top. */
const CRATE: Arena = {
  id: 'crate', name: 'crate', width: 1600, height: 720,
  solids: [{ x: 0, y: 680, w: 1600, h: 40 }, { x: 900, y: 590, w: 120, h: 90 }],
  spawns: [300, 350, 400, 450].map((x) => ({ x, y: 680 })),
};

describe('P3F step 1: dropRest and walls', () => {
  it('a floor with a wall across it is two floors: only the spawn side is reachable (the plain platform set still says the whole floor)', () => {
    const { arena: a, parent } = piecesOf(GATE);
    const floors = a.solids.map((s, i) => ({ s, i })).filter(({ i }) => parent[i] === 0);
    expect(floors.length).toBe(2);
    const reach = reachablePieces(GATE);
    const reached = floors.filter(({ i }) => reach.has(i));
    expect(reached.length).toBe(1);
    expect(reached[0]!.s.x).toBe(0);
    expect(reachablePlatforms(GATE).has(0)).toBe(true);
  });

  it('a release anywhere left of the gate rests left of it, and nothing released in the wall, above the wall or in the air beside it ever lands beyond it', () => {
    let relocated = 0;
    for (let x = 0; x <= 1380; x += 17) for (const y of [-200, 0, 100, 300, 500, 679]) {
      const r = dropRest(GATE, x, y);
      expect(r.x, `(${x},${y})`).toBeLessThanOrEqual(1380);
      expect(r.y).toBe(680);
      if (r.relocated) relocated++;
    }
    for (let x = 1381; x <= 1419; x += 5) for (const y of [-200, 0, 100, 300, 500, 679]) {
      const r = dropRest(GATE, x, y);
      expect(r.x, `inside the wall (${x},${y})`).toBeLessThanOrEqual(1380);
      expect(r.y).toBe(680);
      if (y < 679) expect(r.relocated).toBe(true);
    }
  });

  it('a point inside the wall goes to the near side (the spawn side), clear of the wall (the piece stops 15 px short of it, the item keeps 14 px off the edge of the piece)', () => {
    const r = dropRest(GATE, 1400, 300);
    expect(r).toEqual({ x: 1351, y: 680, relocated: true });
  });

  it('a dropper who stands in the alcove behind an OPEN gate keeps what they drop there; one standing before the gate is unchanged', () => {
    expect(dropRest(GATE, 1500, 680)).toEqual({ x: 1500, y: 680, relocated: false });
    expect(dropRest(GATE, 1000, 680)).toEqual({ x: 1000, y: 680, relocated: false });
    // mid-air over the alcove is the same (only someone in the alcove can be there); mid-air over the WALL is not, and goes back to the near side
    expect(dropRest(GATE, 1500, 300)).toEqual({ x: 1500, y: 680, relocated: false });
    expect(dropRest(GATE, 1400, -100).x).toBeLessThanOrEqual(1380);
  });

  it('a crate is a thing to climb, not a wall: parts rest on both sides of it and on its top; one released inside it is moved out', () => {
    expect(dropRest(CRATE, 500, 400)).toEqual({ x: 500, y: 680, relocated: false });
    expect(dropRest(CRATE, 1300, 400)).toEqual({ x: 1300, y: 680, relocated: false });
    expect(dropRest(CRATE, 960, 400)).toEqual({ x: 960, y: 590, relocated: false });
    const inside = dropRest(CRATE, 960, 640);
    expect(inside.relocated).toBe(true);
    expect(inside.x < 900 || inside.x > 1020 || inside.y === 590).toBe(true);
  });

  it('is deterministic and keeps every earlier answer for rooms without walls', () => {
    for (let i = 0; i < 3; i++) expect(dropRest(GATE, 1400, 300)).toEqual(dropRest(GATE, 1400, 300));
  });
});

describe('P3F step 1: a dropped mandatory part can never cross a closed door (generated stages)', () => {
  it('stages 1 and 2, many seeds: whatever the release point on the near side of the gate, the part rests on the near side', () => {
    for (const stage of [1, 2]) for (let seed = 1; seed <= 6; seed++) {
      const def = generateEscapeStage(stage, seed, { ghost: true, difficulty: 'easy' });
      const room = def.rooms!.rooms[0]!;
      const gate = room.doors.find((d) => d.id.endsWith('_gi'))!;
      for (let x = 0; x < gate.x + 40; x += 23) for (const y of [0, 250, 500, 679]) {
        const r = dropRest(room.arena, x, y);
        // gate.x + 40 is the wall's own left face
        expect(r.x, `stage ${stage} seed ${seed} (${x},${y})`).toBeLessThanOrEqual(gate.x + 40);
      }
    }
  });

  it('through a real Room: the gate\'s own key is picked up, its carrier disconnects beside the wall, and the key is left on the near side', () => {
    for (const stage of [2]) { // (stage 1 hides its key in a locker; stage 2 leaves it lying at seed 9)
      const r = new Room('WALL', 2, 9, { escape: true, ghost: true, startStage: stage });
      r.join('p0', 'P0'); r.join('p1', 'P1'); r.setReady('p1', true);
      expect(r.start('p0').ok).toBe(true);
      for (let i = 0; i < 10 && r.phase !== 'playing'; i++) r.tick();
      const sim = (r as unknown as { sim: GameSim }).sim;
      const key = r.peekStageState()!.items!.items.find((i) => i.kind === 'access_key')!;
      sim.placeAt('p0', key.x, 680);
      for (let i = 0; i < 25; i++) r.tick();
      expect(r.itemAction('p0', { action: 'pickup', itemId: key.id }).ok).toBe(true);
      for (let i = 0; i < 15; i++) r.tick();
      sim.placeAt('p0', 1366, 680); // right beside the wall of the gate, on the near side
      for (let i = 0; i < 5; i++) r.tick();
      r.disconnect('p0');
      for (let i = 0; i < 5; i++) r.tick();
      const k = r.peekStageState()!.items!.items.find((i) => i.id === key.id)!;
      expect(k.state).toBe('in_world');
      expect(k.x, `stage ${stage}`).toBeLessThanOrEqual(1380);
    }
  });
});
