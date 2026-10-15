import { INTERACT_RANGE, RANGE_DY, TOOL_SPECS, type StageState, type ToolId } from '@wb/shared';

/**
 * Client-side *convenience* picking: which nearby thing does a keypress refer to?
 * It only fills in `targetId`; the server re-validates range, ownership, compatibility and prerequisites.
 */
type Pt = { x: number; y: number };
const near = (me: Pt, p: Pt, range: number) => Math.abs(me.x - p.x) <= range && Math.abs(me.y - p.y) <= RANGE_DY;
const pick = (me: Pt, items: { id: string; x: number; y: number }[], range: number): string | null => {
  let best: { id: string; d: number } | null = null;
  for (const it of items) {
    if (!near(me, it, range)) continue;
    const d = Math.abs(me.x - it.x);
    if (!best || d < best.d) best = { id: it.id, d };
  }
  return best?.id ?? null;
};

export function conduitMid(state: StageState, conduit: StageState['power']['conduits'][number]): Pt {
  const a = state.power.nodes.find((n) => n.id === conduit.from)!;
  const b = state.power.nodes.find((n) => n.id === conduit.to)!;
  return { x: (a.x + b.x) / 2, y: Math.max(a.y, b.y) };
}

export function nearestInteractable(state: StageState, me: Pt): string | null {
  return pick(me, state.entities, INTERACT_RANGE);
}

export function targetForTool(state: StageState, me: Pt, tool: ToolId): string | undefined {
  const range = TOOL_SPECS[tool].range;
  if (tool === 'flux_welder') {
    const candidates = [
      ...state.breakpoints.filter((b) => !b.repaired),
      ...state.entities.filter((e) => e.kind === 'decoy_panel'),
      ...state.power.conduits.filter((c) => c.condition !== 'ok').map((c) => ({ id: c.id, ...conduitMid(state, c) })),
    ];
    return pick(me, candidates, range) ?? undefined;
  }
  if (tool === 'power_cell') {
    return pick(me, state.power.nodes.filter((n) => n.kind === 'consumer' && !n.powered), range) ?? undefined;
  }
  return undefined;
}

/** Label of what E would act on, for the on-screen prompt. */
export function interactPrompt(state: StageState, me: Pt): { id: string; label: string; state: string } | null {
  const id = nearestInteractable(state, me);
  const e = id ? state.entities.find((x) => x.id === id) : null;
  return e ? { id: e.id, label: e.label, state: e.state } : null;
}

export const TOOL_KEYS: readonly ToolId[] = ['phase_scanner', 'flux_welder', 'gravity_anchor', 'power_cell', 'shield_projector'];
