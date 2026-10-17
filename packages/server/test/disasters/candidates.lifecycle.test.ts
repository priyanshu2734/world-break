import { describe, expect, it, vi } from 'vitest';
import type { StageState } from '@wb/shared';
import { goTo, wait, waitUntil, type Script } from '../helpers/bot';
import { solveStage } from '../helpers/planner';
import { CANDIDATE_IDS, idleUntil, start, variantSeeds, type CandidateId } from '../helpers/candidates';

vi.setConfig({ testTimeout: 60_000 });

const PUBLIC_KEYS = ['escalatesAtTick', 'failsAtTick', 'id', 'message', 'name', 'phase', 'threats', 'version'];
const phaseOf = (s: StageState) => s.disaster!.phase;

function firstSeed(id: CandidateId): number {
  const [first] = variantSeeds(id, 2);
  return first![1];
}

for (const id of CANDIDATE_IDS) {
  describe(`${id}: lifecycle through the real Room`, () => {
    const runSeed = firstSeed(id);

    it('an idle team watches WARNING -> ACTIVE -> ESCALATED -> FAILED -> CLEANUP; effects are bounded; the stage stays completable', () => {
      const { room, sim, def } = start(id, runSeed, 2);
      const meta = def.disaster!;
      const first = new Map<string, { tick: number; message: string; heat: number }>();
      const order: string[] = [];
      const observe = () => {
        const s = sim.state();
        const ph = phaseOf(s);
        if (!first.has(ph)) { first.set(ph, { tick: s.tick, message: s.disaster!.message, heat: s.score.breakdown.disaster ?? 0 }); order.push(ph); }
      };
      observe();
      expect(order).toEqual(['warning']);
      for (let i = 0; i < 12_000 && !first.has('cleanup'); i++) { sim.tick(); observe(); }

      expect(order).toEqual(['warning', 'active', 'escalated', 'failed', 'cleanup']);
      const at = (p: string) => first.get(p)!;
      expect(at('active').tick).toBeGreaterThanOrEqual(meta.schedule.activateAtTick);
      expect(at('active').tick).toBeLessThanOrEqual(meta.schedule.activateAtTick + 2);
      expect(at('escalated').tick).toBeGreaterThanOrEqual(meta.schedule.escalateAtTick);
      expect(at('escalated').tick).toBeLessThanOrEqual(meta.schedule.escalateAtTick + 2);
      expect(at('failed').tick).toBeGreaterThanOrEqual(meta.schedule.failAtTick);
      expect(at('failed').tick).toBeLessThanOrEqual(meta.schedule.failAtTick + 2);
      expect(at('cleanup').tick).toBeGreaterThanOrEqual(meta.schedule.failAtTick + meta.schedule.failedHoldTicks);
      expect(at('cleanup').tick).toBeLessThanOrEqual(meta.schedule.failAtTick + meta.schedule.failedHoldTicks + 2);
      // every phase shows its own readable message
      for (const p of ['warning', 'active', 'escalated', 'failed', 'cleanup'] as const) expect(at(p).message).toBe(meta.messages[p]);
      // the failure is SOFT: the room is still playing, the penalty is bounded
      expect(room.phase).toBe('playing');
      const s = sim.state();
      expect(s.status).toBe('running');
      expect(s.score.breakdown.disaster!).toBeLessThan(0);
      expect(s.score.breakdown.disaster!).toBeGreaterThanOrEqual(-(meta.heat.cap + meta.failPenalty));
      expect(at('active').heat).toBe(0); // nothing is charged before the escalation
      // cleaned up: displayed hazards are back to base and nothing is armed or pending
      for (const h of s.hazards) {
        expect(h.armed).toBe(false);
        expect(h.nextPulseTick).toBeNull();
        expect(h.r).toBe(def.hazards.find((x) => x.id === h.id)!.r);
      }
      expect(s.disaster).toMatchObject({ phase: 'cleanup', escalatesAtTick: null, failsAtTick: null });
      // and the stage can still be finished
      solveStage(sim, 'p0', def);
      expect(room.phase).toBe('stage_complete');
      expect(sim.state().status).toBe('stabilized');
      expect(phaseOf(sim.state())).toBe('cleanup');
    });

    it('escalation changes the displayed hazards within bounds, and the change is gone after cleanup', () => {
      const { sim, def } = start(id, runSeed, 1);
      const meta = def.disaster!;
      const radius = (s: StageState, hid: string) => s.hazards.find((h) => h.id === hid)!.r;
      for (const hp of meta.hazardPhases) expect(radius(sim.state(), hp.hazardId)).toBe(def.hazards.find((h) => h.id === hp.hazardId)!.r);
      idleUntil(sim, () => phaseOf(sim.state()) === 'escalated');
      for (const hp of meta.hazardPhases) {
        const base = def.hazards.find((h) => h.id === hp.hazardId)!.r;
        const now = radius(sim.state(), hp.hazardId);
        expect(now).toBe(hp.escalated?.r ?? base);
        expect(now).toBeLessThanOrEqual(base * 1.5);
      }
      idleUntil(sim, () => phaseOf(sim.state()) === 'cleanup');
      for (const hp of meta.hazardPhases) expect(radius(sim.state(), hp.hazardId)).toBe(def.hazards.find((h) => h.id === hp.hazardId)!.r);
    });

    it('solving while ESCALATED works and stops the drain; solving right after FAILED works too', () => {
      for (const when of ['escalated', 'failed'] as const) {
        const { room, sim, def } = start(id, runSeed, 2);
        idleUntil(sim, () => phaseOf(sim.state()) === when);
        sim.run({ p0: wait(40) });
        solveStage(sim, 'p0', def);
        expect(room.phase).toBe('stage_complete');
        const s = sim.state();
        expect(s.status).toBe('stabilized');
        expect(phaseOf(s)).toBe('cleanup');
        expect(s.score.breakdown.disaster!).toBeLessThan(0);
        expect(s.score.breakdown.disaster!).toBeGreaterThanOrEqual(-(def.disaster!.heat.cap + def.disaster!.failPenalty));
        expect(s.score.breakdown.hazard ?? 0).toBeGreaterThanOrEqual(-2 * def.scoring.hazardHitPenalty);
        const after = s.score.breakdown.disaster;
        for (let i = 0; i < 600; i++) sim.tick();
        expect(sim.state().score.breakdown.disaster).toBe(after); // the drain stopped with the stage
      }
    });

    it('the public state never reveals the solution: hidden faults are absent, no seed or params, refusals are identical', () => {
      const { room, sim, def } = start(id, runSeed, 2);
      const s = sim.state();
      expect(Object.keys(s.disaster!).sort()).toEqual(PUBLIC_KEYS);
      expect(s.breakpoints).toEqual([]);
      const json = JSON.stringify(s).toLowerCase();
      for (const b of def.breakpoints) { expect(json).not.toContain(b.id.toLowerCase()); expect(json).not.toContain(b.label.toLowerCase()); }
      for (const key of ['"params"', '"seed"', '"hazardphases"', '"resolveobjectives"']) expect(json).not.toContain(key);
      const hidden = room.stageAction('p0', { kind: 'use_tool', tool: 'flux_welder', targetId: def.breakpoints[0]!.id });
      for (let i = 0; i < 4; i++) sim.tick(); // the per-player action gap
      const nothing = room.stageAction('p0', { kind: 'use_tool', tool: 'flux_welder', targetId: 'no_such_target' });
      expect(hidden.ok).toBe(false);
      expect(hidden).toEqual(nothing); // a hidden target and a nonexistent one are indistinguishable (P2 invariant)
    });

    it('wrong targets never win: the decoy panel and a locked console change nothing that matters', () => {
      const { room, sim, def } = start(id, runSeed, 2);
      const panel = def.entities.find((e) => e.kind === 'decoy_panel')!;
      const core = def.entities.find((e) => e.kind === 'core_console')!;
      sim.run({
        p0: (function* (): Script {
          yield* goTo(() => sim.body('p0'), panel.x, panel.y);
          sim.do('p0', { kind: 'use_tool', tool: 'flux_welder', targetId: panel.id });
          yield* wait(80);
          yield* goTo(() => sim.body('p0'), core.x, core.y);
        })(),
      });
      expect(room.stageAction('p0', { kind: 'interact', targetId: core.id }).ok).toBe(false); // locked
      expect(room.phase).toBe('playing');
      const s = sim.state();
      expect(s.objectives.find((o) => o.id === 'o_final')!.status).toBe('locked');
      expect(s.symptoms.every((x) => x.state !== 'resolved')).toBe(true);
    });
  });
}

describe('gravity_inversion: signature mechanics', () => {
  const id = 'gravity_inversion' as const;
  it('the console needs the anchor; the arcs only start when the inversion escalates', () => {
    const { room, sim, def } = start(id, firstSeed(id), 2);
    const meta = def.disaster!;
    solveStage(sim, 'p0', def, { stopBefore: 'o_final' });
    const core = def.entities.find((e) => e.kind === 'core_console')!;
    sim.run({ p0: (function* (): Script {
      yield* goTo(() => sim.body('p0'), core.x, core.y);
      sim.do('p0', { kind: 'use_tool', tool: 'power_cell', targetId: 'core_feed' });
      yield* wait(4);
    })() });
    // powered, but the field is not anchored: the console refuses
    const refused = room.stageAction('p0', { kind: 'interact', targetId: core.id });
    expect(refused.ok).toBe(false);
    expect(refused.ok === false && refused.error).toContain('unstable');
    // o_final is active but the arcs are not armed yet (still ACTIVE)
    expect(phaseOf(sim.state())).toBe('active');
    expect(sim.state().objectives.find((o) => o.id === 'o_final')!.status).toBe('active');
    const arc = (s: StageState) => s.hazards.find((h) => h.id === 'hz_arc')!;
    expect(arc(sim.state()).armed).toBe(false);
    expect(arc(sim.state()).nextPulseTick).toBeNull();
    idleUntil(sim, () => phaseOf(sim.state()) === 'escalated');
    sim.run({ p0: wait(2) });
    expect(arc(sim.state()).armed).toBe(true);
    expect(arc(sim.state()).r).toBe(meta.hazardPhases.find((h) => h.hazardId === 'hz_arc')!.escalated!.r);
    // the full plan (fresh Power Cell, anchor, shield, hold) still wins, even with the arcs armed
    solveStage(sim, 'p0', def);
    expect(room.phase).toBe('stage_complete');
    expect(sim.state().score.breakdown.hazard).toBeUndefined(); // the shield absorbed every discharge
  });
});

describe('reality_fracture: signature mechanics', () => {
  const id = 'reality_fracture' as const;
  it('the scanner cannot find the real fault until the anchors hold; then it can, and the refusals stay identical', () => {
    const { room, sim, def } = start(id, firstSeed(id), 1);
    const b = def.breakpoints[0]!;
    sim.run({ p0: (function* (): Script {
      yield* goTo(() => sim.body('p0'), b.x, b.y);
      sim.do('p0', { kind: 'use_tool', tool: 'phase_scanner' });
      yield* wait(4);
    })() });
    expect(sim.state().breakpoints).toEqual([]); // standing on it, scanning, and nothing is found
    const early = room.stageAction('p0', { kind: 'use_tool', tool: 'flux_welder', targetId: b.id });
    for (let i = 0; i < 4; i++) sim.tick(); // the per-player action gap
    expect(early).toEqual(room.stageAction('p0', { kind: 'use_tool', tool: 'flux_welder', targetId: 'no_such_target' }));
    expect(early.ok).toBe(false);

    solveStage(sim, 'p0', def, { stopBefore: 'o_root' }); // anchors only
    expect(sim.state().objectives.find((o) => o.id === 'o_sync')!.status).toBe('complete');
    sim.run({ p0: (function* (): Script {
      yield* goTo(() => sim.body('p0'), b.x, b.y);
      yield* wait(70); // scanner cooldown
      sim.do('p0', { kind: 'use_tool', tool: 'phase_scanner' });
      yield* wait(4);
    })() });
    expect(sim.state().breakpoints.map((x) => x.id)).toEqual([b.id]);
  });
});

describe('temporal_storm: signature mechanics', () => {
  const id = 'temporal_storm' as const;
  it('the clocks are locked until the fault is mended, and a relay slips out of its short window', () => {
    const { room, sim, def } = start(id, firstSeed(id), 1);
    const clock = def.entities.find((e) => e.id === 'lock_a')!;
    sim.run({ p0: goTo(() => sim.body('p0'), clock.x, clock.y) });
    const locked = room.stageAction('p0', { kind: 'interact', targetId: clock.id });
    expect(locked.ok).toBe(false);
    expect(locked.ok === false && locked.error).toBe(def.objectives.find((o) => o.id === 'o_clocks')!.lockedMessage);

    solveStage(sim, 'p0', def, { stopBefore: 'o_relays' });
    const relays = def.objectives.find((o) => o.id === 'o_relays')!;
    expect(relays.params.kind).toBe('timed_controls');
    const window = relays.params.kind === 'timed_controls' ? relays.params.armTicks : 0;
    const relay = def.entities.find((e) => e.id === 'lock_d')!;
    sim.run({ p0: (function* (): Script {
      yield* goTo(() => sim.body('p0'), relay.x, relay.y);
      sim.do('p0', { kind: 'interact', targetId: relay.id });
      yield* wait(window + 10); // only one of three armed: it slips
    })() });
    const s = sim.state();
    expect(s.objectives.find((o) => o.id === 'o_relays')!.status).toBe('active');
    expect(s.entities.find((e) => e.id === 'lock_d')!.state).toBe('idle');
    expect(s.feed.some((f) => f.text.includes('slipped out of phase'))).toBe(true);
    // the full run still works afterwards
    solveStage(sim, 'p0', def);
    expect(room.phase).toBe('stage_complete');
  });
});

describe('cascading_power_failure: signature mechanics', () => {
  const id = 'cascading_power_failure' as const;
  it('the next relay stays hidden until the previous one is mended; a long chain needs a supply-cache trip', () => {
    const { room, sim, def } = start(id, firstSeed(id), 1);
    expect(def.breakpoints.length).toBe(2);
    const [r1, r2] = [def.breakpoints[0]!, def.breakpoints[1]!];
    sim.run({ p0: (function* (): Script {
      yield* goTo(() => sim.body('p0'), r2.x, r2.y);
      sim.do('p0', { kind: 'use_tool', tool: 'phase_scanner' });
      yield* wait(4);
    })() });
    expect(sim.state().breakpoints.some((b) => b.id === r2.id)).toBe(false); // relay 2 cannot be found yet
    solveStage(sim, 'p0', def, { stopBefore: 'o_root_2' });
    expect(sim.state().breakpoints.find((b) => b.id === r1.id)?.repaired).toBe(true);
    sim.run({ p0: (function* (): Script {
      yield* goTo(() => sim.body('p0'), r2.x, r2.y);
      yield* wait(70);
      sim.do('p0', { kind: 'use_tool', tool: 'phase_scanner' });
      yield* wait(4);
    })() });
    expect(sim.state().breakpoints.some((b) => b.id === r2.id)).toBe(true);
  });

  it('a four-relay chain (tier 5) is solvable, using the supply cache once the welder runs dry', () => {
    const { room, sim, def } = start(id, 5, 1, 16);
    expect(def.breakpoints.length).toBe(4);
    solveStage(sim, 'p0', def);
    expect(room.phase).toBe('stage_complete');
    expect(sim.state().score.breakdown.resupply).toBe(-50); // exactly one refill
  });
});
