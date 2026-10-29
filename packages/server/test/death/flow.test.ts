import { describe, expect, it } from 'vitest';
import { DeathReviewMsgSchema, WIPE, type Difficulty } from '@wb/shared';
import { Room } from '../../src/room';
import type { GameSim } from '../../src/game';
import { DEATH_TABLE, deathTuning } from '../../src/death';

let seq = 0;
function mk(players = 2, difficulty: Difficulty = 'easy', startStage = 2, seed = 9): Room {
  const r = new Room('DETH', 3, seed, { escape: true, ghost: true, startStage });
  r.difficulty = difficulty;
  for (let i = 0; i < players; i++) r.join(`p${i}`, `P${i}`);
  for (let i = 1; i < players; i++) r.setReady(`p${i}`, true);
  expect(r.start('p0').ok).toBe(true);
  for (let i = 0; i < 10 && r.phase !== 'playing'; i++) r.tick();
  return r;
}
const sim = (r: Room) => (r as unknown as { sim: GameSim }).sim;
const at = (r: Room, id: string, x: number) => sim(r).placeAt(id, x, 680);
const me = (r: Room, id: string) => r.gameSnapshot()!.players.find((p) => p.id === id)!;
const roomOf = (r: Room, id = 'p0') => me(r, id).roomId!;
const idle = (r: Room, id: string, use = false) => r.submitInput(id, ++seq, { moveX: 0, jump: false }, { use });
const tick = (r: Room, n = 1) => { for (let i = 0; i < n; i++) r.tick(); };
const itemsOf = (r: Room) => r.peekStageState()!.items!.items;
function kill(r: Room, id: string): void {
  for (let i = 0; i < 1500 && !r.deathSystem!.isDead(id); i++) {
    if (i % 100 === 0) { const q = me(r, id); r.ghostSystem!.placeForTest('g0', { room: roomOf(r, id), x: q.x - 60, y: q.y - 22, angle: 0, state: 'hunting' }); }
    idle(r, id); tick(r);
  }
  expect(r.deathSystem!.isDead(id)).toBe(true);
}
/** Run until the room leaves `playing` (a wipe), then through the wipe beat into the review. */
function toReview(r: Room): void {
  for (let i = 0; i < 400 && r.phase === 'playing'; i++) tick(r);
  expect(r.phase).toBe('team_wiped');
  for (let i = 0; i < WIPE.beatTicks + 5 && r.phase === 'team_wiped'; i++) tick(r);
  expect(r.phase).toBe('death_review');
}
function soloWipe(startStage = 2, seed = 9): Room {
  const r = mk(1, 'easy', startStage, seed);
  at(r, 'p0', 600);
  kill(r, 'p0');
  toReview(r);
  return r;
}

describe('P4 step 4: team wipe, review, retry', () => {
  it('a solo death goes TEAM_WIPE -> REVIEW through the existing machine, after a 3 s beat; the review waits for the host', () => {
    const r = mk(1);
    at(r, 'p0', 600);
    kill(r, 'p0');
    for (let i = 0; i < 400 && r.phase === 'playing'; i++) tick(r);
    expect(r.phase).toBe('team_wiped');
    tick(r, WIPE.beatTicks - 1);
    expect(r.phase).toBe('team_wiped');
    expect(r.reviewFor('p0')).toBeNull(); // not yet
    tick(r, 1);
    expect(r.phase).toBe('death_review');
    tick(r, 500);
    expect(r.phase).toBe('death_review'); // it does not move on its own
    expect(r.reviewFor('p0')).not.toBeNull();
  });
  it('the SAME stage number restarts on a NEW seed, on the same difficulty; never stage 1; everyone alive, hands empty, free to move', () => {
    const r = soloWipe();
    const first = { ...r.stageRecord! };
    expect(first).toMatchObject({ stage: 2, attempt: 0 });
    expect(r.retryStage('p0')).toEqual({ ok: true });
    expect(r.phase).toBe('briefing');
    expect(r.stage).toBe(2);
    const second = r.stageRecord!;
    expect(second.stage).toBe(2);
    expect(second.attempt).toBe(1);
    expect(second.seed).not.toBe(first.seed);
    expect(second.fallback).toBe(false);
    expect(second.defId).toBe('escape_2');
    expect(r.difficulty).toBe('easy');
    for (let i = 0; i < 10 && r.phase !== 'playing'; i++) tick(r);
    expect(r.phase).toBe('playing');
    expect(r.deathSystem!.lifeOf('p0')).toBe('alive');
    expect(r.deathSystem!.events).toEqual([]);
    expect(itemsOf(r).filter((i) => i.carrierId)).toEqual([]);
    expect(idle(r, 'p0')).toBe(true);
    expect(r.reviewFor('p0')).toBeNull();
    // a second wipe and retry gives a third seed
    at(r, 'p0', 600); kill(r, 'p0'); toReview(r);
    expect(r.retryStage('p0').ok).toBe(true);
    expect(r.stageRecord!.attempt).toBe(2);
    expect(new Set([first.seed, second.seed, r.stageRecord!.seed]).size).toBe(3);
  });
  it('is deterministic: the same run seed retries to the same new seed; a different run seed to a different one; the first try keeps the seed it always had', () => {
    const a = soloWipe(2, 9), b = soloWipe(2, 9), c = soloWipe(2, 10);
    a.retryStage('p0'); b.retryStage('p0'); c.retryStage('p0');
    expect(a.stageRecord!.seed).toBe(b.stageRecord!.seed);
    expect(a.stageRecord!.seed).not.toBe(c.stageRecord!.seed);
    expect(mk(1).stageRecord!.seed).toBe(mk(1).stageRecord!.seed);
  });
  it('stage 1,000,000: a wipe retries stage 1,000,000 on a new seed; the numbers of death are the same there', () => {
    const r = soloWipe(1_000_000, 5);
    expect(r.stage).toBe(1_000_000);
    const first = r.stageRecord!.seed;
    expect(r.retryStage('p0')).toEqual({ ok: true });
    expect(r.stage).toBe(1_000_000);
    expect(r.stageRecord).toMatchObject({ stage: 1_000_000, attempt: 1, fallback: false });
    expect(r.stageRecord!.seed).not.toBe(first);
    expect(deathTuning('easy', 1_000_000)).toEqual(deathTuning('easy', 1));
    for (let i = 0; i < 10 && r.phase !== 'playing'; i++) tick(r);
    expect(r.deathSystem!.lifeOf('p0')).toBe('alive');
    expect(r.nextStage('p0').ok).toBe(false); // not cleared: no next stage from here
  });
  it('retry is refused outside the review, by a non-host while the host is connected, by a stranger, and (nothing changes) twice', () => {
    const live = mk(2);
    expect(live.retryStage('p0')).toEqual({ ok: false, error: 'There is no review to retry from' });
    const r = mk(2);
    at(r, 'p0', 600); at(r, 'p1', 700);
    kill(r, 'p0'); tick(r, 100); kill(r, 'p1');
    toReview(r);
    expect(r.retryStage('p1')).toEqual({ ok: false, error: 'Only the host can retry the stage' });
    expect(r.retryStage('zzz')).toEqual({ ok: false, error: 'Not in room' });
    expect(r.phase).toBe('death_review');
    expect(r.retryStage('p0').ok).toBe(true);
    expect(r.retryStage('p0')).toEqual({ ok: false, error: 'There is no review to retry from' });
    expect(r.stageRecord!.attempt).toBe(1);
  });
});

describe('P4 step 4: the stage goes on while somebody lives, and is cleared when one reaches the exit', () => {
  it('two players: one dies, the stage continues; the survivor reaches the exit: STAGE_CLEAR, no no-deaths bonus; everyone returns for the next stage alive, hands empty', () => {
    const r = mk(2);
    at(r, 'p0', 600); at(r, 'p1', 300);
    const key = itemsOf(r).find((i) => i.kind === 'access_key')!;
    at(r, 'p0', key.x); tick(r, 25);
    r.itemAction('p0', { action: 'pickup', itemId: key.id }); tick(r, 15);
    kill(r, 'p0'); tick(r, 100);
    expect(r.phase).toBe('playing');
    at(r, 'p1', 1800); tick(r, 3);
    expect(r.phase).toBe('stage_complete');
    expect(r.peekStageState()!.score.breakdown['no_deaths']).toBeUndefined();
    expect(r.nextStage('p0')).toEqual({ ok: true }); // the dead host may start it
    expect(r.stage).toBe(3);
    expect(r.stageRecord!.attempt).toBe(0);
    for (let i = 0; i < 10 && r.phase !== 'playing'; i++) tick(r);
    expect(r.deathSystem?.lifeOf('p0') ?? 'alive').toBe('alive');
    expect(itemsOf(r).filter((i) => i.carrierId)).toEqual([]);
    expect(idle(r, 'p0')).toBe(true); // the dead player moves again
    expect(r.deathState('p0')).toMatchObject({ life: 'alive', following: null });
  });
  it('nobody died: the clear pays the no-deaths bonus; a revived death does not earn it', () => {
    const r = mk(2);
    at(r, 'p0', 300); at(r, 'p1', 1800); tick(r, 3);
    expect(r.phase).toBe('stage_complete');
    expect(r.peekStageState()!.score.breakdown['no_deaths']).toBe(DEATH_TABLE.noDeathBonus);
    const q = mk(2);
    at(q, 'p0', 600); at(q, 'p1', 300);
    kill(q, 'p0');
    q.deathSystem!.revive('p0', 'p1');
    at(q, 'p1', 1800); tick(q, 3);
    expect(q.phase).toBe('stage_complete');
    expect(q.peekStageState()!.score.breakdown['no_deaths']).toBeUndefined();
  });
  it('a body standing in the exit does not clear the stage; a living teammate there does', () => {
    const r = mk(2);
    at(r, 'p0', 600); at(r, 'p1', 300);
    kill(r, 'p0');
    r.deathSystem!.setLethal(false);
    sim(r).placeAt('p0', 1800, 680); // the body is moved there (a test): it must not count
    tick(r, 10);
    expect(r.phase).toBe('playing');
    at(r, 'p1', 1800); tick(r, 3);
    expect(r.phase).toBe('stage_complete');
  });
  it('the exit reached on the same tick as a death: the exit wins, nobody dies, the stage is cleared (for every offset of the touch)', () => {
    const outcomes: string[] = [];
    for (let k = 0; k <= deathTuning('easy').contactTicks + 3; k++) {
      const r = mk(2);
      at(r, 'p1', 300);
      tick(r, DEATH_TABLE.spawnGraceS * 20 + 5); // past the spawn grace
      at(r, 'p0', 1650);
      r.ghostSystem!.placeForTest('g0', { room: roomOf(r, 'p0'), x: 1650 - 30, y: 680 - 22, angle: 0, state: 'hunting' });
      for (let i = 0; i < k; i++) { idle(r, 'p0'); tick(r); }
      at(r, 'p0', 1800);
      idle(r, 'p0'); tick(r);
      outcomes.push(r.phase === 'stage_complete' ? 'clear' : r.deathSystem!.isDead('p0') ? 'dead' : 'other');
      if (r.phase === 'stage_complete') expect(r.deathSystem!.deaths).toBe(0);
    }
    // contactTicks = 6: the touch kills on the 6th tick of contact. Offsets 0..5 reach the exit on or before that tick (5 is the very same tick: the exit wins);
    // from offset 6 the kill came strictly first.
    const n = deathTuning('easy').contactTicks;
    expect(outcomes).toEqual(outcomes.map((_, k) => (k < n ? 'clear' : 'dead')));
    expect(outcomes.filter((o) => o === 'clear')).toHaveLength(n);
    expect(outcomes.filter((o) => o === 'dead').length).toBeGreaterThanOrEqual(3);
  });
});

describe('P4 step 4: disconnects', () => {
  it('the living leave while the rest are dead: the team is wiped and the review comes; the retry drops the ones who left and brings the dead back', () => {
    const r = mk(3);
    at(r, 'p0', 600); at(r, 'p1', 700); at(r, 'p2', 1500);
    kill(r, 'p0'); tick(r, 100); kill(r, 'p1');
    r.disconnect('p2');
    toReview(r);
    expect(r.reviewFor('p0')).not.toBeNull();
    expect(r.retryStage('p0').ok).toBe(true);
    for (let i = 0; i < 10 && r.phase !== 'playing'; i++) tick(r);
    expect(r.has('p2')).toBe(false);
    expect(r.deathSystem!.lifeOf('p0')).toBe('alive');
    expect(r.deathSystem!.lifeOf('p1')).toBe('alive');
    expect(idle(r, 'p0')).toBe(true);
    expect(idle(r, 'p1')).toBe(true);
  });
  it('the host leaves during the review: the next connected player becomes host and may retry; a dead player who disconnected stays dead and is not retried back in', () => {
    const r = mk(3);
    at(r, 'p0', 600); at(r, 'p1', 700); at(r, 'p2', 1500);
    kill(r, 'p0'); tick(r, 100); kill(r, 'p1'); tick(r, 100); kill(r, 'p2');
    r.disconnect('p1');
    expect(r.deathSystem!.isDead('p1')).toBe(true);
    toReview(r);
    r.disconnect('p0');
    expect(r.hostId).toBe('p2');
    expect(r.retryStage('p2').ok).toBe(true);
    expect(r.has('p0')).toBe(false);
    expect(r.has('p1')).toBe(false);
    expect(r.has('p2')).toBe(true);
  });
  it('a disconnected player cannot retry', () => {
    const r = soloWipe();
    r.disconnect('p0');
    expect(r.retryStage('p0')).toEqual({ ok: false, error: 'You are offline' });
  });
});
