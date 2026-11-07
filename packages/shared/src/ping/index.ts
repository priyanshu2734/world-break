import { z } from 'zod';
import { MAX_PLAYERS, SERVER_TICK_HZ } from '../constants';

/**
 * P6 workstream A: the ping wheel, team chat and team panel (docs/PING.md).
 *
 * Everything here is data and pure functions shared by server and client. The server decides: a ping's position is checked against the
 * pinger's OWN view, the label is fixed by the kind (a ping can never carry hidden information), and every message is bounded.
 */

/** The seven ping kinds, in wheel order (the wheel's slots and the number keys 1 to 7 follow this order). */
export const PING_KINDS = ['key', 'danger', 'help', 'door', 'ghost', 'go', 'hide'] as const;
export type PingKind = (typeof PING_KINDS)[number];
export const PingKindSchema = z.enum(PING_KINDS);

/** Fixed, public labels. They never depend on game state: no digit, no ghost type, nothing about what is behind a door or in a safe. */
export const PING_LABELS: Readonly<Record<PingKind, string>> = {
  key: 'Key here', danger: 'Danger', help: 'Need help', door: 'Door locked', ghost: 'Ghost near', go: 'Go here', hide: 'Hiding here',
};

/**
 * Where the server puts a ping. `point`: the spot the pinger points at (it must lie in the pinger's own view). `self`: the pinger's own position
 * (the client's coordinates are ignored). `ghost`: the nearest ghost the pinger can see, else (if they can only hear one) the pinger's own position.
 */
export const PING_ANCHOR: Readonly<Record<PingKind, 'point' | 'self' | 'ghost'>> = {
  key: 'point', danger: 'point', help: 'self', door: 'point', ghost: 'ghost', go: 'point', hide: 'self',
};

export const PING_LIMITS = {
  /** A marker lives 6 s of server ticks (20 Hz). */
  ttlTicks: 6 * SERVER_TICK_HZ,
  /** At most this many live markers per player (a new one replaces that player's oldest). */
  perPlayer: 3,
  /** At most this many live markers per team. */
  perTeam: 12,
  /** Minimum ticks between two ACCEPTED pings of one player (1 s). */
  cooldownTicks: SERVER_TICK_HZ,
  /** Every request (accepted or not) counts: at most `attemptMax` in `attemptWindowTicks`, so a refused flood costs nothing. */
  attemptWindowTicks: 2 * SERVER_TICK_HZ,
  attemptMax: 6,
  /** Coordinates the schema accepts at all (the server then checks the view). */
  coordMax: 100_000,
} as const;

const Coord = z.number().finite().min(-PING_LIMITS.coordMax).max(PING_LIMITS.coordMax);

/** Client to server. Strict: an unknown field is an invalid request. `x` and `y` are only read for the `point` kinds. */
export const PingRequestSchema = z.object({ kind: PingKindSchema, x: Coord.optional(), y: Coord.optional() }).strict();
export type PingRequest = z.infer<typeof PingRequestSchema>;

/**
 * Server to client. `x` and `y` are present ONLY for a recipient standing in the same room as the marker; a teammate in another room is told the room
 * and who pinged, so the client draws an edge arrow or a label and never a position it could not see.
 */
export const PingMarkerSchema = z.object({
  id: z.number().int().min(1),
  kind: PingKindSchema,
  from: z.string().min(1).max(64),
  name: z.string().max(24),
  slot: z.number().int().min(0).max(MAX_PLAYERS),
  room: z.string().max(48),
  x: z.number().finite().optional(),
  y: z.number().finite().optional(),
  /** Ticks the marker lives (the client counts it down in its own time). */
  ttl: z.number().int().min(1).max(PING_LIMITS.ttlTicks),
});
export type PingMarker = z.infer<typeof PingMarkerSchema>;

// ---------------------------------------------------------------- chat

export const CHAT_LIMITS = {
  maxLen: 120,
  /** Living player: 1 message per 1.5 s. */
  gapMs: 1500,
  /** A dead player (spectator): 1 per 3 s. Decision recorded in docs/PING.md. */
  spectatorGapMs: 3000,
  /** How many messages a client keeps on screen (nothing is kept on the server). */
  clientKeep: 24,
  /** The schema only bounds the raw input; the sanitised text is bounded by `maxLen`. */
  rawMax: 1000,
} as const;

export const ChatSendSchema = z.object({ text: z.string().max(CHAT_LIMITS.rawMax) }).strict();
export type ChatSend = z.infer<typeof ChatSendSchema>;

export const ChatMessageSchema = z.object({
  id: z.number().int().min(1),
  from: z.string().min(1).max(64),
  name: z.string().max(24),
  slot: z.number().int().min(0).max(MAX_PLAYERS),
  text: z.string().min(1).max(CHAT_LIMITS.maxLen),
  /** Sent by a dead player. The client shows it dimmed; it carries nothing else about them. */
  spectator: z.boolean(),
});
export type ChatMessage = z.infer<typeof ChatMessageSchema>;

/**
 * Cleans a chat line: removes control characters, zero-width and bidirectional-override characters, HTML-like tags and the characters `<` and `>`,
 * collapses runs of white space and trims. Never throws. The server applies it to every message; the client applies it to what it shows.
 */
export function sanitiseChat(raw: string): string {
  let s = String(raw).normalize('NFKC');
  s = s.replace(/<[^>]*>/g, ' ');
  // eslint-disable-next-line no-control-regex
  s = s.replace(/[\u0000-\u001F\u007F-\u009F\u200B-\u200F\u2028-\u202E\u2060-\u206F\uFEFF\uFFF9-\uFFFB]/g, ' ');
  s = s.replace(/[<>]/g, '');
  return s.replace(/\s+/g, ' ').trim();
}

/** `ok` with the clean text, or the reason it was refused (empty after cleaning, or longer than the limit). */
export function checkChat(raw: string): { ok: true; text: string } | { ok: false; error: string } {
  const text = sanitiseChat(raw);
  if (text === '') return { ok: false, error: 'Say something first.' };
  if (Array.from(text).length > CHAT_LIMITS.maxLen) return { ok: false, error: `Messages are at most ${CHAT_LIMITS.maxLen} characters.` };
  return { ok: true, text };
}

// ---------------------------------------------------------------- team panel

export const TEAM_STATES = ['alive', 'hiding', 'dead', 'spectating', 'disconnected'] as const;
export type TeamState = (typeof TEAM_STATES)[number];

/**
 * Sent to ONE player. `carried` is a COUNT (never the contents) and, like `journal`, is only sent to a living player: a dead player is told each
 * teammate's name and state and nothing else. `journal` is the P3F summary (how many pieces examined, how many lines marked), never the ghost type.
 */
export const TeamPanelSchema = z.object({
  tick: z.number().int().min(0),
  members: z.array(z.object({
    id: z.string().min(1).max(64),
    name: z.string().max(24),
    slot: z.number().int().min(0).max(MAX_PLAYERS),
    state: z.enum(TEAM_STATES),
    carried: z.number().int().min(0).max(32).optional(),
  })).max(MAX_PLAYERS),
  journal: z.object({ found: z.number().int().min(0).max(32), marked: z.number().int().min(0).max(3), lines: z.number().int().min(1).max(3) }).optional(),
});
export type TeamPanel = z.infer<typeof TeamPanelSchema>;
