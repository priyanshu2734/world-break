import {
  ABILITY_SPECS, SERVER_TICK_HZ, TOOL_SPECS, type AbilityAction, type AbilityId, type ActiveAbilityId, type Prop, type StageState,
} from '@wb/shared';

/**
 * Presentation-only helpers for Reality Energy and the ability slots (P3B). They read the PUBLIC state only and fill in
 * convenience targets; the server re-validates ownership, range, cooldown, energy, caps and rate for every intent.
 */
export const ABILITY_SLOT_ORDER: readonly AbilityId[] = ['anchor', 'gravity_well', 'freeze', 'duplicate', 'momentum'];
export const ABILITY_KEY_LABEL: Record<AbilityId, string> = { anchor: '3', gravity_well: '6', freeze: '7', duplicate: '8', momentum: '9' };
const SHORT: Record<AbilityId, string> = { anchor: 'Anchor', gravity_well: 'Well', freeze: 'Freeze', duplicate: 'Clone', momentum: 'Momentum' };

export type SlotStatus = 'ready' | 'cooldown' | 'no_energy' | 'empty' | 'unavailable';
export interface SlotView {
  ability: AbilityId;
  key: string;
  label: string;
  cost: number;
  status: SlotStatus;
  cooldownSeconds: number;
  /** Second line of the slot (charges for the anchor, cost otherwise). */
  detail: string;
}
export interface EnergyView { energy: number; max: number; fraction: number }

export function energyView(st: Pick<StageState, 'abilities'> | null, localId: string): EnergyView | null {
  const a = st?.abilities;
  const me = a?.players.find((p) => p.id === localId);
  if (!a || !me) return null;
  return { energy: me.energy, max: a.energyMax, fraction: Math.max(0, Math.min(1, me.energy / a.energyMax)) };
}

export function abilitySlots(st: StageState | null, localId: string, tick: number): SlotView[] {
  const a = st?.abilities;
  if (!st || !a) return [];
  const me = a.players.find((p) => p.id === localId);
  return ABILITY_SLOT_ORDER.map((ability): SlotView => {
    const spec = ABILITY_SPECS[ability];
    const base = { ability, key: ABILITY_KEY_LABEL[ability], label: SHORT[ability], cost: spec.energyCost };
    if (!a.enabled.includes(ability) || !me) return { ...base, status: 'unavailable', cooldownSeconds: 0, detail: '-' };
    if (ability === 'anchor') { // the P2 tool: charges and cooldown live with the tools
      const inv = st.players.find((p) => p.id === localId)?.tools.find((t) => t.tool === 'gravity_anchor');
      if (!inv) return { ...base, status: 'unavailable', cooldownSeconds: 0, detail: '-' };
      const cd = Math.max(0, inv.cooldownUntilTick - tick) / SERVER_TICK_HZ;
      const status: SlotStatus = inv.charges === 0 ? 'empty' : cd > 0 ? 'cooldown' : 'ready';
      return { ...base, status, cooldownSeconds: cd, detail: `${inv.charges}/${TOOL_SPECS.gravity_anchor.maxCharges}` };
    }
    const until = me.cooldowns.find((c) => c.ability === ability)?.cooldownUntilTick ?? 0;
    const cd = Math.max(0, until - tick) / SERVER_TICK_HZ;
    const status: SlotStatus = cd > 0 ? 'cooldown' : me.energy < spec.energyCost ? 'no_energy' : 'ready';
    return { ...base, status, cooldownSeconds: cd, detail: `${spec.energyCost} en` };
  });
}

// ---------------------------------------------------------------- aiming (convenience only)
type Pt = { x: number; y: number };
export interface AimContext {
  me: Pt & { facing: 1 | -1 };
  /** Mouse position in world coordinates, or null if the pointer has not been seen. */
  pointer: Pt | null;
  props: readonly Prop[];
  hazards: StageState['hazards'];
  dir: { up: boolean; down: boolean; left: boolean; right: boolean };
  /** Shift: reduce instead of flip (well), cancel instead of push (momentum). */
  modifier: boolean;
}
export type AimResult = { ok: true; action: AbilityAction } | { ok: false; reason: string };

const BODY_MID = 20;
const d = (a: Pt, b: Pt) => Math.hypot(a.x - b.x, a.y - b.y);
const mid = (p: Prop): Pt => ({ x: p.x, y: p.y - p.h / 2 });

/** Pull `target` toward `from` so it lies within `range` (a convenience; the server checks the real distance). */
export function clampToRange(from: Pt, target: Pt, range: number): Pt {
  const dist = d(from, target), max = range * 0.96;
  if (dist <= max || dist === 0) return { x: target.x, y: target.y };
  const k = max / dist;
  return { x: from.x + (target.x - from.x) * k, y: from.y + (target.y - from.y) * k };
}

export function buildAbilityAction(ability: ActiveAbilityId, c: AimContext): AimResult {
  const body: Pt = { x: c.me.x, y: c.me.y - BODY_MID };
  const spec = ABILITY_SPECS[ability];
  /** Without a mouse, things are picked by nearness to the player; only the well needs a point, so it defaults to ahead. */
  const ref: Pt = c.pointer ?? body;
  const aim: Pt = c.pointer ?? { x: body.x + c.me.facing * 140, y: body.y };
  const nearestTo = <T extends { at: Pt }>(items: T[], ref: Pt, within: (i: T) => number): T | null => {
    let best: { i: T; dist: number } | null = null;
    for (const i of items) {
      const dist = d(ref, i.at);
      if (d(body, i.at) > within(i)) continue;
      if (!best || dist < best.dist) best = { i, dist };
    }
    return best?.i ?? null;
  };

  switch (ability) {
    case 'gravity_well': {
      const p = clampToRange(body, aim, spec.range);
      return { ok: true, action: { ability, x: Math.round(p.x), y: Math.round(p.y), mode: c.modifier ? 'reduce' : 'flip' } };
    }
    case 'freeze': {
      const cands = [
        ...c.props.map((p) => ({ id: p.id, at: mid(p), reach: spec.range })),
        ...c.hazards.filter((h) => h.kind !== 'gravity_flux').map((h) => ({ id: h.id, at: { x: h.x, y: h.y }, reach: spec.range + h.r })),
      ];
      const t = nearestTo(cands, ref, (i) => i.reach);
      return t ? { ok: true, action: { ability, targetId: t.id } } : { ok: false, reason: 'Nothing to freeze nearby.' };
    }
    case 'duplicate': {
      const cands = c.props.filter((p) => p.light && !p.cloneOf).map((p) => ({ id: p.id, at: mid(p) }));
      const t = nearestTo(cands, ref, () => spec.range);
      if (!t) return { ok: false, reason: 'No light object in reach to duplicate.' };
      const where = c.pointer ?? { x: body.x + c.me.facing * 70, y: body.y };
      const p = clampToRange(body, where, spec.range);
      return { ok: true, action: { ability, targetId: t.id, x: Math.round(p.x), y: Math.round(p.y) } };
    }
    case 'momentum': {
      const cands = c.props.map((p) => ({ id: p.id, at: mid(p) }));
      const t = c.pointer ? nearestTo(cands, c.pointer, () => spec.range) : null;
      const dir = c.modifier ? 'cancel' : c.dir.up ? 'up' : c.dir.down ? 'down' : c.dir.left ? 'left' : c.dir.right ? 'right' : c.me.facing === 1 ? 'right' : 'left';
      return { ok: true, action: { ability, targetId: t ? t.id : 'self', dir } };
    }
  }
}
