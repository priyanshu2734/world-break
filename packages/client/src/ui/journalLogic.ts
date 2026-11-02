import { EVIDENCE_BY_TYPE, EVIDENCE_LABELS, GHOST_COUNTERS, GHOST_TYPES, JOURNAL, type EscapePublic, type EvidenceKind, type GhostType } from '@wb/shared';

/** P3F step 3: the logic of the team journal screen (no Phaser here, so it is unit-tested). */
export type Journal = NonNullable<EscapePublic['journal']>;

export interface JournalRow {
  ghost: GhostType;
  /** "Shade" */
  name: string;
  /** The field guide's counter for this type. */
  counter: string;
  /** Its kinds of evidence, each with whether the team has examined one. */
  evidence: { label: string; seen: boolean }[];
  marked: boolean;
}

const cap = (s: string): string => s.charAt(0).toUpperCase() + s.slice(1);

export function journalRows(j: Journal): JournalRow[] {
  const seen = new Set<string>(j.entries.map((e) => e.kind));
  return GHOST_TYPES.map((ghost) => ({
    ghost, name: cap(ghost), counter: GHOST_COUNTERS[ghost], marked: j.marks.includes(ghost),
    evidence: EVIDENCE_BY_TYPE[ghost].map((k) => ({ label: EVIDENCE_LABELS[k as EvidenceKind] ?? k, seen: seen.has(k) })),
  }));
}

export function journalHeader(j: Journal): string {
  return `TEAM JOURNAL   ${j.marks.length}/${j.lines} lines used   examined: ${j.entries.length}`;
}

/** The rule line shown under the header (teach before test). */
export const JOURNAL_RULES = `A right entry: warnings of that ghost last 2 s longer and the Pulse Gun recharges a quarter quicker. A wrong entry costs ${JOURNAL.wrongCost} points. Entries are final.`;

/** Can this type be entered now? The server checks it all again. */
export function markCheck(j: Journal, ghost: GhostType): { ok: true } | { ok: false; reason: string } {
  if (j.marks.includes(ghost)) return { ok: false, reason: 'Already in the journal.' };
  if (j.marks.length >= j.lines) return { ok: false, reason: 'Every line is used.' };
  if (j.entries.length < JOURNAL.minExamined) return { ok: false, reason: 'Examine some traces first.' };
  return { ok: true };
}
