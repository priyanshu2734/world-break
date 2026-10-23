import {
  ITEM_KIND_SPECS, ITEM_LIMITS, POINT_HEIGHT, RANGE_DY, itemShape,
  type Arena, type Difficulty, type ItemAction, type ItemKind, type ItemLifeState, type ItemsPublic, type ToolId,
} from '@wb/shared';
import type { ItemDef, NeedDef, StashDef } from '../systems/stageDef';
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
  /** P3D (optional): the room a player is in. Absent on single-arena stages. Items and containers are only reachable from their own room. */
  roomOf?(playerId: string): string | undefined;
  /** P3D step 4 (optional): is a point of `room` in the player's view? A part or container out of view is "nothing there" (same words as a part that does not exist). */
  canSee?(playerId: string, room: string | null, x: number, y: number): boolean;
}

interface ItemRt {
  def: ItemDef;
  slots: 1 | 2;
  state: ItemLifeState;
  x: number;
  y: number;
  carrierId: string | null;
  targetId: string | null;
  /** P3D: the room the part is in (null on single-arena stages). */
  room: string | null;
}
interface PlayerIt {
  carried: string[];
  lastIntentTick: number;
  /** After a discharge destroyed one of this player's parts, no further part is destroyed until this tick. */
  nextHazardTick: number;
  nextPickupTick: number;
  nextHandoverTick: number;
  lastSafe: { x: number; y: number; room: string | null } | null;
}

interface StashRt { def: StashDef; opened: boolean; room: string | null }

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
  private readonly stashes = new Map<string, StashRt>();
  /** Targets whose requirements the team has seen (stood near). Never contains an unrevealed target. */
  private readonly discovered = new Set<string>();
  /** Targets where a repair or install was attempted: this is what unlocks the hardcore listing. */
  private readonly tried = new Set<string>();
  private readonly clarity: Difficulty;
  private readonly arenaOfRoom: ((room: string) => Arena | undefined) | null;

  constructor(
    defs: readonly ItemDef[], needs: readonly NeedDef[], private readonly arena: Arena, private readonly host: ItemHost,
    opts: { stashes?: readonly StashDef[]; clarity?: Difficulty; arenaOf?: (room: string) => Arena | undefined; defaultRoom?: string } = {},
  ) {
    this.clarity = opts.clarity ?? 'easy';
    this.arenaOfRoom = opts.arenaOf ?? null;
    for (const st of opts.stashes ?? []) this.stashes.set(st.id, { def: st, opened: false, room: st.room ?? opts.defaultRoom ?? null });
    for (const d of defs) {
      const room = d.room ?? opts.defaultRoom ?? null;
      const a = this.arenaFor(room);
      const x = clampX(a, d.x);
      this.items.set(d.id, {
        def: d,
        slots: d.slots ?? ITEM_KIND_SPECS[d.kind].defaultSlots,
        state: d.hidden ? 'hidden' : 'in_world',
        x, y: restY(a, x, d.y),
        carrierId: null, targetId: null, room,
      });
    }
    this.order = defs.map((d) => d.id);
    for (const n of needs) this.needs.set(n.targetId, n);
  }

  // ------------------------------------------------------------------ roster
  addPlayer(id: string): void {
    this.players.set(id, { carried: [], lastIntentTick: -100, nextHazardTick: 0, nextPickupTick: 0, nextHandoverTick: 0, lastSafe: null });
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
    const spot = p.lastSafe ?? { ...(this.arena.spawns[0] ?? { x: this.arena.width / 2, y: this.arena.height }), room: this.playerRoom(id) };
    const n = p.carried.length;
    for (const itemId of [...p.carried]) this.place(itemId, spot.x, spot.y, spot.room);
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
      const room = this.playerRoom(id);
      if (hasFooting(this.arenaFor(room), at.x, at.y) && !this.host.unsafeAt(at.x, at.y)) p.lastSafe = { x: at.x, y: at.y, room };
    }
    // Discovery: the team learns what a (visible) target needs once somebody stands near it. Unrevealed targets have no spot, so never qualify.
    for (const targetId of this.needs.keys()) {
      if (this.discovered.has(targetId)) continue;
      const spot = this.host.installTarget(targetId);
      if (!spot) continue;
      for (const id of this.players.keys()) {
        const at = pos(id);
        if (at?.connected && this.reachOf(at, spot.x, spot.y, ITEM_LIMITS.needsRevealRange)) {
          this.discovered.add(targetId);
          this.host.markDirty();
          break;
        }
      }
    }
  }

  // ------------------------------------------------------------------ revealing and hazards
  /** The Phase Scanner: reveals every hidden `scan` part within `radius` of (x, y). Returns how many appeared. */
  revealByScan(x: number, y: number, radius: number): number {
    let n = 0;
    for (const id of this.order) {
      const it = this.items.get(id)!;
      if (it.state !== 'hidden' || it.def.hidden?.reveal !== 'scan') continue;
      if (Math.hypot(it.x - x, it.y - y) > radius) continue;
      it.state = 'in_world';
      n++;
    }
    if (n > 0) { this.host.say(n === 1 ? 'Scanner: a hidden part came into focus.' : `Scanner: ${n} hidden parts came into focus.`, 'good'); this.host.markDirty(); }
    return n;
  }

  /**
   * An unshielded arc discharge hit this player. It destroys at most ONE carried part (the one picked up last), and the player is then
   * safe from further losses for `hazardGraceTicks`. The pulse itself is telegraphed by the hazard's public `nextPulseTick`.
   */
  onHazardHit(playerId: string): boolean {
    const p = this.players.get(playerId);
    if (!p || p.carried.length === 0 || this.host.tick < p.nextHazardTick) return false;
    const itemId = p.carried[p.carried.length - 1]!;
    const it = this.items.get(itemId)!;
    this.destroy(itemId);
    p.nextHazardTick = this.host.tick + ITEM_LIMITS.hazardGraceTicks;
    this.host.say(`The discharge fries the ${ITEM_KIND_SPECS[it.def.kind].label} you were carrying.`, 'bad');
    return true;
  }

  // ------------------------------------------------------------------ requirements
  private clarityShows(targetId: string): boolean {
    return this.clarity !== 'hardcore' || this.tried.has(targetId);
  }
  /** Records a first attempt on a target (a refused repair, an install). In hardcore this is what unlocks the listing. */
  noteTried(targetId: string): void {
    if (this.needs.has(targetId) && !this.tried.has(targetId)) { this.tried.add(targetId); this.host.markDirty(); }
  }
  /**
   * The refusal a repair or interaction gets while the target still lacks parts, or null if it has none to wait for.
   * The text follows the clue clarity, and the attempt counts as "tried". Call only for targets the player can already see.
   */
  gateMessage(targetId: string): string | null {
    const left = this.remainingNeeds(targetId);
    if (left === undefined || left.length === 0) return null;
    this.noteTried(targetId);
    if (this.clarity === 'easy') return `It cannot be finished yet. Missing: ${left.map((k) => ITEM_KIND_SPECS[k].label).join(', ')}.`;
    if (this.clarity === 'intermediate') return `It cannot be finished yet. It still needs ${left.length} part${left.length === 1 ? '' : 's'}.`;
    return 'It will not take. Something is missing.';
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
  /**
   * P3D: a lock takes a carried part. The first carried part of `kind` is used. A genuine part is consumed (it leaves the hands and
   * the public state for good). A decoy is destroyed instead and does not satisfy the lock (same rule as installing one).
   */
  consumeCarried(playerId: string, kind: ItemKind): 'ok' | 'decoy' | 'none' {
    const p = this.players.get(playerId);
    const id = p?.carried.find((i) => this.items.get(i)?.def.kind === kind);
    if (!p || id === undefined) return 'none';
    const it = this.items.get(id)!;
    this.detach(it);
    it.state = it.def.decoy === true ? 'destroyed' : 'consumed';
    this.host.markDirty();
    return it.def.decoy === true ? 'decoy' : 'ok';
  }
  /** P3D: the kinds a player carries (for prompts and tests). */
  carriedKinds(playerId: string): ItemKind[] { return this.carriedBy(playerId).map((i) => this.items.get(i)!.def.kind); }

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
  /** P3D: the room a player is in (null on single-arena stages). */
  private playerRoom(id: string): string | null { return this.host.roomOf?.(id) ?? null; }
  /** P3D: the arena of a room (the stage arena for null or an unknown room). */
  private arenaFor(room: string | null): Arena { return (room !== null ? this.arenaOfRoom?.(room) : undefined) ?? this.arena; }
  /** P3D step 4: can the player see a thing standing at (x, y) in `room`? Always true without a view rule. */
  private sees(playerId: string, room: string | null, x: number, y: number): boolean { return this.host.canSee ? this.host.canSee(playerId, room, x, y) : true; }
  /** P3D: is the player in the room of this thing? Always true on single-arena stages. */
  private here(playerId: string, room: string | null): boolean { return !this.host.roomOf || this.playerRoom(playerId) === room; }
  /** Releases an item at (x, y) in `room`: it falls to the first platform at or below that point. */
  private place(itemId: string, x: number, y: number, room: string | null): void {
    const it = this.items.get(itemId)!;
    this.detach(it);
    const a = this.arenaFor(room);
    const cx = clampX(a, x);
    it.x = cx; it.y = restY(a, cx, y);
    it.room = room;
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
      case 'open': return this.open(playerId, a.stashId, me);
    }
  }

  private pickup(pid: string, p: PlayerIt, itemId: string, me: PlayerPosLike): ItemResult {
    const it = this.items.get(itemId);
    const why = this.groundError(pid, it);
    if (why) return fail(why);
    const item = it!;
    if (!this.here(pid, item.room) || !this.sees(pid, item.room, item.x, item.y - POINT_HEIGHT.item)) return fail(NOTHING_THERE); // another room or out of view: indistinguishable from nothing
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
    this.place(itemId, me.x, me.y, this.playerRoom(pid));
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
    if (!this.here(pid, incoming.room) || !this.sees(pid, incoming.room, incoming.x, incoming.y - POINT_HEIGHT.item)) return fail(NOTHING_THERE);
    const locked = this.pickLocked(p);
    if (locked) return fail(locked);
    if (!this.reachOf(me, incoming.x, incoming.y, ITEM_LIMITS.pickupRange)) return fail('Too far away.');
    if (this.usedSlots(p) - out.slots + incoming.slots > ITEM_LIMITS.carrySlots) return fail('That will not fit in your hands, even after dropping that.');
    this.place(dropId, me.x, me.y, this.playerRoom(pid));
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
    if (!to || !toPos || !toPos.connected || !this.here(pid, this.playerRoom(toId))) return fail(NO_RECEIVER);
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

  private open(pid: string, stashId: string, me: PlayerPosLike): ItemResult {
    const st = this.stashes.get(stashId);
    if (!st || !this.here(pid, st.room) || !this.sees(pid, st.room, st.def.x, st.def.y - POINT_HEIGHT.stash)) return fail(NOTHING_THERE);
    if (!this.reachOf(me, st.def.x, st.def.y, ITEM_LIMITS.openRange)) return fail('Too far away.');
    if (st.opened) return fail('That is already open.');
    st.opened = true;
    let n = 0;
    for (const id of this.order) {
      const it = this.items.get(id)!;
      if (it.state === 'hidden' && it.def.hidden?.reveal === 'interact' && it.def.hidden.stashId === stashId) { it.state = 'in_world'; n++; }
    }
    this.host.say(n > 0 ? `${st.def.label} opened. There are parts inside.` : `${st.def.label} opened. It is empty.`, n > 0 ? 'good' : 'info');
    this.host.markDirty();
    return ok(n > 0 ? 'You open it. Something is inside.' : 'It is empty.');
  }

  private install(pid: string, p: PlayerIt, itemId: string, targetId: string, me: PlayerPosLike): ItemResult {
    const it = this.items.get(itemId);
    if (!it || it.state !== 'carried' || it.carrierId !== pid) return fail(NOT_CARRYING);
    // Unknown targets, unrevealed breakpoints and visible targets without needs all give the same refusal.
    const spot = this.host.installTarget(targetId);
    const left = this.remainingNeeds(targetId);
    if (!spot || left === undefined) return fail(NO_INSTALL_TARGET);
    this.noteTried(targetId);
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
        ...(i.room !== null ? { roomId: i.room } : {}),
        ...(i.def.decoy === true && i.def.tell === true && this.clarity !== 'hardcore' ? { cracked: true } : {}),
      })),
      players: [...this.players].map(([id, p]) => ({ id, slotsUsed: this.usedSlots(p), carried: [...p.carried] })),
      ...(this.stashes.size > 0 ? { stashes: [...this.stashes.values()].map((s) => ({
        id: s.def.id, kind: s.def.kind, label: s.def.label, x: s.def.x, y: s.def.y, opened: s.opened,
        ...(s.room !== null ? { roomId: s.room } : {}),
      })) } : {}),
      ...(this.needs.size > 0 ? { needs: this.publicNeeds() } : {}),
    };
  }

  /** Needs of discovered targets, shaped by clarity. An undiscovered or unrevealed target is not listed (not even as "unknown"). */
  private publicNeeds(): NonNullable<ItemsPublic['needs']> {
    const out: NonNullable<ItemsPublic['needs']> = [];
    for (const [targetId, need] of this.needs) {
      if (!this.discovered.has(targetId) || !this.clarityShows(targetId)) continue;
      const spot = this.host.installTarget(targetId);
      if (!spot) continue;
      const installed = this.installedFor(targetId);
      const pool = [...installed];
      const names = this.clarity === 'easy';
      const parts = need.items.map((kind) => {
        const i = pool.indexOf(kind);
        const done = i >= 0;
        if (done) pool.splice(i, 1);
        const show = done || names;
        return { kind: show ? kind : null, label: show ? ITEM_KIND_SPECS[kind].label : null, shape: itemShape(kind), installed: done };
      });
      const tools: ToolId[] = this.clarity === 'hardcore' ? [] : [...(need.tools ?? [])];
      out.push({ targetId, label: spot.label, satisfied: parts.every((x) => x.installed), hint: names ? (need.hint ?? null) : null, tools, parts });
    }
    return out;
  }
}
