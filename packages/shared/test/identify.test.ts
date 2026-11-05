import { describe, expect, it } from 'vitest';
import {
  EVIDENCE_BY_TYPE, EVIDENCE_KINDS, EVIDENCE_LABELS, EscapeActionSchema, EscapePublicSchema, GHOST_COUNTERS, GHOST_TYPES, GhostCueSchema, GhostFxSchema,
  GhostPublicSchema, IDENTIFY_FROM_STAGE, IDENTIFY_TEACH_LINE, JOURNAL, evidenceOwner, gunCooldown, shownKind,
} from '../src';

describe('P3F step 3: identify the ghost (shared rules)', () => {
  it('the type is named before stage 7 and never from stage 7 on (also at stage 1,000,000)', () => {
    expect(IDENTIFY_FROM_STAGE).toBe(7);
    for (const t of GHOST_TYPES) {
      expect(shownKind(t, 6)).toBe(t);
      expect(shownKind(t, 7)).toBe('unknown');
      expect(shownKind(t, 1_000_000)).toBe('unknown');
    }
  });
  it('every kind of evidence has one owner and a label, and every type has a counter', () => {
    for (const k of EVIDENCE_KINDS) { expect(evidenceOwner(k)).not.toBeNull(); expect(EVIDENCE_LABELS[k].length).toBeGreaterThan(3); }
    for (const t of GHOST_TYPES) { expect(EVIDENCE_BY_TYPE[t].length).toBeGreaterThan(0); expect(GHOST_COUNTERS[t].length).toBeGreaterThan(10); }
  });
  it('the reward is bounded and the cost is small', () => {
    expect(gunCooldown(600, 0)).toBe(600);
    expect(gunCooldown(600, 1)).toBe(450);
    expect(gunCooldown(600, 2)).toBe(450); // does not stack
    expect(gunCooldown(1, 1)).toBeGreaterThanOrEqual(1);
    expect(JOURNAL.warningBonusTicks).toBeGreaterThan(0);
    expect(JOURNAL.warningBonusTicks).toBeLessThanOrEqual(60);
    expect(JOURNAL.wrongCost).toBeGreaterThan(0);
    expect(JOURNAL.wrongCost).toBeLessThanOrEqual(50);
    expect(IDENTIFY_TEACH_LINE).toContain('journal');
  });
  it('the public schemas accept an unnamed ghost; the old kinds still pass', () => {
    expect(GhostPublicSchema.safeParse({ id: 'g0', kind: 'unknown', x: 1, y: 2, angle: 0, state: 'roaming', room: 'a' }).success).toBe(true);
    expect(GhostPublicSchema.safeParse({ id: 'g0', kind: 'shade', x: 1, y: 2, angle: 0, state: 'roaming', room: 'a' }).success).toBe(true);
    expect(GhostPublicSchema.safeParse({ id: 'g0', kind: 'dragon', x: 1, y: 2, angle: 0, state: 'roaming', room: 'a' }).success).toBe(false);
    expect(GhostFxSchema.safeParse({ kind: 'scream', ghost: 'unknown', x: 1, y: 2, room: 'a', tick: 3 }).success).toBe(true);
    expect(GhostCueSchema.safeParse({ tick: 1, warning: true, sounds: [], warnKinds: ['unknown'] }).success).toBe(true);
  });
  it('the two new intents are strict', () => {
    expect(EscapeActionSchema.safeParse({ action: 'examine', evidenceId: 's1_ev0' }).success).toBe(true);
    expect(EscapeActionSchema.safeParse({ action: 'mark', ghost: 'wisp' }).success).toBe(true);
    expect(EscapeActionSchema.safeParse({ action: 'mark', ghost: 'unknown' }).success).toBe(false);
    expect(EscapeActionSchema.safeParse({ action: 'mark', ghost: 'wisp', extra: 1 }).success).toBe(false);
    expect(EscapeActionSchema.safeParse({ action: 'examine', evidenceId: 'Bad Id' }).success).toBe(false);
  });
  it('the public journal carries evidence kinds and marks, and the schema has no field for the true type', () => {
    const ok = EscapePublicSchema.safeParse({
      doors: [], keypads: [], safes: [], clues: [], switches: [],
      evidence: [{ id: 'e0', room: 'a', x: 1, y: 2, examined: true }],
      journal: { entries: [{ id: 'e0', kind: 'cold_breath' }], marks: ['wisp'], lines: 1 },
    });
    expect(ok.success).toBe(true);
    if (ok.success) expect(JSON.stringify(ok.data)).not.toMatch(/"ghost"/);
  });
});
