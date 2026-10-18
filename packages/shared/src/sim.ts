import { SERVER_TICK_HZ } from './constants';
import { ARENA, type Arena } from './arena';

/**
 * Deterministic movement rules. The server applies them authoritatively;
 * the client runs the same function for local prediction only.
 */
export const TICK_DT = 1 / SERVER_TICK_HZ;
export const PLAYER_WIDTH = 28;
export const PLAYER_HEIGHT = 44;
export const MOVE_SPEED = 260; // px/s
export const JUMP_SPEED = 680; // px/s
export const GRAVITY = 1800; // px/s^2
export const TERMINAL_VELOCITY = 900; // px/s
/** Sub-steps per tick keep per-step travel (< 12px) far below platform thickness: no tunnelling. */
export const SUBSTEPS = 4;
/** P3B: a zone's lateral gravity gx (px/s^2) acts as a wind of gx * this many seconds (walking overwrites vx every sub-step). */
export const LATERAL_GRAVITY_SCALE = 0.1;

const HALF_W = PLAYER_WIDTH / 2;

/** Position is the feet-centre of the body. */
export interface PlayerBody {
  x: number;
  y: number;
  vx: number;
  vy: number;
  grounded: boolean;
  facing: 1 | -1;
}

/** What a player *wants*; never a position or outcome. */
export interface InputIntent {
  moveX: number; // -1..1
  jump: boolean;
}

export const NEUTRAL_INPUT: Readonly<InputIntent> = Object.freeze({ moveX: 0, jump: false });

export function spawnBody(x: number, y: number): PlayerBody {
  return { x, y, vx: 0, vy: 0, grounded: true, facing: 1 };
}
export function cloneBody(b: PlayerBody): PlayerBody {
  return { ...b };
}

export function sanitizeInput(i: Partial<InputIntent>): InputIntent {
  const m = typeof i.moveX === 'number' && Number.isFinite(i.moveX) ? i.moveX : 0;
  return { moveX: Math.max(-1, Math.min(1, m)), jump: i.jump === true };
}

/**
 * Advance one server tick (TICK_DT) in place.
 * P3B: the optional `world` carries gravity zones and impulses for THIS tick (see `StepWorld`). It is plain data that
 * the server publishes and the client predicts with; without it (undefined or empty) the arithmetic below is exactly
 * the pre-P3B step, which `shared/test/sim.baseline.test.ts` proves against a frozen copy of the old function.
 */
export function stepBody(b: PlayerBody, rawInput: InputIntent, arena: Arena = ARENA, world?: StepWorld): void {
  const input = sanitizeInput(rawInput);
  const h = TICK_DT / SUBSTEPS;
  if (input.moveX > 0.01) b.facing = 1;
  else if (input.moveX < -0.01) b.facing = -1;

  // ---- P3B: impulse applied once at the start of the tick; lateral push is a per-tick drift velocity (data, not state) ----
  const imp = world?.impulse;
  if (imp) {
    if (imp.cancelVy) b.vy = 0;
    if (imp.dvy !== 0) {
      b.vy = Math.max(-TERMINAL_VELOCITY, Math.min(TERMINAL_VELOCITY, b.vy + imp.dvy));
      if (imp.dvy < 0) b.grounded = false; // leaving the ground: the jump check below must not eat the impulse
    }
  }
  const drift = imp ? imp.driftVx : 0;
  const zones = world?.zones;

  for (let s = 0; s < SUBSTEPS; s++) {
    b.vx = input.moveX * MOVE_SPEED;
    let g = GRAVITY;
    let inZone = false;
    if (zones && zones.length > 0) {
      const cy = b.y - PLAYER_HEIGHT / 2;
      for (const z of zones) {
        if (b.x >= z.x && b.x < z.x + z.w && cy >= z.y && cy < z.y + z.h) {
          g = z.gy; inZone = true;
          if (z.gx !== 0) b.vx += z.gx * LATERAL_GRAVITY_SCALE;
          break;
        }
      }
    }
    if (drift !== 0) b.vx += drift;
    if (input.jump && b.grounded) {
      b.vy = -JUMP_SPEED;
      b.grounded = false;
    }
    b.vy = Math.min(b.vy + g * h, TERMINAL_VELOCITY);
    if (inZone && b.vy < -TERMINAL_VELOCITY) b.vy = -TERMINAL_VELOCITY; // flipped gravity must not accelerate without bound

    // --- horizontal axis ---
    b.x += b.vx * h;
    for (const r of arena.solids) {
      if (overlaps(b, r)) {
        b.x = b.vx > 0 ? r.x - HALF_W : r.x + r.w + HALF_W;
        b.vx = 0;
      }
    }
    if (b.x < HALF_W) b.x = HALF_W;
    else if (b.x > arena.width - HALF_W) b.x = arena.width - HALF_W;

    // --- vertical axis ---
    b.y += b.vy * h;
    b.grounded = false;
    for (const r of arena.solids) {
      if (overlaps(b, r)) {
        if (b.vy > 0) {
          b.y = r.y;
          b.grounded = true;
        } else {
          b.y = r.y + r.h + PLAYER_HEIGHT;
        }
        b.vy = 0;
      }
    }
    if (b.y > arena.height) {
      b.y = arena.height;
      b.vy = 0;
      b.grounded = true;
    } else if (b.y - PLAYER_HEIGHT < 0) {
      b.y = PLAYER_HEIGHT;
      if (b.vy < 0) b.vy = 0;
    }
  }
}

function overlaps(b: PlayerBody, r: { x: number; y: number; w: number; h: number }): boolean {
  return b.x + HALF_W > r.x && b.x - HALF_W < r.x + r.w && b.y > r.y && b.y - PLAYER_HEIGHT < r.y + r.h;
}

// ---- P3B: optional world data for stepBody (types only in this step; see docs/ARCHITECTURE.md "P3B physics migration") ----
/** A gravity zone that is ACTIVE for the tick being simulated (the caller filters by tick). */
export interface StepZone { x: number; y: number; w: number; h: number; gx: number; gy: number }
/** Optional extra data for one `stepBody` call. Omitted (undefined) = exactly the pre-P3B behaviour. */
export interface StepWorld {
  zones?: readonly StepZone[];
  impulse?: { dvy: number; cancelVy: boolean; driftVx: number };
}
