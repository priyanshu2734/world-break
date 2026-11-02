import { z } from 'zod';

/** An id of a door, keypad, safe, clue or switch (same alphabet as room ids, which may contain dots). */
export const EscapeIdSchema = z.string().regex(/^[a-z][a-z0-9_.]*$/).max(48);

/** The five original lock types of an escape stage (docs/ROOMS.md). Unchanged: `locksForStage` still draws from these. */
export const LOCK_TYPES = ['key_item', 'code', 'power', 'two_person', 'safe'] as const;
export type LockType = (typeof LOCK_TYPES)[number];

/** P3F step 2: the eight puzzle types added to the pool (docs/VARIETY.md). A lock is one of the five above or one of these. */
export const PUZZLE_TYPES = ['lever_sequence', 'symbol_match', 'breaker_panel', 'pressure_plates', 'timed_switch', 'wiring', 'flashlight_sensor', 'tool_key'] as const;
export type PuzzleType = (typeof PUZZLE_TYPES)[number];
/** The whole pool: 13 lock types. */
export const ANY_LOCK_TYPES = [...LOCK_TYPES, ...PUZZLE_TYPES] as const;
export type AnyLockType = LockType | PuzzleType;

/** Bounds and timings of the escape mechanics. The server enforces all of them. Times are server ticks (20 Hz). */
export const ESCAPE_LIMITS = {
  /** Horizontal reach (px) for E on a door, keypad, safe, clue or switch; the vertical offset is bounded by RANGE_DY. */
  useRange: 70,
  /** A door opens with E and carries the player through this many ticks later (0.5 s). */
  doorDelayTicks: 10,
  /** The player may drift this far (px) while the door is opening; further cancels it. */
  doorDriftPx: 60,
  /** The exit is a standing zone this wide and tall (px); reaching it clears the stage. */
  exitWidth: 60, exitHeight: 100,
  /** Symbols in a keypad code and in a safe combination (digits 0 to 9). */
  codeLength: 4, comboLength: 3,
  /** Wrong tries on one keypad or safe before it locks out, and how long (5 s). Brute force is therefore bounded. */
  maxWrongTries: 3, lockoutTicks: 100,
  /** A pressed two-person switch stays lit this long (6 s): one person can run between the two switches. */
  switchHoldTicks: 120,
  /** P3F step 2: a pressure plate stays lit this long (3 s) after somebody left it, and is lit by a body within `plateRadius` px of it (feet on its surface). */
  plateHoldTicks: 60, plateRadius: 36,
  /** P3F step 2: a timed door stays unlocked this long (8 s) after its switch, unless somebody has gone through (then it stays open for good). */
  timedDoorTicks: 160,
  /** P3F step 2: the working sensor must stay in a player's light this many ticks in a row (2 s). */
  sensorTicks: 40,
  /** P3F step 2: a breaker panel trips (resets and locks out) after this many presses more than it has breakers. */
  breakerSlack: 3,
  /** Minimum ticks between two escape intents from one player (accepted AND refused). */
  minGapTicks: 4,
  /** Authoring bounds per stage (the room cap of 6 gives at most 5 doors). */
  maxLinks: 5, maxClues: 20, maxKeypads: 5, maxSafes: 5, maxSwitches: 24, maxHidingSpots: 12, maxEvidence: 6,
} as const;

/** The refusal on a locked door: it says WHAT is missing, never WHERE it is. Key and safe doors read the same on purpose. */
export function needText(type: AnyLockType, codeLength: number = ESCAPE_LIMITS.codeLength): string {
  switch (type) {
    case 'key_item': case 'safe': return 'Locked. Needs a key.';
    case 'code': return `Locked. Needs a ${codeLength}-symbol code.`;
    case 'power': return 'Locked. Needs power.';
    case 'two_person': return 'Locked. Needs two switches held at once.';
    case 'tool_key': return 'Locked. Needs a key.';
    case 'lever_sequence': return 'Locked. The levers must be set in the right order.';
    case 'symbol_match': return `Locked. Needs a ${codeLength}-digit code written in symbols.`;
    case 'breaker_panel': return 'Locked. The circuits must be set right.';
    case 'pressure_plates': return 'Locked. Needs both plates held down at once.';
    case 'timed_switch': return 'Locked. It only opens for a short while.';
    case 'wiring': return 'Locked. The right wire must be chosen.';
    case 'flashlight_sensor': return 'Locked. A sensor must see light.';
  }
}

/** Refusals shared by every reason (nonexistent, other room, hidden), so they never tell a hidden thing from nothing. */
export const ESCAPE_NOTHING = 'Nothing there.';

/** Intent: what a player ASKS to do. The server checks room, reach, locks, attempts and rate. */
export const EscapeActionSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('use_door'), doorId: EscapeIdSchema }).strict(),
  z.object({ action: z.literal('enter_code'), targetId: EscapeIdSchema, code: z.string().regex(/^[0-9]{1,8}$/) }).strict(),
  z.object({ action: z.literal('press'), switchId: EscapeIdSchema }).strict(),
  z.object({ action: z.literal('read'), clueId: EscapeIdSchema }).strict(),
]);
export type EscapeAction = z.infer<typeof EscapeActionSchema>;

/**
 * Public escape state (optional `StageState.escape`), then restricted per player to what is in their view (server/src/rooms/view.ts).
 * Nothing here is a secret: no codes, no clue text, no lock type before somebody
 * tried the door (`need` is null until then), no door destination. Positions of doors come from the room layout.
 */
export const EscapePublicSchema = z.object({
  doors: z.array(z.object({ id: EscapeIdSchema, room: EscapeIdSchema, open: z.boolean(), need: z.string().nullable() })),
  keypads: z.array(z.object({
    id: EscapeIdSchema, room: EscapeIdSchema, x: z.number(), y: z.number(), length: z.number().int(), solved: z.boolean(),
    /** Server tick until which the keypad refuses input after too many wrong tries; null = not locked out. */
    lockedUntilTick: z.number().int().nullable(),
  })),
  safes: z.array(z.object({
    id: EscapeIdSchema, room: EscapeIdSchema, x: z.number(), y: z.number(), length: z.number().int(), opened: z.boolean(),
    lockedUntilTick: z.number().int().nullable(),
  })),
  clues: z.array(z.object({ id: EscapeIdSchema, room: EscapeIdSchema, x: z.number(), y: z.number(), label: z.string() })),
  switches: z.array(z.object({ id: EscapeIdSchema, room: EscapeIdSchema, x: z.number(), y: z.number(), active: z.boolean() })),
  /** Present only while the exit is in the viewer's view (a hidden exit is not in the snapshot). */
  exit: z.object({ room: EscapeIdSchema, x: z.number(), y: z.number() }).optional(),
});
export type EscapePublic = z.infer<typeof EscapePublicSchema>;

/** The result of an escape intent. `note` carries clue text back to the reader only (it is never in the public state). */
export interface EscapeAck { message: string; note?: { id: string; text: string } }
