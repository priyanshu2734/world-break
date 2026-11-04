import { describe, expect, it } from 'vitest';
import {
  DRAFT_SIZE, DraftPublicSchema, DraftVoteSchema, NO_EFFECTS, UPGRADES, UPGRADE_BOUNDS, UPGRADE_IDS, canTake, draftOffer, effectsOf, tally, type Owned,
} from '../src';

describe('P3F step 4: the draft pick (rules)', () => {
  it('every upgrade has a name, a text and a cap; two have a price', () => {
    for (const id of UPGRADE_IDS) { expect(UPGRADES[id].id).toBe(id); expect(UPGRADES[id].name.length).toBeGreaterThan(2); expect(UPGRADES[id].text.length).toBeGreaterThan(10); expect(UPGRADES[id].max).toBeGreaterThanOrEqual(1); }
    expect(UPGRADE_IDS.filter((i) => UPGRADES[i].tradeoff !== undefined).sort()).toEqual(['hair_trigger', 'loud_lamp']);
    expect(UPGRADE_IDS.length).toBeGreaterThanOrEqual(6);
  });
  it('the offer is 3 distinct upgrades, deterministic, none at its cap, in every stage including 1,000,000', () => {
    for (const stage of [1, 2, 9, 10, 20, 1_000_000]) for (let seed = 0; seed < 30; seed++) {
      const o = draftOffer(seed, stage, {});
      expect(o.length).toBe(DRAFT_SIZE);
      expect(new Set(o).size).toBe(o.length);
      expect(draftOffer(seed, stage, {})).toEqual(o);
    }
    const owned: Owned = { extra_hand: 1, quick_rescue: 1 };
    for (let seed = 0; seed < 30; seed++) for (const id of draftOffer(seed, 3, owned)) expect(canTake(owned, id)).toBe(true);
  });
  it('the team is offered what it owns least first, and a team that has everything is offered nothing', () => {
    const owned: Owned = { wide_beam: 2, soft_steps: 2, quick_charge: 2 };
    for (let seed = 0; seed < 30; seed++) for (const id of draftOffer(seed, 4, owned)) expect(['wide_beam', 'soft_steps', 'quick_charge']).not.toContain(id);
    const all: Owned = Object.fromEntries(UPGRADE_IDS.map((i) => [i, UPGRADES[i].max]));
    expect(draftOffer(1, 5, all)).toEqual([]);
    expect(draftOffer(1, 5, { ...all, loud_lamp: 0 })).toEqual(['loud_lamp']);
  });
  it('the stage-10 breach always offers the wide beam while it can be taken', () => {
    for (let seed = 0; seed < 40; seed++) { expect(draftOffer(seed, 10, {})).toContain('wide_beam'); expect(draftOffer(seed, 30, {})).toHaveLength(3); }
    expect(draftOffer(1, 10, { wide_beam: 2 })).not.toContain('wide_beam');
  });
  it('the effects are bounded whatever is owned', () => {
    expect(effectsOf({})).toEqual(NO_EFFECTS);
    const B = UPGRADE_BOUNDS;
    for (const count of [0, 1, 2, 3, 99, -4]) {
      const e = effectsOf(Object.fromEntries(UPGRADE_IDS.map((i) => [i, count])));
      expect(e.visionMul).toBeGreaterThanOrEqual(B.visionMul.min); expect(e.visionMul).toBeLessThanOrEqual(B.visionMul.max);
      expect(e.hearingMul).toBeGreaterThanOrEqual(B.hearingMul.min); expect(e.hearingMul).toBeLessThanOrEqual(B.hearingMul.max);
      expect(e.gunMul).toBeGreaterThanOrEqual(B.gunMul.min); expect(e.gunMul).toBeLessThanOrEqual(B.gunMul.max);
      expect(e.rescueMul).toBeGreaterThanOrEqual(B.rescueMul.min);
      expect(e.extraSlots).toBeLessThanOrEqual(1);
      expect(80 + e.warningShift).toBeGreaterThanOrEqual(60); // the 60-tick minimum warning always holds
    }
  });
  it('each upgrade does what it says, and the two priced ones cost what they say', () => {
    expect(effectsOf({ wide_beam: 1 }).visionMul).toBeCloseTo(1.1, 10);
    expect(effectsOf({ soft_steps: 1 }).hearingMul).toBeCloseTo(0.85, 10);
    expect(effectsOf({ extra_hand: 1 }).extraSlots).toBe(1);
    expect(effectsOf({ quick_rescue: 1 }).rescueMul).toBeCloseTo(0.75, 10);
    expect(effectsOf({ quick_charge: 1 }).gunMul).toBeCloseTo(0.8, 10);
    const hair = effectsOf({ hair_trigger: 1 });
    expect(hair.gunMul).toBeCloseTo(0.65, 10); expect(hair.warningShift).toBe(-20);
    const lamp = effectsOf({ loud_lamp: 1 });
    expect(lamp.visionMul).toBeCloseTo(1.2, 10); expect(lamp.hearingMul).toBeCloseTo(1.15, 10);
  });
  it('a tally picks the most votes, a tie goes to the first listed, no vote to the first', () => {
    expect(tally([0, 0, 0])).toBe(0);
    expect(tally([1, 2, 1])).toBe(1);
    expect(tally([2, 2, 1])).toBe(0);
    expect(tally([0, 1, 1])).toBe(1);
  });
  it('the schemas are strict', () => {
    expect(DraftVoteSchema.safeParse({ index: 2 }).success).toBe(true);
    expect(DraftVoteSchema.safeParse({ index: 3 }).success).toBe(false);
    expect(DraftVoteSchema.safeParse({ index: -1 }).success).toBe(false);
    expect(DraftVoteSchema.safeParse({ index: 1, extra: 1 }).success).toBe(false);
    expect(DraftPublicSchema.safeParse({ stage: 3, options: [{ id: 'wide_beam', name: 'x', text: 'y', votes: 0 }] }).success).toBe(true);
    expect(DraftPublicSchema.safeParse({ stage: 3, options: [{ id: 'nope', name: 'x', text: 'y', votes: 0 }] }).success).toBe(false);
  });
});
