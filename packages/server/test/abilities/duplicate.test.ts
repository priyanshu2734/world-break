import { describe, expect, it } from 'vitest';
import { ABILITY_SPECS, MAX_PROPS_TOTAL, PLATE_HALF_W, type AbilityAction } from '@wb/shared';
import { labHarness } from '../helpers/labHarness';

const dup = (targetId: string, x: number, y: number): AbilityAction => ({ ability: 'duplicate', targetId, x, y });
const push = (targetId: string, dir: 'left' | 'right' | 'up' | 'down' | 'cancel'): AbilityAction => ({ ability: 'momentum', targetId, dir });

describe('Duplicate: bounded copies', () => {
  it('makes a copy where you point; it falls, rests on the platform, is owned by you, and costs energy', () => {
    const h = labHarness();
    h.at('a', 950, 590);
    expect(h.ab('a', dup('crate_d', 1000, 520)).ok).toBe(true);
    const clone = h.world.listProps().find((p) => p.cloneOf === 'crate_d')!;
    expect(clone).toBeDefined();
    expect(clone.ownerId).toBe('a'); expect(clone.light).toBe(false);
    expect(h.energy('a')).toBe(100 - ABILITY_SPECS.duplicate.energyCost);
    h.run(30);
    expect(h.prop(clone.id).y).toBe(590); expect(h.prop(clone.id).grounded).toBe(true);
    expect(h.st().abilities!.players[0]!.clones).toBe(1);
    expect(h.st().abilities!.active.clones).toBe(1);
  });
  it('a copy expires after its lifetime and disappears from the world', () => {
    const h = labHarness();
    h.at('a', 950, 590);
    h.ab('a', dup('crate_d', 1000, 570));
    h.run(ABILITY_SPECS.duplicate.durationTicks - 6);
    expect(h.world.cloneCount).toBe(1);
    h.run(10);
    expect(h.world.cloneCount).toBe(0);
    expect(h.st().abilities!.active.clones).toBe(0);
    expect(h.world.propCount).toBe(2); // only the authored crates remain
  });
  it('a copy cannot be copied, and heavy things cannot be copied', () => {
    const h = labHarness(['a', 'b']);
    h.at('a', 950, 590); h.at('b', 950, 590);
    h.ab('a', dup('crate_d', 1000, 570));
    const clone = h.world.listProps().find((p) => p.cloneOf)!;
    expect(h.ab('b', dup(clone.id, 1020, 570))).toEqual({ ok: false, error: 'A copy cannot be copied.' });
    const heavy = labHarness();
    heavy.world.reset([{ id: 'crate_d', kind: 'crate', x: 880, y: 590, light: false }]); // an authored HEAVY crate
    heavy.at('a', 950, 590);
    expect(heavy.ab('a', dup('crate_d', 1000, 570))).toEqual({ ok: false, error: 'That object is too heavy to duplicate.' });
    expect(heavy.energy('a')).toBe(100);
  });
  it('range: both the source and the placement point must be within reach of the caster', () => {
    const h = labHarness();
    h.at('a', 950, 590);
    expect(h.ab('a', dup('crate_d', 950 + ABILITY_SPECS.duplicate.range + 20, 570))).toEqual({ ok: false, error: 'Too far away to place a copy there.' });
    h.at('a', 880 + ABILITY_SPECS.duplicate.range + 20, 590); // too far from the crate
    expect(h.ab('a', dup('crate_d', 1000, 570))).toEqual({ ok: false, error: 'Too far away.' });
    expect(h.energy('a')).toBe(100);
    expect(h.world.cloneCount).toBe(0);
  });
  it('placement: not inside a solid, not outside the arena', () => {
    const h = labHarness();
    h.at('a', 950, 590);
    expect(h.ab('a', dup('crate_d', 1000, 600))).toEqual({ ok: false, error: 'There is no room to place a copy there.' }); // inside D1
    expect(h.ab('a', dup('crate_d', 1300, 570))).toMatchObject({ ok: false });
    expect(h.world.cloneCount).toBe(0);
    expect(h.energy('a')).toBe(100);
  });
  it('per-player cap (2 copies) and room cap (4) are enforced', () => {
    const h = labHarness(['a', 'b', 'c']);
    h.at('a', 950, 590);
    h.world.addClone('crate_d', 'a', 900, 590, 400); h.world.addClone('crate_d', 'a', 920, 590, 400);
    expect(h.ab('a', dup('crate_d', 1000, 570))).toEqual({ ok: false, error: `You already have ${ABILITY_SPECS.duplicate.perPlayerCap} copies.` });
    h.at('b', 950, 590);
    h.world.addClone('crate_d', 'c', 940, 590, 400); h.world.addClone('crate_d', 'c', 960, 590, 400);
    expect(h.world.cloneCount).toBe(ABILITY_SPECS.duplicate.perRoomCap);
    expect(h.ab('b', dup('crate_d', 1000, 570))).toEqual({ ok: false, error: 'Too many copies exist right now.' });
  });
  it('cooldown and energy gate it like every ability; copies expire so the cap frees up', () => {
    const h = labHarness();
    h.at('a', 950, 590);
    expect(h.ab('a', dup('crate_d', 1000, 570)).ok).toBe(true);
    expect(h.ab('a', dup('crate_d', 1020, 570))).toEqual({ ok: false, error: 'That ability is still recharging.' });
    h.run(ABILITY_SPECS.duplicate.cooldownTicks);
    expect(h.ab('a', dup('crate_d', 1020, 570)).ok).toBe(true);
    expect(h.world.clonesOf('a')).toBe(2);
    h.run(ABILITY_SPECS.duplicate.durationTicks + 2);
    expect(h.world.clonesOf('a')).toBe(0);
  });
  it('the world never holds more than MAX_PROPS_TOTAL props, whatever is asked', () => {
    const h = labHarness(['a', 'b', 'c', 'd']);
    for (const id of ['a', 'b', 'c', 'd']) h.at(id, 950, 590);
    for (let i = 0; i < 400; i++) {
      for (const id of ['a', 'b', 'c', 'd']) h.ab(id, dup('crate_d', 900 + (i % 12) * 15, 570));
      expect(h.world.propCount).toBeLessThanOrEqual(MAX_PROPS_TOTAL);
      expect(h.world.cloneCount).toBeLessThanOrEqual(ABILITY_SPECS.duplicate.perRoomCap);
    }
  });
});

describe('pressure plates', () => {
  it('a light plate is pressed by a player standing on it, and released when they step off', () => {
    const h = labHarness();
    h.at('a', 1080 + PLATE_HALF_W + 6, 140);
    h.run(2); expect(h.plate('plate_well')).toBe('idle');
    h.at('a', 1080, 140); h.run(1);
    expect(h.obj('o_well')).toBe('complete'); // single plate, armTicks 1: pressed this tick
    expect(h.plate('plate_well')).toBe('complete');
  });
  it('passing through the plate height in mid-air does not press it', () => {
    const h = labHarness();
    h.at('a', 1080, 120); h.run(3);
    expect(h.obj('o_well')).toBe('active');
  });
  it('a HEAVY plate ignores players entirely', () => {
    const h = labHarness();
    h.at('a', 1060, 590); h.run(3);
    expect(h.plate('plate_d2')).toBe('idle');
    expect(h.obj('o_dup')).toBe('active');
    expect(h.tool('a', 'phase_scanner').ok).toBe(true);
    expect(h.act('a', { kind: 'interact', targetId: 'plate_d2' })).toEqual({ ok: false, error: 'Too light to trigger it. It needs something heavy resting on it.' });
  });
  it('every plate that the abilities must serve is HEAVY (objects only); only the ledge plate answers to players', () => {
    const h = labHarness();
    const kinds = Object.fromEntries(h.def.entities.filter((e) => e.kind === 'pressure_plate').map((e) => [e.id, (e as { activatedBy: string }).activatedBy]));
    expect(kinds).toEqual({ plate_well: 'any', plate_m: 'object', plate_d1: 'object', plate_d2: 'object' });
  });
  it('a player standing on the island plate does not press it (Momentum cannot be replaced by walking or jumping over)', () => {
    const h = labHarness();
    h.at('a', 32, 600); h.run(5);
    expect(h.plate('plate_m')).toBe('idle');
    expect(h.obj('o_momentum')).toBe('active');
  });
  it('a resting crate presses a heavy plate; the authored crate_d already presses plate_d1', () => {
    const h = labHarness();
    h.run(3);
    expect(h.plate('plate_d1')).toBe('pressed');
    expect(h.plate('plate_d2')).toBe('idle');
  });
  it('a crate flying over a plate does not press it (it must be resting)', () => {
    const h = labHarness();
    h.world.reset([{ id: 'crate_d', kind: 'crate', x: 1060, y: 520, light: true }]); // above plate_d2, falling
    h.at('a', 950, 590);
    h.run(1);
    expect(h.plate('plate_d2')).toBe('idle');
    h.run(25);
    expect(h.plate('plate_d2')).toBe('pressed'); // landed
  });
  it('o_dup needs BOTH plates at the same moment: moving the only crate never does it', () => {
    const h = labHarness();
    h.at('a', 950, 590);
    h.run(3);
    expect(h.ab('a', push('crate_d', 'right')).ok).toBe(true);
    h.run(80);
    expect(h.plate('plate_d1')).toBe('idle'); // the crate left plate 1...
    expect(h.obj('o_dup')).toBe('active'); // ...so the objective cannot complete with one crate
  });
  it('a copy on plate 2 completes it, and the objective stays complete after the copy expires', () => {
    const h = labHarness();
    h.at('a', 950, 590);
    expect(h.ab('a', dup('crate_d', 1060, 570)).ok).toBe(true);
    h.run(30);
    expect(h.obj('o_dup')).toBe('complete');
    h.run(ABILITY_SPECS.duplicate.durationTicks + 10);
    expect(h.world.cloneCount).toBe(0);
    expect(h.obj('o_dup')).toBe('complete'); // latched
    expect(h.plate('plate_d2')).toBe('complete');
  });
  it('the thrown crate lands on the island, slides to the wall and presses the island plate', () => {
    const h = labHarness();
    h.at('a', 420, 400);
    expect(h.ab('a', push('crate_m', 'left')).ok).toBe(true);
    h.run(80);
    expect(h.prop('crate_m').x).toBe(16);
    expect(h.prop('crate_m').y).toBe(600);
    expect(h.obj('o_momentum')).toBe('complete');
  });
  it('pushing the crate any other way never presses the island plate', () => {
    for (const dir of ['right', 'up', 'down', 'cancel'] as const) {
      const h = labHarness();
      h.at('a', 420, 400);
      h.ab('a', push('crate_m', dir));
      h.run(400);
      expect(h.obj('o_momentum')).toBe('active');
    }
  });
});
