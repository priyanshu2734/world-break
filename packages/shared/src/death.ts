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
} as const;

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
