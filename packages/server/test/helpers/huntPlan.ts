import type { ItemAction } from '@wb/shared';
import { Lockstep, goTo, wait, waitUntil, type Script } from './bot';

/**
 * Real-physics plan that clears the salvage hunt (stage 1 with the hunt option) with ONE player through the real
 * Room -> GameSim -> StageEngine path. It respects the 2-slot limit: it carries exactly two parts at a time, makes the choice a
 * player has to make (swap a cracked coil for the real one) and never holds more than the server allows. Teammates may stand idle.
 * The route segments are copied from tutorialPlan.ts (that helper is frozen); only the salvage steps are new.
 */
export function itemDo(s: Lockstep, id: string, a: ItemAction, expectOk = true): string {
  const r = s.room.itemAction(id, a);
  if (expectOk && !r.ok) throw new Error(`${a.action} ${JSON.stringify(a)} refused: ${r.error}`);
  return r.ok ? r.message : r.error;
}

/** Waits out the per-player item gap (4 ticks) so the next item intent is not rate-limited. */
const gap = (): Script => wait(5);

const carried = (s: Lockstep, id: string): string[] => s.state().items!.players.find((p) => p.id === id)!.carried;

/** Scan from the first platform, then take the Fuse and the cracked Coil (both hands full). */
const segSpares = (s: Lockstep, id: string): Script => (function* () {
  yield* goTo(() => s.body(id), 200, 590);
  s.do(id, { kind: 'use_tool', tool: 'phase_scanner' });
  yield* wait(4);
  itemDo(s, id, { action: 'pickup', itemId: 'fuse_a' });
  yield* gap();
  itemDo(s, id, { action: 'pickup', itemId: 'coil_cracked' });
  yield* gap();
  if (carried(s, id).length !== 2) throw new Error('expected both hands full');
})();

/** Open the locker, swap the cracked coil for the real one (hands are full, so a plain pickup would be refused). */
const segLocker = (s: Lockstep, id: string): Script => (function* () {
  yield* goTo(() => s.body(id), 850, 320);
  itemDo(s, id, { action: 'open', stashId: 'locker_top' });
  yield* gap();
  itemDo(s, id, { action: 'swap', dropId: 'coil_cracked', pickId: 'coil_real' });
  yield* gap();
})();

/** Open the locker and take the real coil with a free hand (no swap needed). */
const segLockerPick = (s: Lockstep, id: string): Script => (function* () {
  yield* goTo(() => s.body(id), 850, 320);
  itemDo(s, id, { action: 'open', stashId: 'locker_top' });
  yield* gap();
  itemDo(s, id, { action: 'pickup', itemId: 'coil_real' });
  yield* gap();
})();

const segCoupling = (s: Lockstep, id: string): Script => (function* () {
  yield* goTo(() => s.body(id), 200, 410);
  itemDo(s, id, { action: 'install', itemId: 'coil_real', targetId: 'bp_coupling' });
  yield* wait(4);
  s.do(id, { kind: 'use_tool', tool: 'flux_welder', targetId: 'bp_coupling' });
  yield* waitUntil(s, () => s.state().breakpoints[0]?.repaired === true, 300);
})();

const segPower = (s: Lockstep, id: string): Script => (function* () {
  yield* goTo(() => s.body(id), 990, 590);
  s.do(id, { kind: 'interact', targetId: 'sw_1' });
  yield* wait(4);
  yield* goTo(() => s.body(id), 1080, 590);
  itemDo(s, id, { action: 'install', itemId: 'fuse_a', targetId: 'sw_2' });
  yield* wait(4);
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

export const huntSegments = { segSpares, segLocker, segLockerPick, segCoupling, segPower, segSyncSolo, segFinal };

/** Drives `id` through the whole hunt. Afterwards the room is in `stage_complete`. */
export function solveHunt(sim: Lockstep, id: string): void {
  sim.run({ [id]: segSpares(sim, id) });
  sim.run({ [id]: segLocker(sim, id) });
  sim.run({ [id]: segCoupling(sim, id) });
  sim.run({ [id]: segPower(sim, id) });
  sim.run({ [id]: segSyncSolo(sim, id) });
  sim.run({ [id]: wait(1) });
  sim.run({ [id]: segFinal(sim, id) });
}
