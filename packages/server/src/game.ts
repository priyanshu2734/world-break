import {
  ARENA, NEUTRAL_INPUT, TICK_DT, sanitizeInput, spawnBody, stepBody,
  type Arena, type GamePlayer, type GameSnapshot, type InputIntent, type PlayerBody, type RoomPhase,
} from '@wb/shared';

/**
 * Inputs queued beyond this are trimmed (client is ahead of the server; reconciliation covers the gap).
 * Must hold a client catch-up burst (client caps catch-up at 5 ticks per frame) without dropping input.
 */
export const MAX_INPUT_BACKLOG = 8;
export const BACKLOG_TRIM_TO = 4;
/** If the queue runs dry, repeat the last movement for this many ticks, then fall back to neutral. */
export const MAX_REPEAT_TICKS = 2;

export interface SimPlayerInit { id: string; name: string; slot: number }

interface SimPlayer extends SimPlayerInit {
  body: PlayerBody;
  connected: boolean;
  queue: { seq: number; input: InputIntent }[];
  lastQueuedSeq: number;
  lastAppliedSeq: number;
  lastInput: InputIntent;
  staleTicks: number;
}

const r2 = (n: number) => Math.round(n * 100) / 100;

/** Authoritative, socket-free simulation. Owns positions and simulation time. */
export class GameSim {
  tick = 0;
  epoch = 0;
  private players = new Map<string, SimPlayer>();

  constructor(inits: SimPlayerInit[], readonly arena: Arena = ARENA) {
    for (const p of inits) {
      const sp = arena.spawns[p.slot];
      if (!sp) throw new Error(`No spawn for slot ${p.slot}`);
      this.players.set(p.id, {
        ...p, body: spawnBody(sp.x, sp.y), connected: true, queue: [],
        lastQueuedSeq: -1, lastAppliedSeq: -1, lastInput: NEUTRAL_INPUT, staleTicks: 0,
      });
    }
  }

  get simTimeMs(): number { return Math.round(this.tick * TICK_DT * 1000); }
  has(id: string): boolean { return this.players.has(id); }

  /** Queue an intent. Returns false if rejected (unknown/disconnected player, or non-increasing seq). */
  queueInput(id: string, seq: number, input: InputIntent): boolean {
    const p = this.players.get(id);
    if (!p || !p.connected || seq <= p.lastQueuedSeq) return false;
    p.lastQueuedSeq = seq;
    p.queue.push({ seq, input: sanitizeInput(input) });
    if (p.queue.length > MAX_INPUT_BACKLOG) p.queue.splice(0, p.queue.length - BACKLOG_TRIM_TO);
    return true;
  }

  setConnected(id: string, connected: boolean): void {
    const p = this.players.get(id);
    if (!p) return;
    p.connected = connected;
    if (!connected) { p.queue.length = 0; p.lastInput = NEUTRAL_INPUT; }
  }

  removePlayer(id: string): void { this.players.delete(id); }

  /** Advance exactly one fixed tick. */
  step(): void {
    for (const p of this.players.values()) {
      let input: InputIntent = NEUTRAL_INPUT;
      if (p.connected) {
        const q = p.queue.shift();
        if (q) {
          input = q.input; p.lastInput = q.input; p.lastAppliedSeq = q.seq; p.staleTicks = 0;
        } else {
          p.staleTicks++;
          if (p.staleTicks <= MAX_REPEAT_TICKS) input = { moveX: p.lastInput.moveX, jump: false };
        }
      }
      stepBody(p.body, input, this.arena);
    }
    this.tick++;
  }

  /** Restore the known initial state: spawn positions, tick 0, empty queues. New epoch tells clients to resync. */
  reset(): void {
    this.epoch++;
    this.tick = 0;
    for (const p of this.players.values()) {
      const sp = this.arena.spawns[p.slot]!;
      p.body = spawnBody(sp.x, sp.y);
      p.queue.length = 0;
      p.lastInput = NEUTRAL_INPUT;
      p.staleTicks = 0;
    }
  }

  /** Explicit public projection: no queues, no internals. */
  snapshot(phase: RoomPhase, briefingMs: number, stage: number): GameSnapshot {
    const players: GamePlayer[] = [...this.players.values()]
      .sort((a, b) => a.slot - b.slot)
      .map((p) => ({
        id: p.id, name: p.name, slot: p.slot,
        x: r2(p.body.x), y: r2(p.body.y), vx: r2(p.body.vx), vy: r2(p.body.vy),
        facing: p.body.facing, grounded: p.body.grounded, connected: p.connected, ack: p.lastAppliedSeq,
      }));
    return {
      tick: this.tick, simTimeMs: this.simTimeMs, epoch: this.epoch, phase,
      briefingMs, stage, arenaId: this.arena.id, players,
    };
  }
}
