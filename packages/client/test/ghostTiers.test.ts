import { describe, expect, it } from 'vitest';
import { GHOST_LOOK_SCALE, ghostLookTier, type PublicGhostKind } from '@wb/shared';
import { AURA_ALPHA, CROWN_SPIKES, SCAR_COUNT, ghostLook, ghostShape, mixColor, veiledBody } from '../src/ui/ghost/ghostLook';

const KINDS: PublicGhostKind[] = ['wisp', 'shade', 'howler', 'unknown'];
const redness = (c: number): number => ((c >> 16) & 255) - ((c & 255) + ((c >> 8) & 255)) / 2;

describe('P3F step 5: look tiers (stage 25 is clearly worse than stage 2)', () => {
  it('for every look a stage 25 ghost is bigger, has an aura, claw scars, a crown or frayed veil, bigger eyes and a redder body than a stage 2 one', () => {
    for (const kind of KINDS) {
      const early = ghostShape(kind, 2, 'roaming', 0), late = ghostShape(kind, 25, 'roaming', 0);
      expect(early.tier).toBe(0);
      expect(late.tier).toBe(2);
      expect(late.scale / early.scale).toBeGreaterThanOrEqual(1.6);
      expect(early.aura).toBe(0);
      expect(late.aura).toBeGreaterThan(0.1);
      expect(early.scars.length).toBe(0);
      expect(late.scars.length).toBeGreaterThanOrEqual(2);
      expect(late.extras.length).toBeGreaterThan(early.extras.length - (kind === 'howler' ? 2 : 0));
      expect(late.eyes[0]!.r).toBeGreaterThan(early.eyes[0]!.r);
      if (kind !== 'shade') expect(redness(late.tint)).toBeGreaterThan(redness(early.tint));
      expect(redness(late.glowTint)).toBeGreaterThan(redness(early.glowTint));
    }
  });
  it('every strength grows with the tier and never shrinks (stages 2 to 100)', () => {
    for (const kind of KINDS) {
      let scale = 0, aura = 0, scars = 0;
      for (const s of [2, 9, 10, 19, 20, 34, 35, 100, 1_000_000]) {
        const sh = ghostShape(kind, s, 'roaming', 0);
        expect(sh.scale).toBeGreaterThanOrEqual(scale); expect(sh.aura).toBeGreaterThanOrEqual(aura); expect(sh.scars.length).toBeGreaterThanOrEqual(scars);
        scale = sh.scale; aura = sh.aura; scars = sh.scars.length;
      }
    }
    for (let t = 1; t < 4; t++) { expect(AURA_ALPHA[t]!).toBeGreaterThan(AURA_ALPHA[t - 1]!); expect(GHOST_LOOK_SCALE[t]!).toBeGreaterThan(GHOST_LOOK_SCALE[t - 1]!); expect(SCAR_COUNT[t]!).toBeGreaterThanOrEqual(SCAR_COUNT[t - 1]!); }
    expect(CROWN_SPIKES[3]).toBeGreaterThan(CROWN_SPIKES[2]);
    expect(ghostLookTier(1_000_000)).toBe(3);
  });
});

describe('P3F step 5: the unnamed ghost', () => {
  it('is a veiled hooded figure that matches no type: its body is none of the three, it has no arms and no crown at stage 7', () => {
    const u = ghostShape('unknown', 7, 'roaming', 0);
    for (const k of ['wisp', 'shade', 'howler'] as const) expect(JSON.stringify(ghostShape(k, 7, 'roaming', 0).body)).not.toBe(JSON.stringify(u.body));
    expect(u.body.length).toBeGreaterThanOrEqual(14);
    expect(u.extras.length).toBe(0);      // tier 0: a clean veil
    expect(u.eyes.length).toBe(2);
    expect(u.rim).not.toBeNull();          // a pale rim so it can be seen in the dark
    expect(ghostShape('unknown', 25, 'roaming', 0).extras.length).toBe(4); // the veil frays with the tier
    expect(ghostShape('unknown', 60, 'roaming', 0).extras.length).toBe(6);
  });
  it('its hem moves, and stands still under reduced motion', () => {
    expect(JSON.stringify(veiledBody(0, false))).not.toBe(JSON.stringify(veiledBody(500, false)));
    expect(JSON.stringify(veiledBody(0, true))).toBe(JSON.stringify(veiledBody(500, true)));
  });
  it('the three real types keep their own looks (the unnamed one does not replace them)', () => {
    const bodies = (['wisp', 'shade', 'howler'] as const).map((k) => JSON.stringify(ghostShape(k, 2, 'roaming', 0).body));
    expect(new Set(bodies).size).toBe(3);
  });
});

describe('P3F step 5: reduced motion on ghosts', () => {
  it('a calm ghost does not bob, pulse or flutter', () => {
    for (const kind of KINDS) {
      expect(JSON.stringify(ghostShape(kind, 12, 'roaming', 0, false, true))).toBe(JSON.stringify(ghostShape(kind, 12, 'roaming', 7777, false, true)));
      expect(ghostShape(kind, 12, 'roaming', 123, false, true).still).toBe(true);
    }
    for (const state of ['roaming', 'hunting', 'stunned'] as const) {
      expect(ghostLook(state, 0, true)).toEqual(ghostLook(state, 4321, true));
      expect(ghostLook(state, 100, true).bob).toBe(0);
    }
    expect(ghostLook('roaming', 0, false)).not.toEqual(ghostLook('roaming', 900, false));
  });
  it('mixColor still blends', () => { expect(mixColor(0x000000, 0xffffff, 0.5)).toBe(0x808080); });
});
