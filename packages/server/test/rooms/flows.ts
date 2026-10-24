import type { Arena, ItemAction } from '@wb/shared';
import { Room } from '../../src/room';
import { DEMO_AT, DEMO_CODE, DEMO_GRAPH, SAMPLER_AT, SAMPLER_COMBO, SAMPLER_GRAPH, SAMPLER_IDS } from '../../src/rooms/demoStage';
import { Bot, Team } from './bot';

export type Which = true | 2;
export interface Play { room: Room; team: Team; bots: Bot[]; ids: string[]; arenas: Map<string, Arena> }

/** A real Room on a dev stage, with `n` joined and ready players, started and past the briefing. */
export function setup(which: Which, n = 1): Play {
  const room = new Room('ABCD', 4, 7, { rooms: which });
  const ids = Array.from({ length: n }, (_, i) => `p${i}`);
  ids.forEach((id, i) => { room.join(id, `P${i}`); if (i > 0) room.setReady(id, true); });
  if (!room.start('p0').ok) throw new Error('start refused');
  for (let i = 0; i < 20 && room.phase !== 'playing'; i++) room.tick();
  const graph = which === 2 ? SAMPLER_GRAPH : DEMO_GRAPH;
  const arenas = new Map(graph.rooms.map((r) => [r.id, r.arena]));
  const team = new Team(room, (id) => arenas.get(id)!);
  team.tick();
  return { room, team, bots: ids.map((id) => new Bot(team, id)), ids, arenas };
}

/** Intents need a few ticks between them (the server rate-limits accepted and refused ones alike). */
const gap = (p: Play) => p.team.idle(5);

export function itemAct(p: Play, a: ItemAction, who = 'p0') { gap(p); return p.room.itemAction(who, a); }

export function esc(p: Play, a: Parameters<Room['escapeAction']>[1], who = 'p0') { gap(p); return p.team.escape(who, a); }

/** The item with this id as the public state lists it (undefined = not visible). */
export function seen(p: Play, id: string) { return p.team.state().items?.items.find((i) => i.id === id); }

/** Walk to a visible part and pick it up. */
export function fetchItem(p: Play, bot: Bot, id: string, who = 'p0') {
  const it = seen(p, id);
  if (!it) throw new Error(`${id} is not visible`);
  bot.goTo(it.x, it.y);
  return itemAct(p, { action: 'pickup', itemId: id }, who);
}

export const doorCenter = (p: Play, doorId: string): { room: string; x: number; y: number } => {
  for (const r of [...p.arenas.keys()]) {
    const g = (p.arenas.has(DEMO_GRAPH.start) ? DEMO_GRAPH : SAMPLER_GRAPH).rooms.find((x) => x.id === r)!;
    const d = g.doors.find((x) => x.id === doorId);
    if (d) return { room: r, x: d.x + d.w / 2, y: d.y + d.h };
  }
  throw new Error(`no door ${doorId}`);
};

/** Walk to a door and use it (E). Returns the intent result; the player is carried through after the opening delay. */
export function useDoor(p: Play, bot: Bot, doorId: string, who = 'p0') {
  const d = doorCenter(p, doorId);
  bot.goTo(d.x, d.y);
  return esc(p, { action: 'use_door', doorId }, who);
}

export const digits = (text: string): string => (text.match(/[0-9]/g) ?? []).join('');

// ----------------------------------------------------------------------------------------------------------------- whole solutions
/** Solve the 3-room mini escape with one player, from the start to standing in the exit zone. */
export function solveDemo(p: Play, bot: Bot): void {
  bot.goTo(DEMO_AT.locker.x, DEMO_AT.locker.y);
  expectOk(itemAct(p, { action: 'open', stashId: 'demo_locker' }));
  expectOk(fetchItem(p, bot, 'demo_key'));
  expectOk(useDoor(p, bot, DEMO_AT.doorA.id));
  p.team.waitForRoom('p0', DEMO_AT.clue.room);
  bot.goTo(DEMO_AT.clue.x, DEMO_AT.clue.y);
  const read = esc(p, { action: 'read', clueId: 'demo_log' });
  expectOk(read);
  bot.goTo(DEMO_AT.keypad.x, DEMO_AT.keypad.y);
  expectOk(esc(p, { action: 'enter_code', targetId: 'demo_keypad', code: digits(p.team.notes.at(-1)!.text) }));
  expectOk(useDoor(p, bot, DEMO_AT.doorB.id));
  p.team.waitForRoom('p0', DEMO_AT.exit.room);
  bot.goTo(DEMO_AT.exit.x, DEMO_AT.exit.y);
  p.team.idle(3);
  if (DEMO_CODE.length !== 4) throw new Error('demo code changed');
}

/** Solve the 6-room sampler (every lock type) with one player. */
export function solveSampler(p: Play, bot: Bot): void {
  const ids = SAMPLER_IDS, A = SAMPLER_AT;
  // 0: key
  bot.goTo(A.locker.x, A.locker.y);
  expectOk(itemAct(p, { action: 'open', stashId: 'smp_locker' }));
  expectOk(fetchItem(p, bot, 'smp_key'));
  expectOk(useDoor(p, bot, 'sampler.r0_e')); p.team.waitForRoom('p0', ids[1]!);
  // 1: code
  bot.goTo(A.codeClue.x, A.codeClue.y);
  expectOk(esc(p, { action: 'read', clueId: 'smp_code_clue' }));
  bot.goTo(A.keypad.x, A.keypad.y);
  expectOk(esc(p, { action: 'enter_code', targetId: 'smp_keypad', code: digits(p.team.notes.at(-1)!.text) }));
  expectOk(useDoor(p, bot, 'sampler.r1_e')); p.team.waitForRoom('p0', ids[2]!);
  // 2: power
  expectOk(fetchItem(p, bot, 'smp_battery'));
  expectOk(useDoor(p, bot, 'sampler.r2_e')); p.team.waitForRoom('p0', ids[3]!);
  // 3: two switches, one player running between them
  bot.goTo(A.switchA.x, A.switchA.y);
  expectOk(esc(p, { action: 'press', switchId: 'smp_sw_a' }));
  bot.goTo(A.switchB.x, A.switchB.y);
  expectOk(esc(p, { action: 'press', switchId: 'smp_sw_b' }));
  expectOk(useDoor(p, bot, 'sampler.r3_e')); p.team.waitForRoom('p0', ids[4]!);
  // 4: safe from three notes
  const before = p.team.notes.length;
  A.safeClues.forEach((c, n) => { bot.goTo(c.x, c.y); expectOk(esc(p, { action: 'read', clueId: `smp_s${n + 1}` })); });
  const combo = p.team.notes.slice(before).map((n) => digits(n.text)).join('');
  if (combo !== SAMPLER_COMBO) throw new Error(`clues spell ${combo}`);
  bot.goTo(A.safe.x, A.safe.y);
  expectOk(esc(p, { action: 'enter_code', targetId: 'smp_safe', code: combo }));
  expectOk(fetchItem(p, bot, 'smp_key_safe'));
  expectOk(useDoor(p, bot, 'sampler.r4_e')); p.team.waitForRoom('p0', ids[5]!);
  bot.goTo(A.exit.x, A.exit.y);
  p.team.idle(3);
}

export function expectOk(r: { ok: boolean; error?: string }): void {
  if (!r.ok) throw new Error(`expected ok, got: ${r.error}`);
}
