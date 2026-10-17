import { describe, expect, it } from 'vitest';
import { DisasterPublicSchema, type DisasterPhase } from '@wb/shared';
import { DisasterRuntime, RESOLVED_HOLD_TICKS, type DisasterStepResult } from '../../src/disasters/runtime';
import { fixtureMeta } from '../helpers/disasterFixtures';

const make = () => new DisasterRuntime(fixtureMeta());
/** Steps ticks from..to (inclusive) with `resolved` false; returns every result. */
function run(rt: DisasterRuntime, from: number, to: number, resolved = false): DisasterStepResult[] {
  const out: DisasterStepResult[] = [];
  for (let t = from; t <= to; t++) out.push(rt.step(t, resolved));
  return out;
}
const sumDelta = (rs: DisasterStepResult[]) => rs.reduce((n, r) => n + r.scoreDelta, 0);

describe('DisasterRuntime lifecycle (ticks only)', () => {
  it('starts in WARNING with its warning message and holds hazards disarmed', () => {
    const rt = make();
    expect(rt.phase).toBe('warning');
    expect(rt.message()).toBe('m-warning');
    expect(rt.hazardMod('hz_arc')).toEqual({ armed: false });
    expect(rt.hazardMod('some_other_hazard')).toBeUndefined();
  });

  it('changes phase on exactly the scheduled ticks', () => {
    const rt = make();
    const seen = new Map<number, DisasterPhase>();
    for (let t = 1; t <= 400; t++) { rt.step(t, false); seen.set(t, rt.phase); }
    const expected = (t: number): DisasterPhase =>
      t < 10 ? 'warning' : t < 100 ? 'active' : t < 300 ? 'escalated' : t < 350 ? 'failed' : 'cleanup';
    for (let t = 1; t <= 400; t++) expect(seen.get(t), `tick ${t}`).toBe(expected(t));
  });

  it('reports a change (and a feed line) only on phase changes', () => {
    const rt = make();
    const results = run(rt, 1, 400);
    const changes = results.map((r, i) => (r.changed ? i + 1 : 0)).filter(Boolean);
    expect(changes).toEqual([10, 100, 300, 350]);
    for (const r of results) expect(r.feed.length).toBe(r.changed ? 1 : 0);
    expect(results[9]!.feed[0]).toEqual({ text: 'm-active', tone: 'warn' });
    expect(results[99]!.feed[0]).toEqual({ text: 'm-escalated', tone: 'bad' });
    expect(results[299]!.feed[0]).toEqual({ text: 'm-failed', tone: 'bad' });
    expect(results[349]!.feed[0]).toEqual({ text: 'm-cleanup', tone: 'info' });
  });

  it('drains heat once per second while ESCALATED, never beyond its cap, and charges the failure penalty once', () => {
    const rt = make();
    const results = run(rt, 1, 600);
    // ESCALATED covers ticks 100..299; drains at 100, 120, 140, 160 (3 + 3 + 3 + 1 = cap 10)
    const drains = results.map((r, i) => [i + 1, r.scoreDelta] as const).filter(([t, d]) => d !== 0 && t !== 300);
    expect(drains).toEqual([[100, -3], [120, -3], [140, -3], [160, -1]]);
    expect(rt.heatDrained).toBe(10);
    expect(results[299]!.scoreDelta).toBe(-40);
    expect(sumDelta(results)).toBe(-50); // cap 10 + failure penalty 40, and nothing afterwards
  });

  it('applies bounded, phase-dependent hazard modifiers', () => {
    const rt = make();
    expect(rt.hazardMod('hz_arc')).toEqual({ armed: false });                       // warning
    run(rt, 1, 10);
    expect(rt.hazardMod('hz_arc')).toEqual({ armed: true });                        // active
    run(rt, 11, 100);
    expect(rt.hazardMod('hz_arc')).toEqual({ armed: true, periodTicks: 30, r: 200 }); // escalated
    run(rt, 101, 300);
    expect(rt.phase).toBe('failed');
    expect(rt.hazardMod('hz_arc')).toEqual({ armed: true, periodTicks: 30, r: 200 }); // held while failed
    run(rt, 301, 350);
    expect(rt.phase).toBe('cleanup');
    expect(rt.hazardMod('hz_arc')).toEqual({ armed: false });                       // gone
  });

  it('armedFrom "escalated" keeps a hazard disarmed during ACTIVE', () => {
    const base = fixtureMeta();
    const meta = fixtureMeta({ hazardPhases: [{ ...base.hazardPhases[0]!, armedFrom: 'escalated' }] });
    const rt = new DisasterRuntime(meta);
    run(rt, 1, 50);
    expect(rt.phase).toBe('active');
    expect(rt.hazardMod('hz_arc')!.armed).toBe(false);
    run(rt, 51, 100);
    expect(rt.hazardMod('hz_arc')!.armed).toBe(true);
  });

  it('RESOLVED disarms immediately, is shown briefly, then CLEANUP; afterwards nothing happens', () => {
    const rt = make();
    run(rt, 1, 49);
    expect(rt.phase).toBe('active');
    const r = rt.step(50, true);
    expect(rt.phase).toBe('resolved');
    expect(r.feed).toEqual([{ text: 'm-resolved', tone: 'good' }]);
    expect(rt.hazardMod('hz_arc')).toEqual({ armed: false });
    run(rt, 51, 50 + RESOLVED_HOLD_TICKS - 1, true);
    expect(rt.phase).toBe('resolved');
    rt.step(50 + RESOLVED_HOLD_TICKS, true);
    expect(rt.phase).toBe('cleanup');
    for (const x of run(rt, 100, 1000, true)) expect(x).toEqual({ changed: false, scoreDelta: 0, feed: [] });
    expect(rt.heatDrained).toBe(0); // resolved before escalation: no heat at all
  });

  it('can be resolved during WARNING and during ESCALATED (heat stops)', () => {
    const early = make();
    early.step(3, true);
    expect(early.phase).toBe('resolved');

    const late = make();
    run(late, 1, 121);
    expect(late.phase).toBe('escalated');
    const drained = late.heatDrained;
    late.step(122, true);
    expect(late.phase).toBe('resolved');
    run(late, 123, 400, true);
    expect(late.heatDrained).toBe(drained);
  });

  it('a FAILED disaster cleans itself up after its hold, then stays clean', () => {
    const rt = make();
    run(rt, 1, 349);
    expect(rt.phase).toBe('failed');
    rt.step(350, false);
    expect(rt.phase).toBe('cleanup');
    expect(sumDelta(run(rt, 351, 5000))).toBe(0);
  });

  it.each(['warning', 'active', 'escalated', 'failed', 'resolved', 'cleanup'] as const)(
    'finish() forces CLEANUP from %s, removes every effect and is idempotent', (start) => {
      const rt = make();
      const reach: Record<DisasterPhase, () => void> = {
        warning: () => {}, active: () => run(rt, 1, 10), escalated: () => run(rt, 1, 100), failed: () => run(rt, 1, 300),
        resolved: () => { run(rt, 1, 20); rt.step(21, true); }, cleanup: () => { run(rt, 1, 20); rt.step(21, true); rt.finish(22); },
      };
      reach[start]();
      expect(rt.phase).toBe(start);
      rt.finish(500);
      expect(rt.phase).toBe('cleanup');
      expect(rt.hazardMod('hz_arc')).toEqual({ armed: false });
      expect(rt.finish(501)).toEqual({ changed: false, scoreDelta: 0, feed: [] });
      expect(rt.phase).toBe('cleanup');
    });

  it('exposes a valid public projection with a schedule that clears as phases pass', () => {
    const rt = make();
    const pub = () => DisasterPublicSchema.parse(rt.publicState());
    expect(pub()).toMatchObject({ id: 'reactor_overload', name: 'Test Disaster', version: 1, phase: 'warning', message: 'm-warning', escalatesAtTick: 100, failsAtTick: 300 });
    run(rt, 1, 50);
    expect(pub()).toMatchObject({ phase: 'active', escalatesAtTick: 100, failsAtTick: 300 });
    run(rt, 51, 100);
    expect(pub()).toMatchObject({ phase: 'escalated', escalatesAtTick: null, failsAtTick: 300 });
    run(rt, 101, 300);
    expect(pub()).toMatchObject({ phase: 'failed', escalatesAtTick: null, failsAtTick: null });
    expect(pub().threats).toEqual([{ hazardId: 'hz_arc', warning: 'arcs ahead', countermeasure: 'shield_projector', repair: 'fix it' }]);
  });

  it('never hands out references into its private metadata', () => {
    const rt = make();
    const a = rt.publicState();
    a.threats[0]!.warning = 'tampered';
    expect(rt.publicState().threats[0]!.warning).toBe('arcs ahead');
    expect(rt.meta.threats[0]!.warning).toBe('arcs ahead');
  });

  it('is deterministic: the same ticks always produce the same history', () => {
    const history = () => {
      const rt = make();
      return run(rt, 1, 400).map((r) => JSON.stringify(r));
    };
    expect(history()).toEqual(history());
  });
});
