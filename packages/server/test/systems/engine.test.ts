import { describe, expect, it } from 'vitest';
import { StageStateSchema, TOOL_SPECS } from '@wb/shared';
import { cloneStage, harness } from '../helpers/stage';

describe('hidden breakpoints and the Phase Scanner', () => {
  it('hidden breakpoints are absent from public state (not merely flagged)', () => {
    const json = JSON.stringify(harness().st());
    expect(harness().st().breakpoints).toEqual([]);
    for (const secret of ['bp_coupling', 'f_coupling', 'Cracked flux coupling']) expect(json).not.toContain(secret);
  });
  it('the welder cannot target a hidden breakpoint, and the refusal is identical to "nothing there"', () => {
    const h = harness();
    h.at('a', 200, 410); // standing right on it
    const hidden = h.tool('a', 'flux_welder', 'bp_coupling');
    const nothing = h.tool('a', 'flux_welder', 'no_such_target');
    expect(hidden).toEqual({ ok: false, error: 'Nothing there to repair.' });
    expect(hidden).toEqual(nothing); // no oracle for unrevealed targets
    expect(h.tools('a').find((t) => t.tool === 'flux_welder')!.charges).toBe(3); // nothing was spent
    expect(h.st().channels).toEqual([]);
  });
  it('scanning in range reveals the breakpoint and nearby clues for the whole team', () => {
    const h = harness({ ids: ['a', 'b'] });
    h.at('a', 200, 590);
    const r = h.tool('a', 'phase_scanner');
    expect(r.ok && r.message).toMatch(/Found/);
    const s = h.st();
    expect(s.breakpoints.map((b) => b.id)).toEqual(['bp_coupling']);
    expect(s.clues.map((c) => c.id)).toContain('clue_coupling');
    // shared state: it is the same public state every player receives
    expect(StageStateSchema.parse(s)).toEqual(s);
  });
  it('scanning out of range finds nothing but still spends a charge', () => {
    const h = harness();
    h.at('a', 90, 680); // 291px from the breakpoint, scanner radius is 260
    const r = h.tool('a', 'phase_scanner');
    expect(r).toEqual({ ok: true, message: 'Nothing unusual in range.' });
    expect(h.st().breakpoints).toEqual([]);
    expect(h.tools('a').find((t) => t.tool === 'phase_scanner')!.charges).toBe(TOOL_SPECS.phase_scanner.maxCharges - 1);
  });
  it('only reveals breakpoints that are eligible (scanRequires objectives)', () => {
    const def = cloneStage();
    def.breakpoints[0]!.scanRequires = ['o_power'];
    const h = harness({ def });
    h.at('a', 200, 590);
    h.tool('a', 'phase_scanner');
    expect(h.st().breakpoints).toEqual([]); // in range, but not yet eligible
    h.routePower(); // completes o_power
    h.at('a', 200, 590); h.run(60); h.tool('a', 'phase_scanner');
    expect(h.st().breakpoints.map((b) => b.id)).toEqual(['bp_coupling']);
  });
});

describe('tool validation: ownership, charges, cooldown, range, compatibility', () => {
  it('refuses a tool the player does not carry', () => {
    const def = cloneStage();
    def.hazards = def.hazards.filter((x) => x.kind !== 'arc_discharge'); // no hazard needs the shield here
    def.loadout = def.loadout.filter((t) => t !== 'shield_projector');
    const h = harness({ def });
    expect(h.tool('a', 'shield_projector')).toEqual({ ok: false, error: 'You are not carrying that tool.' });
  });
  it("tools are per player: one player's charges do not affect another's", () => {
    const h = harness({ ids: ['a', 'b'] });
    h.at('a', 200, 590); h.at('b', 200, 590);
    h.tool('a', 'phase_scanner');
    expect(h.tools('a').find((t) => t.tool === 'phase_scanner')!.charges).toBe(4);
    expect(h.tools('b').find((t) => t.tool === 'phase_scanner')!.charges).toBe(5);
  });
  it('enforces cooldowns', () => {
    const h = harness();
    h.at('a', 200, 590);
    expect(h.tool('a', 'phase_scanner').ok).toBe(true);
    expect(h.tool('a', 'phase_scanner')).toEqual({ ok: false, error: 'That tool is still recharging.' });
    h.run(TOOL_SPECS.phase_scanner.cooldownTicks);
    expect(h.tool('a', 'phase_scanner').ok).toBe(true);
  });
  it('runs out of charges, and the supply cache restores them at a score cost', () => {
    const h = harness();
    h.at('a', 760, 500);
    for (let i = 0; i < 3; i++) { expect(h.tool('a', 'flux_welder', 'flicker_panel').ok).toBe(true); h.act('a', { kind: 'cancel' }); h.run(25); }
    expect(h.tool('a', 'flux_welder', 'flicker_panel')).toEqual({ ok: false, error: 'That tool is out of charges. Visit the supply cache.' });
    h.at('a', 640, 680);
    expect(h.use('a', 'cache').ok).toBe(true);
    expect(h.tools('a').find((t) => t.tool === 'flux_welder')!.charges).toBe(3);
    expect(h.st().score.breakdown.resupply).toBe(-50);
    expect(h.use('a', 'cache')).toMatchObject({ ok: false }); // already full / cooling down
  });
  it('rejects out-of-range targets without spending a charge', () => {
    const h = harness();
    h.at('a', 300, 500);
    expect(h.tool('a', 'flux_welder', 'flicker_panel')).toEqual({ ok: false, error: 'Too far away.' });
    h.at('a', 760, 590); // right x, wrong deck (90px below)
    expect(h.tool('a', 'flux_welder', 'flicker_panel')).toEqual({ ok: false, error: 'Too far away.' });
    expect(h.tools('a').find((t) => t.tool === 'flux_welder')!.charges).toBe(3);
  });
  it('Flux Welder: refuses unsupported connections and non-repairable things', () => {
    const h = harness();
    h.at('a', 855, 590);
    expect(h.tool('a', 'flux_welder', 'c_gp')).toEqual({ ok: false, error: 'That connection is too far gone to weld. Route power around it.' });
    expect(h.tool('a', 'flux_welder', 'c_gj')).toEqual({ ok: false, error: 'That connection is not damaged.' });
    h.at('a', 990, 590);
    expect(h.tool('a', 'flux_welder', 'sw_1')).toEqual({ ok: false, error: 'The welder has no use on that.' });
    expect(h.tool('a', 'flux_welder', 'gen')).toEqual({ ok: false, error: 'The welder has no use on that.' });
    expect(h.tool('a', 'flux_welder')).toEqual({ ok: false, error: 'Choose something to weld.' });
    expect(h.tools('a').find((t) => t.tool === 'flux_welder')!.charges).toBe(3);
  });
  it('Power Cell: only feeds an unpowered consumer', () => {
    const h = harness();
    h.at('a', 900, 590);
    expect(h.tool('a', 'power_cell', 'gen')).toEqual({ ok: false, error: 'A Power Cell can only feed a consumer.' });
    expect(h.tool('a', 'power_cell', 'c_gj')).toEqual({ ok: false, error: 'A Power Cell can only feed a consumer.' });
    expect(h.tool('a', 'power_cell')).toEqual({ ok: false, error: 'Choose a system to power.' });
    h.at('a', 810, 320);
    expect(h.tool('a', 'power_cell', 'pump').ok).toBe(true);
    expect(h.tool('a', 'power_cell', 'pump').ok).toBe(false); // cooldown
    h.run(100);
    expect(h.tool('a', 'power_cell', 'pump')).toEqual({ ok: false, error: 'That system already has power.' });
  });
  it('Gravity Anchor stabilises gravity flux but not arc discharge; Shield Projector the reverse', () => {
    const h = harness();
    h.at('a', 470, 320);
    h.tool('a', 'gravity_anchor');
    let hz = h.st().hazards;
    expect(hz.find((x) => x.id === 'hz_flux')!.stabilized).toBe(true);
    expect(hz.find((x) => x.id === 'hz_arc')!.stabilized).toBe(false);
    h.tool('a', 'shield_projector');
    hz = h.st().hazards;
    expect(hz.find((x) => x.id === 'hz_flux')!.stabilized).toBe(true);
    expect(h.st().effects.map((e) => e.tool).sort()).toEqual(['gravity_anchor', 'shield_projector']);
  });
  it('an anchor deployed away from the hazard does not stabilise it', () => {
    const h = harness();
    h.at('a', 200, 590);
    h.tool('a', 'gravity_anchor');
    expect(h.st().hazards.find((x) => x.id === 'hz_flux')!.stabilized).toBe(false);
  });
  it('effects expire', () => {
    const h = harness();
    h.at('a', 470, 320);
    h.tool('a', 'gravity_anchor');
    h.run(TOOL_SPECS.gravity_anchor.durationTicks + 5);
    expect(h.st().effects).toEqual([]);
    expect(h.st().hazards.find((x) => x.id === 'hz_flux')!.stabilized).toBe(false);
  });
  it('rate-limits actions per player', () => {
    const h = harness();
    h.at('a', 200, 590);
    h.run(10);
    expect(h.actNow('a', { kind: 'interact', targetId: 'lock_a' })).toMatchObject({ ok: false }); // locked, but consumed the slot
    expect(h.actNow('a', { kind: 'interact', targetId: 'lock_a' })).toEqual({ ok: false, error: 'Too fast.' });
  });
  it('rejects unknown players and disconnected players', () => {
    const h = harness();
    expect(h.e.action('ghost', { kind: 'cancel' }, () => undefined)).toEqual({ ok: false, error: 'You are not part of this run.' });
    h.drop('a');
    expect(h.tool('a', 'phase_scanner')).toEqual({ ok: false, error: 'You are not part of this run.' });
  });
});

describe('repair channels: progress, cooperation, interruption', () => {
  const revealed = () => { const h = harness({ ids: ['a', 'b'] }); h.at('a', 200, 590); h.tool('a', 'phase_scanner'); h.at('a', 200, 410); h.at('b', 200, 410); return h; };

  it('a solo repair takes exactly repairTicks and then clears its symptoms', () => {
    const h = revealed();
    h.tool('a', 'flux_welder', 'bp_coupling');
    h.run(70);
    expect(h.st().breakpoints[0]!.repaired).toBe(false);
    expect(h.st().breakpoints[0]!.progress).toBeGreaterThan(0.8);
    h.run(15);
    expect(h.st().breakpoints[0]!.repaired).toBe(true);
    expect(h.obj('o_root')).toBe('complete');
  });
  it('two welders finish in about half the time (cooperation is faster, never required)', () => {
    const h = revealed();
    h.tool('a', 'flux_welder', 'bp_coupling');
    h.tool('b', 'flux_welder', 'bp_coupling');
    h.run(45);
    expect(h.st().breakpoints[0]!.repaired).toBe(true);
  });
  it('moving out of reach interrupts the channel but keeps partial progress', () => {
    const h = revealed();
    h.tool('a', 'flux_welder', 'bp_coupling');
    h.run(30);
    h.at('a', 600, 410); h.run(2);
    expect(h.st().channels).toEqual([]);
    const kept = h.st().breakpoints[0]!.progress;
    expect(kept).toBeGreaterThan(0.3);
    expect(h.st().feed.at(-1)!.text).toMatch(/out of reach/);
    // resume (costs another charge) and finish with only the remaining work
    h.at('a', 200, 410); h.run(25); h.tool('a', 'flux_welder', 'bp_coupling');
    expect(h.tools('a').find((t) => t.tool === 'flux_welder')!.charges).toBe(1);
    h.run(55);
    expect(h.st().breakpoints[0]!.repaired).toBe(true);
  });
  it('cancelling keeps progress; disconnecting interrupts', () => {
    const h = revealed();
    h.tool('a', 'flux_welder', 'bp_coupling'); h.run(20);
    expect(h.act('a', { kind: 'cancel' })).toMatchObject({ ok: true });
    expect(h.st().channels).toEqual([]);
    expect(h.act('a', { kind: 'cancel' })).toEqual({ ok: false, error: 'Nothing to cancel.' });
    h.run(25); h.tool('a', 'flux_welder', 'bp_coupling'); h.run(5);
    h.drop('a'); h.run(2);
    expect(h.st().channels).toEqual([]);
    expect(h.st().breakpoints[0]!.repaired).toBe(false);
  });
  it('a busy player cannot start a second task', () => {
    const h = revealed();
    h.tool('a', 'flux_welder', 'bp_coupling');
    h.run(25); // past the welder cooldown, still channelling in place
    expect(h.st().channels).toHaveLength(1);
    expect(h.tool('a', 'flux_welder', 'bp_coupling')).toEqual({ ok: false, error: 'Finish or cancel your current task first.' });
    expect(h.tools('a').find((t) => t.tool === 'flux_welder')!.charges).toBe(2); // the refused attempt cost nothing
  });
});

describe('wrong targets and temporary relief do not solve the stage', () => {
  it('welding the decoy panel mitigates the flicker for a while, then it relapses; the root stays broken', () => {
    const h = harness();
    h.at('a', 760, 500);
    expect(h.tool('a', 'flux_welder', 'flicker_panel').ok).toBe(true);
    h.run(45);
    expect(h.sym('s_flicker')).toBe('mitigated');
    expect(h.st().symptoms.find((s) => s.id === 's_flicker')!.mitigatedUntilTick).not.toBeNull();
    expect(h.sym('s_drift')).toBe('active'); // unrelated symptom untouched
    expect(h.obj('o_root')).toBe('active');
    expect(h.st().breakpoints).toEqual([]);
    expect(h.st().score.breakdown.wrong_target).toBe(-25);
    h.run(800);
    expect(h.sym('s_flicker')).toBe('active'); // relapse
    expect(h.st().feed.some((f) => /is back/.test(f.text))).toBe(true);
  });
  it('interacting with the wrong objects never completes an objective', () => {
    const h = harness();
    h.at('a', 760, 500); h.use('a', 'flicker_panel');
    h.at('a', 640, 680); h.use('a', 'cache');
    h.at('a', 200, 590); h.use('a', 'lock_a'); h.use('a', 'core');
    for (const o of ['o_root', 'o_power', 'o_sync', 'o_final']) expect(h.obj(o)).not.toBe('complete');
    expect(h.st().status).toBe('running');
  });
});

describe('failure chain across the stage', () => {
  it('repairing the root clears only its symptoms; pressure stays until the pump also has grid power', () => {
    const h = harness();
    h.fixRoot();
    expect(h.sym('s_flicker')).toBe('resolved');
    expect(h.sym('s_drift')).toBe('resolved');
    expect(h.sym('s_pressure')).toBe('active'); // still caused by the unpowered pump
    expect(h.sym('s_coolant')).toBe('active');
    h.routePower();
    expect(h.sym('s_pressure')).toBe('resolved');
    expect(h.sym('s_coolant')).toBe('resolved');
  });
  it('powering the pump first leaves the root-caused symptoms alone', () => {
    const h = harness();
    h.routePower();
    expect(h.sym('s_coolant')).toBe('resolved');
    expect(h.sym('s_pressure')).toBe('active'); // root cause still there
    expect(h.sym('s_flicker')).toBe('active');
  });
});

describe('pattern: reroute power through valid connections', () => {
  it('the direct pump feed is melted, so nothing is powered until a valid route is closed', () => {
    const h = harness();
    expect(h.st().power.nodes.find((n) => n.id === 'pump')!.powered).toBe(false);
    h.at('a', 990, 590); h.use('a', 'sw_1');
    expect(h.st().power.nodes.find((n) => n.id === 'pump')!.powered).toBe(false); // junction live, pump not yet
  });
  it('a valid route powers the pump, holds, completes the objective, and seals the breakers', () => {
    const h = harness();
    h.routePower();
    expect(h.st().power.nodes.find((n) => n.id === 'pump')).toMatchObject({ powered: true, source: 'grid' });
    expect(h.obj('o_power')).toBe('complete');
    expect(h.use('a', 'sw_2')).toBeDefined();
    h.at('a', 1080, 590);
    expect(h.use('a', 'sw_2')).toEqual({ ok: false, error: 'That breaker is sealed.' });
    expect(h.ent('sw_2').state).toBe('sealed');
  });
  it('overloading the generator trips every breaker and costs score', () => {
    const h = harness();
    h.at('a', 990, 590); h.use('a', 'sw_1');
    h.at('a', 1080, 590); h.use('a', 'sw_2');
    h.at('a', 1050, 410);
    const r = h.use('a', 'sw_3'); // fan too: two consumers on a capacity-1 generator
    expect(r).toMatchObject({ ok: true, message: expect.stringMatching(/Overload/) });
    expect(h.st().power.load).toBe(0);
    for (const id of ['sw_1', 'sw_2', 'sw_3', 'sw_4']) expect(h.ent(id).state).toBe('open');
    expect(h.st().score.breakdown.overload).toBe(-100);
    expect(h.obj('o_power')).toBe('active');
  });
  it('powering only the decoy consumer does not complete the objective', () => {
    const h = harness();
    h.at('a', 1050, 680); h.use('a', 'sw_4');
    h.run(100);
    expect(h.st().power.nodes.find((n) => n.id === 'fan')!.powered).toBe(true);
    expect(h.obj('o_power')).toBe('active');
  });
  it('a Power Cell on the pump mitigates the coolant alarm temporarily without completing the route', () => {
    const h = harness();
    h.at('a', 810, 320);
    expect(h.tool('a', 'power_cell', 'pump').ok).toBe(true);
    expect(h.sym('s_coolant')).toBe('mitigated');
    expect(h.st().power.nodes.find((n) => n.id === 'pump')).toMatchObject({ powered: true, source: 'cell' });
    h.run(300);
    expect(h.obj('o_power')).toBe('active'); // cell power is not grid power
    h.run(320);
    expect(h.sym('s_coolant')).toBe('active'); // relapse after the cell runs dry
  });
  it('a break in the route stops the hold timer, so only a sustained route counts', () => {
    const h = harness();
    h.at('a', 990, 590); h.use('a', 'sw_1');
    h.at('a', 1080, 590); h.use('a', 'sw_2'); h.run(20);
    h.use('a', 'sw_2'); // open again before 40 ticks
    h.run(60);
    expect(h.obj('o_power')).toBe('active');
  });
});

describe('pattern: coordinate a timed repair across multiple controls', () => {
  it('is locked, with a diagnostic hint, until the root cause is repaired', () => {
    const h = harness();
    h.at('a', 200, 590);
    expect(h.obj('o_sync')).toBe('locked');
    expect(h.use('a', 'lock_a')).toEqual({ ok: false, error: 'The phase lock cannot hold: the drift is still feeding it noise.' });
  });
  it('arming one control is not enough: it slips out of phase', () => {
    const h = harness();
    h.fixRoot();
    h.at('a', 200, 590); h.use('a', 'lock_a');
    expect(h.ent('lock_a').state).toBe('armed');
    h.run(305);
    expect(h.ent('lock_a').state).toBe('idle');
    expect(h.obj('o_sync')).toBe('active');
    expect(h.st().feed.some((f) => /slipped out of phase/.test(f.text))).toBe(true);
  });
  it('arming all three inside the window completes the objective', () => {
    const h = harness();
    h.fixRoot(); h.sync();
    expect(h.obj('o_sync')).toBe('complete');
    h.at('a', 200, 590);
    expect(h.use('a', 'lock_a')).toEqual({ ok: false, error: 'Already done.' });
  });
  it('arming too slowly (first lock lapses before the last is armed) does not count', () => {
    const h = harness();
    h.fixRoot();
    h.at('a', 200, 590); h.use('a', 'lock_a'); h.run(200);
    h.at('a', 520, 500); h.use('a', 'lock_b'); h.run(200);
    h.at('a', 1200, 680); h.use('a', 'lock_c');
    expect(h.obj('o_sync')).toBe('active');
  });
  it('three players can arm at once; a single player manages it within the same window', () => {
    const h = harness({ ids: ['a', 'b', 'c'] });
    h.fixRoot('a');
    h.at('a', 200, 590); h.at('b', 520, 500); h.at('c', 1200, 680);
    h.use('a', 'lock_a');
    h.use('b', 'lock_b');
    h.use('c', 'lock_c');
    h.run(1);
    expect(h.obj('o_sync')).toBe('complete');
  });
});

describe('final stabilisation objective', () => {
  const ready = () => { const h = harness(); h.fixRoot(); h.routePower(); h.sync(); return h; };

  it('is locked until all prerequisites are complete', () => {
    const h = harness();
    h.at('a', 470, 320);
    expect(h.use('a', 'core')).toEqual({ ok: false, error: 'The console refuses: other systems are still failing.' });
    h.fixRoot(); h.at('a', 470, 320);
    expect(h.use('a', 'core')).toMatchObject({ ok: false });
    expect(h.obj('o_final')).toBe('locked');
  });
  it('arc discharge is dormant until the final objective is active', () => {
    const h = harness();
    expect(h.st().hazards.find((x) => x.id === 'hz_arc')).toMatchObject({ armed: false, nextPulseTick: null });
    const r = ready();
    r.run(1); // the pulse schedule is created on the tick after the objective activates
    expect(r.st().hazards.find((x) => x.id === 'hz_arc')!.armed).toBe(true);
    expect(r.st().hazards.find((x) => x.id === 'hz_arc')!.nextPulseTick).not.toBeNull();
  });
  it('needs power: the console is dead without a Power Cell', () => {
    const h = ready(); h.at('a', 470, 320);
    expect(h.ent('core').state).toBe('dead');
    expect(h.use('a', 'core')).toEqual({ ok: false, error: 'The console is dead. It has no power feed.' });
  });
  it('needs gravity stabilised: refuses to start under unstable gravity', () => {
    const h = ready(); h.at('a', 470, 320);
    h.tool('a', 'power_cell', 'core_feed');
    expect(h.use('a', 'core')).toEqual({ ok: false, error: 'Gravity is too unstable to hold the console.' });
  });
  it('an unshielded channel is broken by arc discharge, setting progress back', () => {
    const h = ready(); h.prepCore('a', false);
    expect(h.use('a', 'core').ok).toBe(true);
    h.run(60); // the first pulse lands inside the channel window
    expect(h.st().channels).toEqual([]);
    expect(h.obj('o_final')).toBe('active');
    expect(h.st().score.breakdown.hazard).toBe(-75);
    expect(h.st().feed.some((f) => /set back/.test(f.text))).toBe(true);
  });
  it('the anchor expiring mid-channel throws the player off', () => {
    const h = ready(); h.at('a', 470, 320);
    h.tool('a', 'gravity_anchor');
    h.run(TOOL_SPECS.gravity_anchor.durationTicks - 40);
    h.tool('a', 'power_cell', 'core_feed'); h.tool('a', 'shield_projector');
    expect(h.use('a', 'core').ok).toBe(true);
    h.run(60);
    expect(h.st().channels).toEqual([]);
    expect(h.st().feed.some((f) => /destabilises/.test(f.text))).toBe(true);
    expect(h.obj('o_final')).toBe('active');
  });
  it('anchor + power cell + shield lets one player finish; the stage stabilises with a time bonus', () => {
    const h = ready(); h.prepCore();
    expect(h.use('a', 'core').ok).toBe(true);
    h.run(110);
    const s = h.st();
    expect(s.status).toBe('stabilized');
    expect(s.objectives.every((o) => o.status === 'complete')).toBe(true);
    expect(s.score.breakdown.time).toBeGreaterThan(0);
    expect(s.score.breakdown.objective).toBe(200 + 200 + 250 + 400);
    expect(s.score.total).toBeGreaterThan(1000);
    expect(h.tool('a', 'phase_scanner')).toEqual({ ok: false, error: 'This stage is already stabilised.' });
  });
  it('two players channel together and finish faster', () => {
    const h = harness({ ids: ['a', 'b'] }); h.fixRoot('a'); h.routePower('a'); h.sync('a');
    h.prepCore('a'); h.at('b', 470, 320);
    h.use('a', 'core'); h.use('b', 'core');
    h.run(55);
    expect(h.st().status).toBe('stabilized');
  });
});

describe('timers, scoring and state publication', () => {
  it('overrunning the deadline costs score but does not end or break the stage', () => {
    const def = cloneStage(); def.deadlineTicks = 100;
    const h = harness({ def });
    h.run(99);
    expect(h.st().expired).toBe(false);
    h.run(2);
    expect(h.st().expired).toBe(true);
    expect(h.st().score.breakdown.overrun).toBe(-200);
    h.run(40);
    expect(h.st().score.breakdown.overrun).toBeLessThan(-200); // continuing drain
    expect(h.st().status).toBe('running');
    expect(h.st().score.total).toBeGreaterThanOrEqual(0);
  });
  it('finishing faster earns a larger time bonus', () => {
    const quick = harness(); quick.fixRoot(); quick.routePower(); quick.sync(); quick.prepCore(); quick.use('a', 'core'); quick.run(110);
    const slow = harness(); slow.run(3000); slow.fixRoot(); slow.routePower(); slow.sync(); slow.prepCore(); slow.use('a', 'core'); slow.run(110);
    expect(quick.st().score.breakdown.time!).toBeGreaterThan(slow.st().score.breakdown.time!);
  });
  it('score never goes negative', () => {
    const h = harness();
    h.at('a', 640, 680);
    h.tool('a', 'phase_scanner'); h.use('a', 'cache');
    expect(h.st().score.total).toBe(0);
  });
  it('publishes state only when something changed, with strictly increasing revisions', () => {
    const h = harness();
    const first = h.e.consumeState()!;
    expect(first).not.toBeNull();
    expect(h.e.consumeState()).toBeNull(); // quiet tick
    h.run(5);
    expect(h.e.consumeState()).toBeNull();
    h.at('a', 200, 590); h.tool('a', 'phase_scanner');
    const second = h.e.consumeState()!;
    expect(second.rev).toBeGreaterThan(first.rev);
  });
  it('every published state satisfies the shared schema throughout a full solve', () => {
    const h = harness();
    const check = () => { const s = h.e.consumeState(); if (s) expect(() => StageStateSchema.parse(s)).not.toThrow(); };
    check(); h.fixRoot(); check(); h.routePower(); check(); h.sync(); check();
    h.prepCore(); check(); h.use('a', 'core'); h.run(110); check();
    expect(h.st().status).toBe('stabilized');
  });
});
