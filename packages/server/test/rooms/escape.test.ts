import { describe, expect, it } from 'vitest';
import { ESCAPE_LIMITS, ESCAPE_NOTHING, LOCK_TYPES, StageStateSchema, needText } from '@wb/shared';
import { DEMO_AT, DEMO_GRAPH, SAMPLER_AT, SAMPLER_COMBO, SAMPLER_GRAPH, SAMPLER_IDS, LOCK_SAMPLER_STAGE, ROOMS_DEMO_STAGE } from '../../src/rooms/demoStage';
import { validateEscape } from '../../src/rooms/escapeValidate';
import { StageDefSchema, type StageDef } from '../../src/systems/stageDef';
import { digits, esc, expectOk, fetchItem, itemAct, seen, setup, solveDemo, solveSampler, useDoor, type Play } from './flows';

const R = DEMO_GRAPH.rooms.map((r) => r.id) as [string, string, string];
const S = SAMPLER_IDS;
const keyDoor = DEMO_AT.doorA.id;

/** Demo: player has the real key and is standing at door A. */
function withKey(): Play { const p = setup(true); const b = p.bots[0]!; b.goTo(DEMO_AT.locker.x, DEMO_AT.locker.y); expectOk(itemAct(p, { action: 'open', stashId: 'demo_locker' })); expectOk(fetchItem(p, b, 'demo_key')); return p; }
/** Demo: through door A, clue read, standing at the keypad of room 1. */
function atKeypad(): Play {
  const p = withKey(); const b = p.bots[0]!;
  expectOk(useDoor(p, b, keyDoor)); p.team.waitForRoom('p0', R[1]);
  b.goTo(DEMO_AT.clue.x, DEMO_AT.clue.y); expectOk(esc(p, { action: 'read', clueId: 'demo_log' }));
  b.goTo(DEMO_AT.keypad.x, DEMO_AT.keypad.y);
  return p;
}

describe('P3D escape: the 3-room mini escape (key, then code)', () => {
  it('one player can escape it with real physics, and that clears the stage through the existing STAGE_CLEAR transition', () => {
    const p = setup(true);
    expect(p.room.phase).toBe('playing');
    solveDemo(p, p.bots[0]!);
    expect(p.room.phase).toBe('stage_complete');
    const st = StageStateSchema.parse(p.team.state());
    expect(st.status).toBe('stabilized');
    expect(st.score.breakdown.time).toBeGreaterThan(0); // the time bonus is paid exactly as for an objective clear
  });

  it('the others come back for the next stage: everybody is reset onto the ordinary next stage', () => {
    const p = setup(true, 3);
    solveDemo(p, p.bots[0]!); // p1 and p2 never left room 0
    expect(p.room.phase).toBe('stage_complete');
    expect(p.team.roomOf('p1')).toBe(R[0]);
    expect(p.room.nextStage('p0').ok).toBe(true);
    expect(p.room.stage).toBe(2);
    for (const pl of p.room.gameSnapshot()!.players) expect(pl.roomId).toBeUndefined(); // an ordinary stage again
    expect(p.room.drainLayouts()).toEqual([]);
  });

  it('one to four players can all be on the team; one reaching the exit alive is enough', () => {
    for (const n of [2, 4]) {
      const p = setup(true, n);
      solveDemo(p, p.bots[0]!);
      expect(p.room.phase).toBe('stage_complete');
    }
  });

  it('a door does not open by touching it, locked or not; E opens it after a short delay', () => {
    const p = withKey(); const b = p.bots[0]!;
    b.goTo(DEMO_AT.doorA.x, DEMO_AT.doorA.y);
    p.team.idle(30);
    expect(p.team.roomOf('p0')).toBe(R[0]); // standing in the doorway: nothing
    expectOk(esc(p, { action: 'use_door', doorId: keyDoor }));
    for (let i = 0; i < ESCAPE_LIMITS.doorDelayTicks - 2; i++) { p.team.tick(); expect(p.team.roomOf('p0')).toBe(R[0]); }
    p.team.waitForRoom('p0', R[1], 6);
    expect(p.team.roomOf('p0')).toBe(R[1]);
    expect(p.team.player('p0').x).toBe(200); // the arrival point
  });

  it('walking away while the door is opening cancels it', () => {
    const p = withKey(); const b = p.bots[0]!;
    b.goTo(DEMO_AT.doorA.x, DEMO_AT.doorA.y);
    expectOk(esc(p, { action: 'use_door', doorId: keyDoor }));
    for (let i = 0; i < 8; i++) p.team.tick({ p0: { moveX: -1, jump: false } });
    p.team.idle(20);
    expect(p.team.roomOf('p0')).toBe(R[0]);
  });

  it('an unlocked door stays open for everybody; walking back through it needs only E', () => {
    const p = setup(true, 2);
    const [a, b] = p.bots as [typeof p.bots[0], typeof p.bots[0]];
    a.goTo(DEMO_AT.locker.x, DEMO_AT.locker.y); expectOk(itemAct(p, { action: 'open', stashId: 'demo_locker' })); expectOk(fetchItem(p, a, 'demo_key'));
    expectOk(useDoor(p, a, keyDoor)); p.team.waitForRoom('p0', R[1]);
    expect(p.team.state().escape!.doors.find((d) => d.id === keyDoor)!.open).toBe(true);
    expectOk(useDoor(p, b, keyDoor, 'p1')); // p1 has no key and does not need one
    p.team.waitForRoom('p1', R[1]);
    expect(p.team.roomOf('p1')).toBe(R[1]);
  });
});

describe('P3D escape: what a locked door says', () => {
  it('states what is missing, never where it is', () => {
    const p = setup(true);
    const r = useDoor(p, p.bots[0]!, keyDoor);
    expect(r).toEqual({ ok: false, error: 'Locked. Needs a key.' });
    for (const t of LOCK_TYPES) {
      const text = needText(t);
      expect(text).toMatch(/^Locked\. Needs /);
      expect(text).not.toMatch(/room|left|right|east|west|north|south|upstairs|behind|under|near|inside|beyond|[0-9]{2,}/i);
    }
    expect(needText('code')).toBe('Locked. Needs a 4-symbol code.');
    expect(needText('safe')).toBe(needText('key_item')); // a safe key reads like any key: where it hides is part of the puzzle
  });

  it('the public state names the requirement only after somebody tried the door', () => {
    const p = setup(true);
    expect(p.team.state().escape!.doors.find((d) => d.id === keyDoor)!.need).toBeNull();
    useDoor(p, p.bots[0]!, keyDoor);
    expect(p.team.state().escape!.doors.find((d) => d.id === keyDoor)!.need).toBe('Locked. Needs a key.');
  });

  it('the second door asks for a 4-symbol code, and the keypad is somewhere else', () => {
    const p = atKeypad(); const b = p.bots[0]!;
    expect(useDoor(p, b, DEMO_AT.doorB.id)).toEqual({ ok: false, error: 'Locked. Needs a 4-symbol code.' });
    expect(DEMO_AT.keypad.x).not.toBe(DEMO_AT.doorB.x); // not at the door
  });
});

describe('P3D escape: parts, decoys and the two hand slots', () => {
  it('a cracked key is a decoy: it snaps, costs score, and the door stays locked; the real key then works', () => {
    const p = setup(true); const b = p.bots[0]!;
    expect(seen(p, 'demo_key_cracked')?.cracked).toBe(true); // easy mode shows the crack
    expect(seen(p, 'demo_key_cracked')?.kind).toBe('access_key');
    expectOk(fetchItem(p, b, 'demo_key_cracked'));
    const r = useDoor(p, b, keyDoor);
    expect(r.ok).toBe(false);
    expect((r as { error: string }).error).toMatch(/cracked/);
    expect(p.team.roomOf('p0')).toBe(R[0]);
    expect(seen(p, 'demo_key_cracked')).toBeUndefined(); // destroyed, no longer anywhere
    expect(p.team.state().score.breakdown.wrong_part).toBeLessThan(0);
    expect(p.team.state().escape!.doors.find((d) => d.id === keyDoor)!.open).toBe(false);
    b.goTo(DEMO_AT.locker.x, DEMO_AT.locker.y); expectOk(itemAct(p, { action: 'open', stashId: 'demo_locker' })); expectOk(fetchItem(p, b, 'demo_key'));
    expectOk(useDoor(p, b, keyDoor)); p.team.waitForRoom('p0', R[1]);
  });

  it('the hidden key is not in the public state until the locker is opened; the key is consumed by the lock', () => {
    const p = setup(true); const b = p.bots[0]!;
    expect(seen(p, 'demo_key')).toBeUndefined();
    expect(JSON.stringify(p.team.state())).not.toContain('demo_key"');
    b.goTo(DEMO_AT.locker.x, DEMO_AT.locker.y); expectOk(itemAct(p, { action: 'open', stashId: 'demo_locker' }));
    expect(seen(p, 'demo_key')?.state).toBe('in_world');
    expectOk(fetchItem(p, b, 'demo_key'));
    const slots = () => p.team.state().items!.players.find((x) => x.id === 'p0')!.slotsUsed;
    expect(slots()).toBe(1);
    expectOk(useDoor(p, b, keyDoor));
    expect(slots()).toBe(0); // the key left the hands
    expect(seen(p, 'demo_key')).toBeUndefined(); // and the world
  });

  it('two hands: a decoy and the real key fill both; the carry limit still holds', () => {
    const p = setup(true); const b = p.bots[0]!;
    expectOk(fetchItem(p, b, 'demo_key_cracked'));
    b.goTo(DEMO_AT.locker.x, DEMO_AT.locker.y); expectOk(itemAct(p, { action: 'open', stashId: 'demo_locker' })); expectOk(fetchItem(p, b, 'demo_key'));
    const pl = p.team.state().items!.players.find((x) => x.id === 'p0')!;
    expect(pl.slotsUsed).toBe(2);
    expect(p.team.state().items!.carrySlots).toBe(2);
  });
});

describe('P3D escape: the code lock (clue in one place, keypad in another)', () => {
  it('the clue text is never in the public state, even after it was read; only the reader gets it', () => {
    const p = atKeypad();
    expect(p.team.notes.at(-1)!.text).toContain('4 8 1 5');
    const json = JSON.stringify(p.team.state());
    expect(json).not.toContain('4815'); expect(json).not.toContain('4 8 1 5'); expect(json).not.toContain('four numbers');
    expect(p.team.state().escape!.clues.map((c) => c.id)).toContain('demo_log'); // the note exists and shows where it lies, never what it says
  });

  it('a wrong length is refused without counting; three wrong codes lock the keypad out for a while; then the right code works', () => {
    const p = atKeypad();
    expect(esc(p, { action: 'enter_code', targetId: 'demo_keypad', code: '12' })).toEqual({ ok: false, error: 'Enter 4 symbols.' });
    for (let i = 0; i < 2; i++) expect(esc(p, { action: 'enter_code', targetId: 'demo_keypad', code: '0000' })).toEqual({ ok: false, error: 'Wrong code.' });
    const third = esc(p, { action: 'enter_code', targetId: 'demo_keypad', code: '1111' });
    expect(third.ok).toBe(false); expect((third as { error: string }).error).toMatch(/locks out/);
    const locked = esc(p, { action: 'enter_code', targetId: 'demo_keypad', code: digits(p.team.notes.at(-1)!.text) });
    expect(locked.ok).toBe(false); expect((locked as { error: string }).error).toMatch(/^Locked out/); // even the right code, until the lockout ends
    expect(p.team.state().escape!.keypads[0]!.lockedUntilTick).not.toBeNull();
    p.team.idle(ESCAPE_LIMITS.lockoutTicks + 2);
    expect(p.team.state().escape!.keypads[0]!.lockedUntilTick).toBeNull();
    expectOk(esc(p, { action: 'enter_code', targetId: 'demo_keypad', code: digits(p.team.notes.at(-1)!.text) }));
    expect(p.team.state().escape!.keypads[0]!.solved).toBe(true);
    expect(p.team.state().escape!.doors.find((d) => d.id === DEMO_AT.doorB.id)!.open).toBe(true);
  });

  it('brute force is bounded: 10,000 codes would need hours of lockouts', () => {
    const triesPerLockout = ESCAPE_LIMITS.maxWrongTries, secondsPerLockout = ESCAPE_LIMITS.lockoutTicks / 20;
    const hours = (10_000 / triesPerLockout) * secondsPerLockout / 3600;
    expect(hours).toBeGreaterThan(4);
  });
});

describe('P3D escape: power, two-person and safe locks (the 6-room sampler)', () => {
  /** Stand in room `n` of the sampler with every earlier lock opened by solving it properly. */
  function inRoom(n: number): Play {
    const p = setup(2); const b = p.bots[0]!;
    const A = SAMPLER_AT;
    if (n >= 1) { b.goTo(A.locker.x, A.locker.y); expectOk(itemAct(p, { action: 'open', stashId: 'smp_locker' })); expectOk(fetchItem(p, b, 'smp_key')); expectOk(useDoor(p, b, 'sampler.r0_e')); p.team.waitForRoom('p0', S[1]!); }
    if (n >= 2) { b.goTo(A.codeClue.x, A.codeClue.y); expectOk(esc(p, { action: 'read', clueId: 'smp_code_clue' })); b.goTo(A.keypad.x, A.keypad.y); expectOk(esc(p, { action: 'enter_code', targetId: 'smp_keypad', code: digits(p.team.notes.at(-1)!.text) })); expectOk(useDoor(p, b, 'sampler.r1_e')); p.team.waitForRoom('p0', S[2]!); }
    if (n >= 3) { expectOk(fetchItem(p, b, 'smp_battery')); expectOk(useDoor(p, b, 'sampler.r2_e')); p.team.waitForRoom('p0', S[3]!); }
    if (n >= 4) {
      b.goTo(A.switchA.x, A.switchA.y); expectOk(esc(p, { action: 'press', switchId: 'smp_sw_a' })); b.goTo(A.switchB.x, A.switchB.y); expectOk(esc(p, { action: 'press', switchId: 'smp_sw_b' }));
      expectOk(useDoor(p, b, 'sampler.r3_e')); p.team.waitForRoom('p0', S[4]!);
    }
    return p;
  }

  it('power: the door asks for power, a battery on a high platform is used up, and the door stays open', () => {
    const p = inRoom(2); const b = p.bots[0]!;
    expect(useDoor(p, b, 'sampler.r2_e')).toEqual({ ok: false, error: 'Locked. Needs power.' });
    expect(seen(p, 'smp_battery')?.y).toBe(SAMPLER_AT.battery.y); // up on the platform
    expectOk(fetchItem(p, b, 'smp_battery'));
    expectOk(useDoor(p, b, 'sampler.r2_e')); p.team.waitForRoom('p0', S[3]!);
    expect(seen(p, 'smp_battery')).toBeUndefined();
    expect(p.team.state().escape!.doors.find((d) => d.id === 'sampler.r2_e')!.open).toBe(true);
  });

  it('two-person, solo-safe: one player lights both switches by running between them within the hold time', () => {
    const p = inRoom(3);
    expect(useDoor(p, p.bots[0]!, 'sampler.r3_e')).toEqual({ ok: false, error: 'Locked. Needs two switches held at once.' });
    const { switchA: a, switchB: sb } = SAMPLER_AT;
    const run = Math.abs(a.x - sb.x) / 13; // 13 px per tick
    expect(run).toBeLessThan(ESCAPE_LIMITS.switchHoldTicks); // the timed alternative is real, not theoretical
    p.bots[0]!.goTo(a.x, a.y); expectOk(esc(p, { action: 'press', switchId: 'smp_sw_a' }));
    expect(p.team.state().escape!.switches.find((s) => s.id === 'smp_sw_a')!.active).toBe(true);
    p.bots[0]!.goTo(sb.x, sb.y); expectOk(esc(p, { action: 'press', switchId: 'smp_sw_b' }));
    expect(p.team.state().escape!.doors.find((d) => d.id === 'sampler.r3_e')!.open).toBe(true);
  });

  it('two-person: a switch that went dark does not count; two players can hold both at once', () => {
    const p = inRoom(3); const b = p.bots[0]!;
    const { switchA: a, switchB: sb } = SAMPLER_AT;
    b.goTo(a.x, a.y); expectOk(esc(p, { action: 'press', switchId: 'smp_sw_a' }));
    p.team.idle(ESCAPE_LIMITS.switchHoldTicks + 5);
    expect(p.team.state().escape!.switches.find((s) => s.id === 'smp_sw_a')!.active).toBe(false);
    b.goTo(sb.x, sb.y); expectOk(esc(p, { action: 'press', switchId: 'smp_sw_b' }));
    expect(p.team.state().escape!.doors.find((d) => d.id === 'sampler.r3_e')!.open).toBe(false);
  });

  it('two-person, co-op: two players each press one switch at the same time', () => {
    const p = setup(2, 2);
    // bring both players to room 3 (rooms 0..2 solved by p0, p1 follows through the opened doors)
    const [a, b] = p.bots as [typeof p.bots[0], typeof p.bots[0]];
    const A = SAMPLER_AT;
    a.goTo(A.locker.x, A.locker.y); expectOk(itemAct(p, { action: 'open', stashId: 'smp_locker' })); expectOk(fetchItem(p, a, 'smp_key'));
    expectOk(useDoor(p, a, 'sampler.r0_e')); p.team.waitForRoom('p0', S[1]!);
    expectOk(useDoor(p, b, 'sampler.r0_e', 'p1')); p.team.waitForRoom('p1', S[1]!);
    a.goTo(A.codeClue.x, A.codeClue.y); expectOk(esc(p, { action: 'read', clueId: 'smp_code_clue' })); a.goTo(A.keypad.x, A.keypad.y);
    expectOk(esc(p, { action: 'enter_code', targetId: 'smp_keypad', code: digits(p.team.notes.at(-1)!.text) }));
    expectOk(useDoor(p, a, 'sampler.r1_e')); p.team.waitForRoom('p0', S[2]!);
    expectOk(useDoor(p, b, 'sampler.r1_e', 'p1')); p.team.waitForRoom('p1', S[2]!);
    expectOk(fetchItem(p, a, 'smp_battery')); expectOk(useDoor(p, a, 'sampler.r2_e')); p.team.waitForRoom('p0', S[3]!);
    expectOk(useDoor(p, b, 'sampler.r2_e', 'p1')); p.team.waitForRoom('p1', S[3]!);
    a.goTo(A.switchA.x, A.switchA.y); b.goTo(A.switchB.x, A.switchB.y);
    expectOk(esc(p, { action: 'press', switchId: 'smp_sw_a' }, 'p0'));
    expectOk(esc(p, { action: 'press', switchId: 'smp_sw_b' }, 'p1'));
    expect(p.team.state().escape!.doors.find((d) => d.id === 'sampler.r3_e')!.open).toBe(true);
  });

  it('safe: three notes spell the combination; the key is hidden until the safe opens; wrong tries lock it out', () => {
    const p = inRoom(4); const b = p.bots[0]!;
    expect(seen(p, 'smp_key_safe')).toBeUndefined();
    expect(useDoor(p, b, 'sampler.r4_e')).toEqual({ ok: false, error: 'Locked. Needs a key.' });
    const before = p.team.notes.length;
    SAMPLER_AT.safeClues.forEach((c, n) => { b.goTo(c.x, c.y); expectOk(esc(p, { action: 'read', clueId: `smp_s${n + 1}` })); });
    const combo = p.team.notes.slice(before).map((n) => digits(n.text)).join('');
    expect(combo).toBe(SAMPLER_COMBO);
    b.goTo(SAMPLER_AT.safe.x, SAMPLER_AT.safe.y);
    for (let i = 0; i < 2; i++) expect(esc(p, { action: 'enter_code', targetId: 'smp_safe', code: '000' })).toEqual({ ok: false, error: 'Wrong code.' });
    expect((esc(p, { action: 'enter_code', targetId: 'smp_safe', code: '111' }) as { error: string }).error).toMatch(/locks out/);
    p.team.idle(ESCAPE_LIMITS.lockoutTicks + 2);
    expectOk(esc(p, { action: 'enter_code', targetId: 'smp_safe', code: combo }));
    expect(seen(p, 'smp_key_safe')?.state).toBe('in_world');
    expectOk(fetchItem(p, b, 'smp_key_safe'));
    expectOk(useDoor(p, b, 'sampler.r4_e')); p.team.waitForRoom('p0', S[5]!);
  });

  it('all five lock types, one after another, solved by one player: the six-room sampler clears', () => {
    const p = setup(2);
    solveSampler(p, p.bots[0]!);
    expect(p.room.phase).toBe('stage_complete');
    expect(SAMPLER_GRAPH.rooms.length).toBe(6); // the room cap
  });
});

describe('P3D escape: refusals never tell hidden things from nothing', () => {
  it('a door, keypad, switch or clue in ANOTHER room is refused exactly like one that does not exist', () => {
    const p = setup(2); // player is in room 0 of the sampler; these all live elsewhere
    const same = (a: Parameters<typeof esc>[1], b: Parameters<typeof esc>[1]) => {
      const x = JSON.stringify(esc(p, a)), y = JSON.stringify(esc(p, b));
      expect(x).toBe(y);
      expect(x).toContain(ESCAPE_NOTHING);
    };
    same({ action: 'use_door', doorId: 'sampler.r3_e' }, { action: 'use_door', doorId: 'no_such_door' });
    same({ action: 'enter_code', targetId: 'smp_keypad', code: '1234' }, { action: 'enter_code', targetId: 'no_such_pad', code: '1234' });
    same({ action: 'enter_code', targetId: 'smp_safe', code: '123' }, { action: 'enter_code', targetId: 'no_such_safe', code: '123' });
    same({ action: 'press', switchId: 'smp_sw_a' }, { action: 'press', switchId: 'no_such_switch' });
    same({ action: 'read', clueId: 'smp_s1' }, { action: 'read', clueId: 'no_such_clue' });
  });

  it('a hidden part, a part in another room and a part that does not exist are refused with the same words', () => {
    const p = setup(2);
    const a = JSON.stringify(itemAct(p, { action: 'pickup', itemId: 'smp_key' })); // hidden in the locker
    const b = JSON.stringify(itemAct(p, { action: 'pickup', itemId: 'smp_battery' })); // lying in room 2
    const c = JSON.stringify(itemAct(p, { action: 'pickup', itemId: 'no_such_item' }));
    expect(a).toBe(b); expect(b).toBe(c);
    const d = JSON.stringify(itemAct(p, { action: 'open', stashId: 'no_such_stash' }));
    expect(d).toBe(JSON.stringify({ ok: false, error: 'Nothing there.' }));
  });

  it('a real thing in your own room but out of reach says so (you can see it anyway)', () => {
    const p = setup(true);
    const r = esc(p, { action: 'use_door', doorId: keyDoor });
    expect(r).toEqual({ ok: false, error: 'Too far away.' });
  });

  it('a player who is not in the run, and a refused flood, get plain refusals', () => {
    const p = setup(true);
    expect(p.room.escapeAction('stranger', { action: 'read', clueId: 'demo_stain' })).toEqual({ ok: false, error: 'You are not part of this run.' });
    esc(p, { action: 'read', clueId: 'demo_stain' });
    expect(p.room.escapeAction('p0', { action: 'read', clueId: 'demo_stain' })).toEqual({ ok: false, error: 'Too fast.' });
  });
});

describe('P3D escape: the validator', () => {
  const clone = (): StageDef => structuredClone(LOCK_SAMPLER_STAGE);
  const errorsOf = (mutate: (d: StageDef) => void): string[] => { const d = clone(); mutate(d); const g = d.rooms!; return validateEscape(d.escape!, g, d); };

  it('both dev stages pass, and no two neighbouring doors share a lock type', () => {
    for (const def of [ROOMS_DEMO_STAGE, LOCK_SAMPLER_STAGE]) expect(validateEscape(def.escape!, def.rooms!, def)).toEqual([]);
    const types = LOCK_SAMPLER_STAGE.escape!.links.map((l) => l.lock.type);
    expect(new Set(types).size).toBe(types.length); // five different locks in a row
    for (let i = 1; i < types.length; i++) expect(types[i]).not.toBe(types[i - 1]);
  });
  it('rejects the same lock type twice in a row', () => {
    const e = errorsOf((d) => { d.escape!.links[3]!.lock = { type: 'power' }; });
    expect(e.join('|')).toMatch(/two neighbouring doors both use the power lock/);
  });
  it('rejects a code whose clues do not spell it, and a clue beyond the door it opens', () => {
    expect(errorsOf((d) => { const l = d.escape!.links[1]!.lock; if (l.type === 'code') l.code = '0000'; }).join('|')).toMatch(/do not spell the code/);
    expect(errorsOf((d) => { d.escape!.clues.find((c) => c.id === 'smp_code_clue')!.room = S[4]!; d.escape!.clues.find((c) => c.id === 'smp_code_clue')!.y = 680; }).join('|')).toMatch(/clue smp_code_clue is beyond the door/);
  });
  it('rejects a door with no lock, a lock on no door, and two locks on one door', () => {
    expect(errorsOf((d) => { d.escape!.links.pop(); }).join('|')).toMatch(/has no lock/);
    expect(errorsOf((d) => { d.escape!.links[0]!.doors = ['sampler.r0_e', 'sampler.r3_w']; }).join('|')).toMatch(/not the two sides of one door/);
    expect(errorsOf((d) => { d.escape!.links[1]!.doors = ['sampler.r0_e', 'sampler.r1_w']; }).join('|')).toMatch(/more than one lock/);
  });
  it('rejects a key lock with no key on its near side, and a battery lock with only a decoy', () => {
    expect(errorsOf((d) => { d.items = d.items!.filter((i) => i.id !== 'smp_key'); }).join('|')).toMatch(/only 0 access_key/);
    expect(errorsOf((d) => { d.items!.find((i) => i.id === 'smp_battery')!.decoy = true; }).join('|')).toMatch(/only 0 battery/);
  });
  it('rejects two-person switches too far apart for one player, or in different rooms', () => {
    expect(errorsOf((d) => { d.escape!.switches[0]!.x = 100; d.escape!.switches[1]!.x = 1900; }).join('|')).toMatch(/too far apart for one player/);
    expect(errorsOf((d) => { d.escape!.switches[1]!.room = S[2]!; }).join('|')).toMatch(/both switches must be in one room/);
  });
  it('rejects a safe that holds no genuine key, or whose key is not hidden for it', () => {
    expect(errorsOf((d) => { d.items!.find((i) => i.id === 'smp_key_safe')!.decoy = true; }).join('|')).toMatch(/must hold a genuine access_key/);
    expect(errorsOf((d) => { delete d.items!.find((i) => i.id === 'smp_key_safe')!.hidden; }).join('|')).toMatch(/must be hidden for the safe/);
  });
  it('rejects objects that float, items in unknown rooms, and duplicate ids', () => {
    expect(errorsOf((d) => { d.escape!.keypads[0]!.y = 500; }).join('|')).toMatch(/keypad smp_keypad does not stand on a solid/);
    expect(errorsOf((d) => { d.items![2]!.room = 'nowhere'; }).join('|')).toMatch(/unknown room nowhere/);
    expect(errorsOf((d) => { d.escape!.clues[1]!.id = 'smp_code_clue'; }).join('|')).toMatch(/duplicate id smp_code_clue/);
  });
  it('a stage with an escape spec but no rooms, or no objectives and no escape, is refused', () => {
    expect(() => StageDefSchema.parse({ ...clone(), rooms: undefined })).not.toThrow(); // the schema is lenient...
    const noRooms = { ...clone(), rooms: undefined } as StageDef;
    const noEscape = { ...clone(), escape: undefined } as StageDef;
    // ...validateStageDef is what refuses them
    return import('../../src/systems/validate').then(({ validateStageDef }) => {
      expect(validateStageDef(noRooms, SAMPLER_GRAPH.rooms[0]!.arena).join('|')).toMatch(/needs rooms/);
      expect(validateStageDef(noEscape, SAMPLER_GRAPH.rooms[0]!.arena).join('|')).toMatch(/at least one objective/);
    });
  });
});
