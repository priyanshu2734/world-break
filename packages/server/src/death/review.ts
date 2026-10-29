import { ITEM_KIND_SPECS, WIPE, type DeathReview, type DeathReviewMsg, type GhostCue, type PlayerLife, type ReviewLine } from '@wb/shared';
import type { DeathEvent } from './types';

/**
 * P4 step 4: the death review. EVERYTHING in it comes from something the server recorded with a tick: the ghost's own catch reasons, the cues the player
 * was sent, the sounds the ghost logged, the hiding attempts, the death system's drops and the revive attempts. Nothing here is invented, summarised
 * from memory or guessed: `buildReview` only selects, orders and words what is in the log, and a review of a player with no recorded death is null.
 * It names no code, no safe, no clue, no item id and no solution (parts by what they are, positions only where they came to rest).
 */

export type ReviewKind = 'warning' | 'noise' | 'hiding' | 'rescue';
export interface ReviewNote { tick: number; kind: ReviewKind; text: string }

/** Bounds: notes kept per player and kind (a ring), so a long stage never grows the log. */
export const REVIEW_KEEP = 24;

const clip = (s: string): string => (s.length > WIPE.maxText ? `${s.slice(0, WIPE.maxText - 1)}…` : s);

/** What happened around each player, noted as it happens (server side only). */
export class ReviewLog {
  private readonly notes = new Map<string, ReviewNote[]>();

  add(player: string, kind: ReviewKind, tick: number, text: string): void {
    const list = this.notes.get(player) ?? [];
    const t = clip(text);
    if (list.some((n) => n.tick === tick && n.kind === kind && n.text === t)) return; // the same fact is noted once
    list.push({ tick, kind, text: t });
    const ofKind = list.filter((n) => n.kind === kind);
    if (ofKind.length > REVIEW_KEEP) list.splice(list.indexOf(ofKind[0]!), 1);
    this.notes.set(player, list);
  }
  of(player: string): readonly ReviewNote[] { return this.notes.get(player) ?? []; }
  remove(player: string): void { this.notes.delete(player); }
}

const BAND = ['', 'close by', 'at a distance', 'far off'] as const;
const DIR = { '-1': 'to your left', '0': 'ahead of you', '1': 'to your right' } as const;
const label = (kind: keyof typeof ITEM_KIND_SPECS): string => ITEM_KIND_SPECS[kind].label;

/** What changed in the cue a player was sent between two ticks, worded (only the changes, never the same thing twice). */
export function cueNotes(prev: ReviewCueSig | null, cue: GhostCue): { notes: string[]; sig: ReviewCueSig } {
  const notes: string[] = [];
  const sig: ReviewCueSig = { warning: cue.warning, sounds: new Map(cue.sounds.map((s) => [s.id, { band: s.band, inspecting: s.inspecting === true, screaming: s.screaming === true }])) };
  if (cue.warning && !(prev?.warning)) {
    const kinds = cue.warnKinds ?? [];
    notes.push(`The lights flickered and a whisper warned that ${kinds.length > 0 ? `a ${kinds.join(' and a ')}` : 'a ghost'} was about to appear.`);
  }
  for (const s of cue.sounds) {
    const before = prev?.sounds.get(s.id);
    if (!before || s.band < before.band) notes.push(`A ${s.kind} could be heard ${BAND[s.band]}, ${DIR[String(s.dir) as '-1' | '0' | '1']}.`);
    if (s.inspecting && !before?.inspecting) notes.push(`A ${s.kind} stood at a hiding place, about to open it.`);
    if (s.screaming && !before?.screaming) notes.push(`A ${s.kind} was winding up a scream.`);
  }
  return { notes, sig };
}
export interface ReviewCueSig { warning: boolean; sounds: Map<string, { band: number; inspecting: boolean; screaming: boolean }> }

const lines = (notes: readonly ReviewNote[], kind: ReviewKind, upTo: number | null): ReviewLine[] =>
  notes.filter((n) => n.kind === kind && (upTo === null || n.tick <= upTo)).sort((a, b) => a.tick - b.tick).slice(-WIPE.maxLines).map((n) => ({ tick: n.tick, text: n.text }));

/**
 * The review of the LAST death of `player` this attempt, or null when the log holds none. `events` is the death system's log (it carries the tick of
 * every entry), `notes` the player's own notes, `life` what they are now.
 */
export function buildReview(o: { player: string; life: PlayerLife; events: readonly DeathEvent[]; notes: readonly ReviewNote[] }): DeathReview | null {
  const deaths = o.events.filter((e): e is Extract<DeathEvent, { kind: 'killed' }> => e.kind === 'killed' && e.player === o.player);
  const last = deaths.at(-1);
  if (!last) return null;
  const dropped = o.events
    .filter((e): e is Extract<DeathEvent, { kind: 'item_dropped' }> => e.kind === 'item_dropped' && e.player === o.player && e.tick >= last.tick)
    .slice(0, 4)
    .map((e) => ({ tick: e.tick, label: label(e.itemKind), room: e.room, x: Math.round(e.x), y: Math.round(e.y), relocated: e.relocated }));
  return {
    player: o.player, name: last.name, tick: last.tick, life: o.life, deaths: Math.min(20, deaths.length),
    cause: { how: last.cause.how, ghost: last.cause.ghost, ghostKind: last.cause.ghostKind, because: last.cause.because.slice(0, WIPE.maxLines).map(clip) },
    warnings: lines(o.notes, 'warning', last.tick),
    noise: lines(o.notes, 'noise', last.tick),
    hiding: lines(o.notes, 'hiding', last.tick),
    rescues: lines(o.notes, 'rescue', null),
    carried: last.carrying.slice(0, 4).map((c) => ({ label: label(c.kind) })),
    dropped,
  };
}

/** What one player is sent when the wipe turns into the review. */
export function buildMessage(o: {
  stage: number; attempt: number; wiped: boolean; viewer: string;
  roster: readonly { id: string; name: string }[]; lifeOf: (id: string) => PlayerLife | undefined; events: readonly DeathEvent[]; log: ReviewLog;
}): DeathReviewMsg {
  const diedAt = (id: string): number | null => o.events.filter((e) => e.kind === 'killed' && e.player === id).at(-1)?.tick ?? null;
  return {
    stage: o.stage, attempt: o.attempt, wiped: o.wiped,
    yours: buildReview({ player: o.viewer, life: o.lifeOf(o.viewer) ?? 'eliminated', events: o.events, notes: o.log.of(o.viewer) }),
    team: o.roster.slice(0, WIPE.maxTeam).map((r) => ({ name: r.name, life: o.lifeOf(r.id) ?? 'alive', diedAt: diedAt(r.id) })),
  };
}
