import { ITEM_LIMITS, itemShape, type Arena, type ItemKind } from '@wb/shared';
import type { StageDef } from '../systems/stageDef';
import { platformIndex, reachableFrom } from './reach';

/**
 * P3C solvability checks for salvage stages. Everything here is about ONE player (the solver must prove solo-safety):
 *  - every mandatory need has a distinct, genuine (non-decoy) part that is revealable, reachable on foot (or through a declared and
 *    enabled ability gate) and can be carried from where it lies to the target (a bipartite matching, so parts are never counted twice);
 *  - hiding rules are consistent (scan needs the Scanner, interact needs a real stash, gates need their ability);
 *  - the 2-slot limit: installs persist, so a heavy part (2 slots) is one trip and two light parts share a trip; the total number of
 *    trips is bounded (`maxTripsPerStage`).
 * Platform reachability uses the real physics (see reach.ts). Hazards, crates and timing are NOT modelled here: authored stages
 * are additionally proven by driving the real simulation with the planner bot (tests).
 * Returns error strings (empty = fine). No-op for a stage without items, needs or stashes.
 */
export function validateSalvage(def: StageDef, arena: Arena): string[] {
  const items = def.items ?? [];
  const needs = def.needs ?? [];
  const stashes = def.stashes ?? [];
  if (items.length === 0 && needs.length === 0 && stashes.length === 0) return [];
  const errs: string[] = [];
  const err = (m: string) => errs.push(m);

  // ---- stashes
  const seen = new Set<string>();
  const itemIds = new Set(items.map((i) => i.id));
  const targetIds = new Set<string>([...def.entities.map((e) => e.id), ...def.breakpoints.map((b) => b.id),
    ...def.power.nodes.map((n) => n.id), ...def.power.conduits.map((c) => c.id), ...(def.props ?? []).map((p) => p.id)]);
  if (stashes.length > ITEM_LIMITS.maxStashesPerStage) err(`too many stashes (${stashes.length} > ${ITEM_LIMITS.maxStashesPerStage})`);
  for (const st of stashes) {
    if (seen.has(st.id)) err(`duplicate stash id: ${st.id}`);
    seen.add(st.id);
    if (itemIds.has(st.id) || targetIds.has(st.id)) err(`stash ${st.id} shares an id with an item or a target`);
    if (!arena.solids.some((s) => Math.abs(s.y - st.y) < 1e-6 && st.x >= s.x && st.x <= s.x + s.w)) err(`stash ${st.id} (${st.x},${st.y}) is not standing on a platform`);
  }
  const stashById = new Map(stashes.map((s) => [s.id, s]));

  // ---- reachability for one player starting at spawn 0
  const spawn = arena.spawns[0];
  const start = spawn ? platformIndex(arena, spawn.x, spawn.y) : -1;
  if (start < 0) { err('the arena has no usable spawn platform'); return errs; }
  const onFoot = reachableFrom(arena, start);
  const enabled = new Set<string>(def.abilities?.enabled ?? []);
  /** Checks a spot against foot reach and its declared gate. Returns the platform index (or -1 if the spot is already reported). */
  const access = (what: string, x: number, y: number, gate: string | undefined): number => {
    const idx = platformIndex(arena, x, y);
    if (idx < 0) { err(`${what} has no platform under it`); return -1; }
    if (onFoot.has(idx)) {
      if (gate) err(`${what} declares the ${gate} gate but a lone player can walk there`);
    } else if (!gate) err(`${what} cannot be reached on foot by one player (move it, or declare an ability gate)`);
    else if (!enabled.has(gate)) err(`${what} needs the ${gate} ability but the stage does not enable it`);
    return idx;
  };

  // ---- items: hiding and gates
  const itemPlatform = new Map<string, number>();
  for (const it of items) {
    const h = it.hidden;
    if (it.tell && !it.decoy) err(`item ${it.id} has a tell but is not a decoy`);
    if (h?.reveal === 'scan') {
      if (!def.loadout.includes('phase_scanner')) err(`item ${it.id} is revealed by scanning but the loadout has no phase_scanner`);
      if (h.stashId) err(`item ${it.id} is revealed by scanning and must not name a stash`);
    }
    if (h?.reveal === 'interact') {
      if (!h.stashId) err(`item ${it.id} is revealed by interacting and needs a stashId`);
      else {
        const st = stashById.get(h.stashId);
        if (!st) err(`item ${it.id} names unknown stash ${h.stashId}`);
        else access(`stash ${st.id} (holds ${it.id})`, st.x, st.y, st.gate);
      }
    } else if (h?.stashId) err(`item ${it.id} names a stash but is not revealed by interacting`);
    itemPlatform.set(it.id, access(`item ${it.id}`, it.x, it.y, it.gate));
  }
  for (const st of stashes) if (!items.some((i) => i.hidden?.stashId === st.id)) {
    // an empty stash is allowed (a decoy container), but it must still be reachable or it is just clutter
    access(`stash ${st.id}`, st.x, st.y, st.gate);
  }

  // ---- needs: targets, tools, and a distinct reachable genuine part for every demand
  const entity = new Map(def.entities.map((e) => [e.id, e]));
  const bp = new Map(def.breakpoints.map((b) => [b.id, b]));
  const conduit = new Map(def.power.conduits.map((c) => [c.id, c]));
  const node = new Map(def.power.nodes.map((n) => [n.id, n]));
  const spotOf = (id: string): { x: number; y: number } | null => {
    const b = bp.get(id); if (b) return { x: b.x, y: b.y };
    const c = conduit.get(id);
    if (c) { const a = node.get(c.from), n = node.get(c.to); return a && n ? { x: (a.x + n.x) / 2, y: Math.max(a.y, n.y) } : null; }
    const e = entity.get(id); return e ? { x: e.x, y: e.y } : null;
  };

  interface Demand { targetId: string; kind: ItemKind; cands: string[] }
  const demands: Demand[] = [];
  let trips = 0;
  for (const n of needs) {
    const spot = spotOf(n.targetId);
    if (!spot) continue; // reported by the structural check
    const e = entity.get(n.targetId);
    if (e?.kind === 'decoy_panel') continue; // a decoy target is never mandatory
    const tIdx = access(`need target ${n.targetId}`, spot.x, spot.y, undefined);
    for (const t of n.tools ?? []) {
      if (t !== 'flux_welder') err(`need on ${n.targetId} lists tool ${t}: only flux_welder can be required (it is the tool that finishes a breakpoint or conduit)`);
      if (!bp.has(n.targetId) && !conduit.has(n.targetId)) err(`need on ${n.targetId} lists a tool, but only breakpoints and conduits are finished with a tool`);
      if (!def.loadout.includes(t)) err(`need on ${n.targetId} requires ${t} but the loadout lacks it`);
    }
    let heavy = 0, light = 0;
    for (const kind of n.items) {
      if (itemShape(kind) === 'heavy') heavy++; else light++;
      const cands: string[] = [];
      for (const it of items) {
        if (it.kind !== kind || it.decoy === true) continue;
        const p = itemPlatform.get(it.id) ?? -1;
        if (p < 0 || tIdx < 0) continue;
        // the part must be carried from its platform to the target (path from the item's platform; an ability-gated spot is entered by ability)
        if (reachableFrom(arena, p).has(tIdx)) cands.push(it.id);
      }
      demands.push({ targetId: n.targetId, kind, cands });
    }
    trips += heavy + Math.ceil(light / 2);
  }
  if (trips > ITEM_LIMITS.maxTripsPerStage) err(`a lone player would need ${trips} trips to carry every part with ${ITEM_LIMITS.carrySlots} slots (max ${ITEM_LIMITS.maxTripsPerStage})`);

  // bipartite matching (Kuhn): no part may serve two demands
  const owner = new Map<string, number>();
  const tryAssign = (d: number, visited: Set<string>): boolean => {
    for (const id of demands[d]!.cands) {
      if (visited.has(id)) continue;
      visited.add(id);
      const cur = owner.get(id);
      if (cur === undefined || tryAssign(cur, visited)) { owner.set(id, d); return true; }
    }
    return false;
  };
  demands.forEach((d, i) => {
    if (!tryAssign(i, new Set())) err(`need on ${d.targetId} cannot be met: no distinct, genuine, reachable ${d.kind} that one player can carry to it`);
  });
  return errs;
}
