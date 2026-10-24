import { describe, expect, it } from 'vitest';
import { ambientFor } from '@wb/shared';
import {
  ASSIST, LIGHT, LIT_REACH, aimAngle, conePolygon, darkSettings, inLight, lightGeometry, resolveAmbient,
} from '../src/ui/darkParam';

describe('dark settings: the dev flag gates the old keys and the ambient override', () => {
  it('without dev=1 an ambient in the URL changes nothing', () => {
    expect(darkSettings('?dark=1&ambient=0.5').ambientOverride).toBeNull();
    expect(darkSettings('?dark=1&ambient=0.5').dev).toBe(false);
    expect(darkSettings('?ambient=0.5&dev=1').dev).toBe(false); // dev needs dark=1 too
  });
  it('with dark=1&dev=1 the override and the old keys are available', () => {
    const s = darkSettings('?dark=1&dev=1&ambient=0.5');
    expect(s.dev).toBe(true);
    expect(s.ambientOverride).toBe(0.5);
    expect(darkSettings('?dark=1&dev=1&ambient=zzz').ambientOverride).toBeNull();
    expect(darkSettings('?dark=1&dev=1&ambient=7').ambientOverride).toBeLessThanOrEqual(0.6);
  });
  it('assist is only a start-up preference; dev=2 and other values are off', () => {
    expect(darkSettings('?dark=1&assist=1').assist).toBe(true);
    expect(darkSettings('?dark=1&dev=2').dev).toBe(false);
    expect(darkSettings('').enabled).toBe(false);
  });
});

describe('ambient comes from the stage and mode', () => {
  it('uses what the server published, else the shared table', () => {
    expect(resolveAmbient(0.14, 'easy', 1)).toBe(0.14);
    expect(resolveAmbient(undefined, 'easy', 1)).toBeCloseTo(ambientFor('easy', 1));
    expect(resolveAmbient(undefined, 'hardcore', 1_000_000)).toBeCloseTo(0.02);
  });
  it('clamps a bad published value', () => {
    expect(resolveAmbient(9, 'easy', 1)).toBeLessThanOrEqual(0.6);
    expect(resolveAmbient(Number.NaN, 'easy', 1)).toBeGreaterThanOrEqual(0);
  });
});

describe('the assist improves the light only', () => {
  const me = { x: 500, y: 600 };
  it('makes the light slightly larger and brighter, never changes the ambient (that has no assist input at all)', () => {
    const plain = lightGeometry(me, 0, false), assist = lightGeometry(me, 0, true);
    expect(plain.radius).toBe(LIGHT.radius);
    expect(assist.radius).toBeCloseTo(LIGHT.radius * ASSIST.lightScale);
    expect(assist.coneLength).toBeGreaterThan(plain.coneLength);
    expect(ASSIST.glowAlpha).toBeGreaterThan(ASSIST.baseGlowAlpha);
    expect(ASSIST.lightScale).toBeLessThanOrEqual(1.25); // "slightly"
    expect(resolveAmbient(0.1, 'easy', 1)).toBe(0.1); // same with or without the assist
  });
});

describe('what counts as lit', () => {
  const me = { x: 500, y: 600 }, g = lightGeometry(me, 0, false); // cone points right
  it('the radius light is lit all round, the cone only ahead', () => {
    expect(inLight({ x: 500 - 60, y: 572 }, g)).toBe(true); // behind but inside the radius
    expect(inLight({ x: 500 - 300, y: 572 }, g)).toBe(false); // far behind
    expect(inLight({ x: 500 + 300, y: 572 }, g)).toBe(true); // ahead, in the cone
    expect(inLight({ x: 500 + 300, y: 572 - 250 }, g)).toBe(false); // ahead but far off-axis
  });
  it('stops at the reach of the beam', () => {
    expect(inLight({ x: 500 + LIGHT.coneLength * LIT_REACH - 5, y: 572 }, g)).toBe(true);
    expect(inLight({ x: 500 + LIGHT.coneLength * LIT_REACH + 5, y: 572 }, g)).toBe(false);
  });
  it('follows the aim angle, including across the +-PI seam', () => {
    const left = lightGeometry(me, aimAngle(me, null, -1), false);
    expect(inLight({ x: 500 - 300, y: 572 }, left)).toBe(true);
    expect(inLight({ x: 500 + 300, y: 572 }, left)).toBe(false);
  });
  it('the mask polygon starts at the player and stays inside the reach', () => {
    const poly = conePolygon(g, 8);
    expect(poly[0]).toEqual({ x: g.cx, y: g.cy });
    expect(poly.length).toBe(1 + 9);
    for (const p of poly.slice(1)) expect(Math.hypot(p.x - g.cx, p.y - g.cy)).toBeCloseTo(g.coneLength * LIT_REACH);
  });
});
