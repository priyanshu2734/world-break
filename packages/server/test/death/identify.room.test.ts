import { describe, expect, it } from 'vitest';
import { IDENTIFY_TEACH_LINE } from '@wb/shared';
import { Room } from '../../src/room';
import { restrictedView } from '../../src/rooms/view';

/** P3F step 3 through the Room: the teaching line, the journal on the stage state, and a death review that never names the type. */
function mk(stage: number): Room {
  const r = new Room('IDEN', 3, 9, { escape: true, ghost: true, startStage: stage });
  r.join('p0', 'P0');
  expect(r.start('p0').ok).toBe(true);
  for (let i = 0; i < 10 && r.phase !== 'playing'; i++) r.tick();
  return r;
}
const feedText = (r: Room): string[] => (r.peekStageState()?.feed ?? []).map((f) => f.text);

describe('P3F step 3: through the Room', () => {
  it('the first stage that stops naming the ghost says so once, before anything can happen', () => {
    const r7 = mk(7);
    expect(r7.phase).toBe('playing');
    expect(feedText(r7)).toContain(IDENTIFY_TEACH_LINE);
    const r6 = mk(6);
    expect(feedText(r6)).not.toContain(IDENTIFY_TEACH_LINE);
  });
  it('a ghost stage carries the team journal with one line per ghost, and no marks yet', () => {
    const r = mk(7);
    const j = r.peekStageState()!.escape!.journal!;
    expect(j.lines).toBe(1);
    expect(j.marks).toEqual([]);
    expect(j.entries).toEqual([]);
    expect(r.peekStageState()!.escape!.evidence!.length).toBeGreaterThanOrEqual(2);
    expect(JSON.stringify(r.peekStageState()!.escape)).not.toMatch(/"ghost"/);
  });
  it('a mark before anything is examined is refused by the server', () => {
    const r = mk(7);
    const res = r.escapeAction('p0', { action: 'mark', ghost: 'wisp' });
    expect(res.ok).toBe(false);
  });
  it('the ghost stage at stage 1,000,000 still starts with a journal', () => {
    const r = mk(1_000_000);
    expect(r.peekStageState()!.escape!.journal!.lines).toBeGreaterThanOrEqual(1);
    expect(r.peekStageState()!.escape!.journal!.lines).toBeLessThanOrEqual(2);
  });
});

describe('P3F step 3: who is told what', () => {
  it('a living player gets the team journal and only the traces in view; a spectator gets neither', () => {
    const r = mk(7);
    const v = r.viewFor('p0')!;
    expect(v.stage.escape?.journal?.lines).toBe(1);
    const all = r.peekStageState()!.escape!.evidence!;
    expect((v.stage.escape?.evidence ?? []).length).toBeLessThanOrEqual(all.length);
    // a viewer with nothing in view of a trace in another room is never told its position
    const e = (r as unknown as { engine: { state(): never; def: { rooms: never } } }).engine;
    const base = { snapshot: r.gameSnapshot()!, stage: e.state(), graph: e.def.rooms, radius: 460 };
    const spec = restrictedView(base, { eyes: 'p0', self: 'p0', spectator: true, fly: true });
    expect(spec.stage.escape).toBeUndefined();
    expect(JSON.stringify(spec.stage)).not.toMatch(/journal|evidence/);
  });
});
