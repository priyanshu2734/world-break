import { describe, expect, it } from 'vitest';
import { VarietyHistorySchema, type VarietyRecord } from '@wb/shared';
import { Room } from '../../src/room';
import { generateEscapeStage } from '../../src/rooms/generate';
import { playRun } from './runSolve';

/**
 * P3F step 6: the determinism note, as tests. A stage depends on (stage, seed, the last HISTORY_KEEP records). A save (P6) and the scenario generator (P5) keep the history,
 * and `Room.restoreVariety` gives it back before the run starts.
 */
const fingerprint = (def: ReturnType<typeof generateEscapeStage>): string => JSON.stringify([
  def.rooms?.rooms.map((r) => [r.id, r.arena.width, r.arena.height, r.arena.solids.length]),
  def.escape?.links.map((l) => [l.lock.type, l.doors]),
  def.escape?.loot?.outcome ?? null,
]);
const toPlaying = (room: Room): void => { for (let i = 0; i < 20 && room.phase !== 'playing'; i++) room.tick(); };
const GOOD = { stage: 3, locks: ['code'], templates: ['hall'], ghosts: ['wisp'], theme: 'lab' };

describe('P3F step 6: the same (stage, seed, history) is the same stage', () => {
  it('an empty history is the stage the generator makes on its own, and the answer for one input is stable', () => {
    const opt = { ghost: true, difficulty: 'easy' } as const;
    for (const [stage, seed] of [[12, 5], [20, 9], [1_000_000, 3]] as const) {
      const alone = fingerprint(generateEscapeStage(stage, seed, opt));
      expect(fingerprint(generateEscapeStage(stage, seed, { ...opt, history: [] }))).toBe(alone);
      const hist: VarietyRecord[] = [{ stage: stage - 1, locks: ['safe'], templates: ['hall'], ghosts: ['wisp'], theme: 'lab' }];
      expect(fingerprint(generateEscapeStage(stage, seed, { ...opt, history: hist }))).toBe(fingerprint(generateEscapeStage(stage, seed, { ...opt, history: hist })));
    }
  });
  it('the history really is an input: some history changes some stage (so a save that drops it would resume on a different stage)', () => {
    const opt = { ghost: true, difficulty: 'easy' } as const;
    let differs = 0;
    for (let seed = 1; seed <= 12; seed++) {
      const alone = fingerprint(generateEscapeStage(14, seed, opt));
      for (const lock of ['code', 'safe', 'pressure_plates', 'laser']) {
        const hist: VarietyRecord[] = [{ stage: 13, locks: [lock], templates: ['hall'], ghosts: ['wisp'], theme: 'lab' }];
        if (fingerprint(generateEscapeStage(14, seed, { ...opt, history: hist })) !== alone) differs++;
      }
    }
    expect(differs).toBeGreaterThan(0);
  });
});

describe('P3F step 6: saving and restoring the history', () => {
  it('after a real run: the records survive JSON, pass the schema, and a fresh lobby that restores them builds the SAME next stage', () => {
    let kept: Room | undefined;
    playRun({ runSeed: 31, players: 1, from: 1, count: 6, keep: (r) => { kept = r; } });
    const a = kept!;
    const saved = JSON.parse(JSON.stringify(a.varietyRecords)) as unknown;
    expect(VarietyHistorySchema.safeParse(saved).success).toBe(true);
    expect((saved as VarietyRecord[]).map((r) => r.stage)).toEqual([1, 2, 3, 4, 5, 6]);

    expect(a.nextStage('p0').ok).toBe(true);
    toPlaying(a);
    expect(a.stage).toBe(7);

    const b = new Room('SAVEB', 4, 31, { escape: true, ghost: true, startStage: 7 });
    b.join('p0', 'A');
    expect(b.restoreVariety(saved).ok).toBe(true);
    expect(b.start('p0').ok).toBe(true);
    toPlaying(b);
    expect(b.stage).toBe(7);
    expect(b.stageRecord!.seed).toBe(a.stageRecord!.seed);
    expect(fingerprint(b.stageDef!)).toBe(fingerprint(a.stageDef!));
    expect(b.snapshot().theme).toBe(a.snapshot().theme);
  }, 120_000);
  it('is refused after the start and for invalid data, and a refused restore leaves the history alone', () => {
    const room = new Room('SAVEC', 4, 3, { escape: true, ghost: true, startStage: 4 });
    room.join('p0', 'A');
    expect(room.restoreVariety([GOOD]).ok).toBe(true);
    expect(room.varietyRecords).toHaveLength(1);
    for (const bad of ['x', 7, null, [{ stage: 0 }], [{ ...GOOD, theme: 'swamp' }], [{ ...GOOD, extra: 1 }]]) {
      expect(room.restoreVariety(bad).ok).toBe(false);
      expect(room.varietyRecords).toHaveLength(1);
    }
    expect(room.start('p0').ok).toBe(true);
    expect(room.restoreVariety([GOOD]).ok).toBe(false);
  });
  it('restoring an empty history makes stage N the stage the generator makes on its own', () => {
    const room = new Room('SAVED', 4, 17, { escape: true, ghost: true, startStage: 9 });
    room.join('p0', 'A');
    expect(room.restoreVariety([]).ok).toBe(true);
    expect(room.start('p0').ok).toBe(true);
    toPlaying(room);
    const own = generateEscapeStage(9, room.stageRecord!.seed, { ghost: true, difficulty: room.difficulty, history: [] });
    expect(fingerprint(room.stageDef!)).toBe(fingerprint(own));
  });
});
