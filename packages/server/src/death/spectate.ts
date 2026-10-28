import { SPECTATE, type GhostPing, type GhostPublic } from '@wb/shared';

/** What spectating may ask of its host (the Room). A narrow seam, so it is unit-testable without a Room. */
export interface SpectateHost {
  readonly tick: number;
  /** Every player of the run, in slot (team) order. */
  roster(): { id: string; name: string; connected: boolean }[];
  /** A body or eliminated. */
  isDead(id: string): boolean;
  isAlive(id: string): boolean;
}

export type SpectateResult = { ok: true; message: string } | { ok: false; error: string };
export type PingResult = { ok: true; ping: GhostPing } | { ok: false; error: string };
const fail = (error: string): { ok: false; error: string } => ({ ok: false, error });

/**
 * P4 step 2: whom a dead player watches, and their "ghost here" ping. Not a state machine: a player's life is `DeathSystem`'s; this only holds
 * a target per dead player and a ping clock. Deterministic: a function of the host's tick, the roster order and the calls made.
 *
 *   - A dead player watches an ALIVE, CONNECTED teammate (never themselves, never another dead player).
 *   - They start on the next living teammate after themselves in team order; `follow` picks another (an id, or `next` / `prev` in team order).
 *   - When the target dies or disconnects the camera moves on at the next `step()`, to the next living teammate after it in team order (or nobody).
 *   - Every request from a player who is not dead is refused; so is a target who is not watchable.
 */
export class SpectateSystem {
  private readonly target = new Map<string, string | null>();
  private readonly lastPing = new Map<string, number>();

  constructor(private readonly host: SpectateHost) {}

  /** The living, connected teammates `id` could watch, in team order. */
  watchable(id: string): { id: string; name: string }[] {
    return this.host.roster().filter((p) => p.id !== id && p.connected && this.host.isAlive(p.id)).map((p) => ({ id: p.id, name: p.name }));
  }
  /** Whom `id` watches now (null: nobody, or not a spectator). */
  targetOf(id: string): string | null { return this.host.isDead(id) ? (this.target.get(id) ?? null) : null; }
  following(id: string): { id: string; name: string } | null {
    const t = this.targetOf(id);
    const p = t === null ? undefined : this.host.roster().find((r) => r.id === t);
    return p ? { id: p.id, name: p.name } : null;
  }

  /** The next living teammate after `from` (a player id or null = start of the list) in team order, wrapping, never `id` itself. Null when nobody is watchable. */
  private nextAfter(id: string, from: string | null, dir: 1 | -1): string | null {
    const roster = this.host.roster();
    const ok = new Set(this.watchable(id).map((w) => w.id));
    if (ok.size === 0) return null;
    const start = from === null ? roster.findIndex((r) => r.id === id) : roster.findIndex((r) => r.id === from);
    const n = roster.length;
    for (let k = 1; k <= n; k++) {
      const cand = roster[(((start < 0 ? 0 : start) + dir * k) % n + n) % n]!;
      if (ok.has(cand.id)) return cand.id;
    }
    return null;
  }

  /** A dead player asks to watch `target` (a teammate's id, `next` or `prev`). */
  request(id: string, target: string): SpectateResult {
    if (!this.host.isDead(id)) return fail('You are not dead.');
    if (target === 'next' || target === 'prev') {
      const to = this.nextAfter(id, this.targetOf(id), target === 'next' ? 1 : -1);
      if (to === null) return fail('Nobody is left to watch.');
      this.target.set(id, to);
    } else {
      if (!this.watchable(id).some((w) => w.id === target)) return fail('You cannot watch that player.');
      this.target.set(id, target);
    }
    return { ok: true, message: `Watching ${this.following(id)?.name ?? 'a teammate'}.` };
  }

  /** Once per server tick: give every spectator a valid target (new spectators, and the ones whose target died or left). */
  step(): void {
    for (const p of this.host.roster()) {
      if (!this.host.isDead(p.id)) { this.target.delete(p.id); continue; } // revived (or never dead): not a spectator any more
      const cur = this.target.get(p.id) ?? null;
      if (cur !== null && this.watchable(p.id).some((w) => w.id === cur)) continue;
      this.target.set(p.id, this.nextAfter(p.id, cur, 1));
    }
  }

  /** Ticks until `id` may ping again (0 = ready). */
  pingReadyIn(id: string): number {
    const last = this.lastPing.get(id);
    return last === undefined ? 0 : Math.max(0, last + SPECTATE.pingCooldownTicks - this.host.tick);
  }

  /**
   * "Ghost here". `seen` is the ghosts in the SPECTATOR'S OWN VIEW as the server computed it (never anything the client sent), nearest first. The client
   * sends no coordinates: it can only say "I saw one", and the position comes from the ghost the server knows the spectator can see.
   */
  ping(id: string, seen: readonly GhostPublic[]): PingResult {
    if (!this.host.isDead(id)) return fail('You are not dead.');
    if (this.targetOf(id) === null) return fail('Nobody is left to watch.');
    if (this.pingReadyIn(id) > 0) return fail('Too fast.');
    const g = seen[0];
    if (!g) return fail('No ghost in view.');
    this.lastPing.set(id, this.host.tick);
    const from = this.host.roster().find((r) => r.id === id)?.name ?? 'A spectator';
    return { ok: true, ping: { tick: this.host.tick, room: g.room, x: Math.round(g.x), y: Math.round(g.y), from: from.slice(0, 24) } };
  }

  /** A player left the run: forget them. */
  remove(id: string): void { this.target.delete(id); this.lastPing.delete(id); }
}
