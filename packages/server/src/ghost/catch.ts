import { CATCH_LIMITS, RANGE_DY, type GhostStatus } from '@wb/shared';
import type { GhostCatchEvent, HidingSpotDef } from './types';

/** Where one player is, as the catch rules need it. Feet-centre like every body. */
export interface CatchWho { id: string; name: string; room: string; x: number; y: number; connected: boolean; use: boolean }

/** What the catch rules may ask of their host (the Room). A narrow seam, so they are unit-testable without a Room. */
export interface CatchHost {
  readonly tick: number;
  /** Every player of the run, in slot order. */
  who(): CatchWho[];
  /** Freeze (hiding or caught: no movement) or free a player. */
  freeze(id: string, on: boolean): void;
  /** Drop ONE carried part where the player stands and cancel their task; returns how many parts they still carry (0 = done). */
  dropOne(id: string): number;
  /** Put the player on the floor at their room's entry. */
  placeAtEntry(id: string): void;
  /** Take points off the team score. */
  penalty(points: number): void;
  say(text: string, tone: 'info' | 'good' | 'warn' | 'bad', room?: string): void;
  /** Is a ghost watching this player (hunting and has just seen them)? Then they cannot hide. */
  watched(id: string): boolean;
  /** Is the point (x, y) of the viewer's own room in the viewer's view? */
  canSee(viewerId: string, x: number, y: number): boolean;
}

export type CatchResult = { ok: true; message: string } | { ok: false; error: string };
const fail = (error: string): CatchResult => ({ ok: false, error });

interface Captive { until: number; progress: number; by: string | null; dropsLeft: boolean; attempts: number }

/**
 * P3E step 3: hiding places and the catch. One instance per stage, owned by the Room (not a second state machine: the ghost keeps its own
 * machine, this holds who is hidden and who is caught). Everything is server-side and a function of the tick and the inputs, so it is deterministic.
 *
 *   hide   E at a hiding spot: the player stops (frozen), is not seen and makes no noise. Refused while a ghost is watching them.
 *   catch  the ghost touches a player, or opens the spot they hide in: they are CAPTURED where they stand, drop what they carry and cannot move.
 *   rescue a teammate HOLDS E within reach for `rescueTicks`; letting go loses progress. No score cost.
 *   release nobody frees them within `captureTicks`: they are put at their room's entry with a score penalty. Nobody is eliminated (P4 replaces this).
 */
export class CatchSystem {
  private readonly hiddenIn = new Map<string, string>();
  private readonly captives = new Map<string, Captive>();
  private readonly nextAct = new Map<string, number>();
  private readonly byRoom = new Map<string, HidingSpotDef[]>();
  private readonly spotsById = new Map<string, HidingSpotDef>();

  constructor(spots: readonly HidingSpotDef[], private readonly host: CatchHost) {
    for (const s of spots) {
      this.spotsById.set(s.id, s);
      const l = this.byRoom.get(s.room) ?? [];
      l.push(s);
      this.byRoom.set(s.room, l);
    }
  }

  // ------------------------------------------------------------------------------------------------------- queries
  isHidden(id: string): boolean { return this.hiddenIn.has(id); }
  isCaptured(id: string): boolean { return this.captives.has(id); }
  hiddenIds(): ReadonlySet<string> { return new Set(this.hiddenIn.keys()); }
  /** Who hides in a spot, or null. Only the ghost asks (when it opens that spot). */
  occupantOf(spotId: string): string | null {
    for (const [pid, sid] of this.hiddenIn) if (sid === spotId) return pid;
    return null;
  }
  /** P3E step 5: everyone hiding in a spot (up to `CATCH_LIMITS.spotCapacity`), in the order they entered. */
  occupantsOf(spotId: string): string[] {
    const out: string[] = [];
    for (const [pid, sid] of this.hiddenIn) if (sid === spotId) out.push(pid);
    return out;
  }
  get capturedCount(): number { return this.captives.size; }
  /** Ticks until a caught player is released (null if not caught). */
  releaseIn(id: string): number | null { const c = this.captives.get(id); return c ? Math.max(0, c.until - this.host.tick) : null; }
  /** Rescue progress of a caught player, 0 to 1 (null if not caught). */
  rescueProgress(id: string): number | null { const c = this.captives.get(id); return c ? c.progress / CATCH_LIMITS.rescueTicks : null; }

  // ------------------------------------------------------------------------------------------------------- hide and leave
  hide(id: string): CatchResult {
    const me = this.host.who().find((w) => w.id === id);
    if (!me || !me.connected) return fail('You are not part of this run.');
    if (this.captives.has(id)) return fail('You are caught. Wait for a teammate.');
    if (this.hiddenIn.has(id)) return fail('You are already hiding.');
    const t = this.host.tick;
    if (t < (this.nextAct.get(id) ?? 0)) return fail('Too fast.');
    this.nextAct.set(id, t + CATCH_LIMITS.hideCooldownTicks);
    if (this.host.watched(id)) return fail('It is watching you. There is no time to hide.');
    let best: HidingSpotDef | null = null, bestD = Infinity;
    for (const s of this.byRoom.get(me.room) ?? []) {
      const dx = Math.abs(s.x - me.x);
      if (dx > CATCH_LIMITS.hideRange || Math.abs(s.y - me.y) > RANGE_DY || this.occupantsOf(s.id).length >= CATCH_LIMITS.spotCapacity) continue;
      if (dx < bestD) { best = s; bestD = dx; }
    }
    // no spot, a full spot and a spot out of reach all read the same
    if (!best) return fail('There is nowhere to hide here.');
    this.hiddenIn.set(id, best.id);
    this.host.freeze(id, true);
    return { ok: true, message: `You hide in the ${best.kind}. Stay quiet. E to come out.` };
  }

  leave(id: string): CatchResult {
    if (!this.hiddenIn.has(id)) return fail('You are not hiding.');
    const t = this.host.tick;
    if (t < (this.nextAct.get(id) ?? 0)) return fail('Too fast.');
    this.nextAct.set(id, t + CATCH_LIMITS.hideCooldownTicks);
    this.hiddenIn.delete(id);
    this.host.freeze(id, false);
    return { ok: true, message: 'You step out.' };
  }

  // ------------------------------------------------------------------------------------------------------- the catch
  /** The ghost caught a player (touching them, or opening their hiding place). */
  capture(id: string, _ev?: GhostCatchEvent): void {
    if (this.captives.has(id)) return;
    const me = this.host.who().find((w) => w.id === id);
    if (!me) return;
    this.hiddenIn.delete(id);
    this.captives.set(id, { until: this.host.tick + CATCH_LIMITS.captureTicks, progress: 0, by: null, dropsLeft: true, attempts: 0 });
    this.host.freeze(id, true);
    this.host.say(`${me.name} was caught! Hold E next to them to set them free.`, 'bad', me.room);
  }

  /** A player left the run: forget them. */
  remove(id: string): void { this.hiddenIn.delete(id); this.captives.delete(id); this.nextAct.delete(id); }

  /** Once per server tick, after the players have moved. */
  step(): void {
    const t = this.host.tick;
    const who = this.host.who();
    for (const [id, c] of [...this.captives]) {
      const me = who.find((w) => w.id === id);
      if (!me) { this.captives.delete(id); continue; }
      // what they carried falls where they stand, one part at a time (the item system rate-limits each drop); bounded retries
      if (c.dropsLeft) {
        c.attempts++;
        if (this.host.dropOne(id) === 0 || c.attempts > 80) c.dropsLeft = false;
      }
      // a rescuer is a free, connected, visible-to-nobody-needed teammate in reach HOLDING E (the first in slot order counts)
      const rescuer = who.find((w) => w.id !== id && w.connected && w.use && !this.captives.has(w.id) && !this.hiddenIn.has(w.id)
        && w.room === me.room && Math.abs(w.x - me.x) <= CATCH_LIMITS.rescueRange && Math.abs(w.y - me.y) <= RANGE_DY);
      if (rescuer) { c.progress++; c.by = rescuer.id; } else c.progress = Math.max(0, c.progress - CATCH_LIMITS.rescueDecayPerTick);
      if (c.progress >= CATCH_LIMITS.rescueTicks) {
        const by = who.find((w) => w.id === c.by);
        this.captives.delete(id);
        this.host.freeze(id, false);
        this.host.say(`${by?.name ?? 'A teammate'} freed ${me.name}.`, 'good', me.room);
        continue;
      }
      if (t >= c.until) {
        this.captives.delete(id);
        this.host.placeAtEntry(id);
        this.host.freeze(id, false);
        this.host.penalty(CATCH_LIMITS.releasePenalty);
        this.host.say(`${me.name} was released at the entrance of the room. The team loses ${CATCH_LIMITS.releasePenalty} points.`, 'warn', me.room);
      }
    }
  }

  // ------------------------------------------------------------------------------------------------------- what a player may know
  /** The hiding spots the viewer can see, whether they hide, their own timer, and the caught teammates in view (with the rescue progress). */
  statusFor(viewerId: string): GhostStatus {
    const who = this.host.who();
    const me = who.find((w) => w.id === viewerId);
    const spots = me
      ? (this.byRoom.get(me.room) ?? []).filter((s) => this.host.canSee(viewerId, s.x, s.y - CATCH_LIMITS.spotPointHeight)).map((s) => ({ id: s.id, x: s.x, y: s.y, kind: s.kind }))
      : [];
    const mine = this.captives.get(viewerId);
    const captives = me
      ? [...this.captives].filter(([id]) => id !== viewerId).flatMap(([id, c]) => {
        const w = who.find((x) => x.id === id);
        if (!w || w.room !== me.room || !this.host.canSee(viewerId, w.x, w.y - 28)) return [];
        return [{ id, progress: Math.round((Math.min(1, c.progress / CATCH_LIMITS.rescueTicks)) * 10) / 10 }];
      })
      : [];
    return {
      spots,
      hiddenIn: this.hiddenIn.get(viewerId) ?? null,
      caught: mine ? { secondsLeft: Math.min(60, Math.ceil(Math.max(0, mine.until - this.host.tick) / 20)) } : null,
      captives,
    };
  }
}
