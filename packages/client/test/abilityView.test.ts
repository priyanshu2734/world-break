import { describe, expect, it } from 'vitest';
import { ABILITY_SPECS, SERVER_TICK_HZ, type Prop, type StageState } from '@wb/shared';
import { abilitySlots, buildAbilityAction, clampToRange, energyView, type AimContext } from '../src/ui/abilityView';

const stage = (over: Partial<StageState> = {}): StageState => ({
  rev: 1, stageId: 't', name: 't', status: 'running', tick: 100, deadlineTick: 999, expired: false,
  score: { total: 0, breakdown: {} }, objectives: [], symptoms: [], breakpoints: [], entities: [], effects: [], channels: [], clues: [], feed: [],
  power: { capacity: 1, load: 0, nodes: [], conduits: [] }, hazards: [],
  players: [{ id: 'me', tools: [{ tool: 'gravity_anchor', charges: 2, maxCharges: 2, cooldownUntilTick: 0 }] }],
  abilities: {
    enabled: ['anchor', 'gravity_well', 'freeze', 'duplicate', 'momentum'], energyMax: 100,
    players: [{ id: 'me', energy: 60, cooldowns: [{ ability: 'freeze', cooldownUntilTick: 100 + 2 * SERVER_TICK_HZ }], clones: 0 }],
    active: { wells: 0, freezes: 0, clones: 0, anchors: 0 },
  },
  ...over,
});
const crate = (id: string, x: number, y: number, over: Partial<Prop> = {}): Prop => ({
  id, kind: 'crate', x, y, vx: 0, vy: 0, w: 32, h: 32, grounded: true, frozenUntilTick: 0, ownerId: null, cloneOf: null, expiresTick: null, light: true, ...over,
});
const aim = (over: Partial<AimContext> = {}): AimContext => ({
  me: { x: 300, y: 590, facing: 1 }, pointer: null, props: [], hazards: [],
  dir: { up: false, down: false, left: false, right: false }, modifier: false, ...over,
});

describe('energy and slots', () => {
  it('shows nothing for stages without abilities', () => {
    expect(abilitySlots(stage({ abilities: undefined }), 'me', 100)).toEqual([]);
    expect(energyView(stage({ abilities: undefined }), 'me')).toBeNull();
  });
  it('reports energy as a fraction of the cap', () => {
    expect(energyView(stage(), 'me')).toEqual({ energy: 60, max: 100, fraction: 0.6 });
    expect(energyView(stage(), 'someone-else')).toBeNull();
  });
  it('derives ready / cooldown / no_energy / empty per slot from public state', () => {
    const slots = abilitySlots(stage(), 'me', 100);
    const by = Object.fromEntries(slots.map((s) => [s.ability, s]));
    expect(slots.map((s) => s.key)).toEqual(['3', '6', '7', '8', '9']);
    expect(by.freeze).toMatchObject({ status: 'cooldown', cooldownSeconds: 2 });
    expect(by.gravity_well!.status).toBe('ready');
    expect(by.anchor).toMatchObject({ status: 'ready', detail: '2/2' });
    const poor = stage(); poor.abilities!.players[0]!.energy = ABILITY_SPECS.duplicate.energyCost - 1;
    expect(abilitySlots(poor, 'me', 100).find((s) => s.ability === 'duplicate')!.status).toBe('no_energy');
    const empty = stage({ players: [{ id: 'me', tools: [{ tool: 'gravity_anchor', charges: 0, maxCharges: 2, cooldownUntilTick: 0 }] }] });
    expect(abilitySlots(empty, 'me', 100).find((s) => s.ability === 'anchor')!.status).toBe('empty');
  });
  it('marks abilities the stage did not enable as unavailable', () => {
    const st = stage(); st.abilities!.enabled = ['momentum'];
    expect(abilitySlots(st, 'me', 100).filter((s) => s.status === 'unavailable').map((s) => s.ability)).toEqual(['anchor', 'gravity_well', 'freeze', 'duplicate']);
  });
});

describe('aiming (convenience only; the server re-validates)', () => {
  it('clampToRange pulls far points inside the range and leaves near ones alone', () => {
    expect(clampToRange({ x: 0, y: 0 }, { x: 10, y: 0 }, 100)).toEqual({ x: 10, y: 0 });
    const p = clampToRange({ x: 0, y: 0 }, { x: 1000, y: 0 }, 100);
    expect(p.x).toBeLessThan(100); expect(p.y).toBe(0);
  });
  it('gravity well: flips by default, reduces with the modifier, aims at the pointer within range', () => {
    const near = buildAbilityAction('gravity_well', aim({ pointer: { x: 400, y: 560 } }));
    expect(near).toEqual({ ok: true, action: { ability: 'gravity_well', x: 400, y: 560, mode: 'flip' } });
    const far = buildAbilityAction('gravity_well', aim({ pointer: { x: 5000, y: 570 }, modifier: true }));
    expect(far.ok && far.action.ability === 'gravity_well' && far.action.mode).toBe('reduce');
    expect(far.ok && far.action.ability === 'gravity_well' && far.action.x).toBeLessThan(300 + ABILITY_SPECS.gravity_well.range);
  });
  it('freeze: picks the nearest freezable thing in reach, never gravity flux', () => {
    const st = stage();
    st.hazards = [{ id: 'flux', kind: 'gravity_flux', label: 'f', x: 310, y: 570, r: 100, armed: false, stabilized: false, nextPulseTick: null }];
    expect(buildAbilityAction('freeze', aim({ hazards: st.hazards }))).toEqual({ ok: false, reason: 'Nothing to freeze nearby.' });
    const r = buildAbilityAction('freeze', aim({ hazards: st.hazards, props: [crate('c1', 340, 590), crate('c2', 500, 590)] }));
    expect(r).toEqual({ ok: true, action: { ability: 'freeze', targetId: 'c1' } });
  });
  it('duplicate: needs a light, original object in reach', () => {
    expect(buildAbilityAction('duplicate', aim({ props: [crate('h', 330, 590, { light: false }), crate('k', 330, 590, { cloneOf: 'x', light: false })] })))
      .toEqual({ ok: false, reason: 'No light object in reach to duplicate.' });
    const r = buildAbilityAction('duplicate', aim({ props: [crate('c', 330, 590)] }));
    expect(r.ok && r.action.ability === 'duplicate' && r.action.targetId).toBe('c');
  });
  it('momentum: targets self by default, a pointed prop when there is one; direction from keys, shift cancels', () => {
    expect(buildAbilityAction('momentum', aim())).toEqual({ ok: true, action: { ability: 'momentum', targetId: 'self', dir: 'right' } });
    expect(buildAbilityAction('momentum', aim({ dir: { up: true, down: false, left: false, right: false } })))
      .toEqual({ ok: true, action: { ability: 'momentum', targetId: 'self', dir: 'up' } });
    expect(buildAbilityAction('momentum', aim({ me: { x: 300, y: 590, facing: -1 } }))).toMatchObject({ action: { dir: 'left' } });
    expect(buildAbilityAction('momentum', aim({ props: [crate('c', 340, 590)], pointer: { x: 341, y: 575 }, modifier: true })))
      .toEqual({ ok: true, action: { ability: 'momentum', targetId: 'c', dir: 'cancel' } });
  });
});
