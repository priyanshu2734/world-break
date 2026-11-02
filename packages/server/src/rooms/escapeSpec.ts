import { z } from 'zod';
import { ESCAPE_LIMITS, EVIDENCE_KINDS, EscapeIdSchema as Id, GHOST_TYPES } from '@wb/shared';

const Pt = { x: z.number(), y: z.number() };

/**
 * One lock per physical door. Everything here is server-private (codes, combinations, clue text, what a safe holds).
 *  key_item  : an `access_key` part is used up.      power: a `battery` part is used up.
 *  code      : a 4-digit keypad elsewhere; `clueIds` are the notes whose digits, read in order, spell the code.
 *  two_person: both switches lit at once (a lit switch holds `switchHoldTicks`, so one person can run between them).
 *  safe      : the door needs a key, and the key is inside a safe opened with a 3-digit combination spelled by its clues.
 *  P3F step 2 adds eight more (lever_sequence, symbol_match, breaker_panel, pressure_plates, timed_switch, wiring, flashlight_sensor, tool_key): see below and docs/VARIETY.md.
 */
export const LockSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('key_item') }),
  z.object({ type: z.literal('power') }),
  z.object({ type: z.literal('code'), keypadId: Id, code: z.string().regex(/^[0-9]{4}$/), clueIds: z.array(Id).min(1).max(4) }),
  z.object({ type: z.literal('two_person'), switchA: Id, switchB: Id }),
  z.object({ type: z.literal('safe'), safeId: Id }),
  // ---- P3F step 2: the puzzle pool. Every switch named below is an entry of `switches`; levers, breakers, terminals and sensors are listed west to east.
  /** levers pulled in `order` (indexes into `levers`, west to east); a wrong lever puts them all back; `clueId` is the log that spells the order. */
  z.object({ type: z.literal('lever_sequence'), levers: z.array(Id).min(3).max(4), order: z.array(z.number().int().min(0).max(3)).min(3).max(4), clueId: Id }),
  /** a keypad whose code is written in symbols: a picture of glyphs in one room, a legend (symbol to digit) in another. */
  z.object({ type: z.literal('symbol_match'), keypadId: Id, code: z.string().regex(/^[0-9]{4}$/), pictureId: Id, legendId: Id }),
  /** breakers that start in `start` and must end in `target` (true = on); a press toggles one; too many presses trip the panel. */
  z.object({ type: z.literal('breaker_panel'), breakers: z.array(Id).min(3).max(4), start: z.array(z.boolean()).min(3).max(4), target: z.array(z.boolean()).min(3).max(4), clueId: Id }),
  /** two plates that a body must be standing on; each stays lit `plateHoldTicks` after it was left. */
  z.object({ type: z.literal('pressure_plates'), plates: z.tuple([Id, Id]) }),
  /** one switch that unlocks the door for `timedDoorTicks`; whoever goes through in time keeps it open for the team. */
  z.object({ type: z.literal('timed_switch'), switchId: Id }),
  /** terminals, one of which (`right`, index west to east) is the live wire; a wrong one sparks and locks the panel out for a while. */
  z.object({ type: z.literal('wiring'), terminals: z.array(Id).min(3).max(4), right: z.number().int().min(0).max(3), clueId: Id }),
  /** sensors, one of which (`genuine`) opens the door once it has been lit for `sensorTicks` in a row; the others are dead. */
  z.object({ type: z.literal('flashlight_sensor'), sensors: z.array(Id).min(2).max(3), genuine: Id }),
  /** a door that needs an access key which lies in a jammed locker (`stashId`) that only opens for a carried `valve_wheel`. */
  z.object({ type: z.literal('tool_key'), stashId: Id, tool: z.literal('valve_wheel') }),
]);
export type Lock = z.infer<typeof LockSchema>;

export const EscapeSpecSchema = z.object({
  /** The exit: a standing zone on a floor in `room`. Reaching it alive clears the stage. */
  exit: z.object({ room: Id, ...Pt }),
  /** A door appears in two rooms (one per side); both ids belong to the same link and share its lock and its open state. */
  links: z.array(z.object({ doors: z.tuple([Id, Id]), lock: LockSchema })).max(ESCAPE_LIMITS.maxLinks),
  keypads: z.array(z.object({ id: Id, room: Id, ...Pt })).max(ESCAPE_LIMITS.maxKeypads),
  safes: z.array(z.object({
    id: Id, room: Id, ...Pt,
    code: z.string().regex(/^[0-9]{3}$/),
    clueIds: z.array(Id).min(1).max(3),
    /** The hidden part inside (revealed when the safe opens); omitted = an empty safe. */
    contains: Id.optional(),
  })).max(ESCAPE_LIMITS.maxSafes),
  clues: z.array(z.object({ id: Id, room: Id, ...Pt, label: z.string().max(24).default('Note'), text: z.string().min(1).max(200) })).max(ESCAPE_LIMITS.maxClues),
  switches: z.array(z.object({ id: Id, room: Id, ...Pt })).max(ESCAPE_LIMITS.maxSwitches),
  /**
   * Placeholder hiding spots for the ghost (P3E). Server-private and inert in P3D: nothing reads them yet except the validator
   * (they must stand on a solid). They are never published.
   */
  /** P3E step 5 (additive, optional): evidence each ghost type of the stage leaves (data only; P3F uses it). */
  ghostEvidence: z.array(z.object({ id: Id, room: Id, ...Pt, kind: z.enum(EVIDENCE_KINDS), ghost: z.enum(GHOST_TYPES) })).max(ESCAPE_LIMITS.maxEvidence).optional(),
  hidingSpots: z.array(z.object({ id: Id, room: Id, ...Pt, kind: z.enum(['closet', 'vent']) })).max(ESCAPE_LIMITS.maxHidingSpots).optional(),
});
export type EscapeSpec = z.infer<typeof EscapeSpecSchema>;
