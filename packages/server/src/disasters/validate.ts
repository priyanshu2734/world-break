import { TOOL_SPECS } from '@wb/shared';
import type { StageDef } from '../systems/stageDef';

/** Fairness bounds every disaster stage must respect (bounded, fair escalation). */
export const DISASTER_LIMITS = {
  /** Players get at least this long (ticks) before escalation. 1200 ticks = 60 s. */
  minEscalateAtTick: 1200,
  /** ...and at least this long between escalation and failure. */
  minEscalationToFailTicks: 1200,
  maxFailedHoldTicks: 3600,
  maxHeatPerSecond: 20,
  maxHeatCap: 1000,
  maxFailPenalty: 500,
  /** Escalated hazards may not pulse faster than once a second, nor grow beyond 1.5x their base radius. */
  minEscalatedPeriodTicks: 20,
  maxEscalatedRadiusFactor: 1.5,
} as const;

/**
 * Deterministic structural validation of a generated disaster stage (called from `validateStageDef`).
 * A stage with any error must not launch. Returns [] for stages without disaster metadata.
 */
export function validateDisasterMeta(def: StageDef): string[] {
  const d = def.disaster;
  if (!d) return [];
  const errs: string[] = [];
  const err = (m: string) => errs.push(`disaster ${d.id}: ${m}`);
  const L = DISASTER_LIMITS;

  // --- schedule: strictly increasing, and fair ---
  const s = d.schedule;
  if (!(s.activateAtTick < s.escalateAtTick)) err('activateAtTick must be before escalateAtTick');
  if (!(s.escalateAtTick < s.failAtTick)) err('escalateAtTick must be before failAtTick');
  if (s.escalateAtTick < L.minEscalateAtTick) err(`escalateAtTick ${s.escalateAtTick} gives the team less than ${L.minEscalateAtTick} ticks`);
  if (s.failAtTick - s.escalateAtTick < L.minEscalationToFailTicks) err(`failAtTick is less than ${L.minEscalationToFailTicks} ticks after escalation`);
  if (s.failedHoldTicks > L.maxFailedHoldTicks) err(`failedHoldTicks ${s.failedHoldTicks} exceeds ${L.maxFailedHoldTicks}`);

  // --- bounded effects ---
  if (d.heat.perSecond > L.maxHeatPerSecond) err(`heat.perSecond ${d.heat.perSecond} exceeds ${L.maxHeatPerSecond}`);
  if (d.heat.cap > L.maxHeatCap) err(`heat.cap ${d.heat.cap} exceeds ${L.maxHeatCap}`);
  if (d.failPenalty > L.maxFailPenalty) err(`failPenalty ${d.failPenalty} exceeds ${L.maxFailPenalty}`);

  // --- resolution ---
  const objectives = new Set(def.objectives.map((o) => o.id));
  for (const o of d.resolveObjectives) if (!objectives.has(o)) err(`resolveObjectives references unknown objective ${o}`);

  // --- hazards: every hazard needs a readable warning, a valid countermeasure and a repair path ---
  const hazards = new Map(def.hazards.map((h) => [h.id, h]));
  const threatFor = new Map<string, number>();
  for (const t of d.threats) {
    threatFor.set(t.hazardId, (threatFor.get(t.hazardId) ?? 0) + 1);
    const h = hazards.get(t.hazardId);
    if (!h) { err(`threat references unknown hazard ${t.hazardId}`); continue; }
    if (!t.warning.trim()) err(`threat ${t.hazardId} has an empty warning`);
    if (!t.repair.trim()) err(`threat ${t.hazardId} has an empty repair path`);
    const spec = TOOL_SPECS[t.countermeasure];
    const counters = spec.protectsFrom.includes(h.kind) || spec.stabilizes.includes(h.kind);
    if (!counters) err(`threat ${t.hazardId}: ${t.countermeasure} is not a countermeasure for ${h.kind}`);
    if (!def.loadout.includes(t.countermeasure)) err(`threat ${t.hazardId}: loadout lacks countermeasure ${t.countermeasure}`);
  }
  for (const h of def.hazards) {
    const n = threatFor.get(h.id) ?? 0;
    if (n === 0) err(`hazard ${h.id} has no threat entry (warning + countermeasure + repair path)`);
    if (n > 1) err(`hazard ${h.id} has ${n} threat entries`);
  }
  for (const hp of d.hazardPhases) {
    const h = hazards.get(hp.hazardId);
    if (!h) { err(`hazardPhases references unknown hazard ${hp.hazardId}`); continue; }
    const e = hp.escalated;
    if (e?.periodTicks !== undefined && e.periodTicks < L.minEscalatedPeriodTicks) err(`escalated period for ${h.id} is below ${L.minEscalatedPeriodTicks} ticks`);
    if (e?.r !== undefined && e.r > h.r * L.maxEscalatedRadiusFactor) err(`escalated radius for ${h.id} exceeds ${L.maxEscalatedRadiusFactor}x its base radius`);
    if (e?.periodTicks !== undefined && h.kind !== 'arc_discharge') err(`${h.id}: only arc discharges pulse, so periodTicks does not apply to ${h.kind}`);
  }
  for (const h of def.hazards) if (h.kind === 'arc_discharge' && !d.hazardPhases.some((x) => x.hazardId === h.id)) err(`arc hazard ${h.id} is not controlled by the lifecycle`);

  // --- tool charges: more welds than the welder holds is only fair if a supply cache can refill it ---
  const welds = def.objectives.filter((o) => o.params.kind === 'repair_breakpoint').length;
  if (welds > TOOL_SPECS.flux_welder.maxCharges && !def.entities.some((e) => e.kind === 'supply_cache')) err(`${welds} repairs exceed the welder's ${TOOL_SPECS.flux_welder.maxCharges} charges and the stage has no supply cache`);
  // --- scan gating must not deadlock: a breakpoint cannot require (even indirectly) its own repair before it can be scanned ---
  const prereqs = new Map(def.objectives.map((o) => [o.id, o.prerequisites]));
  const closure = (ids: readonly string[]): Set<string> => {
    const seen = new Set<string>();
    const stack = [...ids];
    while (stack.length) {
      const id = stack.pop()!;
      if (seen.has(id)) continue;
      seen.add(id);
      stack.push(...(prereqs.get(id) ?? []));
    }
    return seen;
  };
  for (const b of def.breakpoints) {
    const needed = closure(b.scanRequires);
    for (const o of def.objectives) {
      if (o.params.kind === 'repair_breakpoint' && o.params.breakpointId === b.id && needed.has(o.id)) err(`breakpoint ${b.id} cannot be scanned until its own repair objective ${o.id} is complete (deadlock)`);
    }
  }
  // --- public text must never name hidden breakpoints ---
  const hidden = [
    ...def.breakpoints.flatMap((b) => [b.id, b.label]),
    ...def.failures.filter((f) => f.kind === 'breakpoint').flatMap((f) => [f.id, f.label]),
  ].map((x) => x.toLowerCase());
  const publicText = [...Object.values(d.messages), ...d.threats.flatMap((t) => [t.warning, t.repair]), d.name, def.name].map((x) => x.toLowerCase());
  for (const text of publicText) for (const secret of hidden) if (text.includes(secret)) err(`public text leaks hidden breakpoint "${secret}"`);

  return errs;
}
