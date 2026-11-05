import { PUZZLE_TYPES, type PuzzleType } from './escape';

/**
 * P3F step 2: the puzzle pool. Pure data and pure text: which puzzle types exist at which stage, how often one replaces an original lock, and the
 * exact words of every clue. A clue states WHAT is true or WHAT is wanted, never HOW to do it: no clue text contains an instruction verb (tested).
 * The words are produced here and read back by `parse*` below, so the generator, the validator and the solver tests can never disagree about them.
 */

/** From which stage each puzzle type may appear: the curriculum of docs/HOOK.md (`variety/curriculum.ts`), one new puzzle per stage from 7 to 15 (P3F step 4; step 2 had a first-cut table). */
export const PUZZLE_FROM_STAGE: Readonly<Record<PuzzleType, number>> = {
  breaker_panel: 7, pressure_plates: 8, flashlight_sensor: 9, lever_sequence: 11, tool_key: 12, timed_switch: 13, symbol_match: 14, wiring: 15,
};

/** The puzzle types a stage may use, in table order. Stages 1 to 6 have none: the original locks teach the basics first. */
export function puzzlesForStage(stage: number): readonly PuzzleType[] {
  const s = Number.isFinite(stage) ? Math.max(1, Math.floor(stage)) : 1;
  return PUZZLE_TYPES.filter((t) => PUZZLE_FROM_STAGE[t] <= s);
}

/** The chance that a door's original lock is replaced by a puzzle: 0 before stage 6, 40 percent at stage 6, +1.25 points per stage, capped at 75 percent (stage 34 on). */
export function puzzleChance(stage: number): number {
  const s = Number.isFinite(stage) ? Math.max(1, Math.floor(stage)) : 1;
  return s < 6 ? 0 : Math.min(0.75, 0.4 + 0.0125 * (s - 6));
}

/** Puzzles that need two rooms (one half of the information in each): they only fit a door that has a room behind it. */
export const NEEDS_BACK_ROOM: ReadonlySet<PuzzleType> = new Set<PuzzleType>(['symbol_match']);

// ------------------------------------------------------------------------------------------------------------------ words
export const SYMBOLS = ['moon', 'eye', 'tree', 'key', 'star', 'fish', 'bell', 'flame'] as const;
export type Symbol8 = (typeof SYMBOLS)[number];
export const ORDINALS = ['first', 'second', 'third', 'fourth'] as const;

/** A decoy page is marked: it starts with this word, and no parser reads it. */
export const SUPERSEDED = 'Superseded';
const live = (text: string): boolean => !text.startsWith(SUPERSEDED);

export const GOAL_NOTE: Readonly<Partial<Record<PuzzleType, { label: string; text: string }>>> = {
  timed_switch: { label: 'Security memo', text: 'Security memo. The door on this level was put on a short timer.' },
  pressure_plates: { label: 'Floor plan', text: 'Floor plan. Two pressure plates guard this door.' },
  flashlight_sensor: { label: 'Sensor array', text: 'Sensor array. Only one of the sensors here still works.' },
  tool_key: { label: 'Locker log', text: 'Locker log. The access key is inside the jammed locker, whose bolt is rusted solid.' },
};

export const leverClue = (order: readonly number[], old = false): { label: string; text: string } => ({
  label: old ? 'Old valve log' : 'Valve log',
  text: `${old ? `${SUPERSEDED} valve log (before the rewiring)` : 'Valve log'}. The valves went dark in this order, counted from the left: ${order.map((i) => i + 1).join(', then ')}.`,
});
export function parseLever(text: string): number[] | null {
  if (!live(text)) return null;
  const m = /counted from the left: ([0-9, a-z]+)\./.exec(text);
  return m ? (m[1]!.match(/[0-9]/g) ?? []).map((d) => Number(d) - 1) : null;
}

export const breakerClue = (target: readonly boolean[], old = false): { label: string; text: string } => ({
  label: old ? 'Old fuse chart' : 'Fuse chart',
  text: `${old ? `${SUPERSEDED} fuse chart (the old layout)` : 'Fuse chart'}. Circuits, counted from the left: ${target.map((on, i) => `${i + 1} ${on ? 'on' : 'off'}`).join(', ')}.`,
});
export function parseBreaker(text: string): boolean[] | null {
  if (!live(text)) return null;
  const m = /counted from the left: ([0-9a-z, ]+)\./.exec(text);
  if (!m) return null;
  return [...m[1]!.matchAll(/([0-9]) (on|off)/g)].map((x) => x[2] === 'on');
}

export const wiringClue = (right: number, old = false): { label: string; text: string } => ({
  label: old ? 'Old wiring plan' : 'Wiring plan',
  text: old ? `${SUPERSEDED} wiring plan. The supply ran to the ${ORDINALS[right]} post from the left.` : `Wiring plan. The supply runs to the ${ORDINALS[right]} post from the left.`,
});
export function parseWiring(text: string): number | null {
  if (!live(text)) return null;
  const m = /runs to the ([a-z]+) post from the left/.exec(text);
  const i = m ? ORDINALS.indexOf(m[1] as (typeof ORDINALS)[number]) : -1;
  return i >= 0 ? i : null;
}

export const glyphClue = (names: readonly string[]): { label: string; text: string } => ({ label: 'Glyphs', text: `Glyphs scratched in a row, left to right: ${names.join(', ')}.` });
export const legendClue = (map: Readonly<Record<string, number>>): { label: string; text: string } => ({
  label: 'Wall plate', text: `Wall plate, symbol and number pairs: ${Object.entries(map).map(([k, v]) => `${k} ${v}`).join(', ')}.`,
});
export const parseGlyphs = (text: string): string[] | null => { const m = /left to right: ([a-z, ]+)\./.exec(text); return m ? m[1]!.split(', ') : null; };
export function parseLegend(text: string): Record<string, number> | null {
  const m = /number pairs: ([a-z0-9, ]+)\./.exec(text);
  if (!m) return null;
  const out: Record<string, number> = {};
  for (const p of m[1]!.split(', ')) { const q = /^([a-z]+) ([0-9])$/.exec(p); if (!q) return null; out[q[1]!] = Number(q[2]); }
  return out;
}
/** The code a picture and a legend spell together (null if a symbol has no number). */
export function symbolCode(glyphs: readonly string[], legend: Readonly<Record<string, number>>): string | null {
  const digits = glyphs.map((g) => legend[g]);
  return digits.every((d) => d !== undefined) ? digits.join('') : null;
}

/** Words that tell a player HOW to do something. No clue or lock text may contain one (tested). */
export const METHOD_WORDS = ['press', 'pull', 'push', 'flip', 'hold', 'walk', 'run', 'stand', 'shine', 'aim', 'connect', 'plug', 'cut', 'swap', 'wait', 'try', 'step', 'use', 'enter', 'type', 'toggle', 'flick', 'lift', 'drop', 'carry', 'place', 'bring', 'fetch', 'take', 'combine'] as const;
export function methodWordIn(text: string): string | null {
  const words: string[] = text.toLowerCase().match(/[a-z]+/g) ?? [];
  return METHOD_WORDS.find((w) => words.includes(w)) ?? null;
}
