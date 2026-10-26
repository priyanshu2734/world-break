import { GUN_LIMITS, TICK_DT, type GhostShot, type GhostPublic, type GhostStatus, type ItemsPublic } from '@wb/shared';

/** P3E step 4: the pure maths and wording of the Pulse Gun on the client (no Phaser, so it is unit-tested). The server decides every hit; this only draws. */

export interface Pt { x: number; y: number }

/** Does this player carry a Pulse Gun, by the public item list? */
export function carriesGun(items: Pick<ItemsPublic, 'items'> | null | undefined, playerId: string): boolean {
  return !!items && items.items.some((i) => i.kind === 'pulse_gun' && i.state === 'carried' && i.carrierId === playerId);
}

/** The aim line from the player's eyes: as long as the gun's range, never longer. */
export function aimLine(me: Pt, angle: number): { from: Pt; to: Pt } {
  const from = { x: me.x, y: me.y - GUN_LIMITS.eyeHeight };
  return { from, to: { x: from.x + Math.cos(angle) * GUN_LIMITS.rangePx, y: from.y + Math.sin(angle) * GUN_LIMITS.rangePx } };
}

/** Where a shot is `ageMs` after it arrived: it moves speedPx per server tick and ends at its range. */
export function boltAt(shot: Pick<GhostShot, 'x' | 'y' | 'angle' | 'rangePx' | 'speedPx'>, ageMs: number): { x: number; y: number; done: boolean } {
  const ticks = Math.max(0, ageMs) / (TICK_DT * 1000);
  const d = Math.min(shot.rangePx, shot.speedPx * ticks);
  return { x: shot.x + Math.cos(shot.angle) * d, y: shot.y + Math.sin(shot.angle) * d, done: d >= shot.rangePx };
}

/** How long a finished shot's flash and trail stay on screen. */
export const SHOT_SHOW_MS = Math.ceil(GUN_LIMITS.rangePx / GUN_LIMITS.speedPx) * TICK_DT * 1000 + GUN_LIMITS.flashTicks * TICK_DT * 1000;

/** 1 while the muzzle flash is fresh, falling to 0. */
export function flashAlpha(ageMs: number): number {
  return Math.max(0, 1 - Math.max(0, ageMs) / (GUN_LIMITS.flashTicks * TICK_DT * 1000));
}

/** Drop the shots that are no longer worth drawing. */
export function liveShots<T extends { at: number }>(shots: readonly T[], nowMs: number): T[] {
  return shots.filter((s) => nowMs - s.at <= SHOT_SHOW_MS);
}

/** The line shown while a gun is in hand (null = nothing to say). Hidden or caught players cannot shoot, so they are told nothing. */
export function gunPrompt(carries: boolean, status: Pick<GhostStatus, 'hiddenIn' | 'caught'> | null): string | null {
  if (!carries) return null;
  if (status && (status.hiddenIn !== null || status.caught)) return null;
  return 'PULSE GUN: aim with the mouse, click to fire. One charge.';
}

/** Ghosts the stunned marker is drawn over (only a stunned ghost the server showed me). */
export function stunnedGhosts(ghosts: readonly GhostPublic[]): GhostPublic[] {
  return ghosts.filter((g) => g.state === 'stunned');
}

/** A click fires only when the player can act and holds the gun. */
export function canFire(carries: boolean, status: Pick<GhostStatus, 'hiddenIn' | 'caught'> | null, button: number): boolean {
  return button === 0 && carries && !(status && (status.hiddenIn !== null || status.caught));
}
