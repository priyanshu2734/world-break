import { z } from 'zod';
import type { Arena, Rect } from '../arena';
import { TERMINAL_VELOCITY, TICK_DT, SUBSTEPS, GRAVITY, type StepWorld, type StepZone } from '../sim';
import { MOMENTUM_DRIFT_TICKS, MOMENTUM_IMPULSE } from './specs';

/**
 * Public, physical world data. The server puts it into the game snapshot; client prediction applies the SAME
 * `stepBody` with the SAME data (see `worldForTick`). Nothing here is private: it is all visible on screen.
 */
export const GravityZoneSchema = z.object({
  id: z.string(),
  ownerId: z.string(),
  x: z.number(), y: z.number(), w: z.number().positive(), h: z.number().positive(),
  /** Gravity vector inside the rectangle, px/s^2. */
  gx: z.number(), gy: z.number(),
  /** Active while startTick <= tick < expiresTick. */
  startTick: z.number().int().min(0),
  expiresTick: z.number().int().min(0),
});
export type GravityZone = z.infer<typeof GravityZoneSchema>;

export const ImpulseEventSchema = z.object({
  id: z.string(),
  /** The sim tick the impulse is applied on. */
  tick: z.number().int().min(0),
  playerId: z.string(),
  /** Lateral push (px/s). It fades linearly over `driftTicks`. */
  dvx: z.number(),
  /** Vertical impulse (px/s), applied once at `tick`. */
  dvy: z.number(),
  /** Cancel the vertical velocity first (applied once at `tick`). */
  cancel: z.boolean(),
  driftTicks: z.number().int().min(1),
});
export type ImpulseEvent = z.infer<typeof ImpulseEventSchema>;

export const PropKindSchema = z.enum(['crate']);
export const PropSchema = z.object({
  id: z.string(),
  kind: PropKindSchema,
  /** Feet-centre, like players. */
  x: z.number(), y: z.number(), vx: z.number(), vy: z.number(),
  w: z.number().positive(), h: z.number().positive(),
  grounded: z.boolean(),
  /** Frozen (stopped dead, immune to gravity and impulses) while tick < frozenUntilTick. */
  frozenUntilTick: z.number().int().min(0),
  /** null = a stage prop anyone may affect; otherwise the player who made this clone. */
  ownerId: z.string().nullable(),
  cloneOf: z.string().nullable(),
  /** Clones expire; stage props never do. */
  expiresTick: z.number().int().nullable(),
  /** Only light objects can be duplicated. */
  light: z.boolean(),
});
export type Prop = z.infer<typeof PropSchema>;

export const WorldPublicSchema = z.object({
  zones: z.array(GravityZoneSchema),
  impulses: z.array(ImpulseEventSchema),
  props: z.array(PropSchema),
});
export type WorldPublic = z.infer<typeof WorldPublicSchema>;

// ---------------------------------------------------------------- the pure bridge used by server AND client prediction
type WorldData = { zones?: readonly GravityZone[]; impulses?: readonly ImpulseEvent[] };

/**
 * The optional `stepBody` parameter for `playerId` at `tick`. Returns undefined when nothing applies, so the default
 * (no abilities) code path is exactly the pre-P3B movement step. Pure: the same inputs give the same output on both sides.
 */
export function worldForTick(data: WorldData | undefined, tick: number, playerId: string): StepWorld | undefined {
  if (!data) return undefined;
  let zones: StepZone[] | undefined;
  for (const z of data.zones ?? []) {
    if (z.startTick <= tick && tick < z.expiresTick) (zones ??= []).push(z);
  }
  let impulse: StepWorld['impulse'];
  for (const e of data.impulses ?? []) {
    if (e.playerId !== playerId) continue;
    const age = tick - e.tick;
    if (age < 0 || age >= e.driftTicks) continue;
    const imp = (impulse ??= { dvy: 0, cancelVy: false, driftVx: 0 });
    if (age === 0) { imp.dvy += e.dvy; if (e.cancel) imp.cancelVy = true; }
    imp.driftVx += e.dvx * (1 - age / e.driftTicks);
  }
  if (!zones && !impulse) return undefined;
  const out: StepWorld = {};
  if (zones) out.zones = zones;
  if (impulse) out.impulse = impulse;
  return out;
}

/** Clamp an impulse component to the documented bound (also rejects NaN/Infinity by returning 0). */
export function boundImpulse(v: number): number {
  if (!Number.isFinite(v)) return 0;
  return Math.max(-MOMENTUM_IMPULSE, Math.min(MOMENTUM_IMPULSE, v));
}
export const DEFAULT_DRIFT_TICKS = MOMENTUM_DRIFT_TICKS;

// ---------------------------------------------------------------- prop physics (server-simulated, rendered by interpolation)
export const PROP_W = 32;
export const PROP_H = 32;
export const PROP_MAX_SPEED = 700;
/** Ground friction applied once per tick while a prop rests on something. */
export const PROP_FRICTION = 0.82;

const rectsOverlap = (p: { x: number; y: number; w: number; h: number }, r: Rect): boolean =>
  p.x + p.w / 2 > r.x && p.x - p.w / 2 < r.x + r.w && p.y > r.y && p.y - p.h < r.y + r.h;

const inZone = (z: StepZone, cx: number, cy: number) => cx >= z.x && cx < z.x + z.w && cy >= z.y && cy < z.y + z.h;

/** Deterministic prop step (one tick). Frozen props do not move at all. Props never collide with players or each other. */
export function stepProp(p: Prop, tick: number, arena: Arena, zones?: readonly StepZone[]): void {
  if (p.frozenUntilTick > tick) { p.vx = 0; p.vy = 0; return; }
  const h = TICK_DT / SUBSTEPS;
  const hw = p.w / 2;
  for (let s = 0; s < SUBSTEPS; s++) {
    let g = GRAVITY, gx = 0;
    if (zones) for (const z of zones) if (inZone(z, p.x, p.y - p.h / 2)) { g = z.gy; gx = z.gx; break; }
    p.vy = Math.max(-TERMINAL_VELOCITY, Math.min(p.vy + g * h, TERMINAL_VELOCITY));
    p.vx = Math.max(-PROP_MAX_SPEED, Math.min(p.vx + gx * h, PROP_MAX_SPEED));

    p.x += p.vx * h;
    for (const r of arena.solids) {
      if (rectsOverlap(p, r)) { p.x = p.vx > 0 ? r.x - hw : r.x + r.w + hw; p.vx = 0; }
    }
    if (p.x < hw) { p.x = hw; p.vx = 0; } else if (p.x > arena.width - hw) { p.x = arena.width - hw; p.vx = 0; }

    p.y += p.vy * h;
    p.grounded = false;
    for (const r of arena.solids) {
      if (rectsOverlap(p, r)) {
        if (p.vy > 0) { p.y = r.y; p.grounded = true; } else p.y = r.y + r.h + p.h;
        p.vy = 0;
      }
    }
    if (p.y > arena.height) { p.y = arena.height; p.vy = 0; p.grounded = true; }
    else if (p.y - p.h < 0) { p.y = p.h; if (p.vy < 0) p.vy = 0; }
  }
  if (p.grounded) { p.vx *= PROP_FRICTION; if (Math.abs(p.vx) < 3) p.vx = 0; }
}
