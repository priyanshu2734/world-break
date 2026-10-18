import { z } from 'zod';
import { DifficultySchema } from './difficulty';
import type { StageState } from './systems/schemas';
import { WorldPublicSchema } from './abilities/world';
import type { AbilityAction } from './abilities/public';
import { ROOM_CODE_ALPHABET, ROOM_CODE_LENGTH, MAX_PLAYERS } from './constants';

const roomCodeRe = new RegExp(`^[${ROOM_CODE_ALPHABET}]{${ROOM_CODE_LENGTH}}$`);

export const JoinPayloadSchema = z.object({
  roomCode: z.string().regex(roomCodeRe).optional(),
  name: z.string().trim().min(1).max(16),
});
export const ReadyPayloadSchema = z.object({ ready: z.boolean() });
export const DifficultyPayloadSchema = z.object({ difficulty: DifficultySchema });

export const RoomPhaseSchema = z.enum([
  'lobby', 'briefing', 'playing', 'stage_complete', 'team_wiped', 'death_review',
]);

/** Only public information. No scenario solutions, no private data. */
export const RoomSnapshotSchema = z.object({
  code: z.string(),
  phase: RoomPhaseSchema,
  difficulty: DifficultySchema,
  stage: z.number().int().min(1),
  highestStage: z.number().int().min(1),
  hostId: z.string(),
  maxPlayers: z.literal(MAX_PLAYERS),
  players: z
    .array(z.object({ id: z.string(), name: z.string(), ready: z.boolean(), isHost: z.boolean() }))
    .max(MAX_PLAYERS),
});
export type RoomSnapshot = z.infer<typeof RoomSnapshotSchema>;

// ---- P1: gameplay protocol (additive; P0 events and fields are unchanged) ----

/** Player intent for one client tick. seq must strictly increase per connection. */
export const GameInputSchema = z.object({
  seq: z.number().int().min(0).max(2_000_000_000),
  moveX: z.number().min(-1).max(1),
  jump: z.boolean(),
});
export type GameInput = z.infer<typeof GameInputSchema>;

export const GamePlayerSchema = z.object({
  id: z.string(),
  name: z.string(),
  slot: z.number().int().min(0).max(MAX_PLAYERS - 1),
  x: z.number(),
  y: z.number(),
  vx: z.number(),
  vy: z.number(),
  facing: z.union([z.literal(1), z.literal(-1)]),
  grounded: z.boolean(),
  connected: z.boolean(),
  /** Last input seq the server applied for this player (used for client reconciliation). */
  ack: z.number().int().min(-1),
});
export type GamePlayer = z.infer<typeof GamePlayerSchema>;

/** Explicit public projection of the simulation. Never a dump of server internals. */
export const GameSnapshotSchema = z.object({
  tick: z.number().int().min(0),
  simTimeMs: z.number().int().min(0),
  /** Increments on every arena reset so clients drop prediction state. */
  epoch: z.number().int().min(0),
  phase: RoomPhaseSchema,
  /** Remaining briefing countdown in ms (0 once playing). */
  briefingMs: z.number().int().min(0),
  stage: z.number().int().min(1),
  arenaId: z.string(),
  players: z.array(GamePlayerSchema).max(MAX_PLAYERS),
  /** P3B (additive, optional): gravity zones, impulse events and physical props. Absent = none (and always absent before P3B). */
  world: WorldPublicSchema.optional(),
});
export type GameSnapshot = z.infer<typeof GameSnapshotSchema>;

export type Ack<T = Record<never, never>> = ({ ok: true } & T) | { ok: false; error: string };

export interface ClientToServerEvents {
  'room:join': (payload: unknown, ack: (r: Ack<{ roomCode: string; playerId: string }>) => void) => void;
  'room:ready': (payload: unknown, ack: (r: Ack) => void) => void;
  'room:setDifficulty': (payload: unknown, ack: (r: Ack) => void) => void;
  'room:start': (payload: unknown, ack: (r: Ack) => void) => void;
  /** P1. Fire-and-forget input intent (invalid payloads are dropped server-side). */
  'game:input': (payload: unknown) => void;
  /** P1. Host-only: restore the known initial arena state. */
  'game:reset': (payload: unknown, ack: (r: Ack) => void) => void;
  /** P2. A player's stage action (interact / use tool / cancel). The server decides the outcome. */
  'stage:action': (payload: unknown, ack: (r: Ack<{ message: string }>) => void) => void;
  /** P3A. Host-only: advance from `stage_complete` to stage N+1 (existing NEXT_STAGE transition). Stages are endless. */
  'room:nextStage': (payload: unknown, ack: (r: Ack) => void) => void;
  /** P3B. A player's reality ability intent (gravity well, freeze, duplicate, momentum). The server decides the outcome. */
  'ability:use': (payload: unknown, ack: (r: Ack<{ message: string }>) => void) => void;
}
export interface ServerToClientEvents {
  'room:state': (snapshot: RoomSnapshot) => void;
  /** P1. Sent every server tick while a run is in briefing/playing. */
  'game:snapshot': (snapshot: GameSnapshot) => void;
  /** P2. Public stage state, sent reliably whenever it changes (full state, idempotent). */
  'stage:state': (state: StageState) => void;
}
