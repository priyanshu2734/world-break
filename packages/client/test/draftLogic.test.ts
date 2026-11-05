import { describe, expect, it } from 'vitest';
import type { DraftPublic, EscapePublic } from '@wb/shared';
import { draftHeader, draftLines, voteFromKeys } from '../src/ui/draftLogic';
import { usablesIn, usePrompt, useIntent } from '../src/ui/escapeUse';

const D = (picked?: string): DraftPublic => ({
  stage: 3,
  options: [
    { id: 'wide_beam', name: 'Wide beam', text: 'See farther.', votes: 2 },
    { id: 'loud_lamp', name: 'Loud lamp', text: 'Brighter.', tradeoff: 'Ghosts hear more.', votes: 0 },
    { id: 'extra_hand', name: 'Extra hand', text: 'One more slot.', votes: 1 },
  ],
  ...(picked ? { picked } : {}),
} as DraftPublic);

describe('P3F step 4: the draft screen logic', () => {
  it('one line per option with the votes, the trade-off, the player\'s own vote and the pick', () => {
    const lines = draftLines(D(), 1);
    expect(lines.map((l) => l.key)).toEqual(['1', '2', '3']);
    expect(lines.map((l) => l.votes)).toEqual([2, 0, 1]);
    expect(lines.map((l) => l.mine)).toEqual([false, true, false]);
    expect(lines[1]!.tradeoff).toBe('Ghosts hear more.');
    expect(lines[0]!.tradeoff).toBeNull();
    expect(draftLines(D('extra_hand'), null).map((l) => l.picked)).toEqual([false, false, true]);
  });
  it('the header tells the host how to go on and everyone else to wait', () => {
    expect(draftHeader(D(), true)).toMatch(/N/);
    expect(draftHeader(D(), false)).not.toMatch(/\bN\b/);
    expect(draftHeader(D('wide_beam'), false)).toMatch(/waiting for the host/);
    expect(draftHeader(D('wide_beam'), true)).toMatch(/next stage/);
  });
  it('keys 1-3 vote, anything else does not, and a key beyond the offer is ignored', () => {
    expect(voteFromKeys([false, true, false], 3)).toBe(1);
    expect(voteFromKeys([false, false, false], 3)).toBeNull();
    expect(voteFromKeys([false, false, true], 2)).toBeNull();
    expect(voteFromKeys([true, true, false], 3)).toBe(0);
  });
});

describe('P3F step 4: the loot cache in the use prompt', () => {
  const base = { doors: [], keypads: [], safes: [], clues: [], switches: [] };
  const es = { ...base, loot: { id: 'l0', room: 'a', x: 500, y: 680, opened: false } } as unknown as EscapePublic;
  it('shows only in its room, warns that it is risky, and sends the loot intent once; opened, it offers nothing', () => {
    expect(usablesIn('b', es, undefined)).toEqual([]);
    const u = usablesIn('a', es, undefined).find((x) => x.kind === 'loot')!;
    expect(usePrompt(u, 0)).toMatch(/risky/);
    expect(useIntent(u)).toEqual({ action: 'loot', lootId: 'l0' });
    const done = usablesIn('a', { ...base, loot: { ...es.loot!, opened: true } } as unknown as EscapePublic, undefined).find((x) => x.kind === 'loot')!;
    expect(usePrompt(done, 0)).toMatch(/empty/);
    expect(useIntent(done)).toBeNull();
  });
});
