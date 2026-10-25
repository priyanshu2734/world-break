import {
  ARENA, NEUTRAL_INPUT, ROOM_LIMITS, aimAngle, TICK_DT, doorAt, sanitizeInput, spawnBody, stepBody,
  type Arena, type RoomDef, type RoomGraph, type GamePlayer, type GameSnapshot, type InputIntent, type PlayerBody, type RoomPhase,
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
  queue: { seq: number; input: InputIntent; extra?: InputExtra }[];
  lastQueuedSeq: number;
  lastAppliedSeq: number;
  lastInput: InputIntent;
  staleTicks: number;
  /** P3D: the room the player is in (null on single-arena stages) and ticks until a door may be used again. */
  roomId: string | null;
  doorCooldown: number;
  /** P3E: the last aim angle (radians) the player sent (null = never sent one), whether Shift is held, and the move axis applied this tick. */
  aim: number | null;
  sneak: boolean;
  appliedMoveX: number;
}

/** P3E: optional extra input fields (aim step 0..255, Shift). `stepBody` and `InputIntent` are untouched: these never reach the movement code. */
export interface InputExtra { aim?: number; sneak?: boolean }

/** P3E: what the ghost may know about a player. Read-only; built from the authoritative state. */
export interface SimSense {
  id: string; name: string; slot: number; roomId: string | null; x: number; y: number; connected: boolean;
  /** The move axis the server APPLIED this tick (never the client's claim about its own gait). */
  moveX: number; sneak: boolean; grounded: boolean;
  /** Radians, or null if the client never sent one. */
  aim: number | null; facing: 1 | -1;
}

/** P3D: a player passed through a door this tick. */
export interface RoomTransition { playerId: string; from: string; to: string; doorId: string }

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
  /** P3D: the room graph of a multi-room stage (null = single arena, exactly the pre-P3D behaviour). */
  private rooms: Map<string, RoomDef> | null = null;
  private startRoom: string | null = null;
  private transitions: RoomTransition[] = [];
  /** P3D: step 3 plugs door locks in here. Return false to keep the door shut for this player. Default: every door is open. */
  doorGate: ((doorId: string, playerId: string) => boolean) | null = null;
  /** P3D: doors open by walking into them (the step 2 behaviour, default). An escape stage turns this off: doors open with E (`sendThrough`). */
  touchDoors = true;

  constructor(inits: SimPlayerInit[], arena: Arena = ARENA) {
    this._arena = arena;
    this.world = new PhysicsWorld(arena);
    for (const p of inits) {
      const sp = arena.spawns[p.slot];
      if (!sp) throw new Error(`No spawn for slot ${p.slot}`);
      this.players.set(p.id, {
        ...p, body: spawnBody(sp.x, sp.y), connected: true, queue: [],
        lastQueuedSeq: -1, lastAppliedSeq: -1, lastInput: NEUTRAL_INPUT, staleTicks: 0, roomId: null, doorCooldown: 0,
        aim: null, sneak: false, appliedMoveX: 0,
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
  /**
   * P3D: play this stage as a chain of rooms (or, with null, as one arena again). Every player is placed in the start room
   * (the caller `reset()`s afterwards, like `loadArena`). The sim's physical world (props, zones) belongs to the start room.
   */
  loadRooms(graph: RoomGraph | null): void {
    this.transitions = [];
    if (!graph) {
      this.rooms = null; this.startRoom = null;
      for (const p of this.players.values()) { p.roomId = null; p.doorCooldown = 0; }
      return;
    }
    this.rooms = new Map(graph.rooms.map((r) => [r.id, r]));
    this.startRoom = graph.start;
    this.loadArena(this.rooms.get(graph.start)!.arena);
    for (const p of this.players.values()) { p.roomId = graph.start; p.doorCooldown = 0; }
  }
  /** P3D: the room a player is in (undefined on single-arena stages or for unknown players). */
  roomOf(id: string): string | undefined { return this.players.get(id)?.roomId ?? undefined; }
  /** P3D: the start room id, where stage content lives until step 3 (null on single-arena stages). */
  get contentRoom(): string | null { return this.startRoom; }
  /** P3D: door passages since the last call (the caller sends each player the layout of the room they entered). */
  drainTransitions(): RoomTransition[] { const t = this.transitions; this.transitions = []; return t; }
  private arenaFor(p: SimPlayer): Arena { return (this.rooms && p.roomId ? this.rooms.get(p.roomId)?.arena : undefined) ?? this._arena; }

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
  queueInput(id: string, seq: number, input: InputIntent, extra?: InputExtra): boolean {
    const p = this.players.get(id);
    if (!p || !p.connected || seq <= p.lastQueuedSeq) return false;
    p.lastQueuedSeq = seq;
    p.queue.push({ seq, input: sanitizeInput(input), ...(extra ? { extra } : {}) });
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
          if (q.extra) {
            if (q.extra.aim !== undefined && Number.isInteger(q.extra.aim) && q.extra.aim >= 0 && q.extra.aim <= 255) p.aim = aimAngle(q.extra.aim);
            p.sneak = q.extra.sneak === true;
          }
        } else {
          p.staleTicks++;
          if (p.staleTicks <= MAX_REPEAT_TICKS) input = { moveX: p.lastInput.moveX, jump: false };
        }
      }
      p.appliedMoveX = input.moveX;
      // P3B: zones/impulses for THIS tick, or undefined. P3D: each player steps in THEIR room's arena; the physical world is the start room's.
      const here = !this.rooms || p.roomId === this.startRoom;
      stepBody(p.body, input, this.arenaFor(p), here ? this.world.forPlayer(p.id) : undefined);
      if (this.rooms && p.roomId && this.touchDoors) this.passDoors(p);
    }
    this.world.step();
    this.tick++;
  }

  /**
   * P3D: carry a player through one of the doors of the room they are in (the escape runtime calls this after E and the opening delay).
   * Same move as walking into the door: the arrival point of the target room, then the new room's layout is sent to that player.
   */
  sendThrough(playerId: string, doorId: string): boolean {
    const p = this.players.get(playerId);
    const room = p && this.rooms && p.roomId ? this.rooms.get(p.roomId) : undefined;
    const door = room?.doors.find((d) => d.id === doorId);
    if (!p || !room || !door) return false;
    this.teleport(p, room, door);
    return true;
  }
  private teleport(p: SimPlayer, room: RoomDef, door: RoomDef['doors'][number]): void {
    p.body = spawnBody(door.arrive.x, door.arrive.y);
    p.doorCooldown = ROOM_LIMITS.doorCooldownTicks;
    this.transitions.push({ playerId: p.id, from: room.id, to: door.to, doorId: door.id });
    p.roomId = door.to;
  }
  private passDoors(p: SimPlayer): void {
    if (p.doorCooldown > 0) { p.doorCooldown--; return; }
    const room = this.rooms!.get(p.roomId!);
    const door = room ? doorAt(room, p.body) : null;
    if (!room || !door || (this.doorGate && !this.doorGate(door.id, p.id))) return;
    this.teleport(p, room, door);
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
      p.doorCooldown = 0;
      p.aim = null; p.sneak = false; p.appliedMoveX = 0;
      if (this.rooms) p.roomId = this.startRoom;
    }
    this.transitions = [];
  }

  /** P3E: where a player aims (radians), or null if they never sent an aim. */
  aimOf(id: string): number | null { return this.players.get(id)?.aim ?? null; }

  /** P3E: the authoritative facts the ghost senses, in slot order (so every consumer iterates deterministically). */
  senses(): SimSense[] {
    return [...this.players.values()].sort((a, b) => a.slot - b.slot).map((p) => ({
      id: p.id, name: p.name, slot: p.slot, roomId: p.roomId, x: p.body.x, y: p.body.y, connected: p.connected,
      moveX: p.appliedMoveX, sneak: p.sneak, grounded: p.body.grounded, aim: p.aim, facing: p.body.facing,
    }));
  }

  /** Explicit public projection: no queues, no internals. */
  snapshot(phase: RoomPhase, briefingMs: number, stage: number): GameSnapshot {
    const players: GamePlayer[] = [...this.players.values()]
      .sort((a, b) => a.slot - b.slot)
      .map((p) => ({
        id: p.id, name: p.name, slot: p.slot,
        x: r2(p.body.x), y: r2(p.body.y), vx: r2(p.body.vx), vy: r2(p.body.vy),
        facing: p.body.facing, grounded: p.body.grounded, connected: p.connected, ack: p.lastAppliedSeq,
        ...(this.rooms && p.roomId ? { roomId: p.roomId } : {}),
      }));
    const world = this.world.publicState();
    return {
      tick: this.tick, simTimeMs: this.simTimeMs, epoch: this.epoch, phase,
      briefingMs, stage, arenaId: this._arena.id, players,
      ...(world ? { world } : {}),
    };
  }
}
