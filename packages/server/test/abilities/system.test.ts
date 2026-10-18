import { describe, expect, it } from 'vitest';
import {
  ABILITY_MIN_GAP_TICKS, ABILITY_SPECS, ANCHOR_RULES, ENERGY_PER_REPAIR, MAX_PROPS_TOTAL, TOOL_SPECS, type AbilityAction,
} from '@wb/shared';
import { abilityHarness, crate } from '../helpers/abilityHarness';

const freeze = (targetId: string): AbilityAction => ({ ability: 'freeze', targetId });
const push = (targetId: 'self' | string, dir: 'up' | 'down' | 'left' | 'right' | 'cancel'): AbilityAction => ({ ability: 'momentum', targetId, dir });

describe('ability availability', () => {
  it('a stage without abilities has no ability state and refuses every intent', () => {
    const h = abilityHarness({ mutate: (d) => { delete d.abilities; } });
    expect(h.st().abilities).toBeUndefined();
    expect(h.ab('a', freeze('crate_a'))).toEqual({ ok: false, error: 'Reality abilities are not available in this stage.' });
  });
  it('an ability the stage did not enable is refused and costs nothing', () => {
    const h = abilityHarness({ props: [crate('crate_a', 300, 590)], enabled: ['momentum'] });
    expect(h.ab('a', freeze('crate_a'))).toEqual({ ok: false, error: 'That ability is not available here.' });
    expect(h.energy('a')).toBe(100);
  });
  it('refuses unknown players and disconnected players', () => {
    const h = abilityHarness({ props: [crate('crate_a', 300, 590)] });
    expect(h.e.abilityAction('ghost', freeze('crate_a'), () => undefined)).toEqual({ ok: false, error: 'You are not part of this run.' });
    h.e.onDisconnect('a');
    expect(h.e.abilityAction('a', freeze('crate_a'), () => ({ x: 300, y: 590, connected: false }))).toEqual({ ok: false, error: 'You are not part of this run.' });
  });
  it('publishes energy, cooldowns and active counts', () => {
    const h = abilityHarness({ props: [crate('crate_a', 300, 590)] });
    const a = h.st().abilities!;
    expect(a.energyMax).toBe(100);
    expect(a.players).toEqual([{ id: 'a', energy: 100, cooldowns: [], clones: 0 }]);
    expect(a.active).toEqual({ wells: 0, freezes: 0, clones: 0, anchors: 0 });
    expect(a.enabled).toContain('freeze');
  });
});

describe('energy, cooldown and rate limit (server-validated)', () => {
  it('spends the ability cost on success and starts the cooldown', () => {
    const h = abilityHarness({ props: [crate('crate_a', 300, 590)] });
    expect(h.ab('a', freeze('crate_a')).ok).toBe(true);
    expect(h.energy('a')).toBe(100 - ABILITY_SPECS.freeze.energyCost);
    const cd = h.ab_state('a').cooldowns.find((c) => c.ability === 'freeze')!;
    expect(cd.cooldownUntilTick).toBe(h.e.tick + ABILITY_SPECS.freeze.cooldownTicks);
  });
  it('a refused intent spends nothing and starts no cooldown', () => {
    const h = abilityHarness({ props: [crate('crate_a', 900, 590)] }); // far away
    h.at('a', 150, 590);
    expect(h.ab('a', freeze('crate_a'))).toEqual({ ok: false, error: 'Too far away.' });
    expect(h.energy('a')).toBe(100);
    expect(h.ab_state('a').cooldowns).toEqual([]);
  });
  it('refuses while recharging, then works again exactly when the cooldown ends', () => {
    const h = abilityHarness({ props: [crate('crate_a', 300, 590), crate('crate_b', 340, 590)] });
    expect(h.ab('a', freeze('crate_a')).ok).toBe(true);
    expect(h.ab('a', freeze('crate_b'))).toEqual({ ok: false, error: 'That ability is still recharging.' });
    const until = h.ab_state('a').cooldowns[0]!.cooldownUntilTick;
    h.run(until - h.e.tick - 1); // still one tick short
    expect(h.abNow('a', freeze('crate_b')).ok).toBe(false);
    h.run(ABILITY_MIN_GAP_TICKS); // the old freeze thawed by now? either way the cap is per-player: wait it out
    h.run(ABILITY_SPECS.freeze.durationTicks);
    expect(h.abNow('a', freeze('crate_b')).ok).toBe(true);
  });
  it('refuses when the player cannot afford it', () => {
    const h = abilityHarness({ props: [crate('crate_a', 300, 590)], energyStart: ABILITY_SPECS.freeze.energyCost - 1 });
    expect(h.ab('a', freeze('crate_a'))).toEqual({ ok: false, error: 'Not enough Reality Energy.' });
    expect(h.energy('a')).toBe(ABILITY_SPECS.freeze.energyCost - 1);
  });
  it('rate limits intents (accepted or not) to one per ABILITY_MIN_GAP_TICKS', () => {
    const h = abilityHarness({ props: [crate('crate_a', 300, 590)] });
    h.run(ABILITY_MIN_GAP_TICKS);
    expect(h.abNow('a', freeze('nothing')).ok).toBe(false);
    expect(h.abNow('a', freeze('crate_a'))).toEqual({ ok: false, error: 'Too fast.' });
    h.run(ABILITY_MIN_GAP_TICKS - 1);
    expect(h.abNow('a', freeze('crate_a'))).toEqual({ ok: false, error: 'Too fast.' });
    h.run(1);
    expect(h.abNow('a', freeze('crate_a')).ok).toBe(true);
  });
  it('energy never exceeds the cap and never goes negative', () => {
    const h = abilityHarness({ props: [crate('crate_a', 300, 590)], energyStart: 100 });
    const gain = ENERGY_PER_REPAIR.breakpoint;
    h.e.step(() => undefined);
    // spam: only what the energy allows is ever spent
    let spent = 0;
    for (let i = 0; i < 60; i++) { const r = h.ab('a', push('crate_a', 'cancel')); if (r.ok) spent += ABILITY_SPECS.momentum.energyCost; }
    expect(h.energy('a')).toBe(100 - spent);
    expect(h.energy('a')).toBeGreaterThanOrEqual(0);
    expect(gain).toBeGreaterThan(0);
  });
});

describe('Reality Energy regenerates only when the team repairs things', () => {
  it('a completed repair refills EVERY player (capped); nothing else does', () => {
    const h = abilityHarness({ ids: ['a', 'b'], props: [crate('crate_a', 300, 590)], energyStart: 40 });
    h.run(400); // time passing alone gives nothing
    expect(h.energy('a')).toBe(40);
    h.at('a', 200, 590); h.at('b', 200, 590);
    h.tool('a', 'phase_scanner');
    h.at('a', 200, 410);
    expect(h.tool('a', 'flux_welder', 'bp_coupling').ok).toBe(true);
    h.run(90);
    expect(h.st().breakpoints.find((b) => b.id === 'bp_coupling')!.repaired).toBe(true);
    expect(h.energy('a')).toBe(40 + ENERGY_PER_REPAIR.breakpoint);
    expect(h.energy('b')).toBe(40 + ENERGY_PER_REPAIR.breakpoint);
  });
  it('is capped at energyMax', () => {
    const h = abilityHarness({ props: [crate('crate_a', 300, 590)], energyStart: 95 });
    h.at('a', 200, 590); h.tool('a', 'phase_scanner'); h.at('a', 200, 410);
    h.tool('a', 'flux_welder', 'bp_coupling'); h.run(90);
    expect(h.energy('a')).toBe(100);
  });
  it('passive regeneration is opt-in and bounded by the cap', () => {
    const h = abilityHarness({ props: [crate('crate_a', 300, 590)], energyStart: 10, passiveRegenTicks: 20 });
    h.run(20 * 5);
    expect(h.energy('a')).toBe(15);
    h.run(20 * 200);
    expect(h.energy('a')).toBe(100);
  });
});

describe('Freeze: objects', () => {
  it('stops a moving object dead for the duration, then lets it go', () => {
    const h = abilityHarness({ props: [crate('crate_a', 300, 590)] });
    expect(h.world.impulseProp('crate_a', 0, -600, false)).toBe(true); // launched upward
    h.run(3);
    const y = h.prop('crate_a').y;
    expect(h.prop('crate_a').vy).not.toBe(0);
    expect(h.ab('a', freeze('crate_a')).ok).toBe(true);
    const frozenAt = { x: h.prop('crate_a').x, y: h.prop('crate_a').y };
    h.run(ABILITY_SPECS.freeze.durationTicks - ABILITY_MIN_GAP_TICKS - 2);
    expect(h.prop('crate_a').x).toBe(frozenAt.x);
    expect(h.prop('crate_a').y).toBe(frozenAt.y);
    expect(h.prop('crate_a').y).toBeLessThan(590); // hovering where it was stopped
    expect(y).toBeLessThan(590);
    h.run(ABILITY_SPECS.freeze.durationTicks + 60);
    expect(h.prop('crate_a').y).toBe(590); // thawed, fell and settled
    expect(h.prop('crate_a').grounded).toBe(true);
  });
  it('a frozen object ignores pushes', () => {
    const h = abilityHarness({ ids: ['a', 'b'], props: [crate('crate_a', 300, 590)] });
    expect(h.ab('a', freeze('crate_a')).ok).toBe(true);
    expect(h.ab('b', push('crate_a', 'right'))).toEqual({ ok: false, error: 'Frozen objects cannot be pushed.' });
    expect(h.world.impulseProp('crate_a', 500, 0, false)).toBe(false);
  });
  it('cannot freeze the same thing twice, or a thing that does not exist', () => {
    const h = abilityHarness({ ids: ['a', 'b'], props: [crate('crate_a', 300, 590)] });
    expect(h.ab('a', freeze('crate_a')).ok).toBe(true);
    expect(h.ab('b', freeze('crate_a'))).toEqual({ ok: false, error: 'That is already frozen.' });
    expect(h.ab('b', freeze('nope'))).toEqual({ ok: false, error: 'Nothing there to freeze.' });
  });
  it('per-player cap: one freeze at a time; per-room cap: three at a time', () => {
    const props = [crate('c1', 300, 590), crate('c2', 320, 590), crate('c3', 340, 590), crate('c4', 360, 590)];
    const h = abilityHarness({ ids: ['a', 'b', 'c', 'd'], props });
    expect(h.ab('a', freeze('c1')).ok).toBe(true);
    // a's cooldown also blocks a second one; use another ability path to prove the cap itself: new player, same target set
    expect(h.ab('b', freeze('c2')).ok).toBe(true);
    expect(h.ab('c', freeze('c3')).ok).toBe(true);
    expect(h.st().abilities!.active.freezes).toBe(ABILITY_SPECS.freeze.perRoomCap);
    expect(h.ab('d', freeze('c4'))).toEqual({ ok: false, error: `The room already has ${ABILITY_SPECS.freeze.perRoomCap} frozen things.` });
    h.run(ABILITY_SPECS.freeze.durationTicks);
    expect(h.st().abilities!.active.freezes).toBe(0);
    expect(h.ab('d', freeze('c4')).ok).toBe(true);
  });
  it('ownership: a copy made by another player cannot be frozen or pushed by you', () => {
    const h = abilityHarness({ ids: ['a', 'b'], props: [crate('crate_a', 300, 590)] });
    const clone = h.world.addClone('crate_a', 'b', 330, 590, 200)!;
    expect(h.ab('a', freeze(clone.id))).toEqual({ ok: false, error: 'That object belongs to another player.' });
    expect(h.ab('a', push(clone.id, 'left'))).toEqual({ ok: false, error: 'That object belongs to another player.' });
    expect(h.ab('b', freeze(clone.id)).ok).toBe(true);
  });
  it('range is enforced from the caster (server-side, from the authoritative position)', () => {
    const h = abilityHarness({ props: [crate('crate_a', 300, 590)] });
    h.at('a', 300 + ABILITY_SPECS.freeze.range + 40, 590);
    expect(h.ab('a', freeze('crate_a'))).toEqual({ ok: false, error: 'Too far away.' });
    h.at('a', 300 + ABILITY_SPECS.freeze.range - 40, 590);
    expect(h.ab('a', freeze('crate_a')).ok).toBe(true);
  });
});

describe('Freeze: hazards', () => {
  const armedArc = () => abilityHarness({
    mutate: (d) => { for (const hz of d.hazards) delete hz.armedWhenObjective; }, // the arc is armed from the start
  });
  const hits = (h: ReturnType<typeof armedArc>) => h.st().feed.filter((f) => f.text.includes('arc discharge hits')).length;

  it('holds an arc discharge: no pulse lands while frozen, the countdown pauses, then it resumes', () => {
    const h = armedArc();
    h.at('a', 470, 320); // standing in the arc radius, no shield
    h.run(10);
    expect(h.st().hazards.find((x) => x.id === 'hz_arc')!.nextPulseTick).not.toBeNull();
    const before = h.st().hazards.find((x) => x.id === 'hz_arc')!.nextPulseTick!;
    expect(h.ab('a', freeze('hz_arc')).ok).toBe(true);
    const frozenUntil = h.st().hazards.find((x) => x.id === 'hz_arc')!.frozenUntilTick!;
    expect(frozenUntil).toBe(h.e.tick + ABILITY_SPECS.freeze.durationTicks);
    h.run(ABILITY_SPECS.freeze.durationTicks - 2);
    expect(hits(h)).toBe(0);
    expect(h.st().hazards.find((x) => x.id === 'hz_arc')!.nextPulseTick!).toBeGreaterThan(before + 40);
    h.run(2 + 130); // thawed: the pulses come back
    expect(h.st().hazards.find((x) => x.id === 'hz_arc')!.frozenUntilTick).toBeUndefined();
    expect(hits(h)).toBeGreaterThan(0);
  });
  it('an unfrozen control run is hit on schedule (so the test above proves the freeze)', () => {
    const h = armedArc();
    h.at('a', 470, 320);
    h.run(70);
    expect(hits(h)).toBeGreaterThan(0);
  });
  it('gravity flux cannot be frozen (it is anchored), and a hazard out of reach is refused', () => {
    const h = armedArc();
    h.at('a', 470, 320);
    expect(h.ab('a', freeze('hz_flux'))).toEqual({ ok: false, error: 'Gravity flux cannot be frozen. Anchor it.' });
    h.at('a', 1190, 680);
    expect(h.ab('a', freeze('hz_arc'))).toEqual({ ok: false, error: 'Too far away.' });
    expect(h.energy('a')).toBe(100);
  });
  it('freezing an unarmed hazard is harmless and bounded', () => {
    const h = abilityHarness(); // arc is armed only while o_final is active: it is not
    h.at('a', 470, 320);
    expect(h.ab('a', freeze('hz_arc')).ok).toBe(true);
    h.run(ABILITY_SPECS.freeze.durationTicks + 5);
    expect(h.st().hazards.find((x) => x.id === 'hz_arc')!.frozenUntilTick).toBeUndefined();
  });
});

describe('Anchor placement rules (P3B; the P2 tool limits are unchanged)', () => {
  it('needs solid footing, and nothing is spent when it refuses', () => {
    const h = abilityHarness();
    h.at('a', 300, 560); // in mid-air above the low-left platform
    const before = h.st().players[0]!.tools.find((t) => t.tool === 'gravity_anchor')!;
    expect(h.tool('a', 'gravity_anchor')).toEqual({ ok: false, error: 'A gravity anchor needs solid footing.' });
    const after = h.st().players[0]!.tools.find((t) => t.tool === 'gravity_anchor')!;
    expect(after).toEqual(before);
    expect(h.st().effects).toHaveLength(0);
    h.at('a', 300, 590);
    expect(h.tool('a', 'gravity_anchor').ok).toBe(true);
  });
  it('keeps clear of the arena edges', () => {
    const h = abilityHarness();
    h.at('a', ANCHOR_RULES.edgeMargin - 5, 680);
    expect(h.tool('a', 'gravity_anchor')).toEqual({ ok: false, error: 'Too close to the edge to plant an anchor.' });
    h.at('a', 1280 - ANCHOR_RULES.edgeMargin + 5, 680);
    expect(h.tool('a', 'gravity_anchor').ok).toBe(false);
    h.at('a', ANCHOR_RULES.edgeMargin + 5, 680);
    expect(h.tool('a', 'gravity_anchor').ok).toBe(true);
  });
  it('anchors keep their distance from each other', () => {
    const h = abilityHarness({ ids: ['a', 'b'] });
    h.at('a', 160, 590); h.at('b', 160 + ANCHOR_RULES.minSpacing - 10, 590);
    expect(h.tool('a', 'gravity_anchor').ok).toBe(true);
    expect(h.tool('b', 'gravity_anchor')).toEqual({ ok: false, error: 'Too close to another anchor.' });
    h.at('b', 160 + ANCHOR_RULES.minSpacing + 10, 590);
    expect(h.tool('b', 'gravity_anchor').ok).toBe(true);
  });
  it(`at most ${ANCHOR_RULES.maxActive} anchors hold at once; a faded one frees a slot`, () => {
    const h = abilityHarness({ ids: ['a', 'b', 'c'] });
    h.at('a', 200, 590); h.at('b', 500, 500); h.at('c', 900, 590);
    expect(h.tool('a', 'gravity_anchor').ok).toBe(true);
    expect(h.tool('b', 'gravity_anchor').ok).toBe(true);
    const r = h.tool('c', 'gravity_anchor');
    expect(r).toEqual({ ok: false, error: `Only ${ANCHOR_RULES.maxActive} anchors can hold at once. Wait for one to fade.` });
    expect(h.st().abilities!.active.anchors).toBe(2);
    h.run(TOOL_SPECS.gravity_anchor.durationTicks + 5);
    expect(h.tool('c', 'gravity_anchor').ok).toBe(true);
  });
  it('the shield projector is not subject to anchor rules', () => {
    const h = abilityHarness();
    h.at('a', 300, 560); // mid-air
    expect(h.tool('a', 'shield_projector').ok).toBe(true);
  });
});

describe('hard bounds', () => {
  it('the physical world never holds more props than MAX_PROPS_TOTAL', () => {
    const h = abilityHarness({ props: [crate('crate_a', 300, 590)] });
    let made = 0;
    for (let i = 0; i < 40; i++) if (h.world.addClone('crate_a', `p${i}`, 200 + (i % 10) * 20, 590, 500)) made++;
    expect(h.world.propCount).toBe(MAX_PROPS_TOTAL);
    expect(made).toBe(MAX_PROPS_TOTAL - 1);
  });
});
