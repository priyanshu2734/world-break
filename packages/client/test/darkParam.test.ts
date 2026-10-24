import { describe, expect, it } from 'vitest';
import { ASSIST_AMBIENT, AMBIENT_MAX, DEFAULT_AMBIENT, aimAngle, clampAmbient, darkParams, effectiveAmbient } from '../src/ui/darkParam';

describe('?dark=1 spike flag', () => {
  it('is on only for dark=1', () => {
    expect(darkParams('?dark=1').enabled).toBe(true);
    expect(darkParams('?x=2&dark=1&lab=0').enabled).toBe(true);
    for (const s of ['', '?', '?dark=0', '?dark=true', '?dark', '?Dark=1', '?dark=11', '?darkness=1']) expect(darkParams(s).enabled).toBe(false);
  });
  it('reads ambient and assist, with safe fallbacks', () => {
    expect(darkParams('?dark=1').ambient).toBe(DEFAULT_AMBIENT);
    expect(darkParams('?dark=1&ambient=0.2').ambient).toBe(0.2);
    expect(darkParams('?dark=1&ambient=9').ambient).toBe(AMBIENT_MAX);
    expect(darkParams('?dark=1&ambient=-1').ambient).toBe(0);
    for (const bad of ['', 'abc', 'NaN', 'Infinity']) expect(darkParams(`?dark=1&ambient=${bad}`).ambient).toBe(DEFAULT_AMBIENT);
    expect(darkParams('?dark=1&assist=1').assist).toBe(true);
    expect(darkParams('?dark=1&assist=yes').assist).toBe(false);
  });
});

describe('brightness assist', () => {
  it('only raises the floor, never lowers a brighter ambient', () => {
    expect(effectiveAmbient(0.05, false)).toBe(0.05);
    expect(effectiveAmbient(0.05, true)).toBe(ASSIST_AMBIENT);
    expect(effectiveAmbient(0.5, true)).toBe(0.5);
  });
  it('clamps', () => {
    expect(clampAmbient(Number.NaN)).toBe(DEFAULT_AMBIENT);
    expect(clampAmbient(5)).toBe(AMBIENT_MAX);
  });
});

describe('flashlight aim', () => {
  const me = { x: 100, y: 300 };
  it('points at the mouse when it has moved', () => {
    expect(aimAngle(me, { x: 200, y: 272 }, 1)).toBeCloseTo(0);
    expect(aimAngle(me, { x: 0, y: 272 }, 1)).toBeCloseTo(Math.PI);
  });
  it('falls back to facing without a pointer or with the pointer on the player', () => {
    expect(aimAngle(me, null, 1)).toBe(0);
    expect(aimAngle(me, null, -1)).toBe(Math.PI);
    expect(aimAngle(me, { x: 100, y: 272 }, -1)).toBe(Math.PI);
  });
});
