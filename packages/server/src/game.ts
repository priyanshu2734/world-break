import {
  ARENA, NEUTRAL_INPUT, TICK_DT, sanitizeInput, spawnBody, stepBody,
  type Arena, type GamePlayer, type GameSnapshot, type InputIntent, type PlayerBody, type RoomPhase,
} from '@wb/shared';
import { PhysicsWorld, type PropSpawn } from './abilities/world';

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
  private _arena: Arena;
  /** P3B: props, gravity zones and impulses. Stepped once per tick after the bodies. */
  world: PhysicsWorld;
  private propSpawns: PropSpawn[] = [];

  constructor(inits: SimPlayerInit[], arena: Arena = ARENA) {
    this._arena = arena;
    this.world = new PhysicsWorld(arena);
    for (const p of inits) {
      const sp = arena.spawns[p.slot];
      if (!sp) throw new Error(`No spawn for slot ${p.slot}`);
      this.players.set(p.id, {
        ...p, body: spawnBody(sp.x, sp.y), connected: true, queue: [],
        lastQueuedSeq: -1, lastAppliedSeq: -1, lastInput: NEUTRAL_INPUT, staleTicks: 0,
      });
    }
  }

  get arena(): Arena { return this._arena; }
  /**
   * P3B: swap the arena (a stage may play on its own arena). Creates a fresh world; the caller must `reset()` afterwards
   * (spawn positions come from the new arena) and re-attach `world` to the stage engine.
   */
  loadArena(arena: Arena): void {
    if (arena === this._arena) return;
    this._arena = arena;
    this.world = new PhysicsWorld(arena);
    this.world.reset(this.propSpawns);
  }
  /** P3B: set the stage's authored props (resets the physical world to them). */
  configure(spawns: readonly PropSpawn[]): void {
    this.propSpawns = [...spawns];
    this.world.reset(this.propSpawns);
  }

  get simTimeMs(): number { return Math.round(this.tick * TICK_DT * 1000); }
  has(id: string): boolean { return this.players.has(id); }
  /** Authoritative position/connection of a player (read-only view for the stage engine). */
  positionOf(id: string): { x: number; y: number; connected: boolean } | undefined {
    const p = this.players.get(id);
    return p ? { x: p.body.x, y: p.body.y, connected: p.connected } : undefined;
  }

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
      stepBody(p.body, input, this._arena, this.world.forPlayer(p.id)); // P3B: zones/impulses for THIS tick, or undefined
    }
    this.world.step();
    this.tick++;
  }

  /** Restore the known initial state: spawn positions, tick 0, empty queues. New epoch tells clients to resync. */
  reset(): void {
    this.epoch++;
    this.tick = 0;
    this.world.reset(this.propSpawns);
    for (const p of this.players.values()) {
      const sp = this._arena.spawns[p.slot]!;
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
    const world = this.world.publicState();
    return {
      tick: this.tick, simTimeMs: this.simTimeMs, epoch: this.epoch, phase,
      briefingMs, stage, arenaId: this._arena.id, players,
      ...(world ? { world } : {}),
    };
  }
}
