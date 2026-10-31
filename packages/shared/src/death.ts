import { z } from 'zod';
import { MAX_PLAYERS } from './constants';

/** P4: the numbers of spectating (GAMEPLAY.md section 8). Fixed rules, not a difficulty curve: the same at stage 1 and stage 1,000,000. */
export const SPECTATE = {
  /** A spectator may send one "ghost here" ping every 3 s (60 ticks). Faster is refused, and the refusal costs nothing. */
  pingCooldownTicks: 60,
  /** A ping stays on the map for 5 s (100 ticks) on the client. */
  pingTtlTicks: 100,
  /** How many players can be named in a spectator's list of who to follow (everyone but themselves). */
  maxTargets: MAX_PLAYERS,
  /** P4 step 6: a free-fly spectator's camera moves at most this fast (px per second, diagonals included) and never leaves the arena of its room. */
  camSpeed: 640,
  /** A move intent counts for this many ticks after the last message (0.5 s); silence stops the camera. */
  camIntentTtlTicks: 10,
  /** The server takes at most one move or room message per this many ticks from one spectator. */
  camMinGapTicks: 2,
  /** A room list is never longer than this (a stage has at most this many rooms). */
  maxRooms: 16,
} as const;

/** P4 step 6: a camera: the room it is in, where, and whether it flies free (true) or sits on the teammate being followed (false). */
export const SpectatorCamSchema = z.object({ room: z.string().min(1).max(64), x: z.number(), y: z.number(), free: z.boolean() });
export type SpectatorCam = z.infer<typeof SpectatorCamSchema>;

/** A move intent: which way the spectator holds the keys (-1, 0 or 1 on each axis). The server never takes a speed or a position from the client. */
export const SpectateMoveSchema = z.object({ x: z.union([z.literal(-1), z.literal(0), z.literal(1)]), y: z.union([z.literal(-1), z.literal(0), z.literal(1)]) });
export type SpectateMove = z.infer<typeof SpectateMoveSchema>;

/** A spectator asks for another room of the stage (next, previous, or one by id). */
export const SpectateRoomSchema = z.object({ room: z.union([z.literal('next'), z.literal('prev'), z.string().min(1).max(64)]) });
export type SpectateRoom = z.infer<typeof SpectateRoomSchema>;

/**
 * P4 step 6: one step of a free-fly camera. PURE and shared, so the server (which bounds it) and the client (which draws it without waiting for the network) compute the
 * same thing: the intent is normalised (a diagonal is no faster than a straight line), the speed is `SPECTATE.camSpeed`, and the camera is clamped inside the arena
 * `bounds` of its room. It passes through walls (a camera has no body) and has no exit: there is nothing here to leave through.
 */
export function stepSpectatorCam(cam: SpectatorCam, intent: SpectateMove, dtSec: number, bounds: { w: number; h: number }): SpectatorCam {
  const len = Math.hypot(intent.x, intent.y);
  const k = len > 0 ? (SPECTATE.camSpeed * Math.max(0, dtSec)) / len : 0;
  const x = Math.min(Math.max(cam.x + intent.x * k, 0), bounds.w);
  const y = Math.min(Math.max(cam.y + intent.y * k, 0), bounds.h);
  return { room: cam.room, x, y, free: cam.free || len > 0 };
}


export const PlayerLifeSchema = z.enum(['alive', 'downed', 'eliminated']);

/** A spectator asks to watch a named teammate, or the next or previous one in team order. */
export const SpectateFollowSchema = z.object({ target: z.union([z.literal('next'), z.literal('prev'), z.string().min(1).max(64)]) });
export type SpectateFollow = z.infer<typeof SpectateFollowSchema>;

/**
 * P4. Sent to ONE player when it changes (and every second as a keepalive): are they alive, a body or eliminated, whom do they watch, and who can
 * they watch. Names and ids of teammates only (the team list is public to the team anyway). Never a position, an item or a code.
 */
export const DeathStateSchema = z.object({
  tick: z.number().int().min(0),
  life: PlayerLifeSchema,
  /** The teammate this player is watching (spectators only). */
  following: z.object({ id: z.string(), name: z.string() }).nullable(),
  /** Alive, connected teammates a spectator can follow, in team order. Empty for the living. */
  watchable: z.array(z.object({ id: z.string(), name: z.string() })).max(MAX_PLAYERS),
  /** Ticks until the next ghost-here ping is allowed (0 = ready). Only meaningful for the dead. */
  pingReadyIn: z.number().int().min(0),
  /** For a body: ticks of the revive window left (0 once eliminated or alive). */
  reviveLeft: z.number().int().min(0),
  /** P4 step 6 (additive, optional): where a dead player's camera is (told about once a second and when it changes room; the client predicts the rest with `stepSpectatorCam`). */
  cam: SpectatorCamSchema.optional(),
  /** P4 step 6 (additive, optional): the rooms of the stage, in order, for switching rooms (ids only: nothing about what is in them). */
  rooms: z.array(z.string().max(64)).max(SPECTATE.maxRooms).optional(),
  /** P4 step 3 (additive, optional): the body a living player is reviving right now and how far along (0..1). Told to the reviver only. */
  reviving: z.object({ id: z.string(), name: z.string(), progress: z.number().min(0).max(1) }).nullable().optional(),
  /** P4 step 3 (additive, optional): how far along a teammate is in bringing THIS body back (0..1; null = nobody is). Told to the body only. */
  beingRevived: z.number().min(0).max(1).nullable().optional(),
});
export type DeathState = z.infer<typeof DeathStateSchema>;

/**
 * P4. A "ghost here" ping: where a spectator SAW a ghost. The position is the server's, taken from the ghost the spectator can see; the client
 * sends no coordinates. Sent to the living in that room and to the other spectators, never to anyone in another room.
 */
export const GhostPingSchema = z.object({
  tick: z.number().int().min(0),
  room: z.string().max(48),
  x: z.number(), y: z.number(),
  from: z.string().max(24),
});
export type GhostPing = z.infer<typeof GhostPingSchema>;

/** P4 step 4: how long a wipe stays on screen before the review (3 s), and the bounds of a review. Fixed rules, the same at stage 1 and stage 1,000,000. */
export const WIPE = { beatTicks: 60, maxLines: 8, maxText: 160, maxTeam: MAX_PLAYERS } as const;

/** One line of a review: what the server recorded, and the tick it happened at. Text is written by the server from its own events. */
export const ReviewLineSchema = z.object({ tick: z.number().int().min(0), text: z.string().max(WIPE.maxText) });
export type ReviewLine = z.infer<typeof ReviewLineSchema>;

/**
 * P4 step 4: the review of ONE death, built only from events the server recorded (the ghost's catch reasons, the cues the player was sent, the noises it
 * logged, the hiding attempts, the death system's drops and the revive attempts). It names no code, no safe, no clue and no item id: parts by what they
 * are, positions only where they came to rest. Sent to the player it is about, nobody else.
 */
export const DeathReviewSchema = z.object({
  player: z.string().max(64), name: z.string().max(24),
  /** The tick of death. */
  tick: z.number().int().min(0),
  life: PlayerLifeSchema,
  /** How many times this player died this attempt (a revived player can die again; the review is of the last death). */
  deaths: z.number().int().min(1).max(20),
  cause: z.object({
    how: z.enum(['touch', 'opened_spot']),
    ghost: z.string().max(24),
    ghostKind: z.string().max(24).nullable(),
    because: z.array(z.string().max(WIPE.maxText)).max(WIPE.maxLines),
  }),
  warnings: z.array(ReviewLineSchema).max(WIPE.maxLines),
  noise: z.array(ReviewLineSchema).max(WIPE.maxLines),
  hiding: z.array(ReviewLineSchema).max(WIPE.maxLines),
  rescues: z.array(ReviewLineSchema).max(WIPE.maxLines),
  carried: z.array(z.object({ label: z.string().max(40) })).max(4),
  dropped: z.array(z.object({ tick: z.number().int().min(0), label: z.string().max(40), room: z.string().max(48).nullable(), x: z.number(), y: z.number(), relocated: z.boolean() })).max(4),
});
export type DeathReview = z.infer<typeof DeathReviewSchema>;

/** What each player is sent when the wipe turns into the review: their OWN review (null if they did not die), the stage and the attempt, and who died when. */
export const DeathReviewMsgSchema = z.object({
  stage: z.number().int().min(1),
  attempt: z.number().int().min(0),
  /** Everyone is out: a retry follows. */
  wiped: z.boolean(),
  yours: DeathReviewSchema.nullable(),
  team: z.array(z.object({ name: z.string().max(24), life: PlayerLifeSchema, diedAt: z.number().int().min(0).nullable() })).max(WIPE.maxTeam),
});
export type DeathReviewMsg = z.infer<typeof DeathReviewMsgSchema>;
