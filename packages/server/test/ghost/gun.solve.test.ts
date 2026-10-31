import { describe, expect, it } from 'vitest';
import { Room } from '../../src/room';
import { generateEscapeStage } from '../../src/rooms/generate';
import { Bot, Team } from '../rooms/bot';
import { digits, esc, expectOk, fetchItem, itemAct, type Play } from '../rooms/flows';
import { solveStage } from '../rooms/solver';
import type { Difficulty } from '@wb/shared';
import { HideTeam } from './hideTeam';
import { drill } from '../death/drill';

/** Start a real ghost run at `stage`, take the Pulse Gun out of its locker or safe (reading the notes for a safe), then clear the stage carrying it. */
function playStage(stage: number, seed: number, players: number, difficulty: Difficulty = 'easy'): { carried: boolean; maxSlots: number; hides: number; catches: number } {
  const room = new Room('GSLV', 4, seed, { escape: true, ghost: true, startStage: stage });
  room.difficulty = difficulty;
  const ids = Array.from({ length: players }, (_, i) => `p${i}`);
  ids.forEach((id, i) => { room.join(id, `P${i}`); if (i > 0) room.setReady(id, true); });
  if (!room.start('p0').ok) throw new Error('start refused');
  for (let i = 0; i < 20 && room.phase !== 'playing'; i++) room.tick();
  // P4: these tests measure that the GENERATED STAGE can be solved with the gun in hand, not that a bot survives the ghost (touch is death now;
  // test/death/solve.test.ts is where the lethal solver lives). The ghost is still present, hunts and is seen: it just cannot kill here.
  room.deathSystem?.setLethal(false);
  const rec = room.stageRecord!;
  const def = generateEscapeStage(rec.stage, rec.seed, { ghost: true, difficulty });
  if (def.id !== rec.defId) throw new Error('room and generator disagree');
  const arenas = new Map(def.rooms!.rooms.map((r) => [r.id, r.arena]));
  const team = new Team(room, (id) => arenas.get(id)!);
  const play: Play = { room, team, bots: ids.map((id) => new Bot(team, id)), ids, arenas };
  team.tick();
  const bot = play.bots[0]!;
  const gun = def.items!.find((i) => i.kind === 'pulse_gun')!;
  const safe = def.escape!.safes.find((s) => s.contains === gun.id);
  if (safe) {
    for (const id of safe.clueIds) {
      const c = def.escape!.clues.find((x) => x.id === id)!;
      bot.goTo(c.x, c.y);
      expectOk(esc(play, { action: 'read', clueId: id }, 'p0'));
    }
    const code = team.notes.slice(-safe.clueIds.length).map((n) => digits(n.text)).join('');
    bot.goTo(safe.x, safe.y);
    expectOk(esc(play, { action: 'enter_code', targetId: safe.id, code }, 'p0'));
  } else {
    const st = def.stashes!.find((s) => s.id === gun.hidden!.stashId)!;
    bot.goTo(st.x, st.y);
    expectOk(itemAct(play, { action: 'open', stashId: st.id }, 'p0'));
  }
  expectOk(fetchItem(play, bot, gun.id, 'p0'));
  const holds = team.state().items!.players.find((p) => p.id === 'p0')!.slotsUsed;
  // the solver's own Team starts without a state, and mine already consumed the last one: drop and re-take the gun so a fresh change is waiting for it
  expectOk(itemAct(play, { action: 'drop', itemId: gun.id }, 'p0'));
  team.idle(40);
  expectOk(room.itemAction('p0', { action: 'pickup', itemId: gun.id }));
  let hide: HideTeam | null = null;
  const stats = solveStage(room, ids, def, { coop: players > 1, team: (r, arenaOf) => (hide = new HideTeam(r, arenaOf, def.escape!.hidingSpots ?? [])) });
  return { carried: holds === 1, maxSlots: stats.maxSlots, hides: (hide as HideTeam | null)?.hides ?? 0, catches: (hide as HideTeam | null)?.catches ?? 0 };
}

describe('generated ghost stages stay solvable with the gun in hand', () => {
  const CASES: [number, number][] = [[2, 3], [3, 9], [4, 21], [5, 7], [6, 11], [8, 5], [10, 2]];
  for (const [stage, seed] of CASES) {
    it(`stage ${stage} seed ${seed}: one player, two slots`, () => {
      const r = playStage(stage, seed, 1);
      expect(r.carried).toBe(true);
      expect(r.maxSlots).toBeLessThanOrEqual(2);
    });
  }
  it('two to four players clear a gun stage together', () => {
    for (const n of [2, 3, 4]) {
      const r = playStage(6, 11, n);
      expect(r.carried).toBe(true);
      expect(r.maxSlots).toBeLessThanOrEqual(2);
    }
  });
});

// P4 step 5: the ghost is present and hunts here but cannot kill (touch is death now, see `setLethal` above): these tests prove the GENERATED STAGE can be solved with
// the ghost around, so they are exact (every seed). What a bot does when the ghost can really kill is in test/death/solve.test.ts, strict where it is a property of the
// stage and labelled STATISTICAL where it is a property of the bot.
describe('the ghost is present while the stage is solved (a bot that hides when warned; the ghost cannot kill here)', () => {
  type Outcome = { cleared: boolean; error: string; maxSlots: number; hides: number; catches: number };
  const attempt = (stage: number, seed: number, players: number, difficulty: Difficulty): Outcome => {
    try {
      const r = playStage(stage, seed, players, difficulty);
      return { cleared: true, error: '', maxSlots: r.maxSlots, hides: r.hides, catches: r.catches };
    } catch (e) {
      return { cleared: false, error: e instanceof Error ? e.message : String(e), maxSlots: 0, hides: 0, catches: -1 };
    }
  };
  const SEEDS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
  const LONG = 600_000;
  it('stage 20 (two ghosts from here): one player clears every seed within 2 slots, and the ghosts showed up', () => {
    const outs = SEEDS.map((seed) => attempt(20, seed, 1, 'easy'));
    expect(outs.filter((o) => o.cleared).length).toBe(SEEDS.length);
    for (const o of outs) expect(o.maxSlots).toBeLessThanOrEqual(2);
    expect(outs.reduce((n, o) => n + o.hides, 0)).toBeGreaterThan(0);
  }, LONG);
  it('stage 29 (the longest stages, five rooms): the stage clears every seed without the reflex; with it, a run clears or is stopped by the reflex itself', () => {
    const outs = SEEDS.map((seed) => attempt(29, seed, 1, 'easy'));
    // the STAGE: the same seeds without the hiding reflex all clear (exact)
    SEEDS.forEach((seed, i) => { if (!outs[i]!.cleared) expect(drill(29, seed, 1, {}).cleared, `seed ${seed} without the reflex`).toBe(true); });
    // the BOT: most runs clear; a failure is only ever the reflex pulling the player off a walk or a hold in a world where the ghost cannot kill
    expect(outs.filter((o) => o.cleared).length).toBeGreaterThanOrEqual(SEEDS.length - 3);
    for (const o of outs) if (o.cleared) expect(o.maxSlots).toBeLessThanOrEqual(2);
  }, LONG);
  it('hardcore stage 12 (the Howler alone): the stage clears every seed without the reflex; with it, a run clears or is stopped by the reflex itself', () => {
    const outs = SEEDS.map((seed) => attempt(12, seed, 1, 'hardcore'));
    SEEDS.forEach((seed, i) => { if (!outs[i]!.cleared) expect(drill(12, seed, 1, { difficulty: 'hardcore' }).cleared, `seed ${seed} without the reflex`).toBe(true); });
    expect(outs.filter((o) => o.cleared).length).toBeGreaterThanOrEqual(SEEDS.length - 3);
  }, LONG);
  it('two to four players clear a stage with two ghosts around: the stage always (no reflex), and with the hiding reflex every failure is the reflex itself, never the stage', () => {
    for (const n of [2, 3, 4]) {
      // the STAGE: the same seeds, the same ghosts, no hiding reflex: every run clears within 2 slots (exact)
      for (const seed of [1, 2, 3, 4, 5]) {
        const r = drill(20, seed, n, {});
        expect(r.cleared, `n=${n} seed=${seed}: ${r.error}`).toBe(true);
        expect(r.maxSlots).toBeLessThanOrEqual(2);
      }
      // the BOT: the hiding reflex waits for a threat to pass, and a ghost that cannot kill (this harness) never gives up hunting a hidden player, so with three or four
      // bots the reflex can time out. Exact classification: a run clears, or ends in that timeout; nothing else.
      const outs = [1, 2, 3, 4, 5].map((seed) => attempt(20, seed, n, 'easy'));
      for (const o of outs) {
        if (o.cleared) expect(o.maxSlots).toBeLessThanOrEqual(2);
        else expect(o.error).toBe('hide detour did not end');
      }
      expect(outs.filter((o) => o.cleared).length).toBeGreaterThan(0); // the reflex does not stop every run
    }
  }, LONG);
});
