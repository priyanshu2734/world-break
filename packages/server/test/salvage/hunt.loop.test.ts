import { describe, expect, it, vi } from 'vitest';
import { ARENA } from '@wb/shared';
import { Room, RoomManager } from '../../src/room';
import { getStageDef } from '../../src/systems/registry';
import { HUNT_STAGE_ID } from '../../src/systems/stages/hunt';
import { TUTORIAL_STAGE } from '../../src/systems/tutorial';
import { validateStageDef } from '../../src/systems/validate';
import { Lockstep } from '../helpers/bot';
import { solveStage } from '../helpers/planner';
import { solveHunt } from '../helpers/huntPlan';

vi.setConfig({ testTimeout: 90_000 });

function huntRoom(n: number, hunt = true) {
  const room = new Room('ABCD', 2, undefined, { hunt });
  const ids = Array.from({ length: n }, (_, i) => `p${i}`);
  ids.forEach((id, i) => room.join(id, `P${i}`));
  ids.slice(1).forEach((id) => room.setReady(id, true));
  expect(room.start('p0').ok).toBe(true);
  const sim = new Lockstep(room);
  while (room.phase !== 'playing') sim.tick();
  return { room, sim };
}

describe('the opt-in hunt option', () => {
  it('a room without the option still plays the tutorial as stage 1 (default behaviour is unchanged)', () => {
    const { room, sim } = huntRoom(1, false);
    expect(room.stageRecord?.defId).toBe(TUTORIAL_STAGE.id);
    expect(sim.state().items).toBeUndefined();
  });

  it('a room with the option plays the hunt, and publishes items only once a stage has them', () => {
    const { room, sim } = huntRoom(1);
    expect(room.stageRecord?.defId).toBe(HUNT_STAGE_ID);
    const items = sim.state().items!;
    expect(items.items.map((i) => i.id).sort()).toEqual(['battery_a', 'coil_cracked', 'fuse_a']); // the real coil is hidden
    expect(JSON.stringify(sim.state())).not.toContain('coil_real');
    expect(JSON.stringify(sim.state())).not.toContain('"decoy"'); // the flag is never published (the tutorial's decoy_panel entity is a different thing)
  });

  it('RoomManager passes the option to every room it creates, and an explicit option wins', () => {
    const on = new RoomManager({ huntStage: true });
    expect(on.create().stage).toBe(1);
    const a = on.create(), b = on.create({ hunt: false });
    for (const r of [a, b]) { r.join('p', 'P'); r.start('p'); }
    for (let i = 0; i < 5; i++) { a.tick(); b.tick(); }
    expect(a.stageRecord?.defId).toBe(HUNT_STAGE_ID);
    expect(b.stageRecord?.defId).toBe(TUTORIAL_STAGE.id);
    const off = new RoomManager({});
    const c = off.create();
    c.join('p', 'P'); c.start('p');
    for (let i = 0; i < 5; i++) c.tick();
    expect(c.stageRecord?.defId).toBe(TUTORIAL_STAGE.id);
  });
});

describe('the endless loop still works after the hunt', () => {
  it('clearing stage 1 loads a generated stage 2 that validates and plays, then stage 3 after it', () => {
    const { room, sim } = huntRoom(2);
    solveHunt(sim, 'p0');
    expect(room.phase).toBe('stage_complete');
    expect(room.nextStage('p0')).toEqual({ ok: true });
    expect(room.stage).toBe(2);
    while (room.phase !== 'playing') sim.tick();
    const rec = room.stageRecord!;
    expect(rec.defId).not.toBe(HUNT_STAGE_ID);
    expect(rec.stage).toBe(2);
    const def = getStageDef(2, rec.seed);
    expect(def.id).toBe(rec.defId);
    expect(validateStageDef(def, ARENA)).toEqual([]);
    expect(sim.state().items).toBeUndefined(); // no stale parts leak into the next stage
    // and it is genuinely playable: one player clears it, which opens stage 3
    solveStage(sim, 'p0', def);
    expect(room.phase).toBe('stage_complete');
    expect(room.nextStage('p0')).toEqual({ ok: true });
    expect(room.stage).toBe(3);
    while (room.phase !== 'playing') sim.tick();
    expect(room.stageRecord!.stage).toBe(3);
    expect(room.highestStage).toBe(3);
  });

  it('a restarted hunt after a lobby reset starts clean: nothing carried, nothing installed', () => {
    const { room, sim } = huntRoom(1);
    solveHunt(sim, 'p0');
    expect(room.nextStage('p0').ok).toBe(true);
    expect(room.stage).toBe(2);
    const fresh = huntRoom(1);
    const items = fresh.sim.state().items!;
    expect(items.items.every((i) => i.state === 'in_world')).toBe(true);
    expect(items.players.every((p) => p.carried.length === 0)).toBe(true);
  });
});
