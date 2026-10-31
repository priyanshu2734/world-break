/** P3D/P4 step 6: the layout of the code pad, as pure functions (no Phaser), so the text always fits its box and the digits are always shown. */

export const PAD = { panelW: 460, panelH: 250, margin: 24, slotW: 64, slotH: 76, slotGap: 14 } as const;

/** The hint under the slots, as short lines that each fit the panel (a person reads three short lines faster than one line that runs out of the box). */
export function padHint(length: number): string[] {
  return [`Type ${length} digit${length === 1 ? '' : 's'}`, 'Enter: try   Backspace: erase', 'Esc: close'];
}

/** The widest a line of text may be inside the panel. */
export const padTextWidth = (): number => PAD.panelW - 2 * PAD.margin;

/** A rough width of a line at `fontPx` in a monospace font (0.62 of the size per character); used to prove the hint fits, not to draw. */
export const approxWidth = (s: string, fontPx: number): number => Math.ceil(s.length * fontPx * 0.62);

export interface PadSlot { char: string; filled: boolean; current: boolean; x: number }

/** One box per digit, centred on the panel: the typed digit in its box, an empty box where nothing is typed yet, and the next box to fill marked. */
export function padSlots(text: string, length: number): PadSlot[] {
  const n = Math.max(1, Math.min(8, length));
  const total = n * PAD.slotW + (n - 1) * PAD.slotGap;
  const left = -total / 2 + PAD.slotW / 2;
  return Array.from({ length: n }, (_, i) => ({ char: text[i] ?? '', filled: i < text.length, current: i === Math.min(text.length, n - 1) && text.length < n, x: left + i * (PAD.slotW + PAD.slotGap) }));
}

/** Do the slots fit inside the panel (with its margin)? Codes are 3 or 4 digits; the pad refuses to be drawn wider than its box. */
export function slotsFit(length: number): boolean {
  const n = Math.max(1, Math.min(8, length));
  return n * PAD.slotW + (n - 1) * PAD.slotGap <= PAD.panelW - 2 * PAD.margin;
}
