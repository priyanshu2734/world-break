import { z } from 'zod';
import { DifficultySchema } from './difficulty';
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

export type Ack<T = Record<never, never>> = ({ ok: true } & T) | { ok: false; error: string };

export interface ClientToServerEvents {
  'room:join': (payload: unknown, ack: (r: Ack<{ roomCode: string; playerId: string }>) => void) => void;
  'room:ready': (payload: unknown, ack: (r: Ack) => void) => void;
  'room:setDifficulty': (payload: unknown, ack: (r: Ack) => void) => void;
  'room:start': (payload: unknown, ack: (r: Ack) => void) => void;
}
export interface ServerToClientEvents {
  'room:state': (snapshot: RoomSnapshot) => void;
}
