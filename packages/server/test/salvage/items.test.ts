import { describe, expect, it } from 'vitest';
import { ARENA, ITEM_LIMITS, StageStateSchema, type ItemAction } from '@wb/shared';
import { itemHarness, part } from '../helpers/itemHarness';
import { ItemSystem, NOT_CARRYING, NOTHING_THERE, NO_INSTALL_TARGET, NO_RECEIVER, type ItemHost } from '../../src/salvage/system';

const err = (error: string) => ({ ok: false, error });

describe('availability and public state', () => {
  it('a stage without items has no item state and refuses every intent', () => {
    const h = itemHarness({ mutate: (d) => { delete d.items; delete d.needs; } });
    expect(h.st().items).toBeUndefined();
    expect(h.pickup('a', 'coil_ok')).toEqual(err('There is nothing to carry in this stage.'));
  });
  it('an empty item list behaves like no items', () => {
    const h = itemHarness({ items: [], needs: [] });
    expect(h.st().items).toBeUndefined();
  });
  it('refuses unknown players, disconnected players and a stabilised stage', () => {
    const h = itemHarness();
    expect(h.e.itemAction('ghost', { action: 'pickup', itemId: 'coil_ok' }, () => undefined)).toEqual(err('You are not part of this run.'));
    h.drop('a');
    expect(h.pickup('a', 'coil_ok')).toEqual(err('You are not part of this run.'));
  });
  it('publishes visible items resting on their platform, never hidden ones, and validates against the public schema', () => {
    const h = itemHarness();
    const s = h.st();
    expect(() => StageStateSchema.parse(s)).not.toThrow();
    expect(s.items!.carrySlots).toBe(ITEM_LIMITS.carrySlots);
    expect(s.items!.items.map((i) => i.id)).toEqual(['core_1', 'coil_ok', 'coil_bad', 'fuse_1', 'bat_1', 'far_fuse']);
    expect(h.item('coil_ok')).toMatchObject({ kind: 'flux_coil', label: 'Flux Coil', slots: 1, state: 'in_world', x: 250, y: 590, carrierId: null, targetId: null });
    expect(h.item('core_1')).toMatchObject({ kind: 'power_core', slots: 2 });
    expect(h.item('far_fuse')).toMatchObject({ x: 700, y: 680 });
    expect(s.items!.players).toEqual([{ id: 'a', slotsUsed: 0, carried: [] }]);
  });
  it('an item authored a little above a platform rests on it (computed from the arena)', () => {
    const h = itemHarness({ items: [part('hover', 'fuse', 300, 570)], needs: [] });
    expect(h.item('hover')).toMatchObject({ x: 300, y: 590 });
  });
  it('never publishes the decoy flag or the hidden rule', () => {
    const h = itemHarness();
    const json = JSON.stringify(h.st());
    expect(json).not.toContain('"decoy"');
    expect(json).not.toContain('"hidden"');
    expect(json).not.toContain('hid_1');
  });
});

describe('pick up', () => {
  it('picks up a nearby item; it is then carried, not lying in the world', () => {
    const h = itemHarness();
    expect(h.pickup('a', 'coil_ok')).toEqual({ ok: true, message: 'Picked up the Flux Coil.' });
    expect(h.item('coil_ok')).toMatchObject({ state: 'carried', carrierId: 'a' });
    expect(h.mine('a')).toEqual({ id: 'a', slotsUsed: 1, carried: ['coil_ok'] });
  });
  it('is refused out of range, horizontally and vertically', () => {
    const h = itemHarness();
    expect(h.pickup('a', 'far_fuse')).toEqual(err('Too far away.'));
    h.at('a', 290, 450); // mid-air above the platform: 140 px too high
    expect(h.pickup('a', 'coil_ok')).toEqual(err('Too far away.'));
    h.at('a', 290, 590);
    expect(h.pickup('a', 'coil_ok').ok).toBe(true);
  });
  it('cannot take something somebody else carries, or something that is installed', () => {
    const h = itemHarness({ ids: ['a', 'b'] });
    expect(h.pickup('a', 'coil_ok').ok).toBe(true);
    expect(h.pickup('b', 'coil_ok')).toEqual(err('Someone else is carrying that.'));
    expect(h.pickup('a', 'coil_ok')).toEqual(err('You already have that.'));
  });
  it('enforces 2 slots: two light items fit, a third does not', () => {
    const h = itemHarness();
    expect(h.pickup('a', 'coil_ok').ok).toBe(true);
    expect(h.pickup('a', 'fuse_1').ok).toBe(true);
    expect(h.mine('a').slotsUsed).toBe(2);
    expect(h.pickup('a', 'bat_1')).toEqual(err('Your hands are full. Drop or swap something.'));
    expect(h.item('bat_1')!.state).toBe('in_world');
  });
  it('a heavy item uses both slots: needs empty hands and then blocks everything else', () => {
    const h = itemHarness();
    expect(h.pickup('a', 'coil_ok').ok).toBe(true);
    expect(h.pickup('a', 'core_1')).toEqual(err('That is heavy. It needs both hands free.'));
    expect(h.putDown('a', 'coil_ok').ok).toBe(true);
    h.run(ITEM_LIMITS.dropCooldownTicks);
    expect(h.pickup('a', 'core_1').ok).toBe(true);
    expect(h.mine('a').slotsUsed).toBe(2);
    expect(h.pickup('a', 'fuse_1')).toEqual(err('Your hands are full. Drop or swap something.'));
  });
  it('an explicit slots value overrides the kind default', () => {
    const h = itemHarness({ items: [part('big_fuse', 'fuse', 300, 590, { slots: 2 }), part('coil', 'flux_coil', 250, 590)], needs: [] });
    expect(h.item('big_fuse')!.slots).toBe(2);
    expect(h.pickup('a', 'coil').ok).toBe(true);
    expect(h.pickup('a', 'big_fuse')).toEqual(err('That is heavy. It needs both hands free.'));
  });
});

describe('drop', () => {
  it('drops at the player, resting on the first platform below (computed, deterministic)', () => {
    const h = itemHarness();
    h.pickup('a', 'coil_ok');
    h.at('a', 300, 450); // in the air above the low-left platform
    expect(h.putDown('a', 'coil_ok')).toEqual({ ok: true, message: 'Dropped the Flux Coil.' });
    expect(h.item('coil_ok')).toMatchObject({ state: 'in_world', x: 300, y: 590, carrierId: null });
    expect(h.mine('a').carried).toEqual([]);
  });
  it('dropping over open floor lands on the floor', () => {
    const h = itemHarness();
    h.pickup('a', 'fuse_1');
    h.at('a', 600, 600); // below the centre platform, above the floor
    h.putDown('a', 'fuse_1');
    expect(h.item('fuse_1')).toMatchObject({ x: 600, y: 680 });
  });
  it('refuses to drop what is not carried (lying, someone else\'s, unknown): one text for all', () => {
    const h = itemHarness({ ids: ['a', 'b'] });
    h.pickup('b', 'fuse_1');
    expect(h.putDown('a', 'coil_ok')).toEqual(err(NOT_CARRYING));
    expect(h.putDown('a', 'fuse_1')).toEqual(err(NOT_CARRYING));
    expect(h.putDown('a', 'nope')).toEqual(err(NOT_CARRYING));
  });
  it('after a drop the player must wait before picking anything up again', () => {
    const h = itemHarness();
    h.pickup('a', 'coil_ok');
    h.putDown('a', 'coil_ok');
    expect(h.pickup('a', 'coil_ok')).toEqual(err('Your hands are still busy. Wait a moment.'));
    h.run(ITEM_LIMITS.dropCooldownTicks);
    expect(h.pickup('a', 'coil_ok').ok).toBe(true);
  });
});

describe('swap', () => {
  it('with full hands, swaps one carried part for one lying nearby', () => {
    const h = itemHarness();
    h.pickup('a', 'coil_ok'); h.pickup('a', 'fuse_1');
    expect(h.act('a', { action: 'swap', dropId: 'fuse_1', pickId: 'bat_1' })).toEqual({ ok: true, message: 'Swapped the Fuse for the Battery.' });
    expect(h.item('fuse_1')).toMatchObject({ state: 'in_world', x: 290, y: 590 });
    expect(h.item('bat_1')).toMatchObject({ state: 'carried', carrierId: 'a' });
    expect(h.mine('a')).toEqual({ id: 'a', slotsUsed: 2, carried: ['coil_ok', 'bat_1'] });
  });
  it('refuses a swap that would not fit (heavy for light with another part in hand) and changes nothing', () => {
    const h = itemHarness();
    h.pickup('a', 'coil_ok'); h.pickup('a', 'fuse_1');
    expect(h.act('a', { action: 'swap', dropId: 'fuse_1', pickId: 'core_1' })).toEqual(err('That will not fit in your hands, even after dropping that.'));
    expect(h.mine('a').carried).toEqual(['coil_ok', 'fuse_1']);
    expect(h.item('core_1')!.state).toBe('in_world');
  });
  it('a lone light part can be swapped for a heavy one', () => {
    const h = itemHarness();
    h.pickup('a', 'coil_ok');
    expect(h.act('a', { action: 'swap', dropId: 'coil_ok', pickId: 'core_1' }).ok).toBe(true);
    expect(h.mine('a')).toEqual({ id: 'a', slotsUsed: 2, carried: ['core_1'] });
  });
  it('needs the dropped part to be carried and the new one to be in reach', () => {
    const h = itemHarness();
    h.pickup('a', 'coil_ok');
    expect(h.act('a', { action: 'swap', dropId: 'fuse_1', pickId: 'bat_1' })).toEqual(err(NOT_CARRYING));
    expect(h.act('a', { action: 'swap', dropId: 'coil_ok', pickId: 'far_fuse' })).toEqual(err('Too far away.'));
    expect(h.act('a', { action: 'swap', dropId: 'coil_ok', pickId: 'coil_ok' })).toEqual(err('You already have that.'));
    expect(h.mine('a').carried).toEqual(['coil_ok']);
  });
});

describe('hand over', () => {
  const two = () => { const h = itemHarness({ ids: ['a', 'b'] }); h.at('b', 350, 590); return h; };
  it('moves a carried part to a teammate in range', () => {
    const h = two();
    h.pickup('a', 'coil_ok');
    expect(h.act('a', { action: 'handover', itemId: 'coil_ok', toPlayerId: 'b' })).toEqual({ ok: true, message: 'Handed over the Flux Coil.' });
    expect(h.item('coil_ok')).toMatchObject({ state: 'carried', carrierId: 'b' });
    expect(h.mine('a').slotsUsed).toBe(0);
    expect(h.mine('b')).toEqual({ id: 'b', slotsUsed: 1, carried: ['coil_ok'] });
  });
  it('is refused out of range, to nobody, to yourself, to a disconnected player: and changes nothing', () => {
    const h = two();
    h.pickup('a', 'coil_ok');
    h.at('b', 700, 680);
    expect(h.act('a', { action: 'handover', itemId: 'coil_ok', toPlayerId: 'b' })).toEqual(err('Too far away.'));
    expect(h.act('a', { action: 'handover', itemId: 'coil_ok', toPlayerId: 'a' })).toEqual(err(NO_RECEIVER));
    expect(h.act('a', { action: 'handover', itemId: 'coil_ok', toPlayerId: 'ghost' })).toEqual(err(NO_RECEIVER));
    h.at('b', 350, 590); h.drop('b');
    expect(h.act('a', { action: 'handover', itemId: 'coil_ok', toPlayerId: 'b' })).toEqual(err(NO_RECEIVER));
    expect(h.item('coil_ok')!.carrierId).toBe('a');
  });
  it('respects the receiver\'s slots, heavy items included', () => {
    const h = two();
    h.at('b', 290, 590); // next to the parts, so b can pick them up
    h.pickup('b', 'coil_ok'); h.pickup('b', 'fuse_1');
    h.pickup('a', 'bat_1');
    expect(h.act('a', { action: 'handover', itemId: 'bat_1', toPlayerId: 'b' })).toEqual(err('Their hands are full.'));
    h.putDown('b', 'fuse_1'); // b now holds one part
    h.run(ITEM_LIMITS.dropCooldownTicks);
    h.putDown('a', 'bat_1'); h.run(ITEM_LIMITS.dropCooldownTicks);
    h.pickup('a', 'core_1');
    expect(h.act('a', { action: 'handover', itemId: 'core_1', toPlayerId: 'b' })).toEqual(err('Their hands are full.'));
  });
  it('cannot hand over what you do not carry; hidden, lying and unknown ids give one text', () => {
    const h = two();
    for (const id of ['coil_ok', 'hid_1', 'nope']) expect(h.act('a', { action: 'handover', itemId: id, toPlayerId: 'b' })).toEqual(err(NOT_CARRYING));
  });
  it('the giver waits before the next hand over', () => {
    const h = two();
    h.pickup('a', 'coil_ok'); h.pickup('a', 'fuse_1');
    expect(h.act('a', { action: 'handover', itemId: 'coil_ok', toPlayerId: 'b' }).ok).toBe(true);
    expect(h.act('a', { action: 'handover', itemId: 'fuse_1', toPlayerId: 'b' })).toEqual(err('You just handed something over. Wait a moment.'));
    h.run(ITEM_LIMITS.handoverCooldownTicks);
    expect(h.act('a', { action: 'handover', itemId: 'fuse_1', toPlayerId: 'b' }).ok).toBe(true);
  });
});

describe('rate limit and busy hands', () => {
  it('two intents inside the minimum gap: the second is "Too fast", accepted or refused alike', () => {
    const h = itemHarness();
    h.run(10);
    expect(h.actNow('a', { action: 'pickup', itemId: 'coil_ok' }).ok).toBe(true);
    expect(h.actNow('a', { action: 'pickup', itemId: 'fuse_1' })).toEqual(err('Too fast.'));
    h.run(ITEM_LIMITS.minGapTicks);
    expect(h.actNow('a', { action: 'pickup', itemId: 'far_fuse' })).toEqual(err('Too far away.'));
    expect(h.actNow('a', { action: 'pickup', itemId: 'fuse_1' })).toEqual(err('Too fast.')); // a refused intent also advances the clock
  });
  it('parts cannot be handled while channelling a repair', () => {
    const h = itemHarness();
    h.scan('a');
    h.at('a', 200, 410);
    expect(h.tool('a', 'flux_welder', 'bp_coupling').ok).toBe(true);
    expect(h.st().channels).toHaveLength(1);
    expect(h.pickup('a', 'coil_ok')).toEqual(err('Finish or cancel your current task first.'));
  });
});

describe('install', () => {
  const holdAtCache = (h: ReturnType<typeof itemHarness>, ...ids: string[]) => {
    for (const id of ids) expect(h.pickup('a', id).ok).toBe(true);
    h.at('a', 640, 680);
  };
  it('installs the right parts; the target is satisfied when every need is installed', () => {
    const h = itemHarness();
    holdAtCache(h, 'fuse_1', 'bat_1');
    expect(h.act('a', { action: 'install', itemId: 'fuse_1', targetId: 'cache' })).toEqual({ ok: true, message: 'Installed the Fuse.' });
    expect(h.item('fuse_1')).toMatchObject({ state: 'installed', carrierId: null, targetId: 'cache', x: 640, y: 680 });
    expect(h.sys().isSatisfied('cache')).toBe(false);
    expect(h.sys().remainingNeeds('cache')).toEqual(['battery']);
    expect(h.act('a', { action: 'install', itemId: 'bat_1', targetId: 'cache' }).ok).toBe(true);
    expect(h.sys().isSatisfied('cache')).toBe(true);
    expect(h.sys().remainingNeeds('cache')).toEqual([]);
    expect(h.mine('a').slotsUsed).toBe(0);
    expect(h.st().feed.map((f) => f.text)).toContain('Supply cache has every part it needs.');
  });
  it('a part of the wrong kind does not fit: refused, kept in hand, nothing lost', () => {
    const h = itemHarness();
    holdAtCache(h, 'coil_ok');
    expect(h.act('a', { action: 'install', itemId: 'coil_ok', targetId: 'cache' })).toEqual(err('The Flux Coil does not fit Supply cache.'));
    expect(h.item('coil_ok')).toMatchObject({ state: 'carried', carrierId: 'a' });
    expect(h.breakdown().wrong_part).toBeUndefined();
  });
  it('is refused too far from the target', () => {
    const h = itemHarness();
    h.pickup('a', 'fuse_1');
    expect(h.act('a', { action: 'install', itemId: 'fuse_1', targetId: 'cache' })).toEqual(err('Too far away.'));
  });
  it('a target without needs, an unknown target and an unrevealed breakpoint all give the same refusal', () => {
    const h = itemHarness();
    h.pickup('a', 'coil_ok');
    const results = ['lock_a', 'ghost_target', 'bp_coupling'].map((t) => h.act('a', { action: 'install', itemId: 'coil_ok', targetId: t }));
    for (const r of results) expect(r).toEqual(err(NO_INSTALL_TARGET));
  });
  it('after the coupling is revealed the coil installs on it', () => {
    const h = itemHarness();
    h.pickup('a', 'coil_ok');
    expect(h.scan('a').ok).toBe(true);
    h.at('a', 200, 410);
    expect(h.act('a', { action: 'install', itemId: 'coil_ok', targetId: 'bp_coupling' }).ok).toBe(true);
    expect(h.item('coil_ok')).toMatchObject({ state: 'installed', targetId: 'bp_coupling' });
  });
  it('a cracked (decoy) part is destroyed with a visible cost and does not satisfy the need', () => {
    const h = itemHarness();
    h.pickup('a', 'coil_bad');
    h.scan('a');
    h.at('a', 200, 410);
    const r = h.act('a', { action: 'install', itemId: 'coil_bad', targetId: 'bp_coupling' });
    expect(r).toEqual(err('The Flux Coil was cracked and shattered.'));
    expect(h.item('coil_bad')).toBeUndefined(); // destroyed items leave the public state
    expect(h.breakdown().wrong_part).toBe(-25);
    expect(h.sys().isSatisfied('bp_coupling')).toBe(false);
    expect(h.st().feed.some((f) => f.tone === 'bad' && f.text.includes('cracked'))).toBe(true);
    // the genuine coil still works
    h.at('a', 290, 590);
    h.pickup('a', 'coil_ok');
    h.at('a', 200, 410);
    expect(h.act('a', { action: 'install', itemId: 'coil_ok', targetId: 'bp_coupling' }).ok).toBe(true);
    expect(h.sys().isSatisfied('bp_coupling')).toBe(true);
  });
  it('once a target is satisfied nothing more is accepted (and a spare decoy is not wasted)', () => {
    const h = itemHarness();
    h.pickup('a', 'coil_ok'); h.pickup('a', 'coil_bad');
    h.scan('a');
    h.at('a', 200, 410);
    expect(h.act('a', { action: 'install', itemId: 'coil_ok', targetId: 'bp_coupling' }).ok).toBe(true);
    expect(h.act('a', { action: 'install', itemId: 'coil_bad', targetId: 'bp_coupling' })).toEqual(err('Nothing more is needed there.'));
    expect(h.item('coil_bad')).toMatchObject({ state: 'carried' });
  });
  it('needs are a multiset: two coils for one target need two installs', () => {
    const h = itemHarness({
      items: [part('c1', 'flux_coil', 250, 590), part('c2', 'flux_coil', 270, 590)],
      needs: [{ targetId: 'cache', items: ['flux_coil', 'flux_coil'] }],
    });
    h.pickup('a', 'c1'); h.pickup('a', 'c2');
    h.at('a', 640, 680);
    h.act('a', { action: 'install', itemId: 'c1', targetId: 'cache' });
    expect(h.sys().remainingNeeds('cache')).toEqual(['flux_coil']);
    h.act('a', { action: 'install', itemId: 'c2', targetId: 'cache' });
    expect(h.sys().isSatisfied('cache')).toBe(true);
  });
  it('cannot install a part you do not carry (lying, hidden, unknown: one text)', () => {
    const h = itemHarness();
    h.at('a', 640, 680);
    for (const id of ['fuse_1', 'hid_1', 'nope']) expect(h.act('a', { action: 'install', itemId: id, targetId: 'cache' })).toEqual(err(NOT_CARRYING));
  });
});

describe('hidden items never leak (byte-identical refusals)', () => {
  const probes = (h: ReturnType<typeof itemHarness>, id: string): ItemAction[] => [
    { action: 'pickup', itemId: id },
    { action: 'drop', itemId: id },
    { action: 'swap', dropId: 'fuse_1', pickId: id },
    { action: 'swap', dropId: id, pickId: 'bat_1' },
    { action: 'handover', itemId: id, toPlayerId: 'a' },
    { action: 'install', itemId: id, targetId: 'cache' },
  ].map((a) => a as ItemAction).filter(() => h !== undefined);
  it('a hidden item and a nonexistent item get exactly the same answer to every action', () => {
    const real = itemHarness();
    const fake = itemHarness();
    for (const h of [real, fake]) h.pickup('a', 'fuse_1');
    const a = probes(real, 'hid_1').map((p) => JSON.stringify(real.act('a', p)));
    const b = probes(fake, 'ghost_item').map((p) => JSON.stringify(fake.act('a', p)));
    expect(a).toEqual(b);
    expect(a.length).toBe(6);
  });
  it('the same holds for a destroyed item (it is gone, like a hidden one)', () => {
    const h = itemHarness();
    h.pickup('a', 'coil_bad');
    h.scan('a'); h.at('a', 200, 410);
    h.act('a', { action: 'install', itemId: 'coil_bad', targetId: 'bp_coupling' });
    const gone = JSON.stringify(h.act('a', { action: 'pickup', itemId: 'coil_bad' }));
    const never = JSON.stringify(h.act('a', { action: 'pickup', itemId: 'ghost_item' }));
    expect(gone).toBe(never);
    expect(gone).toBe(JSON.stringify(err(NOTHING_THERE)));
  });
  it('a hidden item is not in any public state, and appears once revealed', () => {
    const h = itemHarness();
    expect(JSON.stringify(h.st())).not.toContain('hid_1');
    expect(h.sys().stateOf('hid_1')).toBe('hidden');
    expect(h.sys().reveal('hid_1')).toBe(true);
    expect(h.sys().reveal('hid_1')).toBe(false);
    expect(h.item('hid_1')).toMatchObject({ state: 'in_world', x: 320, y: 590 });
    expect(h.pickup('a', 'hid_1').ok).toBe(true);
  });
  it('a refused action on a hidden item changes no public state', () => {
    const h = itemHarness();
    h.run(10);
    const before = JSON.stringify(h.st().items);
    h.pickup('a', 'hid_1');
    expect(JSON.stringify(h.st().items)).toBe(before);
  });
});

describe('disconnect and leaving', () => {
  it('a disconnect drops every carried part at the last safe position', () => {
    const h = itemHarness({ ids: ['a', 'b'] });
    h.pickup('a', 'coil_ok'); h.pickup('a', 'fuse_1');
    h.at('a', 700, 300); // mid-air: not a safe spot
    h.run(5);
    h.drop('a');
    expect(h.item('coil_ok')).toMatchObject({ state: 'in_world', x: 290, y: 590, carrierId: null });
    expect(h.item('fuse_1')).toMatchObject({ state: 'in_world', x: 290, y: 590 });
    expect(h.mine('a')).toEqual({ id: 'a', slotsUsed: 0, carried: [] });
    expect(h.st().feed.map((f) => f.text)).toContain('A teammate lost their link and dropped 2 parts.');
    h.at('b', 290, 590);
    expect(h.pickup('b', 'coil_ok').ok).toBe(true); // a teammate can pick it up
  });
  it('the last safe position ignores spots inside an armed hazard', () => {
    const h = itemHarness({ mutate: (d) => { const hz = d.hazards.find((x) => x.id === 'hz_arc')!; delete hz.armedWhenObjective; } });
    h.pickup('a', 'coil_ok');
    h.at('a', 470, 320); // on the top-left platform, inside the always-armed arc hazard
    h.run(3);
    h.drop('a');
    expect(h.item('coil_ok')).toMatchObject({ state: 'in_world', x: 290, y: 590 });
  });
  it('a player who never stood anywhere safe drops at the arena spawn point', () => {
    const host: ItemHost = {
      tick: 100, say: () => {}, markDirty: () => {}, award: () => {}, wrongPartCost: () => 0,
      installTarget: () => null, busy: () => false, unsafeAt: () => false,
    };
    const sys = new ItemSystem([part('p1', 'fuse', 290, 590)], [], ARENA, host);
    sys.addPlayer('p');
    const me = { x: 290, y: 590, connected: true };
    expect(sys.use('p', { action: 'pickup', itemId: 'p1' }, me, () => me).ok).toBe(true);
    sys.onDisconnect('p'); // step() never ran, so there is no remembered safe spot
    expect(sys.publicState().items[0]).toMatchObject({ state: 'in_world', x: ARENA.spawns[0]!.x, y: ARENA.spawns[0]!.y });
  });
  it('removing a player (leave / reset) drops their parts too', () => {
    const h = itemHarness({ ids: ['a', 'b'] });
    h.pickup('a', 'bat_1');
    h.e.removePlayer('a');
    expect(h.item('bat_1')).toMatchObject({ state: 'in_world', x: 290, y: 590 });
    expect(h.st().items!.players.map((p) => p.id)).toEqual(['b']);
  });
  it('a disconnect with empty hands says nothing', () => {
    const h = itemHarness();
    const feedBefore = h.st().feed.length;
    h.drop('a');
    expect(h.st().feed).toHaveLength(feedBefore);
  });
});

describe('determinism', () => {
  const script = () => {
    const h = itemHarness({ ids: ['a', 'b'] });
    h.at('b', 350, 590);
    h.pickup('a', 'coil_ok'); h.pickup('a', 'fuse_1');
    h.act('a', { action: 'swap', dropId: 'fuse_1', pickId: 'bat_1' });
    h.act('a', { action: 'handover', itemId: 'bat_1', toPlayerId: 'b' });
    h.at('a', 640, 680);
    h.act('a', { action: 'install', itemId: 'coil_ok', targetId: 'cache' });
    h.run(30);
    return JSON.stringify(h.st());
  };
  it('the same actions always produce the same public state', () => {
    expect(script()).toBe(script());
  });
});
