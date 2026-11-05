import { describe, expect, it } from 'vitest';
import { ESCAPE_LIMITS, LOOT, lootOnStage, lootOutcome, type EscapeAction, type RoomGraph } from '@wb/shared';
import { EscapeRuntime, type EscapeHost, type EscapePos } from '../../src/rooms/escape';
import type { EscapeSpec, Lock } from '../../src/rooms/escapeSpec';
import { generateEscapeStage } from '../../src/rooms/generate';

/** P3F step 4: the optional loot cache (generation and rules) and the rule that a dead teammate's body never keeps a plate lit. */
const FLOOR = 680;
const arena = (id: string) => ({ id, name: id, width: 2400, height: 720, solids: [{ x: 0, y: FLOOR, w: 2400, h: 40 }], spawns: [{ x: 300, y: FLOOR }, { x: 350, y: FLOOR }] });
const GRAPH: RoomGraph = {
  start: 'a',
  rooms: [
    { id: 'a', arena: arena('a'), doors: [{ id: 'da', x: 2200, y: FLOOR - 100, w: 40, h: 100, to: 'b', arrive: { x: 200, y: FLOOR } }] },
    { id: 'b', arena: arena('b'), doors: [{ id: 'db', x: 60, y: FLOOR - 100, w: 40, h: 100, to: 'a', arrive: { x: 2100, y: FLOOR } }] },
  ],
};
type Outcome = 'score' | 'upgrade' | 'hazard';
function rig(outcome: Outcome, lock: Lock = { type: 'key_item', itemKind: 'access_key' } as unknown as Lock, switches: EscapeSpec['switches'] = []) {
  const t = { now: 100 }, paid: { outcome: Outcome; by: string }[] = [], where = new Map<string, EscapePos>(), light = { on: true };
  const host: EscapeHost = {
    get tick() { return t.now; },
    say: () => undefined, markDirty: () => undefined, award: () => undefined, wrongPartCost: () => 10,
    roomOf: () => 'a', canSee: () => light.on, sendThrough: () => true, clear: () => undefined,
    loot: (o) => { paid.push({ outcome: o.outcome, by: o.by }); return `paid ${o.outcome}`; },
  };
  const spec: EscapeSpec = { exit: { room: 'b', x: 2000, y: FLOOR }, links: [{ doors: ['da', 'db'], lock }], keypads: [], safes: [], clues: [], switches, loot: { id: 'loot0', room: 'a', x: 900, y: FLOOR, outcome } };
  const rt = new EscapeRuntime(spec, GRAPH, host, null);
  rt.addPlayer('p0'); rt.addPlayer('p1');
  where.set('p0', { x: 900, y: FLOOR, connected: true }); where.set('p1', { x: 300, y: FLOOR, connected: true });
  return {
    rt, paid, where, light,
    do: (who: string, a: EscapeAction) => { t.now += 6; return rt.act(who, a, where.get(who)!); },
    tick: (n = 1) => { for (let i = 0; i < n; i++) { t.now++; rt.step((id) => where.get(id)); } },
  };
}

describe('loot cache: rules', () => {
  it('opens once, whoever opens it, and pays the outcome the seed fixed', () => {
    for (const o of ['score', 'upgrade', 'hazard'] as const) {
      const r = rig(o);
      expect(r.rt.publicState().loot).toMatchObject({ id: 'loot0', opened: false });
      expect(JSON.stringify(r.rt.publicState())).not.toMatch(/outcome|"score"|"hazard"/);
      expect(r.do('p0', { action: 'loot', lootId: 'loot0' }).ok).toBe(true);
      expect(r.paid).toEqual([{ outcome: o, by: 'p0' }]);
      expect(r.rt.publicState().loot!.opened).toBe(true);
      const again = r.do('p0', { action: 'loot', lootId: 'loot0' });
      expect(again.ok).toBe(false);
      expect(r.paid.length).toBe(1);
    }
  });
  it('too far, or a wrong id, is refused and pays nothing', () => {
    const r = rig('score');
    expect(r.do('p1', { action: 'loot', lootId: 'loot0' }).ok).toBe(false); // p1 stands 600 px away
    expect(r.do('p0', { action: 'loot', lootId: 'nope' }).ok).toBe(false);
    expect(r.paid).toEqual([]);
  });
  it('out of the light, the cache is not there to open', () => {
    const r = rig('score');
    r.light.on = false;
    expect(r.do('p0', { action: 'loot', lootId: 'loot0' }).ok).toBe(false);
    expect(r.paid).toEqual([]);
  });
});

describe('a dead teammate never keeps a plate lit', () => {
  it('a body shown to the stage as not connected does not light a pressure plate', () => {
    const lock: Lock = { type: 'pressure_plates', plates: ['p_a', 'p_b'] };
    const r = rig('score', lock, [{ id: 'p_a', room: 'a', x: 700, y: FLOOR }, { id: 'p_b', room: 'a', x: 1000, y: FLOOR }]);
    r.where.set('p0', { x: 700, y: FLOOR, connected: false }); // dead (the Room's `enginePos` marks bodies like this)
    r.where.set('p1', { x: 1000, y: FLOOR, connected: true });
    r.tick(ESCAPE_LIMITS.plateHoldTicks * 2);
    expect(r.rt.isOpen('da')).toBe(false);
    r.where.set('p0', { x: 700, y: FLOOR, connected: true }); // alive again
    r.tick(3);
    expect(r.rt.isOpen('da')).toBe(true);
  });
});

describe('loot cache: outcome and generation', () => {
  it('the outcome is a pure function of seed and id, with all three outcomes appearing', () => {
    const seen = new Set<string>();
    for (let s = 1; s <= 80; s++) { const o = lootOutcome(s, 'loot0'); expect(lootOutcome(s, 'loot0')).toBe(o); seen.add(o); }
    expect([...seen].sort()).toEqual(['hazard', 'score', 'upgrade']);
  });
  it('no cache before stage 13, always on 13, a seeded half after, at stage 1,000,000 too', () => {
    for (let s = 1; s < LOOT.fromStage; s++) expect(lootOnStage(s, 5)).toBe(false);
    expect(lootOnStage(13, 5)).toBe(true);
    let n = 0; for (let s = 14; s < 214; s++) if (lootOnStage(s, 7)) n++;
    expect(n).toBeGreaterThan(60); expect(n).toBeLessThan(140);
    expect(lootOnStage(1_000_000, 3)).toBe(lootOnStage(1_000_000, 3));
  });
  it('a generated stage 13 holds one cache, outside the start room, and nothing in the stage requires it; stages 1-12 hold none', () => {
    for (const seed of [1, 2, 3]) {
      const def = generateEscapeStage(13, seed, { ghost: true, difficulty: 'easy' });
      const loot = def.escape!.loot;
      expect(loot, `seed ${seed}`).toBeDefined();
      expect(loot!.room).not.toBe(def.rooms!.start);
      expect(['score', 'upgrade', 'hazard']).toContain(loot!.outcome);
    }
    for (const stage of [1, 5, 12]) expect(generateEscapeStage(stage, 4, { ghost: true, difficulty: 'easy' }).escape?.loot).toBeUndefined();
  });
});
