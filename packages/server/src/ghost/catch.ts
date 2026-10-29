import { CATCH_LIMITS, RANGE_DY, type GhostStatus } from '@wb/shared';
import type { GhostCatchEvent, HidingSpotDef } from './types';

/** Where one player is, as the catch rules need it. Feet-centre like every body. */
export interface CatchWho { id: string; name: string; room: string; x: number; y: number; connected: boolean; use: boolean }

/** What the catch rules may ask of their host (the Room). A narrow seam, so they are unit-testable without a Room. */
export interface CatchHost {
  readonly tick: number;
  /** Every player of the run, in slot order. */
  who(): CatchWho[];
  /** Freeze (hiding: no movement) or free a player. */
  freeze(id: string, on: boolean): void;
  /**
   * P4: a ghost killed this player (it touched them, or it opened their hiding place). The host decides what that means: the death system turns the
   * player into a body (Easy, Intermediate) or eliminates them (Hardcore), drops what they carried and records the event.
   */
  kill(id: string, ev?: GhostCatchEvent): void;
  /** P4: is the player dead (a body or eliminated)? A dead player cannot hide. */
  dead(id: string): boolean;
  say(text: string, tone: 'info' | 'good' | 'warn' | 'bad', room?: string): void;
  /** Is a ghost watching this player (hunting and has just seen them)? Then they cannot hide. */
  watched(id: string): boolean;
  /** Is the point (x, y) of the viewer's own room in the viewer's view? */
  canSee(viewerId: string, x: number, y: number): boolean;
}

export type CatchResult = { ok: true; message: string } | { ok: false; error: string };
const fail = (error: string): CatchResult => ({ ok: false, error });

/**
 * Hiding places, and the seam where a ghost's kill enters the game. One instance per stage, owned by the Room (not a second state machine: the ghost keeps
 * its own machine, the player-life machine lives in `death/`, this holds who is hidden where). Everything is server-side and a function of the tick and the
 * inputs, so it is deterministic.
 *
 *   hide   E at a hiding spot: the player stops (frozen), is not seen and makes no noise. Refused while a ghost is watching them, and when dead.
 *   kill   P4: the ghost touches a player, or opens the spot they hide in: they are taken out of the spot and the host kills them (`CatchHost.kill`).
 *
 * P3E's interim rule (captured, rescued by holding E, released after 45 s with a score penalty) is GONE: touch is death now. See docs/DEATH.md.
 */
export class CatchSystem {
  private readonly hiddenIn = new Map<string, string>();
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
  /** P4: true for a player who is dead (name kept from the interim capture rule: the ghost's `captured` flag now means "not a target any more"). */
  isCaptured(id: string): boolean { return this.host.dead(id); }
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
  /** Deprecated (kept so no export disappears): the number of dead players. */
  get capturedCount(): number { return this.host.who().filter((w) => this.host.dead(w.id)).length; }
  /** Deprecated (P3E interim rule): nobody is released any more. Always null. */
  releaseIn(_id: string): number | null { return null; }
  /** Deprecated (P3E interim rule): nobody is rescued by holding E any more. Always null. */
  rescueProgress(_id: string): number | null { return null; }

  // ------------------------------------------------------------------------------------------------------- hide and leave
  hide(id: string): CatchResult {
    const me = this.host.who().find((w) => w.id === id);
    if (!me || !me.connected) return fail('You are not part of this run.');
    if (this.host.dead(id)) return fail('You are dead. You can only watch.');
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

  // ------------------------------------------------------------------------------------------------------- the kill
  /**
   * The ghost killed a player (touching them, or opening their hiding place). They leave the hiding spot first (a dead player is never "inside" a spot),
   * then the host takes over. The player stays frozen: it is now a body.
   */
  capture(id: string, ev?: GhostCatchEvent): void {
    if (!this.host.who().some((w) => w.id === id)) return;
    if (this.host.dead(id)) return; // killed twice (two ghosts, one tick) is one death
    this.hiddenIn.delete(id);
    this.host.kill(id, ev);
  }

  /** A player left the run: forget them. */
  remove(id: string): void { this.hiddenIn.delete(id); this.nextAct.delete(id); }

  /** Kept for the Room's tick order (there is nothing to count down any more). */
  step(): void { /* P4: no capture timers, no rescue progress: touch is death */ }

  // ------------------------------------------------------------------------------------------------------- what a player may know
  /**
   * The hiding spots the viewer can see and whether they hide. `caught` and `captives` belong to the P3E interim rule and are always empty now
   * (the schema keeps them so no field disappears); who is dead is told by the P4 death messages instead.
   */
  statusFor(viewerId: string): GhostStatus {
    const who = this.host.who();
    const me = who.find((w) => w.id === viewerId);
    const spots = me && !this.host.dead(viewerId)
      ? (this.byRoom.get(me.room) ?? []).filter((s) => this.host.canSee(viewerId, s.x, s.y - CATCH_LIMITS.spotPointHeight)).map((s) => ({ id: s.id, x: s.x, y: s.y, kind: s.kind }))
      : [];
    return { spots, hiddenIn: this.hiddenIn.get(viewerId) ?? null, caught: null, captives: [] };
  }
}
