import { ITEM_LIMITS, RANGE_DY, type ItemAction, type ItemKind, type ItemsPublic, type StageState } from '@wb/shared';
import { COLOR } from '../palette';
import { conduitMid } from './targeting';

/**
 * Presentation-only helpers for salvage (P3C): the carry slots, the "Needs: ..." prompts, marker shapes and colours, and the
 * convenience that turns a key press into an item intent. They read the PUBLIC state only. The server re-validates range,
 * ownership, capacity, cooldown and rate for every intent, so nothing here can decide an outcome.
 */
type Pt = { x: number; y: number };
export type PubItem = ItemsPublic['items'][number];
export type PubStash = NonNullable<ItemsPublic['stashes']>[number];
export type PubNeed = NonNullable<ItemsPublic['needs']>[number];

// ---------------------------------------------------------------- colour language and shapes
/** red = danger, cyan = interactive, amber = hidden clue, green = repaired (docs/GAMEPLAY.md section 9). */
export type Tone = 'danger' | 'cyan' | 'amber' | 'green';
export const TONE_COLOR: Record<Tone, number> = { danger: COLOR.danger, cyan: COLOR.cyan, amber: COLOR.amber, green: COLOR.green };
export const TONE_HEX: Record<Tone, string> = { danger: '#ff6b6b', cyan: '#3de8ff', amber: '#ffb02e', green: '#6dffb0' };

/** One silhouette per kind, so a part is never told apart by colour alone (colour-blind safe). */
export type MarkerShape = 'bar' | 'ring' | 'hex' | 'spoke' | 'triangle' | 'cell' | 'cross' | 'block';
export const ITEM_SHAPE: Record<ItemKind, MarkerShape> = {
  fuse: 'bar', flux_coil: 'ring', coolant_cell: 'hex', valve_wheel: 'spoke',
  access_key: 'triangle', battery: 'cell', revive_cell: 'cross', power_core: 'block',
};

/** A repaired/installed part is green, a visibly cracked part is red, everything else you can pick up is cyan. */
export function itemTone(i: Pick<PubItem, 'state' | 'cracked'>): Tone {
  if (i.state === 'installed') return 'green';
  if (i.cracked === true) return 'danger';
  return 'cyan';
}
/** A closed stash may hide something (amber, like a hidden clue); an opened one is just a container. */
export function stashTone(s: Pick<PubStash, 'opened'>): Tone { return s.opened ? 'cyan' : 'amber'; }

// ---------------------------------------------------------------- slot HUD
export type SlotCell =
  | { kind: 'empty' }
  | { kind: 'covered' } // the second half of a heavy part
  | { kind: 'part'; itemId: string; label: string; shape: MarkerShape; cracked: boolean; span: 1 | 2 };
export interface CarryView { max: number; used: number; cells: SlotCell[] }

/** The parts `localId` carries, oldest pick-up first. */
export function carriedItems(st: Pick<StageState, 'items'> | null, localId: string): PubItem[] {
  const it = st?.items;
  const me = it?.players.find((p) => p.id === localId);
  if (!it || !me) return [];
  return me.carried.map((id) => it.items.find((x) => x.id === id)).filter((x): x is PubItem => !!x);
}

export function carryView(st: Pick<StageState, 'items'> | null, localId: string): CarryView | null {
  const it = st?.items;
  if (!it || !it.players.some((p) => p.id === localId)) return null;
  const cells: SlotCell[] = [];
  for (const c of carriedItems(st, localId)) {
    cells.push({ kind: 'part', itemId: c.id, label: c.label, shape: ITEM_SHAPE[c.kind], cracked: c.cracked === true, span: c.slots === 2 ? 2 : 1 });
    if (c.slots === 2) cells.push({ kind: 'covered' });
  }
  while (cells.length < it.carrySlots) cells.push({ kind: 'empty' });
  cells.length = it.carrySlots;
  const used = cells.filter((c) => c.kind !== 'empty').length;
  return { max: it.carrySlots, used, cells };
}

// ---------------------------------------------------------------- "Needs: ..." prompts
export interface NeedPrompt { targetId: string; label: string; x: number; y: number; text: string; hint: string | null; satisfied: boolean }

function spotOf(st: StageState, id: string): Pt | null {
  const b = st.breakpoints.find((x) => x.id === id) ?? st.entities.find((x) => x.id === id);
  if (b) return { x: b.x, y: b.y };
  const c = st.power.conduits.find((x) => x.id === id);
  return c ? conduitMid(st, c) : null;
}

/** One line per discovered target. The server decides which targets are discovered and how much each part reveals. */
export function needPrompts(st: StageState | null): NeedPrompt[] {
  const needs = st?.items?.needs;
  if (!st || !needs) return [];
  const out: NeedPrompt[] = [];
  for (const n of needs) {
    const spot = spotOf(st, n.targetId);
    if (!spot) continue;
    const missing = n.parts.filter((p) => !p.installed).map((p) => p.label ?? (p.shape === 'heavy' ? 'a heavy part' : 'a small part'));
    out.push({
      targetId: n.targetId, label: n.label, ...spot,
      text: n.satisfied || missing.length === 0 ? 'Parts fitted' : `Needs: ${missing.join(', ')}`,
      hint: n.satisfied ? null : n.hint,
      satisfied: n.satisfied || missing.length === 0,
    });
  }
  return out;
}

// ---------------------------------------------------------------- picking (convenience only)
const near = (me: Pt, p: Pt, range: number) => Math.abs(me.x - p.x) <= range && Math.abs(me.y - p.y) <= RANGE_DY;
function nearest<T extends Pt>(me: Pt, list: T[], range: number): T | null {
  let best: { v: T; d: number } | null = null;
  for (const v of list) {
    if (!near(me, v, range)) continue;
    const d = Math.abs(me.x - v.x);
    if (!best || d < best.d) best = { v, d };
  }
  return best?.v ?? null;
}

export function nearestItem(st: Pick<StageState, 'items'>, me: Pt): PubItem | null {
  return nearest(me, (st.items?.items ?? []).filter((i) => i.state === 'in_world'), ITEM_LIMITS.pickupRange);
}
export function nearestStash(st: Pick<StageState, 'items'>, me: Pt): PubStash | null {
  return nearest(me, (st.items?.stashes ?? []).filter((s) => !s.opened), ITEM_LIMITS.openRange);
}
export function nearestInstallTarget(st: StageState, me: Pt): NeedPrompt | null {
  return nearest(me, needPrompts(st).filter((n) => !n.satisfied), ITEM_LIMITS.installRange);
}
export function nearestTeammate<T extends Pt & { id: string }>(me: Pt, others: T[], localId: string): T | null {
  return nearest(me, others.filter((o) => o.id !== localId), ITEM_LIMITS.handoverRange);
}

export type ItemIntent = { ok: true; action: ItemAction } | { ok: false; reason: string };
const no = (reason: string): ItemIntent => ({ ok: false, reason });

/** E: pick up the nearest part, else open the nearest closed stash. Null = neither is in reach (E falls through to "use"). */
export function pickIntent(st: StageState, me: Pt): ItemIntent | null {
  const item = nearestItem(st, me);
  if (item) return { ok: true, action: { action: 'pickup', itemId: item.id } };
  const stash = nearestStash(st, me);
  if (stash) return { ok: true, action: { action: 'open', stashId: stash.id } };
  return null;
}

/**
 * G: put down the part you picked up last (`older`: the one you picked up first). If a part lies within reach and your hands
 * cannot take it, the put-down becomes a swap.
 */
export function dropIntent(st: StageState, localId: string, me: Pt, older = false): ItemIntent {
  const held = carriedItems(st, localId);
  if (held.length === 0) return no('You are carrying nothing.');
  const out = older ? held[0]! : held[held.length - 1]!;
  const ground = nearestItem(st, me);
  const used = held.reduce((n, h) => n + h.slots, 0);
  if (ground && used - out.slots + ground.slots <= ITEM_LIMITS.carrySlots && used + ground.slots > ITEM_LIMITS.carrySlots) {
    return { ok: true, action: { action: 'swap', dropId: out.id, pickId: ground.id } };
  }
  return { ok: true, action: { action: 'drop', itemId: out.id } };
}

/** F: fit a carried part to the nearest target that still needs one. A part that shows as cracked is never chosen over a clean one. */
export function installIntent(st: StageState, localId: string, me: Pt): ItemIntent {
  const held = carriedItems(st, localId);
  if (held.length === 0) return no('You are carrying nothing.');
  const target = nearestInstallTarget(st, me);
  if (!target) return no('Nothing here needs a part.');
  const need = st.items?.needs?.find((n) => n.targetId === target.targetId);
  const wanted = new Set((need?.parts ?? []).filter((p) => !p.installed && p.kind !== null).map((p) => p.kind as ItemKind));
  const known = wanted.size > 0;
  const fits = [...held].reverse().filter((h) => !known || wanted.has(h.kind));
  if (fits.length === 0) return no('Nothing you carry fits here.');
  const choice = fits.find((h) => h.cracked !== true) ?? fits[0]!;
  return { ok: true, action: { action: 'install', itemId: choice.id, targetId: target.targetId } };
}

/** H: hand the part you picked up last to the nearest teammate. */
export function handoverIntent<T extends Pt & { id: string }>(st: StageState, localId: string, me: Pt, others: T[]): ItemIntent {
  const held = carriedItems(st, localId);
  if (held.length === 0) return no('You are carrying nothing.');
  const to = nearestTeammate(me, others, localId);
  if (!to) return no('No teammate within reach.');
  return { ok: true, action: { action: 'handover', itemId: held[held.length - 1]!.id, toPlayerId: to.id } };
}

/** The line shown at the bottom of the screen for whatever the next key press would do. */
export function itemPrompt(st: StageState, localId: string, me: Pt): string | null {
  if (!st.items) return null;
  const held = carriedItems(st, localId);
  const used = held.reduce((n, h) => n + h.slots, 0);
  const item = nearestItem(st, me);
  if (item) {
    const crack = item.cracked === true ? ' (cracked)' : '';
    return used + item.slots > ITEM_LIMITS.carrySlots
      ? (held.length ? `[G] Swap for the ${item.label}${crack}` : `The ${item.label} is too heavy to lift`)
      : `[E] Pick up the ${item.label}${crack}`;
  }
  const stash = nearestStash(st, me);
  if (stash) return `[E] Open the ${stash.label}`;
  const target = nearestInstallTarget(st, me);
  if (target && held.length) return `[F] Fit a part to ${target.label}`;
  return null;
}

// ---------------------------------------------------------------- hand-over and loss feedback
/** Describes what changed in the parts people carry between two public states (hand-overs, and parts that vanished). */
export function carryChanges(prev: ItemsPublic | undefined, next: ItemsPublic | undefined, localId: string, nameOf: (id: string) => string): string[] {
  if (!prev || !next) return [];
  const out: string[] = [];
  for (const p of prev.items) {
    if (p.state !== 'carried' || p.carrierId === null) continue;
    const now = next.items.find((x) => x.id === p.id);
    if (!now) { if (p.carrierId === localId) out.push(`Your ${p.label} is gone.`); continue; }
    if (now.state !== 'carried' || now.carrierId === null || now.carrierId === p.carrierId) continue;
    if (now.carrierId === localId) out.push(`${nameOf(p.carrierId)} handed you the ${p.label}.`);
    else if (p.carrierId === localId) out.push(`You handed the ${p.label} to ${nameOf(now.carrierId)}.`);
  }
  return out;
}
