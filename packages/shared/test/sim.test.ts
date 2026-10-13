import { describe, expect, it } from 'vitest';
import {
  ARENA, GRAVITY, JUMP_SPEED, MOVE_SPEED, NEUTRAL_INPUT, PLAYER_HEIGHT, PLAYER_WIDTH, TICK_DT, TERMINAL_VELOCITY,
  cloneBody, sanitizeInput, spawnBody, stepBody, type Arena, type InputIntent, type PlayerBody,
} from '../src';

const run = (b: PlayerBody, input: InputIntent, ticks: number, arena: Arena = ARENA) => {
  for (let i = 0; i < ticks; i++) stepBody(b, input, arena);
  return b;
};
const HW = PLAYER_WIDTH / 2;
const RIGHT = { moveX: 1, jump: false };
const LEFT = { moveX: -1, jump: false };

describe('stepBody: movement', () => {
  it('moves MOVE_SPEED * dt per tick on flat ground', () => {
    const b = spawnBody(300, 680);
    stepBody(b, RIGHT, ARENA);
    expect(b.x).toBeCloseTo(300 + MOVE_SPEED * TICK_DT, 5);
    expect(b.grounded).toBe(true);
    expect(b.facing).toBe(1);
  });
  it('stands still with neutral input and stays grounded', () => {
    const b = run(spawnBody(300, 680), NEUTRAL_INPUT, 40);
    expect(b.x).toBe(300);
    expect(b.y).toBe(680);
    expect(b.grounded).toBe(true);
  });
  it('is deterministic: same inputs give identical state', () => {
    const script: InputIntent[] = Array.from({ length: 120 }, (_, i) => ({ moveX: i % 30 < 15 ? 1 : -1, jump: i % 17 === 0 }));
    const a = spawnBody(520, 680), c = spawnBody(520, 680);
    for (const inp of script) { stepBody(a, inp); stepBody(c, inp); }
    expect(a).toEqual(c);
  });
});

describe('stepBody: world bounds', () => {
  it('cannot leave the left or right edge', () => {
    expect(run(spawnBody(300, 680), LEFT, 200).x).toBe(HW);
    expect(run(spawnBody(300, 680), RIGHT, 200).x).toBe(ARENA.width - HW);
  });
  it('cannot rise above the ceiling', () => {
    const b = spawnBody(640, 450);
    b.grounded = false; b.vy = -5000;
    run(b, NEUTRAL_INPUT, 10);
    expect(b.y - PLAYER_HEIGHT).toBeGreaterThanOrEqual(0);
  });
  it('cannot fall below the world even with no floor solid', () => {
    const open: Arena = { ...ARENA, solids: [] };
    const b = run(spawnBody(640, 100), NEUTRAL_INPUT, 100, open);
    expect(b.y).toBe(open.height);
    expect(b.grounded).toBe(true);
  });
});

describe('stepBody: collision', () => {
  it('jumps only when grounded (no double jump)', () => {
    const b = spawnBody(90, 680);
    stepBody(b, { moveX: 0, jump: true }, ARENA);
    expect(b.vy).toBeLessThan(0);
    expect(b.grounded).toBe(false);
    const vyAfterFirst = b.vy;
    stepBody(b, { moveX: 0, jump: true }, ARENA);
    expect(b.vy).toBeGreaterThan(vyAfterFirst); // gravity only; not re-launched
  });
  it('jump apex is roughly v^2/2g and the body lands back on the floor', () => {
    const b = spawnBody(90, 680);
    let minY = b.y;
    stepBody(b, { moveX: 0, jump: true });
    minY = Math.min(minY, b.y);
    for (let i = 0; i < 40; i++) { stepBody(b, NEUTRAL_INPUT); minY = Math.min(minY, b.y); }
    const ideal = (JUMP_SPEED * JUMP_SPEED) / (2 * GRAVITY);
    expect(680 - minY).toBeGreaterThan(ideal * 0.85);
    expect(680 - minY).toBeLessThanOrEqual(ideal + 1);
    expect(b.y).toBe(680);
    expect(b.grounded).toBe(true);
  });
  it('lands on a platform top when falling onto it', () => {
    const p = ARENA.solids[3]!; // centre platform
    const b = spawnBody(p.x + p.w / 2, p.y - 120);
    b.grounded = false;
    run(b, NEUTRAL_INPUT, 30);
    expect(b.y).toBe(p.y);
    expect(b.grounded).toBe(true);
  });
  it('is blocked by the side of a platform', () => {
    const p = ARENA.solids[1]!; // low-left platform, y 590..610
    const b = spawnBody(p.x - 80, 680 - 0); // on the floor, below platform: walk is free
    run(b, RIGHT, 60);
    expect(b.x).toBeGreaterThan(p.x + p.w); // passes underneath (clearance > player height)
    // a tall wall blocks fully
    const wall: Arena = { ...ARENA, solids: [...ARENA.solids, { x: 600, y: 400, w: 40, h: 280 }] };
    const c = run(spawnBody(400, 680), RIGHT, 100, wall);
    expect(c.x).toBe(600 - HW);
  });
  it('bumps its head on the underside of a platform', () => {
    const p = ARENA.solids[3]!; // y 500..520
    const b = spawnBody(p.x + p.w / 2, 680);
    for (let i = 0; i < 40; i++) {
      stepBody(b, { moveX: 0, jump: true });
      expect(b.y - PLAYER_HEIGHT).toBeGreaterThanOrEqual(p.y + p.h - 1e-6);
    }
  });
  it('does not tunnel through a thin platform at terminal velocity', () => {
    const thin = ARENA.solids[4]!; // 20px thick
    const b = spawnBody(thin.x + 50, thin.y - 400);
    b.grounded = false; b.vy = TERMINAL_VELOCITY;
    run(b, NEUTRAL_INPUT, 40);
    expect(b.y).toBe(thin.y);
  });
});

describe('sanitizeInput', () => {
  it('clamps and defaults hostile values', () => {
    expect(sanitizeInput({ moveX: 50, jump: true })).toEqual({ moveX: 1, jump: true });
    expect(sanitizeInput({ moveX: -9 })).toEqual({ moveX: -1, jump: false });
    expect(sanitizeInput({ moveX: NaN })).toEqual({ moveX: 0, jump: false });
    expect(sanitizeInput({ moveX: Infinity })).toEqual({ moveX: 0, jump: false });
  });
  it('cloneBody is a deep copy', () => {
    const a = spawnBody(1, 2); const c = cloneBody(a); c.x = 99;
    expect(a.x).toBe(1);
  });
});
