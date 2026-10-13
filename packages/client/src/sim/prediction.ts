import {
  ARENA, TICK_DT, cloneBody, stepBody,
  type Arena, type GamePlayer, type InputIntent, type PlayerBody,
} from '@wb/shared';

const TICK_MS = TICK_DT * 1000;
/** After a stall (tab switch) never simulate more than this many ticks at once. */
export const MAX_CATCHUP_TICKS = 5;
/** Prediction error beyond this (px) is snapped, not smoothed. */
export const SNAP_DISTANCE = 100;
/** Visual error decays with this time constant (ms). */
const ERROR_DECAY_MS = 120;
const MAX_PENDING = 200;

export interface RenderState { x: number; y: number; facing: 1 | -1; grounded: boolean }

const toBody = (p: GamePlayer): PlayerBody => ({
  x: p.x, y: p.y, vx: p.vx, vy: p.vy, grounded: p.grounded, facing: p.facing,
});

/**
 * Client-side prediction for the LOCAL player only. It runs the same shared `stepBody`
 * as the server, sends one input intent per tick, and on every server snapshot rewinds to the
 * authoritative state and replays unacknowledged inputs. The server remains the authority:
 * a mismatch is always resolved in the server's favour.
 */
export class LocalPredictor {
  private head: PlayerBody | null = null;
  private prev: PlayerBody | null = null;
  private pending: { seq: number; input: InputIntent }[] = [];
  private acc = 0;
  private nextSeq = 0;
  private epoch = -1;
  private errX = 0;
  private errY = 0;

  constructor(
    private readonly send: (seq: number, input: InputIntent) => void,
    private readonly arena: Arena = ARENA,
  ) {}

  get active(): boolean { return this.head !== null; }
  get pendingCount(): number { return this.pending.length; }
  /** Number of intents sent so far (diagnostics). */
  get sentCount(): number { return this.nextSeq; }

  start(server: GamePlayer, epoch: number): void {
    this.head = toBody(server);
    this.prev = cloneBody(this.head);
    this.pending = [];
    this.acc = 0;
    this.errX = this.errY = 0;
    this.epoch = epoch;
  }

  stop(): void {
    this.head = this.prev = null;
    this.pending = [];
    this.acc = 0;
    this.errX = this.errY = 0;
  }

  /** Feed real frame time; runs whole fixed ticks, sending one intent per tick. */
  advance(dtMs: number, input: InputIntent): void {
    if (!this.head) return;
    const k = Math.exp(-dtMs / ERROR_DECAY_MS);
    this.errX *= k; this.errY *= k;
    if (Math.abs(this.errX) < 0.01) this.errX = 0;
    if (Math.abs(this.errY) < 0.01) this.errY = 0;

    this.acc += Math.min(dtMs, TICK_MS * MAX_CATCHUP_TICKS);
    while (this.acc >= TICK_MS) {
      this.acc -= TICK_MS;
      const seq = this.nextSeq++;
      this.send(seq, input);
      this.prev = cloneBody(this.head);
      stepBody(this.head, input, this.arena);
      this.pending.push({ seq, input });
      if (this.pending.length > MAX_PENDING) this.pending.shift();
    }
  }

  /** Apply an authoritative snapshot of the local player. */
  reconcile(server: GamePlayer, epoch: number): void {
    if (!this.head) return;
    if (epoch !== this.epoch) { this.start(server, epoch); return; } // arena reset: resync hard

    this.pending = this.pending.filter((p) => p.seq > server.ack);
    const before = this.head;
    const next = toBody(server);
    let prev = cloneBody(next);
    for (const p of this.pending) {
      prev = cloneBody(next);
      stepBody(next, p.input, this.arena);
    }
    const dx = before.x - next.x, dy = before.y - next.y;
    if (Math.hypot(dx, dy) > SNAP_DISTANCE) { this.errX = this.errY = 0; }
    else { this.errX += dx; this.errY += dy; } // keeps the *rendered* position continuous; decays in advance()
    this.head = next;
    this.prev = prev;
  }

  /** Smoothed position for drawing (null when inactive). */
  render(): RenderState | null {
    if (!this.head || !this.prev) return null;
    const a = this.acc / TICK_MS;
    return {
      x: this.prev.x + (this.head.x - this.prev.x) * a + this.errX,
      y: this.prev.y + (this.head.y - this.prev.y) * a + this.errY,
      facing: this.head.facing, grounded: this.head.grounded,
    };
  }

  /** Raw predicted head (for tests/diagnostics). */
  predicted(): PlayerBody | null { return this.head ? cloneBody(this.head) : null; }
}
