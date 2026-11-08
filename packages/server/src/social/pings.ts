import { PING_ANCHOR, PING_LIMITS, type PingKind, type PingMarker, type PingRequest } from '@wb/shared';

/** What the board needs to know about the pinger. All of it comes from the server's own state, never from the client. */
export interface Pinger { id: string; name: string; slot: number; alive: boolean; connected: boolean; room: string | null; x: number; y: number; hidden: boolean }
/** A teammate who may be sent the marker. */
export interface Recipient { id: string; room: string | null; connected: boolean; alive: boolean }
export interface PingEnv {
  tick: number;
  /** The pinger's own line of sight (see `makeSeer`). */
  sees: (x: number, y: number) => boolean;
  /** The ghosts the pinger can SEE (from their own restricted view). A ghost out of view is not here. */
  seenGhosts: readonly { x: number; y: number }[];
  /** The pinger can HEAR a ghost (their own ghost cue has a sound). */
  hearsGhost: boolean;
  recipients: readonly Recipient[];
}
export type PingResult = { ok: true; message: string } | { ok: false; error: string };
export interface Delivery { to: string; marker: PingMarker }
interface Live { id: number; owner: string; until: number; kind: PingKind; name: string; slot: number; room: string; x: number; y: number }

/**
 * P6 A: the ping board of one stage. Pure and clock-free (ticks are passed in). It validates, rate limits, expires and decides who is told what.
 * Rules (docs/PING.md): living players only; kinds are an enum; the point must lie in the pinger's own view; the label is fixed by the kind;
 * a recipient in another room is told the room and never a position; dead players neither send nor receive pings.
 */
export class PingBoard {
  private live: Live[] = [];
  private nextId = 1;
  private lastOk = new Map<string, number>();
  private tries = new Map<string, number[]>();
  private out: Delivery[] = [];

  /** Markers currently alive (for tests and the panel). */
  get active(): readonly Readonly<Live>[] { return this.live; }

  expire(tick: number): void { this.live = this.live.filter((l) => l.until > tick); }

  place(p: Pinger, req: PingRequest, env: PingEnv): PingResult {
    this.expire(env.tick);
    // every request counts, accepted or not: a refused flood is cut off before it costs anything
    const t = (this.tries.get(p.id) ?? []).filter((x) => env.tick - x < PING_LIMITS.attemptWindowTicks);
    if (t.length >= PING_LIMITS.attemptMax) { this.tries.set(p.id, t); return { ok: false, error: 'Slow down.' }; }
    t.push(env.tick); this.tries.set(p.id, t);

    if (!p.connected) return { ok: false, error: 'You are not connected.' };
    if (!p.alive) return { ok: false, error: 'Only the living can ping. Press G to say "ghost here".' };
    if (p.room === null) return { ok: false, error: 'You are not in a room.' };
    const last = this.lastOk.get(p.id);
    if (last !== undefined && env.tick >= last && env.tick - last < PING_LIMITS.cooldownTicks) return { ok: false, error: 'Wait a moment before pinging again.' };

    let x: number, y: number;
    const anchor = PING_ANCHOR[req.kind];
    if (anchor === 'point') {
      if (req.x === undefined || req.y === undefined) return { ok: false, error: 'Point at something to ping it.' };
      if (!env.sees(req.x, req.y)) return { ok: false, error: 'You can only ping what you can see.' };
      x = req.x; y = req.y;
    } else if (anchor === 'ghost') {
      // the nearest ghost the pinger SEES; a ghost that can only be heard is marked where the pinger stands ("near me"), never where it is
      const nearest = [...env.seenGhosts].sort((a, b) => Math.hypot(a.x - p.x, a.y - p.y) - Math.hypot(b.x - p.x, b.y - p.y))[0];
      if (nearest) { x = nearest.x; y = nearest.y; }
      else if (env.hearsGhost) { x = p.x; y = p.y; }
      else return { ok: false, error: 'You neither see nor hear a ghost.' };
    } else {
      if (req.kind === 'hide' && !p.hidden) return { ok: false, error: 'You are not hiding.' };
      x = p.x; y = p.y;
    }

    // bounded: this player's oldest goes first, then the team's oldest
    const mine = this.live.filter((l) => l.owner === p.id);
    while (mine.length >= PING_LIMITS.perPlayer) { const old = mine.shift()!; this.live = this.live.filter((l) => l !== old); }
    while (this.live.length >= PING_LIMITS.perTeam) this.live.shift();

    const id = this.nextId++;
    this.live.push({ id, owner: p.id, until: env.tick + PING_LIMITS.ttlTicks, kind: req.kind, name: p.name, slot: p.slot, room: p.room, x, y });
    this.lastOk.set(p.id, env.tick);

    for (const r of env.recipients) {
      if (!r.connected || !r.alive) continue; // the dead are told nothing (docs/PING.md: spectators keep only "ghost here")
      const same = r.room !== null && r.room === p.room;
      this.out.push({ to: r.id, marker: { id, kind: req.kind, from: p.id, name: p.name, slot: p.slot, room: p.room, ttl: PING_LIMITS.ttlTicks, ...(same ? { x, y } : {}) } });
    }
    if (this.out.length > 64) this.out.splice(0, this.out.length - 64);
    return { ok: true, message: 'Pinged.' };
  }

  /** Markers waiting to be sent, each to ONE player (taken once). */
  drain(): Delivery[] { const o = this.out; this.out = []; return o; }
  clear(): void { this.live = []; this.out = []; this.lastOk.clear(); this.tries.clear(); }
}
