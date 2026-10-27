import { z } from 'zod';
import { deriveSeed } from '../disasters/rng';
import { ghostCountForStage } from '../rooms/tables';

/**
 * P3E: what the ghost is, as data shared by the server (which runs it) and the client (which draws and hears it).
 * Pure: no I/O, no clock. Every tuning number that scales with the stage is in `rooms/tables.ts` (`ghostTuning`); the fixed RULES
 * (the warning lead time, the senses, the catch radius) are here, so a test can hold the server to them.
 */

// ------------------------------------------------------------------------------------------------ types and states
/** The ghost types of this phase (GAMEPLAY.md section 6). Mimic, Phantom, Warden and Twins are later phases. */
export const GHOST_TYPES = ['wisp', 'shade', 'howler'] as const;
export type GhostType = (typeof GHOST_TYPES)[number];

/** The state machine. DORMANT only before the first appearance; afterwards a ghost cycles RESPAWN -> WARNING -> ROAMING -> (HUNTING) -> RESPAWN. */
export const GHOST_STATES = ['dormant', 'warning', 'roaming', 'hunting', 'stunned', 'respawn'] as const;
export type GhostState = (typeof GHOST_STATES)[number];

/** Every legal transition. Anything else throws on the server and is a bug. */
export const GHOST_TRANSITIONS: Readonly<Record<GhostState, readonly GhostState[]>> = {
  dormant: ['warning'],
  warning: ['roaming'],
  roaming: ['hunting', 'stunned', 'respawn'],
  hunting: ['roaming', 'stunned', 'respawn'],
  stunned: ['respawn'],
  respawn: ['warning'],
};

/**
 * The types a stage may use, at most 2 (GAMEPLAY.md section 6): a new type is introduced ALONE in its first stage (Wisp 2, Shade 7, Howler 12),
 * then mixed. `pick` (0 or 1, from the stage seed) chooses which pair is used from stage 13 on, so the choice is stable per stage and seed.
 */
export function ghostTypesForStage(stage: number, pick = 0): GhostType[] {
  const s = Number.isFinite(stage) ? Math.floor(stage) : 1;
  if (s < 2) return [];
  if (s < 7) return ['wisp'];
  if (s === 7) return ['shade'];
  if (s < 12) return ['wisp', 'shade'];
  if (s === 12) return ['howler'];
  const pairs: GhostType[][] = [['wisp', 'howler'], ['shade', 'howler']];
  return pairs[pick === 1 ? 1 : 0]!;
}

/** Hard cap on ghosts alive at once (one per type, at most 2 types). */
export const MAX_GHOSTS = 2;

/**
 * P3E step 5: the ghosts that actually RUN on a stage. `ghostTypesForStage` says which types a stage may use (at most 2); how many run at once is
 * `ghostCountForStage` (1 until stage 20, then 2). With one ghost on a two-type stage the seed (`pick`) chooses which type it is, so stages 8 to 19
 * mix the types from stage to stage, never inside one stage. A new type is still alone in its first stage (7 Shade, 12 Howler).
 */
export function ghostLineupForStage(stage: number, pick = 0): GhostType[] {
  const types = ghostTypesForStage(stage, pick);
  const count = ghostCountForStage(stage);
  if (count >= types.length) return types;
  return [types[pick === 1 ? types.length - 1 : 0]!].slice(0, count);
}

/** The seed of a stage's ghost, derived from the stage seed. Server (generator and Room) and tests use this one function. */
export function ghostSeedFor(stageSeed: number, stage: number): number { return deriveSeed(stageSeed, 'ghost', stage); }

/** The stage seed's bit that picks between two types (see `ghostLineupForStage`). */
export function ghostPickFor(ghostSeed: number): number { return ghostSeed & 1; }

/**
 * P3E step 5: how the ghost LOOKS grows with the stage, in four tiers (so a stage 25 ghost is clearly bigger and more menacing than a stage 2 one).
 * Pure data: the client draws it, tests pin it. Tier 0 stage 2-9, 1: 10-19, 2: 20-34, 3: 35 and later.
 */
export function ghostLookTier(stage: number): 0 | 1 | 2 | 3 {
  const s = Number.isFinite(stage) ? Math.floor(stage) : 1;
  return s < 10 ? 0 : s < 20 ? 1 : s < 35 ? 2 : 3;
}
/** Body scale per look tier. */
export const GHOST_LOOK_SCALE = [1, 1.3, 1.7, 2.2] as const;

/**
 * The flashlight CONE only (not the small always-on light): is `target` inside the cone of a player at `eye` aiming at `aim`, within the lit reach?
 * The Shade freezes while any player's cone is on it (it still needs line of sight, checked by the caller).
 */
export function inFlashlightCone(eye: { x: number; y: number }, aim: number, target: { x: number; y: number }, radius: number): boolean {
  const dx = target.x - eye.x, dy = target.y - eye.y, d = Math.hypot(dx, dy);
  if (d > radius * LIT.reachShare) return false;
  if (d < 1) return true;
  return Math.abs(angleDiff(Math.atan2(dy, dx), aim)) <= LIT.coneHalf;
}

// ------------------------------------------------------------------------------------------------ evidence (data only; P3F builds the game on it)
/**
 * Each ghost type leaves its own kind of EVIDENCE in the level. P3E only places it (data in the stage spec, validated, deterministic by seed): nothing
 * shows it to the player yet. P3F builds the identify-the-ghost game on it, so the kinds of two types never overlap.
 */
export const EVIDENCE_BY_TYPE: Readonly<Record<GhostType, readonly string[]>> = {
  wisp: ['cold_breath', 'faint_whisper'],
  shade: ['wet_footprints', 'single_dead_lamp'],
  howler: ['scratched_walls', 'cracked_glass'],
};
export const EVIDENCE_KINDS = ['cold_breath', 'faint_whisper', 'wet_footprints', 'single_dead_lamp', 'scratched_walls', 'cracked_glass'] as const;
export type EvidenceKind = (typeof EVIDENCE_KINDS)[number];
/** The type that leaves a kind of evidence (null for an unknown kind). */
export function evidenceOwner(kind: string): GhostType | null {
  for (const t of GHOST_TYPES) if (EVIDENCE_BY_TYPE[t].includes(kind)) return t;
  return null;
}
/** Evidence pieces placed per ghost type on a stage. */
export const EVIDENCE_PER_TYPE = 2;

// ------------------------------------------------------------------------------------------------ the Howler
export const HOWLER_LIMITS = {
  /** The wind-up before a scream (1 s): the Howler stops, and its cue says `screaming`. The telegraph a player can answer by crouching. */
  windupTicks: 20,
  /** Minimum ticks between two screams (20 s). */
  cooldownTicks: 400,
  /** How long the lights stay broken in the room it screamed in (10 s) and the share of the vision radius that is left. */
  lightsOutTicks: 200,
  lightsOutShare: 0.55,
} as const;

// ------------------------------------------------------------------------------------------------ fixed rules
export const GHOST_LIMITS = {
  /** Every appearance is preceded by a warning of at least this many ticks (3 s). The server uses `warningTicks`, which is never below it. */
  minWarningTicks: 60,
  warningTicks: 80,
  /** If no fair spawn point exists when a warning ends, the warning simply goes on for this many more ticks. */
  spawnRetryTicks: 20,
  /** A spawn point is at least this far (px) from every player of the room, and outside this radius of every arrival point and spawn slot of the room. */
  minSpawnDistance: 520,
  arrivalSafeRadius: 150,
  /** P3E step 5: after a Pulse Gun hit the ghost returns at least this far (px) from every player of the room. */
  respawnMinDistance: 700,
  /** Sight: a cone in front of the ghost (half-angle in radians, range in px). Hunting widens the cone. */
  sightRange: 340,
  sightHalfAngle: (35 * Math.PI) / 180,
  huntHalfAngle: (50 * Math.PI) / 180,
  /** A ghost touching a player this close (px, centre to centre) catches them. */
  catchRadius: 36,
  /** A ROAMING ghost fades (RESPAWN) after this many ticks without a hunt (60 s). A hunt, a stun or a noise being investigated does not run this clock down. */
  roamTicks: 1200,
  /** After losing sight of its quarry a hunter walks to the last place it saw them, then gives up after this many ticks (4 s). */
  loseSightTicks: 80,
  /** Time spent looking around on arrival at a noise or a last-seen place (3 s). */
  searchTicks: 60,
  /** A ghost needs this long (2 s) to open a door before it can pass. A closed (locked) door it can never pass. */
  doorTicks: 40,
  /** A noise older than this (10 s) is not "the last noise" a newly appeared ghost investigates. */
  freshNoiseTicks: 200,
  /** The first appearance comes after this share of the interval (a seeded value in [min, 1]) so it is never immediate. */
  firstAppearanceMinShare: 0.6,
  /** Kept events per stage (the log is a ring: the oldest fall off). */
  maxLogEvents: 400,
} as const;

// ------------------------------------------------------------------------------------------------ senses: noise
/** How a player moves, from the move axis the server actually applied (never from what the client claims). */
export type Gait = 'still' | 'sneak' | 'walk' | 'run';
export const GAIT_LIMITS = { sneakMax: 0.4, walkMax: 0.7 } as const;
export function gaitOf(moveX: number): Gait {
  const m = Math.abs(Number.isFinite(moveX) ? moveX : 0);
  if (m < 0.01) return 'still';
  if (m <= GAIT_LIMITS.sneakMax) return 'sneak';
  if (m <= GAIT_LIMITS.walkMax) return 'walk';
  return 'run';
}
/** Share of the ghost's hearing range at which each sound carries (running is loud; walking and sneaking are quiet; standing is silent). */
export const NOISE_LOUDNESS: Readonly<Record<Gait, number>> = { still: 0, sneak: 0.15, walk: 0.4, run: 1 };
/** Other sounds: dropping an item, a door being opened. A wall in the way muffles a sound to this share. */
export const NOISE_KIND_LOUDNESS = { drop: 1.1, door: 0.8, shot: 1.1 } as const;
export const NOISE_MUFFLE = 0.65;

// ------------------------------------------------------------------------------------------------ aim
/** The aim angle is sent quantised to 256 steps (about 1.4 degrees) so it is small, bounded and validated. */
export const AIM_STEPS = 256;
export const AimSchema = z.number().int().min(0).max(AIM_STEPS - 1);
/** Radians (any value) to a step 0 to 255. Non-finite input is 0. */
export function quantiseAim(angle: number): number {
  if (!Number.isFinite(angle)) return 0;
  const turns = angle / (2 * Math.PI);
  const q = Math.round((turns - Math.floor(turns)) * AIM_STEPS) % AIM_STEPS;
  return q;
}
/** A step 0 to 255 back to radians in [0, 2 PI). */
export function aimAngle(q: number): number { return (q / AIM_STEPS) * 2 * Math.PI; }

/** The shortest signed difference between two angles, in (-PI, PI]. */
export function angleDiff(a: number, b: number): number {
  let d = (a - b) % (2 * Math.PI);
  if (d > Math.PI) d -= 2 * Math.PI;
  else if (d <= -Math.PI) d += 2 * Math.PI;
  return d;
}

// ------------------------------------------------------------------------------------------------ the lit region
/**
 * The flashlight, as the SERVER sees it. The numbers mirror the client's `LIGHT` (ui/darkParam.ts): a small always-on light of 120 px and a cone
 * of 62 degrees, both scaled with the stage's vision radius (`visionRadius / 460`), and a thing is lit inside 88 percent of the reach.
 * Once a player's aim angle is known, what the server publishes to them is cut down to this region (plus line of sight).
 */
export const LIT = { smallRadius: 120, coneHalf: (31 * Math.PI) / 180, referenceReach: 460, reachShare: 0.88 } as const;
export function inLitRegion(eye: { x: number; y: number }, aim: number, target: { x: number; y: number }, radius: number): boolean {
  const k = radius / LIT.referenceReach;
  const dx = target.x - eye.x, dy = target.y - eye.y, d = Math.hypot(dx, dy);
  if (d <= LIT.smallRadius * k * LIT.reachShare) return true;
  if (d > radius * LIT.reachShare) return false;
  return Math.abs(angleDiff(Math.atan2(dy, dx), aim)) <= LIT.coneHalf;
}

// ------------------------------------------------------------------------------------------------ what a client is told
/** A ghost that is PRESENT. Only sent to a player who can see it (server/src/rooms/view.ts); a ghost that is not there is not in any message. */
export const GhostPublicSchema = z.object({
  id: z.string().max(24),
  kind: z.enum(GHOST_TYPES),
  /** Body centre. */
  x: z.number(), y: z.number(),
  /** Which way it faces, radians. */
  angle: z.number(),
  state: z.enum(['roaming', 'hunting', 'stunned']),
  room: z.string().max(48),
  /** P3E step 5 (additive, optional): a Shade held still by a flashlight cone. */
  lit: z.boolean().optional(),
});
export type GhostPublic = z.infer<typeof GhostPublicSchema>;

// ------------------------------------------------------------------------------------------------ sound cues (P3E step 2)
/**
 * THE DOCUMENTED EXCEPTION TO THE VISIBILITY INVARIANT. Everything else a player is told is cut to what they can see; the ghost's SOUND is
 * not, on purpose: "you can HEAR it before you see it" (GAMEPLAY.md section 6). What leaks is bounded and coarse: for a ghost in the SAME room
 * and within `GHOST_CUE.bands[2]` px (through walls and closed doors), a distance BUCKET (1 near, 2 middle, 3 far) and a direction
 * (-1 left, 0 ahead or above, +1 right), plus its type, state and whether it is moving. Never a coordinate, never a room it is in when it is
 * not the listener's, never anything about a ghost out of range. A ghost in WARNING (not there yet) is audible to everyone as `warning`.
 */
export const GHOST_CUE = {
  /** Upper edge (px) of bucket 1, 2 and 3. Beyond the last, the ghost is not audible. */
  bands: [250, 500, 800],
  /** Horizontal distance (px) under which a ghost counts as straight ahead (direction 0). */
  deadzone: 60,
  /** The server re-sends an unchanged cue at least this often (ticks) and never faster than `minGapTicks` for changes. */
  keepaliveTicks: 20, minGapTicks: 4,
} as const;
/** 0 = out of earshot, else 1 (near) to 3 (far). */
export function cueBand(distance: number): 0 | 1 | 2 | 3 {
  if (!Number.isFinite(distance) || distance > GHOST_CUE.bands[2]) return 0;
  return distance <= GHOST_CUE.bands[0] ? 1 : distance <= GHOST_CUE.bands[1] ? 2 : 3;
}
export function cueDir(dx: number): -1 | 0 | 1 {
  if (!Number.isFinite(dx) || Math.abs(dx) <= GHOST_CUE.deadzone) return 0;
  return dx < 0 ? -1 : 1;
}

export const GhostCueSoundSchema = z.object({
  id: z.string().max(24),
  kind: z.enum(GHOST_TYPES),
  band: z.union([z.literal(1), z.literal(2), z.literal(3)]),
  dir: z.union([z.literal(-1), z.literal(0), z.literal(1)]),
  state: z.enum(['roaming', 'hunting', 'stunned']),
  /** Walking right now (a stunned or searching ghost makes no footsteps). */
  moving: z.boolean(),
  /** P3E step 3 (additive, optional): the ghost stands at a hiding place and is about to open it. A telegraph of at least `CATCH_LIMITS.inspectTicks`. */
  inspecting: z.boolean().optional(),
  /** P3E step 5 (additive, optional): a Howler winding up its scream (the telegraph; crouch and break line of sight). */
  screaming: z.boolean().optional(),
});
// ------------------------------------------------------------------------------------------------ the Pulse Gun (P3E step 4)
/**
 * Fixed rules of the Pulse Gun. One per ghost stage, one charge (a shot spends it, hit or miss), aimed with the aim angle the server already holds
 * for the player. The bolt is simulated on the server: it flies `speedPx` per tick for at most `rangePx` (so at most `rangePx / speedPx` ticks, well under
 * a second), stops at a wall or a closed door, and stuns the first ghost whose body it touches. A ghost can only be stunned while ROAMING or HUNTING.
 */
export const GUN_LIMITS = {
  rangePx: 640,
  speedPx: 48,
  /** The bolt touches a ghost when the segment it flew this tick passes within this many px of the ghost's body centre. */
  hitRadiusPx: 30,
  /** Reach (px) of the muzzle from the shooter's eye. The bolt starts at the eye. */
  eyeHeight: 28,
  /** How long a bolt (and its flash) is kept in the world for the clients that saw it, in ticks. */
  flashTicks: 16,
} as const;

/**
 * P3E step 5: a visible effect, sent to the players who can see where it happened. `dissolve` = a ghost destroyed by the Pulse Gun.
 * `scream` = a Howler's scream let go (lights break). Position and type only, to players who can see the spot.
 */
export const GhostFxSchema = z.object({
  kind: z.enum(['dissolve', 'scream']),
  ghost: z.enum(GHOST_TYPES),
  x: z.number(), y: z.number(),
  room: z.string().max(48),
  tick: z.number().int().min(0),
});
export type GhostFx = z.infer<typeof GhostFxSchema>;

/** Sent once per shot to the players who can see where it was fired (and the shooter): the client draws the bolt from these numbers. */
export const GhostShotSchema = z.object({
  id: z.string().max(40),
  x: z.number(), y: z.number(),
  /** Radians. */
  angle: z.number(),
  rangePx: z.number().min(0).max(2000),
  speedPx: z.number().min(1).max(500),
  /** The server tick it was fired at. */
  tick: z.number().int().min(0),
  /** The room the shot was fired in (the viewer is in it). */
  room: z.string().max(48),
});
export type GhostShot = z.infer<typeof GhostShotSchema>;

// ------------------------------------------------------------------------------------------------ hiding and the catch (P3E step 3)
/** Fixed rules of hiding, capture, rescue and release. Times are server ticks (20 Hz). The server enforces all of them. */
export const CATCH_LIMITS = {
  /** E at a hiding spot: horizontal reach in px (the vertical offset is bounded by the usual 60 px). */
  hideRange: 60,
  /** Minimum ticks between two hide/leave actions of one player. */
  hideCooldownTicks: 10,
  /** The height above the floor at which a hiding spot is seen (the same point the server uses to decide whether to tell you about it). */
  spotPointHeight: 20,
  /** A caught player is released at their room's entry after this long (45 s) with a score penalty. Nobody is eliminated (P4 replaces this). */
  captureTicks: 900,
  releasePenalty: 40,
  /** A teammate frees a caught player by HOLDING E within this reach (px) for this long (4 s). Letting go costs progress back at the decay rate. */
  rescueRange: 70,
  rescueTicks: 80,
  rescueDecayPerTick: 2,
  /** A ghost that reaches the place of a noise may check a hiding spot within this many px of it, with this chance (seeded), and does so at most once per spot per `reinspectTicks`. */
  inspectRadius: 260,
  inspectShare: 0.6,
  reinspectTicks: 600,
  /** The telegraph: the ghost stands at the spot this long (2 s) before it opens it. The hider hears it (the cue says `inspecting`) and may leave. */
  inspectTicks: 40,
  /** P3E step 5: a hiding place holds up to this many players. */
  spotCapacity: 2,
} as const;

/** Intent: hide in the hiding spot in reach, or come out. (A rescue is not an action: it is the E key HELD, carried by the input stream as `use`.) */
export const GhostActionSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('hide') }).strict(),
  z.object({ action: z.literal('leave') }).strict(),
  /** P3E step 4: fire the Pulse Gun you carry. No parameters: the direction is the aim the server already holds for you. */
  z.object({ action: z.literal('fire') }).strict(),
]);
export type GhostAction = z.infer<typeof GhostActionSchema>;

export const HidingSpotPublicSchema = z.object({ id: z.string().max(48), x: z.number(), y: z.number(), kind: z.enum(['closet', 'vent']) });
export type HidingSpotPublic = z.infer<typeof HidingSpotPublicSchema>;

/**
 * Per-player status (sent inside the `ghost:cue` event). Everything here is what THIS player may know:
 * the spots in their view (furniture, cut like every other visible thing), the spot they hide in, their own capture timer, and the caught teammates
 * they can see with the progress of freeing them. Who hides in a spot is never told to anyone else.
 */
export const GhostStatusSchema = z.object({
  spots: z.array(HidingSpotPublicSchema).max(12),
  hiddenIn: z.string().max(48).nullable(),
  caught: z.object({ secondsLeft: z.number().int().min(0).max(60) }).nullable(),
  captives: z.array(z.object({ id: z.string().max(64), progress: z.number().min(0).max(1) })).max(8),
});
export type GhostStatus = z.infer<typeof GhostStatusSchema>;

export const GhostCueSchema = z.object({
  tick: z.number().int().min(0),
  /** Some ghost is in its WARNING: the lights flicker and a whisper is heard (everyone, wherever they are). */
  warning: z.boolean(),
  sounds: z.array(GhostCueSoundSchema).max(MAX_GHOSTS),
  /** P3E step 3 (additive, optional): what this player may know about hiding and being caught. Present while the stage has a ghost. */
  status: GhostStatusSchema.optional(),
  /** P3E step 5 (additive, optional): the kinds of the ghosts now in their WARNING (each has its own whisper and flicker). */
  warnKinds: z.array(z.enum(GHOST_TYPES)).max(MAX_GHOSTS).optional(),
  /** P3E step 5 (additive, optional): the Pulse Gun's recharge, in ticks left and in total. Absent while the stage has no gun. */
  gun: z.object({ left: z.number().int().min(0).max(5000), total: z.number().int().min(1).max(5000) }).optional(),
  /** P3E step 5 (additive, optional): ticks the lights stay broken in this player's room after a Howler's scream (0 = lit). */
  lightsOut: z.number().int().min(0).max(1000).optional(),
});
export type GhostCueSound = z.infer<typeof GhostCueSoundSchema>;
export type GhostCue = z.infer<typeof GhostCueSchema>;
