import { describe, expect, it } from 'vitest';
import { ESCAPE_LIMITS, type EscapePublic, type RoomLayout, type StageState } from '@wb/shared';
import { CodeEntry, addNote, nearestUse, stateForRoom, takesCode, useIntent, usablesIn, usePrompt } from '../src/ui/escapeUse';
import { roomsFlag } from '../src/ui/roomMath';

const layout: RoomLayout = {
  roomId: 'a',
  arena: { id: 'a', name: 'A', width: 1920, height: 720, solids: [{ x: 0, y: 680, w: 1920, h: 40 }], spawns: [{ x: 100, y: 680 }, { x: 150, y: 680 }, { x: 200, y: 680 }, { x: 250, y: 680 }] },
  doors: [{ id: 'a_e', x: 1840, y: 580, w: 40, h: 100 }],
};
const es: EscapePublic = {
  doors: [{ id: 'a_e', room: 'a', open: false, need: null }, { id: 'b_w', room: 'b', open: false, need: null }],
  keypads: [{ id: 'kp', room: 'a', x: 1700, y: 680, length: 4, solved: false, lockedUntilTick: null }],
  safes: [{ id: 'sf', room: 'a', x: 1000, y: 680, length: 3, opened: false, lockedUntilTick: null }],
  clues: [{ id: 'cl', room: 'a', x: 500, y: 680, label: 'Note' }, { id: 'far', room: 'b', x: 500, y: 680, label: 'Note' }],
  switches: [{ id: 'sw', room: 'a', x: 300, y: 680, active: false }],
  exit: { room: 'b', x: 1700, y: 680 },
};

describe('escape: what is in the room and what E would do', () => {
  it('lists only the things of the current room, with doorway positions from the layout', () => {
    const u = usablesIn('a', es, layout);
    expect(u.map((x) => x.id).sort()).toEqual(['a_e', 'cl', 'kp', 'sf', 'sw']);
    const door = u.find((x) => x.id === 'a_e')!;
    expect(door.x).toBe(1860); expect(door.y).toBe(680);
    expect(usablesIn('a', undefined, layout)).toEqual([]);
    // room b: its door is not listed without a layout that contains it, its clue is
    expect(usablesIn('b', es, layout).map((x) => x.id)).toEqual(['far']);
    expect(usablesIn('b', es, undefined).map((x) => x.id)).toEqual(['far']);
  });
  it('picks the nearest thing in reach, with the server\'s reach rule', () => {
    const u = usablesIn('a', es, layout);
    expect(nearestUse({ x: 520, y: 680 }, u)?.id).toBe('cl');
    expect(nearestUse({ x: 1000 + ESCAPE_LIMITS.useRange, y: 680 }, u)?.id).toBe('sf');
    expect(nearestUse({ x: 1000 + ESCAPE_LIMITS.useRange + 1, y: 680 }, u)).toBeNull();
    expect(nearestUse({ x: 520, y: 500 }, u)).toBeNull(); // too far above
    expect(nearestUse({ x: 1860 + 20 + ESCAPE_LIMITS.useRange, y: 680 }, u)?.id).toBe('a_e'); // a door is reached from its edge (half its width extra)
    expect(nearestUse({ x: 1860 + 21 + ESCAPE_LIMITS.useRange, y: 680 }, u)).toBeNull();
  });
  it('prompts say what E does, and nothing for what is done', () => {
    const u = usablesIn('a', es, layout);
    const by = (id: string) => u.find((x) => x.id === id)!;
    expect(usePrompt(by('a_e'), 0)).toBe('E  try the door');
    expect(usePrompt({ ...(by('a_e') as Extract<typeof u[number], { kind: 'door' }>), open: true }, 0)).toBe('E  go through the door');
    expect(usePrompt(by('kp'), 0)).toBe('E  enter a code');
    expect(usePrompt({ ...(by('kp') as Extract<typeof u[number], { kind: 'keypad' }>), solved: true }, 0)).toBeNull();
    expect(usePrompt({ ...(by('kp') as Extract<typeof u[number], { kind: 'keypad' }>), lockedUntilTick: 50 }, 10)).toMatch(/locked out/);
    expect(usePrompt({ ...(by('kp') as Extract<typeof u[number], { kind: 'keypad' }>), lockedUntilTick: 50 }, 60)).toBe('E  enter a code');
    expect(usePrompt(by('cl'), 0)).toBe('E  read');
    expect(usePrompt(by('sw'), 0)).toBe('E  press the switch');
  });
  it('E sends an intent for doors, clues and switches; keypads and safes open the typing pad instead', () => {
    const u = usablesIn('a', es, layout);
    const by = (id: string) => u.find((x) => x.id === id)!;
    expect(useIntent(by('a_e'))).toEqual({ action: 'use_door', doorId: 'a_e' });
    expect(useIntent(by('cl'))).toEqual({ action: 'read', clueId: 'cl' });
    expect(useIntent(by('sw'))).toEqual({ action: 'press', switchId: 'sw' });
    expect(useIntent(by('kp'))).toBeNull();
    expect(takesCode(by('kp'), 0)).toBe(true);
    expect(takesCode(by('sf'), 0)).toBe(true);
    expect(takesCode(by('cl'), 0)).toBe(false);
    expect(takesCode({ ...(by('sf') as Extract<typeof u[number], { kind: 'safe' }>), opened: true }, 0)).toBe(false);
  });
});

describe('escape: only the player\'s own room is drawn', () => {
  /** `stateForRoom` only looks at `items`, so the rest of the state can stay minimal. */
  const base = { rev: 1, stageId: 'x', name: 'x', status: 'running', tick: 0 } as unknown as StageState;
  const items = {
    carrySlots: 2, players: [],
    items: [
      { id: 'i1', kind: 'access_key', state: 'in_world', x: 1, y: 2, carrierId: null, targetId: null, slots: 1, roomId: 'a' },
      { id: 'i2', kind: 'battery', state: 'in_world', x: 1, y: 2, carrierId: null, targetId: null, slots: 1, roomId: 'b' },
      { id: 'i3', kind: 'battery', state: 'in_world', x: 1, y: 2, carrierId: null, targetId: null, slots: 1 },
    ],
    stashes: [{ id: 's1', kind: 'locker', label: 'L', x: 1, y: 2, opened: false, roomId: 'b' }],
  };
  it('drops parts and containers that lie in other rooms; keeps ones with no room', () => {
    const st = { ...base, items } as unknown as StageState;
    const a = stateForRoom(st, 'a')!;
    expect(a.items!.items.map((i) => i.id)).toEqual(['i1', 'i3']);
    expect(a.items!.stashes).toEqual([]);
    expect(stateForRoom(st, 'b')!.items!.items.map((i) => i.id)).toEqual(['i2', 'i3']);
  });
  it('is the identity without a room id, without items, or without a state', () => {
    const st = { ...base, items } as unknown as StageState;
    expect(stateForRoom(st, undefined)).toBe(st);
    expect(stateForRoom(base, 'a')).toBe(base);
    expect(stateForRoom(null, 'a')).toBeNull();
  });
});

describe('escape: typing a code and keeping notes', () => {
  it('the pad takes digits only, up to the length, and erases', () => {
    const c = new CodeEntry(4);
    for (const ch of ['4', 'x', '8', ' ', '1', '5', '9']) c.push(ch);
    expect(c.text).toBe('4815'); expect(c.complete).toBe(true); expect(c.display()).toBe('4 8 1 5');
    c.back(); expect(c.text).toBe('481'); expect(c.complete).toBe(false); expect(c.display()).toBe('4 8 1 _');
    c.clear(); expect(c.display()).toBe('_ _ _ _');
    c.push('٣'); expect(c.text).toBe(''); // only ASCII digits
  });
  it('notes are kept once each, newest last, and bounded', () => {
    const notes: { id: string; text: string }[] = [];
    addNote(notes, { id: 'a', text: 'one' }); addNote(notes, { id: 'a', text: 'one again' });
    expect(notes).toEqual([{ id: 'a', text: 'one' }]);
    for (let i = 0; i < 12; i++) addNote(notes, { id: `n${i}`, text: `t${i}` }, 8);
    expect(notes).toHaveLength(8);
    expect(notes.at(-1)!.id).toBe('n11');
  });
  it('?rooms=1 and ?rooms=2 pick the two dev stages, anything else none', () => {
    expect(roomsFlag('?rooms=1')).toBe(true);
    expect(roomsFlag('?rooms=2')).toBe(2);
    for (const q of ['', '?rooms=0', '?rooms=3', '?rooms=true', '?room=1']) expect(roomsFlag(q)).toBe(false);
  });
});
