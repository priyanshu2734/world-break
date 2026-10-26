import { describe, expect, it } from 'vitest';
import { Room } from '../../src/room';
import { generateEscapeStage } from '../../src/rooms/generate';
import { Bot, Team } from '../rooms/bot';
import { digits, esc, expectOk, fetchItem, itemAct, type Play } from '../rooms/flows';
import { solveStage } from '../rooms/solver';

/** Start a real ghost run at `stage`, take the Pulse Gun out of its locker or safe (reading the notes for a safe), then clear the stage carrying it. */
function playStage(stage: number, seed: number, players: number): { carried: boolean; maxSlots: number } {
  const room = new Room('GSLV', 4, seed, { escape: true, ghost: true, startStage: stage });
  const ids = Array.from({ length: players }, (_, i) => `p${i}`);
  ids.forEach((id, i) => { room.join(id, `P${i}`); if (i > 0) room.setReady(id, true); });
  if (!room.start('p0').ok) throw new Error('start refused');
  for (let i = 0; i < 20 && room.phase !== 'playing'; i++) room.tick();
  const rec = room.stageRecord!;
  const def = generateEscapeStage(rec.stage, rec.seed, { ghost: true });
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
  const stats = solveStage(room, ids, def, { coop: players > 1 });
  return { carried: holds === 1, maxSlots: stats.maxSlots };
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
