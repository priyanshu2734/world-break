import {
  ITEM_KIND_SPECS, ITEM_LIMITS, RANGE_DY,
  type Arena, type ItemAction, type ItemKind, type ItemLifeState, type ItemsPublic,
} from '@wb/shared';
import type { ItemDef, NeedDef } from '../systems/stageDef';
import { clampX, hasFooting, restY } from './rest';

export type ItemResult = { ok: true; message: string } | { ok: false; error: string };
const fail = (error: string): ItemResult => ({ ok: false, error });
const ok = (message: string): ItemResult => ({ ok: true, message });

/**
 * Refusal texts for things the player may not know exist. They are CONSTANTS shared by every reason (nonexistent, hidden,
 * consumed, destroyed), so a refusal never tells hidden things from nonexistent ones. Never add a reason-specific variant.
 */
export const NOTHING_THERE = 'Nothing there.';
export const NOT_CARRYING = 'You are not carrying that.';
export const NO_INSTALL_TARGET = 'Nothing there to install that on.';
export const NO_RECEIVER = 'Nobody there to hand it to.';

export interface PlayerPosLike { x: number; y: number; connected: boolean }

/** What the item system may ask of its host (the StageEngine). A narrow seam, so it is unit-testable. */
export interface ItemHost {
  readonly tick: number;
  say(text: string, tone: 'info' | 'good' | 'warn' | 'bad'): void;
  markDirty(): void;
  /** Score change (negative = penalty). */
  award(category: string, points: number): void;
  /** Penalty (positive number) for installing a bad part. */
  wrongPartCost(): number;
  /** Where players may install parts: the target's spot, or null if nothing (visible) is there. Unrevealed breakpoints return null. */
  installTarget(targetId: string): { x: number; y: number; label: string } | null;
  /** True while the player is busy with a repair channel (parts cannot be handled then). */
  busy(playerId: string): boolean;
  /** True if standing here would be dangerous right now (inside an armed hazard). Used for "last safe position". */
  unsafeAt(x: number, y: number): boolean;
}

interface ItemRt {
  def: ItemDef;
  slots: 1 | 2;
  state: ItemLifeState;
  x: number;
  y: number;
  carrierId: string | null;
  targetId: string | null;
}
interface PlayerIt {
  carried: string[];
  lastIntentTick: number;
  nextPickupTick: number;
  nextHandoverTick: number;
  lastSafe: { x: number; y: number } | null;
}

/** States a client is allowed to know about. Everything else behaves exactly like "does not exist". */
const isVisible = (s: ItemLifeState): s is 'in_world' | 'carried' | 'installed' => s === 'in_world' || s === 'carried' || s === 'installed';

/**
 * Salvage: parts the players find, carry (2 slots), hand over and install. Every rule is enforced here, on the server.
 * Order of checks for every action: known player > busy > rate limit > action-specific. Nothing changes on failure,
 * except that the rate-limit clock always advances (so refused intents cannot be spammed either).
 */
export class ItemSystem {
  private readonly items = new Map<string, ItemRt>();
  private readonly order: string[];
  private players = new Map<string, PlayerIt>();
  private readonly needs = new Map<string, NeedDef>();

  constructor(defs: readonly ItemDef[], needs: readonly NeedDef[], private readonly arena: Arena, private readonly host: ItemHost) {
    for (const d of defs) {
      const x = clampX(arena, d.x);
      this.items.set(d.id, {
        def: d,
        slots: d.slots ?? ITEM_KIND_SPECS[d.kind].defaultSlots,
        state: d.hidden ? 'hidden' : 'in_world',
        x, y: restY(arena, x, d.y),
        carrierId: null, targetId: null,
      });
    }
    this.order = defs.map((d) => d.id);
    for (const n of needs) this.needs.set(n.targetId, n);
  }

  // ------------------------------------------------------------------ roster
  addPlayer(id: string): void {
    this.players.set(id, { carried: [], lastIntentTick: -100, nextPickupTick: 0, nextHandoverTick: 0, lastSafe: null });
    this.host.markDirty();
  }
  /** The player leaves the run: whatever they carried is dropped at their last safe position. */
  removePlayer(id: string): void {
    this.dropAll(id);
    this.players.delete(id);
    this.host.markDirty();
  }
  /** The player's connection dropped: their parts are dropped at their last safe position so teammates can use them. */
  onDisconnect(id: string): void { this.dropAll(id); }

  private dropAll(id: string): void {
    const p = this.players.get(id);
    if (!p || p.carried.length === 0) return;
    const spot = p.lastSafe ?? this.arena.spawns[0] ?? { x: this.arena.width / 2, y: this.arena.height };
    const n = p.carried.length;
    for (const itemId of [...p.carried]) this.place(itemId, spot.x, spot.y);
    p.carried = [];
    this.host.say(n === 1 ? 'A teammate lost their link and dropped a part.' : `A teammate lost their link and dropped ${n} parts.`, 'warn');
    this.host.markDirty();
  }

  // ------------------------------------------------------------------ per-tick
  /** Once per engine tick: remember where each connected player last stood somewhere safe. Never marks the state dirty. */
  step(pos: (id: string) => PlayerPosLike | undefined): void {
    for (const [id, p] of this.players) {
      const at = pos(id);
      if (!at || !at.connected) continue;
      if (hasFooting(this.arena, at.x, at.y) && !this.host.unsafeAt(at.x, at.y)) p.lastSafe = { x: at.x, y: at.y };
    }
  }

  // ------------------------------------------------------------------ queries (used by the engine and by tests)
  stateOf(itemId: string): ItemLifeState | undefined { return this.items.get(itemId)?.state; }
  carriedBy(playerId: string): string[] { return [...(this.players.get(playerId)?.carried ?? [])]; }
  slotsUsed(playerId: string): number { return this.usedSlots(this.players.get(playerId)); }
  /** Kinds installed on a target, in install order. */
  installedFor(targetId: string): ItemKind[] {
    return this.order.map((id) => this.items.get(id)!).filter((i) => i.state === 'installed' && i.targetId === targetId).map((i) => i.def.kind);
  }
  /** Kinds a target still needs (a multiset difference). Empty array = satisfied. Undefined = the target has no item needs. */
  remainingNeeds(targetId: string): ItemKind[] | undefined {
    const need = this.needs.get(targetId);
    if (!need) return undefined;
    const left = [...need.items];
    for (const k of this.installedFor(targetId)) {
      const i = left.indexOf(k);
      if (i >= 0) left.splice(i, 1);
    }
    return left;
  }
  isSatisfied(targetId: string): boolean {
    const r = this.remainingNeeds(targetId);
    return r === undefined || r.length === 0;
  }
  /** Reveals a hidden item (it becomes an ordinary in-world part). Returns false if it was not hidden. Used by hiding rules (P3C step 2). */
  reveal(itemId: string): boolean {
    const it = this.items.get(itemId);
    if (!it || it.state !== 'hidden') return false;
    it.state = 'in_world';
    this.host.markDirty();
    return true;
  }
  /** Destroys an item wherever it is (a hazard, a failed install). Carried items leave their carrier's hands. */
  destroy(itemId: string): boolean {
    const it = this.items.get(itemId);
    if (!it || !isVisible(it.state) || it.state === 'installed') return false;
    this.detach(it);
    it.state = 'destroyed';
    this.host.markDirty();
    return true;
  }

  // ------------------------------------------------------------------ internals
  private usedSlots(p: PlayerIt | undefined): number {
    if (!p) return 0;
    let n = 0;
    for (const id of p.carried) n += this.items.get(id)?.slots ?? 0;
    return n;
  }
  private detach(it: ItemRt): void {
    if (it.carrierId) {
      const p = this.players.get(it.carrierId);
      if (p) p.carried = p.carried.filter((id) => id !== it.def.id);
    }
    it.carrierId = null;
  }
  /** Releases an item at (x, y): it falls to the first platform at or below that point. */
  private place(itemId: string, x: number, y: number): void {
    const it = this.items.get(itemId)!;
    this.detach(it);
    const cx = clampX(this.arena, x);
    it.x = cx; it.y = restY(this.arena, cx, y);
    it.state = 'in_world';
    it.targetId = null;
  }
  private pickLocked(p: PlayerIt): string | null {
    return this.host.tick < p.nextPickupTick ? 'Your hands are still busy. Wait a moment.' : null;
  }
  private reachOf(me: PlayerPosLike, x: number, y: number, range: number): boolean {
    return Math.abs(me.x - x) <= range && Math.abs(me.y - y) <= RANGE_DY;
  }
  /** Why `it` cannot be picked up from the ground, or null if it can. Hidden / consumed / destroyed / unknown ids all give NOTHING_THERE. */
  private groundError(pid: string, it: ItemRt | undefined): string | null {
    if (!it || !isVisible(it.state)) return NOTHING_THERE;
    if (it.state === 'carried') return it.carrierId === pid ? 'You already have that.' : 'Someone else is carrying that.';
    if (it.state === 'installed') return 'That is already installed.';
    return null;
  }

  // ------------------------------------------------------------------ the intent
  use(playerId: string, a: ItemAction, me: PlayerPosLike, posOf: (id: string) => PlayerPosLike | undefined): ItemResult {
    const p = this.players.get(playerId);
    if (!p) return fail('You are not part of this run.');
    if (this.host.busy(playerId)) return fail('Finish or cancel your current task first.');
    const t = this.host.tick;
    if (t - p.lastIntentTick < ITEM_LIMITS.minGapTicks) return fail('Too fast.');
    p.lastIntentTick = t;
    switch (a.action) {
      case 'pickup': return this.pickup(playerId, p, a.itemId, me);
      case 'drop': return this.drop(playerId, p, a.itemId, me);
      case 'swap': return this.swap(playerId, p, a.dropId, a.pickId, me);
      case 'handover': return this.handover(playerId, p, a.itemId, a.toPlayerId, me, posOf);
      case 'install': return this.install(playerId, p, a.itemId, a.targetId, me);
    }
  }

  private pickup(pid: string, p: PlayerIt, itemId: string, me: PlayerPosLike): ItemResult {
    const it = this.items.get(itemId);
    const why = this.groundError(pid, it);
    if (why) return fail(why);
    const item = it!;
    const locked = this.pickLocked(p);
    if (locked) return fail(locked);
    if (!this.reachOf(me, item.x, item.y, ITEM_LIMITS.pickupRange)) return fail('Too far away.');
    const used = this.usedSlots(p);
    if (used + item.slots > ITEM_LIMITS.carrySlots) {
      return fail(item.slots === 2 ? 'That is heavy. It needs both hands free.' : 'Your hands are full. Drop or swap something.');
    }
    item.state = 'carried'; item.carrierId = pid; item.targetId = null;
    p.carried.push(itemId);
    this.host.markDirty();
    return ok(`Picked up the ${ITEM_KIND_SPECS[item.def.kind].label}.`);
  }

  private drop(pid: string, p: PlayerIt, itemId: string, me: PlayerPosLike): ItemResult {
    const it = this.items.get(itemId);
    if (!it || it.state !== 'carried' || it.carrierId !== pid) return fail(NOT_CARRYING);
    this.place(itemId, me.x, me.y);
    p.nextPickupTick = this.host.tick + ITEM_LIMITS.dropCooldownTicks;
    this.host.markDirty();
    return ok(`Dropped the ${ITEM_KIND_SPECS[it.def.kind].label}.`);
  }

  private swap(pid: string, p: PlayerIt, dropId: string, pickId: string, me: PlayerPosLike): ItemResult {
    const out = this.items.get(dropId);
    if (!out || out.state !== 'carried' || out.carrierId !== pid) return fail(NOT_CARRYING);
    const inn = this.items.get(pickId);
    const why = this.groundError(pid, inn);
    if (why) return fail(why);
    const incoming = inn!;
    const locked = this.pickLocked(p);
    if (locked) return fail(locked);
    if (!this.reachOf(me, incoming.x, incoming.y, ITEM_LIMITS.pickupRange)) return fail('Too far away.');
    if (this.usedSlots(p) - out.slots + incoming.slots > ITEM_LIMITS.carrySlots) return fail('That will not fit in your hands, even after dropping that.');
    this.place(dropId, me.x, me.y);
    incoming.state = 'carried'; incoming.carrierId = pid; incoming.targetId = null;
    p.carried.push(pickId);
    p.nextPickupTick = this.host.tick + ITEM_LIMITS.dropCooldownTicks;
    this.host.markDirty();
    return ok(`Swapped the ${ITEM_KIND_SPECS[out.def.kind].label} for the ${ITEM_KIND_SPECS[incoming.def.kind].label}.`);
  }

  private handover(pid: string, p: PlayerIt, itemId: string, toId: string, me: PlayerPosLike, posOf: (id: string) => PlayerPosLike | undefined): ItemResult {
    const it = this.items.get(itemId);
    if (!it || it.state !== 'carried' || it.carrierId !== pid) return fail(NOT_CARRYING);
    const to = toId === pid ? undefined : this.players.get(toId);
    const toPos = to ? posOf(toId) : undefined;
    if (!to || !toPos || !toPos.connected) return fail(NO_RECEIVER);
    if (this.host.tick < p.nextHandoverTick) return fail('You just handed something over. Wait a moment.');
    if (!this.reachOf(me, toPos.x, toPos.y, ITEM_LIMITS.handoverRange)) return fail('Too far away.');
    if (this.usedSlots(to) + it.slots > ITEM_LIMITS.carrySlots) return fail('Their hands are full.');
    p.carried = p.carried.filter((id) => id !== itemId);
    to.carried.push(itemId);
    it.carrierId = toId;
    p.nextHandoverTick = this.host.tick + ITEM_LIMITS.handoverCooldownTicks;
    this.host.markDirty();
    return ok(`Handed over the ${ITEM_KIND_SPECS[it.def.kind].label}.`);
  }

  private install(pid: string, p: PlayerIt, itemId: string, targetId: string, me: PlayerPosLike): ItemResult {
    const it = this.items.get(itemId);
    if (!it || it.state !== 'carried' || it.carrierId !== pid) return fail(NOT_CARRYING);
    // Unknown targets, unrevealed breakpoints and visible targets without needs all give the same refusal.
    const spot = this.host.installTarget(targetId);
    const left = this.remainingNeeds(targetId);
    if (!spot || left === undefined) return fail(NO_INSTALL_TARGET);
    if (!this.reachOf(me, spot.x, spot.y, ITEM_LIMITS.installRange)) return fail('Too far away.');
    if (left.length === 0) return fail('Nothing more is needed there.');
    const kind = it.def.kind;
    const label = ITEM_KIND_SPECS[kind].label;
    if (!left.includes(kind)) return fail(`The ${label} does not fit ${spot.label}.`);
    if (it.def.decoy === true) {
      this.detach(it);
      it.state = 'destroyed';
      this.host.award('wrong_part', -this.host.wrongPartCost());
      this.host.say(`The ${label} was cracked. It shatters as it goes into ${spot.label}.`, 'bad');
      this.host.markDirty();
      return fail(`The ${label} was cracked and shattered.`);
    }
    this.detach(it);
    it.state = 'installed'; it.targetId = targetId; it.x = spot.x; it.y = spot.y;
    this.host.say(`${label} installed on ${spot.label}.`, 'good');
    if (this.isSatisfied(targetId)) this.host.say(`${spot.label} has every part it needs.`, 'good');
    this.host.markDirty();
    return ok(`Installed the ${label}.`);
  }

  // ------------------------------------------------------------------ public projection
  /** Hidden, consumed and destroyed items are not listed, and the decoy flag is never published. */
  publicState(): ItemsPublic {
    return {
      carrySlots: ITEM_LIMITS.carrySlots,
      items: this.order.map((id) => this.items.get(id)!).filter((i) => isVisible(i.state)).map((i) => ({
        id: i.def.id, kind: i.def.kind, label: ITEM_KIND_SPECS[i.def.kind].label, slots: i.slots,
        state: i.state as 'in_world' | 'carried' | 'installed',
        x: i.x, y: i.y, carrierId: i.carrierId, targetId: i.targetId,
      })),
      players: [...this.players].map(([id, p]) => ({ id, slotsUsed: this.usedSlots(p), carried: [...p.carried] })),
    };
  }
}
