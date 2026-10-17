import { TOOL_SPECS } from '@wb/shared';
import type { Entity, Objective, StageDef } from '../../src/systems/stageDef';
import { topoOrder } from '../../src/systems/failures';
import { evaluatePower } from '../../src/systems/power';
import { Lockstep, goTo, wait, waitUntil, type Script } from './bot';

/**
 * Generic solver for generated stages. It reads the (server-private) StageDef, builds a plan, then plays it through
 * the REAL path (Room -> GameSim real physics -> StageEngine), one input per tick, using only actions a player has.
 * Supported objective kinds: repair_breakpoint, power_route, channel_hold. (timed_controls: not yet; it throws.)
 */
type Switch = Extract<Entity, { kind: 'power_switch' }>;

/** Smallest set of breakers to close (all start open) so that `consumerId` is powered without overload. */
export function switchPlan(def: StageDef, consumerId: string): Switch[] {
  const switches = def.entities.filter((e): e is Switch => e.kind === 'power_switch');
  if (switches.some((s) => s.initiallyClosed)) throw new Error('planner: initially closed breakers are not supported');
  if (switches.length > 16) throw new Error('planner: too many breakers');
  const conduit = new Map(def.power.conduits.map((c) => [c.id, c]));
  let best: Switch[] | null = null;
  for (let mask = 0; mask < 1 << switches.length; mask++) {
    const chosen = switches.filter((_, i) => (mask & (1 << i)) !== 0);
    if (best && chosen.length >= best.length) continue;
    const closed = new Set(chosen.map((s) => s.conduitId));
    const ev = evaluatePower(def.power.nodes, def.power.conduits, def.power.capacity, (cid) => {
      const c = conduit.get(cid)!;
      return c.condition === 'ok' && (!c.switchEntityId || closed.has(cid));
    });
    // Closing breakers one by one only ever adds power, so every prefix of a non-overloading set is also safe.
    if (ev.poweredConsumers.has(consumerId) && !ev.overloaded) best = chosen;
  }
  if (!best) throw new Error(`planner: no breaker set powers ${consumerId}`);
  return best;
}

function orderedObjectives(def: StageDef): Objective[] {
  const order = topoOrder(def.objectives, def.objectives.flatMap((o) => o.prerequisites.map((p) => ({ from: p, to: o.id }))));
  if (!order) throw new Error('planner: objective cycle');
  return order.map((id) => def.objectives.find((o) => o.id === id)!);
}

function* repair(s: Lockstep, id: string, def: StageDef, breakpointId: string): Script {
  const b = def.breakpoints.find((x) => x.id === breakpointId)!;
  yield* goTo(() => s.body(id), b.x, b.y);
  if (!s.state().breakpoints.some((x) => x.id === breakpointId)) {
    s.do(id, { kind: 'use_tool', tool: 'phase_scanner' });
    yield* wait(4);
  }
  s.do(id, { kind: 'use_tool', tool: 'flux_welder', targetId: breakpointId });
  yield* waitUntil(s, () => s.state().breakpoints.find((x) => x.id === breakpointId)?.repaired === true, b.repairTicks + 300);
}

function* route(s: Lockstep, id: string, def: StageDef, o: Objective): Script {
  if (o.params.kind !== 'power_route') return;
  for (const sw of switchPlan(def, o.params.consumerId)) {
    yield* goTo(() => s.body(id), sw.x, sw.y);
    s.do(id, { kind: 'interact', targetId: sw.id });
    yield* wait(4);
  }
  yield* waitUntil(s, () => s.state().objectives.find((x) => x.id === o.id)!.status === 'complete', o.params.holdTicks + 200);
}

function* channel(s: Lockstep, id: string, def: StageDef, o: Objective): Script {
  if (o.params.kind !== 'channel_hold') return;
  const p = o.params;
  const core = def.entities.find((e) => e.id === p.entityId);
  if (core?.kind !== 'core_console') throw new Error('planner: channel target is not a core console');
  yield* goTo(() => s.body(id), core.x, core.y);
  if (p.needsStableHazard) {
    const h = def.hazards.find((x) => x.id === p.needsStableHazard)!;
    const tool = (Object.values(TOOL_SPECS).find((t) => t.stabilizes.includes(h.kind)))!.id;
    s.do(id, { kind: 'use_tool', tool }); yield* wait(4);
  }
  const hasGridFeed = def.power.conduits.some((c) => c.condition !== 'melted' && (c.from === core.consumerId || c.to === core.consumerId));
  if (!hasGridFeed) { s.do(id, { kind: 'use_tool', tool: 'power_cell', targetId: core.consumerId }); yield* wait(4); }
  if (def.hazards.some((h) => h.kind === 'arc_discharge' && (!h.armedWhenObjective || h.armedWhenObjective === o.id))) {
    s.do(id, { kind: 'use_tool', tool: 'shield_projector' }); yield* wait(4);
  }
  s.do(id, { kind: 'interact', targetId: core.id });
  yield* waitUntil(s, () => s.room.phase === 'stage_complete' || s.state().objectives.find((x) => x.id === o.id)!.status === 'complete', p.requiredTicks + 400);
}

function objectiveScript(s: Lockstep, id: string, def: StageDef, o: Objective): Script {
  switch (o.params.kind) {
    case 'repair_breakpoint': return repair(s, id, def, o.params.breakpointId);
    case 'power_route': return route(s, id, def, o);
    case 'channel_hold': return channel(s, id, def, o);
    case 'timed_controls': throw new Error('planner: timed_controls is not supported yet');
  }
}

/** One player clears every objective of `def` in order. Afterwards the room is in `stage_complete`. */
export function solveStage(sim: Lockstep, playerId: string, def: StageDef): void {
  for (const o of orderedObjectives(def)) {
    sim.run({ [playerId]: objectiveScript(sim, playerId, def, o) }, 8000);
    sim.run({ [playerId]: wait(1) }); // objectives are evaluated on the tick after an action
  }
}
