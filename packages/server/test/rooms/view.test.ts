import { describe, expect, it } from 'vitest';
import { ESCAPE_NOTHING, GameSnapshotSchema, StageStateSchema, visionRadius, type GameSnapshot, type RoomDef, type RoomGraph, type StageState } from '@wb/shared';
import { Room } from '../../src/room';
import { SAMPLER_AT, SAMPLER_GRAPH, SAMPLER_IDS } from '../../src/rooms/demoStage';
import { restrictedView, type ViewSource } from '../../src/rooms/view';
import { digits, esc, expectOk, fetchItem, itemAct, setup, useDoor, type Play } from './flows';

const S = SAMPLER_IDS;
const A = SAMPLER_AT;
const ids = (xs: readonly { id: string }[] | undefined): string[] => (xs ?? []).map((x) => x.id).sort();
const viewOf = (p: Play, id: string) => {
  const v = p.room.viewFor(id);
  if (!v) throw new Error('no restricted view');
  return { snapshot: GameSnapshotSchema.parse(v.snapshot), stage: StageStateSchema.parse(v.stage) };
};

/** Sampler, 2 players. p0 opens the locker, takes the key and goes through door 0 into room 1; p1 stays in room 0. */
function p0InRoom1(): Play {
  const p = setup(2, 2); const a = p.bots[0]!;
  a.goTo(A.locker.x, A.locker.y); expectOk(itemAct(p, { action: 'open', stashId: 'smp_locker' })); expectOk(fetchItem(p, a, 'smp_key'));
  expectOk(useDoor(p, a, 'sampler.r0_e')); p.team.waitForRoom('p0', S[1]!);
  return p;
}
/** p0 in room 2 (key and code solved), standing at its arrival point. */
function p0InRoom2(): Play {
  const p = p0InRoom1(); const a = p.bots[0]!;
  a.goTo(A.codeClue.x, A.codeClue.y); expectOk(esc(p, { action: 'read', clueId: 'smp_code_clue' }));
  a.goTo(A.keypad.x, A.keypad.y); expectOk(esc(p, { action: 'enter_code', targetId: 'smp_keypad', code: digits(p.team.notes.at(-1)!.text) }));
  expectOk(useDoor(p, a, 'sampler.r1_e')); p.team.waitForRoom('p0', S[2]!);
  return p;
}

describe('P3D step 4: only what a player can see is sent to them', () => {
  it('a hidden part is in nobody\'s view; once revealed it is in the view of those who can see it', () => {
    const p = setup(2, 2); const a = p.bots[0]!;
    for (const who of ['p0', 'p1']) expect(ids(viewOf(p, who).stage.items?.items)).not.toContain('smp_key');
    a.goTo(A.locker.x, A.locker.y);
    expect(ids(viewOf(p, 'p0').stage.items?.stashes)).toContain('smp_locker'); // the locker itself is a visible thing
    expect(JSON.stringify(viewOf(p, 'p1').stage)).not.toContain('smp_key"');
    expectOk(itemAct(p, { action: 'open', stashId: 'smp_locker' }));
    p.team.idle(2);
    expect(ids(viewOf(p, 'p0').stage.items?.items)).toContain('smp_key');
    expect(ids(viewOf(p, 'p1').stage.items?.items)).toContain('smp_key'); // p1 stands 70 px away in the open: it sees it too
  });

  it('parts of a safe, other rooms and a locker you cannot see are not in the state at all', () => {
    const p = setup(2, 2);
    const items = ids(viewOf(p, 'p0').stage.items?.items);
    for (const hidden of ['smp_key', 'smp_battery', 'smp_key_safe']) expect(items).not.toContain(hidden);
    p.bots[0]!.goTo(1500, 680); // far from the locker: out of reach of the radius
    expect(ids(viewOf(p, 'p0').stage.items?.stashes)).not.toContain('smp_locker');
    expect(JSON.stringify(viewOf(p, 'p0').stage)).not.toContain('smp_locker');
  });

  it('another room is never in the snapshot: not its objects, not its players', () => {
    const p = p0InRoom1();
    const v1 = viewOf(p, 'p1'); // still in room 0
    expect(ids(v1.snapshot.players)).toEqual(['p1']); // p0 is in another room
    expect(v1.snapshot.team?.map((t) => t.id).sort()).toEqual(['p0', 'p1']); // but still on the team list
    expect(JSON.stringify(v1.stage)).not.toContain(S[1]!);
    expect(v1.stage.escape?.keypads).toEqual([]); // the keypad is in room 1
    expect(v1.stage.escape?.exit).toBeUndefined();
    const v0 = viewOf(p, 'p0');
    expect(ids(v0.snapshot.players)).toEqual(['p0']);
    expect(ids(v0.stage.items?.items)).not.toContain('smp_key_cracked'); // that one lies in room 0
    expect(ids(v0.stage.items?.stashes)).toEqual([]);
  });

  it('keypads and notes appear only inside the vision radius, and vanish as you walk away', () => {
    const p = p0InRoom1(); const a = p.bots[0]!;
    const r = visionRadius('easy', 1);
    expect(r).toBe(460);
    // arrival (x 200): the note at x 700 is 500 px away, the keypad at x 1700 far beyond
    let es = viewOf(p, 'p0').stage.escape!;
    expect(ids(es.clues)).toEqual([]); expect(ids(es.keypads)).toEqual([]);
    a.goTo(A.codeClue.x - 250, A.codeClue.y);
    es = viewOf(p, 'p0').stage.escape!;
    expect(ids(es.clues)).toEqual(['smp_code_clue']); expect(ids(es.keypads)).toEqual([]);
    a.goTo(A.keypad.x - 200, A.keypad.y);
    es = viewOf(p, 'p0').stage.escape!;
    expect(ids(es.keypads)).toEqual(['smp_keypad']); expect(ids(es.clues)).toEqual([]);
  });

  it('a platform between you and a part hides it; standing on the platform shows it', () => {
    const p = p0InRoom2(); const a = p.bots[0]!;
    a.goTo(700, 680); // beside the platform that carries the battery: 217 px away, in radius, but the platform is in the way
    expect(ids(viewOf(p, 'p0').stage.items?.items)).not.toContain('smp_battery');
    a.goTo(A.battery.x, A.battery.y); // up on it
    expect(ids(viewOf(p, 'p0').stage.items?.items)).toContain('smp_battery');
  });

  it('teammates: far ones leave the snapshot (not the team list); inventories are never shown; a teammate\'s carried part is hidden', () => {
    const p = setup(2, 2); const a = p.bots[0]!;
    a.goTo(A.locker.x, A.locker.y); expectOk(itemAct(p, { action: 'open', stashId: 'smp_locker' })); expectOk(fetchItem(p, a, 'smp_key'));
    const own = viewOf(p, 'p0');
    expect(own.stage.items?.players.map((x) => x.id)).toEqual(['p0']);
    expect(own.stage.items?.items.find((i) => i.id === 'smp_key')?.state).toBe('carried');
    const other = viewOf(p, 'p1');
    expect(other.stage.items?.players.map((x) => x.id)).toEqual(['p1']); // p1 sees its own hands and nobody else's, not even p0's slot count
    expect(other.stage.items?.items.find((i) => i.id === 'smp_key')).toBeUndefined(); // p0's hands are p0's business
    expect(other.stage.players.map((x) => x.id)).toEqual(['p1']);
    expect(ids(other.snapshot.players)).toEqual(['p0', 'p1']); // p0 is close and in the open: visible as a body
    // now p0 walks far away
    a.goTo(1700, 680);
    const far = viewOf(p, 'p1');
    expect(ids(far.snapshot.players)).toEqual(['p1']);
    expect(far.snapshot.team).toEqual([
      { id: 'p0', name: 'P0', slot: 0, connected: true },
      { id: 'p1', name: 'P1', slot: 1, connected: true },
    ]); // names, slots, connection: no position, no inventory
  });

  it('feed messages belong to the room they happened in', () => {
    const p = p0InRoom1();
    const text = (v: ReturnType<typeof viewOf>) => v.stage.feed.map((f) => f.text).join('|');
    expect(text(viewOf(p, 'p1'))).toContain('The key turns'); // p1 is in room 0, where it happened
    expect(text(viewOf(p, 'p0'))).not.toContain('The key turns'); // p0 left that room
  });

  it('a non-escape stage is not restricted at all', () => {
    const r = new Room('ABCD', 3, 7, {});
    r.join('p0', 'P0');
    expect(r.start('p0').ok).toBe(true);
    expect(r.restrictsViews).toBe(false);
    expect(r.viewFor('p0')).toBeNull();
  });
});

describe('P3D step 4: refusals do not tell hidden from nothing', () => {
  it('a part or container you cannot see is refused exactly like one that does not exist; one you can see says it is too far', () => {
    const p = setup(2); const a = p.bots[0]!;
    a.goTo(1500, 680); // the locker (x 420) and the cracked key (x 760) are far out of view
    const same = (x: unknown, y: unknown) => { expect(JSON.stringify(x)).toBe(JSON.stringify(y)); expect(JSON.stringify(x)).toContain('Nothing there.'); };
    same(itemAct(p, { action: 'open', stashId: 'smp_locker' }), itemAct(p, { action: 'open', stashId: 'no_such_stash' }));
    same(itemAct(p, { action: 'pickup', itemId: 'smp_key_cracked' }), itemAct(p, { action: 'pickup', itemId: 'no_such_item' }));
    same(itemAct(p, { action: 'pickup', itemId: 'smp_key' }), itemAct(p, { action: 'pickup', itemId: 'no_such_item' })); // hidden
    a.goTo(1000, 680); // the cracked key is now 240 px away: in view, out of reach
    expect(itemAct(p, { action: 'pickup', itemId: 'smp_key_cracked' })).toEqual({ ok: false, error: 'Too far away.' });
  });

  it('a keypad or note in your own room but out of view is refused like a nonexistent one', () => {
    const p = p0InRoom1(); const a = p.bots[0]!; // arrival: the note (x 700) and keypad (x 1700) are out of view
    const same = (x: unknown, y: unknown) => { expect(JSON.stringify(x)).toBe(JSON.stringify(y)); expect(JSON.stringify(x)).toContain(ESCAPE_NOTHING); };
    same(esc(p, { action: 'read', clueId: 'smp_code_clue' }), esc(p, { action: 'read', clueId: 'no_such_clue' }));
    same(esc(p, { action: 'enter_code', targetId: 'smp_keypad', code: '1234' }), esc(p, { action: 'enter_code', targetId: 'no_such_pad', code: '1234' }));
    a.goTo(A.codeClue.x - 250, A.codeClue.y); // the note is in view now, 250 px away
    expect(esc(p, { action: 'read', clueId: 'smp_code_clue' })).toEqual({ ok: false, error: 'Too far away.' });
  });
});

describe('P3D step 4: the restricted view is a function a spectator can reuse', () => {
  const source = (p: Play): ViewSource => ({ snapshot: p.room.gameSnapshot()!, stage: p.team.state(), graph: SAMPLER_GRAPH, radius: visionRadius('easy', 1) });

  it('another pair of eyes sees from there and shows nobody\'s inventory', () => {
    const p = setup(2, 2); const a = p.bots[0]!;
    a.goTo(A.locker.x, A.locker.y); expectOk(itemAct(p, { action: 'open', stashId: 'smp_locker' })); expectOk(fetchItem(p, a, 'smp_key'));
    p.team.idle(2);
    const spec = restrictedView(source(p), { eyes: 'p1', self: null });
    expect(spec.stage.items?.players).toEqual([]);
    expect(spec.stage.items?.items.find((i) => i.id === 'smp_key')).toBeUndefined(); // carried by p0: an inventory
    expect(ids(spec.snapshot.players)).toEqual(['p0', 'p1']); // bodies in view
    expect(spec.snapshot.team?.length).toBe(2);
    const asP1 = restrictedView(source(p), { eyes: 'p1', self: 'p1' });
    expect(ids(asP1.stage.items?.stashes)).toEqual(ids(spec.stage.items?.stashes)); // same eyes, same world
  });

  it('eyes that are not in any room see no objects at all', () => {
    const p = setup(2, 2);
    const nobody = restrictedView(source(p), { eyes: 'nobody', self: null });
    expect(nobody.snapshot.players).toEqual([]);
    expect(nobody.stage.items).toBeUndefined();
    expect(nobody.stage.escape).toBeUndefined();
    expect(nobody.snapshot.team?.length).toBe(2); // the team list is not a view of the world
  });

  it('the radius parameter is honoured', () => {
    const p = setup(2, 2);
    const wide = restrictedView(source(p), { eyes: 'p0', self: 'p0' });
    const narrow = restrictedView({ ...source(p), radius: 60 }, { eyes: 'p0', self: 'p0' });
    expect(ids(wide.stage.items?.stashes)).toEqual(['smp_locker']); // 120 px away
    expect(ids(narrow.stage.items?.stashes)).toEqual([]);
  });
});

describe('P3D step 4: a closed door blocks sight, an open one does not', () => {
  const room: RoomDef = {
    id: 'r', doors: [{ id: 'd_mid', x: 900, y: 580, w: 40, h: 100, to: 'elsewhere', arrive: { x: 10, y: 680 } }],
    arena: { id: 'r', name: 'r', width: 1920, height: 720, solids: [{ x: 0, y: 680, w: 1920, h: 40 }], spawns: [100, 150, 200, 250].map((x) => ({ x, y: 680 })) },
  };
  const graph: RoomGraph = { start: 'r', rooms: [room] };
  const player = (id: string, x: number) => ({ id, name: id, slot: id === 'a' ? 0 : 1, x, y: 680, vx: 0, vy: 0, facing: 1 as const, grounded: true, connected: true, ack: 0, roomId: 'r' });
  const snapshot: GameSnapshot = { tick: 0, simTimeMs: 0, epoch: 0, phase: 'playing', briefingMs: 0, stage: 1, arenaId: 'r', players: [player('a', 800), player('b', 1100)] };
  const stage = (open: boolean): StageState => ({
    players: [], feed: [],
    items: { carrySlots: 2, players: [], items: [{ id: 'key', kind: 'access_key', state: 'in_world', x: 1100, y: 680, carrierId: null, targetId: null, slots: 1, roomId: 'r' }] },
    escape: { doors: [{ id: 'd_mid', room: 'r', open, need: null }], keypads: [], safes: [], clues: [], switches: [], exit: { room: 'r', x: 1200, y: 680 } },
  } as unknown as StageState);
  const view = (open: boolean) => restrictedView({ snapshot, stage: stage(open), graph, radius: 460 }, { eyes: 'a', self: 'a' });

  it('a part and a teammate behind a closed door are not sent; the door itself is', () => {
    const v = view(false);
    expect(ids(v.stage.items?.items)).toEqual([]);
    expect(ids(v.snapshot.players)).toEqual(['a']);
    expect(ids(v.stage.escape?.doors)).toEqual(['d_mid']);
    expect(v.stage.escape?.exit).toBeUndefined(); // the exit behind it is hidden too
  });
  it('once the door is open they are', () => {
    const v = view(true);
    expect(ids(v.stage.items?.items)).toEqual(['key']);
    expect(ids(v.snapshot.players)).toEqual(['a', 'b']);
    expect(v.stage.escape?.exit?.x).toBe(1200);
  });
});
