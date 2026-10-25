import { z } from 'zod';
import { DifficultySchema } from './difficulty';
import type { StageState } from './systems/schemas';
import { WorldPublicSchema } from './abilities/world';
import type { AbilityAction } from './abilities/public';
import type { RoomLayout } from './rooms/schemas';
import type { EscapeAck } from './rooms/escape';
import { AimSchema, GhostPublicSchema } from './ghost';
import { ROOM_CODE_ALPHABET, ROOM_CODE_LENGTH, MAX_PLAYERS } from './constants';

const roomCodeRe = new RegExp(`^[${ROOM_CODE_ALPHABET}]{${ROOM_CODE_LENGTH}}$`);

export const JoinPayloadSchema = z.object({
  roomCode: z.string().regex(roomCodeRe).optional(),
  name: z.string().trim().min(1).max(16),
  /** P3B dev flag: create the room as an Ability Lab room. Honoured only when the server runs with ABILITY_LAB=1, and only on creation. */
  lab: z.boolean().optional(),
  /** P3D dev flag: create the room with the multi-room demo stage as stage 1. Honoured only when the server runs with ESCAPE_STAGES on, and only on creation. */
  rooms: z.union([z.boolean(), z.literal(2)]).optional(),
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
  /** P3B (additive, optional): present and true only for an Ability Lab room. */
  lab: z.boolean().optional(),
});
export type RoomSnapshot = z.infer<typeof RoomSnapshotSchema>;

// ---- P1: gameplay protocol (additive; P0 events and fields are unchanged) ----

/** Player intent for one client tick. seq must strictly increase per connection. */
export const GameInputSchema = z.object({
  seq: z.number().int().min(0).max(2_000_000_000),
  moveX: z.number().min(-1).max(1),
  jump: z.boolean(),
  /** P3E (additive, optional): where the player aims the flashlight and the Pulse Gun, quantised to 0..255 (see `quantiseAim`). Absent = unknown. */
  aim: AimSchema.optional(),
  /** P3E (additive, optional): Shift held. The server trusts it only for crouching in place; how loud a move is comes from the move axis it applied. */
  sneak: z.boolean().optional(),
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
  /** P3D (additive, optional): the room this player is in (the id of its arena). Present only on multi-room stages. */
  roomId: z.string().optional(),
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
  /**
   * P3D step 4 (additive, optional): on an escape stage `players` holds only the viewer and the teammates the viewer can see, so the
   * team panel reads this instead: every teammate's name, slot and connection, never a position or an inventory. Absent on other stages.
   */
  team: z.array(z.object({ id: z.string(), name: z.string(), slot: z.number().int().min(0), connected: z.boolean() })).max(MAX_PLAYERS).optional(),
  /** P3E (additive, optional): the ghosts THIS player can see (at most 2). Absent = none in view (a ghost out of view is never in the message). */
  ghosts: z.array(GhostPublicSchema).max(2).optional(),
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
  /** P3C. A player's salvage intent (pick up, drop, swap, hand over, install). The server decides the outcome. */
  'item:action': (payload: unknown, ack: (r: Ack<{ message: string }>) => void) => void;
  /** P3D: doors (E), keypads and safes (enter a code), switches (press), clues (read). */
  'escape:action': (payload: unknown, ack: (r: Ack<EscapeAck>) => void) => void;
}
export interface ServerToClientEvents {
  'room:state': (snapshot: RoomSnapshot) => void;
  /** P1. Sent every server tick while a run is in briefing/playing. */
  'game:snapshot': (snapshot: GameSnapshot) => void;
  /** P2. Public stage state, sent reliably whenever it changes (full state, idempotent). */
  'stage:state': (state: StageState) => void;
  /** P3D. Sent to ONE player (never broadcast) when they begin a stage or enter a room: the walls and doorways of that room. */
  'room:layout': (layout: RoomLayout) => void;
}
