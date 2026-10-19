import { describe, expect, it } from 'vitest';
import { ITEM_LIMITS, StageStateSchema } from '@wb/shared';
import { FIXTURE_ITEMS, FIXTURE_NEEDS, FIXTURE_STASHES, STASH_ITEM, itemHarness, part } from '../helpers/itemHarness';
import { NOTHING_THERE, NOT_CARRYING, NO_INSTALL_TARGET } from '../../src/salvage/system';

const err = (error: string) => ({ ok: false, error });

describe('hiding: the Phase Scanner reveals hidden parts in range', () => {
  it('a scan within its radius reveals a hidden part; one out of range does not', () => {
    const h = itemHarness();
    expect(h.item('hid_1')).toBeUndefined();
    h.at('a', 60, 680); // far from the part, the coupling and every clue
    expect(h.tool('a', 'phase_scanner')).toEqual({ ok: true, message: 'Nothing unusual in range.' });
    expect(h.item('hid_1')).toBeUndefined();
    h.run(60); // the scanner recharges
    h.at('a', 330, 590);
    expect(h.tool('a', 'phase_scanner').ok).toBe(true);
    expect(h.item('hid_1')).toMatchObject({ state: 'in_world', x: 320, y: 590 });
    expect(h.st().feed.map((f) => f.text)).toContain('Scanner: a hidden part came into focus.');
  });
  it('the scan message says so when only a hidden part was found', () => {
    const h = itemHarness({ needs: [] });
    h.at('a', 395, 590); // in range of the hidden part, just out of range of the coupling and the clues
    expect(h.tool('a', 'phase_scanner')).toEqual({ ok: true, message: 'The scan turned up hidden parts.' });
  });
  it('a revealed part is an ordinary part: it can be picked up', () => {
    const h = itemHarness();
    h.at('a', 330, 590); h.tool('a', 'phase_scanner');
    expect(h.pickup('a', 'hid_1').ok).toBe(true);
  });
  it('scanning does not reveal parts that are hidden in a stash', () => {
    const h = itemHarness({ items: [STASH_ITEM], stashes: FIXTURE_STASHES, needs: [] });
    h.at('a', 170, 590); h.tool('a', 'phase_scanner');
    expect(h.item('stash_fuse')).toBeUndefined();
  });
});

describe('hiding: stashes (crates, panels, lockers)', () => {
  const stashHarness = () => itemHarness({ items: [STASH_ITEM, part('plain', 'battery', 300, 590)], stashes: FIXTURE_STASHES, needs: [] });
  it('publishes every stash (full and empty look the same) and none of what they hold', () => {
    const h = stashHarness();
    const st = h.st().items!.stashes!;
    expect(st.map((s) => s.id)).toEqual(['crate_a', 'crate_b']);
    expect(st.every((s) => s.opened === false && s.label === 'Dented crate' && s.kind === 'crate')).toBe(true);
    expect(JSON.stringify(h.st())).not.toContain('stash_fuse');
    expect(() => StageStateSchema.parse(h.st())).not.toThrow();
  });
  it('opening a stash reveals what is inside; an empty one says so; reopening is refused', () => {
    const h = stashHarness();
    h.at('a', 165, 590);
    expect(h.open('a', 'crate_a')).toEqual({ ok: true, message: 'You open it. Something is inside.' });
    expect(h.item('stash_fuse')).toMatchObject({ state: 'in_world', x: 170, y: 590 });
    expect(h.st().items!.stashes![0]!.opened).toBe(true);
    expect(h.open('a', 'crate_a')).toEqual(err('That is already open.'));
    h.at('a', 375, 590);
    expect(h.open('a', 'crate_b')).toEqual({ ok: true, message: 'It is empty.' });
  });
  it('is refused out of range, and an unknown stash gets the shared "Nothing there."', () => {
    const h = stashHarness();
    expect(h.open('a', 'crate_a')).toEqual(err('Too far away.'));
    expect(h.open('a', 'ghost_crate')).toEqual(err(NOTHING_THERE));
    expect(h.item('stash_fuse')).toBeUndefined();
  });
  it('a part inside a stash is as invisible as a nonexistent one: identical refusals to every action', () => {
    const real = stashHarness(), fake = stashHarness();
    for (const h of [real, fake]) h.pickup('a', 'plain');
    const probe = (h: typeof real, id: string) => [
      { action: 'pickup', itemId: id }, { action: 'drop', itemId: id }, { action: 'swap', dropId: 'plain', pickId: id },
      { action: 'handover', itemId: id, toPlayerId: 'a' }, { action: 'install', itemId: id, targetId: 'cache' },
    ].map((a) => JSON.stringify(h.act('a', a as never)));
    expect(probe(real, 'stash_fuse')).toEqual(probe(fake, 'ghost_item'));
  });
});

describe('requirements are shown by clue clarity, only for targets the team has discovered', () => {
  it('nothing is listed until somebody stands near a target', () => {
    const h = itemHarness();
    expect(h.needs()).toEqual([]);
    h.at('a', 640, 680); h.run(2);
    expect(h.needs()!.map((n) => n.targetId)).toEqual(['cache']);
  });
  it('easy: names, tools and a hint line', () => {
    const h = itemHarness({ needs: [{ targetId: 'cache', items: ['fuse', 'battery'], tools: undefined, hint: 'Spares are kept on the west deck.' }] });
    h.at('a', 640, 680); h.run(2);
    expect(h.needs()![0]).toEqual({
      targetId: 'cache', label: 'Supply cache', satisfied: false, hint: 'Spares are kept on the west deck.', tools: [],
      parts: [
        { kind: 'fuse', label: 'Fuse', shape: 'small', installed: false },
        { kind: 'battery', label: 'Battery', shape: 'small', installed: false },
      ],
    });
  });
  it('intermediate: silhouettes only (no names, no hint), heavy parts look heavy', () => {
    const h = itemHarness({ difficulty: 'intermediate', needs: [{ targetId: 'cache', items: ['fuse', 'power_core'], hint: 'secret hint' }] });
    h.at('a', 640, 680); h.run(2);
    const n = h.needs()![0]!;
    expect(n.hint).toBeNull();
    expect(n.parts).toEqual([
      { kind: null, label: null, shape: 'small', installed: false },
      { kind: null, label: null, shape: 'heavy', installed: false },
    ]);
  });
  it('hardcore: nothing at all until the target is tried; then silhouettes and no tools', () => {
    const h = itemHarness({ difficulty: 'hardcore', needs: [{ targetId: 'cache', items: ['fuse', 'battery'], tools: undefined, hint: 'x' }] });
    h.at('a', 640, 680); h.run(2);
    expect(h.needs()).toEqual([]);
    expect(h.use('a', 'cache').ok).toBe(false); // a first attempt
    const n = h.needs()![0]!;
    expect(n.hint).toBeNull();
    expect(n.tools).toEqual([]);
    expect(n.parts.every((p) => p.kind === null && p.label === null)).toBe(true);
  });
  it('an installed part is shown by name at every clarity (it is plainly sitting there)', () => {
    const h = itemHarness({ difficulty: 'intermediate' });
    h.pickup('a', 'fuse_1');
    h.at('a', 640, 680);
    h.act('a', { action: 'install', itemId: 'fuse_1', targetId: 'cache' });
    const n = h.needs()!.find((x) => x.targetId === 'cache')!;
    expect(n.parts).toEqual([
      { kind: 'fuse', label: 'Fuse', shape: 'small', installed: true },
      { kind: null, label: null, shape: 'small', installed: false },
    ]);
    expect(n.satisfied).toBe(false);
  });
  it('a hidden (unrevealed) breakpoint never has its needs listed, even when somebody stands on it; it appears once revealed', () => {
    const h = itemHarness();
    h.at('a', 200, 410); h.run(3);
    expect(h.needs()!.some((n) => n.targetId === 'bp_coupling')).toBe(false);
    expect(JSON.stringify(h.st())).not.toContain('bp_coupling');
    h.scan('a'); h.at('a', 200, 410); h.run(3);
    expect(h.needs()!.find((n) => n.targetId === 'bp_coupling')!.parts[0]).toMatchObject({ kind: 'flux_coil', installed: false });
  });
  it('never lists a hidden part, the decoy flag or the item ids anywhere in needs', () => {
    const h = itemHarness();
    h.at('a', 640, 680); h.run(2);
    const json = JSON.stringify(h.needs());
    expect(json).not.toContain('hid_1');
    expect(json).not.toContain('decoy');
    expect(json).not.toContain('coil_bad');
  });
  it('the whole public state still validates against the schema', () => {
    const h = itemHarness({ stashes: FIXTURE_STASHES });
    h.at('a', 640, 680); h.run(2);
    expect(() => StageStateSchema.parse(h.st())).not.toThrow();
  });
});

describe('repairs and consoles wait for their parts', () => {
  const welderReady = (h: ReturnType<typeof itemHarness>) => { h.scan('a'); h.at('a', 200, 410); };
  it('the welder refuses a target that still needs parts, names them at easy, and spends nothing', () => {
    const h = itemHarness();
    welderReady(h);
    const charges = () => h.st().players[0]!.tools.find((t) => t.tool === 'flux_welder')!.charges;
    const before = charges();
    expect(h.tool('a', 'flux_welder', 'bp_coupling')).toEqual(err('It cannot be finished yet. Missing: Flux Coil.'));
    expect(charges()).toBe(before);
    expect(h.st().channels).toHaveLength(0);
  });
  it('intermediate counts parts; hardcore says only that something is missing', () => {
    const mid = itemHarness({ difficulty: 'intermediate' });
    welderReady(mid);
    expect(mid.tool('a', 'flux_welder', 'bp_coupling')).toEqual(err('It cannot be finished yet. It still needs 1 part.'));
    const hard = itemHarness({ difficulty: 'hardcore' });
    welderReady(hard);
    expect(hard.tool('a', 'flux_welder', 'bp_coupling')).toEqual(err('It will not take. Something is missing.'));
  });
  it('once the part is installed the weld goes through and finishes the repair', () => {
    const h = itemHarness();
    h.pickup('a', 'coil_ok');
    welderReady(h);
    expect(h.act('a', { action: 'install', itemId: 'coil_ok', targetId: 'bp_coupling' }).ok).toBe(true);
    expect(h.tool('a', 'flux_welder', 'bp_coupling').ok).toBe(true);
    h.run(90);
    expect(h.st().objectives.find((o) => o.id === 'o_root')!.status).toBe('complete');
  });
  it('a cracked part does not unlock the weld: it shatters, costs score, and the real part still works', () => {
    const h = itemHarness();
    h.pickup('a', 'coil_bad');
    welderReady(h);
    expect(h.act('a', { action: 'install', itemId: 'coil_bad', targetId: 'bp_coupling' }).ok).toBe(false);
    expect(h.breakdown().wrong_part).toBe(-25);
    expect(h.tool('a', 'flux_welder', 'bp_coupling').ok).toBe(false);
  });
  it('an unrevealed breakpoint and a nonexistent target get byte-identical answers from the welder and from install', () => {
    const real = itemHarness(), fake = itemHarness();
    for (const h of [real, fake]) { h.pickup('a', 'coil_ok'); h.at('a', 200, 410); }
    const a = [JSON.stringify(real.tool('a', 'flux_welder', 'bp_coupling')), JSON.stringify(real.act('a', { action: 'install', itemId: 'coil_ok', targetId: 'bp_coupling' }))];
    const b = [JSON.stringify(fake.tool('a', 'flux_welder', 'bp_ghost')), JSON.stringify(fake.act('a', { action: 'install', itemId: 'coil_ok', targetId: 'bp_ghost' }))];
    expect(a).toEqual(b);
    expect(a[1]).toBe(JSON.stringify(err(NO_INSTALL_TARGET)));
  });
  it('a console or cache that needs parts stays shut until they are installed', () => {
    const h = itemHarness();
    h.at('a', 640, 680);
    expect(h.use('a', 'cache')).toEqual(err('It cannot be finished yet. Missing: Fuse, Battery.'));
    h.at('a', 290, 590); h.pickup('a', 'fuse_1'); h.pickup('a', 'bat_1'); h.at('a', 640, 680);
    h.act('a', { action: 'install', itemId: 'fuse_1', targetId: 'cache' });
    h.act('a', { action: 'install', itemId: 'bat_1', targetId: 'cache' });
    const r = h.use('a', 'cache');
    expect(r.ok ? '' : r.error).not.toContain('cannot be finished');
  });
  it('targets without needs behave exactly as before', () => {
    const h = itemHarness();
    h.at('a', 90, 680); // the cache is at 640, so use a switch that has no needs
    h.at('a', 990, 590);
    expect(h.use('a', 'sw_1').ok).toBe(true);
  });
});

describe('cracked parts: a visible tell, only when the stage allows it', () => {
  const items = [part('coil_true', 'flux_coil', 250, 590), part('coil_tell', 'flux_coil', 270, 590, { decoy: true, tell: true }), part('coil_plain', 'flux_coil', 290, 590, { decoy: true })];
  const needs = [{ targetId: 'cache', items: ['flux_coil' as const] }];
  it('publishes `cracked` only for a decoy that has a tell, and never for a plain decoy or a genuine part', () => {
    const h = itemHarness({ items, needs });
    expect(h.item('coil_tell')!.cracked).toBe(true);
    expect(h.item('coil_plain')!.cracked).toBeUndefined();
    expect(h.item('coil_true')!.cracked).toBeUndefined();
    expect(JSON.stringify(h.st())).not.toContain('"decoy"');
  });
  it('is not shown in hardcore', () => {
    const h = itemHarness({ items, needs, difficulty: 'hardcore' });
    expect(h.item('coil_tell')!.cracked).toBeUndefined();
  });
});

describe('hazards can destroy a carried part (bounded and telegraphed)', () => {
  const armed = (d: { hazards: { id: string; armedWhenObjective?: string }[] }) => { delete d.hazards.find((x) => x.id === 'hz_arc')!.armedWhenObjective; };
  const gather = (h: ReturnType<typeof itemHarness>) => { h.pickup('a', 'coil_ok'); h.pickup('a', 'fuse_1'); h.at('a', 470, 320); };
  it('an unshielded discharge destroys exactly one carried part: the one picked up last', () => {
    const h = itemHarness({ mutate: armed });
    gather(h);
    const pulse = h.st().hazards.find((x) => x.id === 'hz_arc')!.nextPulseTick!;
    expect(pulse).toBeGreaterThan(h.e.tick); // telegraphed: the pulse tick is public before it lands
    h.run(pulse - h.e.tick + 1);
    expect(h.item('fuse_1')).toBeUndefined();
    expect(h.item('coil_ok')).toMatchObject({ state: 'carried' });
    expect(h.st().feed.map((f) => f.text)).toContain('The discharge fries the Fuse you were carrying.');
  });
  it('the next pulse spares the player (grace), and a later one takes the next part', () => {
    const h = itemHarness({ mutate: armed });
    gather(h);
    const first = h.st().hazards.find((x) => x.id === 'hz_arc')!.nextPulseTick!;
    h.run(first - h.e.tick + 1);
    h.run(ITEM_LIMITS.hazardGraceTicks - 10);
    expect(h.item('coil_ok')).toMatchObject({ state: 'carried' }); // still safe inside the grace window
    h.run(120);
    expect(h.item('coil_ok')).toBeUndefined();
  });
  it('a shield stops the loss', () => {
    const h = itemHarness({ mutate: armed });
    gather(h);
    expect(h.tool('a', 'shield_projector').ok).toBe(true);
    h.run(60);
    expect(h.item('fuse_1')).toMatchObject({ state: 'carried' });
    expect(h.item('coil_ok')).toMatchObject({ state: 'carried' });
  });
  it('a player outside the discharge radius, or carrying nothing, loses nothing', () => {
    const h = itemHarness({ ids: ['a', 'b'], mutate: armed });
    h.pickup('a', 'coil_ok');
    h.at('b', 470, 320);
    h.run(120);
    expect(h.item('coil_ok')).toMatchObject({ state: 'carried', carrierId: 'a' });
  });
  it('installed parts are never destroyed by a discharge', () => {
    const h = itemHarness({ mutate: armed });
    h.pickup('a', 'fuse_1'); h.at('a', 640, 680);
    h.act('a', { action: 'install', itemId: 'fuse_1', targetId: 'cache' });
    h.at('a', 470, 320);
    h.run(150);
    expect(h.item('fuse_1')).toMatchObject({ state: 'installed' });
  });
});

describe('unchanged behaviour', () => {
  it('the step-1 fixture still lists its visible items in order', () => {
    const h = itemHarness();
    expect(h.items().map((i) => i.id)).toEqual(FIXTURE_ITEMS.filter((i) => !i.hidden).map((i) => i.id));
    expect(FIXTURE_NEEDS).toHaveLength(2);
  });
  it('dropping what you do not carry still gives one text', () => {
    const h = itemHarness();
    expect(h.putDown('a', 'hid_1')).toEqual(err(NOT_CARRYING));
  });
});
