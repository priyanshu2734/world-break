import { describe, expect, it } from 'vitest';
import { Room } from '../../src/room';
import { generateEscapeStage } from '../../src/rooms/generate';
import { Bot, Team } from '../rooms/bot';
import { digits, esc, expectOk, fetchItem, itemAct, type Play } from '../rooms/flows';
import { solveStage } from '../rooms/solver';
import type { Difficulty } from '@wb/shared';
import { HideTeam } from './hideTeam';

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

describe('the ghost is really present while the stage is solved (a bot that hides when warned)', () => {
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
  it('stage 29 (the longest stages, five rooms): the bot clears most seeds; a failure only ever follows a catch that dropped a part (a bot is not a person)', () => {
    const outs = SEEDS.map((seed) => attempt(29, seed, 1, 'easy'));
    expect(outs.filter((o) => o.cleared).length).toBeGreaterThanOrEqual(7);
    for (const o of outs) if (o.cleared) expect(o.maxSlots).toBeLessThanOrEqual(2);
  }, LONG);
  it('hardcore stage 12 (the Howler alone): one player clears most seeds', () => {
    const outs = SEEDS.map((seed) => attempt(12, seed, 1, 'hardcore'));
    expect(outs.filter((o) => o.cleared).length).toBeGreaterThanOrEqual(8);
  }, LONG);
  it('two to four players clear a stage with two ghosts around', () => {
    for (const n of [2, 3, 4]) {
      const outs = [1, 2, 3, 4, 5].map((seed) => attempt(20, seed, n, 'easy'));
      // the interim capture drops what a caught player carries and the bot does not go back for it, so more players means more lost keys
      expect(outs.filter((o) => o.cleared).length).toBeGreaterThanOrEqual(n === 2 ? 4 : 2);
      for (const o of outs) if (o.cleared) expect(o.maxSlots).toBeLessThanOrEqual(2);
    }
  }, LONG);
});
