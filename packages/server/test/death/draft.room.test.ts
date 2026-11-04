import { describe, expect, it } from 'vitest';
import { IDENTIFY_TEACH_LINE, TEACH_TICKS, UPGRADES, WIPE, effectsOf, type Difficulty, type UpgradeId } from '@wb/shared';
import { Room } from '../../src/room';
import type { GameSim } from '../../src/game';

/** P3F step 4 through the Room: the draft after a cleared stage, the upgrades' life across stages and wipes, and the teaching line for a player with little time in the stage. */
let seq = 0;
function mk(players = 2, difficulty: Difficulty = 'easy', startStage = 2, seed = 9): Room {
  const r = new Room('DRFT', 3, seed, { escape: true, ghost: true, startStage });
  r.difficulty = difficulty;
  for (let i = 0; i < players; i++) r.join(`p${i}`, `P${i}`);
  for (let i = 1; i < players; i++) r.setReady(`p${i}`, true);
  expect(r.start('p0').ok).toBe(true);
  for (let i = 0; i < 10 && r.phase !== 'playing'; i++) r.tick();
  return r;
}
const sim = (r: Room) => (r as unknown as { sim: GameSim }).sim;
const at = (r: Room, id: string, x: number) => sim(r).placeAt(id, x, 680);
const tick = (r: Room, n = 1) => { for (let i = 0; i < n; i++) r.tick(); };
const me = (r: Room, id: string) => r.gameSnapshot()!.players.find((p) => p.id === id)!;
const idle = (r: Room, id: string) => r.submitInput(id, ++seq, { moveX: 0, jump: false }, { use: false });
/** Clear stage 2 (the exit of the first rooms stages is at x = 1800 for everyone on the early stages). */
function clear(r: Room, ids: string[]): void {
  for (const id of ids) at(r, id, 1800);
  tick(r, 3);
  expect(r.phase).toBe('stage_complete');
}
const upgradesOf = (r: Room): Record<string, number> => Object.fromEntries((r.snapshot().upgrades ?? []).map((u) => [u.id, u.count]));
function kill(r: Room, id: string): void {
  for (let i = 0; i < 1500 && !r.deathSystem!.isDead(id); i++) {
    if (i % 100 === 0) { const q = me(r, id); r.ghostSystem!.placeForTest('g0', { room: q.roomId!, x: q.x - 60, y: q.y - 22, angle: 0, state: 'hunting' }); }
    idle(r, id); tick(r);
  }
  expect(r.deathSystem!.isDead(id)).toBe(true);
}

describe('P3F step 4: the draft', () => {
  it('a cleared stage offers three different upgrades; nothing is offered while playing', () => {
    const r = mk(2);
    expect(r.snapshot().draft).toBeUndefined();
    clear(r, ['p0', 'p1']);
    const d = r.snapshot().draft!;
    expect(d.options.length).toBe(3);
    expect(new Set(d.options.map((o) => o.id)).size).toBe(3);
    for (const o of d.options) { expect(UPGRADES[o.id as UpgradeId]).toBeDefined(); expect(o.votes).toBe(0); }
    expect(d.picked).toBeUndefined();
    expect(r.snapshot().upgrades).toBeUndefined();
  });
  it('the team votes; when everyone has voted the pick is made and kept; a second vote is refused', () => {
    const r = mk(2);
    clear(r, ['p0', 'p1']);
    const offer = r.snapshot().draft!.options.map((o) => o.id);
    expect(r.draftVote('p0', 2).ok).toBe(true);
    expect(r.snapshot().draft!.picked).toBeUndefined();
    expect(r.snapshot().draft!.options[2]!.votes).toBe(1);
    expect(r.draftVote('p1', 2).ok).toBe(true);
    expect(r.snapshot().draft!.picked).toBe(offer[2]);
    expect(upgradesOf(r)).toEqual({ [offer[2]!]: 1 });
    expect(r.draftVote('p0', 0).ok).toBe(false);
    expect(upgradesOf(r)).toEqual({ [offer[2]!]: 1 });
  });
  it('refuses a vote that is not 0-2, from a stranger, or outside a cleared stage', () => {
    const r = mk(2);
    expect(r.draftVote('p0', 0).ok).toBe(false); // playing
    clear(r, ['p0', 'p1']);
    for (const bad of [3, -1, 1.5, Number.NaN]) expect(r.draftVote('p0', bad).ok).toBe(false);
    expect(r.draftVote('zzz', 0).ok).toBe(false);
    expect(r.snapshot().draft!.options.every((o) => o.votes === 0)).toBe(true);
  });
  it('the host going on settles the draft: the most votes win, a tie goes to the first listed, no vote at all to the first', () => {
    const a = mk(2); clear(a, ['p0', 'p1']);
    const offerA = a.snapshot().draft!.options.map((o) => o.id);
    a.draftVote('p1', 1);
    expect(a.nextStage('p0').ok).toBe(true);
    expect(upgradesOf(a)).toEqual({ [offerA[1]!]: 1 });
    expect(a.snapshot().draft).toBeUndefined();
    const b = mk(2); clear(b, ['p0', 'p1']);
    const offerB = b.snapshot().draft!.options.map((o) => o.id);
    expect(b.nextStage('p0').ok).toBe(true);
    expect(upgradesOf(b)).toEqual({ [offerB[0]!]: 1 });
  });
  it('the pick is kept on the next stage and its effect is in force (bounded)', () => {
    const r = mk(1);
    clear(r, ['p0']);
    const pick = r.snapshot().draft!.options[0]!.id as UpgradeId;
    r.draftVote('p0', 0);
    expect(r.nextStage('p0').ok).toBe(true);
    expect(r.stage).toBe(3);
    expect(upgradesOf(r)).toEqual({ [pick]: 1 });
    expect(r.effects).toEqual(effectsOf({ [pick]: 1 }));
  });
  it('upgrades after a wipe: kept on Easy, the newest is lost on Hardcore, and a new run starts with none', () => {
    for (const diff of ['easy', 'hardcore'] as const) {
      const r = mk(1, diff);
      clear(r, ['p0']);
      r.draftVote('p0', 0);
      expect(r.nextStage('p0').ok).toBe(true);
      for (let i = 0; i < 10 && r.phase !== 'playing'; i++) tick(r);
      at(r, 'p0', 600);
      kill(r, 'p0');
      for (let i = 0; i < 400 && r.phase === 'playing'; i++) tick(r);
      for (let i = 0; i < WIPE.beatTicks + 5 && r.phase === 'team_wiped'; i++) tick(r);
      expect(r.phase).toBe('death_review');
      expect(r.retryStage('p0').ok).toBe(true);
      expect(Object.keys(upgradesOf(r)).length, diff).toBe(diff === 'easy' ? 1 : 0);
    }
  });
  it('stage 1,000,000 offers a draft that is a pure function of the run seed', () => {
    const offer = (): string[] => {
      const r = mk(1, 'easy', 1_000_000);
      (r as unknown as { phase: string }).phase = 'stage_complete'; // the stage's exit is far away; the draft only needs the cleared state
      (r as unknown as { openDraft(): void }).openDraft();
      return r.snapshot().draft!.options.map((o) => o.id);
    };
    const a = offer();
    expect(a.length).toBe(3);
    expect(offer()).toEqual(a);
  });
});

describe('P3F step 4: the teaching line reaches whoever has had little time since the ghosts stopped being named', () => {
  it('everyone is sent it at first; a player who was away for the whole time still has it after the others stop getting it', () => {
    const r = mk(2, 'easy', 7);
    expect(r.viewFor('p0')!.stage.escape?.journal?.teach).toBe(IDENTIFY_TEACH_LINE);
    r.disconnect('p1');
    tick(r, TEACH_TICKS + 20);
    expect(r.viewFor('p0')?.stage.escape?.journal?.teach).toBeUndefined(); // p0 has had it long enough
    const taught = (r as unknown as { taught: Map<string, number> }).taught;
    expect(taught.get('p1') ?? 0).toBeLessThan(TEACH_TICKS); // p1 has not: nothing counted while away
  });
});
