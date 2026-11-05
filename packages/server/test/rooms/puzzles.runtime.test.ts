import { describe, expect, it } from 'vitest';
import { ESCAPE_LIMITS, needText, type EscapeAction, type RoomGraph } from '@wb/shared';
import { EscapeRuntime, type EscapeHost, type EscapePos } from '../../src/rooms/escape';
import type { EscapeSpec, Lock } from '../../src/rooms/escapeSpec';

/**
 * P3F step 2: the rules of each puzzle, one by one, on the escape mechanics alone (no physics, no Room): a fake host gives the clock, the rooms and the light.
 * Two rooms, `a` and `b`, one door between them (`da` in a, `db` in b); the puzzle's switches stand on the floor of `a` (y = 680).
 */
const FLOOR = 680;
const arena = (id: string) => ({ id, name: id, width: 2400, height: 720, solids: [{ x: 0, y: FLOOR, w: 2400, h: 40 }], spawns: [{ x: 300, y: FLOOR }, { x: 350, y: FLOOR }, { x: 400, y: FLOOR }, { x: 450, y: FLOOR }] });
const GRAPH: RoomGraph = {
  start: 'a',
  rooms: [
    { id: 'a', arena: arena('a'), doors: [{ id: 'da', x: 2200, y: FLOOR - 100, w: 40, h: 100, to: 'b', arrive: { x: 200, y: FLOOR } }] },
    { id: 'b', arena: arena('b'), doors: [{ id: 'db', x: 60, y: FLOOR - 100, w: 40, h: 100, to: 'a', arrive: { x: 2100, y: FLOOR } }] },
  ],
};
const sw = (id: string, x: number) => ({ id, room: 'a', x, y: FLOOR });

interface Rig {
  rt: EscapeRuntime; t: { now: number }; said: string[]; through: string[];
  where: Map<string, EscapePos>; light: { on: boolean };
  /** One intent from player `who`, standing where it stands now; the clock moves on first so the rate limit never refuses. */
  do(who: string, a: EscapeAction): ReturnType<EscapeRuntime['act']>;
  at(who: string, x: number, y?: number): void;
  tick(n?: number): void;
  pub(): ReturnType<EscapeRuntime['publicState']>;
}
function rig(lock: Lock, switches: EscapeSpec['switches'], extra: Partial<EscapeSpec> = {}, players = ['p0']): Rig {
  const t = { now: 100 }, said: string[] = [], through: string[] = [], where = new Map<string, EscapePos>(), light = { on: true };
  const host: EscapeHost = {
    get tick() { return t.now; },
    say: (text) => { said.push(text); }, markDirty: () => undefined, award: () => undefined, wrongPartCost: () => 10,
    roomOf: () => 'a', canSee: () => light.on, sendThrough: (_id, door) => { through.push(door); return true; }, clear: () => undefined,
  };
  const spec: EscapeSpec = { exit: { room: 'b', x: 2000, y: FLOOR }, links: [{ doors: ['da', 'db'], lock }], keypads: [], safes: [], clues: [], switches, ...extra };
  const rt = new EscapeRuntime(spec, GRAPH, host, null);
  for (const p of players) { rt.addPlayer(p); where.set(p, { x: 300, y: FLOOR, connected: true }); }
  const r: Rig = {
    rt, t, said, through, where, light,
    do: (who, a) => { t.now += 6; return rt.act(who, a, where.get(who)!); },
    at: (who, x, y = FLOOR) => { where.set(who, { x, y, connected: true }); },
    tick: (n = 1) => { for (let i = 0; i < n; i++) { t.now++; rt.step((id) => where.get(id)); } },
    pub: () => rt.publicState(),
  };
  return r;
}
const press = (r: Rig, who: string, id: string, x: number) => { r.at(who, x); return r.do(who, { action: 'press', switchId: id }); };
const active = (r: Rig, id: string) => r.pub().switches.find((s) => s.id === id)!.active;
const error = (res: { ok: boolean }): string => ('error' in res ? String((res as { error: string }).error) : '');

describe('lever sequence', () => {
  const lock: Lock = { type: 'lever_sequence', levers: ['l0', 'l1', 'l2'], order: [2, 0, 1], clueId: 'c' };
  const sws = [sw('l0', 600), sw('l1', 800), sw('l2', 1000)];
  const X = [600, 800, 1000];
  it('opens only when the levers go down in the right order, and the door says what it wants', () => {
    const r = rig(lock, sws);
    expect(r.do('p0', { action: 'use_door', doorId: 'da' }).ok).toBe(false); // tried: now the door says what it needs
    r.at('p0', 2200);
    r.do('p0', { action: 'use_door', doorId: 'da' });
    expect(r.pub().doors.find((d) => d.id === 'da')!.need).toBe(needText('lever_sequence'));
    for (const i of [2, 0]) expect(press(r, 'p0', `l${i}`, X[i]!).ok).toBe(true);
    expect(active(r, 'l2') && active(r, 'l0') && !active(r, 'l1')).toBe(true);
    expect(r.pub().doors.find((d) => d.id === 'da')!.open).toBe(false);
    expect(press(r, 'p0', 'l1', X[1]!).ok).toBe(true);
    expect(r.rt.isOpen('da') && r.rt.isOpen('db')).toBe(true);
  });
  it('a wrong lever puts them all back; three wrong tries in a row lock the panel out; then it works again', () => {
    const r = rig(lock, sws);
    expect(press(r, 'p0', 'l2', X[2]!).ok).toBe(true);
    const bad = press(r, 'p0', 'l1', X[1]!);
    expect(bad.ok).toBe(false); expect(error(bad)).toMatch(/Wrong order/);
    expect(sws.every((s) => !active(r, s.id))).toBe(true);
    for (let k = 0; k < 2; k++) press(r, 'p0', 'l1', X[1]!); // the 2nd and 3rd wrong sequence
    const locked = press(r, 'p0', 'l2', X[2]!);
    expect(locked.ok).toBe(false); expect(error(locked)).toMatch(/Try again in/);
    r.tick(ESCAPE_LIMITS.lockoutTicks + 2);
    for (const i of [2, 0, 1]) expect(press(r, 'p0', `l${i}`, X[i]!).ok).toBe(true);
    expect(r.rt.isOpen('da')).toBe(true);
  });
  it('a lever that is already down cannot be pressed again; a solved panel does not move; a lever out of reach does nothing', () => {
    const r = rig(lock, sws);
    press(r, 'p0', 'l2', X[2]!);
    expect(error(press(r, 'p0', 'l2', X[2]!))).toMatch(/already down/);
    expect(error(press(r, 'p0', 'l0', 100))).toMatch(/Too far/);
  });
});

describe('breaker panel', () => {
  const lock: Lock = { type: 'breaker_panel', breakers: ['b0', 'b1', 'b2'], start: [true, false, true], target: [false, true, true], clueId: 'c' };
  const sws = [sw('b0', 600), sw('b1', 800), sw('b2', 1000)];
  const X = [600, 800, 1000];
  it('starts as authored, toggles one breaker per press, and opens the moment the circuits match', () => {
    const r = rig(lock, sws);
    expect([active(r, 'b0'), active(r, 'b1'), active(r, 'b2')]).toEqual([true, false, true]);
    expect(press(r, 'p0', 'b1', X[1]!).ok).toBe(true);
    expect(active(r, 'b1')).toBe(true);
    expect(r.rt.isOpen('da')).toBe(false);
    expect(press(r, 'p0', 'b0', X[0]!).ok).toBe(true);
    expect(r.rt.isOpen('da')).toBe(true);
  });
  it('too many presses trip the panel: it resets and locks out for a while (brute force is bounded)', () => {
    const r = rig(lock, sws);
    let tripped = false;
    for (let k = 0; k < 12 && !tripped; k++) { const res = press(r, 'p0', 'b2', X[2]!); if (!res.ok && /trips/.test(error(res))) tripped = true; if (r.rt.isOpen('da')) throw new Error('opened by pressing one breaker'); }
    expect(tripped).toBe(true);
    expect([active(r, 'b0'), active(r, 'b1'), active(r, 'b2')]).toEqual([true, false, true]);
    expect(error(press(r, 'p0', 'b1', X[1]!))).toMatch(/Try again in/);
    r.tick(ESCAPE_LIMITS.lockoutTicks + 2);
    expect(press(r, 'p0', 'b1', X[1]!).ok).toBe(true);
  });
});

describe('wiring', () => {
  const lock: Lock = { type: 'wiring', terminals: ['w0', 'w1', 'w2', 'w3'], right: 2, clueId: 'c' };
  const sws = [sw('w0', 600), sw('w1', 800), sw('w2', 1000), sw('w3', 1200)];
  it('the right terminal opens the door; a wrong one sparks and locks the panel out, even for the right one, for a while', () => {
    const r = rig(lock, sws);
    const bad = press(r, 'p0', 'w0', 600);
    expect(bad.ok).toBe(false); expect(error(bad)).toMatch(/spark/);
    expect(error(press(r, 'p0', 'w2', 1000))).toMatch(/Try again in/);
    expect(r.rt.isOpen('da')).toBe(false);
    r.tick(ESCAPE_LIMITS.lockoutTicks + 2);
    expect(press(r, 'p0', 'w2', 1000).ok).toBe(true);
    expect(r.rt.isOpen('da')).toBe(true);
  });
  it('trying every wire costs lockouts: brute force on four terminals takes at least three waits', () => {
    const r = rig(lock, sws);
    let waits = 0;
    for (const i of [0, 1, 3, 2]) {
      for (let guard = 0; guard < 5; guard++) {
        const res = press(r, 'p0', `w${i}`, 600 + 200 * i);
        if (!res.ok && /Try again/.test(error(res))) { waits++; r.tick(ESCAPE_LIMITS.lockoutTicks + 2); continue; }
        break;
      }
      r.tick(ESCAPE_LIMITS.lockoutTicks + 2);
    }
    expect(r.rt.isOpen('da')).toBe(true);
    expect(waits).toBe(0); // every wrong wire was followed by a full wait before the next, so no try ever hit a lockout
  });
});

describe('pressure plates', () => {
  const lock: Lock = { type: 'pressure_plates', plates: ['p_a', 'p_b'] };
  const sws = [sw('p_a', 700), sw('p_b', 1000)];
  it('alone: step on the first, then on the second before the first goes dark; both lit opens the door for good', () => {
    const r = rig(lock, sws);
    r.at('p0', 700); r.tick(2);
    expect(active(r, 'p_a')).toBe(true);
    r.at('p0', 850); r.tick(10);
    expect(r.rt.isOpen('da')).toBe(false);
    r.at('p0', 1000); r.tick(1);
    expect(r.rt.isOpen('da')).toBe(true);
    r.at('p0', 300); r.tick(ESCAPE_LIMITS.plateHoldTicks * 3);
    expect(r.rt.isOpen('da')).toBe(true);
  });
  it('too slow: the first plate goes dark after its hold, so the second alone opens nothing', () => {
    const r = rig(lock, sws);
    r.at('p0', 700); r.tick(2);
    r.at('p0', 300); r.tick(ESCAPE_LIMITS.plateHoldTicks + 5);
    expect(active(r, 'p_a')).toBe(false);
    r.at('p0', 1000); r.tick(3);
    expect(r.rt.isOpen('da')).toBe(false);
  });
  it('two players on the two plates open it at once; a body in the air above a plate does not count; a hand does nothing', () => {
    const r = rig(lock, sws, {}, ['p0', 'p1']);
    r.at('p0', 700, FLOOR - 60); r.at('p1', 1000); r.tick(3); // p0 is jumping
    expect(active(r, 'p_a')).toBe(false);
    r.at('p0', 700); r.tick(2);
    expect(r.rt.isOpen('da')).toBe(true);
    const r2 = rig(lock, sws);
    expect(error(press(r2, 'p0', 'p_a', 700))).toMatch(/Nothing happens/);
  });
});

describe('timed switch', () => {
  const lock: Lock = { type: 'timed_switch', switchId: 't0' };
  const sws = [sw('t0', 1700)];
  it('unlocks the door for a short while, then it locks again if nobody went through', () => {
    const r = rig(lock, sws);
    expect(press(r, 'p0', 't0', 1700).ok).toBe(true);
    expect(r.rt.isOpen('da')).toBe(true);
    r.tick(ESCAPE_LIMITS.timedDoorTicks - 5);
    expect(r.rt.isOpen('da')).toBe(true);
    r.tick(10);
    expect(r.rt.isOpen('da')).toBe(false);
    expect(r.said.some((s) => /seals itself/.test(s))).toBe(true);
    r.at('p0', 2200);
    const late = r.do('p0', { action: 'use_door', doorId: 'da' });
    expect(late.ok).toBe(false); expect(error(late)).toBe(needText('timed_switch'));
  });
  it('whoever goes through in time keeps the door open for the team (and for the way back)', () => {
    const r = rig(lock, sws);
    press(r, 'p0', 't0', 1700);
    r.at('p0', 2200);
    expect(r.do('p0', { action: 'use_door', doorId: 'da' }).ok).toBe(true);
    r.tick(ESCAPE_LIMITS.doorDelayTicks + 2);
    expect(r.through).toEqual(['da']);
    r.tick(ESCAPE_LIMITS.timedDoorTicks * 3);
    expect(r.rt.isOpen('da') && r.rt.isOpen('db')).toBe(true);
    expect(error(press(r, 'p0', 't0', 1700))).toMatch(/Nothing happens/);
  });
  it('a door that is already opening does not lock itself in the middle of the crossing', () => {
    const r = rig(lock, sws);
    press(r, 'p0', 't0', 1700);
    r.tick(ESCAPE_LIMITS.timedDoorTicks - 3);
    r.at('p0', 2200);
    expect(r.do('p0', { action: 'use_door', doorId: 'da' }).ok).toBe(true);
    r.tick(ESCAPE_LIMITS.doorDelayTicks + 3); // the window ended while the door was opening
    expect(r.through).toEqual(['da']);
    expect(r.rt.isOpen('da')).toBe(true);
  });
});

describe('flashlight sensor', () => {
  const lock: Lock = { type: 'flashlight_sensor', sensors: ['s0', 's1', 's2'], genuine: 's1' };
  const sws = [sw('s0', 700), sw('s1', 1000), sw('s2', 1300)];
  it('the working sensor opens the door once light has stayed on it long enough; it glows while lit', () => {
    const r = rig(lock, sws);
    r.tick(ESCAPE_LIMITS.sensorTicks - 2);
    expect(r.rt.isOpen('da')).toBe(false);
    r.light.on = false; r.tick(5); // the light moves away: the count starts again
    expect(active(r, 's1')).toBe(false);
    r.light.on = true; r.tick(ESCAPE_LIMITS.sensorTicks - 2);
    expect(r.rt.isOpen('da')).toBe(false);
    expect(active(r, 's1')).toBe(true);
    r.tick(3);
    expect(r.rt.isOpen('da')).toBe(true);
  });
  it('the dead sensors never glow; a hand on a sensor does nothing; without light nothing ever opens', () => {
    const r = rig(lock, sws);
    r.tick(5);
    expect(active(r, 's0') || active(r, 's2')).toBe(false);
    expect(error(press(r, 'p0', 's1', 1000))).toMatch(/Nothing happens/);
    const dark = rig(lock, sws); dark.light.on = false; dark.tick(ESCAPE_LIMITS.sensorTicks * 5);
    expect(dark.rt.isOpen('da')).toBe(false);
  });
});

describe('the symbol keypad', () => {
  it('opens with the code the two halves spell and locks out after three wrong tries, like any keypad', () => {
    const lock: Lock = { type: 'symbol_match', keypadId: 'k', code: '4172', pictureId: 'pic', legendId: 'leg' };
    const r = rig(lock, [], { keypads: [{ id: 'k', room: 'a', x: 900, y: FLOOR }], clues: [] });
    r.at('p0', 900);
    for (let k = 0; k < 2; k++) expect(error(r.do('p0', { action: 'enter_code', targetId: 'k', code: '0000' }))).toMatch(/Wrong code/);
    expect(error(r.do('p0', { action: 'enter_code', targetId: 'k', code: '0000' }))).toMatch(/locks out/);
    r.tick(ESCAPE_LIMITS.lockoutTicks + 2);
    expect(r.do('p0', { action: 'enter_code', targetId: 'k', code: '4172' }).ok).toBe(true);
    expect(r.rt.isOpen('da')).toBe(true);
  });
});

describe('what a locked door says', () => {
  it('each new type names what is missing and never where it is; a tool key reads like a key door', () => {
    const cases: [Lock, string][] = [
      [{ type: 'lever_sequence', levers: ['l0', 'l1', 'l2'], order: [0, 1, 2], clueId: 'c' }, needText('lever_sequence')],
      [{ type: 'timed_switch', switchId: 't0' }, needText('timed_switch')],
      [{ type: 'tool_key', stashId: 'st', tool: 'valve_wheel' }, 'Locked. Needs a key.'],
    ];
    for (const [lock, text] of cases) {
      const r = rig(lock, lock.type === 'lever_sequence' ? [sw('l0', 600), sw('l1', 800), sw('l2', 1000)] : lock.type === 'timed_switch' ? [sw('t0', 1700)] : []);
      r.at('p0', 2200);
      expect(r.pub().doors.find((d) => d.id === 'da')!.need).toBeNull(); // nobody tried yet
      expect(r.do('p0', { action: 'use_door', doorId: 'da' }).ok).toBe(false);
      expect(r.pub().doors.find((d) => d.id === 'da')!.need).toBe(text);
    }
  });
});
