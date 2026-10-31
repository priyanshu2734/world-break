import { describe, expect, it } from 'vitest';
import { PAD, approxWidth, padHint, padSlots, padTextWidth, slotsFit } from '../src/ui/padLogic';

describe('P4 step 6: the code pad layout', () => {
  it('every hint line fits inside the panel at the font it is drawn at, for 3 and 4 digit codes', () => {
    for (const n of [3, 4]) for (const line of padHint(n)) expect(approxWidth(line, 14), line).toBeLessThanOrEqual(padTextWidth());
    // the old one-line hint did not: this is the regression
    const old = 'type 3 digits   Enter: try   Backspace: erase   Esc: close';
    expect(approxWidth(old, 13)).toBeGreaterThan(380 - 2 * 24);
  });
  it('the hint still says everything: how many digits, Enter, Backspace, Esc', () => {
    const text = padHint(3).join(' ');
    for (const w of ['3 digits', 'Enter', 'Backspace', 'Esc']) expect(text).toContain(w);
    expect(padHint(1)[0]).toBe('Type 1 digit');
  });
  it('one box per digit, centred, inside the panel', () => {
    for (const n of [3, 4]) {
      expect(slotsFit(n)).toBe(true);
      const s = padSlots('', n);
      expect(s).toHaveLength(n);
      expect(s[0]!.x + s[n - 1]!.x).toBeCloseTo(0, 5); // symmetric
      expect(Math.abs(s[0]!.x) + PAD.slotW / 2).toBeLessThanOrEqual(PAD.panelW / 2 - PAD.margin);
    }
    expect(slotsFit(8)).toBe(false); // a code that long would not fit, and the layout says so
  });
  it('the typed digits are shown in their own boxes; the next box to fill is marked; a full code marks none', () => {
    const s = padSlots('42', 4);
    expect(s.map((x) => x.char)).toEqual(['4', '2', '', '']);
    expect(s.map((x) => x.filled)).toEqual([true, true, false, false]);
    expect(s.map((x) => x.current)).toEqual([false, false, true, false]);
    expect(padSlots('', 3).map((x) => x.current)).toEqual([true, false, false]);
    expect(padSlots('123', 3).map((x) => x.current)).toEqual([false, false, false]);
    expect(padSlots('123', 3).every((x) => x.filled)).toBe(true);
  });
  it('is bounded: a silly length is clamped', () => {
    expect(padSlots('', 0)).toHaveLength(1);
    expect(padSlots('', 99)).toHaveLength(8);
  });
});
