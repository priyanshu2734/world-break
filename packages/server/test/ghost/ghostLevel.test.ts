import { describe, expect, it } from 'vitest';
import { EVIDENCE_BY_TYPE, EVIDENCE_PER_TYPE, ESCAPE_LIMITS, ghostLineupForStage, ghostPickFor, ghostSeedFor, ghostTuning, evidenceOwner, type Difficulty } from '@wb/shared';
import { generateEscapeStage } from '../../src/rooms/generate';
import { requireGhostLevel } from '../../src/rooms/escapeValidate';

const STAGES = [2, 3, 5, 7, 8, 12, 13, 19, 20, 25, 35, 45];
const SEEDS = [1, 2, 3, 7, 9, 21, 77, 123];
const MODES: Difficulty[] = ['easy', 'intermediate', 'hardcore'];

describe('hiding spots in generated ghost stages', () => {
  it('every room keeps at least one spot on its floor, never more than the table says, and the stage total stays under the cap', () => {
    for (const stage of STAGES) for (const seed of SEEDS) for (const difficulty of MODES) {
      const def = generateEscapeStage(stage, seed, { ghost: true, difficulty });
      const spots = def.escape!.hidingSpots ?? [];
      const perRoom = ghostTuning(difficulty, stage).hidingSpotsPerRoom;
      expect(spots.length).toBeLessThanOrEqual(ESCAPE_LIMITS.maxHidingSpots);
      for (const r of def.rooms!.rooms) {
        const mine = spots.filter((h) => h.room === r.id);
        expect(mine.length).toBeGreaterThanOrEqual(1);
        expect(mine.length).toBeLessThanOrEqual(perRoom);
      }
      expect(requireGhostLevel(def, stage, seed)).toEqual([]);
    }
  });
  it('the positions are RANDOM per seed: never one fixed place', () => {
    for (const stage of [2, 3, 8]) {
      const seen = new Set<string>();
      for (let seed = 1; seed <= 20; seed++) {
        const def = generateEscapeStage(stage, seed, { ghost: true });
        const start = def.rooms!.start;
        seen.add((def.escape!.hidingSpots ?? []).filter((h) => h.room === start).map((h) => Math.round(h.x)).sort((a, b) => a - b).join(','));
      }
      expect(seen.size).toBeGreaterThanOrEqual(stage === 2 ? 4 : 8); // stage 2 is one small room with a single spot: its position still varies
    }
  });
  it('the same (stage, seed, mode) always gives the same spots', () => {
    for (const stage of [2, 12, 30]) {
      expect(JSON.stringify(generateEscapeStage(stage, 5, { ghost: true }).escape)).toBe(JSON.stringify(generateEscapeStage(stage, 5, { ghost: true }).escape));
    }
  });
  it('the validator rejects a room with no spot, a spot off the floor and wrong evidence', () => {
    const def = generateEscapeStage(3, 7, { ghost: true });
    const spec = def.escape!;
    const without = { ...def, escape: { ...spec, hidingSpots: (spec.hidingSpots ?? []).filter((h) => h.room !== def.rooms!.start) } };
    expect(requireGhostLevel(without, 3, 7).join(' ')).toMatch(/no hiding spot/);
    const high = { ...def, escape: { ...spec, hidingSpots: (spec.hidingSpots ?? []).map((h, i) => (i === 0 ? { ...h, y: h.y - 77 } : h)) } };
    expect(requireGhostLevel(high, 3, 7).join(' ')).toMatch(/not on a floor/);
    const noEv = { ...def, escape: { ...spec, ghostEvidence: [] } };
    expect(requireGhostLevel(noEv, 3, 7).join(' ')).toMatch(/evidence/);
  });
});

describe('ghost evidence (data only)', () => {
  it('each ghost type that runs on the stage left its own pieces, and only its own kinds', () => {
    for (const stage of STAGES) for (const seed of SEEDS) {
      const def = generateEscapeStage(stage, seed, { ghost: true });
      const lineup = ghostLineupForStage(stage, ghostPickFor(ghostSeedFor(seed, stage)));
      const ev = def.escape!.ghostEvidence ?? [];
      for (const t of lineup) expect(ev.filter((e) => e.ghost === t).length).toBe(EVIDENCE_PER_TYPE);
      expect(ev.length).toBe(lineup.length * EVIDENCE_PER_TYPE);
      for (const e of ev) { expect(evidenceOwner(e.kind)).toBe(e.ghost); expect(EVIDENCE_BY_TYPE[e.ghost]).toContain(e.kind); expect(lineup).toContain(e.ghost); }
    }
  });
  it('no stage has evidence without the ghost option, or on stage 1', () => {
    for (const stage of STAGES) expect(generateEscapeStage(stage, 5).escape!.ghostEvidence).toBeUndefined();
    expect(generateEscapeStage(1, 5, { ghost: true }).escape!.ghostEvidence).toBeUndefined();
  });
  it('the types never share a kind of evidence', () => {
    const all = Object.values(EVIDENCE_BY_TYPE).flat();
    expect(new Set(all).size).toBe(all.length);
  });
});

describe('stages without the ghost option are exactly what they were', () => {
  it('the escape spec still has the old placeholder spots (1 or 2 per room) and nothing new', () => {
    for (const stage of [2, 8, 15, 30]) for (const seed of [1, 2, 3]) {
      const spec = generateEscapeStage(stage, seed).escape!;
      expect(spec.ghostEvidence).toBeUndefined();
      expect(JSON.stringify(spec)).not.toContain('pulse_gun');
    }
  });
});
