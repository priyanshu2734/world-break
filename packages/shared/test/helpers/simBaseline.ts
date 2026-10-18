/**
 * FROZEN COPY of the P2 `stepBody` (movement step as of commit ecde814, before P3B). Used ONLY as the oracle of the
 * differential test that proves the P3B migration left the default behaviour bit-exact. Never edit this file.
 */
import { SERVER_TICK_HZ } from '../../src/constants';
import { ARENA, type Arena } from '../../src/arena';

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

export function sanitizeInputP2(i: Partial<InputIntent>): InputIntent {
  const m = typeof i.moveX === 'number' && Number.isFinite(i.moveX) ? i.moveX : 0;
  return { moveX: Math.max(-1, Math.min(1, m)), jump: i.jump === true };
}

/** Advance one server tick (TICK_DT) in place. */
export function stepBodyP2(b: PlayerBody, rawInput: InputIntent, arena: Arena = ARENA): void {
  const input = sanitizeInputP2(rawInput);
  const h = TICK_DT / SUBSTEPS;
  if (input.moveX > 0.01) b.facing = 1;
  else if (input.moveX < -0.01) b.facing = -1;

  for (let s = 0; s < SUBSTEPS; s++) {
    b.vx = input.moveX * MOVE_SPEED;
    if (input.jump && b.grounded) {
      b.vy = -JUMP_SPEED;
      b.grounded = false;
    }
    b.vy = Math.min(b.vy + GRAVITY * h, TERMINAL_VELOCITY);

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
