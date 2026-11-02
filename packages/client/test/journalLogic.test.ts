import { describe, expect, it } from 'vitest';
import { JOURNAL, type EscapePublic } from '@wb/shared';
import { JOURNAL_RULES, journalHeader, journalRows, markCheck } from '../src/ui/journalLogic';
import { usablesIn, usePrompt, useIntent } from '../src/ui/escapeUse';

type Journal = NonNullable<EscapePublic['journal']>;
const J = (o: Partial<Journal> = {}): Journal => ({ entries: [], marks: [], lines: 1, ...o });

describe('P3F step 3: the journal screen logic', () => {
  it('lists every type with its evidence, marking what the team examined', () => {
    const rows = journalRows(J({ entries: [{ id: 'e0', kind: 'cold_breath' }] }));
    expect(rows.map((r) => r.ghost)).toEqual(['wisp', 'shade', 'howler']);
    const wisp = rows.find((r) => r.ghost === 'wisp')!;
    expect(wisp.evidence.some((e) => e.seen)).toBe(true);
    expect(rows.find((r) => r.ghost === 'shade')!.evidence.every((e) => !e.seen)).toBe(true);
    for (const r of rows) expect(r.counter.length).toBeGreaterThan(10);
  });
  it('the header counts lines and findings; the rules state the reward and the cost', () => {
    expect(journalHeader(J({ marks: ['wisp'], lines: 2, entries: [{ id: 'e0', kind: 'cold_breath' }] }))).toContain('1/2');
    expect(JOURNAL_RULES).toContain(String(JOURNAL.wrongCost));
  });
  it('markCheck mirrors the server: examine first, no repeat, no more than the lines', () => {
    expect(markCheck(J(), 'wisp')).toEqual({ ok: false, reason: 'Examine some traces first.' });
    const seen = [{ id: 'e0', kind: 'cold_breath' as const }];
    expect(markCheck(J({ entries: seen }), 'wisp')).toEqual({ ok: true });
    expect(markCheck(J({ entries: seen, marks: ['wisp'], lines: 2 }), 'wisp').ok).toBe(false);
    expect(markCheck(J({ entries: seen, marks: ['wisp'] }), 'shade').ok).toBe(false);
  });
  it('traces in the room can be examined with E, and they show no ghost type', () => {
    const es: EscapePublic = { doors: [], keypads: [], safes: [], clues: [], switches: [], evidence: [{ id: 'e0', room: 'a', x: 5, y: 6, examined: false }, { id: 'e1', room: 'b', x: 5, y: 6, examined: false }] };
    const uses = usablesIn('a', es, undefined);
    expect(uses.length).toBe(1);
    expect(usePrompt(uses[0]!, 0)).toContain('examine');
    expect(useIntent(uses[0]!)).toEqual({ action: 'examine', evidenceId: 'e0' });
  });
});
