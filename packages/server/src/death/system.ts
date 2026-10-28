import { nextPlayerLife, type Difficulty, type PlayerLife } from '@wb/shared';
import { deathTuning, DEATH_TABLE, type DeathTuning } from './tuning';
import type { BodyInfo, DeathEvent, DeathHost, KillCause, KillResult } from './types';

interface Rt {
  id: string;
  life: PlayerLife;
  /** Where and when the player died (null while alive). */
  diedAt: { tick: number; room: string; x: number; y: number } | null;
  cause: KillCause | null;
  /** The tick a body stops being revivable (a downed player), else 0. */
  reviveUntil: number;
  /** No ghost can kill this player before this tick (a revive sets it). */
  protectedUntil: number;
  /** Items are still being put down. */
  dropping: boolean;
  attempts: number;
}

/**
 * P4: who is alive, who is a body and who is eliminated. It uses the EXISTING player-life machine from shared `phases.ts` (`nextPlayerLife`):
 *
 *   alive --DOWN--> downed --REVIVE--> alive          Easy and Intermediate: a touch makes a body for `reviveWindowTicks`
 *                     \--BLEED_OUT--> eliminated      the window ran out
 *   alive --DOWN--> downed --BLEED_OUT--> eliminated  Hardcore: both steps in the SAME tick (no window, no revive)
 *
 * `eliminated` is terminal for the stage. A dead player (downed or eliminated) is frozen, is not a target, makes no noise and acts on nothing; the Room
 * refuses every one of their inputs. This class owns nothing else: the ghost decides WHO it touched (`GhostSystem`), the hiding places are the
 * `CatchSystem`, the stage flow (wipe, review, retry) belongs to the Room.
 *
 * Deterministic: a function of the host's tick and the calls made. No clock, no randomness, iteration in roster (slot) order.
 */
export class DeathSystem {
  readonly tuning: DeathTuning;
  private readonly rt = new Map<string, Rt>();
  private readonly log: DeathEvent[] = [];
  private pending: DeathEvent[] = [];
  /** Test and tooling switch: false = the ghost's touch never kills (solvability tests that measure the GENERATOR, not the ghost). Always true in a game. */
  private lethal = true;

  constructor(cfg: { difficulty: Difficulty; stage: number }, private readonly host: DeathHost) {
    this.tuning = deathTuning(cfg.difficulty, cfg.stage);
  }

  // ------------------------------------------------------------------------------------------------------- roster
  addPlayer(id: string): void {
    if (this.rt.has(id)) return;
    this.rt.set(id, { id, life: 'alive', diedAt: null, cause: null, reviveUntil: 0, protectedUntil: 0, dropping: false, attempts: 0 });
  }
  /** The player leaves the run for good. */
  removePlayer(id: string): void { this.rt.delete(id); }

  // ------------------------------------------------------------------------------------------------------- queries
  lifeOf(id: string): PlayerLife | undefined { return this.rt.get(id)?.life; }
  isAlive(id: string): boolean { return this.rt.get(id)?.life === 'alive'; }
  /** A body or eliminated. An unknown player is NOT dead (so a stray id never reads as a spectator). */
  isDead(id: string): boolean { const l = this.rt.get(id)?.life; return l === 'downed' || l === 'eliminated'; }
  /** A body that can still be revived. */
  isBody(id: string): boolean { return this.rt.get(id)?.life === 'downed'; }
  isEliminated(id: string): boolean { return this.rt.get(id)?.life === 'eliminated'; }
  /** The tick up to which this player cannot be killed (0 = not protected). */
  protectedUntil(id: string): number { return this.rt.get(id)?.protectedUntil ?? 0; }
  /** Ticks of spawn grace left at the host's tick (0 = the stage is past it). */
  get graceLeft(): number { return Math.max(0, this.tuning.spawnGraceTicks - this.host.tick); }
  /** Where and when a dead player died, and by what (null while alive or unknown). */
  deathOf(id: string): { tick: number; room: string; x: number; y: number; cause: KillCause } | null {
    const r = this.rt.get(id);
    return r && r.diedAt && r.cause ? { ...r.diedAt, cause: r.cause } : null;
  }
  /** Bodies that can still be revived, in roster order. */
  bodies(): BodyInfo[] {
    const out: BodyInfo[] = [];
    for (const r of this.rt.values()) {
      if (r.life !== 'downed' || !r.diedAt) continue;
      out.push({ id: r.id, name: this.nameOf(r.id), room: r.diedAt.room, x: r.diedAt.x, y: r.diedAt.y, reviveUntil: r.reviveUntil });
    }
    return out;
  }
  aliveIds(): string[] { return [...this.rt.values()].filter((r) => r.life === 'alive').map((r) => r.id); }
  /** Players who are alive AND connected: the ones who can still reach the exit. */
  activeAliveIds(): string[] {
    const online = new Set(this.host.who().filter((w) => w.connected).map((w) => w.id));
    return this.aliveIds().filter((id) => online.has(id));
  }
  /** Nobody who is alive can act any more (all dead, or the living are disconnected). */
  noneAlive(): boolean { return this.rt.size > 0 && this.activeAliveIds().length === 0; }
  /** Some dead player's items are still being put down. */
  get dropping(): boolean { return [...this.rt.values()].some((r) => r.dropping); }
  /** May a ghost kill this player now? False when dead, unknown, in the stage's spawn grace, or protected after a revive. */
  canKill(id: string): boolean {
    const r = this.rt.get(id);
    return this.lethal && !!r && r.life === 'alive' && this.host.tick >= this.tuning.spawnGraceTicks && this.host.tick >= r.protectedUntil;
  }

  /** Turn lethality off (tests of stage solvability only). A refused kill is logged as `kill_refused`/`protected`. */
  setLethal(on: boolean): void { this.lethal = on; }
  get isLethal(): boolean { return this.lethal; }

  /** The events logged so far (a ring). Read-only. */
  get events(): readonly DeathEvent[] { return this.log; }
  /** Events logged since the last call (for a consumer that forwards them, e.g. the death review). */
  drainEvents(): DeathEvent[] { const p = this.pending; this.pending = []; return p; }

  // ------------------------------------------------------------------------------------------------------- the kill
  /**
   * A ghost killed a player. Refused (nothing changes, a `kill_refused` event) when the player is not alive, is in the spawn grace or is protected.
   * Otherwise: alive -DOWN-> downed, and on Hardcore downed -BLEED_OUT-> eliminated in the same tick. The body stays frozen where it fell and what it
   * carried is put down there, one part every few ticks (`step`).
   */
  kill(id: string, cause: KillCause): KillResult {
    const t = this.host.tick, r = this.rt.get(id);
    const refuse = (reason: 'unknown_player' | 'not_alive' | 'spawn_grace' | 'protected'): KillResult => {
      this.record({ tick: t, kind: 'kill_refused', player: id, reason, ghost: cause.ghost });
      return { ok: false, reason };
    };
    if (!r) return refuse('unknown_player');
    if (r.life !== 'alive') return refuse('not_alive');
    if (t < this.tuning.spawnGraceTicks) return refuse('spawn_grace');
    if (t < r.protectedUntil || !this.lethal) return refuse('protected');
    const w = this.host.who().find((x) => x.id === id);
    if (!w) return refuse('unknown_player');

    r.life = nextPlayerLife(r.life, 'DOWN');
    if (!this.tuning.revivable) r.life = nextPlayerLife(r.life, 'BLEED_OUT'); // Hardcore: no window
    r.diedAt = { tick: t, room: w.room, x: w.x, y: w.y };
    r.cause = cause;
    r.reviveUntil = r.life === 'downed' ? t + this.tuning.reviveWindowTicks : 0;
    r.dropping = true; r.attempts = 0;
    this.host.leaveHiding(id);
    this.host.freeze(id, true);
    this.record({ tick: t, kind: 'killed', player: id, name: w.name, life: r.life, cause, room: w.room, x: w.x, y: w.y, carrying: this.host.carried(id), reviveUntil: r.life === 'downed' ? r.reviveUntil : null });
    this.host.say(`${w.name} was killed.`, 'bad', w.room);
    return { ok: true, life: r.life };
  }

  /**
   * The state change of a revive: downed -REVIVE-> alive, with `protectionTicks` of protection. The ACTION (the Revive Cell, holding E) is a later
   * step; this is only the transition, so every arrow of the machine is exercised. Refused for anyone who is not a body inside the window.
   */
  revive(id: string, by: string | null): { ok: true } | { ok: false; reason: 'not_a_body' | 'window_over' | 'no_revive_here' } {
    const t = this.host.tick, r = this.rt.get(id);
    if (!this.tuning.revivable) return { ok: false, reason: 'no_revive_here' };
    if (!r || r.life !== 'downed') return { ok: false, reason: 'not_a_body' };
    if (t >= r.reviveUntil) return { ok: false, reason: 'window_over' };
    r.life = nextPlayerLife(r.life, 'REVIVE');
    r.protectedUntil = t + this.tuning.protectionTicks;
    r.reviveUntil = 0; r.dropping = false;
    this.host.freeze(id, false);
    this.record({ tick: t, kind: 'revived', player: id, name: this.nameOf(id), by, protectedUntil: r.protectedUntil });
    return { ok: true };
  }

  // ------------------------------------------------------------------------------------------------------- per tick
  /** Once per server tick: put down what the dead carried (one part per call, the item system spaces them), and run out the revive windows. */
  step(): void {
    const t = this.host.tick;
    for (const r of this.rt.values()) {
      if (r.life === 'alive') continue;
      if (r.dropping) this.dropStep(r, t);
      if (r.life === 'downed' && t >= r.reviveUntil) {
        r.life = nextPlayerLife(r.life, 'BLEED_OUT');
        r.reviveUntil = 0;
        this.record({ tick: t, kind: 'window_expired', player: r.id, name: this.nameOf(r.id) });
        const at = r.diedAt;
        this.host.say(`${this.nameOf(r.id)} can no longer be revived.`, 'warn', at?.room);
      }
    }
  }

  private dropStep(r: Rt, t: number): void {
    r.attempts++;
    const res = this.host.dropOne(r.id);
    if (res.dropped) {
      const at = r.diedAt;
      this.record({
        tick: t, kind: 'item_dropped', player: r.id, itemId: res.dropped.itemId, itemKind: res.dropped.kind, room: res.dropped.room, x: res.dropped.x, y: res.dropped.y,
        relocated: at ? Math.abs(res.dropped.x - at.x) > 1 : false,
      });
    }
    if (res.left === 0) { r.dropping = false; return; }
    if (r.attempts > this.tuning.dropAttempts) {
      // never leave a part in a dead player's hands (a mandatory part would be lost): put everything down now
      this.host.dropAll(r.id);
      this.record({ tick: t, kind: 'drops_forced', player: r.id, left: res.left });
      r.dropping = false;
    }
  }

  // ------------------------------------------------------------------------------------------------------- connection
  /** The player's connection dropped. What they still carry is put down by the item system; a dead player stays dead (a spectator that is gone). */
  disconnect(id: string): void {
    const r = this.rt.get(id);
    if (!r) return;
    r.dropping = false; // the item system puts down whatever is left when a connection is lost
    this.record({ tick: this.host.tick, kind: 'disconnected', player: id, life: r.life });
  }

  // ------------------------------------------------------------------------------------------------------- internals
  private nameOf(id: string): string { return this.host.who().find((w) => w.id === id)?.name ?? 'A player'; }
  private record(e: DeathEvent): void {
    this.log.push(e); this.pending.push(e);
    if (this.log.length > DEATH_TABLE.maxEvents) this.log.splice(0, this.log.length - DEATH_TABLE.maxEvents);
  }
}
