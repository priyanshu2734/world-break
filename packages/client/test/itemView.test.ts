import { describe, expect, it } from 'vitest';
import { ITEM_KINDS, ITEM_LIMITS, type ItemsPublic, type StageState } from '@wb/shared';
import { COLOR } from '../src/palette';
import {
  ITEM_SHAPE, TONE_COLOR, carryChanges, carryView, carriedItems, dropIntent, handoverIntent, installIntent, itemPrompt, itemTone, needPrompts,
  nearestItem, nearestStash, nearestTeammate, pickIntent, stashTone,
} from '../src/ui/itemView';

type Item = ItemsPublic['items'][number];
const item = (id: string, kind: Item['kind'], x: number, extra: Partial<Item> = {}): Item => ({
  id, kind, label: kind === 'flux_coil' ? 'Flux Coil' : kind === 'fuse' ? 'Fuse' : kind === 'battery' ? 'Battery' : 'Power Core',
  slots: kind === 'power_core' ? 2 : 1, state: 'in_world', x, y: 590, carrierId: null, targetId: null, ...extra,
});

function stateWith(items: ItemsPublic): StageState {
  return {
    rev: 1, stageId: 't', name: 't', status: 'running', tick: 0, deadlineTick: 100, expired: false,
    score: { total: 0, breakdown: {} }, objectives: [], symptoms: [], clues: [], feed: [], effects: [], channels: [], players: [], hazards: [],
    breakpoints: [{ id: 'bp', label: 'Cracked flux coupling', x: 200, y: 410, repaired: false, progress: 0 }],
    entities: [{ id: 'sw', kind: 'power_switch', label: 'Breaker 2', x: 1080, y: 590, state: 'open', armedUntilTick: null, locked: false }],
    power: { capacity: 1, load: 0, nodes: [], conduits: [] },
    items,
  };
}
const empty = (extra: Partial<ItemsPublic> = {}): ItemsPublic => ({ carrySlots: 2, items: [], players: [{ id: 'me', slotsUsed: 0, carried: [] }], ...extra });
const need = (over: Partial<NonNullable<ItemsPublic['needs']>[number]> = {}): NonNullable<ItemsPublic['needs']>[number] => ({
  targetId: 'bp', label: 'Cracked flux coupling', satisfied: false, hint: 'Spare parts are racked in lockers on the upper decks.', tools: [],
  parts: [{ kind: 'flux_coil', label: 'Flux Coil', shape: 'small', installed: false }], ...over,
});

describe('colour language and shapes', () => {
  it('every part kind has its own silhouette', () => {
    const shapes = ITEM_KINDS.map((k) => ITEM_SHAPE[k]);
    expect(new Set(shapes).size).toBe(ITEM_KINDS.length);
  });
  it('red = danger (cracked), cyan = interactive, green = repaired (installed), amber = a closed stash', () => {
    expect(itemTone({ state: 'in_world', cracked: true })).toBe('danger');
    expect(itemTone({ state: 'in_world' })).toBe('cyan');
    expect(itemTone({ state: 'carried' })).toBe('cyan');
    expect(itemTone({ state: 'installed' })).toBe('green');
    expect(itemTone({ state: 'installed', cracked: true })).toBe('green');
    expect(stashTone({ opened: false })).toBe('amber');
    expect(stashTone({ opened: true })).toBe('cyan');
    expect(TONE_COLOR.danger).toBe(COLOR.danger);
    expect(TONE_COLOR.cyan).toBe(COLOR.cyan);
    expect(TONE_COLOR.amber).toBe(COLOR.amber);
    expect(TONE_COLOR.green).toBe(COLOR.green);
    expect(new Set(Object.values(TONE_COLOR)).size).toBe(4);
  });
});

describe('carry slots', () => {
  it('shows two empty slots when nothing is carried, and nothing on a stage without parts', () => {
    expect(carryView(stateWith(empty()), 'me')).toEqual({ max: 2, used: 0, cells: [{ kind: 'empty' }, { kind: 'empty' }] });
    expect(carryView({ items: undefined }, 'me')).toBeNull();
    expect(carryView(null, 'me')).toBeNull();
    expect(carryView(stateWith(empty()), 'stranger')).toBeNull();
  });
  it('fills slots in pick-up order and marks a cracked part', () => {
    const items = empty({
      items: [item('a', 'fuse', 0, { state: 'carried', carrierId: 'me' }), item('b', 'flux_coil', 0, { state: 'carried', carrierId: 'me', cracked: true })],
      players: [{ id: 'me', slotsUsed: 2, carried: ['a', 'b'] }],
    });
    const v = carryView(stateWith(items), 'me')!;
    expect(v.used).toBe(2);
    expect(v.cells.map((c) => c.kind)).toEqual(['part', 'part']);
    expect(v.cells[1]).toMatchObject({ itemId: 'b', cracked: true, shape: ITEM_SHAPE.flux_coil, span: 1 });
  });
  it('a heavy part spans both slots', () => {
    const items = empty({ items: [item('core', 'power_core', 0, { state: 'carried', carrierId: 'me' })], players: [{ id: 'me', slotsUsed: 2, carried: ['core'] }] });
    const v = carryView(stateWith(items), 'me')!;
    expect(v.cells).toMatchObject([{ kind: 'part', span: 2, shape: 'block' }, { kind: 'covered' }]);
    expect(v.used).toBe(2);
  });
  it('lists only the local player\'s parts', () => {
    const items = empty({
      items: [item('a', 'fuse', 0, { state: 'carried', carrierId: 'you' })],
      players: [{ id: 'me', slotsUsed: 0, carried: [] }, { id: 'you', slotsUsed: 1, carried: ['a'] }],
    });
    expect(carriedItems(stateWith(items), 'me')).toEqual([]);
    expect(carriedItems(stateWith(items), 'you').map((i) => i.id)).toEqual(['a']);
  });
});

describe('"Needs: ..." prompts', () => {
  it('names the missing parts of a discovered target at the target\'s position', () => {
    const st = stateWith(empty({ needs: [need()] }));
    expect(needPrompts(st)).toEqual([{ targetId: 'bp', label: 'Cracked flux coupling', x: 200, y: 410, text: 'Needs: Flux Coil', hint: 'Spare parts are racked in lockers on the upper decks.', satisfied: false }]);
  });
  it('falls back to silhouettes when the server shows no names, and never invents a kind', () => {
    const st = stateWith(empty({ needs: [need({ hint: null, parts: [{ kind: null, label: null, shape: 'small', installed: false }, { kind: null, label: null, shape: 'heavy', installed: false }] })] }));
    const p = needPrompts(st)[0]!;
    expect(p.text).toBe('Needs: a small part, a heavy part');
    expect(p.hint).toBeNull();
  });
  it('lists only what is still missing, and turns to "Parts fitted" when satisfied', () => {
    const two = need({ parts: [{ kind: 'fuse', label: 'Fuse', shape: 'small', installed: true }, { kind: 'battery', label: 'Battery', shape: 'small', installed: false }] });
    expect(needPrompts(stateWith(empty({ needs: [two] })))[0]!.text).toBe('Needs: Battery');
    const done = need({ satisfied: true, parts: [{ kind: 'flux_coil', label: 'Flux Coil', shape: 'small', installed: true }] });
    expect(needPrompts(stateWith(empty({ needs: [done] })))[0]).toMatchObject({ text: 'Parts fitted', satisfied: true, hint: null });
  });
  it('shows nothing for undiscovered targets (the server does not list them) or targets the client cannot place', () => {
    expect(needPrompts(stateWith(empty()))).toEqual([]);
    expect(needPrompts(stateWith(empty({ needs: [need({ targetId: 'ghost' })] })))).toEqual([]);
    expect(needPrompts(null)).toEqual([]);
  });
  it('places a target that is an entity', () => {
    const st = stateWith(empty({ needs: [need({ targetId: 'sw', label: 'Breaker 2', parts: [{ kind: 'fuse', label: 'Fuse', shape: 'small', installed: false }] })] }));
    expect(needPrompts(st)[0]).toMatchObject({ x: 1080, y: 590, text: 'Needs: Fuse' });
  });
});

describe('picking and intents (convenience only: the server re-validates everything)', () => {
  const ground = stateWith(empty({
    items: [item('fuse_a', 'fuse', 190), item('bat', 'battery', 215), item('far', 'fuse', 700), item('core', 'power_core', 600)],
    stashes: [{ id: 'locker', kind: 'locker', label: 'Maintenance locker', x: 850, y: 320, opened: false }, { id: 'done', kind: 'crate', label: 'Crate', x: 100, y: 590, opened: true }],
  }));
  it('E picks the nearest part in reach (and uses the pickup range), else opens a closed stash, else falls through', () => {
    expect(pickIntent(ground, { x: 205, y: 590 })).toEqual({ ok: true, action: { action: 'pickup', itemId: 'bat' } });
    expect(pickIntent(ground, { x: 190 - ITEM_LIMITS.pickupRange, y: 590 })).toEqual({ ok: true, action: { action: 'pickup', itemId: 'fuse_a' } });
    expect(pickIntent(ground, { x: 190 - ITEM_LIMITS.pickupRange - 1, y: 590 })).toBeNull();
    expect(pickIntent(ground, { x: 850, y: 320 })).toEqual({ ok: true, action: { action: 'open', stashId: 'locker' } });
    expect(pickIntent(ground, { x: 100, y: 590 })).toBeNull(); // opened stashes are not offered again
    expect(pickIntent(ground, { x: 400, y: 100 })).toBeNull();
  });
  it('does not reach parts on another deck', () => {
    expect(nearestItem(ground, { x: 215, y: 590 - 200 })).toBeNull();
    expect(nearestStash(ground, { x: 850, y: 590 })).toBeNull();
  });

  const hold = (ids: [string, Item['kind'], Partial<Item>?][], on: Item[] = []): StageState => stateWith(empty({
    items: [...ids.map(([id, kind, extra]) => item(id, kind, 0, { state: 'carried', carrierId: 'me', ...(extra ?? {}) })), ...on],
    players: [{ id: 'me', slotsUsed: ids.length, carried: ids.map((i) => i[0]) }, { id: 'you', slotsUsed: 0, carried: [] }],
    needs: [need()],
  }));

  it('G drops the part picked up last, Shift the older one', () => {
    const st = hold([['a', 'fuse'], ['b', 'battery']]);
    expect(dropIntent(st, 'me', { x: 500, y: 500 })).toEqual({ ok: true, action: { action: 'drop', itemId: 'b' } });
    expect(dropIntent(st, 'me', { x: 500, y: 500 }, true)).toEqual({ ok: true, action: { action: 'drop', itemId: 'a' } });
    expect(dropIntent(stateWith(empty()), 'me', { x: 0, y: 0 })).toEqual({ ok: false, reason: 'You are carrying nothing.' });
  });
  it('G becomes a swap when a part lies in reach and the hands are full, but not when there is room', () => {
    const lying = item('real', 'flux_coil', 500);
    const full = hold([['a', 'fuse'], ['b', 'flux_coil', { cracked: true }]], [lying]);
    expect(dropIntent(full, 'me', { x: 500, y: 590 })).toEqual({ ok: true, action: { action: 'swap', dropId: 'b', pickId: 'real' } });
    const room = hold([['a', 'fuse']], [lying]);
    expect(dropIntent(room, 'me', { x: 500, y: 590 })).toEqual({ ok: true, action: { action: 'drop', itemId: 'a' } });
  });
  it('a swap is not offered when giving up the chosen part would still not make room', () => {
    const heavyLying = item('core', 'power_core', 500);
    const full = hold([['a', 'fuse'], ['b', 'battery']], [heavyLying]);
    // dropping one light part frees 1 slot but the core needs 2: the plain drop is offered, the server explains the rest
    expect(dropIntent(full, 'me', { x: 500, y: 590 })).toEqual({ ok: true, action: { action: 'drop', itemId: 'b' } });
  });
  it('F fits the part the target asks for and never prefers a cracked one', () => {
    const st = hold([['good', 'flux_coil'], ['bad', 'flux_coil', { cracked: true }]]);
    expect(installIntent(st, 'me', { x: 200, y: 410 })).toEqual({ ok: true, action: { action: 'install', itemId: 'good', targetId: 'bp' } });
    const onlyBad = hold([['bad', 'flux_coil', { cracked: true }]]);
    expect(installIntent(onlyBad, 'me', { x: 200, y: 410 })).toEqual({ ok: true, action: { action: 'install', itemId: 'bad', targetId: 'bp' } }); // the player chose to
    const wrong = hold([['a', 'fuse'], ['b', 'battery']]);
    expect(installIntent(wrong, 'me', { x: 200, y: 410 })).toEqual({ ok: false, reason: 'Nothing you carry fits here.' });
    expect(installIntent(st, 'me', { x: 600, y: 410 })).toEqual({ ok: false, reason: 'Nothing here needs a part.' });
    expect(installIntent(stateWith(empty({ needs: [need()] })), 'me', { x: 200, y: 410 })).toEqual({ ok: false, reason: 'You are carrying nothing.' });
  });
  it('F tries the most recent part when the clarity hides kinds (the server decides)', () => {
    const hidden = need({ parts: [{ kind: null, label: null, shape: 'small', installed: false }] });
    const st = hold([['a', 'fuse'], ['b', 'battery']]);
    st.items!.needs = [hidden];
    expect(installIntent(st, 'me', { x: 200, y: 410 })).toEqual({ ok: true, action: { action: 'install', itemId: 'b', targetId: 'bp' } });
  });
  it('H hands the last part to the nearest teammate within reach, never to yourself', () => {
    const st = hold([['a', 'fuse']]);
    const others = [{ id: 'me', x: 300, y: 590 }, { id: 'you', x: 300 + ITEM_LIMITS.handoverRange, y: 590 }, { id: 'far', x: 900, y: 590 }];
    expect(handoverIntent(st, 'me', { x: 300, y: 590 }, others)).toEqual({ ok: true, action: { action: 'handover', itemId: 'a', toPlayerId: 'you' } });
    expect(handoverIntent(st, 'me', { x: 300, y: 590 }, [others[0]!, others[2]!])).toEqual({ ok: false, reason: 'No teammate within reach.' });
    expect(handoverIntent(stateWith(empty()), 'me', { x: 0, y: 0 }, others)).toEqual({ ok: false, reason: 'You are carrying nothing.' });
    expect(nearestTeammate({ x: 0, y: 0 }, [{ id: 'me', x: 0, y: 0 }], 'me')).toBeNull();
  });
});

describe('the key prompt', () => {
  it('says what the next key press does', () => {
    const lying = [item('fuse_a', 'fuse', 190), item('bad', 'flux_coil', 215, { cracked: true })];
    const st = stateWith(empty({ items: lying, needs: [need()] }));
    expect(itemPrompt(st, 'me', { x: 190, y: 590 })).toBe('[E] Pick up the Fuse');
    expect(itemPrompt(st, 'me', { x: 214, y: 590 })).toBe('[E] Pick up the Flux Coil (cracked)');
    expect(itemPrompt(st, 'me', { x: 800, y: 100 })).toBeNull();
    expect(itemPrompt({ ...st, items: undefined }, 'me', { x: 190, y: 590 })).toBeNull();
  });
  it('offers a swap when the hands are full, a heavy warning with nothing to drop, and fitting near a needy target', () => {
    const full = stateWith(empty({
      items: [item('a', 'fuse', 0, { state: 'carried', carrierId: 'me' }), item('b', 'battery', 0, { state: 'carried', carrierId: 'me' }), item('real', 'flux_coil', 500)],
      players: [{ id: 'me', slotsUsed: 2, carried: ['a', 'b'] }], needs: [need()],
    }));
    expect(itemPrompt(full, 'me', { x: 500, y: 590 })).toBe('[G] Swap for the Flux Coil');
    expect(itemPrompt(full, 'me', { x: 200, y: 410 })).toBe('[F] Fit a part to Cracked flux coupling');
    const heavy = stateWith(empty({ items: [item('core', 'power_core', 500)] }));
    expect(itemPrompt(heavy, 'me', { x: 500, y: 590 })).toBe('[E] Pick up the Power Core');
  });
  it('offers a closed stash to open', () => {
    const st = stateWith(empty({ stashes: [{ id: 'l', kind: 'locker', label: 'Maintenance locker', x: 850, y: 320, opened: false }] }));
    expect(itemPrompt(st, 'me', { x: 850, y: 320 })).toBe('[E] Open the Maintenance locker');
  });
});

describe('hand-over and loss feedback', () => {
  const name = (id: string) => (id === 'you' ? 'Ada' : id === 'me' ? 'Me' : 'Someone');
  const itemsWith = (carrier: string | null, state: Item['state'] = 'carried'): ItemsPublic => empty({ items: [item('a', 'fuse', 0, { state, carrierId: carrier })] });
  it('tells the receiver and the giver, and nobody else', () => {
    const before = itemsWith('you'), after = itemsWith('me');
    expect(carryChanges(before, after, 'me', name)).toEqual(['Ada handed you the Fuse.']);
    expect(carryChanges(before, after, 'you', name)).toEqual(['You handed the Fuse to Me.']);
    expect(carryChanges(before, after, 'bystander', name)).toEqual([]);
  });
  it('says nothing for a plain pick-up, a drop, or no change', () => {
    expect(carryChanges(itemsWith(null, 'in_world'), itemsWith('me'), 'me', name)).toEqual([]);
    expect(carryChanges(itemsWith('me'), itemsWith(null, 'in_world'), 'me', name)).toEqual([]);
    expect(carryChanges(itemsWith('me'), itemsWith('me'), 'me', name)).toEqual([]);
    expect(carryChanges(undefined, itemsWith('me'), 'me', name)).toEqual([]);
  });
  it('tells a carrier that the part they held is gone (a shattered or burned part leaves the public list)', () => {
    expect(carryChanges(itemsWith('me'), empty(), 'me', name)).toEqual(['Your Fuse is gone.']);
    expect(carryChanges(itemsWith('you'), empty(), 'me', name)).toEqual([]);
  });
});
