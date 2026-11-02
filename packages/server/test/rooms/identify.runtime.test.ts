import { describe, expect, it } from 'vitest';
import { ESCAPE_LIMITS, ESCAPE_NOTHING, JOURNAL, type EscapeAction, type RoomGraph } from '@wb/shared';
import { EscapeRuntime, type EscapeHost, type EscapePos } from '../../src/rooms/escape';
import type { EscapeSpec } from '../../src/rooms/escapeSpec';

/** P3F step 3: the journal rules on the escape mechanics alone. Two rooms; the evidence stands in `a` (and one piece in `b`). */
const FLOOR = 680;
const arena = (id: string) => ({ id, name: id, width: 2400, height: 720, solids: [{ x: 0, y: FLOOR, w: 2400, h: 40 }], spawns: [{ x: 300, y: FLOOR }, { x: 350, y: FLOOR }] });
const GRAPH: RoomGraph = {
  start: 'a',
  rooms: [
    { id: 'a', arena: arena('a'), doors: [{ id: 'da', x: 2200, y: FLOOR - 100, w: 40, h: 100, to: 'b', arrive: { x: 200, y: FLOOR } }] },
    { id: 'b', arena: arena('b'), doors: [{ id: 'db', x: 60, y: FLOOR - 100, w: 40, h: 100, to: 'a', arrive: { x: 2100, y: FLOOR } }] },
  ],
};

function rig(ghosts: ('wisp' | 'shade' | 'howler')[] = ['shade']) {
  const t = { now: 100 }, awards: { cat: string; pts: number }[] = [], said: string[] = [], where = new Map<string, EscapePos>();
  const room = { p0: 'a', p1: 'a' } as Record<string, string>;
  const host: EscapeHost = {
    get tick() { return t.now; },
    say: (text) => { said.push(text); }, markDirty: () => undefined, award: (cat, pts) => { awards.push({ cat, pts }); }, wrongPartCost: () => 10,
    roomOf: (id) => room[id], canSee: () => true, sendThrough: () => true, clear: () => undefined,
  };
  const evidence: NonNullable<EscapeSpec['ghostEvidence']> = [];
  ghosts.forEach((g, i) => {
    evidence.push({ id: `ev${i}a`, room: 'a', x: 600 + i * 300, y: FLOOR, kind: g === 'wisp' ? 'cold_breath' : g === 'shade' ? 'single_dead_lamp' : 'cracked_glass', ghost: g });
    evidence.push({ id: `ev${i}b`, room: 'b', x: 600 + i * 300, y: FLOOR, kind: g === 'wisp' ? 'faint_whisper' : g === 'shade' ? 'scratched_walls' : 'wet_footprints', ghost: g });
  });
  const spec: EscapeSpec = {
    exit: { room: 'b', x: 2000, y: FLOOR }, links: [{ doors: ['da', 'db'], lock: { type: 'key_item' } }] as EscapeSpec['links'], keypads: [], safes: [], clues: [], switches: [], ghostEvidence: evidence,
  };
  const rt = new EscapeRuntime(spec, GRAPH, host, null);
  for (const p of ['p0', 'p1']) { rt.addPlayer(p); where.set(p, { x: 600, y: FLOOR, connected: true }); }
  const go = (who: string, a: EscapeAction) => { t.now += ESCAPE_LIMITS.minGapTicks + 2; return rt.act(who, a, where.get(who)!); };
  return { rt, t, awards, said, where, go, room };
}
const err = (r: { ok: boolean }): string => ('error' in r ? String((r as { error: string }).error) : '');

describe('P3F step 3: examining evidence', () => {
  it('examining writes the finding in the team journal, by kind, never by ghost type', () => {
    const r = rig();
    const res = r.go('p0', { action: 'examine', evidenceId: 'ev0a' });
    expect(res.ok).toBe(true);
    const pub = r.rt.publicState();
    expect(pub.journal?.entries).toEqual([{ id: 'ev0a', kind: 'single_dead_lamp' }]);
    expect(pub.evidence?.find((e) => e.id === 'ev0a')?.examined).toBe(true);
    const all = JSON.stringify(pub) + JSON.stringify(res);
    expect(all).not.toMatch(/shade|wisp|howler|"ghost"/i);
  });
  it('a piece in another room, or one that does not exist, gets the same refusal', () => {
    const r = rig();
    const far = err(r.go('p0', { action: 'examine', evidenceId: 'ev0b' }));
    const none = err(r.go('p0', { action: 'examine', evidenceId: 'nothing_here' }));
    expect(far).toBe(ESCAPE_NOTHING);
    expect(none).toBe(ESCAPE_NOTHING);
  });
  it('out of reach is refused, and an intent inside the minimum gap is "Too fast"', () => {
    const r = rig();
    r.where.set('p0', { x: 1500, y: FLOOR, connected: true });
    expect(err(r.go('p0', { action: 'examine', evidenceId: 'ev0a' }))).toBe('Too far away.');
    r.where.set('p0', { x: 600, y: FLOOR, connected: true });
    r.rt.act('p0', { action: 'examine', evidenceId: 'ev0a' }, r.where.get('p0')!);
    expect(err(r.rt.act('p0', { action: 'examine', evidenceId: 'ev0a' }, r.where.get('p0')!))).toBe('Too fast.');
  });
  it('examining twice adds nothing; the other player can examine too (one shared journal)', () => {
    const r = rig();
    r.go('p0', { action: 'examine', evidenceId: 'ev0a' });
    r.go('p1', { action: 'examine', evidenceId: 'ev0a' });
    expect(r.rt.publicState().journal?.entries.length).toBe(1);
  });
});

describe('P3F step 3: the journal entries', () => {
  it('nothing can be entered before something was examined', () => {
    const r = rig();
    expect(err(r.go('p0', { action: 'mark', ghost: 'shade' }))).toBe('Examine some evidence first.');
    expect(r.awards).toEqual([]);
  });
  it('a right entry costs nothing and is identified; a wrong one costs the small fixed amount once, and uses the line', () => {
    const r = rig(['shade']);
    r.go('p0', { action: 'examine', evidenceId: 'ev0a' });
    expect(r.go('p0', { action: 'mark', ghost: 'wisp' }).ok).toBe(true);
    expect(r.awards).toEqual([{ cat: JOURNAL.category, pts: -JOURNAL.wrongCost }]);
    expect(r.rt.identified()).toEqual([]);
    expect(err(r.go('p0', { action: 'mark', ghost: 'shade' }))).toBe('Every line of the journal is used.'); // one ghost, one line: no fishing for the answer
    expect(err(r.go('p0', { action: 'mark', ghost: 'wisp' }))).toMatch(/already|used/i);
    expect(r.awards.length).toBe(1);
    expect(r.rt.publicState().journal?.marks).toEqual(['wisp']);
  });
  it('a right entry is identified, for the warning and the gun, and the answer text does not say it was right', () => {
    const r = rig(['shade']);
    r.go('p0', { action: 'examine', evidenceId: 'ev0a' });
    const res = r.go('p1', { action: 'mark', ghost: 'shade' });
    expect(res.ok).toBe(true);
    expect(r.awards).toEqual([]);
    expect(r.rt.identified()).toEqual(['shade']);
    expect(JSON.stringify(res)).not.toMatch(/correct|right guess was|wrong guess was/i);
  });
  it('two ghosts give two lines; a third mark is refused; costs are per wrong entry', () => {
    const r = rig(['wisp', 'howler']);
    r.go('p0', { action: 'examine', evidenceId: 'ev0a' });
    expect(r.rt.publicState().journal?.lines).toBe(2);
    expect(r.go('p0', { action: 'mark', ghost: 'wisp' }).ok).toBe(true);
    expect(r.go('p0', { action: 'mark', ghost: 'shade' }).ok).toBe(true);
    expect(err(r.go('p0', { action: 'mark', ghost: 'howler' }))).toBe('Every line of the journal is used.');
    expect(r.awards).toEqual([{ cat: JOURNAL.category, pts: -JOURNAL.wrongCost }]);
    expect(r.rt.identified()).toEqual(['wisp']);
  });
  it('a stage without evidence has no journal and refuses entries', () => {
    const r = rig([]);
    expect(r.rt.publicState().journal).toBeUndefined();
    expect(r.rt.publicState().evidence).toBeUndefined();
    expect(err(r.go('p0', { action: 'mark', ghost: 'wisp' }))).toBe('There is nothing to enter in the journal.');
  });
  it('a player who is not part of the run cannot write in it', () => {
    const r = rig();
    expect(err(r.rt.act('ghosty', { action: 'mark', ghost: 'wisp' }, { x: 0, y: FLOOR, connected: true }))).toBe('You are not part of this run.');
  });
});
