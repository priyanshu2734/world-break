/**
 * P3D step 1 (darkness spike): pure parameters for the dark view. No Phaser here, so it is unit-tested.
 *
 * URL flags (client only, the server is not involved):
 *   ?dark=1            turn the dark view on (any other value, or no flag, leaves the game exactly as before)
 *   &ambient=0.08      ambient brightness 0..1 outside the lights (default 0.04). Later the stage and mode will drive this value.
 *   &assist=1          brightness assist on from the start (also toggled in game with B). Assist only raises the ambient
 *                      floor; it never changes a server rule.
 */
export const DEFAULT_AMBIENT = 0.04;
/** Ambient floor while the brightness assist is on. */
export const ASSIST_AMBIENT = 0.4;
export const AMBIENT_STEP = 0.02;
export const AMBIENT_MAX = 0.6;

export interface DarkParams { enabled: boolean; ambient: number; assist: boolean }

export function clampAmbient(v: number): number {
  if (!Number.isFinite(v)) return DEFAULT_AMBIENT;
  return Math.min(AMBIENT_MAX, Math.max(0, v));
}

export function darkParams(search: string): DarkParams {
  const q = new URLSearchParams(search);
  const raw = q.get('ambient');
  const parsed = raw === null || raw.trim() === '' ? NaN : Number(raw);
  return {
    enabled: q.get('dark') === '1',
    ambient: Number.isFinite(parsed) ? clampAmbient(parsed) : DEFAULT_AMBIENT,
    assist: q.get('assist') === '1',
  };
}

/** The brightness actually drawn outside the lights. */
export function effectiveAmbient(ambient: number, assist: boolean): number {
  const a = clampAmbient(ambient);
  return assist ? Math.max(a, ASSIST_AMBIENT) : a;
}

/** Flashlight and radius light geometry (pixels, radians). */
export const LIGHT = {
  /** Small always-on light around the player. */
  radius: 120,
  /** Flashlight reach and full opening angle. */
  coneLength: 460,
  coneAngle: (62 * Math.PI) / 180,
} as const;

/** Direction the flashlight points: at the mouse when it has moved, otherwise the way the player faces. */
export function aimAngle(me: { x: number; y: number }, pointer: { x: number; y: number } | null, facing: 1 | -1): number {
  if (pointer) {
    const dx = pointer.x - me.x, dy = pointer.y - (me.y - 28);
    if (Math.hypot(dx, dy) > 4) return Math.atan2(dy, dx);
  }
  return facing === 1 ? 0 : Math.PI;
}
