import { REVIVE } from './tuning';

/** A player who could revive: who they are, where, whether E is held and whether they are free to act. */
export interface Reviver { id: string; room: string; x: number; y: number; use: boolean; connected: boolean; alive: boolean; hidden: boolean }
/** A body that may be revived (inside its window). */
export interface ReviveBody { id: string; name: string; room: string; x: number; y: number }

/** What reviving may ask of its host (the Room). A narrow seam, so it is unit-testable without a Room. */
export interface ReviveHost {
  readonly tick: number;
  people(): Reviver[];
  bodies(): ReviveBody[];
  /** Does this player carry a genuine Revive Cell right now? */
  carriesCell(id: string): boolean;
  /** Spend the Revive Cell this player carries (true = it was theirs to spend). */
  spendCell(id: string): boolean;
  /** Could this body be revived right now (inside its window, on a mode with a revive)? A cell is never spent on a body that cannot come back. */
  canRevive(bodyId: string): boolean;
  /** The death system's REVIVE transition. */
  revive(bodyId: string, by: string): { ok: boolean };
  say(text: string, tone: 'info' | 'good' | 'warn' | 'bad', room?: string): void;
  /** P4 step 4 (optional): a revive attempt began, was given up (let go, stepped away, hid, died), or was completed. For the death review. */
  note?(kind: 'start' | 'stop' | 'done', by: string, body: string): void;
}

/** What one player is told about a revive in progress (to the reviver and to the body only). */
export interface ReviveProgress { reviver: string; body: string; progress: number }

/**
 * P4 step 3: the revive action. Per tick, a living, connected, visible-to-the-rules player who HOLDS E, carries the Revive Cell and stands within
 * `REVIVE.range` of a body in their room accumulates `REVIVE.holdTicks` ticks; letting go, stepping away, dying, hiding, losing the cell or the body
 * running out of window starts it over. When the hold is complete the cell is spent and the death system brings the body back (alive, 5 s protection, empty hands).
 *
 *   - One reviver per body and one body per reviver at a time (the nearer body wins; the first reviver keeps it).
 *   - The ghost standing on the body does not stop it: that is the risk.
 *   - A refused REVIVE (Hardcore, window over) spends nothing.
 */
export class ReviveSystem {
  /** reviver id -> { body, ticks held }. Bounded by the number of players. */
  private readonly holds = new Map<string, { body: string; ticks: number }>();

  constructor(private readonly host: ReviveHost) {}

  private inReach(p: Reviver, b: ReviveBody): boolean {
    return b.room === p.room && Math.abs(p.x - b.x) <= REVIVE.range && Math.abs(p.y - b.y) <= REVIVE.dy;
  }

  /** Once per server tick (after the death system's step). */
  step(): void {
    const people = this.host.people(), bodies = this.host.bodies();
    const taken = new Set<string>(); // a body somebody is already working on this tick
    const keep = new Map<string, { body: string; ticks: number }>();
    const finished = new Set<string>(); // reviewers whose hold ended in a revive this tick
    for (const p of people) {
      const prev = this.holds.get(p.id);
      const ready = p.alive && p.connected && !p.hidden && p.use && this.host.carriesCell(p.id);
      if (!ready) continue;
      // keep working on the same body while in reach; else take the nearest free one
      let body = prev ? bodies.find((b) => b.id === prev.body && this.inReach(p, b) && !taken.has(b.id)) : undefined;
      if (!body) {
        let bestD = Infinity;
        for (const b of bodies) {
          if (taken.has(b.id) || !this.inReach(p, b)) continue;
          const d = Math.abs(p.x - b.x);
          if (d < bestD) { body = b; bestD = d; }
        }
      }
      if (!body) continue;
      taken.add(body.id);
      const ticks = (prev && prev.body === body.id ? prev.ticks : 0) + 1;
      if (ticks === 1) this.host.note?.('start', p.id, body.id);
      if (ticks >= REVIVE.holdTicks) {
        if (this.host.canRevive(body.id) && this.host.spendCell(p.id)) {
          const r = this.host.revive(body.id, p.id);
          if (r.ok) { this.host.say(`${body.name} is back on their feet.`, 'good', body.room); this.host.note?.('done', p.id, body.id); }
        }
        finished.add(p.id);
        continue; // done (or refused): nothing to carry over, start from nothing next tick
      }
      keep.set(p.id, { body: body.id, ticks });
    }
    for (const [by, h] of this.holds) if (!keep.has(by) && !finished.has(by)) this.host.note?.('stop', by, h.body); // a hold that was running and is not any more
    this.holds.clear();
    for (const [k, v] of keep) this.holds.set(k, v);
  }

  /** Progress of every revive in progress (0..1), for the people it concerns. */
  progress(): ReviveProgress[] {
    return [...this.holds.entries()].map(([reviver, h]) => ({ reviver, body: h.body, progress: Math.min(1, h.ticks / REVIVE.holdTicks) }));
  }

  /** Forget a player who left the run. */
  remove(id: string): void { this.holds.delete(id); }
}
