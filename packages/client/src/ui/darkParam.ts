import { ambientFor, type Difficulty } from '@wb/shared';

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

// ---------------------------------------------------------------- P3D step 1B: stage-driven ambient, in-light assist, dev flag

/**
 * Settings read from the URL.
 *   ?dark=1            force the dark view on a stage that is not dark itself (the spike). Dark stages turn it on by themselves.
 *   &dev=1             (with dark=1 only) the old spike keys: B = full bright, [ ] = ambient, and &ambient=N overrides the stage value.
 *   &assist=1          accessibility assist on from the start (the V key toggles it and the choice is remembered).
 * Without `dev=1` nothing a player can press or type changes how dark the room is.
 */
export interface DarkSettings { enabled: boolean; dev: boolean; assist: boolean; ambientOverride: number | null }

export function darkSettings(search: string): DarkSettings {
  const q = new URLSearchParams(search);
  const base = darkParams(search);
  const dev = base.enabled && q.get('dev') === '1';
  const raw = q.get('ambient');
  const n = raw === null || raw.trim() === '' ? NaN : Number(raw);
  return {
    enabled: base.enabled,
    dev,
    assist: q.get('assist') === '1',
    ambientOverride: dev && Number.isFinite(n) ? clampAmbient(n) : null,
  };
}

/** Ambient outside every light: what the server published for the stage, else the same table the server uses. Never a player choice. */
export function resolveAmbient(published: number | undefined, difficulty: Difficulty, stage: number): number {
  return clampAmbient(published ?? ambientFor(difficulty, stage));
}

/**
 * Accessibility assist. It only improves what is ALREADY inside the player's own light: a slightly larger and brighter light,
 * white outlines on the platforms in view and larger, outlined labels. It never changes the ambient outside the light.
 */
export const ASSIST = { lightScale: 1.15, glowAlpha: 0.3, baseGlowAlpha: 0.16, labelScale: 1.35, labelStroke: 4 } as const;

export interface LightGeometry { cx: number; cy: number; radius: number; coneLength: number; half: number; angle: number }

/** Where the light is. `scale` > 1 is the assist. The radius sits at chest height. */
export function lightGeometry(me: { x: number; y: number }, angle: number, assist: boolean): LightGeometry {
  const k = assist ? ASSIST.lightScale : 1;
  return { cx: me.x, cy: me.y - 28, radius: LIGHT.radius * k, coneLength: LIGHT.coneLength * k, half: LIGHT.coneAngle / 2, angle };
}

/** Fraction of the drawn reach inside which things are treated as lit (the light texture fades to nothing at its very edge). */
export const LIT_REACH = 0.88;

export function inLight(p: { x: number; y: number }, g: LightGeometry): boolean {
  const dx = p.x - g.cx, dy = p.y - g.cy, d = Math.hypot(dx, dy);
  if (d <= g.radius * LIT_REACH) return true;
  if (d > g.coneLength * LIT_REACH) return false;
  let da = Math.atan2(dy, dx) - g.angle;
  da = Math.atan2(Math.sin(da), Math.cos(da)); // wrap to -PI..PI
  return Math.abs(da) <= g.half;
}

/** Polygon of the lit area for a geometry mask: the cone sector (its apex at the player) approximated by `steps` arc segments. */
export function conePolygon(g: LightGeometry, steps = 16): { x: number; y: number }[] {
  const len = g.coneLength * LIT_REACH, pts = [{ x: g.cx, y: g.cy }];
  for (let i = 0; i <= steps; i++) {
    const a = g.angle - g.half + (2 * g.half * i) / steps;
    pts.push({ x: g.cx + Math.cos(a) * len, y: g.cy + Math.sin(a) * len });
  }
  return pts;
}
