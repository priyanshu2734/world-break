import { describe, expect, it } from 'vitest';
import {
  ANY_LOCK_TYPES, ESCAPE_LIMITS, LOCK_TYPES, PUZZLE_FROM_STAGE, PUZZLE_TYPES, locksForStage, methodWordIn, needText, parseBreaker, parseGlyphs, parseLegend, parseLever, parseWiring,
  puzzleChance, puzzlesForStage, symbolCode, type AnyLockType, type PuzzleType,
} from '@wb/shared';
import { generateEscapeStage } from '../../src/rooms/generate';
import { validateEscape } from '../../src/rooms/escapeValidate';
import type { StageDef } from '../../src/systems/stageDef';

/** P3F step 2: the puzzle pool as the generator uses it. No physics here: the walking proofs are in puzzles.solve.test.ts. */
const SEEDS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20];
const STAGES = [1, 2, 3, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 20, 24, 25, 30, 39, 40, 41, 60, 100, 1_000_000];
const typesOf = (d: StageDef): AnyLockType[] => d.escape!.links.map((l) => l.lock.type);

/** Every stage of the sample, built once (generation is cheap, a hundred of them is not). */
const SAMPLE = STAGES.flatMap((stage) => SEEDS.map((seed) => ({ stage, seed, def: generateEscapeStage(stage, seed), ghost: generateEscapeStage(stage, seed, { ghost: true }) })));

describe('P3F step 2: the pool', () => {
  it('there are 13 lock types: the five originals (unchanged) and eight new puzzles', () => {
    expect(ANY_LOCK_TYPES.length).toBeGreaterThanOrEqual(12);
    expect(ANY_LOCK_TYPES.length).toBe(13);
    expect([...LOCK_TYPES]).toEqual(['key_item', 'code', 'power', 'two_person', 'safe']);
    expect(PUZZLE_TYPES.length).toBe(8);
    expect(new Set(ANY_LOCK_TYPES).size).toBe(13);
  });

  it('the table: none before stage 6, then each type from its own stage (lever sequence 11 and symbol match 14, as docs/HOOK.md says); the chance is bounded', () => {
    for (let s = 1; s <= 5; s++) expect(puzzlesForStage(s)).toEqual([]);
    expect(puzzlesForStage(6)).toEqual(['breaker_panel']);
    expect(PUZZLE_FROM_STAGE.lever_sequence).toBe(11);
    expect(PUZZLE_FROM_STAGE.symbol_match).toBe(14);
    expect([...puzzlesForStage(14)].sort()).toEqual([...PUZZLE_TYPES].sort());
    expect(puzzlesForStage(1_000_000).length).toBe(8);
    expect(puzzlesForStage(Number.NaN)).toEqual([]);
    for (let s = 1; s <= 200; s++) { expect(puzzleChance(s)).toBeGreaterThanOrEqual(0); expect(puzzleChance(s)).toBeLessThanOrEqual(0.75); }
    expect(puzzleChance(5)).toBe(0);
    expect(puzzleChance(1_000_000)).toBe(0.75);
  });

  it('every type is used by the generator, and none appears before its stage; stages 1 to 5 hold only the original locks', () => {
    const seen = new Set<string>();
    for (const { stage, def } of SAMPLE) for (const t of typesOf(def)) {
      seen.add(t);
      if ((PUZZLE_TYPES as readonly string[]).includes(t)) expect(PUZZLE_FROM_STAGE[t as PuzzleType], `${t} at stage ${stage}`).toBeLessThanOrEqual(stage);
      else expect([...locksForStage(stage), ...LOCK_TYPES]).toContain(t);
      if (stage <= 5) expect([...locksForStage(stage)]).toContain(t);
    }
    for (const t of ANY_LOCK_TYPES) expect(seen.has(t), t).toBe(true);
  });

  it('NEVER THE SAME LOCK TYPE TWICE IN A ROW: on every stage of the sample (with and without the ghost), stage 1,000,000 included, neighbouring doors differ', () => {
    let doors = 0;
    for (const { def, ghost } of SAMPLE) for (const d of [def, ghost]) {
      const types = typesOf(d);
      doors += types.length;
      for (let i = 1; i < types.length; i++) expect(types[i]).not.toBe(types[i - 1]);
    }
    expect(doors).toBeGreaterThan(2000);
  });

  it('a puzzle is more likely the later the stage, and a stage that is not changed is the stage it always was (the draw order is kept)', () => {
    for (const { stage, seed, def } of SAMPLE) {
      const legacy = generateEscapeStage(stage, seed, { puzzles: false });
      const converted = new Set<number>();
      typesOf(def).forEach((t, i) => { if (t !== typesOf(legacy)[i]) converted.add(i); });
      // the rooms, the hiding spots, the exit and every link that kept its lock are exactly what the original draws made
      expect(def.rooms).toEqual(legacy.rooms);
      expect(def.escape!.exit).toEqual(legacy.escape!.exit);
      expect(def.escape!.hidingSpots).toEqual(legacy.escape!.hidingSpots);
      const tagOf = (id: string): number | null => { const m = /_l([0-9]+)_/.exec(id); return m ? Number(m[1]) : null; };
      const same = <T extends { id: string }>(a: readonly T[], b: readonly T[]) => {
        const bi = new Map(b.map((x) => [x.id, x]));
        for (const x of a) { const k = tagOf(x.id); if (k === null || !converted.has(k)) expect(bi.get(x.id), x.id).toEqual(x); }
        for (const y of b) { const k = tagOf(y.id); if (k === null || !converted.has(k)) expect(a.some((x) => x.id === y.id), y.id).toBe(true); }
      };
      same(def.items ?? [], legacy.items ?? []); same(def.stashes ?? [], legacy.stashes ?? []);
      same(def.escape!.clues, legacy.escape!.clues); same(def.escape!.keypads, legacy.escape!.keypads); same(def.escape!.safes, legacy.escape!.safes); same(def.escape!.switches, legacy.escape!.switches);
      if (stage <= 5) expect(converted.size).toBe(0);
    }
    // and from stage 14 on, a real share of the doors are puzzles
    let doors = 0, puzzles = 0;
    for (const { stage, def } of SAMPLE) if (stage >= 14) for (const t of typesOf(def)) { doors++; if ((PUZZLE_TYPES as readonly string[]).includes(t)) puzzles++; }
    expect(puzzles / doors).toBeGreaterThan(0.4);
    expect(puzzles / doors).toBeLessThan(0.9);
  });
});

describe('P3F step 2: clue text states the goal, never the method', () => {
  it('no note of any generated stage, and no refusal on any lock, contains an instruction verb', () => {
    for (const { def } of SAMPLE) for (const c of def.escape!.clues) expect(methodWordIn(c.text), `${c.label}: ${c.text}`).toBeNull();
    for (const t of ANY_LOCK_TYPES) expect(methodWordIn(needText(t)), `${t}: ${needText(t)}`).toBeNull();
    for (const t of PUZZLE_TYPES) expect(needText(t)).toMatch(/^Locked\./);
  });

  it('a lock never says WHERE its parts are: the refusal is identical for every instance of a type, and the notes carry facts', () => {
    expect(needText('tool_key')).toBe(needText('key_item')); // a key door reads the same whatever hides the key
    expect(needText('lever_sequence')).not.toMatch(/[0-9]/);
    expect(needText('wiring')).not.toMatch(/first|second|third|fourth|left|right post/);
  });

  it('what the notes spell is what the lock needs (read back the way a player would read it)', () => {
    let checked = 0;
    for (const { def } of SAMPLE) {
      const clue = (id: string) => def.escape!.clues.find((c) => c.id === id)!;
      for (const { lock } of def.escape!.links) {
        if (lock.type === 'lever_sequence') { expect(parseLever(clue(lock.clueId).text)).toEqual(lock.order); checked++; }
        else if (lock.type === 'breaker_panel') { expect(parseBreaker(clue(lock.clueId).text)).toEqual(lock.target); checked++; }
        else if (lock.type === 'wiring') { expect(parseWiring(clue(lock.clueId).text)).toBe(lock.right); checked++; }
        else if (lock.type === 'symbol_match') {
          expect(symbolCode(parseGlyphs(clue(lock.pictureId).text)!, parseLegend(clue(lock.legendId).text)!)).toBe(lock.code);
          expect(clue(lock.pictureId).room).not.toBe(clue(lock.legendId).room); // players must put the two halves together
          checked++;
        }
      }
    }
    expect(checked).toBeGreaterThan(100);
  });
});

describe('P3F step 2: decoys where the stage table allows', () => {
  it('lever, breaker and wiring locks carry a SUPERSEDED look-alike note that no reader accepts; sensors have dead twins; tool lockers have cracked tools', () => {
    const got = new Set<string>();
    let cracked = 0;
    for (const { stage, def } of SAMPLE) {
      if (stage < 2) continue;
      for (const { lock } of def.escape!.links) {
        const tag = (id: string) => def.escape!.clues.filter((c) => c.id.includes(id.replace(/_[a-z]+[0-9]*$/, '_')) && c.text.startsWith('Superseded'));
        if (lock.type === 'lever_sequence') { expect(tag(lock.levers[0]!).length).toBe(1); expect(parseLever(tag(lock.levers[0]!)[0]!.text)).toBeNull(); got.add(lock.type); }
        if (lock.type === 'breaker_panel') { expect(tag(lock.breakers[0]!).length).toBe(1); expect(parseBreaker(tag(lock.breakers[0]!)[0]!.text)).toBeNull(); got.add(lock.type); }
        if (lock.type === 'wiring') { expect(tag(lock.terminals[0]!).length).toBe(1); expect(parseWiring(tag(lock.terminals[0]!)[0]!.text)).toBeNull(); got.add(lock.type); }
        if (lock.type === 'flashlight_sensor') { expect(lock.sensors.length).toBe(1 + Math.min(2, stage <= 6 ? 1 : 2)); expect(lock.sensors.length).toBeGreaterThanOrEqual(2); got.add(lock.type); }
        if (lock.type === 'tool_key') { cracked += (def.items ?? []).filter((i) => i.kind === 'valve_wheel' && i.decoy === true && i.id.startsWith(lock.stashId.replace(/_locker$/, '_'))).length; got.add(lock.type); }
      }
    }
    expect([...got].sort()).toEqual(['breaker_panel', 'flashlight_sensor', 'lever_sequence', 'tool_key', 'wiring']);
    expect(cracked).toBeGreaterThan(10);
  });
});

describe('P3F step 2: the stage rules still hold with the new pool', () => {
  it('a mandatory safe keeps ALL its pages in its own room; every stage is within the caps; stage 1 is unchanged', () => {
    let safes = 0;
    for (const { stage, def, ghost } of SAMPLE) {
      for (const d of [def, ghost]) {
        const spec = d.escape!;
        for (const l of spec.links) if (l.lock.type === 'safe') {
          const safe = spec.safes.find((s) => s.id === (l.lock as { safeId: string }).safeId)!;
          safes++;
          for (const id of safe.clueIds) expect(spec.clues.find((c) => c.id === id)!.room).toBe(safe.room);
        }
        expect(spec.clues.length).toBeLessThanOrEqual(ESCAPE_LIMITS.maxClues);
        expect(spec.switches.length).toBeLessThanOrEqual(ESCAPE_LIMITS.maxSwitches);
        expect((d.items ?? []).length).toBeLessThanOrEqual(12);
      }
      if (stage === 1) expect(typesOf(def)).toEqual(['key_item']);
    }
    expect(safes).toBeGreaterThan(40);
  });
});

describe('P3F step 2: every lock has a validator rule that catches a broken instance', () => {
  const find = (type: PuzzleType): StageDef => {
    for (const { stage, def } of SAMPLE) if (stage >= 14 && typesOf(def).includes(type)) return def;
    throw new Error(`no ${type} in the sample`);
  };
  type Spec = NonNullable<StageDef['escape']>;
  const broken = (type: PuzzleType, mutate: (spec: Spec, def: StageDef, lock: Spec['links'][number]['lock']) => void): string[] => {
    const def = structuredClone(find(type));
    const spec = def.escape!;
    expect(validateEscape(spec, def.rooms!, def)).toEqual([]); // the untouched stage is valid
    mutate(spec, def, spec.links.find((l) => l.lock.type === type)!.lock);
    return validateEscape(spec, def.rooms!, def);
  };
  const some = (errs: string[], re: RegExp) => expect(errs.some((e) => re.test(e)), errs.join(' | ')).toBe(true);

  it('lever sequence: a log that does not spell the order, a shared lever, an unlisted order', () => {
    some(broken('lever_sequence', (_s, _d, l) => { const k = l as unknown as { order: number[] }; k.order = [...k.order.slice(1), k.order[0]!]; }), /does not spell/);
    some(broken('lever_sequence', (_s, _d, l) => { (l as unknown as { order: number[] }).order = [0, 0, 0]; }), /every lever once/);
  });
  it('breaker panel: a panel that starts solved, a chart that names other circuits', () => {
    some(broken('breaker_panel', (_s, _d, l) => { const k = l as unknown as { start: boolean[]; target: boolean[] }; k.start = [...k.target]; }), /already solved/);
    some(broken('breaker_panel', (_s, _d, l) => { const k = l as unknown as { target: boolean[] }; k.target = k.target.map((v) => !v); }), /does not spell/);
  });
  it('wiring: a live wire the plan does not name', () => {
    some(broken('wiring', (_s, _d, l) => { const k = l as unknown as { right: number; terminals: string[] }; k.right = (k.right + 1) % k.terminals.length; }), /does not name/);
  });
  it('pressure plates: plates too far apart for one player, or at two heights', () => {
    some(broken('pressure_plates', (s, _d, l) => { const k = l as unknown as { plates: [string, string] }; const a = s.switches.find((x) => x.id === k.plates[0])!, b = s.switches.find((x) => x.id === k.plates[1])!; b.x = b.x > a.x ? b.x + 900 : b.x - 900; }), /apart|outside|solid/);
    some(broken('pressure_plates', (s, _d, l) => { const k = l as unknown as { plates: [string, string] }; s.switches.find((x) => x.id === k.plates[1])!.y -= 90; }), /one height|does not stand/);
  });
  it('timed switch: a switch too far from the door for the time it gives', () => {
    some(broken('timed_switch', (s, _d, l) => { const k = l as unknown as { switchId: string }; const w = s.switches.find((x) => x.id === k.switchId)!, door = _d.rooms!.rooms.flatMap((r) => r.doors).find((d) => d.y + d.h === w.y && Math.abs(d.x - w.x) < 800)!; w.x = w.x > door.x ? w.x + 900 : w.x - 900; }), /px from the door|too far|outside|solid|between/);
  });
  it('flashlight sensor: a working sensor that is not one of the sensors', () => {
    some(broken('flashlight_sensor', (_s, _d, l) => { (l as unknown as { genuine: string }).genuine = 'nope'; }), /not one of its sensors/);
  });
  it('symbol match: both halves in one room, or a code the halves do not spell', () => {
    some(broken('symbol_match', (s, _d, l) => { const k = l as unknown as { pictureId: string; legendId: string }; s.clues.find((c) => c.id === k.pictureId)!.room = s.clues.find((c) => c.id === k.legendId)!.room; }), /two different rooms|beyond|stand/);
    some(broken('symbol_match', (_s, _d, l) => { const k = l as unknown as { code: string }; k.code = k.code === '0000' ? '1111' : '0000'; }), /spell/);
  });
  it('tool key: no genuine tool on the near side, a locker that does not need one', () => {
    some(broken('tool_key', (_s, d) => { d.items = (d.items ?? []).filter((i) => i.kind !== 'valve_wheel'); }), /no genuine valve_wheel/);
    some(broken('tool_key', (_s, d) => { for (const st of d.stashes ?? []) delete st.needs; }), /must need a valve_wheel/);
  });
  it('a switch that opens nothing, or that belongs to two locks, is refused', () => {
    some(broken('lever_sequence', (s) => { s.switches.push({ id: 'zz_orphan', room: s.switches[0]!.room, x: s.switches[0]!.x, y: s.switches[0]!.y }); }), /opens nothing/);
    some(broken('breaker_panel', (_s, _d, l) => { const k = l as unknown as { breakers: string[] }; k.breakers[1] = k.breakers[0]!; }), /named twice|two locks|opens nothing/);
  });
});
