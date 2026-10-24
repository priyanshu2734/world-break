import { z } from 'zod';
import { ESCAPE_LIMITS, EscapeIdSchema as Id } from '@wb/shared';

const Pt = { x: z.number(), y: z.number() };

/**
 * One lock per physical door. Everything here is server-private (codes, combinations, clue text, what a safe holds).
 *  key_item  : an `access_key` part is used up.      power: a `battery` part is used up.
 *  code      : a 4-digit keypad elsewhere; `clueIds` are the notes whose digits, read in order, spell the code.
 *  two_person: both switches lit at once (a lit switch holds `switchHoldTicks`, so one person can run between them).
 *  safe      : the door needs a key, and the key is inside a safe opened with a 3-digit combination spelled by its clues.
 */
export const LockSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('key_item') }),
  z.object({ type: z.literal('power') }),
  z.object({ type: z.literal('code'), keypadId: Id, code: z.string().regex(/^[0-9]{4}$/), clueIds: z.array(Id).min(1).max(4) }),
  z.object({ type: z.literal('two_person'), switchA: Id, switchB: Id }),
  z.object({ type: z.literal('safe'), safeId: Id }),
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
  hidingSpots: z.array(z.object({ id: Id, room: Id, ...Pt, kind: z.enum(['closet', 'vent']) })).max(ESCAPE_LIMITS.maxHidingSpots).optional(),
});
export type EscapeSpec = z.infer<typeof EscapeSpecSchema>;
