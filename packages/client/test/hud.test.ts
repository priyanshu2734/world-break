import { describe, expect, it } from 'vitest';
import { VISION_TABLE, visionRadius, type EscapePublic } from '@wb/shared';
import { ESCAPE_KEYS_HINT, goalLine } from '../src/ui/escapeUse';
import { LIGHT, inLight, lightGeometry } from '../src/ui/darkParam';

const base: EscapePublic = { doors: [], keypads: [], safes: [], clues: [], switches: [] };
const door = (open: boolean, need: string | null, room = 'a') => ({ id: `d_${room}_${open}`, room, open, need });

describe('the one goal line of an escape stage', () => {
  it('is empty on other stages', () => { expect(goalLine(undefined, 'a', [], 0)).toBe(''); });
  it('starts as "find a way out" and never names what the player has not seen', () => {
    expect(goalLine(base, 'a', [], 0)).toBe('Find a way out.');
    for (const text of [goalLine(base, 'a', [], 0), goalLine({ ...base, doors: [door(false, null)] }, 'a', [], 0)]) expect(text).not.toMatch(/keypad|safe|battery|key|code/i);
  });
  it('turns what a tried door asked for into a goal, using the hands and the notes', () => {
    const key = { ...base, doors: [door(false, 'Locked. Needs a key.')] };
    expect(goalLine(key, 'a', [], 0)).toBe('Find a key for the locked door.');
    expect(goalLine(key, 'a', ['access_key'], 0)).toBe('Try the key on the locked door.');
    const code = { ...base, doors: [door(false, 'Locked. Needs a 4-symbol code.')] };
    expect(goalLine(code, 'a', [], 0)).toBe('Find the code, and a keypad to enter it.');
    expect(goalLine(code, 'a', [], 1)).toBe('Enter the code at a keypad.');
    expect(goalLine({ ...base, doors: [door(false, 'Locked. Needs power.')] }, 'a', [], 0)).toBe('Find a battery for the door.');
    expect(goalLine({ ...base, doors: [door(false, 'Locked. Needs power.')] }, 'a', ['battery'], 0)).toBe('Use the battery on the door.');
    expect(goalLine({ ...base, doors: [door(false, 'Locked. Needs two switches held at once.')] }, 'a', [], 0)).toBe('Light both switches within a few seconds.');
  });
  it('an open door in view says to go through it; an exit in view wins over everything', () => {
    expect(goalLine({ ...base, doors: [door(true, null)] }, 'a', [], 0)).toBe('Go through the open door.');
    const withExit: EscapePublic = { ...base, doors: [door(false, 'Locked. Needs a key.')], exit: { room: 'a', x: 1, y: 2 } };
    expect(goalLine(withExit, 'a', [], 0)).toBe('Reach the exit.');
    expect(goalLine(withExit, 'b', [], 0)).toBe('Find a way out.'); // an exit in another room is not this room's goal
  });
  it('doors of other rooms do not set the goal', () => {
    expect(goalLine({ ...base, doors: [door(false, 'Locked. Needs a key.', 'b')] }, 'a', [], 0)).toBe('Find a way out.');
  });
});

describe('the keys line (GAMEPLAY.md section 11)', () => {
  it('lists move, jump, E, G, F, the mouse, and marks Q and Tab as placeholders; no tools or abilities', () => {
    for (const k of ['A/D move', 'W/Space jump', 'E interact', 'G drop/swap', 'F use', 'Q ping (soon)', 'Tab team (soon)', 'Mouse']) expect(ESCAPE_KEYS_HINT).toContain(k);
    expect(ESCAPE_KEYS_HINT).not.toMatch(/1-5|6-9|tools|abilities/);
  });
});

describe('the light reaches exactly as far as the server publishes', () => {
  const me = { x: 500, y: 680 };
  it('the default reach is the old reference light (nothing changes where no reach is given)', () => {
    expect(lightGeometry(me, 0, false).coneLength).toBe(LIGHT.coneLength);
    expect(lightGeometry(me, 0, false, LIGHT.coneLength).radius).toBe(LIGHT.radius);
  });
  it('scales with the stage\'s vision radius at stages 1, 10, 100 and 1,000,000', () => {
    for (const stage of [1, 10, 100, 1_000_000]) for (const d of ['easy', 'intermediate', 'hardcore'] as const) {
      const r = visionRadius(d, stage), g = lightGeometry(me, 0, false, r);
      expect(g.coneLength).toBeCloseTo(r);
      expect(g.radius).toBeCloseTo(LIGHT.radius * (r / LIGHT.coneLength));
      expect(g.coneLength).toBeGreaterThanOrEqual(VISION_TABLE[d].floor);
    }
  });
  it('what is lit is always inside what the server sends, even with the assist', () => {
    for (const stage of [1, 10, 100, 1_000_000]) for (const assist of [false, true]) {
      const r = visionRadius('easy', stage), g = lightGeometry(me, 0, assist, r);
      expect(g.coneLength).toBeLessThanOrEqual(r);
      expect(g.coneLength * 0.88).toBeLessThan(r); // the lit part ends before the published part
      expect(inLight({ x: me.x + r * 0.87, y: me.y - 28 }, g)).toBe(true);
      expect(inLight({ x: me.x + r + 1, y: me.y - 28 }, g)).toBe(false);
    }
  });
  it('without a stage radius the assist still enlarges the beam (the step 1B behaviour)', () => {
    expect(lightGeometry(me, 0, true).coneLength).toBeGreaterThan(lightGeometry(me, 0, false).coneLength);
  });
});
