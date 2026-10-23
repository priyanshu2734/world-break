import { ESCAPE_LIMITS, RANGE_DY, type EscapePublic, type RoomLayout, type StageState } from '@wb/shared';

/** Something in the current room that E can do something with. Positions are feet-centre (doors: centre of the doorway, on the floor). */
export type EscapeUse =
  | { kind: 'door'; id: string; open: boolean; need: string | null; x: number; y: number; halfW: number }
  | { kind: 'keypad'; id: string; length: number; solved: boolean; lockedUntilTick: number | null; x: number; y: number; halfW: number }
  | { kind: 'safe'; id: string; length: number; opened: boolean; lockedUntilTick: number | null; x: number; y: number; halfW: number }
  | { kind: 'clue'; id: string; label: string; x: number; y: number; halfW: number }
  | { kind: 'switch'; id: string; active: boolean; x: number; y: number; halfW: number };

/** Everything E can touch in `room`. Doorway positions come from the room layout the server sent; the rest from the public escape state. */
export function usablesIn(room: string, es: EscapePublic | undefined, layout: RoomLayout | undefined): EscapeUse[] {
  if (!es) return [];
  const out: EscapeUse[] = [];
  for (const d of es.doors) {
    const box = layout?.doors.find((x) => x.id === d.id);
    if (d.room === room && box) out.push({ kind: 'door', id: d.id, open: d.open, need: d.need, x: box.x + box.w / 2, y: box.y + box.h, halfW: box.w / 2 });
  }
  for (const k of es.keypads) if (k.room === room) out.push({ kind: 'keypad', id: k.id, length: k.length, solved: k.solved, lockedUntilTick: k.lockedUntilTick, x: k.x, y: k.y, halfW: 0 });
  for (const s of es.safes) if (s.room === room) out.push({ kind: 'safe', id: s.id, length: s.length, opened: s.opened, lockedUntilTick: s.lockedUntilTick, x: s.x, y: s.y, halfW: 0 });
  for (const c of es.clues) if (c.room === room) out.push({ kind: 'clue', id: c.id, label: c.label, x: c.x, y: c.y, halfW: 0 });
  for (const s of es.switches) if (s.room === room) out.push({ kind: 'switch', id: s.id, active: s.active, x: s.x, y: s.y, halfW: 0 });
  return out;
}

/** The nearest thing within reach (same reach rule as the server: horizontal useRange, vertical RANGE_DY), or null. */
export function nearestUse(me: { x: number; y: number }, uses: readonly EscapeUse[]): EscapeUse | null {
  let best: EscapeUse | null = null, bestD = Infinity;
  for (const u of uses) {
    const dx = Math.abs(me.x - u.x), dy = Math.abs(me.y - u.y);
    if (dx > ESCAPE_LIMITS.useRange + u.halfW || dy > RANGE_DY) continue;
    if (dx < bestD) { best = u; bestD = dx; }
  }
  return best;
}

/** What E does there, in a few words (shown as a prompt). `null` = nothing to do (already done). */
export function usePrompt(u: EscapeUse, tick: number): string | null {
  switch (u.kind) {
    case 'door': return u.open ? 'E  go through the door' : 'E  try the door';
    case 'keypad':
      if (u.solved) return null;
      return u.lockedUntilTick !== null && u.lockedUntilTick > tick ? 'The keypad is locked out for a moment' : 'E  enter a code';
    case 'safe':
      if (u.opened) return null;
      return u.lockedUntilTick !== null && u.lockedUntilTick > tick ? 'The safe is locked out for a moment' : 'E  open the safe';
    case 'clue': return 'E  read';
    case 'switch': return u.active ? 'The switch is lit' : 'E  press the switch';
  }
}

/** The intent E sends for a thing, or null when it opens the code pad / does nothing. */
export function useIntent(u: EscapeUse): { action: 'use_door'; doorId: string } | { action: 'read'; clueId: string } | { action: 'press'; switchId: string } | null {
  switch (u.kind) {
    case 'door': return { action: 'use_door', doorId: u.id };
    case 'clue': return { action: 'read', clueId: u.id };
    case 'switch': return { action: 'press', switchId: u.id };
    default: return null;
  }
}

/** Does this thing take a typed code (keypad or safe) that can be tried right now? */
export function takesCode(u: EscapeUse, tick: number): boolean {
  if (u.kind !== 'keypad' && u.kind !== 'safe') return false;
  const done = u.kind === 'keypad' ? u.solved : u.opened;
  return !done && !(u.lockedUntilTick !== null && u.lockedUntilTick > tick);
}

/**
 * The stage state as the player in `room` should draw it: parts and containers that lie in other rooms are left out (their
 * coordinates belong to another room). Without a room id, or on a stage whose items carry none, nothing is removed.
 */
export function stateForRoom(st: StageState | null, room: string | undefined): StageState | null {
  if (!st || !st.items || room === undefined) return st;
  const here = <T extends { roomId?: string | undefined }>(x: T) => x.roomId === undefined || x.roomId === room;
  return { ...st, items: { ...st.items, items: st.items.items.filter(here), ...(st.items.stashes ? { stashes: st.items.stashes.filter(here) } : {}) } };
}

/** What the player has typed into the code pad. Digits only, bounded by the code length. */
export class CodeEntry {
  private value = '';
  constructor(readonly length: number) {}
  get text(): string { return this.value; }
  get complete(): boolean { return this.value.length === this.length; }
  push(ch: string): void { if (/^[0-9]$/.test(ch) && this.value.length < this.length) this.value += ch; }
  back(): void { this.value = this.value.slice(0, -1); }
  clear(): void { this.value = ''; }
  /** `4 _ _ _` style display. */
  display(): string { return Array.from({ length: this.length }, (_, i) => this.value[i] ?? '_').join(' '); }
}

/** Notes the player has read (clue text stays on the reader's side only). Newest last, bounded, no duplicates. */
export function addNote(notes: { id: string; text: string }[], note: { id: string; text: string }, max = 8): void {
  if (notes.some((n) => n.id === note.id)) return;
  notes.push(note);
  while (notes.length > max) notes.shift();
}

/** The keys of an escape stage (GAMEPLAY.md section 11). Q (ping) and Tab (team panel) are placeholders until their phases. */
export const ESCAPE_KEYS_HINT = 'A/D move   W/Space jump   E interact   G drop/swap   F use   Q ping (soon)   Tab team (soon)   Mouse: aim your light';

/**
 * The ONE goal line of an escape stage, from what this player's view contains (the server sends only what they can see, so this
 * never gives away what is hidden). `carried` = the kinds of parts in their hands.
 */
export function goalLine(es: EscapePublic | undefined, room: string | undefined, carried: readonly string[], notesRead: number): string {
  if (!es) return '';
  if (es.exit && es.exit.room === room) return 'Reach the exit.';
  const here = es.doors.filter((d) => d.room === room);
  const locked = here.find((d) => !d.open && d.need !== null);
  if (locked) {
    const need = locked.need!.toLowerCase();
    if (need.includes('key')) return carried.includes('access_key') ? 'Try the key on the locked door.' : 'Find a key for the locked door.';
    if (need.includes('code')) return notesRead > 0 ? 'Enter the code at a keypad.' : 'Find the code, and a keypad to enter it.';
    if (need.includes('power')) return carried.includes('battery') ? 'Use the battery on the door.' : 'Find a battery for the door.';
    if (need.includes('switches')) return 'Light both switches within a few seconds.';
  }
  if (here.some((d) => d.open)) return 'Go through the open door.';
  return 'Find a way out.';
}
