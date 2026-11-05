import { GOAL_NOTE, SYMBOLS, breakerClue, glyphClue, leverClue, legendClue, wiringClue, type PuzzleType, type Rng } from '@wb/shared';
import type { ItemDef, StashDef } from '../systems/stageDef';
import type { EscapeSpec, Lock } from './escapeSpec';
import { clearRun, sameSurface } from './escapeValidate';

/**
 * P3F step 2: builds ONE puzzle lock (its switches, notes, keypad, parts and locker) for a door. Pure apart from the generator it is handed and the two
 * callbacks that place things on free spots of a room, so the stage generator keeps ownership of the room plans. The words of every note come from
 * shared `puzzles.ts` (they state what is true, never how to act), and every piece lies on the near side of the door: in the room before it, or the room
 * behind it for the second half of a two-room puzzle.
 */
export interface Pt { x: number; y: number }
export interface PuzzleRoom { readonly id: string; readonly index: number; readonly solids: readonly { x: number; y: number; w: number; h: number }[]; readonly east: Pt }
export interface PuzzleCtx<R extends PuzzleRoom> {
  rng: Rng;
  /** Decoys the stage table allows (0, 1 or 2). */
  decoys: number;
  /** Unused part slots of the stage (the 12-part cap). */
  itemBudget: number;
  tag: string;
  room: R;
  /** The room before the door's room (null for the first door). */
  back: R | null;
  /** Free spots of a room (the generator's own rule), and one drawn from them (with an optional filter). `take` throws when none is free. */
  spots(room: R, surface: 'floor' | 'platform' | 'any'): Pt[];
  take(room: R, surface: 'floor' | 'platform' | 'any', keep?: (s: Pt) => boolean): Pt;
}
export interface Built {
  lock: Lock;
  items: ItemDef[]; stashes: StashDef[];
  clues: EscapeSpec['clues']; keypads: EscapeSpec['keypads']; switches: EscapeSpec['switches'];
}

const PUZZLE_NOISE = [
  'A child\'s drawing of a ghost with too many arms.',
  'Inventory page, every line crossed out.',
  'A warranty card for a lamp that is long gone.',
  'Someone kept score of a card game here. Nobody won.',
];
const MIN_GAP = 110;

export function buildPuzzle<R extends PuzzleRoom>(type: PuzzleType, c: PuzzleCtx<R>): Built {
  const { rng, tag, room } = c;
  const out: Built = { lock: { type: 'timed_switch', switchId: '' }, items: [], stashes: [], clues: [], keypads: [], switches: [] };
  let notes = 0;
  const note = (where: R, label: string, text: string): string => {
    const s = c.take(where, 'any'), id = `${tag}_note${notes++}`;
    out.clues.push({ id, room: where.id, x: s.x, y: s.y, label, text });
    return id;
  };
  const noise = (): void => { if (c.decoys > 0) note(room, 'Old note', rng.pick(PUZZLE_NOISE)); };
  const goal = (t: PuzzleType): void => { const g = GOAL_NOTE[t]; if (g) note(room, g.label, g.text); };
  /** n spots on one surface (one height), at least MIN_GAP apart, listed west to east. */
  const row = (n: number): Pt[] => {
    const free = c.spots(room, 'floor');
    const fits = (y: number): boolean => free.filter((o) => o.y === y).length >= n;
    const first = c.take(room, 'floor', (s) => fits(s.y));
    const rest: Pt[] = [first];
    for (let k = 1; k < n; k++) rest.push(c.take(room, 'floor', (s) => s.y === first.y && rest.every((o) => Math.abs(o.x - s.x) >= MIN_GAP)));
    return rest.sort((a, b) => a.x - b.x);
  };
  const ids = (prefix: string, n: number): string[] => Array.from({ length: n }, (_, k) => `${tag}_${prefix}${k}`);
  const putSwitches = (names: readonly string[], at: readonly Pt[]): void => { names.forEach((id, k) => { const p = at[k]!; out.switches.push({ id, room: room.id, x: p.x, y: p.y }); }); };

  switch (type) {
    case 'lever_sequence': {
      const n = rng.int(3, 4), at = row(n), names = ids('lv', n);
      putSwitches(names, at);
      const order = rng.shuffle(Array.from({ length: n }, (_, k) => k));
      const logged = leverClue(order);
      const clueId = note(room, logged.label, logged.text);
      if (c.decoys > 0) { const old = leverClue(rng.shuffle(order), true); note(room, old.label, old.text); }
      out.lock = { type, levers: names, order, clueId };
      break;
    }
    case 'breaker_panel': {
      const n = rng.int(3, 4), at = row(n), names = ids('br', n);
      putSwitches(names, at);
      const target = Array.from({ length: n }, () => rng.chance(0.5));
      let start = Array.from({ length: n }, () => rng.chance(0.5));
      if (start.every((v, k) => v === target[k])) start = start.map((v, k) => (k === 0 ? !v : v));
      const chart = breakerClue(target);
      const clueId = note(room, chart.label, chart.text);
      if (c.decoys > 0) { const old = breakerClue(target.map((v) => !v), true); note(room, old.label, old.text); }
      out.lock = { type, breakers: names, start, target, clueId };
      break;
    }
    case 'wiring': {
      const n = rng.int(3, 4), at = row(n), names = ids('wr', n);
      putSwitches(names, at);
      const right = rng.int(0, n - 1);
      const plan = wiringClue(right);
      const clueId = note(room, plan.label, plan.text);
      if (c.decoys > 0) { const old = wiringClue((right + 1) % n, true); note(room, old.label, old.text); }
      out.lock = { type, terminals: names, right, clueId };
      break;
    }
    case 'pressure_plates': {
      const partner = (s: Pt, o: Pt): boolean => s.y === o.y && Math.abs(s.x - o.x) >= 200 && Math.abs(s.x - o.x) <= 520 && clearRun(room.solids, s.y, s.x, o.x) && sameSurface(room.solids, s.y, s.x, o.x);
      const a = c.take(room, 'floor', (s) => c.spots(room, 'floor').some((o) => o !== s && partner(s, o)));
      const b = c.take(room, 'floor', (s) => partner(s, a));
      const [first, second] = ids('pl', 2);
      if (first === undefined || second === undefined) throw new Error('two plates');
      putSwitches([first, second], [a, b]);
      goal(type); noise();
      out.lock = { type, plates: [first, second] };
      break;
    }
    case 'timed_switch': {
      const doorX = room.east.x + 20;
      const s = c.take(room, 'floor', (p) => p.y === room.east.y && Math.abs(p.x - doorX) >= 200 && Math.abs(p.x - doorX) <= 700 && clearRun(room.solids, p.y, p.x, doorX));
      const name = `${tag}_sw`;
      putSwitches([name], [s]);
      goal(type); noise();
      out.lock = { type, switchId: name };
      break;
    }
    case 'flashlight_sensor': {
      const n = Math.max(2, 1 + Math.min(c.decoys, 2)), names = ids('se', n), at: Pt[] = [];
      for (let k = 0; k < n; k++) at.push(c.take(room, 'any', (s) => at.every((o) => o.y !== s.y || Math.abs(o.x - s.x) >= MIN_GAP)));
      at.sort((a, b) => a.x - b.x);
      putSwitches(names, at);
      goal(type); noise();
      out.lock = { type, sensors: names, genuine: rng.pick(names) };
      break;
    }
    case 'symbol_match': {
      if (c.back === null) throw new Error('a symbol puzzle needs a room behind its door');
      const picked = rng.shuffle(SYMBOLS).slice(0, 4);
      const digits = rng.shuffle([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
      const legend: Record<string, number> = {};
      SYMBOLS.forEach((sym, k) => { legend[sym] = digits[k]!; });
      const code = picked.map((sym) => legend[sym]).join('');
      const pad = c.take(room, 'floor');
      out.keypads.push({ id: `${tag}_pad`, room: room.id, x: pad.x, y: pad.y });
      const picHere = rng.chance(0.5);
      const pic = glyphClue(picked), leg = legendClue(legend);
      const pictureId = note(picHere ? room : c.back, pic.label, pic.text);
      const legendId = note(picHere ? c.back : room, leg.label, leg.text);
      noise();
      out.lock = { type, keypadId: `${tag}_pad`, code, pictureId, legendId };
      break;
    }
    case 'tool_key': {
      if (c.itemBudget < 2) throw new Error('no room for a key and a tool');
      const lockerAt = c.take(room, 'floor'), stash = `${tag}_locker`;
      out.stashes.push({ id: stash, kind: 'locker', label: 'Jammed locker', x: lockerAt.x, y: lockerAt.y, room: room.id, needs: 'valve_wheel' });
      out.items.push({ id: `${tag}_key`, kind: 'access_key', x: lockerAt.x, y: lockerAt.y, room: room.id, hidden: { container: 'locker', reveal: 'interact', stashId: stash } });
      const w = c.take(room, 'any');
      out.items.push({ id: `${tag}_wheel`, kind: 'valve_wheel', x: w.x, y: w.y, room: room.id });
      const cracked = Math.min(c.decoys, c.itemBudget - 2);
      for (let d = 0; d < cracked; d++) {
        const s = c.take(room, 'any');
        out.items.push({ id: `${tag}_wheel_cracked${d}`, kind: 'valve_wheel', x: s.x, y: s.y, room: room.id, decoy: true, tell: true });
      }
      goal(type); noise();
      out.lock = { type, stashId: stash, tool: 'valve_wheel' };
      break;
    }
  }
  return out;
}
