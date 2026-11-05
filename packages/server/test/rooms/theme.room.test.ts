import { describe, expect, it } from 'vitest';
import { THEME_IDS, RoomSnapshotSchema, type ThemeId } from '@wb/shared';
import { Room } from '../../src/room';

/** P3F step 5: the theme reaches the clients in the room snapshot, follows the newness rule, and is never part of the stage definition (it cannot change a rule). */
function mk(seed: number, startStage = 1): Room {
  const r = new Room('THEM', 3, seed, { escape: true, ghost: true, startStage });
  r.join('p0', 'P0');
  return r;
}
function begin(r: Room): void {
  expect(r.start('p0').ok).toBe(true);
  for (let i = 0; i < 10 && r.phase !== 'playing'; i++) r.tick();
}
function advance(r: Room): void {
  (r as unknown as { phase: string }).phase = 'stage_complete';
  expect(r.nextStage('p0').ok).toBe(true);
  for (let i = 0; i < 10 && r.phase !== 'playing'; i++) r.tick();
  expect(r.phase).toBe('playing');
}

describe('P3F step 5: the theme in the room snapshot', () => {
  it('there is none in the lobby; stage 1 is the lab; every snapshot is valid', () => {
    const r = mk(5);
    expect(r.snapshot().theme).toBeUndefined();
    begin(r);
    expect(r.snapshot().theme).toBe('lab');
    expect(RoomSnapshotSchema.safeParse(r.snapshot()).success).toBe(true);
  });
  it('a theme never repeats the one before it across 25 stages, and all four themes appear', () => {
    for (const seed of [3, 9]) {
      const r = mk(seed);
      begin(r);
      const seen: ThemeId[] = [r.snapshot().theme!];
      for (let i = 0; i < 24; i++) { advance(r); seen.push(r.snapshot().theme!); }
      for (let i = 1; i < seen.length; i++) expect(seen[i], `seed ${seed} stage ${i + 1}`).not.toBe(seen[i - 1]);
      expect(new Set(seen).size).toBe(THEME_IDS.length);
    }
  });
  it('is the same for the same run seed (a pure function of the seed and the history), and works at stage 1,000,000', () => {
    const run = (): ThemeId[] => { const r = mk(7, 1_000_000); begin(r); const out = [r.snapshot().theme!]; for (let i = 0; i < 5; i++) { advance(r); out.push(r.snapshot().theme!); } return out; };
    const a = run();
    expect(run()).toEqual(a);
    for (const t of a) expect(THEME_IDS).toContain(t);
  });
  it('is not part of the stage definition: nothing a rule, the generator or the validators read mentions it', () => {
    const r = mk(4);
    begin(r);
    advance(r);
    expect(JSON.stringify(r.stageDef)).not.toMatch(/theme/i);
  });
});
