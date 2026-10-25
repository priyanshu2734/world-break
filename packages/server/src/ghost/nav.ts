import type { RoomDef } from '@wb/shared';

/**
 * P3E: how a ghost finds its way. A ghost FLOATS: it is stopped by solids (the floor, platforms, walls) but not by gravity, so its world is the
 * free air of a room. That air is cut into square cells; a cell is blocked if any solid overlaps it. Paths run over the centres of free cells
 * (8 directions, never cutting a blocked corner), so a ghost that follows one can never be inside a solid. Doors are NOT obstacles here: a
 * ghost reaches a door and then spends time opening it (see system.ts), which is the only way between two parts of the world.
 *
 * Everything is integer-indexed and ties are broken by index, so a path is a pure function of (room, from, to): deterministic.
 */
export const CELL = 40;

export interface Pt { x: number; y: number }

const DIRS: readonly (readonly [number, number, number])[] = [
  [1, 0, 10], [-1, 0, 10], [0, 1, 10], [0, -1, 10], [1, 1, 14], [-1, 1, 14], [1, -1, 14], [-1, -1, 14],
];

export class NavGrid {
  readonly cols: number;
  readonly rows: number;
  private readonly blocked: Uint8Array;
  /** Connected free regions: cells of one label can reach each other without a door. -1 = blocked. */
  readonly label: Int32Array;
  readonly regions: number;

  constructor(readonly room: RoomDef) {
    const a = room.arena;
    this.cols = Math.ceil(a.width / CELL);
    this.rows = Math.ceil(a.height / CELL);
    this.blocked = new Uint8Array(this.cols * this.rows);
    for (const s of a.solids) {
      const c0 = Math.max(0, Math.floor(s.x / CELL)), c1 = Math.min(this.cols - 1, Math.ceil((s.x + s.w) / CELL) - 1);
      const r0 = Math.max(0, Math.floor(s.y / CELL)), r1 = Math.min(this.rows - 1, Math.ceil((s.y + s.h) / CELL) - 1);
      for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) this.blocked[r * this.cols + c] = 1;
    }
    this.label = new Int32Array(this.cols * this.rows).fill(-1);
    let n = 0;
    for (let i = 0; i < this.label.length; i++) {
      if (this.blocked[i] || this.label[i] !== -1) continue;
      const stack = [i];
      this.label[i] = n;
      while (stack.length > 0) {
        const cur = stack.pop()!;
        this.eachNeighbour(cur, (nb) => { if (this.label[nb] === -1) { this.label[nb] = n; stack.push(nb); } });
      }
      n++;
    }
    this.regions = n;
  }

  get size(): number { return this.cols * this.rows; }
  isFree(i: number): boolean { return i >= 0 && i < this.blocked.length && this.blocked[i] === 0; }
  cellOf(p: Pt): number {
    const c = Math.min(this.cols - 1, Math.max(0, Math.floor(p.x / CELL)));
    const r = Math.min(this.rows - 1, Math.max(0, Math.floor(p.y / CELL)));
    return r * this.cols + c;
  }
  centre(i: number): Pt { return { x: (i % this.cols) * CELL + CELL / 2, y: Math.floor(i / this.cols) * CELL + CELL / 2 }; }

  /** The free cell nearest to a point (the point's own cell if free), by growing square rings: deterministic. */
  nearestFree(p: Pt): number {
    const start = this.cellOf(p);
    if (this.isFree(start)) return start;
    const c0 = start % this.cols, r0 = Math.floor(start / this.cols);
    const maxRing = Math.max(this.cols, this.rows);
    for (let ring = 1; ring <= maxRing; ring++) {
      let best = -1, bestD = Infinity;
      for (let r = r0 - ring; r <= r0 + ring; r++) {
        for (let c = c0 - ring; c <= c0 + ring; c++) {
          if (Math.max(Math.abs(r - r0), Math.abs(c - c0)) !== ring) continue;
          if (r < 0 || c < 0 || r >= this.rows || c >= this.cols) continue;
          const i = r * this.cols + c;
          if (!this.isFree(i)) continue;
          const d = (c - c0) ** 2 + (r - r0) ** 2;
          if (d < bestD) { bestD = d; best = i; }
        }
      }
      if (best >= 0) return best;
    }
    return start;
  }

  /** Does a straight step from cell a to its neighbour b stay in free space (a diagonal may not cut a blocked corner)? */
  private eachNeighbour(i: number, f: (nb: number, cost: number) => void): void {
    const c = i % this.cols, r = Math.floor(i / this.cols);
    for (const [dc, dr, cost] of DIRS) {
      const nc = c + dc, nr = r + dr;
      if (nc < 0 || nr < 0 || nc >= this.cols || nr >= this.rows) continue;
      const nb = nr * this.cols + nc;
      if (this.blocked[nb]) continue;
      if (dc !== 0 && dr !== 0 && (this.blocked[r * this.cols + nc] || this.blocked[nr * this.cols + c])) continue;
      f(nb, cost);
    }
  }

  /** A* from one free cell to another. Returns the cells from `from` to `to` inclusive, or null if they are in different regions. */
  path(from: number, to: number): number[] | null {
    if (!this.isFree(from) || !this.isFree(to) || this.label[from] !== this.label[to]) return null;
    if (from === to) return [from];
    const N = this.size;
    const g = new Int32Array(N).fill(0x3fffffff);
    const prev = new Int32Array(N).fill(-1);
    const closed = new Uint8Array(N);
    const tc = to % this.cols, tr = Math.floor(to / this.cols);
    const h = (i: number) => {
      const dx = Math.abs((i % this.cols) - tc), dy = Math.abs(Math.floor(i / this.cols) - tr);
      return 10 * Math.max(dx, dy) + 4 * Math.min(dx, dy);
    };
    // binary heap of [f, index]; equal f is broken by the smaller index, so the result never depends on insertion luck
    const heap: number[] = [];
    const less = (a: number, b: number) => (heap[a * 2]! !== heap[b * 2]! ? heap[a * 2]! < heap[b * 2]! : heap[a * 2 + 1]! < heap[b * 2 + 1]!);
    const swap = (a: number, b: number) => { const f = heap[a * 2]!, i = heap[a * 2 + 1]!; heap[a * 2] = heap[b * 2]!; heap[a * 2 + 1] = heap[b * 2 + 1]!; heap[b * 2] = f; heap[b * 2 + 1] = i; };
    const push = (f: number, i: number) => {
      heap.push(f, i);
      let k = heap.length / 2 - 1;
      while (k > 0) { const p = (k - 1) >> 1; if (!less(k, p)) break; swap(k, p); k = p; }
    };
    const pop = (): number => {
      const top = heap[1]!;
      const last = heap.length / 2 - 1;
      swap(0, last); heap.length -= 2;
      let k = 0; const n = heap.length / 2;
      for (;;) {
        const l = 2 * k + 1, r = l + 1; let m = k;
        if (l < n && less(l, m)) m = l;
        if (r < n && less(r, m)) m = r;
        if (m === k) break;
        swap(k, m); k = m;
      }
      return top;
    };
    g[from] = 0;
    push(h(from), from);
    while (heap.length > 0) {
      const cur = pop();
      if (closed[cur]) continue;
      closed[cur] = 1;
      if (cur === to) break;
      this.eachNeighbour(cur, (nb, cost) => {
        if (closed[nb]) return;
        const ng = g[cur]! + cost;
        if (ng < g[nb]!) { g[nb] = ng; prev[nb] = cur; push(ng + h(nb), nb); }
      });
    }
    if (prev[to] === -1) return null;
    const out: number[] = [];
    for (let c = to; c !== -1; c = prev[c]!) out.push(c);
    return out.reverse();
  }
}
