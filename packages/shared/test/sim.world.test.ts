import { describe, expect, it } from 'vitest';
import {
  ARENA, GRAVITY, MOMENTUM_DRIFT_TICKS, MOMENTUM_IMPULSE, PLAYER_HEIGHT, PLAYER_WIDTH, TERMINAL_VELOCITY, TICK_DT, WELL_GRAVITY,
  spawnBody, stepBody, worldForTick, type GravityZone, type ImpulseEvent, type InputIntent, type PlayerBody, type StepWorld,
} from '../src';

const IDLE: InputIntent = { moveX: 0, jump: false };
const HW = PLAYER_WIDTH / 2;
const zone = (over: Partial<GravityZone> = {}): GravityZone => ({
  id: 'z', ownerId: 'p', x: 440, y: 360, w: 320, h: 360, gx: 0, gy: WELL_GRAVITY.flip, startTick: 0, expiresTick: 1000, ...over,
});
const imp = (over: Partial<ImpulseEvent> = {}): ImpulseEvent => ({ id: 'i', tick: 0, playerId: 'p', dvx: 0, dvy: 0, cancel: false, driftTicks: MOMENTUM_DRIFT_TICKS, ...over });
const overlapsSolid = (b: PlayerBody) => ARENA.solids.some((r) => b.x + HW > r.x + 1e-6 && b.x - HW < r.x + r.w - 1e-6 && b.y > r.y + 1e-6 && b.y - PLAYER_HEIGHT < r.y + r.h - 1e-6);

/** Run `ticks` ticks applying `worldForTick(data, tick, 'p')` exactly as the server and the client do. */
function run(b: PlayerBody, ticks: number, data: Parameters<typeof worldForTick>[0], input: InputIntent | ((t: number) => InputIntent) = IDLE, from = 0) {
  const path: PlayerBody[] = [];
  for (let t = from; t < from + ticks; t++) {
    stepBody(b, typeof input === 'function' ? input(t) : input, ARENA, worldForTick(data, t, 'p'));
    path.push({ ...b });
  }
  return path;
}

describe('worldForTick (the pure bridge shared by server and prediction)', () => {
  it('is undefined when nothing applies', () => {
    expect(worldForTick(undefined, 5, 'p')).toBeUndefined();
    expect(worldForTick({ zones: [], impulses: [] }, 5, 'p')).toBeUndefined();
    expect(worldForTick({ zones: [zone({ startTick: 10 })] }, 5, 'p')).toBeUndefined();
  });
  it('a zone is active for startTick <= tick < expiresTick only', () => {
    const d = { zones: [zone({ startTick: 10, expiresTick: 20 })] };
    expect(worldForTick(d, 9, 'p')).toBeUndefined();
    expect(worldForTick(d, 10, 'p')!.zones).toHaveLength(1);
    expect(worldForTick(d, 19, 'p')!.zones).toHaveLength(1);
    expect(worldForTick(d, 20, 'p')).toBeUndefined();
  });
  it('an impulse affects only its player; vertical applies once, lateral fades linearly to zero', () => {
    const d = { impulses: [imp({ tick: 10, dvx: 400, dvy: -300, cancel: true })] };
    expect(worldForTick(d, 9, 'p')).toBeUndefined();
    expect(worldForTick(d, 10, 'other')).toBeUndefined();
    const at0 = worldForTick(d, 10, 'p')!.impulse!;
    expect(at0).toEqual({ dvy: -300, cancelVy: true, driftVx: 400 });
    const at4 = worldForTick(d, 14, 'p')!.impulse!;
    expect(at4.dvy).toBe(0); expect(at4.cancelVy).toBe(false); expect(at4.driftVx).toBeCloseTo(200, 10);
    expect(worldForTick(d, 10 + MOMENTUM_DRIFT_TICKS, 'p')).toBeUndefined();
  });
  it('overlapping impulses add up', () => {
    const d = { impulses: [imp({ tick: 5, dvx: 100, dvy: -10 }), imp({ id: 'j', tick: 5, dvx: 50, dvy: -20 })] };
    expect(worldForTick(d, 5, 'p')!.impulse).toEqual({ dvy: -30, cancelVy: false, driftVx: 150 });
  });
});

describe('gravity zones change how the body moves', () => {
  it('a flip zone lifts a standing player until the ceiling stops them; they never end inside a solid', () => {
    const b = spawnBody(600, 680);
    const path = run(b, 60, { zones: [zone()] });
    expect(path.at(-1)!.y).toBeLessThan(600);
    expect(b.y).toBe(500 + 20 + PLAYER_HEIGHT); // head against the underside of the centre platform
    expect(b.vy).toBe(0);
    expect(b.grounded).toBe(false);
    for (const p of path) expect(overlapsSolid(p)).toBe(false);
  });
  it('leaving the flip zone sideways returns normal gravity (no one is trapped)', () => {
    const b = spawnBody(600, 680);
    run(b, 40, { zones: [zone()] });
    run(b, 80, { zones: [zone()] }, { moveX: 1, jump: false }, 40);
    expect(b.x).toBeGreaterThan(zone().x + zone().w); // walked out of the zone's right edge
    run(b, 80, { zones: [zone()] }, IDLE, 120);
    expect(b.grounded).toBe(true); // fell back onto something solid
  });
  it('reduced gravity makes the same jump much higher; zones outside the body do not', () => {
    const jumpApex = (zones?: StepWorld['zones']) => {
      const b = spawnBody(1250, 680); let min = b.y;
      for (let t = 0; t < 120; t++) { stepBody(b, { moveX: 0, jump: t === 0 }, ARENA, zones ? { zones } : undefined); min = Math.min(min, b.y); }
      return 680 - min;
    };
    const normal = jumpApex();
    const low = jumpApex([{ x: 1100, y: 100, w: 180, h: 620, gx: 0, gy: WELL_GRAVITY.reduce }]);
    expect(normal).toBeCloseTo((680 * 680) / (2 * GRAVITY), -1);
    expect(low).toBeGreaterThan(normal * 2.5);
    expect(jumpApex([{ x: 0, y: 0, w: 100, h: 100, gx: 0, gy: WELL_GRAVITY.reduce }])).toBe(normal);
  });
  it('flipped gravity is capped at terminal velocity (no unbounded acceleration)', () => {
    const b = spawnBody(1250, 680);
    let minVy = 0;
    for (let t = 0; t < 200; t++) { stepBody(b, IDLE, ARENA, { zones: [{ x: 1100, y: 0, w: 180, h: 720, gx: 0, gy: -1e6 }] }); minVy = Math.min(minVy, b.vy); }
    expect(minVy).toBeGreaterThanOrEqual(-TERMINAL_VELOCITY);
  });
  it('lateral gravity is a wind: a standing player drifts, walls still stop them', () => {
    const b = spawnBody(300, 680);
    const w: StepWorld = { zones: [{ x: 0, y: 0, w: 1280, h: 720, gx: 1800, gy: GRAVITY }] };
    for (let t = 0; t < 10; t++) stepBody(b, IDLE, ARENA, w);
    expect(b.x).toBeCloseTo(300 + 10 * 1800 * 0.1 * TICK_DT, 5);
    for (let t = 0; t < 400; t++) stepBody(b, IDLE, ARENA, w);
    expect(b.x).toBe(ARENA.width - HW);
  });
});

describe('impulses', () => {
  it('an upward impulse launches a standing player; a downward one slams a jumper', () => {
    const b = spawnBody(1250, 680);
    const path = run(b, 40, { impulses: [imp({ tick: 0, dvy: -MOMENTUM_IMPULSE })] });
    expect(680 - Math.min(...path.map((p) => p.y))).toBeGreaterThan(60);
    const c = spawnBody(1250, 680);
    const jump = run(c, 6, undefined, (t) => ({ moveX: 0, jump: t === 0 }));
    const apexY = jump.at(-1)!.y; expect(apexY).toBeLessThan(680);
    stepBody(c, IDLE, ARENA, { impulse: { dvy: MOMENTUM_IMPULSE, cancelVy: false, driftVx: 0 } });
    expect(c.vy).toBeGreaterThan(300);
  });
  it('cancel kills a fall', () => {
    const b = spawnBody(1250, 100); b.grounded = false; b.vy = 800;
    stepBody(b, IDLE, ARENA, { impulse: { dvy: 0, cancelVy: true, driftVx: 0 } });
    expect(b.vy).toBeLessThanOrEqual(GRAVITY * TICK_DT + 1e-9);
  });
  it('the lateral push carries a free-floating player a bounded, predictable distance', () => {
    const b = spawnBody(300, 680);
    const before = b.x;
    run(b, MOMENTUM_DRIFT_TICKS + 5, { impulses: [imp({ dvx: MOMENTUM_IMPULSE })] });
    const expected = MOMENTUM_IMPULSE * TICK_DT * Array.from({ length: MOMENTUM_DRIFT_TICKS }, (_, a) => 1 - a / MOMENTUM_DRIFT_TICKS).reduce((x, y) => x + y, 0);
    expect(b.x - before).toBeCloseTo(expected, 3);
    expect(expected).toBeLessThan(150);
  });
  it('an impulse can never push a body through a wall or out of the arena', () => {
    const b = spawnBody(90, 680);
    run(b, 60, { impulses: [imp({ dvx: -MOMENTUM_IMPULSE, dvy: -MOMENTUM_IMPULSE })] });
    expect(b.x).toBeGreaterThanOrEqual(HW);
  });
});

describe('fuzz: arbitrary zones, impulses and inputs keep every body finite, in bounds and out of solids', () => {
  it('8 bodies x 3000 ticks with random zones (up to extreme gravity), impulses and inputs', () => {
    let seed = 20260418; const r = () => (seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 2 ** 32;
    for (let n = 0; n < 8; n++) {
      const sp = ARENA.spawns[n % 4]!; const b = spawnBody(sp.x, sp.y);
      const zones: GravityZone[] = []; const impulses: ImpulseEvent[] = [];
      for (let t = 0; t < 3000; t++) {
        if (r() < 0.02) zones.push(zone({ id: `z${t}`, x: r() * 1100, y: r() * 500, w: 40 + r() * 500, h: 40 + r() * 500, gx: (r() - 0.5) * 6000, gy: (r() - 0.5) * 6000, startTick: t, expiresTick: t + 5 + Math.floor(r() * 150) }));
        if (r() < 0.03) impulses.push(imp({ id: `i${t}`, tick: t, dvx: (r() - 0.5) * 2 * MOMENTUM_IMPULSE, dvy: (r() - 0.5) * 2 * MOMENTUM_IMPULSE, cancel: r() < 0.2 }));
        stepBody(b, { moveX: r() < 0.3 ? 0 : r() * 2 - 1, jump: r() < 0.15 }, ARENA, worldForTick({ zones, impulses }, t, 'p'));
        for (const v of [b.x, b.y, b.vx, b.vy]) expect(Number.isFinite(v)).toBe(true);
        expect(b.x).toBeGreaterThanOrEqual(HW - 1e-9); expect(b.x).toBeLessThanOrEqual(ARENA.width - HW + 1e-9);
        expect(b.y).toBeGreaterThanOrEqual(PLAYER_HEIGHT - 1e-9); expect(b.y).toBeLessThanOrEqual(ARENA.height + 1e-9);
        expect(Math.abs(b.vy)).toBeLessThanOrEqual(TERMINAL_VELOCITY + 1e-9);
        if (overlapsSolid(b)) throw new Error(`body stuck in a solid at tick ${t}: ${JSON.stringify(b)}`);
      }
    }
  });
});
