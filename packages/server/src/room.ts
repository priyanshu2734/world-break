import { randomInt } from 'node:crypto';
import {
  MAX_PLAYERS, ROOM_CODE_ALPHABET, ROOM_CODE_LENGTH,
  isDifficultyUnlocked, nextRoomPhase,
  type Difficulty, type RoomPhase, type RoomSnapshot,
} from '@wb/shared';

export type Result = { ok: true } | { ok: false; error: string };
const fail = (error: string): Result => ({ ok: false, error });

interface Member { id: string; name: string; ready: boolean }

/** Pure, socket-free room state. All mutations are validated here. */
export class Room {
  phase: RoomPhase = 'lobby';
  difficulty: Difficulty = 'easy';
  stage = 1;
  /** Team progression. Persistence arrives with the progression phase. */
  highestStage = 1;
  hostId = '';
  private members = new Map<string, Member>();

  constructor(readonly code: string) {}

  get size(): number { return this.members.size; }
  has(id: string): boolean { return this.members.has(id); }

  join(id: string, name: string): Result {
    if (this.phase !== 'lobby') return fail('Run already in progress');
    if (this.members.has(id)) return fail('Already in room');
    if (this.members.size >= MAX_PLAYERS) return fail('Room is full');
    this.members.set(id, { id, name, ready: false });
    if (!this.hostId) this.hostId = id;
    return { ok: true };
  }

  leave(id: string): void {
    this.members.delete(id);
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
    return { ok: true };
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

  create(): Room {
    let code: string;
    do {
      code = Array.from({ length: ROOM_CODE_LENGTH }, () => ROOM_CODE_ALPHABET[randomInt(ROOM_CODE_ALPHABET.length)]).join('');
    } while (this.rooms.has(code));
    const room = new Room(code);
    this.rooms.set(code, room);
    return room;
  }
  get(code: string): Room | undefined { return this.rooms.get(code); }
  remove(code: string): void { this.rooms.delete(code); }
  get count(): number { return this.rooms.size; }
}
