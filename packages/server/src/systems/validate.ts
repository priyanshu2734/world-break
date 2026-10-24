import { ABILITY_SPECS, ITEM_LIMITS, MOVE_SPEED, TICK_DT, TOOL_SPECS, validateRoomGraph, type Arena, type ItemKind } from '@wb/shared';
import type { StageDef } from './stageDef';
import { topoOrder } from './failures';
import { evaluatePower } from './power';
import { validateDisasterMeta } from '../disasters/validate';
import { surfaceBelow } from '../salvage/rest';
import { validateSalvage } from '../salvage/validate';
import { validateEscape } from '../rooms/escapeValidate';

/**
 * Deterministic structural validation. A stage that returns any error must not launch.
 * (This proves structural solvability; the tutorial's physical solvability is proven by driving the
 * real simulation in tests.)
 */
/** Ticks of slack between starting a Freeze and finishing the channel it protects. */
export const FREEZE_CHANNEL_SLACK_TICKS = 10;

export function validateStageDef(def: StageDef, arena: Arena): string[] {
  const errs: string[] = [];
  const err = (m: string) => errs.push(m);

  if (def.arenaId !== arena.id) err(`arena mismatch: ${def.arenaId} vs ${arena.id}`);

  // --- unique ids ---
  const dupes = (label: string, ids: string[]) => {
    const seen = new Set<string>();
    for (const id of ids) { if (seen.has(id)) err(`duplicate ${label} id: ${id}`); seen.add(id); }
  };
  dupes('failure', def.failures.map((f) => f.id));
  dupes('objective', def.objectives.map((o) => o.id));
  dupes('hazard', def.hazards.map((h) => h.id));
  dupes('clue', def.clues.map((c) => c.id));
  // targetable ids share one namespace (clients address them by id)
  dupes('target', [...def.entities.map((e) => e.id), ...def.breakpoints.map((b) => b.id),
    ...def.power.nodes.map((n) => n.id), ...def.power.conduits.map((c) => c.id), ...(def.props ?? []).map((p) => p.id)]);

  const failure = new Map(def.failures.map((f) => [f.id, f]));
  const entity = new Map(def.entities.map((e) => [e.id, e]));
  const node = new Map(def.power.nodes.map((n) => [n.id, n]));
  const conduit = new Map(def.power.conduits.map((c) => [c.id, c]));
  const bp = new Map(def.breakpoints.map((b) => [b.id, b]));
  const obj = new Map(def.objectives.map((o) => [o.id, o]));

  // --- failure graph ---
  for (const e of def.edges) {
    if (!failure.has(e.from) || !failure.has(e.to)) err(`edge references unknown failure: ${e.from} -> ${e.to}`);
    else if (failure.get(e.to)!.kind === 'breakpoint') err(`breakpoint ${e.to} is a root cause and cannot have a parent`);
  }
  if (topoOrder(def.failures, def.edges) === null) err('failure graph has a cycle');
  for (const f of def.failures) {
    if (f.kind === 'symptom' && !def.edges.some((e) => e.to === f.id)) err(`symptom ${f.id} has no cause`);
    if (f.kind === 'breakpoint' && !def.breakpoints.some((b) => b.failureId === f.id)) err(`breakpoint failure ${f.id} has no breakpoint`);
    if (f.kind === 'fault' && !def.power.faultBindings.some((b) => b.failureId === f.id)) err(`fault ${f.id} is not bound to a consumer`);
  }
  for (const b of def.breakpoints) {
    if (failure.get(b.failureId)?.kind !== 'breakpoint') err(`breakpoint ${b.id} must reference a breakpoint failure`);
    for (const r of b.scanRequires) if (!obj.has(r)) err(`breakpoint ${b.id} scanRequires unknown objective ${r}`);
  }
  for (const fb of def.power.faultBindings) {
    if (node.get(fb.consumerId)?.kind !== 'consumer') err(`fault binding ${fb.failureId}: ${fb.consumerId} is not a consumer`);
    if (failure.get(fb.failureId)?.kind !== 'fault') err(`fault binding ${fb.failureId} must reference a fault failure`);
  }

  // --- power network ---
  for (const c of def.power.conduits) {
    if (!node.has(c.from) || !node.has(c.to)) err(`conduit ${c.id} references unknown node`);
    if (c.switchEntityId) {
      const s = entity.get(c.switchEntityId);
      if (!s || s.kind !== 'power_switch' || s.conduitId !== c.id) err(`conduit ${c.id} switch ${c.switchEntityId} is not a matching power_switch`);
    }
  }
  for (const e of def.entities) {
    if (e.kind === 'power_switch') {
      const c = conduit.get(e.conduitId);
      if (!c) err(`switch ${e.id} controls unknown conduit ${e.conduitId}`);
      else if (c.switchEntityId !== e.id) err(`switch ${e.id} is not registered on conduit ${c.id}`);
    }
    if (e.kind === 'decoy_panel' && !failure.has(e.mitigates)) err(`decoy ${e.id} mitigates unknown failure`);
    if ((e.kind === 'sync_console' || e.kind === 'core_console' || e.kind === 'pressure_plate') && !obj.has(e.objectiveId)) err(`${e.id} references unknown objective`);
    if (e.kind === 'core_console' && node.get(e.consumerId)?.kind !== 'consumer') err(`core console ${e.id} needs a consumer node`);
  }

  // --- positions: everything players must reach stands on a solid inside the arena ---
  const stands = (x: number, y: number) => arena.solids.some((s) => Math.abs(s.y - y) < 1e-6 && x >= s.x && x <= s.x + s.w);
  const place = (what: string, id: string, x: number, y: number) => { if (!stands(x, y)) err(`${what} ${id} (${x},${y}) is not standing on a platform`); };
  for (const e of def.entities) place('entity', e.id, e.x, e.y);
  for (const b of def.breakpoints) place('breakpoint', b.id, b.x, b.y);
  for (const n of def.power.nodes) place('power node', n.id, n.x, n.y);

  // --- objectives ---
  for (const o of def.objectives) {
    for (const p of o.prerequisites) if (!obj.has(p)) err(`objective ${o.id} has unknown prerequisite ${p}`);
  }
  if (topoOrder(def.objectives, def.objectives.flatMap((o) => o.prerequisites.map((p) => ({ from: p, to: o.id })))) === null)
    err('objective prerequisites have a cycle');

  const needs = new Set<string>(); // tools the stage cannot be finished without
  for (const o of def.objectives) {
    const p = o.params;
    if (p.kind === 'repair_breakpoint') {
      const b = bp.get(p.breakpointId);
      if (!b) { err(`objective ${o.id} references unknown breakpoint`); continue; }
      if (!b.weldable) err(`breakpoint ${b.id} is not weldable, so objective ${o.id} is unsolvable`);
      needs.add('flux_welder'); needs.add('phase_scanner');
    } else if (p.kind === 'power_route') {
      if (node.get(p.consumerId)?.kind !== 'consumer') { err(`objective ${o.id}: ${p.consumerId} is not a consumer`); continue; }
      const sw = def.entities.filter((e) => e.kind === 'power_switch');
      if (sw.length > 16) err('too many switches to validate');
      let solvable = false;
      for (let mask = 0; mask < 1 << Math.min(sw.length, 16) && !solvable; mask++) {
        const closed = new Set(sw.filter((_, i) => mask & (1 << i)).map((s) => s.conduitId));
        const ev = evaluatePower(def.power.nodes, def.power.conduits, def.power.capacity, (cid) => {
          const c = conduit.get(cid)!;
          const intact = c.condition !== 'melted'; // damaged conduits are weldable, so reachable after repair
          return intact && (!c.switchEntityId || closed.has(cid));
        });
        solvable = ev.poweredConsumers.has(p.consumerId) && !ev.overloaded;
      }
      if (!solvable) err(`objective ${o.id}: no valid switch configuration powers ${p.consumerId} within capacity`);
      for (const s of p.sealSwitches) if (entity.get(s)?.kind !== 'power_switch') err(`objective ${o.id} seals unknown switch ${s}`);
    } else if (p.kind === 'timed_controls') {
      const cs = p.controls.map((id) => entity.get(id));
      const plates = cs.filter((c) => c?.kind === 'pressure_plate').length;
      if (plates > 0) { // P3B: plates are pressed, not armed: all of them must be pressed at the same moment
        if (plates !== cs.length) err(`objective ${o.id}: controls must be all pressure_plates or all sync_consoles`);
        else if (p.armTicks !== 1) err(`objective ${o.id}: plate objectives need armTicks 1 (pressed at the same moment)`);
        for (const c of cs) if (c?.kind === 'pressure_plate' && c.objectiveId !== o.id) err(`plate ${c.id} belongs to ${c.objectiveId}, not ${o.id}`);
        continue;
      }
      if (cs.some((c) => c?.kind !== 'sync_console')) { err(`objective ${o.id}: every control must be a sync_console`); continue; }
      let dist = 0;
      for (let i = 1; i < cs.length; i++) dist += Math.hypot(cs[i]!.x - cs[i - 1]!.x, cs[i]!.y - cs[i - 1]!.y);
      const minTicks = Math.ceil(dist / (MOVE_SPEED * TICK_DT)) * 2; // 2x slack over straight-line walking
      if (p.armTicks < minTicks) err(`objective ${o.id}: armTicks ${p.armTicks} too short for one player to reach every control (needs >= ${minTicks})`);
    } else {
      const core = entity.get(p.entityId);
      if (core?.kind !== 'core_console') { err(`objective ${o.id}: ${p.entityId} is not a core_console`); continue; }
      const consumer = core.consumerId;
      const grid = def.power.conduits.some((c) => c.condition !== 'melted' && (c.from === consumer || c.to === consumer));
      if (!grid) needs.add('power_cell');
      if (p.needsStableHazard) {
        const h = def.hazards.find((x) => x.id === p.needsStableHazard);
        if (!h) err(`objective ${o.id} references unknown hazard`); else if (h.kind === 'gravity_flux') needs.add('gravity_anchor');
      }
      for (const h of def.hazards) if (h.kind === 'arc_discharge' && (!h.armedWhenObjective || h.armedWhenObjective === o.id)) {
        // P3B: with no shield in the loadout, the Freeze ability can hold the arc for the whole channel (with slack for walking up).
        const freezeCovers = !def.loadout.includes('shield_projector') && !!def.abilities?.enabled.includes('freeze')
          && ABILITY_SPECS.freeze.durationTicks >= p.requiredTicks + FREEZE_CHANNEL_SLACK_TICKS;
        if (freezeCovers) continue;
        needs.add('shield_projector');
        if (TOOL_SPECS.shield_projector.durationTicks < p.requiredTicks)
          err(`objective ${o.id}: shield (${TOOL_SPECS.shield_projector.durationTicks} ticks) cannot cover the ${p.requiredTicks}-tick channel`);
      }
      if (p.needsStableHazard && TOOL_SPECS.gravity_anchor.durationTicks < p.requiredTicks)
        err(`objective ${o.id}: anchor cannot outlast the channel`);
    }
  }
  for (const t of needs) if (!def.loadout.includes(t as never)) err(`loadout lacks required tool ${t}`);

  for (const h of def.hazards) if (h.kind === 'arc_discharge' && (!h.periodTicks || h.firstPulseTick === undefined)) err(`arc hazard ${h.id} needs periodTicks and firstPulseTick`);
  for (const h of def.hazards) if (h.armedWhenObjective && !obj.has(h.armedWhenObjective)) err(`hazard ${h.id} references unknown objective`);
  // --- P3B: props and abilities (both optional; absent = a P2/P3A stage) ---
  const crateHalf = 16;
  for (const pr of def.props ?? []) {
    place('prop', pr.id, pr.x, pr.y);
    const top = arena.solids.find((s) => Math.abs(s.y - pr.y) < 1e-6 && pr.x >= s.x && pr.x <= s.x + s.w);
    if (top && (pr.x - crateHalf < top.x || pr.x + crateHalf > top.x + top.w)) err(`prop ${pr.id} overhangs its platform`);
  }
  for (const h of def.hazards) if ((def.props ?? []).some((pr) => pr.id === h.id)) err(`prop and hazard share id ${h.id}`);
  if (def.abilities) {
    const a = def.abilities;
    if (new Set(a.enabled).size !== a.enabled.length) err('abilities.enabled has duplicates');
    if (a.energyStart > a.energyMax) err('abilities.energyStart exceeds energyMax');
    if (a.enabled.includes('duplicate') && !(def.props ?? []).some((pr) => pr.light)) {
      // allowed (rotation stages have no props), but a stage that enables Duplicate and ships only heavy props is a mistake
      if ((def.props ?? []).length > 0) err('duplicate is enabled but no prop is light');
    }
  }
  // --- P3C: salvage items and the needs of repair targets (both optional; absent = a P2/P3A/P3B stage) ---
  const items = def.items ?? [];
  const needDefs = def.needs ?? [];
  if (items.length > ITEM_LIMITS.maxItemsPerStage) err(`too many items (${items.length} > ${ITEM_LIMITS.maxItemsPerStage})`);
  if (needDefs.length > ITEM_LIMITS.maxNeedsPerStage) err(`too many targets with needs (${needDefs.length} > ${ITEM_LIMITS.maxNeedsPerStage})`);
  dupes('item', items.map((i) => i.id));
  dupes('need', needDefs.map((n) => n.targetId));
  const targetIds = new Set<string>([...def.entities.map((e) => e.id), ...def.breakpoints.map((b) => b.id),
    ...def.power.nodes.map((n) => n.id), ...def.power.conduits.map((c) => c.id), ...(def.props ?? []).map((p) => p.id)]);
  for (const i of items) {
    if (targetIds.has(i.id)) err(`item ${i.id} shares an id with a target`);
    if (def.escape) continue; // P3D: parts of an escape stage are placed per room and checked by `validateEscape`
    if (i.x < 0 || i.x > arena.width) { err(`item ${i.id} is outside the arena`); continue; }
    const surf = surfaceBelow(arena, i.x, i.y);
    if (!surf) err(`item ${i.id} (${i.x},${i.y}) has no platform under it`);
    else if (surf.y - i.y > ITEM_LIMITS.maxAuthoredFall) err(`item ${i.id} would fall ${Math.round(surf.y - i.y)} px to its platform (max ${ITEM_LIMITS.maxAuthoredFall}); author it on the platform`);
  }
  for (const n of needDefs) {
    const isBp = bp.has(n.targetId), isConduit = conduit.has(n.targetId), isEntity = entity.has(n.targetId);
    if (!isBp && !isConduit && !isEntity) { err(`need references unknown target ${n.targetId} (must be a breakpoint, conduit or entity)`); continue; }
    // Every needed kind must exist at least as many times as needed among the genuine (non-decoy) items.
    const counts = new Map<ItemKind, number>();
    for (const k of n.items) counts.set(k, (counts.get(k) ?? 0) + 1);
    for (const [k, c] of counts) {
      const have = items.filter((i) => i.kind === k && i.decoy !== true).length;
      if (have < c) err(`target ${n.targetId} needs ${c} x ${k} but the stage provides ${have} genuine one(s)`);
    }
  }
  if (def.objectives.length === 0 && !def.escape) err('a stage needs at least one objective');
  if (def.escape && !def.rooms) err('escape: a stage with an escape spec needs rooms');
  if (def.escape && def.rooms) errs.push(...validateEscape(def.escape, def.rooms, def));
  if (def.rooms) {
    errs.push(...validateRoomGraph(def.rooms)); // P3D: structure of the room chain
    const start = def.rooms.rooms.find((r) => r.id === def.rooms!.start);
    if (start && start.arena.id !== def.arenaId) err(`rooms: arenaId ${def.arenaId} must be the start room's arena ${start.arena.id}`);
  }
  // An escape stage's parts live in different rooms: `validateEscape` checks them per room, the single-arena salvage rules would not apply.
  if (!def.escape) errs.push(...validateSalvage(def, arena)); // P3C: hiding rules, reachability, solo-safe supply (no-op without items/needs/stashes)
  errs.push(...validateDisasterMeta(def)); // P3A: lifecycle, bounds, threats (no-op without def.disaster)
  return errs;
}
