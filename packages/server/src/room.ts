import { randomInt } from 'node:crypto';
import {
  MAX_PLAYERS, ROOM_CODE_ALPHABET, ROOM_CODE_LENGTH, SERVER_TICK_HZ,
  isDifficultyUnlocked, nextRoomPhase,
  type Difficulty, type GameSnapshot, type InputIntent, type RoomPhase, type RoomSnapshot, type StageAction, type StageState,
} from '@wb/shared';
import { GameSim } from './game';
import { StageEngine, type ActionResult } from './systems/engine';
import { getStageDef } from './systems/registry';

/** Briefing countdown before play begins (3 s of server ticks). */
export const BRIEFING_TICKS = 3 * SERVER_TICK_HZ;

export type Result = { ok: true } | { ok: false; error: string };
const fail = (error: string): Result => ({ ok: false, error });

interface Member { id: string; name: string; ready: boolean; connected: boolean }

/** Pure, socket-free room state. All mutations are validated here. */
export class Room {
  phase: RoomPhase = 'lobby';
  difficulty: Difficulty = 'easy';
  stage = 1;
  /** Team progression. Persistence arrives with the progression phase. */
  highestStage = 1;
  hostId = '';
  private members = new Map<string, Member>();
  private sim: GameSim | null = null;
  private engine: StageEngine | null = null;
  private briefingTicksLeft = 0;

  constructor(readonly code: string, private readonly briefingTicks: number = BRIEFING_TICKS) {}

  get size(): number { return this.members.size; }
  get connectedCount(): number { return [...this.members.values()].filter((m) => m.connected).length; }
  has(id: string): boolean { return this.members.has(id); }

  join(id: string, name: string): Result {
    if (this.phase !== 'lobby') return fail('Run already in progress');
    if (this.members.has(id)) return fail('Already in room');
    if (this.members.size >= MAX_PLAYERS) return fail('Room is full');
    this.members.set(id, { id, name, ready: false, connected: true });
    if (!this.hostId) this.hostId = id;
    return { ok: true };
  }

  leave(id: string): void {
    this.members.delete(id);
    this.sim?.removePlayer(id);
    this.engine?.removePlayer(id);
    if (this.hostId === id) this.hostId = this.members.keys().next().value ?? '';
  }

  setReady(id: string, ready: boolean): Result {
    const m = this.members.get(id);
    if (!m) return fail('Not in room');
    if (this.phase !== 'lobby') return fail('Not in lobby');
    m.ready = ready;
    return { ok: true };
  }

  setDifficulty(id: string, difficulty: Difficulty): Result {
    if (id !== this.hostId) return fail('Only the host can change difficulty');
    if (this.phase !== 'lobby') return fail('Not in lobby');
    if (!isDifficultyUnlocked(difficulty, this.highestStage)) return fail(`${difficulty} is locked`);
    this.difficulty = difficulty;
    return { ok: true };
  }

  /** Solo players can start alone; with more players every non-host must be ready. */
  start(id: string): Result {
    if (id !== this.hostId) return fail('Only the host can start');
    if (this.phase !== 'lobby') return fail('Not in lobby');
    const notReady = [...this.members.values()].filter((m) => m.id !== this.hostId && !m.ready);
    if (notReady.length > 0) return fail('Waiting for players to ready up');
    this.phase = nextRoomPhase(this.phase, 'START');
    // Slots are fixed for the whole run (join order), so spawns and colours stay stable.
    this.sim = new GameSim([...this.members.values()].map((m, slot) => ({ id: m.id, name: m.name, slot })));
    this.engine = new StageEngine(getStageDef(this.stage), [...this.members.keys()]);
    this.briefingTicksLeft = this.briefingTicks;
    return { ok: true };
  }

  private pos = (id: string) => this.sim?.positionOf(id);

  /** Advance one server tick. Briefing counts down (then BEGIN); playing steps the simulation. */
  tick(): { phaseChanged: boolean } {
    if (!this.sim) return { phaseChanged: false };
    if (this.phase === 'briefing') {
      this.briefingTicksLeft--;
      if (this.briefingTicksLeft <= 0) {
        this.briefingTicksLeft = 0;
        this.phase = nextRoomPhase(this.phase, 'BEGIN');
        return { phaseChanged: true };
      }
    } else if (this.phase === 'playing') {
      this.sim.step();
      this.engine?.step(this.pos);
      if (this.engine?.status === 'stabilized') {
        this.phase = nextRoomPhase(this.phase, 'STAGE_CLEAR');
        return { phaseChanged: true };
      }
    }
    return { phaseChanged: false };
  }

  /** Movement intent from a player. Accepted only while playing. */
  submitInput(id: string, seq: number, input: InputIntent): boolean {
    if (this.phase !== 'playing' || !this.sim) return false;
    const m = this.members.get(id);
    if (!m || !m.connected) return false;
    return this.sim.queueInput(id, seq, input);
  }

  /**
   * Socket dropped. In the lobby the player simply leaves (P0 behaviour). During a run the player
   * stays in the simulation, marked disconnected, so teammates see the connection state.
   */
  disconnect(id: string): void {
    const m = this.members.get(id);
    if (!m) return;
    if (this.phase === 'lobby' || !this.sim) { this.leave(id); return; }
    m.connected = false;
    this.sim.setConnected(id, false);
    this.engine?.onDisconnect(id);
    if (this.hostId === id) {
      const next = [...this.members.values()].find((x) => x.connected);
      if (next) this.hostId = next.id;
    }
  }

  /** Host-only: restore the known initial arena state, dropping disconnected players. */
  resetArena(id: string): Result {
    if (id !== this.hostId) return fail('Only the host can reset the arena');
    if (this.phase !== 'playing' || !this.sim) return fail('Arena can only be reset during play');
    for (const m of [...this.members.values()]) {
      if (!m.connected) { this.members.delete(m.id); this.sim.removePlayer(m.id); }
    }
    this.sim.reset();
    // A fresh stage attempt; revisions keep increasing so clients never mistake it for an old state.
    const nextRev = (this.engine?.state().rev ?? 0) + 1;
    this.engine = new StageEngine(getStageDef(this.stage), [...this.members.keys()], { revBase: nextRev });
    return { ok: true };
  }

  /** A player's stage action. The engine validates range, tools, cooldowns and prerequisites. */
  stageAction(id: string, action: StageAction): ActionResult {
    if (this.phase !== 'playing' || !this.engine) return { ok: false, error: 'No stage is running.' };
    if (!this.members.has(id)) return { ok: false, error: 'You are not part of this run.' };
    return this.engine.action(id, action, this.pos);
  }

  /** Read-only view of the current public stage state (does not mark it as sent). */
  peekStageState(): StageState | null {
    return this.engine?.state() ?? null;
  }

  /** Public stage state if it changed since the last call (reliable delivery, full state). */
  consumeStageState(): StageState | null {
    return this.engine?.consumeState() ?? null;
  }

  /** Public simulation view, or null when no run is active. */
  gameSnapshot(): GameSnapshot | null {
    if (!this.sim || this.phase === 'lobby') return null;
    return this.sim.snapshot(this.phase, this.briefingTicksLeft * Math.round(1000 / SERVER_TICK_HZ), this.stage);
  }

  snapshot(): RoomSnapshot {
    return {
      code: this.code,
      phase: this.phase,
      difficulty: this.difficulty,
      stage: this.stage,
      highestStage: this.highestStage,
      hostId: this.hostId,
      maxPlayers: MAX_PLAYERS,
      players: [...this.members.values()].map((m) => ({
        id: m.id, name: m.name, ready: m.ready || m.id === this.hostId, isHost: m.id === this.hostId,
      })),
    };
  }
}

export class RoomManager {
  private rooms = new Map<string, Room>();

  constructor(private readonly opts: { briefingTicks?: number } = {}) {}

  create(): Room {
    let code: string;
    do {
      code = Array.from({ length: ROOM_CODE_LENGTH }, () => ROOM_CODE_ALPHABET[randomInt(ROOM_CODE_ALPHABET.length)]).join('');
    } while (this.rooms.has(code));
    const room = new Room(code, this.opts.briefingTicks);
    this.rooms.set(code, room);
    return room;
  }
  get(code: string): Room | undefined { return this.rooms.get(code); }
  remove(code: string): void { this.rooms.delete(code); }
  get count(): number { return this.rooms.size; }
  forEach(cb: (room: Room) => void): void { for (const r of [...this.rooms.values()]) cb(r); }
}
