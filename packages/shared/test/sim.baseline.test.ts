import { describe, expect, it } from 'vitest';
import { ARENA, spawnBody, stepBody, type InputIntent, type PlayerBody, type StepWorld } from '../src';
import { stepBodyP2 } from './helpers/simBaseline';

/** Deterministic LCG so failures reproduce. */
const rng = (seed: number) => () => (seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 2 ** 32;

function randomInput(r: () => number): InputIntent {
  const k = r();
  const moveX = k < 0.3 ? 0 : k < 0.5 ? 1 : k < 0.7 ? -1 : r() * 2 - 1;
  return { moveX, jump: r() < 0.12 };
}
const start = (r: () => number): PlayerBody => {
  const sp = ARENA.spawns[Math.floor(r() * 4)]!;
  return spawnBody(sp.x, sp.y);
};

/**
 * The P3B migration must leave the default behaviour BIT-EXACT. The oracle is a frozen copy of the P2 function.
 * `toEqual` uses Object.is for numbers, so even a +0/-0 difference would fail.
 */
describe('stepBody with no world data is bit-exact with the P2 step', () => {
  const emptyWorlds: [string, StepWorld | undefined][] = [
    ['undefined', undefined],
    ['{}', {}],
    ['empty zones', { zones: [] }],
    ['zero impulse', { impulse: { dvy: 0, cancelVy: false, driftVx: 0 } }],
    ['empty zones + zero impulse', { zones: [], impulse: { dvy: 0, cancelVy: false, driftVx: 0 } }],
  ];
  it.each(emptyWorlds)('%s: 40 bodies x 1500 ticks, every field equal on every tick', (_name, world) => {
    const r = rng(12345);
    for (let n = 0; n < 40; n++) {
      const a = start(r), b = { ...a };
      for (let t = 0; t < 1500; t++) {
        const input = randomInput(r);
        stepBodyP2(a, input, ARENA);
        stepBody(b, input, ARENA, world);
        expect(b).toEqual(a);
      }
    }
  });
  it('a zone that never contains the body changes nothing', () => {
    const r = rng(99);
    const far: StepWorld = { zones: [{ x: 5000, y: 5000, w: 100, h: 100, gx: 900, gy: -1800 }] };
    for (let n = 0; n < 10; n++) {
      const a = start(r), b = { ...a };
      for (let t = 0; t < 1000; t++) { const input = randomInput(r); stepBodyP2(a, input, ARENA); stepBody(b, input, ARENA, far); expect(b).toEqual(a); }
    }
  });
  it('the shared exports of the P2 contract are unchanged', () => {
    expect(typeof stepBody).toBe('function');
    expect(stepBody.length).toBeLessThanOrEqual(4); // (body, input, arena = ARENA, world?)
  });
});
