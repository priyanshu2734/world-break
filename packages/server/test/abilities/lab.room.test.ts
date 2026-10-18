import { describe, expect, it } from 'vitest';
import { ABILITY_LAB_ARENA, ARENA, GameSnapshotSchema } from '@wb/shared';
import { Room } from '../../src/room';
import { getStageDef } from '../../src/systems/registry';
import { ABILITY_LAB_STAGE, ABILITY_LAB_STAGE_ID } from '../../src/systems/stages/abilityLab';
import { DEFAULT_ABILITY_CONFIG } from '../../src/abilities/defaults';
import { labRoom, playLab } from '../helpers/labBot';

const start = (lab: boolean, n = 1) => {
  const r = new Room('ROOM', 2, 7, { lab });
  for (let i = 0; i < n; i++) r.join(`p${i}`, `P${i}`);
  for (let i = 1; i < n; i++) r.setReady(`p${i}`, true);
  expect(r.start('p0').ok).toBe(true);
  for (let i = 0; i < 20 && r.phase !== 'playing'; i++) r.tick();
  return r;
};

describe('the Ability Lab is NOT in the endless rotation', () => {
  it('the stage registry never returns it: not for stages 1..80, not for many seeds', () => {
    for (let stage = 1; stage <= 80; stage++) for (const seed of [1, 7, 99, 12345, 0x7fffffff]) {
      expect(getStageDef(stage, seed).id).not.toBe(ABILITY_LAB_STAGE_ID);
    }
  });
  it('a normal room plays the tutorial first, on Relay Platform 01, and advertises no lab', () => {
    const r = start(false);
    expect(r.isLab).toBe(false);
    expect(r.snapshot().lab).toBeUndefined();
    expect(r.stageRecord!.defId).toBe('tutorial_cold_start');
    expect(r.gameSnapshot()!.arenaId).toBe(ARENA.id);
  });
  it('a rotation stage 2 never turns into the Lab, whatever the room', () => {
    for (const lab of [false, true]) {
      const r = lab ? playLab(1).room : (() => { const x = start(false); (x as unknown as { phase: string }).phase = 'stage_complete'; return x; })();
      expect(r.nextStage('p0').ok).toBe(true);
      expect(r.stageRecord!.defId).not.toBe(ABILITY_LAB_STAGE_ID);
      expect(r.stage).toBe(2);
    }
  });
});

describe('a Lab room', () => {
  it('plays the Lab as stage 1 on the Lab arena with its crates, abilities and spawns', () => {
    const r = start(true, 2);
    expect(r.isLab).toBe(true);
    expect(r.snapshot().lab).toBe(true);
    expect(r.stageRecord!.defId).toBe(ABILITY_LAB_STAGE_ID);
    const g = r.gameSnapshot()!;
    expect(GameSnapshotSchema.safeParse(g).success).toBe(true);
    expect(g.arenaId).toBe(ABILITY_LAB_ARENA.id);
    expect(g.players.map((p) => [p.x, p.y])).toEqual(ABILITY_LAB_ARENA.spawns.slice(0, 2).map((s) => [s.x, s.y]));
    expect(g.world!.props.map((p) => p.id).sort()).toEqual(['crate_d', 'crate_m']);
    const st = r.peekStageState()!;
    expect(st.name).toBe(ABILITY_LAB_STAGE.name);
    expect(st.abilities!.enabled).toEqual(ABILITY_LAB_STAGE.abilities!.enabled);
    expect(st.entities.filter((e) => e.kind === 'pressure_plate')).toHaveLength(4);
  });
  it('after the Lab, "next stage" goes back to the normal game: normal arena, spawns, defaults, no leftover props', () => {
    const { room } = playLab(1);
    expect(room.phase).toBe('stage_complete');
    expect(room.nextStage('p0').ok).toBe(true);
    for (let i = 0; i < 20 && room.phase !== 'playing'; i++) room.tick();
    const g = room.gameSnapshot()!;
    expect(g.arenaId).toBe(ARENA.id);
    expect(g.players[0]!.x).toBe(ARENA.spawns[0]!.x);
    expect(g.world).toBeUndefined(); // no props, zones or impulses carried over
    expect(room.peekStageState()!.abilities!.enabled).toEqual(DEFAULT_ABILITY_CONFIG.enabled);
    expect(room.peekStageState()!.abilities!.players[0]!.energy).toBe(100);
  });
  it('resetting the arena in the Lab restores the Lab: arena, crates, energy, objectives', () => {
    const { room } = labRoom(1);
    room.abilityAction('p0', { ability: 'momentum', targetId: 'self', dir: 'up' });
    for (let i = 0; i < 10; i++) room.tick();
    expect(room.peekStageState()!.abilities!.players[0]!.energy).toBe(80);
    expect(room.resetArena('p0').ok).toBe(true);
    const g = room.gameSnapshot()!;
    expect(g.arenaId).toBe(ABILITY_LAB_ARENA.id);
    expect(g.world!.props.map((p) => [p.id, p.x, p.y]).sort()).toEqual([['crate_d', 880, 590], ['crate_m', 360, 400]]);
    expect(g.world!.impulses).toEqual([]);
    expect(room.peekStageState()!.abilities!.players[0]!.energy).toBe(100);
    expect(g.players[0]!.x).toBe(ABILITY_LAB_ARENA.spawns[0]!.x);
  });
  it('resetting a Lab room that has already gone back to normal stages keeps the normal arena', () => {
    const { room } = playLab(1);
    room.nextStage('p0');
    for (let i = 0; i < 20 && room.phase !== 'playing'; i++) room.tick();
    expect(room.resetArena('p0').ok).toBe(true);
    expect(room.gameSnapshot()!.arenaId).toBe(ARENA.id);
  });
});
