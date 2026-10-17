import { Lockstep, goTo, wait, waitUntil, type Script } from './bot';

/**
 * Real-physics plan that clears the hand-authored tutorial ("Cold Start") with ONE player, through the
 * real Room -> GameSim -> StageEngine path. Same moves as tutorial.solvability.test.ts (copied, not imported,
 * because that file is a frozen test). Teammates may stand idle: nothing mandatory depends on them.
 */
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

/** Drives `id` through the whole tutorial. Afterwards the room is in `stage_complete`. */
export function solveTutorial(sim: Lockstep, id: string): void {
  sim.run({ [id]: segRoot(sim, id) });
  sim.run({ [id]: segPower(sim, id) });
  sim.run({ [id]: segSyncSolo(sim, id) });
  sim.run({ [id]: wait(1) });
  sim.run({ [id]: segFinal(sim, id) });
}
