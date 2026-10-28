import type { Gait, GhostFx, GhostState, GhostType } from '@wb/shared';

/** What the ghost may know about one player, supplied by the host (the Room) from authoritative state. */
export interface GhostPlayer {
  id: string;
  name: string;
  roomId: string;
  /** Feet-centre, like every body. */
  x: number;
  y: number;
  connected: boolean;
  /** The move axis the server applied this tick. */
  moveX: number;
  /** Shift held AND standing or moving at sneak speed (a crouch): silent. */
  crouch: boolean;
  /** Radians, or null if the client never sent an aim (then it is facing-based on the server). */
  aim: number | null;
  facing: 1 | -1;
  /** Inside a hiding spot: not seen and silent (P3E step 3 sets it; false until then). */
  hidden: boolean;
  /** Captured by a ghost, waiting for a rescue (P3E step 3). A captured player is not hunted again. */
  captured: boolean;
}

/** A static hiding place the ghost may check (P3E step 3). */
export interface HidingSpotDef { id: string; room: string; x: number; y: number; kind: 'closet' | 'vent' }

/** What the ghost may ask of its host. A narrow seam so the ghost is unit-testable without a Room. */
export interface GhostHost {
  /** The simulation tick (the only clock the ghost has). */
  readonly tick: number;
  /** Every player of the run, in slot order. */
  players(): GhostPlayer[];
  /** Ids of the doors that are open (a ghost can pass only those, and an open door does not block sight). */
  openDoorIds(): ReadonlySet<string>;
  /** A ghost caught a player. The host decides what that means (P3E step 3: capture; step 1: nothing but the log). */
  onCatch?(playerId: string, event: GhostCatchEvent): void;
  /** Who hides in a spot right now (P3E step 3), or null. Only asked when the ghost opens that spot. */
  occupantOf?(spotId: string): string | null;
  /** P3E step 5: everyone hiding in a spot (a spot holds up to 2). Preferred over `occupantOf` when given. */
  occupantsOf?(spotId: string): string[];
  /** P3E step 5: a Howler's scream let go in `room` (the host breaks the lights there). */
  onScream?(ev: { ghost: string; room: string; x: number; y: number; tick: number }): void;
  /**
   * P4 (additive, optional): may a ghost kill this player right now? False during the stage's spawn grace, while a revived player is protected, or
   * when the player is already dead (two ghosts touching one player on the same tick kill them once). Absent = always (the pre-P4 behaviour).
   */
  canKill?(playerId: string): boolean;
  /**
   * P4 (additive, optional): how many consecutive ticks a hunting ghost must stay in contact (within `GHOST_LIMITS.catchRadius`, with a clear line)
   * before the touch kills. Absent or 0 = at once and without the line rule (the pre-P4 behaviour).
   */
  readonly contactTicks?: number;
  /**
   * P4 (additive, optional): ticks a ghost stays SATIATED after a kill: it stands quiet where it is (no senses, no hunt, no move, no kill) so the team can
   * recover what the dead player dropped. Absent or 0 = the pre-P4 rule: it leaves at once (RESPAWN).
   */
  readonly satiatedTicks?: number;
}

/** Everything the server logs about the ghost (for the future death review, P4). Plain data; bounded ring. */
export interface GhostEventBase { tick: number; ghost: string }
export type GhostStateEvent = GhostEventBase & { kind: 'state'; from: GhostState; to: GhostState; cause: string };
export type GhostHeardEvent = GhostEventBase & { kind: 'heard'; player: string; room: string; x: number; y: number; loudness: number; gait: Gait | 'drop' | 'door' | 'shot'; text: string };
export type GhostSightEvent = GhostEventBase & { kind: 'sighted'; player: string; distance: number; text: string };
export type GhostLostEvent = GhostEventBase & { kind: 'lost'; player: string; text: string };
export type GhostSpawnEvent = GhostEventBase & { kind: 'spawn'; room: string; x: number; y: number; warnedAt: number };
export type GhostBlockedEvent = GhostEventBase & { kind: 'spawn_blocked'; reason: string };
export type GhostDoorEvent = GhostEventBase & { kind: 'door'; door: string; phase: 'start' | 'done' | 'cancelled' };
export type GhostCatchEvent = GhostEventBase & {
  kind: 'catch'; player: string; room: string; x: number; y: number; because: string[];
  /** P4 (additive, optional): how the kill happened (touch, or the ghost opened the hiding place) and which type of ghost it was. */
  how?: 'touch' | 'opened_spot'; ghostKind?: GhostType;
};
export type GhostInspectEvent = GhostEventBase & { kind: 'inspect'; spot: string; room: string; phase: 'start' | 'found' | 'empty'; player?: string; text: string };
/** A Pulse Gun shot (P3E step 4): fired, and how it ended. `ghost` is the one hit. */
export type GhostPulseEvent = GhostEventBase & { kind: 'pulse'; by: string; phase: 'fired' | 'hit' | 'stunned' | 'destroyed' | 'absorbed' | 'wall' | 'miss'; room: string; text: string };
/** P3E step 5: a Pulse Gun hit destroyed the ghost; it comes back (warning first) at `returnsAt`. */
export type GhostDestroyEvent = GhostEventBase & { kind: 'destroy'; by: string | null; ghostKind: GhostType; room: string; x: number; y: number; returnsAt: number };
/** P3E step 5: a Howler's scream: the wind-up (the telegraph), then the scream (`alerted` = the player it now knows the place of, if any). */
export type GhostScreamEvent = GhostEventBase & { kind: 'scream'; phase: 'windup' | 'scream'; room: string; text: string; alerted: string | null };
export type GhostStunEvent = GhostEventBase & { kind: 'stun'; by: string | null; until: number };
/** P4: after a kill the ghost stays quiet until `until` (it does not hunt, hear, move or kill). */
export type GhostSatiatedEvent = GhostEventBase & { kind: 'satiated'; player: string; until: number };
export type GhostEvent =
  | GhostStateEvent | GhostHeardEvent | GhostSightEvent | GhostLostEvent | GhostSpawnEvent
  | GhostBlockedEvent | GhostDoorEvent | GhostCatchEvent | GhostStunEvent | GhostInspectEvent | GhostPulseEvent | GhostDestroyEvent | GhostScreamEvent | GhostSatiatedEvent;
export type { GhostFx };

/** One sentence a person can read: why this catch happened ("Heard Ada running at tick 412; saw Ada at tick 440; caught Ada at tick 466."). */
export function explainCatch(ev: GhostCatchEvent): string {
  return ev.because.join('; ') + '.';
}
