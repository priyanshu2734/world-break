import { SERVER_TICK_HZ, SPECTATE, stepSpectatorCam, type GhostPing, type GhostPublic, type SpectateMove, type SpectatorCam } from '@wb/shared';

/** What spectating may ask of its host (the Room). A narrow seam, so it is unit-testable without a Room. */
export interface SpectateHost {
  readonly tick: number;
  /** Every player of the run, in slot (team) order. */
  roster(): { id: string; name: string; connected: boolean }[];
  /** A body or eliminated. */
  isDead(id: string): boolean;
  isAlive(id: string): boolean;
  /** P4 step 6: the rooms of the stage, in order (one id for a stage with a single arena). */
  rooms(): string[];
  /** P4 step 6: the size of a room's arena, or null for a room that does not exist. A camera never leaves it. */
  bounds(room: string): { w: number; h: number } | null;
  /** P4 step 6: where a player is (their room and position), or null if unknown. */
  positionOf(id: string): { room: string; x: number; y: number } | null;
}

export type SpectateResult = { ok: true; message: string } | { ok: false; error: string };
export type PingResult = { ok: true; ping: GhostPing } | { ok: false; error: string };
const fail = (error: string): { ok: false; error: string } => ({ ok: false, error });

/**
 * P4 step 2: whom a dead player watches, and their "ghost here" ping. Not a state machine: a player's life is `DeathSystem`'s; this only holds
 * a target and a camera per dead player and a ping clock. Deterministic: a function of the host's tick, the roster order and the calls made.
 *
 *   - A dead player watches an ALIVE, CONNECTED teammate (never themselves, never another dead player).
 *   - They start on the next living teammate after themselves in team order; `follow` picks another (an id, or `next` / `prev` in team order).
 *   - When the target dies or disconnects the camera moves on at the next `step()`, to the next living teammate after it in team order (or nobody).
 *   - Every request from a player who is not dead is refused; so is a target who is not watchable.
 */
export class SpectateSystem {
  private readonly target = new Map<string, string | null>();
  private readonly lastPing = new Map<string, number>();
  /** P4 step 6: each spectator's camera and the last move intent (with the tick it arrived), and the tick of their last move or room message (for the rate limit). */
  private readonly cams = new Map<string, SpectatorCam>();
  private readonly intents = new Map<string, { move: SpectateMove; at: number }>();
  private readonly lastMsg = new Map<string, number>();

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
    const cam = this.cams.get(id);
    if (cam) this.cams.set(id, { ...cam, free: false }); // following again: the camera goes back to the teammate
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
    for (const p of this.host.roster()) this.stepCam(p.id);
  }

  /** The camera of a dead player (null for the living, or before the first step after they died). */
  camOf(id: string): SpectatorCam | null { return this.host.isDead(id) ? (this.cams.get(id) ?? null) : null; }

  private home(): { room: string; w: number; h: number } | null {
    const room = this.host.rooms()[0];
    const b = room ? this.host.bounds(room) : null;
    return room && b ? { room, ...b } : null;
  }

  /** One server tick of one spectator's camera: sits on the followed teammate, or flies on the last intent (which lapses after `camIntentTtlTicks` of silence). */
  private stepCam(id: string): void {
    if (!this.host.isDead(id)) { this.cams.delete(id); this.intents.delete(id); this.lastMsg.delete(id); return; }
    let cam = this.cams.get(id);
    if (!cam) {
      const at = this.host.positionOf(this.targetOf(id) ?? id) ?? this.host.positionOf(id);
      const home = this.home();
      cam = at ? { room: at.room, x: at.x, y: at.y, free: false } : home ? { room: home.room, x: home.w / 2, y: home.h / 2, free: true } : undefined;
      if (!cam) return;
    }
    const t = this.targetOf(id);
    if (!cam.free && t !== null) { const p = this.host.positionOf(t); if (p) cam = { room: p.room, x: p.x, y: p.y, free: false }; }
    let bounds = this.host.bounds(cam.room);
    if (!bounds) { const home = this.home(); if (!home) return; cam = { room: home.room, x: home.w / 2, y: home.h / 2, free: true }; bounds = { w: home.w, h: home.h }; }
    const it = this.intents.get(id);
    if (cam.free && it && this.host.tick - it.at <= SPECTATE.camIntentTtlTicks) cam = stepSpectatorCam(cam, it.move, 1 / SERVER_TICK_HZ, bounds);
    this.cams.set(id, { ...cam, x: Math.min(Math.max(cam.x, 0), bounds.w), y: Math.min(Math.max(cam.y, 0), bounds.h) });
  }

  /** The rate limit for camera messages: one per `camMinGapTicks` per spectator. A refusal changes nothing. */
  private gap(id: string): boolean {
    const last = this.lastMsg.get(id);
    if (last !== undefined && this.host.tick - last < SPECTATE.camMinGapTicks) return false;
    this.lastMsg.set(id, this.host.tick);
    return true;
  }

  /** A dead player holds the camera keys: `move` is -1, 0 or 1 on each axis. Any movement takes the camera off the teammate it was following. */
  move(id: string, move: SpectateMove): SpectateResult {
    if (!this.host.isDead(id)) return fail('You are not dead.');
    if (!this.gap(id)) return fail('Too fast.');
    this.intents.set(id, { move, at: this.host.tick });
    const cam = this.cams.get(id);
    if (cam && !cam.free && (move.x !== 0 || move.y !== 0)) this.cams.set(id, { ...cam, free: true });
    return { ok: true, message: 'Camera moved.' };
  }

  /** A dead player asks for another room of the stage (`next`, `prev`, or an id). The camera goes to the middle of it and flies free. */
  room(id: string, req: string): SpectateResult {
    if (!this.host.isDead(id)) return fail('You are not dead.');
    if (!this.gap(id)) return fail('Too fast.');
    const rooms = this.host.rooms();
    if (rooms.length === 0) return fail('There is no such room.');
    let to: string | undefined;
    if (req === 'next' || req === 'prev') {
      const i = rooms.indexOf(this.cams.get(id)?.room ?? rooms[0]!);
      to = rooms[(((i < 0 ? 0 : i) + (req === 'next' ? 1 : -1)) % rooms.length + rooms.length) % rooms.length];
    } else if (rooms.includes(req)) to = req;
    const b = to ? this.host.bounds(to) : null;
    if (!to || !b) return fail('There is no such room.');
    this.cams.set(id, { room: to, x: b.w / 2, y: b.h / 2, free: true });
    this.intents.delete(id);
    return { ok: true, message: `Room ${rooms.indexOf(to) + 1} of ${rooms.length}.` };
  }

  /** Ticks until `id` may ping again (0 = ready). */
  pingReadyIn(id: string): number {
    const last = this.lastPing.get(id);
    return last === undefined ? 0 : Math.max(0, last + SPECTATE.pingCooldownTicks - this.host.tick);
  }

  /**
   * "Ghost here". `seen` is the ghosts the spectator is shown (all of them, as the server computed it, never anything the client sent), the one nearest their camera
   * first. The client sends no coordinates: it can only say "I saw one", and the position comes from the ghost the server knows.
   */
  ping(id: string, seen: readonly GhostPublic[]): PingResult {
    if (!this.host.isDead(id)) return fail('You are not dead.');
    if (this.pingReadyIn(id) > 0) return fail('Too fast.');
    const g = seen[0];
    if (!g) return fail('No ghost in view.');
    this.lastPing.set(id, this.host.tick);
    const from = this.host.roster().find((r) => r.id === id)?.name ?? 'A spectator';
    return { ok: true, ping: { tick: this.host.tick, room: g.room, x: Math.round(g.x), y: Math.round(g.y), from: from.slice(0, 24) } };
  }

  /** A player left the run: forget them. */
  remove(id: string): void { this.target.delete(id); this.lastPing.delete(id); this.cams.delete(id); this.intents.delete(id); this.lastMsg.delete(id); }
}
