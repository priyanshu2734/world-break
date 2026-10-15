import { describe, expect, it } from 'vitest';
import { Room } from '../src/room';
import { Lockstep, goTo, wait, waitUntil, type Script } from './helpers/bot';

function startRoom(n: number) {
  const room = new Room('ABCD', 2);
  const ids = Array.from({ length: n }, (_, i) => `p${i}`);
  ids.forEach((id, i) => room.join(id, `P${i}`));
  ids.slice(1).forEach((id) => room.setReady(id, true));
  expect(room.start('p0').ok).toBe(true);
  const sim = new Lockstep(room);
  while (room.phase !== 'playing') sim.tick();
  return { room, sim, ids };
}

// ---- reusable plan segments (each is a real walk + real server-validated actions) ----
const segRoot = (s: Lockstep, id: string): Script => (function* () {
  yield* goTo(() => s.body(id), 200, 590);
  s.do(id, { kind: 'use_tool', tool: 'phase_scanner' });
  yield* wait(4);
  yield* goTo(() => s.body(id), 200, 410);
  s.do(id, { kind: 'use_tool', tool: 'flux_welder', targetId: 'bp_coupling' });
  yield* waitUntil(s, () => s.state().breakpoints[0]?.repaired === true, 300);
})();

const segPower = (s: Lockstep, id: string): Script => (function* () {
  yield* goTo(() => s.body(id), 990, 590);
  s.do(id, { kind: 'interact', targetId: 'sw_1' });
  yield* wait(4);
  yield* goTo(() => s.body(id), 1080, 590);
  s.do(id, { kind: 'interact', targetId: 'sw_2' });
  yield* waitUntil(s, () => s.state().objectives.find((o) => o.id === 'o_power')!.status === 'complete', 200);
})();

const lock = (s: Lockstep, id: string, which: string, x: number, y: number): Script => (function* () {
  yield* goTo(() => s.body(id), x, y);
  s.do(id, { kind: 'interact', targetId: which });
})();
const segSyncSolo = (s: Lockstep, id: string): Script => (function* () {
  yield* lock(s, id, 'lock_a', 200, 590);
  yield* wait(4);
  yield* lock(s, id, 'lock_b', 520, 500);
  yield* wait(4);
  yield* lock(s, id, 'lock_c', 1200, 680);
})();

const segFinal = (s: Lockstep, id: string): Script => (function* () {
  yield* goTo(() => s.body(id), 470, 320);
  s.do(id, { kind: 'use_tool', tool: 'gravity_anchor' }); yield* wait(4);
  s.do(id, { kind: 'use_tool', tool: 'power_cell', targetId: 'core_feed' }); yield* wait(4);
  s.do(id, { kind: 'use_tool', tool: 'shield_projector' }); yield* wait(4);
  s.do(id, { kind: 'interact', targetId: 'core' });
  yield* waitUntil(s, () => s.room.phase === 'stage_complete', 400);
})();

const armedTick = (s: Lockstep, id: string) => s.state().entities.find((e) => e.id === id)!.armedUntilTick;

describe('tutorial stage is solvable through the real simulation', () => {
  it.each([1, 2, 3, 4])('one player clears every mandatory objective with %i player(s) in the room', (n) => {
    const { room, sim, ids } = startRoom(n);
    const host = ids[0]!;
    // teammates stand idle: nothing mandatory may depend on them
    sim.run({ [host]: segRoot(sim, host) });
    sim.run({ [host]: segPower(sim, host) });
    sim.run({ [host]: segSyncSolo(sim, host) });
    sim.run({ [host]: wait(1) });
    expect(sim.state().objectives.find((o) => o.id === 'o_sync')!.status).toBe('complete');
    sim.run({ [host]: segFinal(sim, host) });

    expect(room.phase).toBe('stage_complete'); // real STAGE_CLEAR transition
    const s = sim.state();
    expect(s.status).toBe('stabilized');
    expect(s.objectives.every((o) => o.status === 'complete')).toBe(true);
    expect(s.symptoms.every((x) => x.state === 'resolved')).toBe(true);
    expect(s.score.total).toBeGreaterThan(1000);
    expect(s.score.breakdown.hazard).toBeUndefined(); // the shield absorbed every discharge
  });

  it('a lone player walks between all three phase locks well inside the arming window', () => {
    const { sim, ids } = startRoom(1);
    const id = ids[0]!;
    sim.run({ [id]: segRoot(sim, id) });
    sim.run({ [id]: segPower(sim, id) });
    const t0 = sim.ticks;
    sim.run({ [id]: segSyncSolo(sim, id) });
    const span = sim.ticks - t0;
    expect(span).toBeLessThan(300); // armTicks
    expect(span).toBeGreaterThan(40); // genuinely had to travel
  });

  it('cooperation makes the coordinated repair faster: three players position, then arm together', () => {
    const armTimes = (sim: Lockstep) => ['lock_a', 'lock_b', 'lock_c'].map((id) => sim.state().entities.find((e) => e.id === id)!.armedUntilTick! - 300);

    const solo = startRoom(1);
    solo.sim.run({ p0: segRoot(solo.sim, 'p0') });
    solo.sim.run({ p0: segPower(solo.sim, 'p0') });
    solo.sim.run({ p0: segSyncSolo(solo.sim, 'p0') });
    // (armedUntil = arm tick + 300) read just before the objective is evaluated
    const soloArm = armTimes(solo.sim);
    const soloSpan = Math.max(...soloArm) - Math.min(...soloArm);

    const team = startRoom(3);
    team.sim.run({ p0: segRoot(team.sim, 'p0') });
    team.sim.run({ p0: segPower(team.sim, 'p0') });
    let arrived = 0;
    const stand = (id: string, which: string, x: number, y: number): Script => (function* () {
      yield* goTo(() => team.sim.body(id), x, y);
      arrived++;
      yield* waitUntil(team.sim, () => arrived === 3, 600); // teammates call out when ready
      team.sim.do(id, { kind: 'interact', targetId: which });
    })();
    team.sim.run({ p0: stand('p0', 'lock_a', 200, 590), p1: stand('p1', 'lock_b', 520, 500), p2: stand('p2', 'lock_c', 1200, 680) });
    const teamArm = armTimes(team.sim);
    const teamSpan = Math.max(...teamArm) - Math.min(...teamArm);
    team.sim.run({ p0: wait(1) });

    expect(team.sim.state().objectives.find((o) => o.id === 'o_sync')!.status).toBe('complete');
    expect(soloSpan).toBeGreaterThan(60); // one player really does have to travel between locks
    expect(teamSpan).toBeLessThanOrEqual(2); // together they arm at once
  });

  it('players who skip the investigation cannot finish: wrong targets never solve the stage', () => {
    const { room, sim, ids } = startRoom(2);
    const id = ids[0]!;
    // weld the decoy, flip breakers randomly, hit the console: 2000 ticks of wrong moves
    sim.run({
      [id]: (function* (): Script {
        yield* goTo(() => sim.body(id), 760, 500);
        sim.do(id, { kind: 'use_tool', tool: 'flux_welder', targetId: 'flicker_panel' });
        yield* wait(60);
        yield* goTo(() => sim.body(id), 1050, 680);
        sim.do(id, { kind: 'interact', targetId: 'sw_4' });
        yield* wait(1500);
      })(),
    });
    expect(room.phase).toBe('playing');
    const s = sim.state();
    expect(s.objectives.find((o) => o.id === 'o_root')!.status).toBe('active');
    expect(s.objectives.find((o) => o.id === 'o_final')!.status).toBe('locked');
    expect(s.breakpoints).toEqual([]); // never investigated: still hidden
    expect(s.symptoms.find((x) => x.id === 's_drift')!.state).toBe('active');
  });
});
