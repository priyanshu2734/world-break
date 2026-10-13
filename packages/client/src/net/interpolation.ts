import type { GamePlayer, GameSnapshot } from '@wb/shared';

export interface InterpPlayer {
  x: number; y: number; facing: 1 | -1; grounded: boolean; connected: boolean;
}

/** Remote entities render this far in the past so there are always two snapshots to blend. */
export const INTERP_DELAY_MS = 100;
/** A jump larger than this between snapshots is a teleport (e.g. reset), not motion: never blend it. */
const TELEPORT_DISTANCE = 200;

interface Item { at: number; snap: GameSnapshot }

/** Time-stamped snapshot history used to interpolate remote players. */
export class SnapshotBuffer {
  private items: Item[] = [];
  constructor(private readonly maxItems = 40) {}

  get latest(): GameSnapshot | null { return this.items[this.items.length - 1]?.snap ?? null; }
  clear(): void { this.items = []; }

  push(at: number, snap: GameSnapshot): void {
    const last = this.items[this.items.length - 1];
    if (last) {
      if (snap.epoch !== last.snap.epoch) this.items = []; // arena reset: old history is meaningless
      else if (snap.tick < last.snap.tick) return; // stale/out-of-order
    }
    this.items.push({ at, snap });
    if (this.items.length > this.maxItems) this.items.shift();
  }

  /** Interpolated state of every player at `renderAt` (same clock as `push`). */
  sample(renderAt: number): Map<string, InterpPlayer> {
    const out = new Map<string, InterpPlayer>();
    const n = this.items.length;
    if (n === 0) return out;
    const first = this.items[0]!, last = this.items[n - 1]!;
    if (renderAt <= first.at || n === 1) return this.project(first.snap.players, out);
    if (renderAt >= last.at) return this.project(last.snap.players, out);

    let i = 0;
    while (i < n - 2 && this.items[i + 1]!.at <= renderAt) i++;
    const a = this.items[i]!, b = this.items[i + 1]!;
    const span = b.at - a.at;
    const t = span > 0 ? (renderAt - a.at) / span : 1;
    for (const pb of b.snap.players) {
      const pa = a.snap.players.find((p) => p.id === pb.id);
      const jump = pa ? Math.hypot(pb.x - pa.x, pb.y - pa.y) : Infinity;
      if (!pa || jump > TELEPORT_DISTANCE) {
        out.set(pb.id, pick(pb));
      } else {
        out.set(pb.id, {
          x: pa.x + (pb.x - pa.x) * t, y: pa.y + (pb.y - pa.y) * t,
          facing: pb.facing, grounded: pb.grounded, connected: pb.connected,
        });
      }
    }
    return out;
  }

  private project(players: GamePlayer[], out: Map<string, InterpPlayer>) {
    for (const p of players) out.set(p.id, pick(p));
    return out;
  }
}

const pick = (p: GamePlayer): InterpPlayer => ({
  x: p.x, y: p.y, facing: p.facing, grounded: p.grounded, connected: p.connected,
});
