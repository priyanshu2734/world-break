import { describe, expect, it } from 'vitest';
import { StageStateSchema, type StageState } from '@wb/shared';
import type { ActionResult } from '../../src/systems/engine';
import type { StageDef } from '../../src/systems/stageDef';
import { generateDisasterStage } from '../../src/disasters/registry';
import { harness } from '../helpers/stage';
import { switchPlan } from '../helpers/planner';

const SEED = 3889565240; // 10 digits: cannot collide with other numbers in public state
const makeDef = (seed = SEED): StageDef => structuredClone(generateDisasterStage(2, seed));
/** Same stage, but the arc is armed whenever the lifecycle allows (not only during the final objective). */
const alwaysArmedDef = (): StageDef => { const d = makeDef(); d.hazards[0]!.armedWhenObjective = undefined; return d; };

type H = ReturnType<typeof harness>;
const must = (r: ActionResult): ActionResult => { if (!r.ok) throw new Error(`refused: ${r.error}`); return r; };
const disaster = (h: H) => h.st().disaster!;
const phaseAfter = (h: H, ticks: number) => { h.run(ticks); return disaster(h).phase; };

/** Solves objectives with teleporting players (the engine still enforces range, tools and prerequisites). */
function fixRoot(h: H, def: StageDef, who = 'a') {
  const bp = def.breakpoints[0]!;
  h.at(who, bp.x, bp.y); must(h.tool(who, 'phase_scanner')); must(h.tool(who, 'flux_welder', bp.id)); h.run(bp.repairTicks + 5);
}
function routePower(h: H, def: StageDef, who = 'a') {
  for (const sw of switchPlan(def, 'pump')) { h.at(who, sw.x, sw.y); must(h.use(who, sw.id)); }
  h.run(45);
}
function finalChannel(h: H, def: StageDef, who = 'a', shield = true) {
  const core = def.entities.find((e) => e.id === 'core')!;
  h.at(who, core.x, core.y);
  must(h.tool(who, 'power_cell', 'core_feed'));
  if (shield) must(h.tool(who, 'shield_projector'));
  must(h.use(who, 'core'));
  const o = def.objectives.find((x) => x.id === 'o_final')!;
  h.run((o.params.kind === 'channel_hold' ? o.params.requiredTicks : 100) + 5);
}
const solve = (h: H, def: StageDef) => { fixRoot(h, def); routePower(h, def); finalChannel(h, def); };

describe('engine: disaster in the public stage state', () => {
  it('publishes the warning, schedule and threats from the first state, and the state stays schema-valid', () => {
    const def = makeDef();
    const h = harness({ def });
    const s = h.st();
    expect(StageStateSchema.parse(s)).toEqual(s);
    expect(s.disaster).toMatchObject({
      id: 'reactor_overload', name: 'Reactor Overload', version: 1, phase: 'warning',
      escalatesAtTick: def.disaster!.schedule.escalateAtTick, failsAtTick: def.disaster!.schedule.failAtTick,
    });
    expect(s.disaster!.message).toBe(def.disaster!.messages.warning);
    expect(s.disaster!.threats).toHaveLength(1);
    expect(s.disaster!.threats[0]).toMatchObject({ hazardId: 'hz_arc', countermeasure: 'shield_projector' });
    expect(s.feed.map((f) => f.text)).toContain(def.disaster!.messages.warning);
  });

  it('hand-authored stages are unchanged: no disaster key at all', () => {
    expect('disaster' in harness().st()).toBe(false);
  });

  it('keeps hidden data and seeds out of every phase of the public state', () => {
    const def = makeDef();
    const sched = def.disaster!.schedule;
    const h = harness({ def });
    const snapshots: string[] = [JSON.stringify(h.st())];
    for (const target of [sched.activateAtTick + 1, sched.escalateAtTick + 1, sched.failAtTick + 1, sched.failAtTick + sched.failedHoldTicks + 2]) {
      h.run(target - h.e.tick);
      snapshots.push(JSON.stringify(h.st()));
    }
    for (const json of snapshots) {
      for (const secret of ['bp_valve', 'f_valve', 'Seized coolant valve', String(SEED)]) expect(json).not.toContain(secret);
    }
  });

  it('a hidden breakpoint is still refused exactly like a nonexistent target', () => {
    const def = makeDef();
    const h = harness({ def });
    const bp = def.breakpoints[0]!;
    h.at('a', bp.x, bp.y);
    const hidden = h.tool('a', 'flux_welder', bp.id);
    const nothing = h.tool('a', 'flux_welder', 'zzz_nothing');
    expect(hidden).toEqual({ ok: false, error: 'Nothing there to repair.' });
    expect(hidden).toEqual(nothing);
  });

  it('every phase change is published as a new revision', () => {
    const def = makeDef();
    const sched = def.disaster!.schedule;
    const h = harness({ def });
    let last = h.e.consumeState()!.rev;
    for (const tick of [sched.activateAtTick, sched.escalateAtTick, sched.failAtTick]) {
      h.run(tick - 1 - h.e.tick);
      expect(h.e.consumeState()?.rev ?? last).toBeGreaterThanOrEqual(last); // quiet ticks may or may not republish
      last = h.e.state().rev;
      h.run(1);
      const s = h.e.consumeState();
      expect(s, `phase change at tick ${tick}`).not.toBeNull();
      expect(s!.rev).toBeGreaterThan(last);
      last = s!.rev;
    }
  });
});

describe('engine: lifecycle is driven by sim ticks only', () => {
  it('moves WARNING -> ACTIVE -> ESCALATED -> FAILED -> CLEANUP on exactly the scheduled ticks', () => {
    const def = makeDef();
    const s = def.disaster!.schedule;
    const h = harness({ def });
    const at = (tick: number) => { h.run(tick - h.e.tick); return disaster(h).phase; };
    expect(at(s.activateAtTick - 1)).toBe('warning');
    expect(at(s.activateAtTick)).toBe('active');
    expect(at(s.escalateAtTick - 1)).toBe('active');
    expect(at(s.escalateAtTick)).toBe('escalated');
    expect(at(s.failAtTick - 1)).toBe('escalated');
    expect(at(s.failAtTick)).toBe('failed');
    expect(at(s.failAtTick + s.failedHoldTicks - 1)).toBe('failed');
    expect(at(s.failAtTick + s.failedHoldTicks)).toBe('cleanup');
    expect(disaster(h).message).toBe(def.disaster!.messages.cleanup);
    expect(h.e.status).toBe('running'); // P3A: failure is soft; the stage stays completable
  });

  it('two engines given the same stage and ticks end in an identical state', () => {
    const a = harness({ def: makeDef() }), b = harness({ def: makeDef() });
    a.run(4000); b.run(4000);
    expect(a.st()).toEqual(b.st());
  });

  it('heat drain and the failure penalty are bounded and charged exactly once', () => {
    const def = makeDef();
    const m = def.disaster!;
    const h = harness({ def });
    h.run(m.schedule.failAtTick + 1);
    const seconds = Math.floor((m.schedule.failAtTick - 1) / 20) - Math.floor((m.schedule.escalateAtTick - 1) / 20);
    const heat = Math.min(m.heat.cap, m.heat.perSecond * seconds);
    expect(h.st().score.breakdown.disaster).toBe(-(heat + m.failPenalty));
    h.run(m.schedule.failedHoldTicks + 2000); // through cleanup and long after
    expect(h.st().score.breakdown.disaster).toBe(-(heat + m.failPenalty));
    expect(h.st().score.total).toBeGreaterThanOrEqual(0);
  });
});

describe('engine: the lifecycle controls the hazard', () => {
  it('keeps the arc disarmed during WARNING, arms it when ACTIVE and punishes an unshielded player', () => {
    const def = alwaysArmedDef();
    const s = def.disaster!.schedule;
    const core = def.entities.find((e) => e.id === 'core')!;
    const h = harness({ def });
    h.at('a', core.x, core.y); // standing in the arc zone, unshielded
    h.run(s.activateAtTick - 1);
    expect(h.st().hazards[0]).toMatchObject({ armed: false, nextPulseTick: null });
    expect(h.st().score.breakdown.hazard).toBeUndefined();
    h.run(2);
    expect(h.st().hazards[0]!.armed).toBe(true);
    h.run(45);
    expect(h.st().score.breakdown.hazard).toBe(-def.scoring.hazardHitPenalty);
  });

  it('ESCALATION widens the arc and speeds up its pulses (bounded by the definition)', () => {
    const def = alwaysArmedDef();
    const s = def.disaster!.schedule, esc = def.disaster!.hazardPhases[0]!.escalated!;
    const baseR = def.hazards[0]!.r, basePeriod = def.hazards[0]!.periodTicks!;
    const h = harness({ def });
    h.run(s.escalateAtTick - 1);
    expect(h.st().hazards[0]!.r).toBe(baseR);
    h.run(2);
    expect(h.st().hazards[0]!.r).toBe(esc.r);
    expect(esc.r!).toBeGreaterThan(baseR);
    expect(esc.periodTicks!).toBeLessThan(basePeriod);
    const pulses: number[] = [];
    for (let i = 0; i < 400; i++) {
      h.run(1);
      const n = h.st().hazards[0]!.nextPulseTick;
      if (n !== null && n !== pulses.at(-1)) pulses.push(n);
    }
    expect(pulses.length).toBeGreaterThanOrEqual(4);
    const diffs = pulses.slice(1).map((n, i) => n - pulses[i]!);
    for (const d of diffs.slice(1)) expect(d).toBe(esc.periodTicks);
  });

  it('after CLEANUP nothing is left armed, widened or scheduled, and no more hits land', () => {
    const def = alwaysArmedDef();
    const s = def.disaster!.schedule;
    const core = def.entities.find((e) => e.id === 'core')!;
    const h = harness({ def });
    h.at('a', core.x, core.y);
    h.run(s.failAtTick + s.failedHoldTicks + 2);
    expect(disaster(h).phase).toBe('cleanup');
    expect(h.st().hazards[0]).toMatchObject({ armed: false, r: def.hazards[0]!.r, nextPulseTick: null });
    const before = h.st().score.breakdown.hazard;
    h.run(500);
    expect(h.st().score.breakdown.hazard).toBe(before);
    expect(h.st().hazards[0]).toMatchObject({ armed: false, r: def.hazards[0]!.r, nextPulseTick: null });
  });
});

describe('engine: resolution and cleanup', () => {
  it('solving the stage resolves the disaster and cleans up in the same tick the stage ends', () => {
    const def = makeDef();
    const h = harness({ def });
    solve(h, def);
    expect(h.e.status).toBe('stabilized');
    const s = h.st();
    expect(s.disaster!.phase).toBe('cleanup');
    expect(s.disaster!.message).toBe(def.disaster!.messages.cleanup);
    expect(s.hazards.every((x) => !x.armed && x.r === def.hazards[0]!.r && x.nextPulseTick === null)).toBe(true);
    expect(s.feed.map((f) => f.text)).toEqual(expect.arrayContaining([def.disaster!.messages.resolved, def.disaster!.messages.cleanup]));
    expect(s.score.breakdown.disaster).toBeUndefined(); // solved long before escalation: no heat, no penalty
    h.e.consumeState();
    h.run(500);
    expect(h.e.consumeState()).toBeNull(); // nothing keeps changing after the stage ended
  });

  it('solving while ESCALATED stops the heat drain', () => {
    const def = makeDef();
    const h = harness({ def });
    fixRoot(h, def); routePower(h, def);
    h.run(def.disaster!.schedule.escalateAtTick - h.e.tick + 41); // into ESCALATED, a couple of drains in
    expect(disaster(h).phase).toBe('escalated');
    const drained = h.st().score.breakdown.disaster!;
    expect(drained).toBeLessThan(0);
    finalChannel(h, def);
    expect(disaster(h).phase).toBe('cleanup');
    expect(h.st().score.breakdown.disaster).toBeGreaterThanOrEqual(drained - def.disaster!.heat.perSecond * 6); // a few more seconds at most
    const after = h.st().score.breakdown.disaster;
    h.run(1000);
    expect(h.st().score.breakdown.disaster).toBe(after);
  });

  it('after a FAILED disaster the stage can still be completed, and cleanup still happens', () => {
    const def = makeDef();
    const h = harness({ def });
    h.run(def.disaster!.schedule.failAtTick + 5);
    expect(disaster(h).phase).toBe('failed');
    solve(h, def);
    expect(h.e.status).toBe('stabilized');
    expect(disaster(h).phase).toBe('cleanup');
    expect(h.st().hazards.every((x) => !x.armed)).toBe(true);
  });

  it('a lifecycle that resolves early (all repairs done) disarms the hazard while the stage is still running', () => {
    const def = alwaysArmedDef();
    def.disaster!.resolveObjectives = ['o_root', 'o_power'];
    const h = harness({ def });
    fixRoot(h, def); routePower(h, def);
    h.run(60);
    expect(disaster(h).phase).toBe('cleanup');
    expect(h.e.status).toBe('running');
    expect(h.st().objectives.find((o) => o.id === 'o_final')!.status).toBe('active');
    expect(h.st().hazards[0]!.armed).toBe(false);
    finalChannel(h, def, 'a', false); // no shield needed any more
    expect(h.e.status).toBe('stabilized');
    expect(h.st().score.breakdown.hazard).toBeUndefined();
  });

  it('wrong targets never resolve the disaster', () => {
    const def = makeDef();
    const h = harness({ def });
    const panel = def.entities.find((e) => e.id === 'temp_panel')!;
    h.at('a', panel.x, panel.y);
    must(h.tool('a', 'flux_welder', 'temp_panel')); h.run(60);
    const sw = def.entities.find((e) => e.id === 'sw_4')!;
    h.at('a', sw.x, sw.y); must(h.use('a', 'sw_4'));
    h.run(def.disaster!.schedule.escalateAtTick + 100);
    expect(['active', 'escalated']).toContain(disaster(h).phase);
    expect(h.e.status).toBe('running');
    expect(h.st().objectives.find((o) => o.id === 'o_final')!.status).toBe('locked');
  });
});
